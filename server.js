require('dotenv').config();
const express = require('express');
const cors = require('cors');
const supabase = require('./config/supabase');

const app = express();
app.use(cors());
app.use(express.json());

// Routes métier
app.use('/api/pieces', require('./routes/pieces.routes'));
app.use('/api/tva', require('./routes/tva.routes'));
app.use('/api/export', require('./routes/export.routes'));
app.use('/api/mariah', require('./routes/mariah.routes'));

// Route test
app.get('/', (req, res) => {
  res.send('H-Compta AI backend is running 🚀');
});

// Route stats PME par entreprise
app.get('/stats/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;

    // 1) Total pièces
    const { count: totalFactures, error: piecesError } = await supabase
      .from('pieces')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId);

    if (piecesError) {
      return res.status(500).json({
        error: piecesError.message || JSON.stringify(piecesError),
      });
    }

    // 2) Alertes / pièces en attente
    const { count: totalAlertes, error: alertesError } = await supabase
      .from('pieces')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .in('status', ['pending', 'a_verifier', 'error', 'en attente', 'a_vérifier']);

    if (alertesError) {
      return res.status(500).json({
        error: alertesError.message || JSON.stringify(alertesError),
      });
    }

    // 3) Écritures pour calcul TVA
    const { data: ecritures, error: ecrituresError } = await supabase
      .from('ecritures')
      .select('compte,debit,credit')
      .eq('company_id', companyId);

    if (ecrituresError) {
      return res.status(500).json({
        error: ecrituresError.message || JSON.stringify(ecrituresError),
      });
    }

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

    const tva = Math.max(0, tvaCollectee - tvaDeductible);

    return res.json({
      total_factures: totalFactures || 0,
      alertes: totalAlertes || 0,
      tva,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || JSON.stringify(error),
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`H-Compta AI Backend running on port ${PORT}`);
});
