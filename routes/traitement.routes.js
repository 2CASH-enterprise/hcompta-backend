// ============================================================
// H-Compta AI — Pipeline de traitement IA multi-étapes
// Étape 1 : PME-01 identifie la pièce et le journal
// Étape 2 : PME-0X traite selon le journal détecté
// Étape 3 : PME-12 vérifie la TVA
// Étape 4 : PME-13 score et décision d'action
// + Machine Learning : few-shot sur exemples validés
// ============================================================
const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const supabase = require('../config/supabase');

// Journaux SYSCOHADA reconnus
const JOURNAUX = ['ACH','VTE','BQ','CAI','IMM','PAI','EFF','STK','OD'];

// Map journal → code prompt
const JOURNAL_TO_PROMPT = {
  ACH: 'PME-02',
  VTE: 'PME-03',
  BQ:  'PME-04',
  CAI: 'PME-05',
  IMM: 'PME-06',
  PAI: 'PME-07',
  EFF: 'PME-08',
  STK: 'PME-09',
  OD:  'PME-10',
};

// ----------------------------------------------------------------
// HELPER : Lire un prompt depuis Supabase (avec cache local léger)
// ----------------------------------------------------------------
const promptCache = {};
async function getPrompt(code, pays) {
  const cacheKey = `${code}_${pays}`;
  if (promptCache[cacheKey]) return promptCache[cacheKey];
  try {
    const { data } = await supabase
      .from('prompts')
      .select('contenu')
      .eq('code', code)
      .in('pays', [pays, 'ALL'])
      .eq('actif', true)
      .order('version', { ascending: false })
      .limit(1)
      .single();
    if (data?.contenu) {
      promptCache[cacheKey] = data.contenu; // Cache 5 min
      setTimeout(() => delete promptCache[cacheKey], 5 * 60 * 1000);
    }
    return data?.contenu || null;
  } catch(e) {
    return null;
  }
}

// ----------------------------------------------------------------
// HELPER : Appel Claude API générique
// ----------------------------------------------------------------
async function appelClaude(systemPrompt, userMessages, maxTokens = 1500) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model:      'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessages }],
    },
    {
      headers: {
        'x-api-key':         process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      timeout: 60000,
    }
  );
  return response.data?.content?.[0]?.text || '';
}

// ----------------------------------------------------------------
// HELPER : Parser la réponse JSON de Claude (robuste)
// ----------------------------------------------------------------
function parseJSON(rawText) {
  try {
    const cleaned = rawText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    return JSON.parse(cleaned);
  } catch(e) {
    // Tentative d'extraction d'un JSON partiel
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch(e2) {}
    }
    return null;
  }
}

// ----------------------------------------------------------------
// HELPER : Télécharger le fichier en base64
// ----------------------------------------------------------------
async function getFileAsBase64(fileUrl) {
  const response = await axios.get(fileUrl, {
    responseType: 'arraybuffer',
    timeout: 20000,
  });
  const base64      = Buffer.from(response.data).toString('base64');
  const contentType = response.headers['content-type'] || 'application/pdf';
  return { base64, contentType };
}

function getMediaType(contentType, fileName) {
  if (contentType.includes('pdf') || (fileName||'').endsWith('.pdf')) return 'application/pdf';
  if (contentType.includes('jpeg') || (fileName||'').match(/\.jpe?g$/i)) return 'image/jpeg';
  if (contentType.includes('png')  || (fileName||'').endsWith('.png'))  return 'image/png';
  if (contentType.includes('webp')) return 'image/webp';
  return 'application/pdf';
}

// ----------------------------------------------------------------
// HELPER : Construire le contenu utilisateur (fichier + texte)
// ----------------------------------------------------------------
function buildUserContent(base64, mediaType, texte) {
  const isImage = mediaType.startsWith('image/');
  return isImage
    ? [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: texte }
      ]
    : [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: texte }
      ];
}

// ----------------------------------------------------------------
// HELPER : Substituer les variables dans un prompt
// ----------------------------------------------------------------
function substituerVariables(prompt, vars) {
  let result = prompt;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), val || '');
  }
  return result;
}

