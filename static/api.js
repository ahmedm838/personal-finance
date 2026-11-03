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
// The CBE's own page refuses automated requests; this is an open mirror of
// the same published table, no key needed.
const RATE_FEED = 'https://raw.githubusercontent.com/AllRates-Today/central-bank-exchange-rates/main/data/cbe/latest.json';
const RATE_ATTRIBUTION = 'AllRatesToday (CC BY-NC 4.0)';
// Signed out after this long without a click, a key or a scroll.
const IDLE_LIMIT = 7 * 60 * 1000;

// app.js overrides window.fetch below, so keep the real one for our own calls.
const realFetch = window.fetch.bind(window);

let db = null;
let rates = null;
let authed = sessionStorage.getItem(AUTH_KEY) === '1';

let idleTimer = null;

function signOut() {
  authed = false;
  clearTimeout(idleTimer);
  sessionStorage.removeItem(AUTH_KEY);
  if (typeof showLogin === 'function') showLogin();
}

/** Any sign of life restarts the clock; silence for IDLE_LIMIT ends it. */
function noteActivity() {
  if (!authed) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(signOut, IDLE_LIMIT);
}

for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
  window.addEventListener(event, noteActivity, { passive: true, capture: true });
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The sell price for one currency against the pound. */
function sellRate(body, base) {
  const row = (body.rates || []).find((r) => r.base === base && r.quote === 'EGP' && r.type === 'sell');
  const value = row && Number(row.value);
  // The same guard the scheduled fetch applies: a wrong rate would quietly
  // rewrite every foreign holding.
  if (!Number.isFinite(value) || value < 5 || value > 500) throw new Error('implausible rate');
  return Number(value.toFixed(4));
}

/**
 * Read straight from the source on every load, so the figures are current
 * rather than whatever the last scheduled run committed. The repo's
 * rates.json is the fallback for being offline or the source being down.
 */
