'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const { tables, tabs } = require('./lib/schema');
const { load, save, DATA_FILE } = require('./lib/workbook');
const { compute, tableTotals } = require('./lib/compute');
const { sanitise } = require('./lib/rows');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PASSWORD = process.env.APP_PASSWORD || '9987';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET not set — using a random secret, so logins drop on restart.');
}
app.use(session({
  name: 'pf.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SECURE_COOKIE === 'true',
    maxAge: 12 * 3600 * 1000,
  },
}));

// --- Auth -------------------------------------------------------------------

const attempts = new Map(); // ip -> { count, until }

function throttled(ip) {
  const a = attempts.get(ip);
  return Boolean(a && a.until > Date.now());
}

function noteFailure(ip) {
  const a = attempts.get(ip) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= 5) {
    a.until = Date.now() + 60_000;
    a.count = 0;
  }
  attempts.set(ip, a);
}

function matches(given) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(PASSWORD);
  // timingSafeEqual needs equal lengths, so compare digests instead.
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(a).digest(),
    crypto.createHash('sha256').update(b).digest(),
  );
}

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (throttled(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
  }
  if (!matches(req.body && req.body.password)) {
    noteFailure(ip);
    return res.status(401).json({ error: 'Wrong password.' });
  }
  attempts.delete(ip);
  req.session.authed = true;
  return res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', (req, res) => res.json({ authed: Boolean(req.session.authed) }));

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'Not signed in.' });
}

// --- Data -------------------------------------------------------------------

/** The full application payload: schema, rows, totals and everything derived. */
async function payload() {
  const { db } = await load();
  const { balance, derived } = compute(db);

  const data = {};
  for (const name of Object.keys(tables)) {
    data[name] = { rows: db[name] || [], totals: tableTotals(name, db[name] || []) };
  }
  return { tabs, schema: tables, data, balance, derived };
}

function tableOr404(req, res) {
  const def = tables[req.params.table];
  if (!def) {
    res.status(404).json({ error: `Unknown table "${req.params.table}"` });
    return null;
  }
  return def;
}

app.get('/api/data', requireAuth, async (req, res, next) => {
  try {
    res.json(await payload());
  } catch (e) { next(e); }
});

app.post('/api/:table/rows', requireAuth, async (req, res, next) => {
  try {
    const def = tableOr404(req, res);
    if (!def) return;
    if (def.keyed) return res.status(400).json({ error: 'Rows cannot be added to this table.' });

    const { db } = await load();
    const row = sanitise(def, req.body || {});
    const at = Number.isInteger(req.body && req.body._at) ? req.body._at : db[req.params.table].length;
    db[req.params.table].splice(Math.max(0, Math.min(at, db[req.params.table].length)), 0, row);
    await save();
    res.json(await payload());
  } catch (e) { next(e); }
});

app.patch('/api/:table/rows/:index', requireAuth, async (req, res, next) => {
  try {
    const def = tableOr404(req, res);
    if (!def) return;

    const { db } = await load();
    const rows = db[req.params.table];
    const i = Number(req.params.index);
    if (!Number.isInteger(i) || i < 0 || i >= rows.length) {
      return res.status(404).json({ error: 'Row not found.' });
    }
    rows[i] = sanitise(def, req.body || {}, rows[i]);
    await save();
    res.json(await payload());
  } catch (e) { next(e); }
});

app.delete('/api/:table/rows/:index', requireAuth, async (req, res, next) => {
  try {
    const def = tableOr404(req, res);
    if (!def) return;
    if (def.keyed) return res.status(400).json({ error: 'Rows cannot be removed from this table.' });

    const { db } = await load();
    const rows = db[req.params.table];
    const i = Number(req.params.index);
    if (!Number.isInteger(i) || i < 0 || i >= rows.length) {
      return res.status(404).json({ error: 'Row not found.' });
    }
    rows.splice(i, 1);
    await save();
    res.json(await payload());
  } catch (e) { next(e); }
});

app.get('/api/download', requireAuth, (req, res) => {
  res.download(DATA_FILE, 'finance.xlsx');
});

// --- Static + errors --------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Something went wrong.' });
});

app.listen(PORT, HOST, () => {
  console.log(`\n  Personal Finance running at http://${HOST}:${PORT}\n`);
  if (PASSWORD === '9987') {
    console.log('  Using the default password. Set APP_PASSWORD to change it.\n');
  }
});
