const axios = require('axios');

async function analyzeDocument(fileUrl) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: "claude-sonnet-4-20250514",
      messages: [
        {
          role: "user",
          content: `Analyse cette facture: ${fileUrl}`
        }
      ]
    },
    {
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
}

module.exports = { analyzeDocument };
