const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// GET /api/pieces — récupère les 5 dernières pièces (toutes sociétés)
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('pieces')
    .select('*')
    .order('id', { ascending: false })
    .limit(5);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// GET /api/pieces/:companyId — récupère les pièces d'une société
router.get('/:companyId', async (req, res) => {
  const { companyId } = req.params;

  const { data, error } = await supabase
    .from('pieces')
    .select('*')
    .eq('company_id', companyId)
    .order('id', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

module.exports = router;
