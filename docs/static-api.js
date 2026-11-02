'use strict';

(() => {
// --- repo config ---
const REPO = {"owner":"ahmedm838","repo":"personal-finance","branch":"master","path":"docs/finance.xlsx"};

// --- lib/schema.js ---
/**
 * The shape of the database workbook, and how it is presented in the UI.
 *
 * `tables` describes every sheet that is stored in data/finance.xlsx. Each one
 * is a plain header-row sheet, so the file stays readable as a spreadsheet and
 * carries no formulas or Excel Table definitions (SheetJS cannot round-trip
 * those — see README).
 *
 * `tabs` groups those tables into the page tabs, mirroring the original
 * workbook's sheet names.
 *
 * Column types drive both the input control and the write-side coercion:
 *   text | number | money | percent | int | date | select
 * A column with `computed: true` is derived in compute.js and never stored.
 */

const tables = {
  Settings: {
    label: 'Settings',
    keyed: true, // rendered as labelled input fields, not a grid
    columns: [
      { key: 'key', label: 'Key', type: 'text', readOnly: true },
      { key: 'label', label: 'Setting', type: 'text', readOnly: true },
      // Kept as text so a rate and a date can share the column.
      { key: 'value', label: 'Value', type: 'text' },
      { key: 'unit', label: 'Unit', type: 'text', readOnly: true },
    ],
  },

  Accounts: {
    label: 'Chart of Accounts',
    columns: [
      { key: 'level1', label: 'Level 1', type: 'text' },
      { key: 'code1', label: 'Code 1', type: 'text' },
      { key: 'level2', label: 'Level 2', type: 'text' },
      { key: 'code2', label: 'Code 2', type: 'text' },
      { key: 'level3', label: 'Account', type: 'text' },
      { key: 'code3', label: 'Code 3', type: 'text' },
    ],
  },

  Entries: {
    label: 'Assets & Liabilities',
    columns: [
      { key: 'account', label: 'Account', type: 'select', optionsFrom: 'Accounts.level3' },
      { key: 'item', label: 'Item Description', type: 'text', width: 280 },
      { key: 'currency', label: 'Ccy', type: 'select', options: ['EGP', 'USD', 'EUR'], width: 76 },
      { key: 'fx_amount', label: 'Amount', type: 'number', width: 130, derived: true, hint: "In the row's own currency. Filled in for you when the row is linked." },
      {
        key: 'link',
        label: 'Linked to',
        type: 'select',
        options: [
          { value: '', label: '— none —' },
          { value: 'deposits_egp', label: 'EGP deposits total' },
          { value: 'deposits_usd', label: 'USD deposits total' },
          { value: 'furniture', label: 'Furniture total' },
          { value: 'debts', label: 'Debts total' },
        ],
      },
      { key: 'remarks', label: 'Remarks', type: 'text' },
      { key: 'amount', label: 'Amount (EGP)', type: 'money', computed: true, width: 150 },
    ],
    sortable: ['account', 'currency', 'fx_amount', 'amount'],
    filters: true,
    quickFilters: {
      table: 'Accounts',
      on: 'account',
      key: 'level3',
      levels: [
        { key: 'level1', label: 'Level 1' },
        { key: 'level2', label: 'Level 2' },
        { key: 'level3', label: 'Level 3' },
      ],
    },
  },

  Capital: {
    label: 'Capital',
    columns: [
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money', whole: true },
    ],
    totals: { amount: 'sum' },
  },

  Expenses: {
    label: 'Monthly Expenses',
    columns: [
      { key: 'item', label: 'Expense', type: 'text' },
      {
        key: 'link',
        label: 'Linked to',
        type: 'select',
        options: [
          { value: '', label: '— none —' },
          { value: 'annual_fees', label: 'Annual fees ÷ 12' },
          { value: 'bills', label: 'Bills total' },
          { value: 'fuel', label: 'Fuel cost' },
        ],
      },
      // Stored, but overwritten by compute.js when `link` is set.
      { key: 'amount', label: 'Amount', type: 'money', derived: true },
      { key: 'share', label: '%', type: 'percent', computed: true },
    ],
    sortable: ['amount'],
    defaultSort: { key: 'amount', dir: 'desc' },
    totals: { amount: 'sum' },
  },

  Bills: {
    label: 'Monthly Bills',
    columns: [
      { key: 'item', label: 'Bill', type: 'text', width: 270 },
      { key: 'remarks', label: 'Remarks', type: 'text', width: 760 },
      { key: 'amount', label: 'Amount', type: 'money', width: 270 },
    ],
    sortable: ['amount'],
    defaultSort: { key: 'amount', dir: 'desc' },
    totals: { amount: 'sum' },
  },

  AnnualFees: {
    label: 'Annual Fees',
    columns: [
      { key: 'item', label: 'Fee', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'frequency', label: 'Frequency', type: 'int', width: 110, hint: 'Times a year' },
      { key: 'total_amount', label: 'Total Amount', type: 'money', computed: true, width: 140 },
    ],
    sortable: ['amount', 'total_amount'],
    defaultSort: { key: 'total_amount', dir: 'desc' },
    totals: { amount: 'sum', total_amount: 'sum' },
  },

  DepositsEGP: {
    label: 'EGP Deposits',
    rowEditor: true,
    columns: [
      { key: 'bank', label: 'Bank', type: 'text', width: 100 },
      { key: 'serial', label: 'Serial', type: 'text', width: 200 },
      { key: 'rate', label: 'Rate', type: 'percent', width: 90 },
      { key: 'tenor', label: 'Tenor', type: 'int', width: 80 },
      { key: 'start', label: 'Start', type: 'date', width: 140 },
      { key: 'end', label: 'End', type: 'date', computed: true, width: 120 },
      { key: 'status', label: 'Status', type: 'text', computed: true, width: 100 },
      { key: 'amount', label: 'Amount', type: 'money', width: 130 },
      { key: 'monthly', label: 'Monthly', type: 'money', computed: true, width: 120 },
      { key: 'day', label: 'Day', type: 'int', computed: true, width: 70 },
    ],
    countInTotal: true,
    sortable: ['rate', 'tenor', 'start', 'end', 'amount', 'monthly', 'day'],
    // The deposit maturing next is the one worth looking at first.
    defaultSort: { key: 'end', dir: 'asc' },
    totals: { amount: 'sum', monthly: 'sum', rate: 'wavg:amount' },
  },

  DepositsUSD: {
    label: 'USD Deposits',
    rowEditor: true,
    columns: [
      { key: 'bank', label: 'Holder', type: 'text', width: 100 },
      { key: 'serial', label: 'Serial', type: 'text', width: 200 },
      { key: 'rate', label: 'Rate', type: 'percent', width: 90 },
      { key: 'tenor', label: 'Tenor', type: 'int', width: 80 },
      { key: 'start', label: 'Start', type: 'date', width: 140 },
      { key: 'end', label: 'End', type: 'date', computed: true, width: 120 },
      { key: 'status', label: 'Status', type: 'text', computed: true, width: 100 },
      { key: 'amount', label: 'Amount (USD)', type: 'money', width: 130 },
      { key: 'monthly', label: 'Monthly (USD)', type: 'money', computed: true, width: 140 },
      { key: 'day', label: 'Day', type: 'int', computed: true, width: 70 },
    ],
    countInTotal: true,
    sortable: ['rate', 'tenor', 'start', 'end', 'amount', 'monthly', 'day'],
    // The deposit maturing next is the one worth looking at first.
    defaultSort: { key: 'end', dir: 'asc' },
    totals: { amount: 'sum', monthly: 'sum', rate: 'wavg:amount' },
  },

  CashFlow: {
    label: 'Cash Flow Projection',
    columns: [
      { key: 'year', label: 'Year', type: 'text', width: 70 },
      { key: 'deposits', label: 'Deposits', type: 'money', whole: true, derived: true, width: 150 },
      { key: 'rate', label: 'INT. RATE', type: 'percent', width: 80 },
      { key: 'interest', label: 'Interest', type: 'money', computed: true, whole: true, width: 95 },
      { key: 'salary', label: 'Salary', type: 'money', whole: true, width: 95 },
      { key: 'other_income', label: 'Other', type: 'money', whole: true, width: 90 },
      { key: 'earnings', label: 'Earnings', type: 'money', computed: true, whole: true, width: 100 },
      { key: 'inf_rate', label: 'Inf. Rate', type: 'percent', width: 80 },
      // The first year is typed in; later years grow from the one before.
      { key: 'expenses', label: 'Expenses', type: 'money', whole: true, derived: true, width: 95 },
      { key: 'saving', label: 'Saving', type: 'money', computed: true, whole: true, width: 95 },
      { key: 'yearly_saving', label: 'Yearly Saving', type: 'money', computed: true, whole: true, width: 100 },
      { key: 'added_deposits', label: 'Added Deposits', type: 'money', whole: true, width: 100 },
      { key: 'to_be_invested', label: 'To Be Invested', type: 'money', whole: true, width: 100 },
      { key: 'dividends_spending', label: 'Dividends', type: 'money', whole: true, width: 100 },
      { key: 'spending', label: 'Spending', type: 'money', computed: true, whole: true, width: 95 },
    ],
    totals: {
      yearly_saving: 'sum',
      added_deposits: 'sum',
      to_be_invested: 'sum',
      dividends_spending: 'sum',
      spending: 'sum',
    },
  },

  Horizon: {
    label: 'Long-term Outlook',
    columns: [
      { key: 'item', label: 'Item', type: 'text', width: 260 },
      // Deposits and Invested are read off the projection and earn at their
      // own rate; any other line is a monthly figure typed in on its own.
      { key: 'value', label: 'Value', type: 'money', whole: true, derived: true, width: 150 },
      { key: 'rate', label: 'Rate', type: 'percent', width: 90, derived: true },
      { key: 'income', label: 'Monthly Income', type: 'money', whole: true, derived: true, width: 150 },
      { key: 'remarks', label: 'Remarks', type: 'text', width: 200 },
    ],
    totals: { value: 'sum', income: 'sum' },
  },

  YunisParams: {
    label: 'Plan Parameters',
    keyed: true,
    // Worked out from the projection; the rest are typed in.
    derivedKeys: ['years', 'current_ex_rate', 'expected_ex_rate', 'maturity_value_usd', 'maturity_value_egp'],
    // How each worked-out value is written out.
    formatKeys: {
      annual_devaluation_rate: 'percent',
      current_ex_rate: 'fixed3',
      expected_ex_rate: 'fixed3',
      maturity_value_usd: 'whole',
      maturity_value_egp: 'whole',
    },
    columns: [
      { key: 'key', label: 'Key', type: 'text', readOnly: true },
      { key: 'label', label: 'Parameter', type: 'text', readOnly: true },
      { key: 'value', label: 'Value', type: 'number' },
      { key: 'unit', label: 'Unit', type: 'text', readOnly: true },
    ],
  },

  YunisProjection: {
    label: 'Savings Projection',
    columns: [
      { key: 'tenor', label: 'Tenor', type: 'int', width: 80 },
      // Both start from a fixed point and then follow the tenor of the line
      // above, so neither is ever typed in.
      { key: 'age', label: 'Age', type: 'int', width: 80, derived: true },
      { key: 'date', label: 'Date', type: 'date', width: 140, derived: true },
      { key: 'usd_value', label: 'USD Value', type: 'money', computed: true, whole: true, width: 120 },
      { key: 'int_rate', label: 'INT. Rate', type: 'percent', fixedPercent: 2, width: 100 },
      { key: 'monthly_interest', label: 'Monthly Interest', type: 'money', computed: true, whole: true, width: 140 },
      { key: 'yearly_interest', label: 'Yearly Interest', type: 'money', computed: true, whole: true, width: 130 },
      { key: 'interest_tenor', label: 'Interest / Tenor', type: 'money', computed: true, whole: true, width: 140 },
      { key: 'saving_tenor', label: 'Saving / Tenor', type: 'money', whole: true, width: 130 },
    ],
    totals: { tenor: 'sum' },
  },

  Debts: {
    label: 'Debts',
    columns: [
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'remarks', label: 'Remarks', type: 'text' },
    ],
    totals: { amount: 'sum' },
  },

  Distances: {
    label: 'Routes',
    columns: [
      { key: 'from', label: 'From', type: 'text' },
      { key: 'to', label: 'To', type: 'text' },
      { key: 'remarks', label: 'Remarks', type: 'text' },
      { key: 'distance_km', label: 'Distance (KM)', type: 'number' },
      { key: 'round_km', label: 'Round KM', type: 'number', computed: true },
    ],
    totals: { distance_km: 'sum' },
  },

  DrivingMonthly: {
    label: 'Yearly Driving',
    columns: [
      { key: 'item', label: 'Purpose', type: 'text' },
      { key: 'frequency', label: 'Frequency', type: 'number', width: 110, hint: 'Times per year' },
      { key: 'km', label: 'Distance KM', type: 'number', width: 110, hint: 'One way' },
      { key: 'round_km', label: 'Round KM', type: 'number', width: 110, computed: true },
      { key: 'distance_km', label: 'KM / Year', type: 'number', computed: true },
    ],
    totals: { distance_km: 'sum' },
    // An extra line under the total, read from the derived figures.
    footRows: [{ label: 'Monthly average', derived: 'kmPerMonth', key: 'distance_km', format: 'int' }],
  },

  Furniture: {
    label: 'Furniture',
    columns: [
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'count', label: 'Count', type: 'int', width: 80 },
      { key: 'price', label: 'Price', type: 'money' },
      { key: 'amount', label: 'Amount', type: 'money', computed: true },
    ],
    totals: { amount: 'sum' },
  },

  Macro: {
    label: 'Egypt 2014 vs 2026',
    columns: [
      { key: 'metric', label: 'Metric', type: 'text' },
      { key: 'y2014', label: 'Year 2014', type: 'number' },
      { key: 'y2026', label: 'Year 2026', type: 'number' },
      { key: 'multiplier', label: 'Change', type: 'number', computed: true },
      { key: 'remarks', label: 'Remarks', type: 'text' },
    ],
  },
};

