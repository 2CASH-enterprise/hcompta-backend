// ============================================================
// H-Compta AI — Export Routes
// Formats exacts : Sage 100 Afrique & Odoo 16/17
// Avec traçabilité dans la table exports
// ============================================================
const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');

// ----------------------------------------------------------------
// HELPER : Récupérer les écritures avec filtre période optionnel
// ----------------------------------------------------------------
async function getEcritures(companyId, periode) {
  let query = supabase
    .from('ecritures')
    .select('id, journal, date_ecriture, compte, libelle, debit, credit, piece_id')
    .eq('company_id', companyId)
    .order('date_ecriture', { ascending: true })
    .order('journal',       { ascending: true });

  if (periode) {
    const [year, month] = periode.split('-');
    const debut = `${year}-${month}-01`;
    const fin   = new Date(year, parseInt(month), 0).toISOString().slice(0, 10);
    query = query.gte('date_ecriture', debut).lte('date_ecriture', fin);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

// ----------------------------------------------------------------
// HELPER : Tracer l'export dans la table exports
// ----------------------------------------------------------------
async function tracerExport(companyId, format, periode, userId) {
  try {
    await supabase.from('exports').insert([{
      company_id:  companyId,
      format,
      period:      periode || new Date().toISOString().slice(0, 7),
      file_url:    '',  // pas de fichier stocké — téléchargement direct
      status:      'generated',
      created_by:  userId || companyId, // fallback si pas d'userId
    }]);
  } catch(e) {
    // Non bloquant — si l'enregistrement échoue, l'export continue quand même
    console.warn('Traçabilité export échouée:', e.message);
  }
}

// ----------------------------------------------------------------
// HELPER : Échapper un champ CSV (guillemets si virgule ou guillemet)
// ----------------------------------------------------------------
function csvField(val, sep = ';') {
  const s = String(val === null || val === undefined ? '' : val);
  if (s.includes(sep) || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ----------------------------------------------------------------
// FORMAT SAGE 100 AFRIQUE
// En-tête : JO;DA;CO;LI;MT;SE;NU;EC;DC
// JO = Journal, DA = Date (JJMMAAAA), CO = Compte, LI = Libellé,
// MT = Montant, SE = Sens (D/C), NU = N° pièce, EC = Échéance, DC = Devise
// ----------------------------------------------------------------
function formatSage100(ecritures, companyId) {
  const header = 'JO;DA;CO;LI;MT;SE;NU;EC;DC';

  const lignes = ecritures.map((e, idx) => {
    // Formater la date en JJMMAAAA pour Sage
    const d      = e.date_ecriture ? e.date_ecriture.replace(/-/g, '') : '';
    const dateS  = d.length === 8 ? d.slice(6) + d.slice(4, 6) + d.slice(0, 4) : '';
    const sens   = Number(e.debit || 0) > 0 ? 'D' : 'C';
    const montant = Number(e.debit || 0) > 0 ? Number(e.debit) : Number(e.credit);
    const numPiece = `HC${String(idx + 1).padStart(5, '0')}`;
    return [
      csvField(e.journal  || 'OD', ';'),
      csvField(dateS,               ';'),
      csvField(e.compte   || '',    ';'),
      csvField((e.libelle || '').substring(0, 69), ';'), // Sage limite à 69 chars
      csvField(montant.toFixed(2),  ';'),
      csvField(sens,                ';'),
      csvField(numPiece,            ';'),
      csvField(dateS,               ';'), // Échéance = date écriture par défaut
      csvField('XOF',               ';'), // Devise FCFA zone OHADA
    ].join(';');
  });

  return [header, ...lignes].join('\r\n'); // Sage utilise CRLF
}

// ----------------------------------------------------------------
// FORMAT ODOO 16/17
// Colonnes : date;journal_id;account_id;partner_id;name;debit;credit;currency_id;move_type
// ----------------------------------------------------------------
function formatOdoo(ecritures) {
  const header = 'date,journal_id,account_id,partner_id,name,debit,credit,currency_id,move_type';

  const lignes = ecritures.map(e => {
    // Déduire le move_type depuis le journal
    const moveType = {
      VTE: 'out_invoice',
      ACH: 'in_invoice',
      BQ:  'entry',
      CAI: 'entry',
      OD:  'entry',
      SAL: 'entry',
    }[e.journal] || 'entry';

    return [
      csvField(e.date_ecriture || '', ','),
      csvField(e.journal       || '', ','),
      csvField(e.compte        || '', ','),
      csvField('',                    ','), // partner_id — à mapper manuellement si besoin
      csvField((e.libelle || '').substring(0, 100), ','),
      csvField(Number(e.debit  || 0).toFixed(2), ','),
      csvField(Number(e.credit || 0).toFixed(2), ','),
      csvField('XOF',                 ','), // ISO 4217 pour FCFA
      csvField(moveType,              ','),
    ].join(',');
  });

  return [header, ...lignes].join('\n');
}

// ----------------------------------------------------------------
// ROUTE : GET /api/export/sage/:companyId
// ?periode=2026-03  (optionnel, sinon tout l'historique)
// ?user_id=xxx      (pour la traçabilité)
// ----------------------------------------------------------------
router.get('/sage/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const periode  = req.query.periode  || null;
    const userId   = req.query.user_id  || null;

    const ecritures = await getEcritures(companyId, periode);

    if (!ecritures.length) {
      return res.status(404).json({ error: 'Aucune écriture trouvée pour cette période' });
    }

    const csv      = formatSage100(ecritures, companyId);
    const suffixe  = periode ? `-${periode}` : '';
    const filename = `export-sage100-${companyId}${suffixe}.csv`;

    // Tracer l'export dans la table exports
    await tracerExport(companyId, 'sage', periode, userId);

    res.setHeader('Content-Type',        'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count',      String(ecritures.length));
    return res.send('\uFEFF' + csv); // BOM UTF-8 pour Sage
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// ROUTE : GET /api/export/odoo/:companyId
// ?periode=2026-03  (optionnel)
// ----------------------------------------------------------------
router.get('/odoo/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const periode  = req.query.periode  || null;
    const userId   = req.query.user_id  || null;

    const ecritures = await getEcritures(companyId, periode);

    if (!ecritures.length) {
      return res.status(404).json({ error: 'Aucune écriture trouvée pour cette période' });
    }

    const csv      = formatOdoo(ecritures);
    const suffixe  = periode ? `-${periode}` : '';
    const filename = `export-odoo-${companyId}${suffixe}.csv`;

    await tracerExport(companyId, 'odoo', periode, userId);

    res.setHeader('Content-Type',        'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count',      String(ecritures.length));
    return res.send('\uFEFF' + csv); // BOM UTF-8
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// ROUTE : GET /api/export/historique/:companyId
// Liste de tous les exports effectués
// ----------------------------------------------------------------
router.get('/historique/:companyId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('exports')
      .select('id, format, period, status, created_at')
      .eq('company_id', req.params.companyId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// ROUTE : GET /api/export/apercu/:companyId
// Aperçu JSON des écritures (utile pour debug frontend)
// ----------------------------------------------------------------
router.get('/apercu/:companyId', async (req, res) => {
  try {
    const ecritures = await getEcritures(req.params.companyId, req.query.periode || null);
    const totalDebit  = ecritures.reduce((s, e) => s + Number(e.debit  || 0), 0);
    const totalCredit = ecritures.reduce((s, e) => s + Number(e.credit || 0), 0);
    return res.json({
      count:        ecritures.length,
      total_debit:  totalDebit,
      total_credit: totalCredit,
      equilibre:    Math.abs(totalDebit - totalCredit) < 1,
      ecritures:    ecritures.slice(0, 10), // preview des 10 premières
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
