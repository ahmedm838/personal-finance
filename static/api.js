/**
 * Browser stand-in for the Express API, used by the GitHub Pages build.
 *
 * Pages serves static files only, so there is no server to talk to. The
 * workbook committed next to this script is read straight into memory with
 * SheetJS and every route the front end calls is answered here instead, which
 * keeps public/app.js identical between the two builds.
 *
 * Edits live in this browser's localStorage. They do not reach the repo —
 * "Download .xlsx" is how they get back into it.
 */

const DATA_URL = new URL('finance.xlsx', document.baseURI).href;
const STORE_KEY = 'personal-finance:db';
const AUTH_KEY = 'personal-finance:authed';
const PASSWORD = '9987';

// app.js overrides window.fetch below, so keep the real one for our own calls.
const realFetch = window.fetch.bind(window);

let db = null;
let authed = sessionStorage.getItem(AUTH_KEY) === '1';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function loadDb() {
  if (db) return db;

  const saved = localStorage.getItem(STORE_KEY);
  if (saved) {
    try {
      db = JSON.parse(saved);
      return db;
    } catch {
      localStorage.removeItem(STORE_KEY);
    }
  }

  const res = await realFetch(DATA_URL, { cache: 'no-store' });
  if (!res.ok) throw new ApiError(500, `Could not load finance.xlsx (${res.status})`);
  const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: 'array', cellDates: false });

  db = {};
  for (const [name, def] of Object.entries(tables)) {
    db[name] = sheetToRows(wb.Sheets[name], def);
  }
  return db;
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch {
    // A full or disabled store only costs us persistence, not the session.
  }
}

function workbook() {
  const wb = XLSX.utils.book_new();
  for (const [name, def] of Object.entries(tables)) {
    XLSX.utils.book_append_sheet(wb, rowsToSheet(db[name] || [], def), name);
  }
  return wb;
}

/** The full application payload: schema, rows, totals and everything derived. */
function payload() {
  const { balance, derived } = compute(db);
  const data = {};
  for (const name of Object.keys(tables)) {
    data[name] = { rows: db[name] || [], totals: tableTotals(name, db[name] || []) };
  }
  return { tabs, schema: tables, data, balance, derived };
}

function requireAuth() {
  if (!authed) throw new ApiError(401, 'Not signed in.');
}

function tableOr404(name) {
  const def = tables[name];
  if (!def) throw new ApiError(404, `Unknown table "${name}"`);
  return def;
}

function rowAt(name, raw) {
  const rows = db[name];
  const i = Number(raw);
  if (!Number.isInteger(i) || i < 0 || i >= rows.length) throw new ApiError(404, 'Row not found.');
  return i;
}

const routes = [
  ['GET', /^\/api\/session$/, () => ({ authed })],

  ['POST', /^\/api\/login$/, (m, body) => {
    if (String(body.password ?? '') !== PASSWORD) throw new ApiError(401, 'Wrong password.');
    authed = true;
    sessionStorage.setItem(AUTH_KEY, '1');
    return { ok: true };
  }],

  ['POST', /^\/api\/logout$/, () => {
    authed = false;
    sessionStorage.removeItem(AUTH_KEY);
    return { ok: true };
  }],

  ['GET', /^\/api\/data$/, async () => {
    requireAuth();
    await loadDb();
    return payload();
  }],

  ['POST', /^\/api\/([^/]+)\/rows$/, async (m, body) => {
    requireAuth();
    const def = tableOr404(m[1]);
    if (def.keyed) throw new ApiError(400, 'Rows cannot be added to this table.');
    await loadDb();

    const rows = db[m[1]];
    const at = Number.isInteger(body._at) ? body._at : rows.length;
    rows.splice(Math.max(0, Math.min(at, rows.length)), 0, sanitise(def, body));
    persist();
    return payload();
  }],

  ['PATCH', /^\/api\/([^/]+)\/rows\/(\d+)$/, async (m, body) => {
    requireAuth();
    const def = tableOr404(m[1]);
    await loadDb();

    const i = rowAt(m[1], m[2]);
    db[m[1]][i] = sanitise(def, body, db[m[1]][i]);
    persist();
    return payload();
  }],

  ['DELETE', /^\/api\/([^/]+)\/rows\/(\d+)$/, async (m) => {
    requireAuth();
    const def = tableOr404(m[1]);
    if (def.keyed) throw new ApiError(400, 'Rows cannot be removed from this table.');
    await loadDb();

    db[m[1]].splice(rowAt(m[1], m[2]), 1);
    persist();
    return payload();
  }],
];

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const { pathname } = new URL(url, location.href);
  if (!pathname.startsWith('/api/')) return realFetch(input, init);

  const method = (init.method || 'GET').toUpperCase();
  const route = routes.find(([verb, pattern]) => verb === method && pattern.test(pathname));
  if (!route) return reply(404, { error: `No route for ${method} ${pathname}` });

  try {
    const body = init.body ? JSON.parse(init.body) : {};
    return reply(200, await route[2](pathname.match(route[1]), body));
  } catch (e) {
    return reply(e.status || 400, { error: e.message || 'Something went wrong.' });
  }
};

// --- Header actions ---------------------------------------------------------

document.getElementById('download').addEventListener('click', async () => {
  await loadDb();
  const out = XLSX.write(workbook(), { bookType: 'xlsx', type: 'array' });
  const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.ms-excel' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'finance.xlsx' });
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('reset').addEventListener('click', () => {
  if (!confirm('Discard your changes and reload the figures committed in the repo?')) return;
  localStorage.removeItem(STORE_KEY);
  location.reload();
});
