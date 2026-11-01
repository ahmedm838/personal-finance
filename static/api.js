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
// Which published file the stored copy was taken from.
const BASELINE_KEY = 'personal-finance:baseline';
const PASSWORD = '9987';

// app.js overrides window.fetch below, so keep the real one for our own calls.
const realFetch = window.fetch.bind(window);

let db = null;
let rates = null;
let authed = sessionStorage.getItem(AUTH_KEY) === '1';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Rates published by the scheduled workflow, if the fetch has ever run. */
async function loadRates() {
  if (rates !== null) return rates;
  try {
    const res = await realFetch(new URL('rates.json', document.baseURI).href, { cache: 'no-store' });
    rates = res.ok ? await res.json() : false;
  } catch {
    rates = false;
  }
  return rates;
}

async function digest(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The stored copy is only trustworthy while the file it was taken from is
 * still the one being published. Once the repo moves on — a commit from
 * another device, or an edit to the workbook itself — the published file
 * wins, otherwise this browser would sit on a snapshot forever.
 */
async function loadDb() {
  await loadRates();
  if (db) return db;

  const saved = localStorage.getItem(STORE_KEY);
  let bytes = null;
  try {
    const res = await realFetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    // Being offline is survivable as long as this browser has its own copy.
    if (!saved) throw new ApiError(500, `Could not load finance.xlsx (${e.message})`);
  }

  const published = bytes ? await digest(bytes) : null;
  if (saved && (!published || localStorage.getItem(BASELINE_KEY) === published)) {
    try {
      db = JSON.parse(saved);
      return db;
    } catch {
      localStorage.removeItem(STORE_KEY);
    }
  } else if (saved) {
    if (typeof toast === 'function') toast('Loaded newer figures from the repo');
  }

  const wb = XLSX.read(bytes, { type: 'array', cellDates: false });
  db = {};
  for (const [name, def] of Object.entries(tables)) {
    db[name] = sheetToRows(wb.Sheets[name], def);
  }
  localStorage.removeItem(STORE_KEY);
  localStorage.setItem(BASELINE_KEY, published);
  return db;
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch {
    // A full or disabled store only costs us persistence, not the session.
  }
  unsaved += 1;
  setStatus(`${unsaved} unsaved`);
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
  const { balance, derived } = compute(db, rates || null);
  const data = {};
  for (const name of Object.keys(tables)) {
    data[name] = { rows: db[name] || [], totals: tableTotals(name, db[name] || []) };
  }
  return { tabs, schema: tables, data, balance, derived, save: 'manual', unsaved };
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

  ['POST', /^\/api\/save$/, async () => {
    requireAuth();
    await loadDb();
    await push();
    return payload();
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

// --- Writing back to the repo -----------------------------------------------

/**
 * Pages cannot write, so saving means committing docs/finance.xlsx through the
 * GitHub Contents API with a token the owner pastes in. REPO is injected by
 * scripts/build-pages.js from the git remote.
 *
 * The token lives in this browser's localStorage and is never committed. Every
 * site under the same github.io host shares that storage, so it should be a
 * fine-grained token scoped to this one repository with Contents: Read and
 * write — nothing more.
 */

const TOKEN_KEY = 'personal-finance:token';
// Edits are kept here until the Save button sends them; the count is what
// the buttons in each section are enabled by.
let unsaved = 0;

let token = localStorage.getItem(TOKEN_KEY) || '';
let fileSha = null;
let saving = false;

const $id = (id) => document.getElementById(id);

function setStatus(text, bad = false) {
  const node = $id('sync-status');
  if (!node) return;
  node.textContent = text;
  node.classList.toggle('error', bad);
}

/** Only an entry point: once connected, the status line carries the state. */
function renderSyncButton() {
  const node = $id('github');
  if (node) node.hidden = Boolean(token);
}

async function gh(path, init = {}) {
  const res = await realFetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `GitHub returned ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/** btoa needs a binary string, and a big array blows the argument limit. */
function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function currentSha() {
  if (fileSha) return fileSha;
  const meta = await gh(`/repos/${REPO.owner}/${REPO.repo}/contents/${REPO.path}?ref=${REPO.branch}`);
  fileSha = meta.sha;
  return fileSha;
}

async function push() {
  if (!token) throw new ApiError(400, 'Connect GitHub first — the button is in the header.');
  if (saving) return;
  saving = true;
  setStatus('Saving…');

  try {
    await loadDb();
    const bytes = new Uint8Array(XLSX.write(workbook(), { bookType: 'xlsx', type: 'array' }));
    const content = base64(bytes);
    const put = async () => gh(`/repos/${REPO.owner}/${REPO.repo}/contents/${REPO.path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Update figures from the web app',
        content,
        branch: REPO.branch,
        sha: await currentSha(),
      }),
    });

    let res;
    try {
      res = await put();
    } catch (e) {
      // A stale sha means the file moved on elsewhere; take the new one and retry.
      fileSha = null;
      res = await put();
    }

    fileSha = res.content.sha;
    // What we just pushed is now the published file.
    localStorage.setItem(BASELINE_KEY, await digest(bytes));
    unsaved = 0;
    setStatus(`Saved ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    if (e.status === 401) {
      // An expired or revoked token will not start working on a retry.
      forgetToken();
      setStatus('Token rejected — connect again', true);
    } else {
      setStatus(`Save failed — ${e.message}`, true);
    }
    throw e;
  } finally {
    saving = false;
  }
}


async function connect() {
  const entered = prompt(
    'Paste a GitHub fine-grained token with Contents: Read and write, '
    + `scoped to ${REPO.owner}/${REPO.repo} only.\n\n`
    + 'It is kept in this browser and never committed.',
  );
  if (!entered) return;

  const previous = token;
  token = entered.trim();
  fileSha = null;
  try {
    await currentSha();
    localStorage.setItem(TOKEN_KEY, token);
    setStatus(unsaved ? `${unsaved} unsaved` : 'Connected');
    renderSyncButton();
  } catch (e) {
    token = previous;
    fileSha = null;
    setStatus(`Token rejected — ${e.message}`, true);
  }
}

function forgetToken() {
  token = '';
  fileSha = null;
  localStorage.removeItem(TOKEN_KEY);
  renderSyncButton();
}

// --- Header actions ---------------------------------------------------------

$id('github').addEventListener('click', connect);

$id('download').addEventListener('click', async () => {
  await loadDb();
  const out = XLSX.write(workbook(), { bookType: 'xlsx', type: 'array' });
  const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.ms-excel' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'finance.xlsx' });
  a.click();
  URL.revokeObjectURL(url);
});


renderSyncButton();
setStatus(token ? 'Connected' : 'Not connected');

// Edits live in this browser until they are saved, so leaving with some
// still pending is worth a word.
window.addEventListener('beforeunload', (e) => {
  if (!unsaved) return;
  e.preventDefault();
  e.returnValue = '';
});
