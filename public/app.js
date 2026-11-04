'use strict';

let state = null;
let activeTab = null;
const filters = {};
const sorts = {};
const quick = {};
// The order each table was last drawn in, so a row does not move under
// the cursor while its own edits are still unsaved.
const held = {};

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) n.append(k);
  return n;
};

// --- Formatting -------------------------------------------------------------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 2026-11-01 reads as 01-11-2026; anything else is left alone. */
const asDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(v ?? '');
};

const fmt = {
  money: (v) => (isNum(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''),
  number: (v) => (isNum(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 3 }) : ''),
  int: (v) => (isNum(v) ? String(Math.round(v)) : ''),
  percent: (v) => (isNum(v) ? `${(v * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%` : ''),
  date: (v) => asDate(v),
  text: (v) => (v === null || v === undefined ? '' : String(v)),
};

const display = (col, v) => {
  if (col.whole) return whole(v);
  if (col.fixedPercent !== undefined) return isNum(v) ? `${(v * 100).toFixed(col.fixedPercent)}%` : '';
  return (fmt[col.type] || fmt.text)(v);
};
const whole = (v) => (isNum(v) ? Math.round(v).toLocaleString('en-US') : '');
const wholePercent = (v) => (isNum(v) ? `${Math.round(v * 100).toLocaleString('en-US')}%` : '');

const card = (k, v, cls = '') => el('div', { className: 'card' }, [
  el('div', { className: 'k', textContent: k }),
  el('div', { className: `v ${cls}`, textContent: v }),
]);
const numeric = (col) => ['money', 'number', 'int', 'percent'].includes(col.type);

