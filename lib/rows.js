'use strict';

/** Coerce an incoming value to the column's storage type. */
function coerce(col, value) {
  if (value === null || value === undefined || value === '') {
    return col.type === 'text' || col.type === 'select' ? '' : null;
  }
  switch (col.type) {
    case 'number':
    case 'money':
    case 'percent': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`"${col.label}" must be a number`);
      return n;
    }
    case 'int': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`"${col.label}" must be a number`);
      return Math.round(n);
    }
    case 'date': {
      const s = String(value).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`"${col.label}" must be a date`);
      return s;
    }
    default:
      return String(value);
  }
}

/** Build a storable row from untrusted input, leaving computed columns alone. */
function sanitise(def, input, base = {}) {
  const row = { ...base };
  for (const col of def.columns) {
    if (col.computed || col.readOnly) continue;
    if (!(col.key in input)) continue;
    row[col.key] = coerce(col, input[col.key]);
  }
  for (const col of def.columns) {
    if (col.computed) continue;
    if (!(col.key in row)) row[col.key] = col.type === 'text' || col.type === 'select' ? '' : null;
  }
  return row;
}

module.exports = { coerce, sanitise };