// ----------------------------------------------------------------
// HELPER : Few-shot learning — exemples validés
// ----------------------------------------------------------------
const fewShotCache = {};
async function getFewShotExemples(journal, pays, limit = 3) {
  const cacheKey = `${journal}_${pays}`;
  if (fewShotCache[cacheKey]) return fewShotCache[cacheKey];
  try {
    const { data } = await supabase
      .from('prompt_logs')
      .select('output_payload, created_at')
      .eq('prompt_code', 'exemple_valide')
      .eq('score', 100)
      .order('created_at', { ascending: false })
      .limit(limit * 4);

    const exemples = (data || [])
      .filter(row => {
        const p = row.output_payload || {};
        return (p.pays === pays || p.pays === 'ALL') &&
               (!journal || p.journal === journal);
      })
      .slice(0, limit)
      .map(row => row.output_payload);

    if (exemples.length > 0) {
      fewShotCache[cacheKey] = exemples;
      setTimeout(() => delete fewShotCache[cacheKey], 2 * 60 * 1000); // Cache 2 min
    }
    return exemples;
  } catch(e) {
    return [];
  }
}

function buildFewShotBlock(exemples) {
  if (!exemples || !exemples.length) return '';
  const lines = exemples.map((ex, i) => {
    const ecrs = (ex.ecritures || [])
      .map(e => `    {"compte":"${e.compte}","libelle":"${e.libelle}","debit":${e.debit},"credit":${e.credit}}`)
      .join(',\n');
    return `EXEMPLE VALIDÉ ${i+1} (${ex.type_piece||'pièce'} · Journal ${ex.journal||'OD'}) :\n{\n  "type_piece":"${ex.type_piece||'autre'}",\n  "journal":"${ex.journal||'OD'}",\n  "ecritures":[\n${ecrs}\n  ]\n}`;
  }).join('\n---\n');
  return `\n\nEXEMPLES RÉELS VALIDÉS PAR LE CABINET (utilise-les comme référence exacte) :\n${lines}\n\nFin des exemples. Génère maintenant les écritures pour la pièce soumise.\n`;
}