/**
 * Balance sheet layout. Each line sums Entries rows whose `account` matches.
 * The grouping intentionally follows the original Balance Sheet rather than the
 * chart of accounts — deposits and investments are presented as current assets.
 */
const balanceSheet = {
  assets: [
    { section: 'Current Assets', lines: ['Cash', 'A/R', 'EGP Deposits', 'USD Deposits', 'Investments'] },
    { section: 'Non-current Assets', lines: ['Properties', 'Vehicles', 'Furniture'] },
  ],
  liabilities: [
    { section: 'Current Liabilities', lines: ['Credit Cards', 'A/P'] },
    { section: 'Non-current Liabilities', lines: [{ account: 'Loans', label: 'Debts' }, 'Installments'] },
  ],
};

/** Page tabs. The first one is the landing page. */
const tabs = [
  { id: 'balance-sheet', label: 'Balance Sheet', view: 'balance', tables: ['Capital'] },
  { id: 'assets-liabilities', label: 'Assets & Liabilities', tables: ['Entries', 'Accounts'] },
  { id: 'expenses', label: 'Expenses', tables: ['Expenses', 'Bills', 'AnnualFees'] },
  { id: 'deposits', label: 'Deposits', summary: 'deposits', tables: ['DepositsEGP', 'DepositsUSD'] },
  { id: 'cash-flow', label: 'Cash Flow', tables: ['CashFlow', 'Horizon'] },
  { id: 'yunis-saving', label: "Yunis's Saving", tables: ['YunisParams', 'YunisProjection'] },
  { id: 'debts', label: 'Debts', tables: ['Debts'] },
  { id: 'distances', label: 'Distances', tables: ['DrivingMonthly', 'Distances'] },
  { id: 'furniture', label: 'Furniture', tables: ['Furniture'] },
  { id: 'macro', label: '2014-2026', tables: ['Macro'] },
  { id: 'settings', label: 'Settings', tables: ['Settings'] },
];

