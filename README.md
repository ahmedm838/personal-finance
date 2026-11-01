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

The session ends after seven minutes without a click, a key or a scroll, and
the password is asked for again. Anything you had not saved stays in the
browser and is still there when you sign back in.

The Assets & Liabilities table has a filter box under each heading. Filtering
narrows the total to the rows on screen and says how many of how many, since
a total counting hidden rows would be misleading.

Pages serves static files only, so that copy has no server behind it:
`docs/finance.xlsx` is read into the page with SheetJS and the calculations run
in JavaScript. Edits are held in that browser's local storage, and are
committed back to this repo once you connect a token — see below. "Download
.xlsx" takes a copy of the current figures.

### Saving from the live site

Click **Connect GitHub** in the header and paste a token.

Saving is then explicit. Edits are held in the browser and every section ends
with a **Save** button showing how many are waiting — `Save (3)`.
Pressing it commits them to `docs/finance.xlsx` as one commit. The header
shows `3 unsaved`, then `Saving…`, then `Saved 14:32:05`, or the error.

The database is a single workbook, so there is no saving one section apart
from another: any Save button writes everything outstanding, which is why
they all show the same count. Closing the tab with edits waiting asks first,
and they survive a reload regardless — they live in this browser until they
are saved or the published workbook moves on without them.

Make the token at <https://github.com/settings/personal-access-tokens/new>:

- **Repository access** → Only select repositories → `personal-finance`
- **Permissions** → Repository permissions → **Contents: Read and write**

Nothing else. That token can write to this one repository and do nothing
else with the account.

Worth knowing:

- The token is kept in that browser's local storage and never committed.
  Every Pages site on `ahmedm838.github.io` shares one origin and therefore
  one local storage, which is why the token should be scoped to this repo.
- It is per browser, so a phone starts out saying **Not connected** and needs
  its own Connect. There is no way around that: the repo is public, so a token
  committed to it so the phone could pick it up would be a token handed to
  everyone. Either paste the same one on the phone, or make it a second token
  so it can be revoked on its own.
- Pages takes a minute or so to rebuild, so another device will lag a commit
  behind.
- Only `docs/finance.xlsx` is written. The local `data/finance.xlsx` is a
  separate, encrypted file and does not change — run `npm run pull:pages` to
  bring live edits into it.
- A browser keeps its own copy of the database, so it does not re-download
  the workbook on every load. It checks first: if the published file is no
  longer the one that copy came from — someone edited on another device, or
  the workbook was changed in the repo — the published file wins and the
  local copy is dropped. Unsaved edits made while disconnected would go with
  it, which is why saving is automatic.
- If the token is ever rejected — expired, revoked, deleted — the app forgets
  it and the Connect button comes back, so a dead token never sits there
  failing silently. To remove one deliberately, clear site data for
  `ahmedm838.github.io` in your browser.

### Exchange rates

The balance sheet shows **USD Ex. Rate** and **EUR Ex. Rate**, and values every
foreign holding at them, so equity moves with the rate.

The page reads them from the source on every load, so they are current
whenever you open it. `docs/rates.json` is the fallback for being offline or
the source being down; `.github/workflows/rates.yml` keeps it fresh on weekday
mornings and commits only when a figure actually moved. Fetch it by hand with:

```bash
npm run fetch:rates
```

The figures are the Central Bank of Egypt's own **sell** price. The CBE's page
sits behind a WAF that rejects automated requests, so they come from
AllRatesToday's open-data mirror of the same published table — no key needed,
and the buy and sell columns are carried through unchanged. The balance sheet
shows the date the CBE published them, which should match the date on
<https://www.cbe.org.eg/en/economic-research/statistics/cbe-exchange-rates>.

That mirror is licensed CC BY-NC 4.0, so the app credits AllRatesToday under
the cards. Personal use is within the licence; selling anything built on it
would not be.

The rates no longer live in Settings. The balance sheet names the source and
the time under the cards, and says plainly when neither the live source nor
the published copy could be read.

The balance sheet says how old the rate is — "for 2026-10-29 — 3 days ago",
or simply "today" — so a figure that is behind is visible rather than
something you have to go and check.

