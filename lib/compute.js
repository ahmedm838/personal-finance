'use strict';

const { tables } = require('./schema');

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

  // --- Devices and debts ---------------------------------------------------
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

  // The balance sheet is the chart of accounts with the ledger against it:
  // a group per level-2 heading, the accounts in code order. Rename, move
  // or add an account in the chart and it shows up here on its own.
  const chart = [...(db.Accounts || [])]
    .sort((a, b) => String(a.code3 ?? '').localeCompare(String(b.code3 ?? '')));

  const buildSide = (side) => {
    const groups = [];
    for (const a of chart.filter((r) => r.level1 === side && r.level3)) {
      const section = [a.level2, a.level1].filter(Boolean).join(' ');
      let g = groups.find((x) => x.section === section);
      if (!g) groups.push((g = { section, total: 0, lines: [] }));
      g.lines.push({ label: a.level3, amount: byAccount[a.level3] || 0 });
    }
    for (const g of groups) g.total = g.lines.reduce((t, l) => t + l.amount, 0);
    return groups;
  };

  const assets = buildSide('Assets');
  const liabilities = buildSide('Liabilities');

  // An entry filed under an account the chart does not list would other-
  // wise vanish from here while still counting in the ledger total.
  const filed = new Set(chart.map((r) => r.level3));
  const stray = Object.keys(byAccount)
    .filter((name) => name && !filed.has(name))
    .map((name) => ({ label: name, amount: byAccount[name] }));
  if (stray.length) {
    assets.push({ section: 'Not in the chart of accounts', total: stray.reduce((t, l) => t + l.amount, 0), lines: stray });
  }
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

/**
 * A column where some rows count against the rest: a liability is owed,
 * not owned, so it comes off the total rather than adding to it. Which
 * side a row falls on is read from the chart of accounts.
 */
function netTotal(spec, rows, chart, key) {
  const side = new Map((chart || []).map((r) => [r[spec.key], r[spec.level]]));
  return rows.reduce((t, r) => {
    const owed = spec.negative.includes(side.get(r[spec.on]));
    return t + (owed ? -1 : 1) * num(r[key]);
  }, 0);
}

/** Column totals for a table, following the `totals` spec in the schema. */
function tableTotals(name, rows, db) {
  const def = tables[name];
  if (!def || !def.totals) return null;
  const out = {};
  for (const [key, how] of Object.entries(def.totals)) {
    if (how === 'sum') {
      out[key] = sum(rows, key);
    } else if (how === 'net') {
      out[key] = netTotal(def.net, rows, (db || {})[def.net.table], key);
    } else if (how.startsWith('wavg:')) {
      const weightKey = how.slice(5);
      const w = sum(rows, weightKey);
      out[key] = w ? rows.reduce((t, r) => t + num(r[key]) * num(r[weightKey]), 0) / w : 0;
    }
  }
  return out;
}

module.exports = { compute, tableTotals };