// --- lib/sheet.js ---
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

// --- lib/rows.js ---
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

// --- lib/compute.js ---
// Tracking began here. It is a fact about the past, not something to set.
const TRACKING_START = '2019-04-01';

// Where Yunis's plan starts: the opening deposit, and the date and age of
// the first line. Every line after these follows from the tenors.
const YUNIS_DEPOSIT = 7000;
const YUNIS_START_DATE = '2024-01-01';
const YUNIS_START_AGE = 3;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const sum = (rows, key) => rows.reduce((t, r) => t + num(r[key]), 0);
const ceilTo = (v, step) => Math.ceil(v / step) * step;

function settingsMap(rows) {
  const m = {};
  for (const r of rows || []) if (r.key) m[r.key] = num(r.value);
  return m;
}

/** Same day of the month, n years on; 29 February falls back to the 28th. */
function addYears(iso, years) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  const n = Math.round(num(years));
  if (!m || !n) return null;

  const year = Number(m[1]) + n;
  const month = Number(m[2]);
  const lastOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Number(m[3]), lastOfMonth);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dayOfMonth(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? Number(m[3]) : null;
}

/**
 * Derives every calculated value from the stored inputs.
 *
 * Order matters: deposits feed the ledger entries, the ledger feeds the balance
 * sheet, and bills/fees/fuel feed the monthly expense lines.
 */
