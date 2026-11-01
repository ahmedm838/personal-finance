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
      { key: 'item', label: 'Item Description', type: 'text' },
      { key: 'currency', label: 'Ccy', type: 'select', options: ['EGP', 'USD', 'EUR'], width: 76 },
      { key: 'fx_amount', label: 'FX Amount', type: 'number', hint: 'Amount in the foreign currency. Leave blank for EGP.' },
      {
        key: 'link',
        label: 'Linked to',
        type: 'select',
        options: [
          { value: '', label: '— none —' },
          { value: 'deposits_egp', label: 'EGP deposits total' },
          { value: 'deposits_usd', label: 'USD deposits total' },
          { value: 'furniture', label: 'Furniture total' },
        ],
      },
      { key: 'remarks', label: 'Remarks', type: 'text' },
      // Stored, but overwritten by compute.js for FX rows and linked rows.
      { key: 'amount', label: 'Amount (EGP)', type: 'money', derived: true },
    ],
    totals: { amount: 'sum' },
  },

  Capital: {
    label: 'Capital',
    columns: [
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
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
    totals: { amount: 'sum' },
  },

  Bills: {
    label: 'Monthly Bills',
    columns: [
      { key: 'item', label: 'Bill', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
    totals: { amount: 'sum' },
  },

  AnnualFees: {
    label: 'Annual Fees',
    columns: [
      { key: 'item', label: 'Fee', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
    totals: { amount: 'sum' },
  },

  DepositsEGP: {
    label: 'EGP Deposits',
    rowEditor: true,
    columns: [
      { key: 'bank', label: 'Bank', type: 'text', width: 90 },
      { key: 'serial', label: 'Serial', type: 'text' },
      { key: 'rate', label: 'Rate', type: 'percent' },
      { key: 'tenor', label: 'Tenor', type: 'int', width: 70 },
      { key: 'start', label: 'Start', type: 'date' },
      { key: 'end', label: 'End', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Running', 'Matured', 'Closed'] },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'monthly', label: 'Monthly', type: 'money', computed: true },
      { key: 'day', label: 'Day', type: 'int', computed: true },
    ],
    totals: { amount: 'sum', monthly: 'sum', rate: 'wavg:amount' },
  },

  DepositsUSD: {
    label: 'USD Deposits',
    rowEditor: true,
    columns: [
      { key: 'bank', label: 'Holder', type: 'text', width: 90 },
      { key: 'serial', label: 'Serial', type: 'text' },
      { key: 'rate', label: 'Rate', type: 'percent' },
      { key: 'tenor', label: 'Tenor', type: 'int', width: 70 },
      { key: 'start', label: 'Start', type: 'date' },
      { key: 'end', label: 'End', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Running', 'Matured', 'Closed'] },
      { key: 'amount', label: 'Amount (USD)', type: 'money' },
      { key: 'monthly', label: 'Monthly (USD)', type: 'money', computed: true },
      { key: 'day', label: 'Day', type: 'int', computed: true },
    ],
    totals: { amount: 'sum', monthly: 'sum', rate: 'wavg:amount' },
  },

  CashFlow: {
    label: 'Cash Flow Projection',
    columns: [
      { key: 'year', label: 'Year', type: 'text', width: 90 },
      { key: 'deposits', label: 'Deposits', type: 'money' },
      { key: 'rate', label: 'Rate', type: 'percent' },
      { key: 'interest', label: 'Interest', type: 'money' },
      { key: 'salary', label: 'Salary', type: 'money' },
      { key: 'other_income', label: 'Other Income', type: 'money' },
      { key: 'earnings', label: 'Earnings', type: 'money', computed: true },
      { key: 'inf_rate', label: 'Inf. Rate', type: 'percent' },
      { key: 'expenses', label: 'Expenses', type: 'money' },
      { key: 'saving', label: 'Saving', type: 'money', computed: true },
      { key: 'spending', label: 'Spending', type: 'money' },
      { key: 'yearly_saving', label: 'Yearly Saving', type: 'money' },
      { key: 'added_deposits', label: 'Added Deposits', type: 'money' },
      { key: 'to_be_invested', label: 'To Be Invested', type: 'money' },
      { key: 'dividends_spending', label: 'Dividends Spending', type: 'money' },
    ],
  },

  Horizon: {
    label: 'Long-term Outlook',
    columns: [
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'value', label: 'Value', type: 'money' },
      { key: 'rate', label: 'Rate', type: 'percent' },
      { key: 'income', label: 'Monthly Income', type: 'money' },
      { key: 'remarks', label: 'Remarks', type: 'text' },
    ],
  },

  YunisParams: {
    label: 'Plan Parameters',
    keyed: true,
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
      { key: 'years', label: 'Years', type: 'int', width: 70 },
      { key: 'age', label: 'Age', type: 'int', width: 70 },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'usd_value', label: 'USD Value', type: 'money' },
      { key: 'yearly_interest', label: 'Yearly Interest', type: 'money' },
      { key: 'saving_tenor', label: 'Saving / Tenor', type: 'money' },
    ],
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
    ],
    totals: { distance_km: 'sum' },
  },

  DrivingMonthly: {
    label: 'Monthly Driving',
    columns: [
      { key: 'item', label: 'Purpose', type: 'text' },
      { key: 'frequency', label: 'Frequency', type: 'number', width: 110, hint: 'Times per year' },
      { key: 'km', label: 'KM', type: 'number', width: 110, hint: 'Distance covered each time' },
      { key: 'distance_km', label: 'KM / Year', type: 'number', computed: true },
    ],
    totals: { distance_km: 'sum' },
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
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const sum = (rows, key) => rows.reduce((t, r) => t + num(r[key]), 0);
const floorTo = (v, step) => Math.floor(v / step) * step;
const ceilTo = (v, step) => Math.ceil(v / step) * step;

function settingsMap(rows) {
  const m = {};
  for (const r of rows || []) if (r.key) m[r.key] = num(r.value);
  return m;
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
  // A published rate wins; the Settings figures are the fallback when the
  // scheduled fetch has not run or could not reach the source.
  const live = rates && Number.isFinite(rates.usd) && Number.isFinite(rates.eur) ? rates : null;
  const usdRate = live ? live.usd : s.usd_rate || 0;
  const eurRate = live ? live.eur : s.eur_rate || 0;

  // --- Deposits -----------------------------------------------------------
  for (const name of ['DepositsEGP', 'DepositsUSD']) {
    for (const r of db[name] || []) {
      r.monthly = (num(r.amount) * num(r.rate)) / 12;
      r.day = dayOfMonth(r.start);
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

  // --- Furniture ----------------------------------------------------------
  // Totalled before the ledger, because a ledger entry can now link to it.
  for (const r of db.Furniture || []) r.amount = num(r.count) * num(r.price);
  const furnitureTotal = sum(db.Furniture, 'amount');

  // --- Ledger entries -----------------------------------------------------
  for (const r of db.Entries || []) {
    if (r.link === 'deposits_egp') r.amount = egpDeposits;
    else if (r.link === 'deposits_usd') r.amount = usdDeposits * usdRate;
    else if (r.link === 'furniture') r.amount = furnitureTotal;
    else if (r.currency === 'USD') r.amount = num(r.fx_amount) * usdRate;
    else if (r.currency === 'EUR') r.amount = num(r.fx_amount) * eurRate;
    // EGP rows keep their typed amount.
  }

  // --- Driving / fuel -----------------------------------------------------
  for (const r of db.DrivingMonthly || []) r.distance_km = num(r.km) * num(r.frequency);
  const kmPerYear = sum(db.DrivingMonthly, 'distance_km');
  const kmPerMonth = kmPerYear / 12;

  // Fuel use is litres per 100 km, so the distance is scaled to match it.
  const fuelCost = (kmPerMonth / 100) * (s.litres_per_100km || 0) * (s.egp_per_litre || 0);

  // --- Expense roll-ups ---------------------------------------------------
  const billsTotal = sum(db.Bills, 'amount');
  const annualFeesTotal = sum(db.AnnualFees, 'amount');
  for (const r of db.Expenses || []) {
    if (r.link === 'annual_fees') r.amount = floorTo(annualFeesTotal / 12, 100);
    else if (r.link === 'bills') r.amount = ceilTo(billsTotal, 500);
    else if (r.link === 'fuel') r.amount = ceilTo(fuelCost, 100);
  }
  const expensesTotal = sum(db.Expenses, 'amount');
  for (const r of db.Expenses || []) {
    r.share = expensesTotal ? num(r.amount) / expensesTotal : 0;
  }

  // --- Simple per-row derivations ----------------------------------------

  for (const r of db.Macro || []) {
    const a = num(r.y2014);
    r.multiplier = a ? (num(r.y2026) - a) / a : null;
  }

  for (const r of db.CashFlow || []) {
    r.earnings = num(r.interest) + num(r.salary) + num(r.other_income);
    r.saving = r.earnings - num(r.expenses);
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
  const startDate = (db.Settings || []).find((r) => r.key === 'start_date');
  const startMs = startDate && startDate.value ? Date.parse(String(startDate.value)) : NaN;
  const years = Number.isFinite(startMs) ? (Date.now() - startMs) / (365 * 24 * 3600 * 1000) : 0;
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
      usdDepositsEgp: usdDeposits * usdRate,
      kmPerYear,
      kmPerMonth,
      fuelCost,
      deposits: depositSummary,
      billsTotal,
      annualFeesTotal,
      expensesTotal,
      usdRate,
      eurRate,
      rateIsLive: Boolean(live),
      rateSource: live ? live.source : 'Settings',
      rateFetched: live ? live.fetched : null,
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
  scheduleSave();
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
const SAVE_DELAY = 4000;

let token = localStorage.getItem(TOKEN_KEY) || '';
let fileSha = null;
let saveTimer = null;
let saving = false;
let dirty = false;

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
  if (!token || saving) return;
  saving = true;
  dirty = false;
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
    setStatus(`Saved ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    dirty = true;
    if (e.status === 401) {
      // An expired or revoked token will not start working on a retry.
      forgetToken();
      setStatus('Token rejected — connect again', true);
    } else {
      setStatus(`Save failed — ${e.message}`, true);
    }
  } finally {
    saving = false;
    if (dirty) scheduleSave();
  }
}

/** Batch an editing burst into one commit instead of one per keystroke. */
function scheduleSave() {
  if (!token) return;
  dirty = true;
  setStatus('Saving shortly…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(push, SAVE_DELAY);
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
    setStatus('Connected');
    renderSyncButton();
    if (dirty) scheduleSave();
  } catch (e) {
    token = previous;
    fileSha = null;
    setStatus(`Token rejected — ${e.message}`, true);
  }
}

function forgetToken() {
  token = '';
  fileSha = null;
  clearTimeout(saveTimer);
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

})();
