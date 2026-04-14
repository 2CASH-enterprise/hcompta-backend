// ============================================================
// H-Compta AI — Mariah IA Routes
// Assistante comptable propulsée par Claude
// Lit le prompt depuis la table prompts selon pays + scope
// ============================================================
const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const supabase = require('../config/supabase');

// Prompt système par défaut si table prompts vide
const SYSTEM_DEFAULT = `Tu es Mariah, l'assistante IA comptable de H-Compta AI.
Tu es experte en comptabilité SYSCOHADA, fiscalité OHADA, et en pratiques comptables de la zone OHADA.
Tu aides les PME africaines et leurs cabinets d'expertise comptable.

Tes domaines d'expertise :
- Plan comptable SYSCOHADA (OHADA)
- TVA et déclarations fiscales (CI, SN, CM et zone OHADA)
- Analyse de pièces comptables
- Rapprochements bancaires
- Clôtures mensuelles et annuelles
- Export vers Sage 100, Odoo, autres ERP
- Interprétation des écritures et soldes

Règles de réponse :
- Réponds en français, de façon claire et professionnelle
- Donne des conseils pratiques et actionnables
- Cite les comptes SYSCOHADA concernés quand pertinent
- Si tu n'es pas sûre, dis-le clairement
- Tu n'as pas accès aux données en temps réel de l'utilisateur sauf si fournies dans le contexte`;

// ----------------------------------------------------------------
// HELPER : Lire le prompt système depuis Supabase
// ----------------------------------------------------------------
async function getSystemPrompt(pays, scope) {
  try {
    const { data } = await supabase
      .from('prompts')
      .select('contenu')
      .eq('code', 'mariah_system')
      .in('pays', [pays || 'ALL', 'ALL'])
      .in('scope', [scope || 'pme', 'pme'])
      .eq('actif', true)
      .order('version', { ascending: false })
      .limit(1)
      .single();
    return data?.contenu || SYSTEM_DEFAULT;
  } catch(e) {
    return SYSTEM_DEFAULT;
  }
}

// ----------------------------------------------------------------
// ROUTE : POST /api/mariah
// Corps : { message, conversation_history?, company_id?, pays? }
// ----------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { message, conversation_history, company_id, pays, system_override } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message obligatoire' });
    }

    // Utiliser le system_override du frontend (contexte PME réel) ou fallback DB
    const systemPrompt = system_override || await getSystemPrompt(pays || 'CI', 'pme');

    // Construire l'historique de conversation
    // conversation_history = [{ role: 'user'|'assistant', content: '...' }]
    const history = Array.isArray(conversation_history)
      ? conversation_history.slice(-10) // garder les 10 derniers échanges max
      : [];

    const messages = [
      ...history,
      { role: 'user', content: message.trim() }
    ];

    // Appel Claude API
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-opus-4-6',
        max_tokens: 1500,
        system:     systemPrompt,
        messages,
      },
      {
        headers: {
          'x-api-key':         process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type':      'application/json',
        },
        timeout: 30000,
      }
    );

    const reponse = response.data?.content?.[0]?.text || '';

    // Logger dans prompt_logs si company_id fourni (non bloquant)
    if (company_id) {
      (async function() {
        try {
          await supabase.from('prompt_logs').insert([{
            prompt_code:    'mariah_chat',
            company_id,
            input_payload:  { message, history_length: history.length },
            output_payload: { reponse: reponse.substring(0, 500) },
          }]);
        } catch(e) {}
      })();
    }

    return res.json({
      success: true,
      reponse,
      role:    'assistant',
      model:   'claude-opus-4-6',
    });

  } catch(err) {
    // Erreur API Anthropic
    if (err.response?.status === 401) {
      return res.status(500).json({ error: 'Clé API Claude invalide. Vérifiez CLAUDE_API_KEY.' });
    }
    if (err.response?.status === 429) {
      return res.status(429).json({ error: 'Limite de requêtes atteinte. Réessayez dans quelques secondes.' });
    }
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
