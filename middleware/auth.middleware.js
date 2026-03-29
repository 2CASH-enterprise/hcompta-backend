// ============================================================
// H-Compta AI — Middleware JWT
// ============================================================
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'hcompta_jwt_secret_change_en_prod';

function genererToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function authRequis(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant — authentification requise' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(err) {
    return res.status(403).json({ error: 'Token invalide ou expiré' });
  }
}

function adminRequis(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Accès admin requis' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'ADMIN') return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
    req.user = decoded;
    next();
  } catch(err) {
    return res.status(403).json({ error: 'Token invalide ou expiré' });
  }
}

function authOptionnel(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch(e) {}
  }
  next();
}

module.exports = { genererToken, authRequis, adminRequis, authOptionnel };