function compute(db, rates) {
  const s = settingsMap(db.Settings);
  const today = new Date().toISOString().slice(0, 10);

  // A rate typed into Settings wins outright: it is there for the hours when
  // the CBE has published a figure the mirror has not picked up yet. Blank
  // falls through to the feed, which is the normal case.
  const live = rates && Number.isFinite(rates.usd) && Number.isFinite(rates.eur) ? rates : null;
  const overridden = Boolean(s.usd_rate_override && s.eur_rate_override);
  const usdRate = overridden ? s.usd_rate_override : (live ? live.usd : 0);
  const eurRate = overridden ? s.eur_rate_override : (live ? live.eur : 0);

  const rateDate = overridden ? today : (live ? live.rateDate || null : null);
  const rateAgeDays = rateDate
    ? Math.round((Date.parse(today) - Date.parse(rateDate)) / 86_400_000)
    : null;

  // --- Deposits -----------------------------------------------------------
  for (const name of ['DepositsEGP', 'DepositsUSD']) {
    for (const r of db[name] || []) {
      r.monthly = (num(r.amount) * num(r.rate)) / 12;
      r.day = dayOfMonth(r.start);
      r.end = addYears(r.start, r.tenor);
      r.status = r.end ? (r.end >= today ? 'Running' : 'Matured') : '';
    }
  }
  const egpDeposits = sum(db.DepositsEGP, 'amount');
  const usdDeposits = sum(db.DepositsUSD, 'amount');

  const depositRows = [...(db.DepositsEGP || []), ...(db.DepositsUSD || [])];

  // Interest lands on the day of the month a deposit started, so what matters
  // is the schedule. The two currencies stay apart: they are not comparable
  // amounts, and converting one would hide what actually arrives.
  const byDay = new Map();
  for (const [table, currency] of [[db.DepositsEGP, 'egp'], [db.DepositsUSD, 'usd']]) {
    for (const r of table || []) {
      if (!Number.isFinite(r.day)) continue;
      if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day, egp: 0, usd: 0, count: 0, banks: new Set() });
      const row = byDay.get(r.day);
      row[currency] += num(r.monthly);
      row.count += 1;
      if (r.bank) row.banks.add(r.bank);
    }
  }

  const depositSummary = {
    schedule: [...byDay.values()].sort((a, b) => a.day - b.day).map((r) => ({ ...r, banks: r.banks.size })),
    egp: sum(db.DepositsEGP, 'monthly'),
    usd: sum(db.DepositsUSD, 'monthly'),
    count: depositRows.length,
    banks: new Set(depositRows.map((r) => r.bank).filter(Boolean)).size,
    // A deposit with no start date has no day to land on.
    undated: depositRows.filter((r) => !Number.isFinite(r.day)).length,
  };

  // --- Furniture and debts -------------------------------------------------
  // Totalled before the ledger, because a ledger entry can link to them.
  for (const r of db.Furniture || []) r.amount = num(r.count) * num(r.price);
  const furnitureTotal = sum(db.Furniture, 'amount');
  const debtsTotal = sum(db.Debts, 'amount');

  // --- Ledger entries -----------------------------------------------------
  for (const r of db.Entries || []) {
    if (r.link === 'deposits_egp') r.amount = egpDeposits;
    else if (r.link === 'deposits_usd') r.amount = usdDeposits * usdRate;
    else if (r.link === 'furniture') r.amount = furnitureTotal;
    else if (r.link === 'debts') r.amount = debtsTotal;
    else if (r.currency === 'USD') r.amount = num(r.fx_amount) * usdRate;
    else if (r.currency === 'EUR') r.amount = num(r.fx_amount) * eurRate;
    // An EGP row is already in pounds, so the two columns agree.
    else r.amount = num(r.fx_amount);
  }

  // --- Driving / fuel -----------------------------------------------------
  for (const r of db.DrivingMonthly || []) {
    r.round_km = num(r.km) * 2;
    r.distance_km = r.round_km * num(r.frequency);
  }
  const kmPerYear = sum(db.DrivingMonthly, 'distance_km');
  const kmPerMonth = kmPerYear / 12;

  // Fuel use is litres per 100 km, so the distance is scaled to match it.
  const fuelCost = (kmPerMonth / 100) * (s.litres_per_100km || 0) * (s.egp_per_litre || 0);

  // --- Expense roll-ups ---------------------------------------------------
  const billsTotal = sum(db.Bills, 'amount');
  // A fee paid more than once a year costs its amount each time.
  for (const r of db.AnnualFees || []) {
    // A blank frequency means once, so a new row counts before it is filled in.
    r.total_amount = num(r.amount) * (num(r.frequency) || 1);
  }
  const annualFeesTotal = sum(db.AnnualFees, 'total_amount');
  for (const r of db.Expenses || []) {
    if (r.link === 'annual_fees') r.amount = annualFeesTotal / 12;
    else if (r.link === 'bills') r.amount = billsTotal;
    else if (r.link === 'fuel') r.amount = ceilTo(fuelCost, 100);
  }
  const expensesTotal = sum(db.Expenses, 'amount');
  for (const r of db.Expenses || []) {
    r.share = expensesTotal ? num(r.amount) / expensesTotal : 0;
  }

  // --- Yunis's saving plan ------------------------------------------------
  // The first line is fixed; each one after starts from the line above it,
  // moving on by that line's tenor and by what it saved and earned.
  const plan = settingsMap(db.YunisParams);
  let previousLine = null;
  for (const r of db.YunisProjection || []) {
    if (previousLine) {
      // Both step on by the tenor of the line above, so they stay in step.
      r.age = num(previousLine.age) + num(previousLine.tenor);
      r.date = addYears(previousLine.date, previousLine.tenor) || previousLine.date;
      r.usd_value = num(previousLine.usd_value)
        + num(previousLine.saving_tenor)
        + num(previousLine.interest_tenor);
    } else {
      r.age = YUNIS_START_AGE;
      r.date = YUNIS_START_DATE;
      r.usd_value = YUNIS_DEPOSIT;
    }

    r.monthly_interest = (num(r.usd_value) * num(r.int_rate)) / 12;
    r.yearly_interest = num(r.usd_value) * num(r.int_rate);
    r.interest_tenor = num(r.usd_value) * num(r.int_rate) * num(r.tenor);
    previousLine = r;
  }

  const planYears = sum(db.YunisProjection, 'tenor');
  const expectedRate = usdRate * (1 + (plan.annual_devaluation_rate || 0)) ** planYears;
  const lastLine = (db.YunisProjection || [])[(db.YunisProjection || []).length - 1];
  const maturityUsd = lastLine
    ? num(lastLine.usd_value) + num(lastLine.interest_tenor) + num(lastLine.saving_tenor)
    : 0;

  const planResults = {
    years: planYears,
    current_ex_rate: usdRate,
    expected_ex_rate: expectedRate,
    maturity_value_usd: maturityUsd,
    maturity_value_egp: maturityUsd * expectedRate,
  };
  for (const r of db.YunisParams || []) {
    if (r.key in planResults) r.value = planResults[r.key];
  }

  // --- Simple per-row derivations ----------------------------------------
  for (const r of db.Distances || []) r.round_km = num(r.distance_km) * 2;


  for (const r of db.Macro || []) {
    const a = num(r.y2014);
    r.multiplier = a ? (num(r.y2026) - a) / a : null;
  }

  // Only the first year is typed in. Deposits roll forward by what was added
  // the year before, and expenses grow by that year's inflation rate.
  let previous = null;
  for (const r of db.CashFlow || []) {
    if (previous) {
      r.deposits = num(previous.deposits) + num(previous.added_deposits);
      r.expenses = Math.round((num(previous.expenses) * (1 + num(r.inf_rate))) / 1000) * 1000;
    }

    r.interest = (num(r.deposits) * num(r.rate)) / 12;
    r.earnings = num(r.interest) + num(r.salary) + num(r.other_income);
    r.saving = r.earnings - num(r.expenses);
    r.yearly_saving = r.saving * 12;
    r.spending = r.yearly_saving - num(r.added_deposits) - num(r.to_be_invested);
    previous = r;
  }

  // What comes in each month: this year's salary from the projection, plus
  // the interest the deposits actually pay.
  const thisYear = String(new Date().getFullYear());
  const yearRow = (db.CashFlow || []).find((r) => String(r.year || '').endsWith(thisYear));
  const monthlySalary = yearRow ? num(yearRow.salary) : 0;
  const depositInterest = depositSummary.egp + depositSummary.usd * usdRate;
  const monthlyEarnings = monthlySalary + depositInterest;

  // The outlook picks up where the projection leaves off.
  const lastYear = (db.CashFlow || [])[(db.CashFlow || []).length - 1];
  const outlook = {
    Deposits: lastYear ? num(lastYear.deposits) + num(lastYear.added_deposits) : 0,
    Invested: sum(db.CashFlow, 'to_be_invested'),
  };
  for (const r of db.Horizon || []) {
    if (r.item in outlook) {
      r.value = outlook[r.item];
      r.income = (num(r.value) * num(r.rate)) / 12;
    } else {
      // An income line with no capital behind it: the figure is typed in.
      r.value = null;
      r.rate = null;
    }
  }

  // --- Balance sheet ------------------------------------------------------
  const byAccount = {};
  for (const r of db.Entries || []) {
    byAccount[r.account] = (byAccount[r.account] || 0) + num(r.amount);
  }

  // A line is either an account name, or { account, label } when the balance
  // sheet calls it something other than the chart of accounts does.
  const buildSide = (groups) => groups.map((g) => {
    const lines = g.lines.map((line) => {
      const account = typeof line === 'string' ? line : line.account;
      return { label: typeof line === 'string' ? line : line.label || account, amount: byAccount[account] || 0 };
    });
    return { section: g.section, total: lines.reduce((t, l) => t + l.amount, 0), lines };
  });

  const assets = buildSide(balanceSheet.assets);
  const liabilities = buildSide(balanceSheet.liabilities);
  const assetsTotal = assets.reduce((t, g) => t + g.total, 0);
  const liabilitiesTotal = liabilities.reduce((t, g) => t + g.total, 0);
  const capitalTotal = sum(db.Capital, 'amount');

  const equity = assetsTotal - liabilitiesTotal;
  const profit = equity - capitalTotal;
  const years = (Date.now() - Date.parse(TRACKING_START)) / (365 * 24 * 3600 * 1000);
  const overYears = capitalTotal ? profit / capitalTotal : 0;

  return {
    balance: {
      asOf: new Date().toISOString().slice(0, 10),
      assets,
      liabilities,
      capital: (db.Capital || []).map((r) => ({ label: r.item, amount: num(r.amount) })),
      totals: { assets: assetsTotal, liabilities: liabilitiesTotal, capital: capitalTotal },
      summary: {
        capitalPaid: capitalTotal,
        equity,
        profit,
        overYears,
        years,
        averagePerYear: years ? overYears / years : 0,
      },
    },
    derived: {
      egpDeposits,
      usdDeposits,
      furnitureTotal,
      debtsTotal,
      usdDepositsEgp: usdDeposits * usdRate,
      monthlySalary,
      depositInterest,
      monthlyEarnings,
      kmPerYear,
      kmPerMonth,
      fuelCost,
      deposits: depositSummary,
      billsTotal,
      annualFeesTotal,
      expensesTotal,
      usdRate,
      eurRate,
      rateIsLive: overridden || Boolean(live),
      rateOverridden: overridden,
      rateFetched: live ? live.fetched : null,
      rateDate,
      rateAgeDays,
      rateAttribution: overridden ? null : (live ? live.attribution || null : null),
    },
  };
}

