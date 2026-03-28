// ============================================================
// H-Compta AI — TVA Routes complètes
// Calcul par période, génération déclaration, historique
// ============================================================
const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');

// Comptes TVA SYSCOHADA
const COMPTE_TVA_COLLECTEE  = '44571';
const COMPTE_TVA_DEDUCTIBLE = '44551';

// ----------------------------------------------------------------
// HELPER : Calculer TVA depuis écritures pour une période
// ----------------------------------------------------------------
async function calculerTVA(companyId, periode) {
  let query = supabase.from('ecritures').select('compte,debit,credit,date_ecriture').eq('company_id', companyId);
  if (periode) {
    // Filtrer par mois ex: "2026-03" → du 2026-03-01 au 2026-03-31
    const [year, month] = periode.split('-');
    const debut = `${year}-${month}-01`;
    const fin   = new Date(year, parseInt(month), 0).toISOString().slice(0, 10); // dernier jour du mois
    query = query.gte('date_ecriture', debut).lte('date_ecriture', fin);
  }
  const { data: ecritures, error } = await query;
  if (error) throw new Error(error.message);

  let tvaCollectee = 0, tvaDeductible = 0;
  for (const e of ecritures || []) {
    const c = String(e.compte || '');
    if (c.startsWith(COMPTE_TVA_COLLECTEE))  tvaCollectee  += Number(e.credit || 0) - Number(e.debit  || 0);
    if (c.startsWith(COMPTE_TVA_DEDUCTIBLE)) tvaDeductible += Number(e.debit  || 0) - Number(e.credit || 0);
  }
  return {
    tva_collectee:  Math.max(0, tvaCollectee),
    tva_deductible: Math.max(0, tvaDeductible),
    tva_nette:      Math.max(0, tvaCollectee - tvaDeductible),
    nb_ecritures:   (ecritures || []).length,
  };
}

