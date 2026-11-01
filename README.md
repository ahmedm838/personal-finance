# Personal Finance

A password-protected web app for my personal financial statements, backed by an
Excel workbook stored in this repo.

The Balance Sheet opens first; every other statement is a tab in the page bar.
Single values are editable input fields, everything tabular is a grid you can
insert, edit and delete rows in. Calculated figures are shown greyed out and
recalculate as soon as something they depend on changes.

## Live version

<https://ahmedm838.github.io/personal-finance/> — the whole app in the browser,
nothing to install. Password `9987`.

Pages serves static files only, so that copy has no server behind it:
`docs/finance.xlsx` is read into the page with SheetJS and the calculations run
in JavaScript. Edits are held in that browser's local storage and **do not
reach the repo** — "Download .xlsx" then commit the file to make a change
stick, or "Reset" to go back to the committed figures.

## Running it

```bash
npm install
npm start
```

Then open <http://127.0.0.1:3000> and enter the password.

The password defaults to `9987`. Set `APP_PASSWORD` to change it — note that it
unlocks both the app and the encrypted data file, so if you change it, re-run
the import so the file is re-encrypted with the new one.

## How the data is stored

`data/finance.xlsx` is the database. It is a plain workbook — one sheet per
table, a single header row, no formulas — and it is encrypted with
`APP_PASSWORD`. The app decrypts it on read and re-encrypts on write.

Each save writes to a temporary file and renames it into place, so an
interrupted write cannot truncate the database, and the previous version is
copied to `data/backups/` first (the last 30 are kept; the folder is not
committed).

### Why the original workbook isn't used directly

The original `Financial Statements.xlsx` is built on 22 Excel Tables, and its
598 formulas address them through structured references like
`Table11[[#This Row],[Assets]]`. SheetJS — the only practical way to read and
write xlsx from Node — **drops table definitions when it writes** but keeps the
formulas that point at them. Saving the original through this app would leave
every one of those formulas broken the next time it opened in Excel.

So the original is read exactly once, by `npm run import`, and flattened into
the normalised workbook above. The app owns the calculations from then on, and
the original is never written to.

### Re-importing

```bash
npm run import
```

Reads the source workbook (override with `--source "<path>"` or `SOURCE_XLSX`)
and rebuilds `data/finance.xlsx` from scratch. **This overwrites your edits**,
so it is a one-time setup step, not a sync. Add `--plain` to write the database
unencrypted.

```bash
node scripts/verify.js
```

Reconciles 19 headline figures — totals, equity, profit, deposits, expenses —
against the values the original workbook had. All 19 match as imported.

### Rebuilding the Pages copy

```bash
npm run build:pages
```

Regenerates `docs/` from `public/`, `lib/` and the current database: it inlines
the schema and calculation modules for the browser, swaps the Express API for
`static/api.js`, and writes an unencrypted copy of the workbook. Run it after
any change to the app or the figures, and commit `docs/`.

Reconciles 19 headline figures — totals, equity, profit, deposits, expenses —
against the values the original workbook had. All 19 match as imported.

## What is calculated, and from what

| Figure | Derived from |
| --- | --- |
| Balance sheet asset & liability lines | Sum of `Entries` rows per account |
| Equity / Profit & loss | Assets − liabilities, then − capital paid |
| Entry amount, foreign currency | FX amount × the rate in Settings |
| Entry amount, EGP deposits | `DepositsEGP` total |
| Entry amount, USD deposits | `DepositsUSD` total × USD rate |
| Deposit monthly interest | Amount × rate ÷ 12 |
| Expenses → Yearly Fees | `AnnualFees` total ÷ 12, floored to 100 |
| Expenses → Bills | `Bills` total, rounded up to 500 |
| Expenses → Benzene | Fuel cost, rounded up to 100 |
| Fuel cost | Monthly km ÷ 100 × L/100km × EGP/L |
| Expense share % | Amount ÷ expenses total |
| Furniture amount | Count × price |
| Cash flow earnings / saving | Interest + salary + other income; − expenses |
| 2014–2026 change | (2026 − 2014) ÷ 2014 |

The "Linked to" column on the Assets & Liabilities and Expenses tabs is what
drives the rows that pull from another table. Set it to *none* to type a figure
in by hand instead.

Note that the balance sheet groups deposits and investments under current
assets, which is how the original presented them — that differs from the chart
of accounts on the same tab, which files them as non-current.

## Layout

```
server.js            Express app: auth, REST API, static files
lib/schema.js        Table definitions, column types, tab layout
lib/workbook.js      Encrypted read/write, atomic save, backups
lib/compute.js       Every derived value
scripts/import.js    One-time import from the original workbook
scripts/verify.js    Reconciliation against the original figures
public/              Front end (no build step)
data/finance.xlsx    The database
```

To add a column or a table, edit `lib/schema.js`; the API, the grid, the
editors and the totals row all follow from it.

## Security

This is built to run on `127.0.0.1`, for one person, on a trusted machine.

**This repo is public, and `data/finance.xlsx` is committed to it.** That file
holds real account numbers and balances. It is encrypted, but with the same
password the app uses and that this README names, so treat its contents as
public. Making the repo private again does not undo this: the public history
may already have been cloned, forked or cached.

The Pages copy goes further: `docs/finance.xlsx` is **not encrypted at all** —
the browser has no practical way to decrypt it — and the password prompt there
is cosmetic, since anyone can fetch that file directly. Treat the live site as
a public read of your figures.

To test without publishing figures, run with a throwaway database:

```bash
npm run import -- --source "<some other workbook>"
```

Before putting it on a network:

- Change `APP_PASSWORD` to something that is not four digits, and set
  `SESSION_SECRET`.
- Serve it over HTTPS and set `SECURE_COOKIE=true`.
- `xlsx@0.18.5` on npm carries a high-severity advisory and is no longer the
  maintained distribution. It is read-only against your own file here, but if
  this is ever exposed, switch to the SheetJS-hosted build.
