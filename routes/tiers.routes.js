// ============================================================
// H-Compta AI — Routes Tiers comptables
// CRUD tiers + détection intelligente pour le pipeline IA
// ============================================================
const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');

// Racines SYSCOHADA par type de tiers
const RACINES = {
  fournisseur: '401',
  client:      '411',
  banque:      '521',
  salarie:     '421',
};

// ── GET /api/tiers/:companyId ─────────────────────────────────
// Lister tous les tiers d'une PME (avec filtre type optionnel)
router.get('/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { type, search } = req.query;

    let query = supabase
      .from('tiers')
      .select('*')
      .eq('company_id', companyId)
      .eq('actif', true)
      .order('nb_utilisations', { ascending: false })
      .order('nom');

    if (type) query = query.eq('type_tiers', type);
    if (search) query = query.ilike('nom', `%${search}%`);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, tiers: data || [] });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/tiers/:companyId ────────────────────────────────
// Créer un nouveau tiers
router.post('/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { nom, type_tiers, suffixe_compte, telephone, email, adresse, rccm, notes, aliases } = req.body;

    if (!nom || !type_tiers) return res.status(400).json({ error: 'nom et type_tiers obligatoires' });
    if (!RACINES[type_tiers])  return res.status(400).json({ error: 'type_tiers invalide' });

    const racine = RACINES[type_tiers];

    // Si pas de suffixe fourni, calculer le prochain disponible
    let suffixe = suffixe_compte;
    if (!suffixe) {
      const { data: existing } = await supabase
        .from('tiers')
        .select('suffixe_compte')
        .eq('company_id', companyId)
        .eq('racine_compte', racine)
        .neq('suffixe_compte', '000')
        .order('suffixe_compte', { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        const dernierSuffixe = parseInt(existing[0].suffixe_compte, 10);
        suffixe = String(dernierSuffixe + 1).padStart(3, '0');
      } else {
        suffixe = '001';
      }
    }

    // Vérifier unicité
    const { data: exist } = await supabase
      .from('tiers')
      .select('id')
      .eq('company_id', companyId)
      .eq('racine_compte', racine)
      .eq('suffixe_compte', suffixe)
      .single();

    if (exist) return res.status(409).json({ error: `Le compte ${racine}${suffixe} existe déjà` });

    const { data, error } = await supabase
      .from('tiers')
      .insert([{
        company_id:     companyId,
        nom:            nom.trim(),
        type_tiers,
        racine_compte:  racine,
        suffixe_compte: suffixe,
        telephone:      telephone || null,
        email:          email?.toLowerCase() || null,
        adresse:        adresse || null,
        rccm:           rccm || null,
        notes:          notes || null,
        aliases:        aliases || [],
      }])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, tiers: data });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/tiers/:companyId/:tiersId ─────────────────────
// Modifier un tiers
router.patch('/:companyId/:tiersId', async (req, res) => {
  try {
    const { companyId, tiersId } = req.params;
    const updates = req.body;
    delete updates.id; delete updates.company_id;
    delete updates.racine_compte; delete updates.compte_complet;

    const { data, error } = await supabase
      .from('tiers')
      .update(updates)
      .eq('id', tiersId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, tiers: data });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/tiers/:companyId/:tiersId ────────────────────
// Désactiver un tiers (soft delete)
router.delete('/:companyId/:tiersId', async (req, res) => {
  try {
    const { companyId, tiersId } = req.params;
    const { error } = await supabase
      .from('tiers')
      .update({ actif: false })
      .eq('id', tiersId)
      .eq('company_id', companyId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/tiers/:companyId/detecter ──────────────────────
// Détecter un tiers à partir d'un nom (utilisé par le pipeline IA)
router.post('/:companyId/detecter', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { nom_detecte, type_tiers } = req.body;

    if (!nom_detecte) return res.status(400).json({ error: 'nom_detecte obligatoire' });

    // Chercher par nom exact ou alias
    const { data: tiers } = await supabase
      .from('tiers')
      .select('*')
      .eq('company_id', companyId)
      .eq('actif', true);

    if (tiers && tiers.length > 0) {
      const nomLower = nom_detecte.toLowerCase();

      // 1. Correspondance exacte sur le nom
      let trouve = tiers.find(t =>
        t.nom.toLowerCase() === nomLower
      );

      // 2. Correspondance partielle sur le nom
      if (!trouve) {
        trouve = tiers.find(t =>
          nomLower.includes(t.nom.toLowerCase()) ||
          t.nom.toLowerCase().includes(nomLower)
        );
      }

      // 3. Correspondance sur les aliases
      if (!trouve) {
        trouve = tiers.find(t =>
          (t.aliases || []).some(a =>
            a.toLowerCase() === nomLower ||
            nomLower.includes(a.toLowerCase()) ||
            a.toLowerCase().includes(nomLower)
          )
        );
      }

      if (trouve) {
        // Incrémenter nb_utilisations
        await supabase
          .from('tiers')
          .update({
            nb_utilisations: (trouve.nb_utilisations || 0) + 1,
            derniere_utilisation: new Date().toISOString()
          })
          .eq('id', trouve.id);

        return res.json({
          success:  true,
          trouve:   true,
          tiers:    trouve,
          compte:   trouve.compte_complet,
          message:  `Tiers reconnu : ${trouve.nom} → ${trouve.compte_complet}`,
        });
      }
    }

    // Tiers non trouvé — proposer le compte générique
    const racine  = RACINES[type_tiers] || '401';
    const compte  = racine + '000';

    return res.json({
      success:  true,
      trouve:   false,
      tiers:    null,
      compte:   compte,
      message:  `Tiers inconnu — compte générique ${compte} proposé`,
    });

  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tiers/:companyId/prochain-suffixe/:type ─────────
// Obtenir le prochain suffixe disponible pour un type
router.get('/:companyId/prochain-suffixe/:type', async (req, res) => {
  try {
    const { companyId, type } = req.params;
    const racine = RACINES[type];
    if (!racine) return res.status(400).json({ error: 'type invalide' });

    const { data } = await supabase
      .from('tiers')
      .select('suffixe_compte')
      .eq('company_id', companyId)
      .eq('racine_compte', racine)
      .neq('suffixe_compte', '000')
      .order('suffixe_compte', { ascending: false })
      .limit(1);

    let prochain = '001';
    if (data && data.length > 0) {
      prochain = String(parseInt(data[0].suffixe_compte, 10) + 1).padStart(3, '0');
    }

    return res.json({
      success: true,
      racine,
      prochain_suffixe: prochain,
      compte_suggere:   racine + prochain,
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
