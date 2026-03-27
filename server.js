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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`H-Compta AI Backend running on port ${PORT}`);
});
