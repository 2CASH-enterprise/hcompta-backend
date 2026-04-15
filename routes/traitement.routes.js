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
  const cacheKey = code + '_' + (pays || 'ALL');
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
// Délai entre appels pour respecter la limite 30 000 tokens/minute
let lastApiCall = 0;
const MIN_INTERVAL_MS = 800;  // 0.8s entre appels Claude (rate limit: 30k tokens/min)

async function appelClaude(systemPrompt, userMessages, maxTokens = 1000, retries = 3, modelOverride = null) {
  // Respecter le délai minimum entre appels (anti-rate-limit)
  const now = Date.now();
  const elapsed = now - lastApiCall;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastApiCall = Date.now();

  // Choisir le modèle — Haiku pour étapes légères (identification, score)
  const model = modelOverride || process.env.CLAUDE_MODEL || 'claude-opus-4-6';

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model,
          max_tokens: Math.min(maxTokens, 2000), // Cap à 2000 tokens max
          system:     systemPrompt,
          messages: (function() {
            // Si c'est déjà un tableau de messages avec role → utiliser tel quel
            if (Array.isArray(userMessages) && userMessages.length > 0 && userMessages[0].role) {
              return userMessages;
            }
            // Si c'est un tableau de blocs content (image, document, text) → envelopper
            if (Array.isArray(userMessages)) {
              return [{ role: 'user', content: userMessages }];
            }
            // String simple → envelopper
            return [{ role: 'user', content: userMessages }];
          })(),
        },
        {
          headers: {
            'x-api-key':         process.env.CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type':      'application/json',
          },
          timeout: 90000,
        }
      );
      return response.data?.content?.[0]?.text || '';
    } catch (err) {
      const status  = err.response?.status;
      const isRate  = status === 429;
      const isLoad  = status === 529;
      const errData = err.response?.data?.error;

      if ((isRate || isLoad) && attempt < retries) {
        // Backoff exponentiel : 10s, 30s, 60s
        const waitMs = isRate ? [10000, 30000, 60000][attempt] || 60000 : 5000;
        console.warn(`⚠️ Anthropic ${status} (${errData?.type || ''}) — attente ${waitMs/1000}s (tentative ${attempt+1}/${retries})`);
        await new Promise(r => setTimeout(r, waitMs));
        lastApiCall = Date.now();
        continue;
      }

      if (isRate) {
        throw new Error(`Rate limit 429 — Limite tokens/minute dépassée. Réessayez dans 1 minute.`);
      }
      if (status === 401) {
        throw new Error('Clé API Anthropic invalide — vérifiez CLAUDE_API_KEY sur Render.');
      }
      throw err;
    }
  }
}