function toast(message, bad = false) {
  const t = $('#toast');
  t.textContent = message;
  t.className = `toast${bad ? ' bad' : ''}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, bad ? 5000 : 2200);
}

// --- API --------------------------------------------------------------------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error('Signed out'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

/** Every mutation returns the whole payload, so totals stay in step. */
/** The background repo write finished, so the save count may have moved. */
window.addEventListener('finance:sync', async () => {
  try {
    state = await api('GET', '/api/data');
    render();
  } catch {
    // A failed refresh leaves the screen as it was, which is still right.
  }
});

async function mutate(method, url, body, note) {
  try {
    state = await api(method, url, body);
    render();
    if (note) toast(note);
  } catch (e) {
    if (e.message !== 'Signed out') toast(e.message, true);
  }
}

// --- Cell editors -----------------------------------------------------------

/**
 * Number inputs show a formatted value at rest and the raw number while
 * focused, so a long figure stays readable without blocking editing.
 */
function numberInput(col, value, commit) {
  const input = el('input', {
    type: 'text',
    inputMode: 'decimal',
    className: 'num',
    value: display(col, value),
  });

  input.addEventListener('focus', () => {
    input.value = isNum(value) ? (col.type === 'percent' ? value * 100 : value) : '';
    input.select();
  });

  const apply = () => {
    const raw = input.value.trim().replace(/[,%\s]/g, '');
    if (raw === '') return commit(null);
    const n = Number(raw);
    if (!Number.isFinite(n)) { toast(`"${input.value}" is not a number`, true); input.value = display(col, value); return undefined; }
    return commit(col.type === 'percent' ? n / 100 : n);
  };

  input.addEventListener('blur', apply);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = display(col, value); input.blur(); }
  });
  return input;
}

function optionsFor(col) {
  if (col.options) {
    return col.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  }
  if (col.optionsFrom) {
    const [table, key] = col.optionsFrom.split('.');
    const seen = new Set();
    for (const r of state.data[table].rows) if (r[key]) seen.add(r[key]);
    return [...seen].map((v) => ({ value: v, label: v }));
  }
  return [];
}

function cellEditor(col, value, commit) {
  if (col.type === 'select') {
    const sel = el('select');
    const opts = optionsFor(col);
    if (!opts.some((o) => o.value === (value ?? ''))) opts.unshift({ value: value ?? '', label: value || '—' });
    for (const o of opts) sel.append(el('option', { value: o.value, textContent: o.label, selected: o.value === (value ?? '') }));
    sel.addEventListener('change', () => commit(sel.value));
    return sel;
  }
  if (col.type === 'date') {
    const input = el('input', { type: 'date', value: value || '' });
    // Committing on `change` fires the moment the date becomes valid, which
    // is part way through typing the year. The redraw that follows puts the
    // caret back on the first segment, so the year can never be finished.
    const apply = () => { if (input.value !== (value || '')) commit(input.value || null); };
    input.addEventListener('blur', apply);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    return input;
  }
  if (numeric(col)) return numberInput(col, value, commit);

  const input = el('input', { type: 'text', value: value ?? '' });
  const apply = () => commit(input.value);
  input.addEventListener('blur', () => { if (input.value !== (value ?? '')) apply(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = value ?? ''; input.blur(); }
  });
  return input;
}

/** True when the value is calculated for this particular row. */
function isDerivedHere(tableName, col, row, index) {
  if (col.computed) return true;
  if (!col.derived) return false;
  // A linked row takes its figure from another tab, so there is nothing to
  // type in its own currency either.
  if (tableName === 'Entries' && col.key === 'fx_amount') return Boolean(row.link);
  if (tableName === 'Expenses' && col.key === 'amount') return Boolean(row.link);
  // The first year is the base the rest of the projection grows from.
  if (tableName === 'CashFlow' && (col.key === 'expenses' || col.key === 'deposits')) return index > 0;
  // The plan opens on a fixed date and age, so not even the first line is typed.
  if (tableName === 'YunisProjection' && (col.key === 'age' || col.key === 'date')) return true;
  if (tableName === 'Horizon') {
    const earns = row.item === 'Deposits' || row.item === 'Invested';
    // Value always comes from the projection. The two lines with capital
    // behind them earn their income from a rate; the rest are typed in.
    if (col.key === 'value') return true;
    if (col.key === 'rate') return !earns;
    if (col.key === 'income') return earns;
  }
  return false;
}

/**
 * A form for one whole row. Cell-by-cell editing stays the quick path; this
 * is for tables wide enough that picking out a single cell is fiddly, and it
 * sends one request instead of one per field.
 */
function openRowEditor(tableName, index) {
  const def = state.schema[tableName];
  const row = state.data[tableName].rows[index];
  const draft = {};

  const fields = def.columns
    .filter((col) => !col.computed && !col.readOnly && !isDerivedHere(tableName, col, row, index))
    .map((col) => el('label', { className: 'field' }, [
      el('span', { textContent: col.label }),
      cellEditor(col, row[col.key], (v) => { draft[col.key] = v; }),
    ]));

  const dlg = el('dialog', { className: 'row-editor' });
  const cancel = el('button', { className: 'btn ghost', textContent: 'Cancel', type: 'button' });
  const save = el('button', { className: 'btn primary', textContent: 'Save', type: 'button' });

  cancel.addEventListener('click', () => dlg.close());
  save.addEventListener('click', () => {
    dlg.close();
    if (Object.keys(draft).length) mutate('PATCH', `/api/${tableName}/rows/${index}`, draft, 'Row updated');
  });
  dlg.addEventListener('close', () => dlg.remove());

  dlg.append(
    el('h2', { textContent: `Edit ${def.label}` }),
    el('div', { className: 'fields' }, fields),
    el('div', { className: 'dialog-actions' }, [cancel, save]),
  );
  document.body.append(dlg);
  dlg.showModal();
}

// --- Table rendering --------------------------------------------------------

/**
 * Totals over whichever rows are on screen. The payload carries totals for
 * the whole table; once a filter hides rows, a total counting them is a lie.
 */
function totalsFor(def, rows) {
  if (!def.totals) return null;
  const column = (key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

  const out = {};
  for (const [key, how] of Object.entries(def.totals)) {
    if (how === 'sum') {
      out[key] = column(key);
    } else if (how === 'net') {
      // A liability is owed, not owned, so it comes off the total.
      const spec = def.net;
      const chart = (state.data[spec.table] || { rows: [] }).rows;
      const side = new Map(chart.map((r) => [r[spec.key], r[spec.level]]));
      out[key] = rows.reduce((t, r) => {
        const owed = spec.negative.includes(side.get(r[spec.on]));
        return t + (owed ? -1 : 1) * (Number(r[key]) || 0);
      }, 0);
    } else if (how.startsWith('wavg:')) {
      const weight = how.slice(5);
      const total = column(weight);
      out[key] = total
        ? rows.reduce((t, r) => t + (Number(r[key]) || 0) * (Number(r[weight]) || 0), 0) / total
        : 0;
    }
  }
  return out;
}

/**
 * What a column sorts on: its own value, or one its value stands for in
 * another table, such as an account name and the code it is filed under.
 */
function sortValue(col) {
  if (!col.sortBy) return (row) => row[col.key];
  const { table, on, take } = col.sortBy;
  const rows = (state.data[table] || { rows: [] }).rows;
  const code = new Map(rows.map((r) => [r[on], r[take]]));
  return (row) => code.get(row[col.key]);
}

/**
 * Which values of the matched column still count, given what is picked in
 * the quick filters. Null means nothing is picked, so everything counts.
 */
function quickScope(def, chosen) {
  const qf = def.quickFilters;
  if (!qf) return null;
  const picked = qf.levels.filter((l) => chosen[l.key]);
  if (!picked.length) return null;

  const rows = (state.data[qf.table] || { rows: [] }).rows;
  const under = rows.filter((r) => picked.every((l) => r[l.key] === chosen[l.key]));
  return new Set(under.map((r) => r[qf.key]));
}

/** Dropdowns above the table, one per level, each narrowing the next. */
function quickFilterBar(name, def) {
  const qf = def.quickFilters;
  const chosen = quick[name] || {};
  const rows = (state.data[qf.table] || { rows: [] }).rows;

  const bar = el('div', { className: 'quick-filters' });
  qf.levels.forEach((level, i) => {
    // Each box offers only what the boxes before it still allow.
    const above = qf.levels.slice(0, i).filter((l) => chosen[l.key]);
    const pool = rows.filter((r) => above.every((l) => r[l.key] === chosen[l.key]));
    const options = [...new Set(pool.map((r) => r[level.key]).filter(Boolean))].sort();

    const select = el('select');
    select.append(el('option', { value: '', textContent: 'All' }));
    for (const o of options) select.append(el('option', { value: o, textContent: o }));
    select.value = chosen[level.key] || '';
    select.dataset.cell = `${name}:quick:${level.key}`;
    select.addEventListener('change', () => {
      const next = { ...chosen, [level.key]: select.value };
      // A narrower box cannot keep a choice its parent has ruled out.
      for (const deeper of qf.levels.slice(i + 1)) next[deeper.key] = '';
      quick[name] = next;
      render();
    });

    bar.append(el('label', { className: 'quick' }, [
      el('span', { textContent: level.label }),
      select,
    ]));
  });

  if (qf.levels.some((l) => chosen[l.key])) {
    const clear = el('button', { className: 'btn ghost', textContent: 'Clear', type: 'button' });
    clear.addEventListener('click', () => { delete quick[name]; render(); });
    bar.append(clear);
  }
  return bar;
}

/** A box under each heading that narrows the rows as you type. */
function filterRow(name, def) {
  const tr = el('tr', { className: 'filter-row' });
  for (const col of def.columns) {
    const input = el('input', { type: 'text', value: (filters[name] || {})[col.key] || '', placeholder: 'Filter' });
    input.setAttribute('aria-label', `Filter by ${col.label}`);
    input.dataset.cell = `${name}:filter:${col.key}`;
    input.addEventListener('input', () => {
      filters[name] = { ...(filters[name] || {}), [col.key]: input.value };
      render();
    });
    tr.append(el('th', {}, input));
  }
  tr.append(el('th', { className: 'actions-cell' }));
  return tr;
}

// Below this a heading breaks into single letters and a figure wraps, so
// no column goes narrower, even one the schema says nothing about.
const MIN_COLUMN = 92;

/**
 * How wide a column asks to be.
 *
 * A declared width is both what the column wants and the least it will
 * take; whatever room is left over after that the browser shares out.
 */
function columnWidth(col) {
  if (col.width) return `width:${col.width}px;min-width:${col.width}px`;
  return `min-width:${MIN_COLUMN}px`;
}

function renderGrid(name) {
  const def = state.schema[name];
  const { rows, totals } = state.data[name];

  const order = sorts[name] || def.defaultSort || null;
  const thead = el('thead', {}, el('tr', {}, [
    ...def.columns.map((c) => {
      const th = el('th', {
        className: numeric(c) ? 'num' : '',
        title: c.hint || '',
        style: columnWidth(c),
      });

      if (!(def.sortable || []).includes(c.key)) {
        th.textContent = c.label;
        return th;
      }

      // Click once for ascending, again for descending, again for the
      // order the rows are stored in.
      const dir = order && order.key === c.key ? order.dir : null;
      const arrow = dir === 'asc' ? ' \u25b2' : dir === 'desc' ? ' \u25bc' : '';
      const button = el('button', { type: 'button', className: 'sort', textContent: c.label + arrow });
      button.addEventListener('click', () => {
        const next = dir === null ? 'asc' : dir === 'asc' ? 'desc' : null;
        if (next) sorts[name] = { key: c.key, dir: next };
        else delete sorts[name];
        // Asking for an order is asking for it now, unsaved rows and all.
        delete held[name];
        render();
      });
      th.append(button);
      return th;
    }),
    el('th', { className: 'actions-cell' }),
  ]));

  if (def.filters) thead.append(filterRow(name, def));

  const active = filters[name] || {};
  const scope = quickScope(def, quick[name] || {});
  const filtering = scope !== null || Object.values(active).some((v) => v && v.trim());
  const shown = (row) => {
    if (scope && !scope.has(row[def.quickFilters.on])) return false;
    return def.columns.every((col) => {
      const q = (active[col.key] || '').trim().toLowerCase();
      return !q || String(display(col, row[col.key])).toLowerCase().includes(q);
    });
  };

  // Rows keep their stored position, because that is what an edit or a
  // delete addresses; only the order they are drawn in changes.
  const entries = rows.map((row, i) => ({ row, i })).filter(({ row }) => shown(row));

  // Once something is waiting to be saved the table stops reordering, so
  // naming the account of a new row leaves it where it was typed. A save,
  // a discard or a click on a heading sorts it afresh.
  const keeping = state.unsaved > 0 && held[name];
  if (keeping) {
    const at = new Map(keeping.map((i, n) => [i, n]));
    // A row added since is not in the order yet, so it falls to the end.
    entries.sort((a, b) => (at.has(a.i) ? at.get(a.i) : Infinity) - (at.has(b.i) ? at.get(b.i) : Infinity));
  } else if (order) {
    const col = def.columns.find((c) => c.key === order.key);
    const sign = order.dir === 'desc' ? -1 : 1;
    const value = sortValue(col);
    const tieCol = col.thenBy && def.columns.find((c) => c.key === col.thenBy);
    const tie = tieCol ? sortValue(tieCol) : null;

    entries.sort((a, b) => {
      const first = numeric(col) && !col.sortBy
        ? (Number(value(a.row)) || 0) - (Number(value(b.row)) || 0)
        : String(value(a.row) ?? '').localeCompare(String(value(b.row) ?? ''), undefined, { numeric: true });
      if (first) return sign * first;
      // Rows that tie read A-Z, whichever way the column itself is sorted.
      return tie ? String(tie(a.row) ?? '').localeCompare(String(tie(b.row) ?? '')) : 0;
    });
  }
  held[name] = entries.map((e) => e.i);
  const visibleRows = entries.map((e) => e.row);

  const tbody = el('tbody');
  entries.forEach(({ row, i }) => {
    const tr = el('tr');
    for (const col of def.columns) {
      const td = el('td', { className: numeric(col) ? 'num' : '' });
      if (col.readOnly || isDerivedHere(name, col, row, i)) {
        td.append(el('span', {
          className: 'ro calc',
          textContent: display(col, row[col.key]),
          title: 'Calculated',
        }));
      } else {
        const editor = cellEditor(col, row[col.key], (v) => {
          if (v === row[col.key]) return;
          mutate('PATCH', `/api/${name}/rows/${i}`, { [col.key]: v });
        });
        editor.dataset.cell = `${name}:${i}:${col.key}`;
        td.append(editor);
      }
      tr.append(td);
    }

    const actions = [];
    if (def.rowEditor) {
      const edit = el('button', { className: 'icon-btn edit', textContent: '✎', title: 'Edit row', type: 'button' });
      edit.addEventListener('click', () => openRowEditor(name, i));
      actions.push(edit);
    }

    const del = el('button', { className: 'icon-btn', textContent: '✕', title: 'Delete row', type: 'button' });
    del.addEventListener('click', () => {
      const label = row[def.columns[0].key] || `row ${i + 1}`;
      if (!confirm(`Delete "${label}"?`)) return;
      // Deleting renumbers the rows after it, so the kept order is void.
      delete held[name];
      mutate('DELETE', `/api/${name}/rows/${i}`, null, 'Row deleted');
    });
    actions.push(del);
    tr.append(el('td', { className: 'actions-cell' }, actions));
    tbody.append(tr);
  });

  const parts = [thead, tbody];

  /** One summary line across the columns, labelled in the first cell. */
  const footRow = (label, valueFor, format) => {
    const tr = el('tr');
    def.columns.forEach((col, idx) => {
      const value = valueFor(col);
      const text = format === 'int' ? whole(value) : display(col, value);
      tr.append(el('td', {
        className: numeric(col) ? 'num' : '',
        textContent: value !== undefined ? text : (idx === 0 ? label : ''),
      }));
    });
    tr.append(el('td', { className: 'actions-cell' }));
    return tr;
  };

  const feet = [];
  if (totals) {
    const shownTotals = filtering ? totalsFor(def, visibleRows) : totals;
    let counted = '';
    if (filtering) counted = ` (${visibleRows.length} of ${rows.length})`;
    else if (def.countInTotal) counted = ` (${rows.length})`;

    feet.push(footRow(`Total${counted}`, (col) => (Object.prototype.hasOwnProperty.call(shownTotals, col.key) ? shownTotals[col.key] : undefined)));
  }
  for (const extra of def.footRows || []) {
    feet.push(footRow(extra.label, (col) => (col.key === extra.key ? state.derived[extra.derived] : undefined), extra.format));
  }
  if (feet.length) parts.push(el('tfoot', {}, feet));

  return el('div', { className: 'grid-wrap' }, el('table', {}, parts));
}

function renderKeyed(name) {
  const def = state.schema[name];
  const { rows } = state.data[name];
  const valueCol = def.columns.find((c) => !c.readOnly);

  const worked = new Set(def.derivedKeys || []);
  const formats = def.formatKeys || {};

  const written = (key, v) => {
    if (formats[key] === 'percent') return isNum(v) ? `${(v * 100).toFixed(2)}%` : '';
    if (formats[key] === 'fixed3') return isNum(v) ? v.toFixed(3) : '';
    if (formats[key] === 'whole') return whole(v);
    return display(valueCol, v);
  };

  const wrap = el('div', { className: 'fields' });
  rows.forEach((row, i) => {
    let control;
    if (worked.has(row.key)) {
      control = el('span', { className: 'ro calc', textContent: written(row.key, row[valueCol.key]), title: 'Calculated' });
    } else {
      const asPercent = formats[row.key] === 'percent';
      const shown = asPercent
        // 0.07 * 100 is 7.000000000000001 in binary floating point; the box
        // should read 7.
        ? (isNum(row[valueCol.key]) ? String(Number((row[valueCol.key] * 100).toFixed(6))) : '')
        : (row[valueCol.key] ?? '');

      const input = el('input', { type: 'text', value: shown });
      input.dataset.cell = `${name}:${i}:${valueCol.key}`;
      const commit = () => {
        if (input.value === String(shown)) return;
        const typed = input.value.trim().replace('%', '');
        const next = asPercent ? Number(typed) / 100 : input.value;
        mutate('PATCH', `/api/${name}/rows/${i}`, { [valueCol.key]: next });
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      control = input;
    }

    wrap.append(el('div', { className: 'field' }, [
      el('label', { textContent: row.label || row.key }),
      el('div', { className: 'row' }, [control, el('span', { className: 'unit', textContent: row.unit || '' })]),
    ]));
  });
  return wrap;
}

/**
 * On the published site nothing is written back until this is pressed. The
 * database is one workbook, so it saves every pending change, not just this
 * section's — the count says how many are waiting.
 */
/** Throws away everything since the last save, in every tab. */
function discardButton() {
  const n = state.unsaved || 0;
  const b = el('button', {
    className: 'btn',
    type: 'button',
    textContent: 'Discard',
    disabled: !n,
    title: n ? 'Throws away every unsaved change, in every tab.' : 'Nothing to discard.',
  });
  b.addEventListener('click', () => {
    if (!confirm(`Discard ${n} unsaved ${n === 1 ? 'row' : 'rows'}? This cannot be undone.`)) return;
    mutate('POST', '/api/discard', null, 'Changes discarded');
  });
  return b;
}

function saveButton() {
  const n = state.unsaved || 0;
  const b = el('button', {
    className: n ? 'btn primary' : 'btn',
    type: 'button',
    textContent: n ? `Save (${n})` : 'Saved',
    disabled: !n,
    title: n ? `Writes ${n} changed row(s), from every tab, back to the repo.` : 'Nothing waiting to be saved.',
  });
  // The write to the repo carries on in the background; the status line
  // beside the header says when it lands, or why it did not.
  b.addEventListener('click', () => mutate('POST', '/api/save', null, 'Saving to the repo…'));
  return b;
}

function renderTablePanel(name) {
  const def = state.schema[name];
  const head = el('div', { className: 'panel-head' }, el('h2', { textContent: def.label }));
  const actions = [];

  if (!def.keyed) {
    const add = el('button', { className: 'btn', textContent: '+ Add row', type: 'button' });
    add.addEventListener('click', async () => {
      await mutate('POST', `/api/${name}/rows`, {}, 'Row added');
      const last = state.data[name].rows.length - 1;
      const first = def.columns.find((c) => !c.computed && !c.readOnly);
      const cell = document.querySelector(`[data-cell="${name}:${last}:${first.key}"]`);
      if (cell) {
        cell.scrollIntoView({ block: 'nearest' });
        cell.focus();
      }
    });
    actions.push(add);
  }
  if (state.save === 'manual') actions.push(discardButton(), saveButton());

  return el('section', { className: 'panel' }, [
    head,
    el('div', { className: def.keyed ? 'panel-body' : '' }, def.keyed
      ? renderKeyed(name)
      : [...(def.quickFilters ? [quickFilterBar(name, def)] : []), renderGrid(name)]),
    ...(actions.length ? [el('div', { className: 'panel-foot' }, actions)] : []),
  ]);
}

// --- Balance sheet ----------------------------------------------------------

function sideTable(title, groups, total) {
  const tbody = el('tbody');
  for (const g of groups) {
    tbody.append(el('tr', { className: 'bs-section' }, [
      el('td', { textContent: g.section }),
      el('td', { className: 'num', textContent: whole(g.total) }),
    ]));
    for (const line of g.lines) {
      tbody.append(el('tr', { className: 'bs-line' }, [
        el('td', { textContent: line.label }),
        el('td', { className: 'num', textContent: whole(line.amount) }),
      ]));
    }
  }
  tbody.append(el('tr', { className: 'bs-total' }, [
    el('td', { textContent: 'Total' }),
    el('td', { className: 'num', textContent: whole(total) }),
  ]));

  return el('section', { className: 'panel' }, [
    el('div', { className: 'panel-head' }, el('h2', { textContent: title })),
    el('div', { className: 'grid-wrap' }, el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { textContent: title }),
        el('th', { className: 'num', textContent: 'Amount' }),
      ])),
      tbody,
    ])),
  ]);
}

/**
 * How old the rate is matters: the CBE publishes around midday Cairo time
 * and the mirror follows some hours later, so a morning visit sees the
 * previous working day's figure.
 */
function rateNote(d) {
  if (d.rateOverridden) {
    return 'USD and EUR holdings are valued at the rates typed into Settings, not the CBE feed.';
  }
  if (!d.rateIsLive) {
    return 'No rates available, so foreign holdings cannot be valued. Type a rate into Settings, or run the rate fetch.';
  }

  const age = d.rateAgeDays;
  let when = '';
  if (age === 0) when = ' — today';
  else if (age === 1) when = ' — yesterday';
  else if (age > 1) when = ` — ${age} days ago`;

  const base = `USD and EUR holdings are valued at the CBE sell rate for ${asDate(d.rateDate)}${when}.`;
  return d.rateAttribution ? `${base} Rates via ${d.rateAttribution}.` : base;
}

function renderBalance() {
  const b = state.balance;
  const s = b.summary;
  const d = state.derived;
  const rate = (v) => (isNum(v) ? v.toFixed(4) : '—');
  const frag = document.createDocumentFragment();


  frag.append(el('div', { className: 'cards' }, [
    card('Capital paid', whole(s.capitalPaid)),
    card('Equity', whole(s.equity)),
    card('Profit & loss', whole(s.profit), s.profit >= 0 ? 'pos' : 'neg'),
    card('Return on capital', wholePercent(s.overYears), s.overYears >= 0 ? 'pos' : 'neg'),
    card('Years tracked', s.years.toFixed(1)),
    card('Average per year', wholePercent(s.averagePerYear)),
    card('USD Ex. Rate', rate(d.usdRate)),
    card('EUR Ex. Rate', rate(d.eurRate)),
    card('Earnings', whole(d.monthlyEarnings)),
    card('Expenses', whole(d.expensesTotal)),
    card('Deposits (EGP)', whole(d.egpDeposits)),
    card('Deposits (USD)', whole(d.usdDeposits)),
  ]));

  frag.append(el('p', {
    className: 'hint',
    textContent: 'Assets and liabilities are calculated from the Assets & Liabilities tab. Capital is editable below.',
  }));

  frag.append(el('p', { className: 'hint', textContent: rateNote(d) }));

  frag.append(el('div', { className: 'columns' }, [
    sideTable('Assets', b.assets, b.totals.assets),
    sideTable('Liabilities', b.liabilities, b.totals.liabilities),
    renderTablePanel('Capital'),
  ]));

  return frag;
}

/** Headline figures for the deposits tab: when interest lands, and how much. */
function renderDepositsSummary() {
  const s = state.derived.deposits;
  // td has no padding of its own: grid cells get it from the input inside,
  // and read-only ones from .ro. The totals row is padded by tfoot td.
  const cell = (text, num = true) => el('td', { className: num ? 'num' : '' }, el('span', { className: 'ro', textContent: text }));
  const foot = (text, num = true) => el('td', { className: num ? 'num' : '', textContent: text });

  const head = el('thead', {}, el('tr', {}, [
    el('th', { textContent: 'Day' }),
    el('th', { className: 'num', textContent: 'EGP' }),
    el('th', { className: 'num', textContent: 'USD' }),
    el('th', { className: 'num', textContent: 'Deposits' }),
    el('th', { className: 'num', textContent: 'Banks' }),
  ]));

  const body = el('tbody', {}, s.schedule.map((r) => el('tr', {}, [
    cell(fmt.int(r.day), false),
    cell(r.egp ? whole(r.egp) : ''),
    cell(r.usd ? whole(r.usd) : ''),
    cell(fmt.int(r.count)),
    cell(fmt.int(r.banks)),
  ])));

  const totals = el('tfoot', {}, el('tr', {}, [
    foot('Total', false),
    foot(whole(s.egp)),
    foot(whole(s.usd)),
    foot(fmt.int(s.count)),
    foot(fmt.int(s.banks)),
  ]));

  return el('section', { className: 'panel' }, [
    el('div', { className: 'panel-head' }, el('h2', { textContent: 'Monthly returns' })),
    el('div', { className: 'grid-wrap' }, el('table', {}, [head, body, totals])),
    el('p', {
      className: 'hint',
      textContent: s.undated
        ? `Interest is shown in each deposit's own currency. ${s.undated} deposit(s) have no start date, so they have no day to land on.`
        : "Interest is shown in each deposit's own currency, on the day of the month it lands.",
    }),
  ]);
}

