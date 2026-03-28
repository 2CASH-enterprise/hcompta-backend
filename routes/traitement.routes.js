// ============================================================
// H-Compta AI — Traitement IA des pièces comptables
// Analyse via Claude API → écritures SYSCOHADA → mise à jour pièce
// ============================================================
const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const supabase = require('../config/supabase');

// Journaux SYSCOHADA reconnus
const JOURNAUX = ['ACH','VTE','BQ','CAI','OD','SAL','AN','RAN'];

// ----------------------------------------------------------------
// HELPER : Lire le prompt depuis la table prompts
// ----------------------------------------------------------------
async function getPrompt(code, pays) {
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
    return data?.contenu || null;
  } catch(e) {
    return null;
  }
}

// ----------------------------------------------------------------
// HELPER : Prompt de fallback intégré (si table prompts vide)
// ----------------------------------------------------------------
function buildDefaultPrompt(company) {
  const pays = company.country || 'CI';
  const taux = company.vat_rate || 18;
  return `Tu es Mariah, experte en comptabilité SYSCOHADA pour la zone OHADA.
Tu analyses une pièce comptable d'une entreprise en ${pays} soumise à la TVA à ${taux}%.

Analyse la pièce fournie et génère les écritures comptables SYSCOHADA correspondantes.

Règles SYSCOHADA à respecter :
- Plan comptable OHADA : classe 1 (capitaux), 2 (immobilisations), 3 (stocks), 4 (tiers), 5 (trésorerie), 6 (charges), 7 (produits)
- TVA collectée : compte 44571 (ventes) — TVA déductible : compte 44551 (achats)
- Journaux : ACH (achats), VTE (ventes), BQ (banque), CAI (caisse), OD (opérations diverses), SAL (salaires)
- Chaque écriture doit être équilibrée (total débit = total crédit)
- Libellé clair et précis en français

Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, au format exact :
{
  "type_piece": "facture_achat|facture_vente|releve_bancaire|recu|autre",
  "journal": "ACH|VTE|BQ|CAI|OD|SAL",
  "score_confiance": 85,
  "resume": "Description courte de la pièce en 1 phrase",
  "montant_ht": 100000,
  "tva": 18000,
  "montant_ttc": 118000,
  "ecritures": [
    {
      "compte": "601100",
      "libelle": "Achat de marchandises - Fournisseur X",
      "debit": 100000,
      "credit": 0
    },
    {
      "compte": "44551",
      "libelle": "TVA déductible 18%",
      "debit": 18000,
      "credit": 0
    },
    {
      "compte": "401100",
      "libelle": "Fournisseur X",
      "debit": 0,
      "credit": 118000
    }
  ]
}`;
}

// ----------------------------------------------------------------
// HELPER : Récupérer les exemples validés pour le few-shot learning
// ----------------------------------------------------------------
async function getFewShotExemples(journal, pays, limit = 3) {
  try {
    const { data } = await supabase
      .from('prompt_logs')
      .select('output_payload, created_at')
      .eq('prompt_code', 'exemple_valide')
      .eq('score', 100)
      .order('created_at', { ascending: false })
      .limit(limit * 4); // Chercher plus pour filtrer par journal/pays

    const exemples = (data || [])
      .filter(row => {
        const p = row.output_payload || {};
        return (p.pays === pays || p.pays === 'ALL') &&
               (p.journal === journal || !journal);
      })
      .slice(0, limit)
      .map(row => row.output_payload);

    return exemples;
  } catch(e) {
    return []; // Non bloquant — le traitement continue sans exemples
  }
}

// ----------------------------------------------------------------
// HELPER : Construire le bloc few-shot à injecter dans le prompt
// ----------------------------------------------------------------
function buildFewShotBlock(exemples) {
  if (!exemples || exemples.length === 0) return '';

  const lines = exemples.map((ex, i) => {
    const ecrituresStr = (ex.ecritures || [])
      .map(e => `    {"compte":"${e.compte}","libelle":"${e.libelle}","debit":${e.debit},"credit":${e.credit}}`)
      .join(',\n');
    return `
EXEMPLE VALIDÉ ${i + 1} (${ex.type_piece || 'pièce'} - Journal ${ex.journal || 'OD'}) :
{
  "type_piece": "${ex.type_piece || 'autre'}",
  "journal": "${ex.journal || 'OD'}",
  "ecritures": [
${ecrituresStr}
  ]
}`;
  }).join('\n---\n');

  return `\n\nEXEMPLES RÉELS VALIDÉS PAR LE CABINET (utilise-les comme référence) :\n${lines}\n\nFin des exemples. Génère maintenant les écritures pour la pièce soumise.\n`;
}
async function getFileAsBase64(fileUrl) {
  try {
    const response = await axios.get(fileUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
    });
    const base64 = Buffer.from(response.data).toString('base64');
    const contentType = response.headers['content-type'] || 'application/pdf';
    return { base64, contentType };
  } catch(e) {
    throw new Error('Impossible de télécharger le fichier : ' + e.message);
  }
}

