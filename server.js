const express  = require('express');
const session  = require('express-session');
const multer   = require('multer');
const XLSX     = require('xlsx');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const { MongoClient } = require('mongodb');

const app  = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
const SESSION_SECRET = process.env.SESSION_SECRET || 'oos-session-secret-2024';
const MONGO_URI      = process.env.MONGO_URI;
const ADMIN_HASH     = bcrypt.hashSync(ADMIN_PASSWORD, 10);

// ─── MONGODB ──────────────────────────────────────────────────────────────────
let db = null;

async function connectMongo() {
  if (!MONGO_URI) { console.warn('⚠️  MONGO_URI non défini — mode mémoire'); return; }
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db('oos_lookup');
    await db.collection('agents').createIndex({ msisdn: 1 });
    await db.collection('meta').createIndex({ key: 1 }, { unique: true });
    console.log('✅ MongoDB Atlas connecté');
  } catch (e) { console.error('❌ MongoDB :', e.message); }
}

// Cache mémoire (rapide pour la recherche)
let memCache = { records: [], lastUpdate: null, filename: null };

async function saveRecords(records, filename) {
  const now = new Date().toISOString();
  memCache = { records, lastUpdate: now, filename };
  if (!db) return;
  await db.collection('agents').deleteMany({});
  if (records.length > 0) {
    const docs = records.map(r => ({
      ...r,
      msisdn: String(r['Agent MSISDN'] || '').replace(/[\s\-]/g, '')
    }));
    // Insérer par lots de 500 pour éviter les timeouts
    for (let i = 0; i < docs.length; i += 500) {
      await db.collection('agents').insertMany(docs.slice(i, i + 500));
    }
  }
  await db.collection('meta').updateOne(
    { key: 'info' },
    { $set: { key: 'info', lastUpdate: now, filename, count: records.length } },
    { upsert: true }
  );
}

async function loadMeta() {
  if (!db) return memCache.records.length > 0
    ? { loaded: true, count: memCache.records.length, lastUpdate: memCache.lastUpdate, filename: memCache.filename }
    : { loaded: false };
  const meta = await db.collection('meta').findOne({ key: 'info' });
  return meta ? { loaded: true, count: meta.count, lastUpdate: meta.lastUpdate, filename: meta.filename } : { loaded: false };
}

async function searchMsisdn(query) {
  if (!db) return memCache.records.filter(r => String(r['Agent MSISDN']).includes(query));
  return await db.collection('agents').find({ msisdn: { $regex: query } }).toArray();
}

async function loadIntoCache() {
  if (!db) return;
  try {
    const count = await db.collection('agents').countDocuments();
    if (!count) return;
    const meta    = await db.collection('meta').findOne({ key: 'info' });
    const records = await db.collection('agents').find({}).toArray();
    const clean   = records.map(({ _id, msisdn, ...rest }) => rest);
    memCache = { records: clean, lastUpdate: meta?.lastUpdate || null, filename: meta?.filename || null };
    console.log(`✅ Cache : ${clean.length} agents chargés depuis MongoDB`);
  } catch (e) { console.error('Cache load error:', e.message); }
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 4 * 60 * 60 * 1000 }
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.xlsx', '.xls', '.csv'].includes(path.extname(file.originalname).toLowerCase());
    ok ? cb(null, true) : cb(new Error('Format non supporté (.xlsx, .xls, .csv)'));
  }
});

const isAdmin = req => req.session && req.session.admin === true;

function parseExcelBuffer(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rows.map(r => {
    const out = {};
    for (const rawKey of Object.keys(r)) {
      const k = rawKey.replace(/[\u00A0\u200B\uFEFF]/g, ' ').trim();
      const v = r[rawKey];
      out[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : String(v).replace(/[\u00A0]/g, ' ').trim();
    }
    const msisdnKey = Object.keys(out).find(k => k.toLowerCase().includes('msisdn'));
    if (msisdnKey) out['Agent MSISDN'] = String(out[msisdnKey]).replace(/[\s\-]/g, '');
    return out;
  });
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/search', async (req, res) => {
  const q = (req.query.msisdn || '').replace(/[\s\-\.\(\)\+]/g, '');
  if (!q || q.length < 3) return res.json({ results: [], error: 'Saisissez au moins 3 chiffres.' });
  const meta = await loadMeta();
  if (!meta.loaded) return res.json({ results: [], error: 'Base de données non encore chargée.' });
  try {
    const raw     = await searchMsisdn(q);
    const results = raw.map(({ _id, msisdn, ...rest }) => rest);
    res.json({ results, total: results.length, lastUpdate: meta.lastUpdate });
  } catch { res.status(500).json({ results: [], error: 'Erreur de recherche.' }); }
});

app.get('/admin', (req, res) => {
  if (isAdmin(req)) return res.redirect('/admin/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.post('/admin/login', (req, res) => {
  if (bcrypt.compareSync(req.body.password, ADMIN_HASH)) {
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

app.get('/admin/info', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Non autorisé' });
  const meta = await loadMeta();
  res.json({ ...meta, mongoConnected: !!db });
});

app.post('/admin/upload', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Non autorisé' });
  upload.single('excel')(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    try {
      const records = parseExcelBuffer(req.file.buffer);
      if (!records.length) throw new Error('Fichier vide ou mal formaté.');
      if (!('Agent MSISDN' in records[0])) throw new Error('Colonne "Agent MSISDN" introuvable.');
      await saveRecords(records, req.file.originalname);
      res.json({ success: true, count: records.length, filename: req.file.originalname });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

app.post('/admin/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

// ─── START ────────────────────────────────────────────────────────────────────
async function start() {
  await connectMongo();
  await loadIntoCache();
  app.listen(PORT, () => {
    console.log(`✅ OOS Lookup → port ${PORT} | MongoDB: ${db ? 'connecté' : 'mode mémoire'}`);
  });
}
start();