It often will be behind in the morning. The CBE publishes around midday
Cairo time, and the mirror has historically committed between 13:20 and
20:30 UTC, so the first hours of a working day have no rate for that day
from anybody. Friday and Saturday have none at all.

When that matters, the Settings tab has **USD rate override** and **EUR rate
override**. Fill both and they are used instead of the feed, dated today's
date, and the balance sheet says it is using them. Clear them and the feed
takes over again. They are the way to put the CBE figure in before the
mirror catches up; nothing else types a rate any more.
The fetch refuses to publish a rate outside a plausible range rather than let
a bad figure rewrite the whole statement.

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
against the values the original workbook had. All 19 matched on import.

It checks the *original* figures, so it is an import-time reconciliation and
not an ongoing invariant: once you edit something, the figures you changed
report as mismatches, and that is the script doing its job.

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

The guard compares the two files and cannot tell which is newer, so it also
fires after you edit `data/finance.xlsx` locally — through `npm start`, say.
There, `--force` is the right answer: pull first if the live site also moved,
then force the rebuild to publish your local change.

## What is calculated, and from what

| Figure | Derived from |
| --- | --- |
| Balance sheet asset & liability lines | Sum of `Entries` rows per account |
| Equity / Profit & loss | Assets − liabilities, then − capital paid |
| Entry amount, foreign currency | FX amount × the CBE sell rate, or the Settings override |
| Entry amount, EGP deposits | `DepositsEGP` total |
| Entry amount, USD deposits | `DepositsUSD` total × USD rate |
| Entry amount, furniture | `Furniture` total |
| Entry amount, debts | `Debts` total |
| Deposit monthly interest | Amount × rate ÷ 12 |
| Deposit end date | Start date + tenor, in years |
| Deposit status | Running up to and including the end date, then Matured |
| Round KM | Distance × 2 |
| Expenses → Yearly Fees | `AnnualFees` total ÷ 12, floored to 100 |
| Expenses → Bills | `Bills` total, rounded up to 500 |
| Expenses → Benzene | Fuel cost, rounded up to 100 |
| Fuel cost | Monthly km ÷ 100 × L/100km × EGP/L |
| Monthly km | `DrivingMonthly` km per year ÷ 12 |
| Round KM, driving | Distance × 2 |
| Driving km per year | Times per year × round KM |
| Deposit returns by day | Monthly interest grouped by the day each deposit started, EGP and USD kept apart |
| Cash flow interest | Deposits × rate ÷ 12 |
| Cash flow expenses | The year before, grown by that year's inflation rate, to the nearest 1,000 |
| Cash flow yearly saving | Saving × 12 |
| Cash flow spending | Yearly saving − added deposits − to be invested |
| Outlook deposits | Last projected year's deposits + its added deposits |
| Outlook invested | Every year's "to be invested", added up |
| Driving KM / Year | Times per year × km each time |
| Expense share % | Amount ÷ expenses total |
| Furniture amount | Count × price |
| Monthly average driving | KM per year ÷ 12, shown under the yearly total |
| Cash flow earnings / saving | Interest + salary + other income; − expenses |
| 2014–2026 change | (2026 − 2014) ÷ 2014 |

The Furniture and Debts lines on the balance sheet follow their own tabs, so
adding a row there moves your assets or liabilities. Deposits work the same
way. Everything else on that tab is a figure you type.

Driving distances are one way. The yearly figure counts the round trip, so a
purpose covering 62 km at 240 times a year is 29,760 km, not 14,880.

In the cash flow projection only the first year's expenses are typed; every
year after grows from the one before. The outlook's Deposits and Invested
follow the projection, but its Total row is still a figure you type, so it
will not follow them on its own.

A deposit's end date and status are worked out from its start date and
tenor, so neither can be typed. That also means there is no way to mark one
Closed: a deposit broken before its term still reads Running until the end
date passes. If that comes up, the honest fix is a date the deposit actually
ended on, not a status field to override it.

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
scripts/fetch-rates.js  Publishes docs/rates.json
.github/workflows/      The scheduled rate fetch
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
