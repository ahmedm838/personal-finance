'use strict';

const XLSX = require('xlsx');

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

module.exports = { cellToValue, sheetToRows, rowsToSheet };
