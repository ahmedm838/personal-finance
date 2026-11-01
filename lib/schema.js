'use strict';

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
    filters: true,
    totals: { amount: 'sum' },
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
    totals: { amount: 'sum', monthly: 'sum', rate: 'wavg:amount' },
  },

  CashFlow: {
    label: 'Cash Flow Projection',
    columns: [
      { key: 'year', label: 'Year', type: 'text', width: 100 },
      { key: 'deposits', label: 'Deposits', type: 'money', whole: true, width: 130 },
      { key: 'rate', label: 'Rate', type: 'percent', width: 90 },
      { key: 'interest', label: 'Interest', type: 'money', whole: true, computed: true, width: 120 },
      { key: 'salary', label: 'Salary', type: 'money', whole: true, width: 120 },
      { key: 'other_income', label: 'Other', type: 'money', whole: true, width: 130 },
      { key: 'earnings', label: 'Earnings', type: 'money', whole: true, computed: true, width: 130 },
      { key: 'inf_rate', label: 'Inf. Rate', type: 'percent', width: 100 },
      // The first year is typed in; later years grow from the one before.
      { key: 'expenses', label: 'Expenses', type: 'money', whole: true, derived: true, width: 120 },
      { key: 'saving', label: 'Saving', type: 'money', whole: true, computed: true, width: 120 },
      { key: 'yearly_saving', label: 'Yearly Saving', type: 'money', whole: true, computed: true, width: 140 },
      { key: 'added_deposits', label: 'Added Deposits', type: 'money', whole: true, width: 150 },
      { key: 'to_be_invested', label: 'To Be Invested', type: 'money', whole: true, width: 150 },
      { key: 'dividends_spending', label: 'Dividends Spending', type: 'money', whole: true, width: 180 },
      { key: 'spending', label: 'Spending', type: 'money', whole: true, computed: true, width: 120 },
    ],
  },

  Horizon: {
    label: 'Long-term Outlook',
    columns: [
      { key: 'item', label: 'Item', type: 'text', width: 260 },
      // Deposits and Invested are read off the projection; the rest is typed.
      { key: 'value', label: 'Value', type: 'money', whole: true, derived: true, width: 150 },
      { key: 'rate', label: 'Rate', type: 'percent', width: 90 },
      { key: 'income', label: 'Monthly Income', type: 'money', whole: true, width: 150 },
      { key: 'remarks', label: 'Remarks', type: 'text', width: 200 },
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

module.exports = { tables, tabs, balanceSheet };
