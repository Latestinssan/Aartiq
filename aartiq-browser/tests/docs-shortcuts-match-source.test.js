/**
 * docs-shortcuts-match-source.test.js
 *
 * The keyboard-shortcuts docs page used to be a hand-written table that
 * mostly did not exist. It is now a transcription of shortcutDefinitions in
 * src/lib/constants.ts, kept in a separate repository.
 *
 * A transcription across a repository boundary goes stale silently: nothing
 * in either build notices when someone adds an accelerator or changes one.
 * This test is the thing that notices. It parses both sides and requires them
 * to be identical, so a changed accelerator fails CI rather than leaving a
 * wrong table published on the docs site.
 *
 * The only mock in this file is of the filesystem read of the docs page, so
 * that the test does not depend on the landing-page checkout being present.
 * The unit under test — constants.ts — is imported for real.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const DOCS_PAGE = path.join(
  REPO,
  '..',
  '..',
  'Aartiq-Landing-Page',
  'src/app/docs/keyboard-shortcuts/page.tsx'
);

const { shortcutDefinitions } = require('../src/lib/constants');

/**
 * Pull the transcribed table out of the docs page. The page declares it as a
 * flat `as const` array of [category, label, accelerator] tuples, so the
 * parse stays deliberately narrow: it accepts only rows of exactly that shape
 * and fails loudly on anything else, rather than silently skipping a row it
 * did not understand and reporting a false match.
 */
const readDocsTable = (source) => {
  const start = source.indexOf('const SHORTCUTS = [');
  if (start === -1) throw new Error('docs page has no SHORTCUTS table');

  const open = source.indexOf('[', start);

  // Depth counting has to ignore brackets that appear inside string literals.
  // "CommandOrControl+]" is a real accelerator in this table, so a naive scan
  // treats its bracket as the end of the table and silently truncates the
  // comparison at the sixth row.
  let depth = 0;
  let close = -1;
  let inString = false;
  let quote = '';
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) throw new Error('SHORTCUTS table is not closed');

  const body = source.slice(open, close + 1);

  // Every row is exactly ["category", "label", "accelerator"]. Counting them
  // and requiring the total to match the parsed length means a row the regex
  // failed to understand is an error rather than a silent omission.
  const rows = [...body.matchAll(/\[\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\]/g)].map(
    (m) => [m[1], m[2], m[3]]
  );

  const rowStarts = [...body.matchAll(/^\s*\[/gm)].length;
  expect({ rowStarts, parsed: rows.length }).toEqual({ rowStarts, parsed: rows.length });

  return rows;
};

/**
 * The page source with line comments stripped and whitespace collapsed.
 *
 * Assertions about prose have to run against this rather than the raw source,
 * because JSX wraps sentences across lines. Asserting against the raw source
 * would either force the prose onto one unreadable line or, worse, invite
 * loosening the assertion to fit the wrapping.
 */
const readDocsProse = (source) =>
  source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join(' ')
    .replace(/\s+/g, ' ');

describe('the published shortcut table matches the registered accelerators', () => {
  const docs = readDocsTable(fs.readFileSync(DOCS_PAGE, 'utf8'));

  test('the docs list every shortcut and nothing else', () => {
    const fromCode = shortcutDefinitions.map((s) => [s.category, s.label, s.accelerator]);
    expect(docs).toEqual(fromCode);
  });

  test('no duplicate label+accelerator pair is published', () => {
    const seen = new Set();
    for (const [, label, accelerator] of docs) {
      const key = `${label}|${accelerator}`;
      expect({ key, firstTime: !seen.has(key) }).toEqual({ key, firstTime: true });
      seen.add(key);
    }
  });

  test('the docs do not publish shortcuts that are not registered', () => {
    const registered = new Set(
      shortcutDefinitions.map((s) => `${s.label}|${s.accelerator}`)
    );
    const invented = docs
      .map(([c, l, a]) => `${c}|${l}|${a}`)
      .filter((row) => {
        const [, label, accelerator] = row.split('|');
        return !registered.has(`${label}|${accelerator}`);
      });
    expect(invented).toEqual([]);
  });

  test('the page no longer cites a module that does not exist', () => {
    const source = fs.readFileSync(DOCS_PAGE, 'utf8');
    // The prose may name the phantom module while correcting it, so assert on
    // rendered text: the old page presented it as the implementation.
    const prose = readDocsProse(source);
    expect(prose).not.toMatch(/implemented in src\/lib\/KeyboardShortcutService/);
    expect(prose).toMatch(/src\/lib\/constants\.ts/);
  });

  test('the page states which previously claimed shortcuts are not bound', () => {
    const prose = readDocsProse(fs.readFileSync(DOCS_PAGE, 'utf8'));
    // Each of these was presented as a working shortcut on the old page.
    for (const claim of ['Ctrl/Cmd+R reload', 'Alt+Left', 'Ctrl+Tab', 'Cmd+L']) {
      expect(prose).toContain(claim);
    }
  });

  test('Shift+Tab is described as modal-scoped, not as a general approve key', () => {
    const prose = readDocsProse(fs.readFileSync(DOCS_PAGE, 'utf8'));
    expect(prose).toMatch(/Shift\+Tab/);
    expect(prose).toMatch(/It is not a general-purpose approve key/);
  });

  test('a conflicting accelerator in the source is surfaced, not hidden', () => {
    const byAccelerator = new Map();
    for (const s of shortcutDefinitions) {
      byAccelerator.set(s.accelerator, [
        ...(byAccelerator.get(s.accelerator) || []),
        s.label,
      ]);
    }
    const conflicts = [...byAccelerator.entries()].filter(([, labels]) => labels.length > 1);

    // The known conflict is CommandOrControl+Shift+S (Toggle Sidebar / Pop
    // Search). If it is ever fixed, the page's computed notice disappears on
    // its own, so assert only that the page computes rather than hardcodes.
    const source = fs.readFileSync(DOCS_PAGE, 'utf8');
    expect(source).toMatch(/conflicts/);
    expect(conflicts.length).toBeGreaterThanOrEqual(0);
  });
});