// --- Shell ------------------------------------------------------------------

function render({ toTop = false } = {}) {
  const scroll = window.scrollY;
  const active = document.activeElement;
  const cell = active && active.dataset ? active.dataset.cell : null;
  const caret = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;

  $('#as-of').textContent = `as of ${asDate(state.balance.asOf)}`;

  const tabsBar = $('#tabs');
  tabsBar.replaceChildren();
  for (const tab of state.tabs) {
    const b = el('button', { type: 'button', textContent: tab.label, role: 'tab' });
    b.setAttribute('aria-selected', String(tab.id === activeTab));
    b.addEventListener('click', () => { activeTab = tab.id; render({ toTop: true }); });
    tabsBar.append(b);
  }

  const tab = state.tabs.find((t) => t.id === activeTab) || state.tabs[0];
  const content = $('#content');
  content.replaceChildren();

  if (tab.view === 'balance') {
    content.append(renderBalance());
  } else {
    if (tab.summary === 'deposits') content.append(renderDepositsSummary());
    for (const name of tab.tables) content.append(renderTablePanel(name));
  }
  for (const row of content.querySelectorAll('tr.filter-row')) {
    const heading = row.previousElementSibling;
    if (!heading) continue;
    for (const th of row.children) th.style.top = `${heading.offsetHeight}px`;
  }

  if (toTop) {
    window.scrollTo({ top: 0 });
    return;
  }

  const again = cell ? document.querySelector(`[data-cell="${cell}"]`) : null;
  if (again) {
    // preventScroll matters: focusing an off-screen cell would scroll to it
    // and undo the position we are restoring on the next line.
    again.focus({ preventScroll: true });
    if (caret !== null && typeof again.setSelectionRange === 'function') {
      // Not every input type allows a selection range; losing the caret is
      // better than throwing here.
      try { again.setSelectionRange(caret, caret); } catch { /* ignore */ }
    }
  }
  window.scrollTo({ top: scroll });
}

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#password').value = '';
  $('#password').focus();
}

async function start() {
  state = await api('GET', '/api/data');
  activeTab = activeTab || state.tabs[0].id;
  $('#login').hidden = true;
  $('#app').hidden = false;
  render({ toTop: true });
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('POST', '/api/login', { password: $('#password').value });
    await start();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  showLogin();
});

(async () => {
  const { authed } = await api('GET', '/api/session').catch(() => ({ authed: false }));
  if (authed) await start().catch(showLogin);
  else showLogin();
})();
