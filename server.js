require('dotenv').config();
const express = require('express');
const cors = require('cors');

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
app.get('/stats', async (req, res) => {
  try {
    res.json({
      total_factures: 124,
      tva: 1351000,
      alertes: 3
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

  app.listen(3000, () => {
  console.log('H-Compta AI Backend running on port 3000');
});
