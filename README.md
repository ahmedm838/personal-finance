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
in JavaScript. Edits are held in that browser's local storage, and are
committed back to this repo once you connect a token — see below. "Download
.xlsx" takes a copy, "Reset" discards local changes and reloads the committed
figures.

### Saving from the live site

Click **Connect GitHub** in the header and paste a token. After that every
edit is committed to `docs/finance.xlsx` about four seconds after you stop
typing — one commit per burst of edits, not one per keystroke. The header
shows `Saving…`, then `Saved 14:32:05`, or the error if it failed.

Make the token at <https://github.com/settings/personal-access-tokens/new>:

- **Repository access** → Only select repositories → `personal-finance`
- **Permissions** → Repository permissions → **Contents: Read and write**

Nothing else. That token can write to this one repository and do nothing
else with the account.

Worth knowing:

- The token is kept in that browser's local storage and never committed.
  Every Pages site on `ahmedm838.github.io` shares one origin and therefore
  one local storage, which is why the token should be scoped to this repo.
- Pages takes a minute or so to rebuild, so another device will lag a commit
  behind.
- Only `docs/finance.xlsx` is written. The local `data/finance.xlsx` is a
  separate, encrypted file and does not change — run `npm run pull:pages` to
  bring live edits into it.

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

It refuses to run if `docs/finance.xlsx` holds figures that
`data/finance.xlsx` does not — that means the live site was edited since the
last build, and rebuilding would discard those edits. Either take them:

```bash
npm run pull:pages
```

which rebuilds the encrypted local database from the published workbook
(keeping a backup first), or discard them with `npm run build:pages -- --force`.

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
server.js               Express app: auth, REST API, static files
lib/schema.js           Table definitions, column types, tab layout
lib/workbook.js         Encrypted read/write, atomic save, backups
lib/sheet.js            Sheet <-> row conversion, shared with the Pages build
lib/rows.js             Input coercion and validation, shared likewise
lib/compute.js          Every derived value
static/api.js           Browser stand-in for the API, and the GitHub write-back
scripts/import.js       One-time import from the original workbook
scripts/verify.js       Reconciliation against the original figures
scripts/build-pages.js  Builds docs/ for GitHub Pages
scripts/pull-pages.js   Takes live edits back into the local database
public/                 Front end (no build step)
data/finance.xlsx       The local database, encrypted
docs/                   The published site, committed
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

Writing is a different matter: it needs the GitHub token, which only exists
in your own browser. A visitor can read everything and change nothing.

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
