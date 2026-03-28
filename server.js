const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const supabase = require('./config/supabase');

const app = express();
app.use(cors());
app.use(express.json());

// Routes existantes
app.use('/api/pieces', require('./routes/pieces.routes'));
app.use('/api/tva', require('./routes/tva.routes'));
app.use('/api/export', require('./routes/export.routes'));
app.use('/api/mariah', require('./routes/mariah.routes'));

// Test backend
app.get('/', (req, res) => {
  res.send('H-Compta AI backend is running 🚀');
});

// Stats PME
app.get('/stats/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;

    // 1) Nombre total de pièces
    const { count: totalFactures, error: piecesError } = await supabase
      .from('pieces')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId);

    if (piecesError) {
      return res.status(500).json({
        step: 'pieces_total',
        error: piecesError.message || JSON.stringify(piecesError),
      });
    }

    // 2) Nombre d'alertes / pièces en attente
    const { count: totalAlertes, error: alertesError } = await supabase
      .from('pieces')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .in('status', ['pending', 'a_verifier', 'error']);

    if (alertesError) {
      return res.status(500).json({
        step: 'pieces_alertes',
        error: alertesError.message || JSON.stringify(alertesError),
      });
    }

    // 3) Écritures TVA
    const { data: ecritures, error: ecrituresError } = await supabase
      .from('ecritures')
      .select('compte,debit,credit')
      .eq('company_id', companyId);

    if (ecrituresError) {
      return res.status(500).json({
        step: 'ecritures_tva',
        error: ecrituresError.message || JSON.stringify(ecrituresError),
      });
    }

    let tvaCollectee = 0;
    let tvaDeductible = 0;

    for (const e of ecritures || []) {
      const compte = String(e.compte || '');

      // TVA collectée
      if (compte.startsWith('44571')) {
        tvaCollectee += Number(e.credit || 0) - Number(e.debit || 0);
      }

      // TVA déductible
      if (compte.startsWith('44551')) {
        tvaDeductible += Number(e.debit || 0) - Number(e.credit || 0);
      }
    }

    const tva = Math.max(0, tvaCollectee - tvaDeductible);

    return res.json({
      company_id: companyId,
      total_factures: totalFactures || 0,
      alertes: totalAlertes || 0,
      tva,
    });
  } catch (error) {
    return res.status(500).json({
      step: 'global_catch',
      error: error.message || JSON.stringify(error),
    });
  }
});

