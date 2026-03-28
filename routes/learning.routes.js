// ============================================================
// H-Compta AI — Machine Learning Niveau 1
// Apprentissage par feedback du cabinet expert
// Principe : few-shot learning via exemples validés réels
// ============================================================
const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');

// ----------------------------------------------------------------
// ROUTE 1 : POST /api/learning/valider/:ecritureId
// Le cabinet valide une écriture → on l'enregistre comme exemple
// ----------------------------------------------------------------
router.post('/valider/:ecritureId', async (req, res) => {
  try {
    const { ecritureId } = req.params;
    const { validated_by, commentaire } = req.body;

    // 1) Récupérer l'écriture avec sa pièce associée
    const { data: ecriture, error: e1 } = await supabase
      .from('ecritures')
      .select('*, pieces(id, file_name, type_piece, company_id, companies(country, vat_rate))')
      .eq('id', ecritureId)
      .single();

    if (e1 || !ecriture) return res.status(404).json({ error: 'Écriture introuvable' });

    const company  = ecriture.pieces?.companies || {};
    const pieceId  = ecriture.pieces?.id;
    const typePiece = ecriture.pieces?.type_piece || 'autre';

    // 2) Marquer l'écriture comme validée
    await supabase
      .from('ecritures')
      .update({ status: 'validated' })
      .eq('id', ecritureId);

    // 3) Récupérer toutes les écritures de la même pièce
    //    pour construire l'exemple complet
    const { data: toutesEcritures } = await supabase
      .from('ecritures')
      .select('compte, libelle, debit, credit, journal')
      .eq('piece_id', pieceId)
      .order('debit', { ascending: false });

    // 4) Construire l'exemple few-shot à sauvegarder
    const exemple = {
      type_piece:  typePiece,
      journal:     ecriture.journal,
      pays:        company.country || 'CI',
      taux_tva:    company.vat_rate || 18,
      ecritures:   toutesEcritures || [],
      valide_par:  validated_by || 'expert',
      commentaire: commentaire || null,
      validated_at: new Date().toISOString(),
    };

    // 5) Sauvegarder dans prompt_logs comme exemple validé
    await supabase.from('prompt_logs').insert([{
      prompt_code:    'exemple_valide',
      company_id:     ecriture.pieces?.company_id,
      input_payload:  {
        piece_id:    pieceId,
        file_name:   ecriture.pieces?.file_name,
        type_piece:  typePiece,
        journal:     ecriture.journal,
      },
      output_payload: exemple,
      score:          100, // Score parfait = validé par expert
    }]);

    // 6) Mettre aussi à jour le score de la pièce si nécessaire
    if (pieceId) {
      await supabase
        .from('pieces')
        .update({ score_confiance: 100, status: 'processed' })
        .eq('id', pieceId);
    }

    return res.json({
      success:     true,
      message:     'Écriture validée et enregistrée comme exemple d\'apprentissage',
      ecriture_id: ecritureId,
      exemple_sauvegarde: true,
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// ROUTE 2 : POST /api/learning/corriger/:pieceId
// Le cabinet corrige les écritures d'une pièce entière
// → remplace les écritures générées par les écritures corrigées
// ----------------------------------------------------------------
router.post('/corriger/:pieceId', async (req, res) => {
  try {
    const { pieceId } = req.params;
    const { ecritures_corrigees, validated_by, commentaire } = req.body;

    if (!ecritures_corrigees || !ecritures_corrigees.length) {
      return res.status(400).json({ error: 'ecritures_corrigees obligatoire' });
    }

    // 1) Supprimer les anciennes écritures générées par IA
    await supabase
      .from('ecritures')
      .delete()
      .eq('piece_id', pieceId)
      .eq('status', 'generated');

    // 2) Récupérer les infos de la pièce
    const { data: piece } = await supabase
      .from('pieces')
      .select('*, companies(country, vat_rate)')
      .eq('id', pieceId)
      .single();

    const company = piece?.companies || {};

    // 3) Insérer les écritures corrigées avec status 'validated'
    const lignes = ecritures_corrigees.map(e => ({
      company_id:    piece.company_id,
      piece_id:      pieceId,
      journal:       e.journal || piece.journal || 'OD',
      date_ecriture: e.date_ecriture || new Date().toISOString().slice(0, 10),
      compte:        String(e.compte || ''),
      libelle:       String(e.libelle || ''),
      debit:         Math.max(0, Number(e.debit  || 0)),
      credit:        Math.max(0, Number(e.credit || 0)),
      status:        'validated',
    }));

    const { error: insertErr } = await supabase
      .from('ecritures')
      .insert(lignes);

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    // 4) Mettre à jour la pièce
    await supabase
      .from('pieces')
      .update({ status: 'processed', score_confiance: 100 })
      .eq('id', pieceId);

    // 5) Sauvegarder la correction comme exemple d'apprentissage
    const exemple = {
      type_piece:   piece.type_piece || 'autre',
      journal:      piece.journal || 'OD',
      pays:         company.country || 'CI',
      taux_tva:     company.vat_rate || 18,
      ecritures:    ecritures_corrigees,
      correction:   true, // Marqué comme correction humaine
      valide_par:   validated_by || 'expert',
      commentaire:  commentaire || null,
      validated_at: new Date().toISOString(),
    };

    await supabase.from('prompt_logs').insert([{
      prompt_code:    'exemple_valide',
      company_id:     piece.company_id,
      input_payload:  {
        piece_id:   pieceId,
        file_name:  piece.file_name,
        type_piece: piece.type_piece,
        correction: true,
      },
      output_payload: exemple,
      score:          100,
    }]);

    return res.json({
      success:           true,
      message:           'Écritures corrigées et enregistrées comme exemple d\'apprentissage',
      piece_id:          pieceId,
      ecritures_count:   lignes.length,
      exemple_sauvegarde: true,
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// ROUTE 3 : GET /api/learning/exemples/:pays/:journal
// Récupérer les N derniers exemples validés pour un journal/pays
// → Utilisé par traitement.routes.js pour le few-shot
// ----------------------------------------------------------------
router.get('/exemples/:pays/:journal', async (req, res) => {
  try {
    const { pays, journal } = req.params;
    const limit = parseInt(req.query.limit) || 3;

    const { data, error } = await supabase
      .from('prompt_logs')
      .select('output_payload, created_at, score')
      .eq('prompt_code', 'exemple_valide')
      .eq('score', 100)
      .order('created_at', { ascending: false })
      .limit(limit * 3); // Chercher plus pour filtrer ensuite

    if (error) return res.status(500).json({ error: error.message });

    // Filtrer par pays et journal
    const exemples = (data || [])
      .filter(row => {
        const p = row.output_payload || {};
        return (p.pays === pays || p.pays === 'ALL') && p.journal === journal;
      })
      .slice(0, limit)
      .map(row => row.output_payload);

    return res.json({ exemples, count: exemples.length });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// ROUTE 4 : GET /api/learning/stats/:companyId
// Statistiques d'apprentissage d'une société
// ----------------------------------------------------------------
router.get('/stats/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;

    // Total exemples validés pour cette société
    const { count: totalExemples } = await supabase
      .from('prompt_logs')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('prompt_code', 'exemple_valide');

    // Total pièces traitées
    const { count: totalTraitees } = await supabase
      .from('pieces')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('status', 'processed');

    // Score moyen des pièces traitées
    const { data: scores } = await supabase
      .from('pieces')
      .select('score_confiance')
      .eq('company_id', companyId)
      .eq('status', 'processed')
      .not('score_confiance', 'is', null);

    const scoreMoyen = scores && scores.length > 0
      ? Math.round(scores.reduce((s, p) => s + Number(p.score_confiance), 0) / scores.length)
      : 0;

    // Corrections effectuées (exemples marqués correction=true)
    const { count: corrections } = await supabase
      .from('prompt_logs')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('prompt_code', 'exemple_valide')
      .filter('input_payload->correction', 'eq', 'true');

    return res.json({
      company_id:       companyId,
      total_exemples:   totalExemples || 0,
      total_traitees:   totalTraitees || 0,
      score_moyen:      scoreMoyen,
      corrections:      corrections || 0,
      taux_validation:  totalTraitees > 0
        ? Math.round(((totalExemples || 0) / totalTraitees) * 100)
        : 0,
      message: totalExemples >= 10
        ? '🚀 Apprentissage actif — le système s\'améliore à chaque validation'
        : `📈 ${totalExemples || 0}/10 exemples — l'IA s'améliore dès 10 validations`,
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
