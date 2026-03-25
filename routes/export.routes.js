const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

router.get('/sage/:company_id', async (req, res) => {
  const { company_id } = req.params;

  const { data } = await supabase
    .from('ecritures')
    .select('*')
    .eq('company_id', company_id);

  res.json(data);
});

module.exports = router;
