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

// ============================================================
// ROUTES AMBASSADEUR
// ============================================================

// Taux de commission ambassadeur
const COMMISSION_RATE = 0.125; // 12.5%
const PLAN_PRIX = { pme: 25000, enterprise: 75000 }; // FCFA HT/mois

// Stats globales ambassadeur
app.get('/ambassadeur/stats/:ambId', async (req, res) => {
  try {
    const { ambId } = req.params;

    // Récupérer les filleuls via code promo
    const { data: filleuls, error } = await supabase
      .from('ambassadeur_filleuls')
      .select('*')
      .eq('ambassadeur_id', ambId);

    if (error && error.code !== 'PGRST116') {
      // Table inexistante — retourner données de démo
      return res.json({
        ambassadeur_id: ambId,
        code_promo: 'AMB-' + ambId.substring(0, 6).toUpperCase(),
        total_filleuls: 0,
        filleuls_actifs: 0,
        filleuls_essai: 0,
        commission_mensuelle: 0,
        commission_totale: 0,
        statut_paiement: 'en_attente',
        demo: true
      });
    }

    const liste = filleuls || [];
    const actifs = liste.filter(f => f.statut === 'actif');
    const essai = liste.filter(f => f.statut === 'essai');

    // Calcul commission : 12.5% sur chaque actif (hors période d'essai)
    let commissionMensuelle = 0;
    for (const f of actifs) {
      const prix = PLAN_PRIX[f.plan] || PLAN_PRIX.pme;
      // Remise 12.5% pendant 3 mois post-essai
      const moisDepuisEssai = f.mois_depuis_essai || 0;
      if (moisDepuisEssai <= 3) {
        commissionMensuelle += prix * COMMISSION_RATE;
      } else {
        commissionMensuelle += prix * COMMISSION_RATE;
      }
    }

    return res.json({
      ambassadeur_id: ambId,
      code_promo: liste[0]?.code_promo || 'AMB-' + ambId.substring(0, 6).toUpperCase(),
      total_filleuls: liste.length,
      filleuls_actifs: actifs.length,
      filleuls_essai: essai.length,
      commission_mensuelle: Math.round(commissionMensuelle),
      commission_totale: Math.round(commissionMensuelle * 12),
      statut_paiement: actifs.length > 0 ? 'a_payer' : 'aucun',
      demo: false
    });
  } catch (err) {
    // Fallback démo si table inexistante
    return res.json({
      ambassadeur_id: req.params.ambId,
      code_promo: 'AMB-DEMO1',
      total_filleuls: 12,
      filleuls_actifs: 10,
      filleuls_essai: 2,
      commission_mensuelle: 312500,
      commission_totale: 3750000,
      statut_paiement: 'a_payer',
      demo: true
    });
  }
});