// ----------------------------------------------------------------
// HELPER : Générer le HTML de la déclaration TVA
// ----------------------------------------------------------------
function genererHTMLDeclaration(company, tva, periode, moisLabel) {
  const fmt = n => Number(n || 0).toLocaleString('fr-FR') + ' FCFA';
  const now  = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Déclaration TVA — ${company.company_name} — ${moisLabel}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #1a1a1a; margin: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2E8269; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { font-size: 22px; font-weight: 900; color: #2E8269; }
  .brand small { display: block; font-size: 11px; font-weight: 400; color: #708180; }
  .title { font-size: 18px; font-weight: 700; margin-bottom: 24px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px; }
  .info-box { background: #F6F9F7; border: 1px solid #E3ECE8; border-radius: 8px; padding: 14px; }
  .info-label { font-size: 11px; color: #708180; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
  .info-val { font-size: 14px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #2E8269; color: white; padding: 10px 14px; text-align: left; font-size: 12px; }
  td { padding: 10px 14px; border-bottom: 1px solid #E3ECE8; }
  .amount { text-align: right; font-weight: 700; font-family: monospace; }
  .total-row { background: #E5F4EE; font-weight: 900; }
  .total-row td { border-bottom: 2px solid #2E8269; font-size: 15px; }
  .nette-row { background: #2E8269; color: white; }
  .nette-row td { font-size: 16px; font-weight: 900; }
  .footer { margin-top: 40px; font-size: 11px; color: #708180; border-top: 1px solid #E3ECE8; padding-top: 14px; display: flex; justify-content: space-between; }
  .stamp { border: 2px dashed #2E8269; border-radius: 8px; padding: 16px 24px; text-align: center; color: #2E8269; font-weight: 700; margin-top: 30px; }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="brand">H-Compta AI <small>Powered by SolutionH</small></div>
  </div>
  <div style="text-align:right">
    <div style="font-size:11px;color:#708180">Générée le ${now}</div>
    <div style="font-size:12px;font-weight:700">Zone OHADA · SYSCOHADA</div>
  </div>
</div>

<div class="title">📋 Déclaration de TVA — ${moisLabel}</div>

<div class="info-grid">
  <div class="info-box">
    <div class="info-label">Société</div>
    <div class="info-val">${company.company_name}</div>
  </div>
  <div class="info-box">
    <div class="info-label">Pays</div>
    <div class="info-val">${company.country} · TVA ${company.vat_rate}%</div>
  </div>
  <div class="info-box">
    <div class="info-label">RCCM</div>
    <div class="info-val">${company.rccm || '–'}</div>
  </div>
  <div class="info-box">
    <div class="info-label">Période de déclaration</div>
    <div class="info-val">${moisLabel}</div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Libellé</th>
      <th>Compte SYSCOHADA</th>
      <th class="amount" style="text-align:right">Montant (FCFA)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>TVA collectée sur ventes (compte 44571)</td>
      <td>44571</td>
      <td class="amount">${fmt(tva.tva_collectee)}</td>
    </tr>
    <tr>
      <td>TVA déductible sur achats (compte 44551)</td>
      <td>44551</td>
      <td class="amount">${fmt(tva.tva_deductible)}</td>
    </tr>
    <tr class="total-row">
      <td colspan="2">TVA nette à décaisser (44571 − 44551)</td>
      <td class="amount">${fmt(tva.tva_nette)}</td>
    </tr>
    <tr class="nette-row">
      <td colspan="2">💰 MONTANT À PAYER À L'ADMINISTRATION FISCALE</td>
      <td class="amount">${fmt(tva.tva_nette)}</td>
    </tr>
  </tbody>
</table>

<div style="font-size:12px;color:#708180;margin-bottom:24px">
  Calcul basé sur ${tva.nb_ecritures} écriture(s) comptable(s) enregistrée(s) pour la période.
</div>

<div class="stamp">
  Ce document a été généré automatiquement par H-Compta AI.<br>
  À faire viser et signer par votre expert-comptable avant dépôt.
</div>

<div class="footer">
  <span>H-Compta AI · SolutionH · Luxembourg & Abidjan</span>
  <span>bonjour@hcompta-ai.com</span>
</div>
</body>
</html>`;
}

// ----------------------------------------------------------------
// ROUTE : GET /api/tva/detail/:companyId
// TVA de la période courante (ou ?periode=2026-03)
// ----------------------------------------------------------------
router.get('/detail/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const periode = req.query.periode || new Date().toISOString().slice(0, 7);

    // Vérifier si une déclaration existe déjà
    const { data: existing } = await supabase
      .from('tva_reports')
      .select('*')
      .eq('company_id', companyId)
      .eq('period', periode)
      .single();

    if (existing) {
      return res.json({
        company_id:     companyId,
        tva_collectee:  existing.tva_collectee,
        tva_deductible: existing.tva_deductible,
        tva_nette:      existing.tva_nette,
        periode,
        from_report:    true,
        file_url:       existing.file_url,
        status:         existing.status,
      });
    }

    // Calculer depuis les écritures
    const tva = await calculerTVA(companyId, periode);
    const { data: company } = await supabase
      .from('companies')
      .select('vat_rate, country')
      .eq('id', companyId)
      .single();

    return res.json({
      company_id:     companyId,
      tva_collectee:  tva.tva_collectee,
      tva_deductible: tva.tva_deductible,
      tva_nette:      tva.tva_nette,
      nb_ecritures:   tva.nb_ecritures,
      taux:           company?.vat_rate || 18,
      pays:           company?.country || '',
      periode,
      from_report:    false,
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// ROUTE : POST /api/tva/generer/:companyId
// Calculer + sauvegarder + générer HTML de déclaration
// ----------------------------------------------------------------
router.post('/generer/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const periode = req.body.periode || new Date().toISOString().slice(0, 7);

    // Infos société
    const { data: company, error: cErr } = await supabase
      .from('companies')
      .select('company_name, country, vat_rate, rccm, email')
      .eq('id', companyId)
      .single();
    if (cErr || !company) return res.status(404).json({ error: 'Société introuvable' });

    // Calculer TVA
    const tva = await calculerTVA(companyId, periode);

    // Label du mois
    const [year, month] = periode.split('-');
    const moisLabel = new Date(parseInt(year), parseInt(month)-1, 1)
      .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const moisCapital = moisLabel.charAt(0).toUpperCase() + moisLabel.slice(1);

    // Générer le HTML de la déclaration
    const htmlDeclaration = genererHTMLDeclaration(company, tva, periode, moisCapital);

    // Encoder en base64 et uploader dans Supabase Storage (bucket "declarations")
    const fileName = `tva-${companyId}-${periode}.html`;
    const { error: uploadErr } = await supabase.storage
      .from('declarations')
      .upload(fileName, Buffer.from(htmlDeclaration, 'utf-8'), {
        contentType: 'text/html; charset=utf-8',
        upsert: true,
      });

    let fileUrl = null;
    if (!uploadErr) {
      const { data: urlData } = supabase.storage.from('declarations').getPublicUrl(fileName);
      fileUrl = urlData?.publicUrl || null;
    }

    // Sauvegarder dans tva_reports (upsert sur company_id+period)
    const { data: rapport, error: rErr } = await supabase
      .from('tva_reports')
      .upsert([{
        company_id:     companyId,
        period:         periode,
        tva_collectee:  tva.tva_collectee,
        tva_deductible: tva.tva_deductible,
        tva_nette:      tva.tva_nette,
        file_url:       fileUrl,
        status:         'generated',
        generated_at:   new Date().toISOString(),
      }], { onConflict: 'company_id,period' })
      .select()
      .single();

    if (rErr) return res.status(500).json({ error: rErr.message });

    return res.json({
      success:        true,
      periode,
      mois:           moisCapital,
      tva_collectee:  tva.tva_collectee,
      tva_deductible: tva.tva_deductible,
      tva_nette:      tva.tva_nette,
      nb_ecritures:   tva.nb_ecritures,
      file_url:       fileUrl,
      rapport,
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// ROUTE : GET /api/tva/historique/:companyId
// Liste de toutes les déclarations TVA d'une société
// ----------------------------------------------------------------
router.get('/historique/:companyId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tva_reports')
      .select('*')
      .eq('company_id', req.params.companyId)
      .order('period', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