// ----------------------------------------------------------------
// HELPER : Déterminer le media_type Claude selon le fichier
// ----------------------------------------------------------------
function getClaudeMediaType(contentType, fileName) {
  if (contentType.includes('pdf') || (fileName||'').endsWith('.pdf')) return 'application/pdf';
  if (contentType.includes('jpeg') || contentType.includes('jpg') || (fileName||'').match(/\.jpe?g$/i)) return 'image/jpeg';
  if (contentType.includes('png') || (fileName||'').endsWith('.png')) return 'image/png';
  if (contentType.includes('webp')) return 'image/webp';
  return 'application/pdf'; // fallback
}

// ----------------------------------------------------------------
// ROUTE PRINCIPALE : POST /api/traitement/piece/:pieceId
// Déclenche l'analyse IA d'une pièce et génère les écritures
// ----------------------------------------------------------------
router.post('/piece/:pieceId', async (req, res) => {
  const { pieceId } = req.params;

  try {
    // 1) Récupérer la pièce
    const { data: piece, error: e1 } = await supabase
      .from('pieces')
      .select('*, companies(id, company_name, country, vat_rate)')
      .eq('id', pieceId)
      .single();

    if (e1 || !piece) return res.status(404).json({ error: 'Pièce introuvable' });
    if (!piece.file_url) return res.status(400).json({ error: 'Pièce sans fichier attaché' });
    if (piece.status === 'processed') return res.status(409).json({ error: 'Pièce déjà traitée', piece });

    const company = piece.companies || {};

    // 2) Passer en statut "processing"
    await supabase.from('pieces').update({ status: 'processing' }).eq('id', pieceId);

    // 3) Lire le prompt depuis la table prompts (ou fallback)
    let promptContenu = await getPrompt('analyse_piece', company.country || 'CI')
      || buildDefaultPrompt(company);

    // 3b) MACHINE LEARNING — Enrichir le prompt avec les exemples validés
    // On détecte d'abord le journal probable pour cibler les exemples pertinents
    const journalProbable = piece.journal || null;
    const exemplesFewShot = await getFewShotExemples(
      journalProbable,
      company.country || 'CI',
      3  // 3 exemples max pour ne pas dépasser la fenêtre de contexte
    );
    if (exemplesFewShot.length > 0) {
      // Injecter les exemples à la fin du prompt système
      promptContenu += buildFewShotBlock(exemplesFewShot);
    }

    // 4) Télécharger le fichier et encoder en base64
    const { base64, contentType } = await getFileAsBase64(piece.file_url);
    const mediaType = getClaudeMediaType(contentType, piece.file_name);
    const isImage = mediaType.startsWith('image/');

    // 5) Construire le message Claude selon le type de fichier
    const userContent = isImage
      ? [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Analyse cette pièce comptable et génère les écritures SYSCOHADA. Réponds uniquement en JSON.' }
        ]
      : [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: 'Analyse ce document comptable et génère les écritures SYSCOHADA. Réponds uniquement en JSON.' }
        ];

    // 6) Appel Claude API
    const claudeResponse = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: promptContenu,
        messages: [{ role: 'user', content: userContent }],
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

    // 7) Parser la réponse JSON de Claude
    const rawText = claudeResponse.data?.content?.[0]?.text || '';
    let analyse;
    try {
      // Nettoyer les éventuels backticks markdown
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analyse = JSON.parse(cleaned);
    } catch(parseErr) {
      // Si le JSON est invalide, on passe en erreur
      await supabase.from('pieces').update({ status: 'error' }).eq('id', pieceId);
      return res.status(422).json({
        error: 'Réponse IA non parsable',
        raw: rawText.substring(0, 500),
      });
    }

    // 8) Valider les écritures (débit = crédit)
    const ecritures = analyse.ecritures || [];
    const totalDebit  = ecritures.reduce((s, e) => s + Number(e.debit  || 0), 0);
    const totalCredit = ecritures.reduce((s, e) => s + Number(e.credit || 0), 0);
    const equilibre   = Math.abs(totalDebit - totalCredit) < 1; // tolérance 1 FCFA

    // Corriger le journal si non reconnu
    const journal = JOURNAUX.includes(analyse.journal) ? analyse.journal : 'OD';

    // 9) Insérer les écritures en base
    if (ecritures.length > 0) {
      const lignes = ecritures.map(e => ({
        company_id:     piece.company_id,
        piece_id:       piece.id,
        journal:        journal,
        date_ecriture:  new Date().toISOString().slice(0, 10),
        compte:         String(e.compte || ''),
        libelle:        String(e.libelle || ''),
        debit:          Math.max(0, Number(e.debit  || 0)),
        credit:         Math.max(0, Number(e.credit || 0)),
        status:         'generated',
      }));

      const { error: eErr } = await supabase.from('ecritures').insert(lignes);
      if (eErr) {
        await supabase.from('pieces').update({ status: 'error' }).eq('id', pieceId);
        return res.status(500).json({ error: 'Erreur insertion écritures : ' + eErr.message });
      }
    }

    // 10) Logger dans prompt_logs
    await supabase.from('prompt_logs').insert([{
      prompt_code:    'analyse_piece',
      company_id:     piece.company_id,
      input_payload:  {
        piece_id:          pieceId,
        file_name:         piece.file_name,
        media_type:        mediaType,
        few_shot_count:    exemplesFewShot.length, // Nb exemples injectés
      },
      output_payload: analyse,
      score:          analyse.score_confiance || null,
    }]);

    // 11) Mettre à jour la pièce → processed
    const { data: updatedPiece } = await supabase
      .from('pieces')
      .update({
        status:         'processed',
        type_piece:     analyse.type_piece || null,
        journal:        journal,
        score_confiance: Math.min(100, Math.max(0, Number(analyse.score_confiance || 75))),
        processed_at:   new Date().toISOString(),
      })
      .eq('id', pieceId)
      .select()
      .single();

    // 12) Répondre avec le résultat complet
    return res.json({
      success:      true,
      piece:        updatedPiece,
      analyse: {
        type_piece:      analyse.type_piece,
        journal,
        resume:          analyse.resume,
        montant_ht:      analyse.montant_ht,
        tva:             analyse.tva,
        montant_ttc:     analyse.montant_ttc,
        score_confiance: analyse.score_confiance,
        equilibre,
      },
      ecritures_count:    ecritures.length,
      ecritures,
      few_shot_count:     exemplesFewShot.length, // Nb exemples utilisés
      apprentissage_actif: exemplesFewShot.length > 0,
    });

  } catch(err) {
    // En cas d'erreur inattendue → passer la pièce en erreur
    await supabase.from('pieces').update({ status: 'error' }).eq('id', pieceId).catch(() => {});
    return res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// ROUTE : POST /api/traitement/batch/:companyId
// Traiter toutes les pièces en attente d'une société (status=uploaded)
// ----------------------------------------------------------------
router.post('/batch/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const limit = parseInt(req.query.limit) || 5; // max 5 à la fois

    const { data: pieces, error } = await supabase
      .from('pieces')
      .select('id, file_name')
      .eq('company_id', companyId)
      .eq('status', 'uploaded')
      .order('uploaded_at', { ascending: true })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    if (!pieces || !pieces.length) return res.json({ message: 'Aucune pièce en attente', traites: 0 });

    // Répondre immédiatement et traiter en arrière-plan
    res.json({
      message:   `Traitement lancé pour ${pieces.length} pièce(s)`,
      piece_ids: pieces.map(p => p.id),
      traites:   pieces.length,
    });

    // Traitement séquentiel pour ne pas surcharger l'API Claude
    for (const piece of pieces) {
      try {
        await axios.post(
          `http://localhost:${process.env.PORT || 3000}/api/traitement/piece/${piece.id}`,
          {},
          { timeout: 90000 }
        );
        // Pause 1s entre chaque appel pour respecter les rate limits
        await new Promise(r => setTimeout(r, 1000));
      } catch(e) {
        console.error(`Erreur traitement pièce ${piece.id}:`, e.message);
      }
    }

  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// ROUTE : GET /api/traitement/status/:pieceId
// Vérifier le statut de traitement d'une pièce
// ----------------------------------------------------------------
router.get('/status/:pieceId', async (req, res) => {
  try {
    const { data: piece, error } = await supabase
      .from('pieces')
      .select('id, status, score_confiance, type_piece, journal, processed_at, file_name')
      .eq('id', req.params.pieceId)
      .single();

    if (error || !piece) return res.status(404).json({ error: 'Pièce introuvable' });

    // Récupérer les écritures associées
    const { data: ecritures } = await supabase
      .from('ecritures')
      .select('compte, libelle, debit, credit, journal')
      .eq('piece_id', req.params.pieceId)
      .order('debit', { ascending: false });

    return res.json({ piece, ecritures: ecritures || [] });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
