const express = require('express');
const router = express.Router();
const axios = require('axios');

router.post('/', async (req, res) => {
  const { message } = req.body;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: "claude-3-sonnet-20240229",
      messages: [{ role: "user", content: message }]
    },
    {
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY
      }
    }
  );

  res.json(response.data);
});

module.exports = router;
