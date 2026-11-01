'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const officeCrypto = require('officecrypto-tool');
const { tables } = require('./schema');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'finance.xlsx');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 30;

/**
 * The workbook is held in memory and written back on every mutation. Writes are
 * chained on a single promise so two concurrent requests can never interleave a
 * read-modify-write and lose a row.
 */
let cache = null;
let writeChain = Promise.resolve();

const password = () => process.env.DATA_PASSWORD || process.env.APP_PASSWORD || '9987';

function isEncrypted(buf) {
  try {
    return officeCrypto.isEncrypted(buf);
  } catch {
    return false;
  }
}

/** Dates are stored as ISO day strings so there is no timezone drift. */
function cellToValue(v, type) {
  if (v === undefined || v === null || v === '') return null;
  if (type === 'date') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') {
      const d = XLSX.SSF.parse_date_code(v);
      if (!d) return null;
      return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    return String(v).slice(0, 10);
  }
  if (type === 'number' || type === 'money' || type === 'percent' || type === 'int') {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return String(v);
}

function sheetToRows(ws, def) {
  if (!ws) return [];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  if (!raw.length) return [];
  const header = raw[0].map((h) => (h === null ? '' : String(h).trim()));
  const index = {};
  header.forEach((h, i) => { index[h] = i; });

  return raw.slice(1).map((r) => {
    const row = {};
    for (const col of def.columns) {
      if (col.computed) continue;
      const i = index[col.key];
      row[col.key] = i === undefined ? null : cellToValue(r[i], col.type);
    }
    return row;
  }).filter((row) => def.columns.some((c) => !c.computed && row[c.key] !== null && row[c.key] !== ''));
}

function rowsToSheet(rows, def) {
  const cols = def.columns.filter((c) => !c.computed);
  const header = cols.map((c) => c.key);
  const body = rows.map((row) => cols.map((c) => {
    const v = row[c.key];
    return v === undefined ? null : v;
  }));
  return XLSX.utils.aoa_to_sheet([header, ...body]);
}

function readWorkbook() {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`Database not found at ${DATA_FILE}. Run "npm run import" first.`);
  }
  let buf = fs.readFileSync(DATA_FILE);
  if (isEncrypted(buf)) {
    // officecrypto-tool's decrypt is async-shaped but resolves synchronously for
    // the buffer path; we await it in load() instead.
    return { buf, encrypted: true };
  }
  return { buf, encrypted: false };
}

async function load({ force = false } = {}) {
  if (cache && !force) return cache;
  const { buf, encrypted } = readWorkbook();
  const plain = encrypted ? await officeCrypto.decrypt(buf, { password: password() }) : buf;
  const wb = XLSX.read(plain, { cellDates: false });

  const db = {};
  for (const [name, def] of Object.entries(tables)) {
    db[name] = sheetToRows(wb.Sheets[name], def);
  }
  cache = { db, encrypted };
  return cache;
}

function backup() {
  if (!fs.existsSync(DATA_FILE)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `finance-${stamp}.xlsx`));

  const kept = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.xlsx')).sort();
  for (const old of kept.slice(0, Math.max(0, kept.length - MAX_BACKUPS))) {
    fs.unlinkSync(path.join(BACKUP_DIR, old));
  }
}

/** Serialise every write, back up the previous file, then swap in atomically. */
function save() {
  writeChain = writeChain.then(async () => {
    if (!cache) throw new Error('Nothing loaded to save');
    const wb = XLSX.utils.book_new();
    for (const [name, def] of Object.entries(tables)) {
      XLSX.utils.book_append_sheet(wb, rowsToSheet(cache.db[name] || [], def), name);
    }
    let out = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    if (cache.encrypted) {
      out = await officeCrypto.encrypt(out, { password: password() });
    }

    backup();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, DATA_FILE);
  });
  return writeChain;
}

/** Build the database file from scratch (used by the importer). */
async function writeFresh(db, { encrypt = true } = {}) {
  const wb = XLSX.utils.book_new();
  for (const [name, def] of Object.entries(tables)) {
    XLSX.utils.book_append_sheet(wb, rowsToSheet(db[name] || [], def), name);
  }
  let out = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  if (encrypt) out = await officeCrypto.encrypt(out, { password: password() });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, out);
  cache = null;
  return DATA_FILE;
}

module.exports = { load, save, writeFresh, DATA_FILE, DATA_DIR, invalidate: () => { cache = null; } };
