require('dotenv').config();
const express = require('express');
const cors = require('cors');
const supabase = require('./config/supabase');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/pieces', require('./routes/pieces.routes'));
app.use('/api/tva', require('./routes/tva.routes'));
app.use('/api/export', require('./routes/export.routes'));
app.use('/api/mariah', require('./routes/mariah.routes'));

app.get('/', (req, res) => {
  res.send('H-Compta AI backend is running 🚀');
});
app.get('/stats/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;

    const { count: totalFactures, error: piecesError } = await supabase
      .from('pieces')
      .select('*', { count: 'exact', head: true })
      .eq('identifiant_entreprise', companyId);

    if (piecesError) {
      return res.status(500).json({ error: piecesError.message || JSON.stringify(piecesError) });
    }

    const { count: totalAlertes, error: alertesError } = await supabase
      .from('pieces')
      .select('*', { count: 'exact', head: true })
      .eq('identifiant_entreprise', companyId)
      .in('statut', ['en attente', 'a_vérifier']);

    if (alertesError) {
      return res.status(500).json({ error: alertesError.message || JSON.stringify(alertesError) });
    }

    const { data: ecritures, error: ecrituresError } = await supabase
      .from('ecritures')
      .select('compte,débit,crédit')
      .eq('identifiant_entreprise', companyId);

    if (ecrituresError) {
      return res.status(500).json({ error: ecrituresError.message || JSON.stringify(ecrituresError) });
    }

    let tvaCollectee = 0;
    let tvaDeductible = 0;

    for (const e of ecritures || []) {
      const compte = String(e.compte || '');

      if (compte.startsWith('44571')) {
        tvaCollectee += Number(e['crédit'] || 0) - Number(e['débit'] || 0);
      }

      if (compte.startsWith('44551')) {
        tvaDeductible += Number(e['débit'] || 0) - Number(e['crédit'] || 0);
      }
    }

    const tva = Math.max(0, tvaCollectee - tvaDeductible);

    return res.json({
      total_factures: totalFactures || 0,
      alertes: totalAlertes || 0,
      tva
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || JSON.stringify(error) });
  }
});
     