// ================================================================
// PIPELINE PRINCIPAL : POST /api/traitement/piece/:pieceId
// ================================================================
router.post('/piece/:pieceId', async (req, res) => {
  const { pieceId } = req.params;
  const pipeline = []; // Journal des étapes pour debug

  try {
    // ── INIT : Récupérer la pièce et la société ──────────────────
    const { data: piece, error: e1 } = await supabase
      .from('pieces')
      .select('*, companies(id, company_name, country, vat_rate)')
      .eq('id', pieceId)
      .single();

    if (e1 || !piece)    return res.status(404).json({ error: 'Pièce introuvable' });
    if (!piece.file_url) return res.status(400).json({ error: 'Pièce sans fichier' });
    if (piece.status === 'processed') return res.status(409).json({ error: 'Pièce déjà traitée', piece });

    const company = piece.companies || {};
    const pays    = company.country   || 'CI';
    const tva     = company.vat_rate  || 18;
    const nomPME  = company.company_name || 'PME';

    // Passer en processing
    await supabase.from('pieces').update({ status: 'processing' }).eq('id', pieceId);

    // Télécharger le fichier une seule fois (réutilisé dans toutes les étapes)
    const { base64, contentType } = await getFileAsBase64(piece.file_url);
    const mediaType = getMediaType(contentType, piece.file_name);

    // ── ÉTAPE 1 : PME-01 — Identification de la pièce ───────────
    pipeline.push({ etape: 1, code: 'PME-01', statut: 'start' });

    const promptPME01 = await getPrompt('PME-01', pays)
      || 'Identifie le type de pièce et le journal SYSCOHADA. Réponds en JSON avec type_piece, journal, sens, confiance_identification.';

    const rawEtape1 = await appelClaude(
      promptPME01,
      buildUserContent(base64, mediaType, 'Identifie cette pièce comptable. Réponds uniquement en JSON.'),
      500
    );

    const identification = parseJSON(rawEtape1) || {};
    const journal = JOURNAUX.includes(identification.journal) ? identification.journal : 'OD';
    const typePiece = identification.type_piece || 'autre';
    const confiance = identification.confiance_identification || 'MOYENNE';

    pipeline.push({ etape: 1, code: 'PME-01', statut: 'ok', journal, typePiece, confiance });

    // ── ÉTAPE 2 : PME-XX — Codification selon journal ────────────
    pipeline.push({ etape: 2, code: JOURNAL_TO_PROMPT[journal] || 'PME-10', statut: 'start' });

    const codePromptJournal = JOURNAL_TO_PROMPT[journal] || 'PME-10';
    let promptJournal = await getPrompt(codePromptJournal, pays);

    // Fallback si le prompt n'est pas en base
    if (!promptJournal) {
      promptJournal = await getPrompt('analyse_piece', pays) || '';
    }

    // Substituer les variables dynamiques
    promptJournal = substituerVariables(promptJournal, {
      pays_client:  pays,
      taux_tva:     String(tva),
      nom_pme:      nomPME,
      periode:      new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
      date_cloture: new Date().toISOString().slice(0, 10),
      methode_stock: 'CMUP',
      nom_banque:   '',
      num_compte_banque: '',
      nom_caisse:   'Caisse principale',
    });

    // Enrichir avec les exemples validés (few-shot learning)
    const exemplesFewShot = await getFewShotExemples(journal, pays, 3);
    if (exemplesFewShot.length > 0) {
      promptJournal += buildFewShotBlock(exemplesFewShot);
    }

    const texteEtape2 = `Type de pièce identifié : ${typePiece} | Journal : ${journal}
Génère les écritures SYSCOHADA complètes pour cette pièce. Réponds UNIQUEMENT en JSON.`;

    const rawEtape2 = await appelClaude(
      promptJournal,
      buildUserContent(base64, mediaType, texteEtape2),
      2000
    );

    const codification = parseJSON(rawEtape2) || {};
    let ecritures = codification.ecritures || [];

    pipeline.push({ etape: 2, code: codePromptJournal, statut: 'ok', ecritures_count: ecritures.length });

    // ── ÉTAPE 3 : PME-12 — Vérification TVA ──────────────────────
    // Seulement pour les journaux avec TVA (ACH, VTE)
    let alerteTVA = null;
    if (['ACH', 'VTE'].includes(journal) && ecritures.length > 0) {
      pipeline.push({ etape: 3, code: 'PME-12', statut: 'start' });

      const promptTVA = await getPrompt('PME-12', pays);
      if (promptTVA) {
        const promptTVASubs = substituerVariables(promptTVA, {
          pays_client: pays,
          taux_tva:    String(tva),
        });

        const rawTVA = await appelClaude(
          promptTVASubs,
          buildUserContent(base64, mediaType, 'Vérifie la TVA de cette pièce. Réponds uniquement en JSON avec soumis_tva, tva_calculee, tva_deductible, alerte_ecart.'),
          400
        );

        const verificationTVA = parseJSON(rawTVA);
        if (verificationTVA && verificationTVA.alerte_ecart) {
          alerteTVA = {
            soumis_tva:    verificationTVA.soumis_tva,
            tva_calculee:  verificationTVA.tva_calculee,
            tva_deductible: verificationTVA.tva_deductible,
            alerte:        verificationTVA.alerte_ecart,
          };
        }
        pipeline.push({ etape: 3, code: 'PME-12', statut: 'ok', alerte: !!alerteTVA });
      }
    }

    // ── ÉTAPE 4 : PME-13 — Score de confiance ────────────────────
    pipeline.push({ etape: 4, code: 'PME-13', statut: 'start' });

    let scoreConfiance = codification.score_confiance || 75;

    const promptScore = await getPrompt('PME-13', pays);
    if (promptScore && ecritures.length > 0) {
      const contexteScore = JSON.stringify({
        type_piece:   typePiece,
        journal,
        ecritures:    ecritures.slice(0, 5),
        confiance_identification: confiance,
        alerte_tva:   !!alerteTVA,
        equilibre:    Math.abs(
          ecritures.reduce((s,e) => s + Number(e.debit||0), 0) -
          ecritures.reduce((s,e) => s + Number(e.credit||0), 0)
        ) < 1,
      });

      const rawScore = await appelClaude(
        promptScore,
        [{ type: 'text', text: `Attribue un score de confiance à cette écriture :\n${contexteScore}\nRéponds uniquement en JSON avec score, statut, raisons_penalite, action_requise.` }],
        300
      );

      const scoring = parseJSON(rawScore);
      if (scoring && typeof scoring.score === 'number') {
        scoreConfiance = Math.min(100, Math.max(0, scoring.score));
      }
      pipeline.push({ etape: 4, code: 'PME-13', statut: 'ok', score: scoreConfiance });
    }

    // ── FINAL : Validation équilibre et insertion ─────────────────
    const totalDebit  = ecritures.reduce((s, e) => s + Number(e.debit  || 0), 0);
    const totalCredit = ecritures.reduce((s, e) => s + Number(e.credit || 0), 0);
    const equilibre   = Math.abs(totalDebit - totalCredit) < 1;

    // Si déséquilibre → pénalité score
    if (!equilibre) scoreConfiance = Math.min(scoreConfiance, 60);

    // Insérer les écritures en base
    if (ecritures.length > 0) {
      const lignes = ecritures.map(e => ({
        company_id:    piece.company_id,
        piece_id:      pieceId,
        journal,
        date_ecriture: new Date().toISOString().slice(0, 10),
        compte:        String(e.compte || ''),
        libelle:       String(e.libelle || ''),
        debit:         Math.max(0, Number(e.debit  || 0)),
        credit:        Math.max(0, Number(e.credit || 0)),
        status:        'generated',
      }));

      const { error: eErr } = await supabase.from('ecritures').insert(lignes);
      if (eErr) {
        await supabase.from('pieces').update({ status: 'error' }).eq('id', pieceId);
        return res.status(500).json({ error: 'Erreur insertion écritures : ' + eErr.message });
      }
    }

    // Logger dans prompt_logs
    await supabase.from('prompt_logs').insert([{
      prompt_code:    'analyse_piece',
      company_id:     piece.company_id,
      input_payload:  {
        piece_id:        pieceId,
        file_name:       piece.file_name,
        media_type:      mediaType,
        pipeline:        pipeline,
        few_shot_count:  exemplesFewShot.length,
      },
      output_payload: {
        identification,
        codification,
        alerte_tva:  alerteTVA,
        score:       scoreConfiance,
        equilibre,
      },
      score: scoreConfiance,
    }]);

    // Mettre à jour la pièce
    const { data: updatedPiece } = await supabase
      .from('pieces')
      .update({
        status:          'processed',
        type_piece:      typePiece,
        journal,
        score_confiance: scoreConfiance,
        processed_at:    new Date().toISOString(),
      })
      .eq('id', pieceId)
      .select()
      .single();

    // Réponse complète
    return res.json({
      success:   true,
      piece:     updatedPiece,
      pipeline,
      analyse: {
        type_piece:       typePiece,
        journal,
        confiance_identification: confiance,
        resume:           codification.resume || identification.raison || '',
        montant_ht:       codification.extraction?.montant_ht || codification.montant_ht || null,
        tva:              codification.extraction?.montant_tva || codification.tva || null,
        montant_ttc:      codification.extraction?.montant_ttc || codification.montant_ttc || null,
        score_confiance:  scoreConfiance,
        equilibre,
        alerte_tva:       alerteTVA,
      },
      ecritures_count:     ecritures.length,
      ecritures,
      few_shot_count:      exemplesFewShot.length,
      apprentissage_actif: exemplesFewShot.length > 0,
      prompts_utilises:    ['PME-01', codePromptJournal, 'PME-12', 'PME-13'].filter(Boolean),
    });

  } catch(err) {
    await supabase.from('pieces').update({ status: 'error' }).eq('id', pieceId).catch(() => {});
    return res.status(500).json({ error: err.message, pipeline });
  }
});