// ----------------------------------------------------------------
// HELPER : Parser la réponse JSON de Claude (robuste)
// ----------------------------------------------------------------
function parseJSON(rawText) {
  try {
    const cleaned = rawText
      .replace(/'''json\n?/g, '')
      .replace(/'''\n?/g, '')
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
// Essaie d'abord via Supabase Storage (signed URL), puis via HTTP direct
// ----------------------------------------------------------------
async function getFileAsBase64(fileUrl) {
  // Extraire le path depuis l'URL Supabase pour utiliser l'API storage
  try {
    // Méthode 1 : Extraire le chemin depuis l'URL et créer un signed URL
    const urlObj = new URL(fileUrl);
    const pathMatch = urlObj.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/pieces\/(.+)/);
    
    if (pathMatch) {
      const filePath = decodeURIComponent(pathMatch[1].split('?')[0]);
      console.log('📁 Téléchargement via Supabase Storage:', filePath.slice(0, 80));
      
      // Créer un signed URL valide 60 secondes
      const { data: signedData, error: signErr } = await supabase.storage
        .from('pieces')
        .createSignedUrl(filePath, 60);
      
      if (!signErr && signedData?.signedUrl) {
        const response = await axios.get(signedData.signedUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: { 'Accept': 'application/pdf,image/*,*/*' }
        });
        
        // Vérifier que c'est bien un PDF ou une image (pas du HTML d'erreur)
        const contentType = response.headers['content-type'] || 'application/pdf';
        if (contentType.includes('html')) {
          throw new Error('Signed URL retourne HTML — fichier introuvable dans le bucket');
        }
        
        const base64 = Buffer.from(response.data).toString('base64');
        console.log('✅ Fichier téléchargé via signed URL, taille base64:', base64.length, 'contentType:', contentType);
        return { base64, contentType };
      }
    }
    
    // Méthode 2 : Téléchargement direct depuis l'URL publique
    console.log('📁 Téléchargement direct depuis URL:', fileUrl.slice(0, 80));
    const response = await axios.get(fileUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: { 'Accept': 'application/pdf,image/*,*/*' }
    });
    
    const contentType = response.headers['content-type'] || 'application/pdf';
    if (contentType.includes('html')) {
      throw new Error('URL retourne HTML — bucket probablement privé ou fichier introuvable');
    }
    
    const base64 = Buffer.from(response.data).toString('base64');
    console.log('✅ Fichier téléchargé direct, taille base64:', base64.length, 'contentType:', contentType);
    return { base64, contentType };
    
  } catch(err) {
    console.error('❌ Erreur téléchargement fichier:', err.message);
    throw err;
  }
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
    result = result.replace(new RegExp('{{' + (key) + '}}', 'g'), val || '');
  }
  return result;
}

// ----------------------------------------------------------------
// HELPER : Few-shot learning — exemples validés
// ----------------------------------------------------------------
const fewShotCache = {};
async function getFewShotExemples(journal, pays, limit = 3) {
  const cacheKey = journal + '_' + (pays || 'ALL');
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
  var lines = exemples.map(function(ex, i) {
    var ecrs = (ex.ecritures || []).map(function(e) {
      return '    {"compte":"' + (e.compte||'') + '","libelle":"' + (e.libelle||'') + '","debit":' + (e.debit||0) + ',"credit":' + (e.credit||0) + '}';
    }).join(',\n');
    var header = 'EXEMPLE VALIDE ' + (i+1) + ' (' + (ex.type_piece||'piece') + ' Journal ' + (ex.journal||'OD') + ') :';
    var body = '{"type_piece":"' + (ex.type_piece||'autre') + '","journal":"' + (ex.journal||'OD') + '","ecritures":[' + ecrs + ']}';
    return header + '\n' + body;
  }).join('\n---\n');
  return '\n\nEXEMPLES VALIDES PAR LE CABINET :\n' + lines + '\n\nGenere les ecritures pour la piece soumise.\n';
}