async function loadRates() {
  if (rates !== null) return rates;

  try {
    const res = await realFetch(RATE_FEED, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body = await res.json();
    if (body.source !== 'cbe') throw new Error('not the CBE feed');
    rates = {
      usd: sellRate(body, 'USD'),
      eur: sellRate(body, 'EUR'),
      source: 'CBE sell rate',
      rateDate: body.date,
      attribution: RATE_ATTRIBUTION,
      fetched: new Date().toISOString(),
    };
    return rates;
  } catch {
    // Fall through to the published copy.
  }

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
/**
 * The workbook as it stands in the repo.
 *
 * A save commits straight away, but the copy the site serves only changes
 * once Pages has rebuilt and its cache has turned over, which is a minute
 * or so behind. Reading through the API skips both, so a reload right
 * after saving shows what was saved. Without a token the published copy
 * is all there is.
 */
async function fetchWorkbook() {
  if (token) {
    try {
      const path = `/repos/${REPO.owner}/${REPO.repo}/contents/${REPO.path}`
        + `?ref=${REPO.branch}&t=${Date.now()}`;
      const meta = await gh(path, { cache: 'no-store' });
      // Over a megabyte the API stops inlining the content.
      if (meta.content) {
        fileSha = meta.sha;
        const raw = atob(meta.content.replace(/\s/g, ''));
        return Uint8Array.from(raw, (c) => c.charCodeAt(0));
      }
    } catch {
      // Rate-limited, offline, or a token that cannot read: fall back.
    }
  }

  const res = await realFetch(DATA_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadDb() {
  await loadRates();
  if (db) return db;

  const saved = localStorage.getItem(STORE_KEY);
  let bytes = null;
  try {
    bytes = await fetchWorkbook();
  } catch (e) {
    // Being offline is survivable as long as this browser has its own copy.
    if (!saved) throw new ApiError(500, `Could not load finance.xlsx (${e.message})`);
  }

  if (bytes) {
    // The workbook is the record. Whatever this device was holding is a
    // leftover draft, and carrying it over is worse than dropping it: it
    // shows up as unsaved on a phone that has not been opened in days,
    // and saving there would push those old figures over newer ones.
    const wb = XLSX.read(bytes, { type: 'array', cellDates: false });
    db = {};
    for (const [name, def] of Object.entries(tables)) {
      db[name] = sheetToRows(wb.Sheets[name], def);
    }

    markSaved();
    localStorage.removeItem(STORE_KEY);
    localStorage.setItem(BASELINE_KEY, await digest(bytes));
    return db;
  }

  // Nothing could be fetched, so this device's own copy is all there is.
  // It counts as saved: what it holds cannot be compared with a workbook
  // we have not read.
  try {
    db = JSON.parse(saved);
  } catch {
    localStorage.removeItem(STORE_KEY);
    throw new ApiError(500, 'Could not load finance.xlsx, and this device has no usable copy.');
  }
  markSaved();
  if (typeof toast === 'function') toast('Offline — showing the last copy on this device');
  return db;
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch {
    // A full or disabled store only costs us persistence, not the session.
  }
  const n = changedRows();
  setStatus(n ? `${n} unsaved` : (token ? 'Connected' : 'Not connected'));
}

/** Only the stored columns matter: the computed ones are never written. */
/**
 * What counts as a row worth saving.
 *
 * A worked-out plan parameter is never typed in, and three of them follow
 * the exchange rate, which moves on its own. Counting those as edits put a
 * phone opened the next day at "Save (3)" having touched nothing. Columns
 * marked derived are left in, because most of them are only derived on
 * some rows and typed in on the rest.
 */
function storedShape(name, row) {
  const def = tables[name];
  if (def.keyed && (def.derivedKeys || []).includes(row.key)) return `worked out: ${row.key}`;

  const out = {};
  for (const col of def.columns) if (!col.computed) out[col.key] = row[col.key] ?? null;
  return JSON.stringify(out);
}

/**
 * How many rows differ from the published workbook — added, removed or
 * edited. Counting keystrokes made three corrections to one figure look
 * like three changes.
 */
function changedRows() {
  if (!savedDb || !db) return 0;

  let n = 0;
  for (const name of Object.keys(tables)) {
    const now = db[name] || [];
    const was = savedDb[name] || [];
    n += Math.abs(now.length - was.length);
    for (let i = 0; i < Math.min(now.length, was.length); i += 1) {
      if (storedShape(name, now[i]) !== storedShape(name, was[i])) n += 1;
    }
  }
  return n;
}

const markSaved = () => { savedDb = JSON.parse(JSON.stringify(db)); };

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
    data[name] = { rows: db[name] || [], totals: tableTotals(name, db[name] || [], db) };
  }
  return { tabs, schema: tables, data, balance, derived, save: 'manual', unsaved: changedRows() };
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
    noteActivity();
    return { ok: true };
  }],

  ['POST', /^\/api\/logout$/, () => {
    authed = false;
    clearTimeout(idleTimer);
    sessionStorage.removeItem(AUTH_KEY);
    return { ok: true };
  }],

  ['POST', /^\/api\/discard$/, async () => {
    requireAuth();
    await loadDb();
    if (!savedDb) throw new ApiError(400, 'Nothing to discard.');

    db = JSON.parse(JSON.stringify(savedDb));
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      // Nothing to clear is not a failure.
    }
    setStatus(token ? 'Connected' : 'Not connected');
    return payload();
  }],

  ['POST', /^\/api\/save$/, async () => {
    requireAuth();
    await loadDb();

    // A write already in flight will not pick up anything typed since, so
    // those edits stay unsaved and the button stays live.
    if (saving) return payload();

    // The figures on screen are already the ones being written, and the
    // round trip to GitHub takes seconds. Hand the table back at once and
    // let the status line report the write; if it fails, the unsaved count
    // comes back and the edits are still here.
    const previously = savedDb;
    markSaved();
    const answer = payload();

    // Serialising the workbook holds the thread for a moment, so let the
    // table paint first and start the write on the next turn of the loop.
    setTimeout(() => {
      push()
        .catch(() => { savedDb = previously; })
        .finally(() => window.dispatchEvent(new CustomEvent('finance:sync')));
    }, 0);

    return answer;
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
// The rows as the published workbook holds them. Everything the buttons
// report, and what Discard goes back to, is measured against this.
let savedDb = null;

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

/**
 * GitHub marks this response cacheable for a minute, so after a clash the
 * browser would hand back the very sha that was just rejected. A forced
 * read goes past the cache.
 */
async function currentSha(fresh = false) {
  if (fileSha && !fresh) return fileSha;
  const path = `/repos/${REPO.owner}/${REPO.repo}/contents/${REPO.path}?ref=${REPO.branch}`;
  const meta = await gh(fresh ? `${path}&t=${Date.now()}` : path, { cache: 'no-store' });
  fileSha = meta.sha;
  return fileSha;
}

/**
 * The published workbook moved on since this page read it. Saving replaces
 * it wholesale, so whatever was saved elsewhere in between would go.
 */
function confirmOverwrite() {
  return confirm(
    'The published workbook has changed since this page loaded.\n\n'
    + 'Saving replaces it with the figures on this screen, so any change made '
    + 'elsewhere since then is lost.\n\n'
    + 'OK to save anyway, or Cancel to leave the newer file alone.',
  );
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
    const put = async (sha) => gh(`/repos/${REPO.owner}/${REPO.repo}/contents/${REPO.path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Update figures from the web app',
        content,
        branch: REPO.branch,
        sha,
      }),
    });

    // A clash means the published file moved on. Ask once, then take the
    // sha it actually has now; a second clash is a race worth one more go.
    let res;
    for (let attempt = 1; ; attempt += 1) {
      try {
        res = await put(await currentSha(attempt > 1));
        break;
      } catch (e) {
        const clash = e.status === 409 || e.status === 422;
        if (!clash || attempt === 3) throw e;
        if (attempt === 1 && !confirmOverwrite()) {
          setStatus('Save cancelled — the published file is newer');
          return;
        }
      }
    }

    fileSha = res.content.sha;
    // What we just pushed is now the published file.
    localStorage.setItem(BASELINE_KEY, await digest(bytes));
    markSaved();
    setStatus(`Saved ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    if (e.status === 401) {
      // An expired or revoked token will not start working on a retry.
      forgetToken();
      setStatus('Token rejected — connect again', true);
    } else if (e.status === 409 || e.status === 422) {
      setStatus('Save failed — the published file keeps changing. Try again in a moment.', true);
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
    setStatus(changedRows() ? `${changedRows()} unsaved` : 'Connected');
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
noteActivity();

// Edits live in this browser until they are saved, so leaving with some
// still pending is worth a word.
window.addEventListener('beforeunload', (e) => {
  if (!changedRows()) return;
  e.preventDefault();
  e.returnValue = '';
});