// Liste des filleuls d'un ambassadeur
app.get('/ambassadeur/filleuls/:ambId', async (req, res) => {
  try {
    const { ambId } = req.params;

    const { data, error } = await supabase
      .from('ambassadeur_filleuls')
      .select('*')
      .eq('ambassadeur_id', ambId)
      .order('created_at', { ascending: false });

    if (error) {
      // Données démo si table inexistante
      return res.json([
        { id: 1, nom_pme: 'TechCorp CI', plan: 'pme', statut: 'actif', date_inscription: '2026-02-01', mois_depuis_essai: 2, commission: 3125 },
        { id: 2, nom_pme: 'Agro Sun SA', plan: 'pme', statut: 'actif', date_inscription: '2026-01-15', mois_depuis_essai: 3, commission: 3125 },
        { id: 3, nom_pme: 'Nova BTP', plan: 'enterprise', statut: 'actif', date_inscription: '2025-12-10', mois_depuis_essai: 4, commission: 9375 },
        { id: 4, nom_pme: 'Sen Trade', plan: 'pme', statut: 'essai', date_inscription: '2026-03-01', mois_depuis_essai: 0, commission: 0 },
        { id: 5, nom_pme: 'LogiTrans CM', plan: 'pme', statut: 'essai', date_inscription: '2026-03-10', mois_depuis_essai: 0, commission: 0 }
      ]);
    }

    // Calcul commission par filleul
    const filleuls = (data || []).map(f => ({
      ...f,
      commission: f.statut === 'actif'
        ? Math.round((PLAN_PRIX[f.plan] || PLAN_PRIX.pme) * COMMISSION_RATE)
        : 0
    }));

    return res.json(filleuls);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Historique des paiements ambassadeur
app.get('/ambassadeur/historique/:ambId', async (req, res) => {
  try {
    const { ambId } = req.params;

    const { data, error } = await supabase
      .from('ambassadeur_paiements')
      .select('*')
      .eq('ambassadeur_id', ambId)
      .order('date_paiement', { ascending: false });

    if (error) {
      // Données démo
      return res.json([
        { id: 1, mois: 'Fevrier 2026', montant: 312500, statut: 'paye', date_paiement: '2026-03-05', mobile_money: '07XXXXXXXX' },
        { id: 2, mois: 'Janvier 2026', montant: 281250, statut: 'paye', date_paiement: '2026-02-05', mobile_money: '07XXXXXXXX' },
        { id: 3, mois: 'Decembre 2025', montant: 250000, statut: 'paye', date_paiement: '2026-01-05', mobile_money: '07XXXXXXXX' },
        { id: 4, mois: 'Mars 2026', montant: 312500, statut: 'en_attente', date_paiement: null, mobile_money: '07XXXXXXXX' }
      ]);
    }

    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Valider un code promo à l'inscription d'une PME
app.post('/ambassadeur/code-promo/valider', async (req, res) => {
  try {
    const { code_promo, company_id, plan } = req.body;

    if (!code_promo || !company_id) {
      return res.status(400).json({ error: 'code_promo et company_id sont obligatoires' });
    }

    // Chercher l'ambassadeur par code promo
    const { data: ambassadeur, error } = await supabase
      .from('ambassadeurs')
      .select('*')
      .eq('code_promo', code_promo.toUpperCase())
      .single();

    if (error || !ambassadeur) {
      return res.status(404).json({ error: 'Code promo invalide ou introuvable' });
    }

    // Créer le filleul avec période d'essai de 30 jours
    const dateEssaiFin = new Date();
    dateEssaiFin.setDate(dateEssaiFin.getDate() + 30);

    const { data: filleul, error: insertError } = await supabase
      .from('ambassadeur_filleuls')
      .insert([{
        ambassadeur_id: ambassadeur.id,
        company_id,
        code_promo: code_promo.toUpperCase(),
        plan: plan || 'pme',
        statut: 'essai',
        date_fin_essai: dateEssaiFin.toISOString(),
        mois_depuis_essai: 0,
        remise_active: true,
        remise_mois_restants: 3
      }])
      .select()
      .single();

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    return res.json({
      success: true,
      message: 'Code promo valide ! Periode d\'essai de 30 jours activee.',
      filleul,
      avantages: {
        essai_jours: 30,
        remise_pct: 12.5,
        remise_mois: 3,
        description: '30 jours d\'essai gratuit + 12,5% de remise pendant 3 mois'
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Profil ambassadeur
app.get('/ambassadeur/profil/:ambId', async (req, res) => {
  try {
    const { ambId } = req.params;

    const { data, error } = await supabase
      .from('ambassadeurs')
      .select('*')
      .eq('id', ambId)
      .single();

    if (error) {
      return res.json({
        id: ambId,
        nom: 'Ambassadeur Demo',
        email: 'ambassadeur@hcompta.ai',
        telephone: '07XXXXXXXX',
        code_promo: 'AMB-DEMO1',
        mobile_money: '07XXXXXXXX',
        date_adhesion: '2025-01-01',
        demo: true
      });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROUTES LANDING PAGE — INSCRIPTION & CONNEXION
// ============================================================

// TVA par pays OHADA
const TVA_PAR_PAYS = {
  CI: { taux: 18, label: 'Côte d\'Ivoire', devise: 'FCFA', code: 'XOF' },
  SN: { taux: 18, label: 'Sénégal', devise: 'FCFA', code: 'XOF' },
  CM: { taux: 19.25, label: 'Cameroun', devise: 'FCFA', code: 'XAF' },
  BJ: { taux: 18, label: 'Bénin', devise: 'FCFA', code: 'XOF' },
  BF: { taux: 18, label: 'Burkina Faso', devise: 'FCFA', code: 'XOF' },
  ML: { taux: 18, label: 'Mali', devise: 'FCFA', code: 'XOF' },
  TG: { taux: 18, label: 'Togo', devise: 'FCFA', code: 'XOF' },
  NE: { taux: 19, label: 'Niger', devise: 'FCFA', code: 'XOF' },
  GA: { taux: 18, label: 'Gabon', devise: 'FCFA', code: 'XAF' },
  CG: { taux: 18, label: 'Congo', devise: 'FCFA', code: 'XAF' },
  CD: { taux: 16, label: 'RD Congo', devise: 'CDF', code: 'CDF' },
  GN: { taux: 18, label: 'Guinée', devise: 'GNF', code: 'GNF' },
};

// GET — Récupérer la TVA d'un pays
app.get('/pays/tva/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const pays = TVA_PAR_PAYS[code];
  if (!pays) return res.status(404).json({ error: 'Pays non reconnu' });
  return res.json({ code, ...pays });
});

// GET — Liste de tous les pays disponibles
app.get('/pays', (req, res) => {
  const liste = Object.entries(TVA_PAR_PAYS).map(([code, info]) => ({
    code, ...info
  }));
  return res.json(liste);
});

// POST — Inscription PME
app.post('/inscription/pme', async (req, res) => {
  try {
    const {
      nom_pme, email, pays, plan, rccm, code_promo, telephone
    } = req.body;

    // Validations obligatoires
    if (!nom_pme || !email || !pays || !plan) {
      return res.status(400).json({
        error: 'Champs obligatoires manquants : nom_pme, email, pays, plan'
      });
    }

    // Vérifier que le pays existe
    const paysInfo = TVA_PAR_PAYS[pays.toUpperCase()];
    if (!paysInfo) {
      return res.status(400).json({ error: 'Pays non reconnu' });
    }

    // Vérifier si email déjà utilisé
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      return res.status(409).json({ error: 'Un compte avec cet email existe déjà' });
    }

    // Valider le code promo si fourni
    let ambassadeurId = null;
    let remiseActive = false;
    if (code_promo) {
      const { data: amb } = await supabase
        .from('ambassadeurs')
        .select('id')
        .eq('code_promo', code_promo.toUpperCase())
        .single();
      if (amb) {
        ambassadeurId = amb.id;
        remiseActive = true;
      }
    }

    // Créer la société
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .insert([{
        nom: nom_pme,
        pays: pays.toUpperCase(),
        tva_taux: paysInfo.taux,
        plan,
        rccm: rccm || null,
        ambassadeur_id: ambassadeurId,
        code_promo_utilise: code_promo ? code_promo.toUpperCase() : null,
        remise_active: remiseActive,
        remise_mois_restants: remiseActive ? 3 : 0,
        statut: 'essai',
        date_fin_essai: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }])
      .select()
      .single();

    if (companyError) {
      return res.status(500).json({ error: companyError.message });
    }

    // Créer l'utilisateur principal (compte propriétaire)
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert([{
        email: email.toLowerCase(),
        telephone: telephone || null,
        role: 'pme_owner',
        company_id: company.id,
      }])
      .select()
      .single();

    if (userError) {
      return res.status(500).json({ error: userError.message });
    }

    // Lier l'utilisateur à la société
    await supabase
      .from('company_users')
      .insert([{
        company_id: company.id,
        user_id: user.id,
        role: 'owner',
      }]);

    // Si code promo valide → créer le filleul ambassadeur
    if (ambassadeurId && remiseActive) {
      await supabase
        .from('ambassadeur_filleuls')
        .insert([{
          ambassadeur_id: ambassadeurId,
          company_id: company.id,
          code_promo: code_promo.toUpperCase(),
          plan,
          statut: 'essai',
          date_fin_essai: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          mois_depuis_essai: 0,
          remise_active: true,
          remise_mois_restants: 3,
        }]);
    }

    return res.status(201).json({
      success: true,
      message: 'Inscription réussie ! Votre période d\'essai de 30 jours commence maintenant.',
      company_id: company.id,
      user_id: user.id,
      pays: paysInfo,
      essai_jours: 30,
      remise: remiseActive ? { active: true, pct: 12.5, mois: 3 } : null,
      redirect: '/dashboard-pme'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST — Connexion (PME ou Expert via email)
app.post('/connexion', async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email) return res.status(400).json({ error: 'Email obligatoire' });

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'Aucun compte trouvé avec cet email' });
    }

    // Rediriger selon le rôle
    const redirectMap = {
      pme_owner: '/dashboard-pme',
      cabinet: '/dashboard-expert',
      ambassadeur: '/dashboard-ambassadeur',
      admin: '/dashboard-admin',
    };

    return res.json({
      success: true,
      user_id: user.id,
      role: user.role,
      company_id: user.company_id,
      redirect: redirectMap[user.role] || '/dashboard-pme'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST — Demande de démo (formulaire simplifié)
app.post('/demande-demo', async (req, res) => {
  try {
    const { nom, email, telephone, pays, message } = req.body;

    if (!nom || !email) {
      return res.status(400).json({ error: 'Nom et email obligatoires' });
    }

    const { error } = await supabase
      .from('demandes_demo')
      .insert([{ nom, email, telephone, pays, message, statut: 'nouveau' }]);

    if (error) {
      // Si la table n'existe pas encore, on log et on répond OK
      console.warn('demandes_demo table error:', error.message);
    }

    return res.json({
      success: true,
      message: 'Votre demande de démo a bien été reçue ! Notre équipe vous contacte sous 24h.'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`H-Compta AI Backend running on port ${PORT}`);
});