// ================================================================
// PIPELINE PRINCIPAL : POST /api/traitement/piece/:pieceId
// ================================================================
async function traitementHandler(req, res) {
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
    // Optimisation : détecter le type depuis le nom de fichier si possible
    const nomLower = (piece.file_name || '').toLowerCase();
    let typePieceEvident = null;
    let journalEvident   = null;
    if (nomLower.includes('facture') && (nomLower.includes('achat') || nomLower.includes('fournisseur') || nomLower.includes('honoraire'))) {
      typePieceEvident = 'facture_achat'; journalEvident = 'ACH';
    } else if (nomLower.includes('facture') && (nomLower.includes('vente') || nomLower.includes('client'))) {
      typePieceEvident = 'facture_vente'; journalEvident = 'VTE';
    } else if (nomLower.includes('releve') || nomLower.includes('relevé') || nomLower.includes('bancaire')) {
      typePieceEvident = 'releve_bancaire'; journalEvident = 'BAN';
    } else if (nomLower.includes('recu') || nomLower.includes('reçu') || nomLower.includes('caisse')) {
      typePieceEvident = 'recu'; journalEvident = 'CAI';
    }

    pipeline.push({ etape: 1, code: 'PME-01', statut: typePieceEvident ? 'skip-nom-fichier' : 'start' });

    // ── MODÈLES IA par étape ──────────────────────────────────────
    const MODELE_IDENTIFICATION = process.env.CLAUDE_MODEL_LIGHT || 'claude-haiku-4-5-20251001';
    const MODELE_CODIFICATION   = process.env.CLAUDE_MODEL       || 'claude-sonnet-4-6';
    const MODELE_TVA            = process.env.CLAUDE_MODEL_LIGHT || 'claude-haiku-4-5-20251001';
    const MODELE_SCORE          = process.env.CLAUDE_MODEL_LIGHT || 'claude-haiku-4-5-20251001';

    // ── ÉTAPE 1 : PME-01 — Identification de la pièce ───────────
    let journal      = journalEvident  || 'OD';
    let typePiece    = typePieceEvident || 'autre';
    let confiance    = typePieceEvident ? 95 : 50;
    let identification = { type_piece: typePiece, journal, raison: 'Détection par nom de fichier' };
    let casFacile    = !!typePieceEvident;

    // Si pas de détection par nom → appel Claude PME-01
    if (!typePieceEvident) {
      const promptPME01 = await getPrompt('PME-01', pays);
      if (promptPME01) {
        try {
          const promptIdent = substituerVariables(promptPME01, {
            pays_client: pays,
            taux_tva:    String(tva),
            nom_pme:     nomPME,
          });
          const rawIdent = await appelClaude(
            promptIdent,
            buildUserContent(base64, mediaType, 'Identifie cette pièce comptable. Réponds UNIQUEMENT en JSON avec type_piece, journal, confiance (0-100), raison.'),
            200,
            2,
            MODELE_IDENTIFICATION
          );
          const parsed = parseJSON(rawIdent);
          if (parsed && parsed.journal) {
            journal        = JOURNAUX.includes(parsed.journal) ? parsed.journal : (JOURNAL_TO_PROMPT[parsed.journal] ? parsed.journal : 'OD');
            typePiece      = parsed.type_piece  || 'autre';
            confiance      = parsed.confiance   || 70;
            identification = parsed;
            // Cas facile = confiance élevée pour économiser des appels
            casFacile = confiance >= 90 && typePiece !== 'autre';
          }
        } catch(eIdent) {
          console.warn('⚠️ PME-01 identification non bloquante:', eIdent.message);
          // Garder les valeurs par défaut
        }
      }
    }

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
    const exemplesFewShot = await getFewShotExemples(journal, pays, 2); // Max 2 exemples — économie tokens
    if (exemplesFewShot.length > 0) {
      promptJournal += buildFewShotBlock(exemplesFewShot);
    }

    const texteEtape2 = 'Type de pièce : ' + typePiece + ' | Journal : ' + journal + ' | Génère les écritures SYSCOHADA complètes. Réponds UNIQUEMENT en JSON.';

    const rawEtape2 = await appelClaude(
      promptJournal,
      buildUserContent(base64, mediaType, texteEtape2),
      1500,  // Réduit de 2000 à 1500 tokens
      3,
      MODELE_CODIFICATION  // Sonnet — tâche complexe
    );

    const codification = parseJSON(rawEtape2) || {};
    let ecritures = codification.ecritures || [];

    pipeline.push({ etape: 2, code: codePromptJournal, statut: 'ok', ecritures_count: ecritures.length });

    // ── ÉTAPE 2b : Détection tiers — substitution comptes génériques ──
    // let HORS du try pour que tiersDetectes soit accessible même si exception
    let tiersDetectes = [];
    try {
      const { data: tiersPME } = await supabase
        .from('tiers')
        .select('id, nom, type_tiers, racine_compte, compte_complet, aliases, nb_utilisations')
        .eq('company_id', piece.company_id)
        .eq('actif', true);

      if (tiersPME && tiersPME.length > 0 && ecritures.length > 0) {
        // Noms détectés dans le résumé et les libellés
        const textesAnalyse = [
          codification.resume || '',
          ...ecritures.map(e => e.libelle || ''),
        ].join(' ').toLowerCase();

        // Map racine → type pour savoir quel type de compte chercher
        const RACINE_TYPE = { '401': 'fournisseur', '411': 'client', '521': 'banque', '421': 'salarie' };

        for (const tiers of tiersPME) {
          const nomLower = tiers.nom.toLowerCase();
          const aliases  = (tiers.aliases || []).map(a => a.toLowerCase());
          const noms     = [nomLower, ...aliases];

          // Vérifier si ce tiers est mentionné dans les textes
          const trouve = noms.some(n => textesAnalyse.includes(n));
          if (!trouve) continue;

          const racine = tiers.racine_compte;

          // Remplacer le compte générique (racine + '000') par le compte spécifique
          let substitutions = 0;
          ecritures = ecritures.map(e => {
            const compteStr = String(e.compte || '');
            // Compte générique = racine exacte + '000' (ex: 401000)
            if (compteStr === racine + '000' || compteStr === racine) {
              substitutions++;
              return { ...e, compte: tiers.compte_complet, tiers_id: tiers.id, tiers_nom: tiers.nom };
            }
            return e;
          });

          if (substitutions > 0) {
            tiersDetectes.push({
              tiers_id:       tiers.id,
              nom:            tiers.nom,
              type:           tiers.type_tiers,
              compte_generique: racine + '000',
              compte_specifique: tiers.compte_complet,
              substitutions,
            });
            // Incrémenter nb_utilisations
            await supabase.from('tiers')
              .update({ nb_utilisations: (tiers.nb_utilisations || 0) + 1, derniere_utilisation: new Date().toISOString() })
              .eq('id', tiers.id);
            console.log('Tiers detecte : ' + tiers.nom + ' -> ' + tiers.compte_complet + ' (' + substitutions + ' substitution(s))');
          }
        }
      }
    } catch(eTiers) {
      console.warn('⚠️ Détection tiers non bloquante :', eTiers.message);
    }
    pipeline.push({ etape: '2b', code: 'TIERS', statut: 'ok', tiers_detectes: tiersDetectes.length, details: tiersDetectes });

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

        // PME-12 : utiliser les écritures déjà générées — pas besoin de re-envoyer le PDF
        const contexteTVA = JSON.stringify({
          ecritures: ecritures.slice(0, 8),
          type_piece: typePiece,
          journal,
          pays_client: pays,
          taux_tva: tva,
        });
        const rawTVA = await appelClaude(
          promptTVASubs,
          [{ type: 'text', text: 'Vérifie la TVA sur ces écritures SYSCOHADA :\n' + contexteTVA + '\nRéponds uniquement en JSON avec soumis_tva, tva_calculee, tva_deductible, alerte_ecart.' }],
          300,  // Réduit : réponse courte
          2,
          MODELE_TVA  // Haiku — calcul TVA simple
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

    {
    const promptScore = await getPrompt('PME-13', pays);
    if (!casFacile && promptScore && ecritures.length > 0) {
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
        [{ type: 'text', text: 'Attribue un score de confiance à cette écriture :\n' + (contexteScore) + '\nRéponds uniquement en JSON avec score, statut, raisons_penalite, action_requise.' }],
        150,  // Réduit : réponse score courte
        2,
        MODELE_SCORE  // Haiku — calcul score simple
      );

      const scoring = parseJSON(rawScore);
      if (scoring && typeof scoring.score === 'number') {
        scoreConfiance = Math.min(100, Math.max(0, scoring.score));
      }
      pipeline.push({ etape: 4, code: 'PME-13', statut: 'ok', score: scoreConfiance });
    }
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
        tiers_id:      e.tiers_id || null,
        status:        'generated',
      }));

      let insertResult = await supabase.from('ecritures').insert(lignes);
      
      // Si erreur avec tiers_id → réessayer sans (colonne peut ne pas exister)
      if (insertResult.error) {
        console.warn('⚠️ Insertion écritures erreur (tentative 1):', insertResult.error.message);
        // Retirer tiers_id et réessayer
        const lignesSansTiers = lignes.map(l => {
          const { tiers_id, ...rest } = l;
          return rest;
        });
        insertResult = await supabase.from('ecritures').insert(lignesSansTiers);
      }

      if (insertResult.error) {
        console.error('❌ Insertion écritures erreur finale:', insertResult.error.message);
        await supabase.from('pieces').update({ status: 'error' }).eq('id', pieceId);
        return res.status(500).json({ error: 'Erreur insertion écritures : ' + insertResult.error.message });
      }
    }

    // ── Classifier les alertes par destinataire ─────────────────
    // ADMIN : erreurs système (BDD, API, infrastructure)
    // PME   : erreurs métier (score faible, TVA, équilibre)
    // EXPERT: anomalies comptables à vérifier
    const alertesMetier = [];
    const alertesSystème = [];

    if (!equilibre) {
      alertesMetier.push({ code: 'DESEQUILIBRE', msg: 'Écritures déséquilibrées — vérification requise', destinataire: 'PME_EXPERT' });
    }
    if (alerteTVA) {
      alertesMetier.push({ code: 'ALERTE_TVA', msg: 'Écart TVA détecté — ' + (alerteTVA.alerte || ''), destinataire: 'PME_EXPERT' });
    }
    if (scoreConfiance < 70) {
      alertesMetier.push({ code: 'SCORE_FAIBLE', msg: 'Score de confiance faible (' + scoreConfiance + '%) — révision conseillée', destinataire: 'PME_EXPERT' });
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
        alerte_tva:       alerteTVA,
        score:            scoreConfiance,
        equilibre,
        alertes_metier:   alertesMetier,
        alertes_systeme:  alertesSystème,
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
        resume_ia:       codification.resume || identification.raison || null,
        montant_ttc:     codification.extraction?.montant_ttc || codification.montant_ttc || null,
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
      tiers_detectes,
      alertes_metier,
      few_shot_count:      exemplesFewShot.length,
      apprentissage_actif: exemplesFewShot.length > 0,
      prompts_utilises:    ['PME-01', codePromptJournal, 'PME-12', 'PME-13'].filter(Boolean),
    });

  } catch(err) {
    // Log détaillé pour debug
    console.error('❌ Pipeline erreur pièce', pieceId, ':');
    console.error('   Message:', err.message);
    if (err.response) {
      console.error('   Status API:', err.response.status);
      console.error('   Data API:', JSON.stringify(err.response.data).slice(0, 300));
    }
    console.error('   Pipeline étapes:', JSON.stringify(pipeline).slice(0, 500));
    try {
      await supabase.from('pieces').update({ status: 'error' }).eq('id', pieceId);
    } catch(e2) {}
    return res.status(500).json({ error: err.message, detail: err.response?.data || null, pipeline });
  }
}

// Enregistrer le handler comme route Express
router.post('/piece/:pieceId', traitementHandler);

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
      message:   'Pipeline lancé pour ' + (pieces.length) + ' pièce(s)',
      piece_ids: pieces.map(p => p.id),
      traites:   pieces.length,
    });

    // Traitement séquentiel en arrière-plan — appel direct (pas localhost qui échoue sur Render)
    setImmediate(async function() {
      for (const piece of pieces) {
        try {
          // Simuler req/res pour appeler le handler directement
          const fakeReq = { params: { pieceId: piece.id }, user: req.user };
          const fakeRes = {
            json: function(data) { console.log('✅ Pièce traitée (batch):', piece.id, data.success ? 'OK' : data.error); },
            status: function(code) { return { json: function(data) { console.warn('⚠️ Pièce ' + piece.id + ' status ' + code + ':', data.error); } }; },
          };
          await traitementHandler(fakeReq, fakeRes);
          await new Promise(r => setTimeout(r, 2000)); // 2s entre pièces
        } catch(e) {
          console.error('❌ Erreur batch pièce ' + piece.id + ':', e.message);
        }
      }
    });
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
