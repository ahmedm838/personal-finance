'use strict';

/**
 * Builds the GitHub Pages copy into docs/.
 *
 * Pages has no server and no writable disk, so this build swaps the Express
 * API for static/api.js and ships the workbook unencrypted — the browser has
 * no practical way to decrypt it, and the repo is public regardless.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const XLSX = require('xlsx');

const { tables } = require('../lib/schema');
const { sheetToRows, rowsToSheet } = require('../lib/sheet');
const { load } = require('../lib/workbook');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const PUBLISHED = path.join(OUT, 'finance.xlsx');
const XLSX_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/** Where the browser commits its edits back to, taken from the git remote. */
function repoConfig() {
  const remote = git('remote', 'get-url', 'origin');
  const m = remote.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) throw new Error(`Cannot read owner/repo from origin: ${remote}`);
  return { owner: m[1], repo: m[2], branch: git('rev-parse', '--abbrev-ref', 'HEAD'), path: 'docs/finance.xlsx' };
}

/**
 * Inline a CommonJS module for the browser. In the page every module shares
 * one scope and XLSX comes from the CDN, so the require/export lines go.
 */
function inline(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const kept = src.split('\n').filter((line) => {
    const l = line.trim();
    return !/^const\s.*=\s*require\(/.test(l) && !/^module\.exports\b/.test(l) && l !== "'use strict';";
  });

  const body = kept.join('\n');
  if (/\brequire\(|module\.exports/.test(body)) {
    throw new Error(`${file} still has CommonJS wiring after stripping; bundle would break.`);
  }
  return `// --- ${file} ---\n${body.trim()}\n`;
}

const readDb = (buf) => {
  const wb = XLSX.read(buf, { cellDates: false });
  return Object.fromEntries(Object.entries(tables).map(([n, def]) => [n, sheetToRows(wb.Sheets[n], def)]));
};

function toWorkbook(db) {
  const wb = XLSX.utils.book_new();
  for (const [name, def] of Object.entries(tables)) {
    XLSX.utils.book_append_sheet(wb, rowsToSheet(db[name] || [], def), name);
  }
  return wb;
}

/** Replace exactly once, or fail — a silent miss would ship a broken page. */
function swap(html, find, replace) {
  const count = html.split(find).length - 1;
  if (count !== 1) throw new Error(`Expected 1 occurrence of ${JSON.stringify(find)}, found ${count}`);
  return html.replace(find, replace);
}

function buildHtml() {
  let html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  html = swap(
    html,
    '<a href="/api/download" class="btn ghost">Download .xlsx</a>',
    [
      '<span class="muted" id="sync-status">Not connected</span>',
      '      <button class="btn ghost" id="github">Connect GitHub</button>',
      '      <button class="btn ghost" id="download">Download .xlsx</button>',
      '      <button class="btn ghost" id="reset" title="Discard local changes">Reset</button>',
    ].join('\n'),
  );

  html = swap(
    html,
    '<span class="muted" id="as-of"></span>',
    '<span class="muted" id="as-of"></span>\n'
      + '      <span class="muted">· browser copy</span>',
  );

  return swap(
    html,
    '<script src="app.js"></script>',
    `<script src="${XLSX_CDN}"></script>\n<script src="static-api.js"></script>\n<script src="app.js"></script>`,
  );
}

/**
 * The live site commits straight to docs/finance.xlsx, so rebuilding from the
 * local database would quietly throw those edits away.
 */
function guardPublished(db) {
  if (!fs.existsSync(PUBLISHED) || process.argv.includes('--force')) return;
  if (JSON.stringify(readDb(fs.readFileSync(PUBLISHED))) === JSON.stringify(readDb(XLSX.write(toWorkbook(db), { bookType: 'xlsx', type: 'buffer' })))) return;

  throw new Error(
    'docs/finance.xlsx has figures that data/finance.xlsx does not.\n'
    + '  The live site has been edited since the last build.\n\n'
    + '  Take those edits:     npm run pull:pages\n'
    + '  Or discard them:      npm run build:pages -- --force\n',
  );
}

async function main() {
  const { db } = await load();
  guardPublished(db);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const config = `// --- repo config ---\nconst REPO = ${JSON.stringify(repoConfig())};\n`;
  const bundle = ['lib/schema.js', 'lib/sheet.js', 'lib/rows.js', 'lib/compute.js', 'static/api.js']
    .map(inline)
    .join('\n');
  fs.writeFileSync(path.join(OUT, 'static-api.js'), `'use strict';\n\n(() => {\n${config}\n${bundle}\n})();\n`);

  fs.writeFileSync(path.join(OUT, 'index.html'), buildHtml());
  fs.copyFileSync(path.join(ROOT, 'public', 'app.js'), path.join(OUT, 'app.js'));
  fs.copyFileSync(path.join(ROOT, 'public', 'styles.css'), path.join(OUT, 'styles.css'));
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  XLSX.writeFile(toWorkbook(db), PUBLISHED);

  for (const f of fs.readdirSync(OUT)) {
    console.log(`  ${f.padEnd(16)} ${fs.statSync(path.join(OUT, f)).size.toLocaleString()} bytes`);
  }
  console.log('\n  docs/ built.\n');
}

main().catch((e) => { console.error(`\n${e.message}\n`); process.exit(1); });
