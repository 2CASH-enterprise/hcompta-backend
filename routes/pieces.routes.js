const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { analyzeDocument } = require('../services/ai.service');

router.post('/upload', async (req, res) => {
  const { file_url, company_id } = req.body;

  const result = await analyzeDocument(file_url);

  const { data } = await supabase
    .from('pieces')
    .insert([{
      company_id,
      file_url,
      extracted_data: result,
      status: 'processed'
    }]);

  res.json(data);
});

module.exports = router;