// ================================================================
// BATCH : POST /api/traitement/batch/:companyId
// ================================================================
router.post('/batch/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const limit = parseInt(req.query.limit) || 5;

    const { data: pieces, error } = await supabase
      .from('pieces')
      .select('id, file_name')
      .eq('company_id', companyId)
      .eq('status', 'uploaded')
      .order('uploaded_at', { ascending: true })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    if (!pieces || !pieces.length) return res.json({ message: 'Aucune pièce en attente', traites: 0 });

    res.json({
      message:   `Pipeline lancé pour ${pieces.length} pièce(s)`,
      piece_ids: pieces.map(p => p.id),
      traites:   pieces.length,
    });

    // Traitement séquentiel en arrière-plan
    for (const piece of pieces) {
      try {
        await axios.post(
          `http://localhost:${process.env.PORT || 3000}/api/traitement/piece/${piece.id}`,
          {},
          { timeout: 120000 }
        );
        await new Promise(r => setTimeout(r, 1500));
      } catch(e) {
        console.error(`Erreur pièce ${piece.id}:`, e.message);
      }
    }
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ================================================================
// STATUS : GET /api/traitement/status/:pieceId
// ================================================================
router.get('/status/:pieceId', async (req, res) => {
  try {
    const { data: piece, error } = await supabase
      .from('pieces')
      .select('id, status, score_confiance, type_piece, journal, processed_at, file_name')
      .eq('id', req.params.pieceId)
      .single();

    if (error || !piece) return res.status(404).json({ error: 'Pièce introuvable' });

    const { data: ecritures } = await supabase
      .from('ecritures')
      .select('id, compte, libelle, debit, credit, journal, status')
      .eq('piece_id', req.params.pieceId)
      .order('debit', { ascending: false });

    return res.json({ piece, ecritures: ecritures || [] });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
