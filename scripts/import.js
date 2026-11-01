'use strict';

/**
 * One-time import: reads the original "Financial Statements.xlsx" and writes a
 * normalised database to data/finance.xlsx.
 *
 * The original is formula-heavy and built on 22 Excel Tables. SheetJS drops
 * those table definitions when it writes, which would leave every structured
 * reference broken, so the original is never written back to — it is read once
 * here and flattened into plain header-row sheets that the app can own.
 *
 *   node scripts/import.js [--source "<path to original>"] [--plain]
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const officeCrypto = require('officecrypto-tool');
const { writeFresh, DATA_FILE } = require('../lib/workbook');

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const SOURCE = argOf('source', process.env.SOURCE_XLSX
  || 'D:/Google Drive/Ahmed/Finance/Financial Statements.xlsx');
const PASSWORD = process.env.SOURCE_PASSWORD || process.env.APP_PASSWORD || '9987';
const ENCRYPT = !argv.includes('--plain');

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const nOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const isoDate = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d || !d.y) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

/** Rows of a sheet as a 0-indexed array-of-arrays, raw values. */
function grid(wb, sheet) {
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`Sheet "${sheet}" not found in the source workbook`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
}

/** Slice a rectangular block and map each row through `fn`, dropping empties. */
function block(rows, from, to, fn) {
  const out = [];
  for (let i = from; i <= to && i < rows.length; i++) {
    const r = rows[i] || [];
    const mapped = fn(r, i);
    if (mapped) out.push(mapped);
  }
  return out;
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`Source workbook not found:\n  ${SOURCE}\nPass --source "<path>" to point at it.`);
    process.exit(1);
  }

  let buf = fs.readFileSync(SOURCE);
  if (officeCrypto.isEncrypted(buf)) {
    console.log('Source is encrypted — decrypting.');
    buf = await officeCrypto.decrypt(buf, { password: PASSWORD });
  }
  const wb = XLSX.read(buf, { cellDates: false });

  const bs = grid(wb, 'Balance Sheet');
  const al = grid(wb, 'Assets&Liabilities');
  const ex = grid(wb, 'Expenses');
  const dep = grid(wb, 'Deposits');
  const cf = grid(wb, 'Cash Flow');
  const ys = grid(wb, "Yunis's Saving");
  const db_ = grid(wb, 'Debts');
  const di = grid(wb, 'Distances');
  const fu = grid(wb, 'Furniture');
  const mc = grid(wb, '2014-2026');

  const usdRate = nOrNull(bs[1] && bs[1][1]) || 0;
  const eurRate = nOrNull(bs[2] && bs[2][1]) || 0;

  const db = {};

  // --- Settings -----------------------------------------------------------
  db.Settings = [
    { key: 'usd_rate', label: 'USD → EGP rate', value: String(usdRate), unit: 'EGP' },
    { key: 'eur_rate', label: 'EUR → EGP rate', value: String(eurRate), unit: 'EGP' },
    { key: 'start_date', label: 'Tracking start date', value: '2019-04-01', unit: 'date' },
    { key: 'litres_per_100km', label: 'Fuel use', value: String(nOrNull(ex[2] && ex[2][11]) ?? 9.7), unit: 'L / 100 km' },
    { key: 'egp_per_litre', label: 'Fuel price', value: String(nOrNull(ex[3] && ex[3][11]) ?? 24), unit: 'EGP / L' },
  ];

  // --- Chart of accounts (A..F) ------------------------------------------
  db.Accounts = block(al, 1, 12, (r) => (txt(r[0]) ? {
    level1: txt(r[0]),
    code1: txt(r[1]),
    level2: txt(r[2]),
    code2: txt(r[3]),
    level3: txt(r[4]),
    code3: txt(r[5]),
  } : null));

  // --- Ledger entries (H..L) ---------------------------------------------
  // A numeric "Remarks" in the original meant a foreign-currency amount.
  db.Entries = block(al, 1, 30, (r) => {
    const account = txt(r[7]);
    if (!account) return null;
    const item = txt(r[9]);
    const rawRemarks = r[10];
    const amount = nOrNull(r[11]) ?? 0;

    // A numeric Remarks is only an FX amount if it actually reconciles against
    // the EGP amount at one of the two rates — one row holds a date there.
    let currency = 'EGP';
    let fx = null;
    if (typeof rawRemarks === 'number' && amount !== 0) {
      const rate = /EUR/i.test(item) ? eurRate : usdRate;
      if (rate && Math.abs(rawRemarks * rate - amount) < 1) {
        fx = rawRemarks;
        currency = /EUR/i.test(item) ? 'EUR' : 'USD';
      }
    }

    let link = '';
    if (account === 'EGP Deposits') link = 'deposits_egp';
    else if (account === 'USD Deposits') link = 'deposits_usd';

    return {
      account,
      item,
      currency,
      fx_amount: fx,
      link,
      remarks: fx === null ? txt(typeof rawRemarks === 'number' ? isoDate(rawRemarks) : rawRemarks) : '',
      amount,
    };
  });

  // --- Capital (G..H on the Balance Sheet) --------------------------------
  db.Capital = block(bs, 5, 19, (r) => (txt(r[6]) ? {
    item: txt(r[6]),
    amount: nOrNull(r[7]) ?? 0,
  } : null));

  // --- Expenses / Bills / Annual fees ------------------------------------
  const linkForExpense = (item) => {
    if (/^yearly fees$/i.test(item)) return 'annual_fees';
    if (/^bills$/i.test(item)) return 'bills';
    if (/^benzene$/i.test(item)) return 'fuel';
    return '';
  };
  db.Expenses = block(ex, 1, 15, (r) => (txt(r[0]) ? {
    item: txt(r[0]), link: linkForExpense(txt(r[0])), amount: nOrNull(r[1]) ?? 0,
  } : null));
  db.Bills = block(ex, 1, 15, (r) => (txt(r[4]) ? { item: txt(r[4]), amount: nOrNull(r[5]) ?? 0 } : null));
  db.AnnualFees = block(ex, 1, 15, (r) => (txt(r[7]) ? { item: txt(r[7]), amount: nOrNull(r[8]) ?? 0 } : null));

  // --- Deposits -----------------------------------------------------------
  const depositRow = (r) => (txt(r[1]) ? {
    bank: txt(r[1]),
    serial: txt(r[2]),
    rate: nOrNull(r[3]),
    tenor: nOrNull(r[4]),
    start: isoDate(r[5]),
    end: isoDate(r[7]),
    status: txt(r[6]) || 'Running',
    amount: nOrNull(r[8]) ?? 0,
  } : null);
  db.DepositsEGP = block(dep, 1, 21, depositRow);
  db.DepositsUSD = block(dep, 25, 34, depositRow);

  // --- Cash flow ----------------------------------------------------------
  db.CashFlow = block(cf, 1, 10, (r) => (txt(r[0]) ? {
    year: txt(r[0]),
    deposits: nOrNull(r[1]),
    rate: nOrNull(r[2]),
    interest: nOrNull(r[3]),
    salary: nOrNull(r[4]),
    other_income: nOrNull(r[5]),
    inf_rate: nOrNull(r[7]),
    expenses: nOrNull(r[8]),
    spending: nOrNull(r[10]),
    yearly_saving: nOrNull(r[11]),
    added_deposits: nOrNull(r[12]),
    to_be_invested: nOrNull(r[13]),
    dividends_spending: nOrNull(r[14]),
  } : null));

  db.Horizon = block(cf, 15, 20, (r) => (txt(r[5]) ? {
    item: txt(r[5]),
    value: nOrNull(r[6]),
    rate: nOrNull(r[7]),
    income: nOrNull(r[8]),
    remarks: txt(r[9]),
  } : null));

  // --- Yunis's saving -----------------------------------------------------
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  db.YunisParams = [
    ...block(ys, 1, 5, (r) => (txt(r[0]) ? {
      key: slug(txt(r[0])), label: txt(r[0]), value: String(nOrNull(r[1]) ?? ''), unit: txt(r[2]),
    } : null)),
    ...block(ys, 9, 14, (r) => (txt(r[4]) ? {
      key: slug(txt(r[4])), label: txt(r[4]), value: String(nOrNull(r[7]) ?? ''), unit: txt(r[8]),
    } : null)),
  ];

  db.YunisProjection = block(ys, 1, 8, (r) => (nOrNull(r[4]) !== null ? {
    years: nOrNull(r[4]),
    age: nOrNull(r[5]),
    date: isoDate(r[6]),
    usd_value: nOrNull(r[7]),
    yearly_interest: nOrNull(r[8]),
    saving_tenor: nOrNull(r[9]),
  } : null));

  // --- Debts --------------------------------------------------------------
  db.Debts = block(db_, 1, 7, (r) => (txt(r[0]) ? {
    description: txt(r[0]), amount: nOrNull(r[1]) ?? 0, remarks: txt(r[2]),
  } : null));

  // --- Distances ----------------------------------------------------------
  // This sheet's used range starts at column B, so index 0 is "From".
  const isTotalRow = (r) => /^total$/i.test(txt(r[0]));
  db.Distances = block(di, 1, 12, (r) => (txt(r[0]) && !isTotalRow(r) ? {
    from: txt(r[0]), to: txt(r[1]), remarks: txt(r[2]), distance_km: nOrNull(r[3]) ?? 0,
  } : null));

  db.DrivingMonthly = block(di, 14, 18, (r) => (txt(r[1]) ? {
    item: txt(r[1]), remarks: txt(r[2]), distance_km: nOrNull(r[3]) ?? 0,
  } : null));

  // --- Furniture ----------------------------------------------------------
  db.Furniture = block(fu, 1, 20, (r) => (txt(r[0]) ? {
    item: txt(r[0]), count: nOrNull(r[1]) ?? 0, price: nOrNull(r[2]) ?? 0,
  } : null));

  // --- Macro comparison ---------------------------------------------------
  db.Macro = block(mc, 1, 16, (r) => (txt(r[0]) ? {
    metric: txt(r[0]), y2014: nOrNull(r[1]), y2026: nOrNull(r[2]), remarks: txt(r[4]),
  } : null));

  const out = await writeFresh(db, { encrypt: ENCRYPT });

  console.log(`\nWrote ${path.relative(process.cwd(), out)}${ENCRYPT ? ' (encrypted)' : ' (plain)'}\n`);
  for (const [name, rows] of Object.entries(db)) {
    console.log(`  ${name.padEnd(18)} ${String(rows.length).padStart(3)} rows`);
  }
  console.log(`\nSource left untouched: ${SOURCE}`);
}

main().catch((e) => { console.error('Import failed:', e.message); process.exit(1); });
