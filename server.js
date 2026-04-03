const express  = require('express');
const session  = require('express-session');
const multer   = require('multer');
const XLSX     = require('xlsx');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Sur Render, le système de fichiers est éphémère.
// Les données uploadées sont stockées en mémoire (reset au redémarrage).
// Pour une persistance réelle, utilisez une base de données (MongoDB Atlas gratuit).
// Pour ce projet, on stocke en mémoire + fichier local si possible.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
const SESSION_SECRET = process.env.SESSION_SECRET || 'oos-session-secret-2024';

// Hash du mot de passe au démarrage
const ADMIN_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);

// Stockage en mémoire (survivra aux requêtes, pas aux redémarrages)
let DB = {
  records: [],
  lastUpdate: null,
  filename: null
};

// Essayer aussi de persister sur disque si possible
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_FILE  = path.join(UPLOAD_DIR, 'data.json');

try {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  // Charger depuis fichier si existant
  if (fs.existsSync(DATA_FILE)) {
    DB = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    console.log(`✅ Base chargée depuis disque : ${DB.records.length} enregistrements`);
  }
} catch (e) {
  console.log('ℹ️  Stockage disque indisponible, mode mémoire uniquement');
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 4 * 60 * 60 * 1000 } // 4h
}));

// ─── MULTER ───────────────────────────────────────────────────────────────────
const storage = multer.memoryStorage(); // Mémoire pour Render
const upload  = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.xlsx', '.xls', '.csv'].includes(
      path.extname(file.originalname).toLowerCase()
    );
    ok ? cb(null, true) : cb(new Error('Format non supporté (.xlsx, .xls, .csv)'));
  }
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const isAdmin = req => req.session && req.session.admin === true;

function parseExcelBuffer(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  return rows.map(r => {
    const out = {};
    for (const rawKey of Object.keys(r)) {
      // Normaliser la clé : trim + supprimer espaces insécables et caractères invisibles
      const k = rawKey.replace(/[\u00A0\u200B\uFEFF]/g, ' ').trim();
      const v = r[rawKey];

      if (typeof v === 'number') {
        // Conserver les nombres comme nombres (pas de conversion en string)
        out[k] = Math.round(v * 100) / 100;
      } else {
        out[k] = String(v).replace(/[\u00A0]/g, ' ').trim();
      }
    }
    // S'assurer que MSISDN est toujours une chaîne propre
    const msisdnKey = Object.keys(out).find(k => k.toLowerCase().includes('msisdn'));
    if (msisdnKey) {
      out['Agent MSISDN'] = String(out[msisdnKey]).replace(/[\s\-]/g, '');
    }
    return out;
  });
}

function saveDB() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(DB)); } catch {}
}

// ─── ROUTES PUBLIQUES ─────────────────────────────────────────────────────────
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.get('/api/search', (req, res) => {
  const q = (req.query.msisdn || '').replace(/[\s\-\.\(\)\+]/g, '');
  if (!q || q.length < 3)
    return res.json({ results: [], error: 'Saisissez au moins 3 chiffres.' });

  if (!DB.records.length)
    return res.json({ results: [], error: 'Base de données non encore chargée.' });

  const results = DB.records.filter(r =>
    String(r['Agent MSISDN']).includes(q)
  );
  res.json({ results, total: results.length, lastUpdate: DB.lastUpdate });
});

// ─── ROUTES ADMIN ─────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  if (isAdmin(req)) return res.redirect('/admin/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (bcrypt.compareSync(password, ADMIN_HASH)) {
    req.session.admin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Mot de passe incorrect.' });
  }
});

app.get('/admin/dashboard', (req, res) => {
  if (!isAdmin(req)) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

app.get('/admin/info', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Non autorisé' });
  res.json({
    loaded: DB.records.length > 0,
    count: DB.records.length,
    lastUpdate: DB.lastUpdate,
    filename: DB.filename
  });
});

app.post('/admin/upload', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Non autorisé' });

  upload.single('excel')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

    try {
      const records = parseExcelBuffer(req.file.buffer);
      if (!records.length) throw new Error('Fichier vide ou mal formaté.');
      if (!('Agent MSISDN' in records[0]))
        throw new Error('Colonne "Agent MSISDN" introuvable.');

      DB = {
        records,
        lastUpdate: new Date().toISOString(),
        filename: req.file.originalname
      };
      saveDB();

      res.json({ success: true, count: records.length, filename: req.file.originalname });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ OOS Lookup démarré → port ${PORT}`);
});