/** Column totals for a table, following the `totals` spec in the schema. */
function tableTotals(name, rows) {
  const def = tables[name];
  if (!def || !def.totals) return null;
  const out = {};
  for (const [key, how] of Object.entries(def.totals)) {
    if (how === 'sum') {
      out[key] = sum(rows, key);
    } else if (how.startsWith('wavg:')) {
      const weightKey = how.slice(5);
      const w = sum(rows, weightKey);
      out[key] = w ? rows.reduce((t, r) => t + num(r[key]) * num(r[weightKey]), 0) / w : 0;
    }
  }
  return out;
}

// --- static/api.js ---
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
  let fromFile = null;
  if (bytes) {
    const wb = XLSX.read(bytes, { type: 'array', cellDates: false });
    fromFile = {};
    for (const [name, def] of Object.entries(tables)) {
      fromFile[name] = sheetToRows(wb.Sheets[name], def);
    }
  }

  if (saved && (!published || localStorage.getItem(BASELINE_KEY) === published)) {
    try {
      db = JSON.parse(saved);
      // The stored copy may already hold edits, so what counts as saved is
      // the published file, not what this browser happens to be holding.
      savedDb = fromFile ? JSON.parse(JSON.stringify(fromFile)) : JSON.parse(saved);
      return db;
    } catch {
      localStorage.removeItem(STORE_KEY);
    }
  } else if (saved) {
    if (typeof toast === 'function') toast('Loaded newer figures from the repo');
  }

  db = fromFile;
  markSaved();
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
  const n = changedRows();
  setStatus(n ? `${n} unsaved` : (token ? 'Connected' : 'Not connected'));
}

/** Only the stored columns matter: the computed ones are never written. */
function storedShape(name, row) {
  const out = {};
  for (const col of tables[name].columns) if (!col.computed) out[col.key] = row[col.key] ?? null;
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
    data[name] = { rows: db[name] || [], totals: tableTotals(name, db[name] || []) };
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
    markSaved();
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

})();
