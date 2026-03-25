const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

router.get('/generate/:company_id', async (req, res) => {
  const { company_id } = req.params;

  const { data } = await supabase
    .from('ecritures')
    .select('*')
    .eq('company_id', company_id);

  let totalTVA = 0;
  data.forEach(e => {
    totalTVA += e.tva_amount || 0;
  });

  res.json({ tva: totalTVA });
});

module.exports = router;