app.get('/pieces/recent/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;

    const { data, error } = await supabase
      .from('pieces')
      .select('id, file_name, journal, score_confiance, status')
      .eq('company_id', companyId)
      .order('id', { ascending: false })
      .limit(5);

    if (error) {
      return res.status(500).json({
        step: 'pieces_recent',
        error: error.message || JSON.stringify(error),
      });
    }

    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({
      step: 'pieces_recent_catch',
      error: error.message || JSON.stringify(error),
    });
  }
});
// Toutes les pièces d'une société (sans limite)
app.get('/pieces/all/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { data, error } = await supabase
      .from('pieces')
      .select('id, file_name, journal, score_confiance, status')
      .eq('company_id', companyId)
      .order('id', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// TVA détaillée : collectée + déductible séparément
app.get('/tva/detail/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { data: ecritures, error } = await supabase
      .from('ecritures')
      .select('compte, debit, credit')
      .eq('company_id', companyId);

    if (error) return res.status(500).json({ error: error.message });

    let tvaCollectee = 0;
    let tvaDeductible = 0;

    for (const e of ecritures || []) {
      const compte = String(e.compte || '');
      if (compte.startsWith('44571')) {
        tvaCollectee += Number(e.credit || 0) - Number(e.debit || 0);
      }
      if (compte.startsWith('44551')) {
        tvaDeductible += Number(e.debit || 0) - Number(e.credit || 0);
      }
    }

    const tvaNette = Math.max(0, tvaCollectee - tvaDeductible);

    return res.json({
      company_id: companyId,
      tva_collectee: Math.max(0, tvaCollectee),
      tva_deductible: Math.max(0, tvaDeductible),
      tva_nette: tvaNette,
      taux: 18,
      periode: new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Reporting : synthèse financière depuis les écritures
app.get('/reporting/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { data: ecritures, error } = await supabase
      .from('ecritures')
      .select('compte, debit, credit')
      .eq('company_id', companyId);

    if (error) return res.status(500).json({ error: error.message });

    let ca = 0;
    let charges = 0;

    for (const e of ecritures || []) {
      const compte = String(e.compte || '');
      // Comptes de ventes (7xxx)
      if (compte.startsWith('7')) {
        ca += Number(e.credit || 0) - Number(e.debit || 0);
      }
      // Comptes de charges (6xxx)
      if (compte.startsWith('6')) {
        charges += Number(e.debit || 0) - Number(e.credit || 0);
      }
    }

    const resultat = ca - charges;
    const tauxMarge = ca > 0 ? Math.round((resultat / ca) * 100) : 0;

    return res.json({
      company_id: companyId,
      ca: Math.max(0, ca),
      charges: Math.max(0, charges),
      resultat,
      taux_marge: tauxMarge
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Utilisateurs d'une société
app.get('/utilisateurs/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { data, error } = await supabase
      .from('company_users')
      .select('*')
      .eq('company_id', companyId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Export Sage — fichier CSV téléchargeable
app.get('/api/export/sage/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { data, error } = await supabase
      .from('ecritures')
      .select('*')
      .eq('company_id', companyId);

    if (error) return res.status(500).json({ error: error.message });

    // Génération CSV compatible Sage
    const lignes = (data || []).map(e =>
      [e.compte || '', e.libelle || '', e.debit || 0, e.credit || 0].join(';')
    );
    const csv = ['Compte;Libelle;Debit;Credit', ...lignes].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="export-sage-${companyId}.csv"`);
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Export Odoo — fichier CSV téléchargeable
app.get('/api/export/odoo/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { data, error } = await supabase
      .from('ecritures')
      .select('*')
      .eq('company_id', companyId);

    if (error) return res.status(500).json({ error: error.message });

    // Génération CSV compatible Odoo
    const lignes = (data || []).map(e =>
      [e.compte || '', e.libelle || '', e.debit || 0, e.credit || 0, 'FCFA'].join(',')
    );
    const csv = ['account_code,name,debit,credit,currency', ...lignes].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="export-odoo-${companyId}.csv"`);
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/pieces/upload', upload.single('file'), async (req, res) => {
  try {
    const { company_id } = req.body;
    const file = req.file;

    if (!company_id || !file) {
      return res.status(400).json({
        step: 'pieces_upload_validation',
        error: 'company_id et file sont obligatoires',
      });
    }

    const fileName = file.originalname;

    console.log("UPLOAD DEBUG", {
      company_id,
      uploaded_by: '1d085e85-dfe2-46db-82d2-b7a57b7afc2a',
      fileName
    });

    const { data, error } = await supabase
      .from('pieces')
      .insert([
        {
          company_id,
          uploaded_by: '1d085e85-dfe2-46db-82d2-b7a57b7afc2a',
          file_name: fileName,
          journal: 'ACH',
          score_confiance: 0,
          status: 'pending',
        }
      ])
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      message: 'Upload réussi',
      piece: data[0]
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
});
// ============================================================
// ROUTES CABINET / EXPERT COMPTABLE
// ============================================================

// KPIs globaux du cabinet
app.get('/cabinet/stats/:cabinetId', async (req, res) => {
  try {
    const { cabinetId } = req.params;

    // Nombre de PME dans le portefeuille
    const { count: totalClients, error: clientsError } = await supabase
      .from('company_users')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', cabinetId);

    // Toutes les pièces en anomalie (tous les clients du cabinet)
    const { data: companyList } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', cabinetId);

    const companyIds = (companyList || []).map(c => c.company_id);

    let totalAnomalies = 0;
    let totalEcritures = 0;
    let totalPieces = 0;
    let scoreTotal = 0;
    let scoreCount = 0;

    if (companyIds.length > 0) {
      // Anomalies : pièces en erreur ou a_verifier sur tous les clients
      const { count: anomalies } = await supabase
        .from('pieces')
        .select('*', { count: 'exact', head: true })
        .in('company_id', companyIds)
        .in('status', ['pending', 'a_verifier', 'error']);

      totalAnomalies = anomalies || 0;

      // Écritures à valider
      const { count: ecritures } = await supabase
        .from('ecritures')
        .select('*', { count: 'exact', head: true })
        .in('company_id', companyIds);

      totalEcritures = ecritures || 0;

      // Score moyen : basé sur score_confiance des pièces traitées
      const { data: pieces } = await supabase
        .from('pieces')
        .select('score_confiance')
        .in('company_id', companyIds)
        .eq('status', 'processed');

      for (const p of pieces || []) {
        if (p.score_confiance != null) {
          scoreTotal += Number(p.score_confiance);
          scoreCount++;
        }
      }

      totalPieces = (pieces || []).length;
    }

    const scoreMoyen = scoreCount > 0 ? Math.round(scoreTotal / scoreCount) : 0;

    return res.json({
      cabinet_id: cabinetId,
      total_clients: clientsError ? 0 : (totalClients || 0),
      total_anomalies: totalAnomalies,
      ecritures_a_valider: totalEcritures,
      score_moyen: scoreMoyen,
      company_ids: companyIds
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Liste des PME du portefeuille cabinet
app.get('/cabinet/clients/:cabinetId', async (req, res) => {
  try {
    const { cabinetId } = req.params;

    // Récupérer les sociétés liées à ce cabinet
    const { data: links, error: linksError } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', cabinetId);

    if (linksError) return res.status(500).json({ error: linksError.message });

    const companyIds = (links || []).map(c => c.company_id);

    if (companyIds.length === 0) {
      // Fallback : retourner la société de test
      companyIds.push('7098c39b-9961-4344-8bf1-f37919b35fd3');
    }

    // Pour chaque société, récupérer les stats
    const clients = [];
    for (const cid of companyIds) {
      const { count: alertes } = await supabase
        .from('pieces')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', cid)
        .in('status', ['pending', 'a_verifier', 'error']);

      const { data: pieces } = await supabase
        .from('pieces')
        .select('score_confiance')
        .eq('company_id', cid)
        .eq('status', 'processed');

      let score = 0;
      const scores = (pieces || []).filter(p => p.score_confiance != null);
      if (scores.length > 0) {
        score = Math.round(scores.reduce((s, p) => s + Number(p.score_confiance), 0) / scores.length);
      }

      // TVA
      const { data: ecritures } = await supabase
        .from('ecritures')
        .select('compte, debit, credit')
        .eq('company_id', cid);

      let tvaCollectee = 0;
      let tvaDeductible = 0;
      for (const e of ecritures || []) {
        const compte = String(e.compte || '');
        if (compte.startsWith('44571')) tvaCollectee += Number(e.credit || 0) - Number(e.debit || 0);
        if (compte.startsWith('44551')) tvaDeductible += Number(e.debit || 0) - Number(e.credit || 0);
      }
      const tva = Math.max(0, tvaCollectee - tvaDeductible);

      clients.push({
        company_id: cid,
        nom: 'PME ' + cid.substring(0, 8),
        pays: 'CI',
        score,
        alertes: alertes || 0,
        tva
      });
    }

    return res.json(clients);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Anomalies du portefeuille cabinet
app.get('/cabinet/anomalies/:cabinetId', async (req, res) => {
  try {
    const { cabinetId } = req.params;

    const { data: links } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', cabinetId);

    const companyIds = (links || []).map(c => c.company_id);
    if (companyIds.length === 0) companyIds.push('7098c39b-9961-4344-8bf1-f37919b35fd3');

    const { data, error } = await supabase
      .from('pieces')
      .select('id, file_name, journal, score_confiance, status, company_id')
      .in('company_id', companyIds)
      .in('status', ['pending', 'a_verifier', 'error'])
      .order('id', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Écritures à valider pour le cabinet
app.get('/cabinet/ecritures/:cabinetId', async (req, res) => {
  try {
    const { cabinetId } = req.params;

    const { data: links } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', cabinetId);

    const companyIds = (links || []).map(c => c.company_id);
    if (companyIds.length === 0) companyIds.push('7098c39b-9961-4344-8bf1-f37919b35fd3');

    const { data, error } = await supabase
      .from('ecritures')
      .select('*')
      .in('company_id', companyIds)
      .order('id', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Invitations reçues par le cabinet
app.get('/cabinet/invitations/:cabinetId', async (req, res) => {
  try {
    const { cabinetId } = req.params;

    const { data, error } = await supabase
      .from('company_users')
      .select('*')
      .eq('user_id', cabinetId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Stats d'une PME spécifique (pour le cabinet qui ouvre un dossier)
app.get('/cabinet/pme/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;

    const { data: pieces, error } = await supabase
      .from('pieces')
      .select('id, file_name, journal, score_confiance, status')
      .eq('company_id', companyId)
      .order('id', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const total = pieces.length;
    const alertes = pieces.filter(p => ['pending','a_verifier','error'].includes(p.status)).length;
    const traites = pieces.filter(p => p.status === 'processed');
    const score = traites.length > 0
      ? Math.round(traites.reduce((s, p) => s + Number(p.score_confiance || 0), 0) / traites.length)
      : 0;

    const { data: ecritures } = await supabase
      .from('ecritures')
      .select('compte, debit, credit')
      .eq('company_id', companyId);

    let tvaCollectee = 0, tvaDeductible = 0;
    for (const e of ecritures || []) {
      const compte = String(e.compte || '');
      if (compte.startsWith('44571')) tvaCollectee += Number(e.credit || 0) - Number(e.debit || 0);
      if (compte.startsWith('44551')) tvaDeductible += Number(e.debit || 0) - Number(e.credit || 0);
    }

    return res.json({
      company_id: companyId,
      total_pieces: total,
      alertes,
      score_moyen: score,
      tva_nette: Math.max(0, tvaCollectee - tvaDeductible),
      pieces
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`H-Compta AI Backend running on port ${PORT}`);
});
