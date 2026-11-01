'use strict';

/**
 * Takes figures edited on the live site back into the local database.
 *
 * The browser commits docs/finance.xlsx directly, so that file — not
 * data/finance.xlsx — is the newer one after anyone edits the published page.
 * This reads it back and re-encrypts it as the local database.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const { tables } = require('../lib/schema');
const { sheetToRows } = require('../lib/sheet');
const { writeFresh, DATA_FILE, DATA_DIR } = require('../lib/workbook');

const SOURCE = path.join(__dirname, '..', 'docs', 'finance.xlsx');

async function main() {
  if (!fs.existsSync(SOURCE)) throw new Error(`Nothing to pull: ${SOURCE} does not exist.`);

  const wb = XLSX.read(fs.readFileSync(SOURCE), { cellDates: false });
  const db = {};
  for (const [name, def] of Object.entries(tables)) {
    db[name] = sheetToRows(wb.Sheets[name], def);
  }

  // writeFresh overwrites without a backup of its own, so keep one here.
  if (fs.existsSync(DATA_FILE)) {
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(DATA_FILE, path.join(dir, `finance-${stamp}-prepull.xlsx`));
  }

  await writeFresh(db, { encrypt: true });
  const rows = Object.values(db).reduce((a, r) => a + r.length, 0);
  console.log(`\n  data/finance.xlsx rebuilt from docs/finance.xlsx — ${rows} rows across ${Object.keys(db).length} tables.\n`);
}

main().catch((e) => { console.error(`\n${e.message}\n`); process.exit(1); });
