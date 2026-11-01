'use strict';

let state = null;
let activeTab = null;
const filters = {};

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) n.append(k);
  return n;
};

// --- Formatting -------------------------------------------------------------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const fmt = {
  money: (v) => (isNum(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''),
  number: (v) => (isNum(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 3 }) : ''),
  int: (v) => (isNum(v) ? String(Math.round(v)) : ''),
  percent: (v) => (isNum(v) ? `${(v * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%` : ''),
  date: (v) => v || '',
  text: (v) => (v === null || v === undefined ? '' : String(v)),
};

const display = (col, v) => (fmt[col.type] || fmt.text)(v);
const whole = (v) => (isNum(v) ? Math.round(v).toLocaleString('en-US') : '');

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
    input.addEventListener('change', () => commit(input.value || null));
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
  if (tableName === 'Entries' && col.key === 'amount') {
    return Boolean(row.link) || (row.currency && row.currency !== 'EGP');
  }
  if (tableName === 'Expenses' && col.key === 'amount') return Boolean(row.link);
  // The first year is the base the rest of the projection grows from.
  if (tableName === 'CashFlow' && col.key === 'expenses') return index > 0;
  if (tableName === 'Horizon' && col.key === 'value') return row.item === 'Deposits' || row.item === 'Invested';
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

function renderGrid(name) {
  const def = state.schema[name];
  const { rows, totals } = state.data[name];

  const thead = el('thead', {}, el('tr', {}, [
    ...def.columns.map((c) => el('th', {
      textContent: c.label,
      className: numeric(c) ? 'num' : '',
      title: c.hint || '',
      style: c.width ? `width:${c.width}px` : '',
    })),
    el('th', { className: 'actions-cell' }),
  ]));

  if (def.filters) thead.append(filterRow(name, def));

  const active = filters[name] || {};
  const filtering = Object.values(active).some((v) => v && v.trim());
  const shown = (row) => def.columns.every((col) => {
    const q = (active[col.key] || '').trim().toLowerCase();
    return !q || String(display(col, row[col.key])).toLowerCase().includes(q);
  });

  const tbody = el('tbody');
  const visibleRows = [];
  rows.forEach((row, i) => {
    if (!shown(row)) return;
    visibleRows.push(row);
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
      if (confirm(`Delete "${label}"?`)) mutate('DELETE', `/api/${name}/rows/${i}`, null, 'Row deleted');
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

  const wrap = el('div', { className: 'fields' });
  rows.forEach((row, i) => {
    const input = el('input', { type: 'text', value: row[valueCol.key] ?? '' });
    input.dataset.cell = `${name}:${i}:${valueCol.key}`;
    const commit = () => {
      if (input.value === (row[valueCol.key] ?? '')) return;
      mutate('PATCH', `/api/${name}/rows/${i}`, { [valueCol.key]: input.value });
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

    wrap.append(el('div', { className: 'field' }, [
      el('label', { textContent: row.label || row.key }),
      el('div', { className: 'row' }, [input, el('span', { className: 'unit', textContent: row.unit || '' })]),
    ]));
  });
  return wrap;
}

/**
 * On the published site nothing is written back until this is pressed. The
 * database is one workbook, so it saves every pending change, not just this
 * section's — the count says how many are waiting.
 */
function saveButton() {
  const n = state.unsaved || 0;
  const b = el('button', {
    className: n ? 'btn primary' : 'btn',
    type: 'button',
    textContent: n ? `Save (${n})` : 'Saved',
    disabled: !n,
    title: n ? 'Writes every unsaved change, in every tab, back to the repo.' : 'Nothing waiting to be saved.',
  });
  b.addEventListener('click', () => mutate('POST', '/api/save', null, 'Saved to the repo'));
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
  if (state.save === 'manual') actions.push(saveButton());

  return el('section', { className: 'panel' }, [
    head,
    el('div', { className: def.keyed ? 'panel-body' : '' }, def.keyed ? renderKeyed(name) : renderGrid(name)),
    ...(actions.length ? [el('div', { className: 'panel-foot' }, actions)] : []),
  ]);
}

// --- Balance sheet ----------------------------------------------------------

function sideTable(title, groups, total) {
  const tbody = el('tbody');
  for (const g of groups) {
    tbody.append(el('tr', { className: 'bs-section' }, [
      el('td', { textContent: g.section }),
      el('td', { className: 'num', textContent: fmt.money(g.total) }),
    ]));
    for (const line of g.lines) {
      tbody.append(el('tr', { className: 'bs-line' }, [
        el('td', { textContent: line.label }),
        el('td', { className: 'num', textContent: fmt.money(line.amount) }),
      ]));
    }
  }
  tbody.append(el('tr', { className: 'bs-total' }, [
    el('td', { textContent: 'Total' }),
    el('td', { className: 'num', textContent: fmt.money(total) }),
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

function renderBalance() {
  const b = state.balance;
  const s = b.summary;
  const d = state.derived;
  const rate = (v) => (isNum(v) ? v.toFixed(4) : '—');
  const frag = document.createDocumentFragment();


  frag.append(el('div', { className: 'cards' }, [
    card('Capital paid', fmt.money(s.capitalPaid)),
    card('Equity', fmt.money(s.equity)),
    card('Profit & loss', fmt.money(s.profit), s.profit >= 0 ? 'pos' : 'neg'),
    card('Return on capital', fmt.percent(s.overYears), s.overYears >= 0 ? 'pos' : 'neg'),
    card('Years tracked', s.years.toFixed(2)),
    card('Average per year', fmt.percent(s.averagePerYear)),
    card('USD Ex. Rate', rate(d.usdRate)),
    card('EUR Ex. Rate', rate(d.eurRate)),
    card('Monthly KM', whole(d.kmPerMonth)),
  ]));

  frag.append(el('p', {
    className: 'hint',
    textContent: 'Assets and liabilities are calculated from the Assets & Liabilities tab. Capital is editable below.',
  }));

  frag.append(el('p', {
    className: 'hint',
    textContent: d.rateIsLive
      ? `USD and EUR holdings are valued at these rates, from ${d.rateSource}, as of ${new Date(d.rateFetched).toLocaleString()}.`
      : 'No published rates found — foreign holdings cannot be valued. Run the rate fetch.',
  }));

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
    cell(r.egp ? fmt.money(r.egp) : ''),
    cell(r.usd ? fmt.money(r.usd) : ''),
    cell(fmt.int(r.count)),
    cell(fmt.int(r.banks)),
  ])));

  const totals = el('tfoot', {}, el('tr', {}, [
    foot('Total', false),
    foot(fmt.money(s.egp)),
    foot(fmt.money(s.usd)),
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

  $('#as-of').textContent = `as of ${state.balance.asOf}`;

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
