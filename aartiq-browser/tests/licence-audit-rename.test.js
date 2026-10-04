/**
 * licence-audit-rename.test.js
 *
 * Two defects from the docs/source audit (mismatch-inventory M14, M16), pinned
 * so they cannot come back:
 *
 * M14 — Licence split. The repository root, the README badge and GitHub's API
 * all say Apache-2.0, but aartiq-browser/LICENSE.txt was a restrictive EULA
 * that forbade modification and redistribution — and it is the file the
 * Windows NSIS installer displays (package.json build.nsis.license). The
 * decision, recorded in docs-audit/licence-decision.md, is that the browser
 * becomes Apache-2.0: LICENSE.txt carries the root text, the manifest declares
 * it, and the installer therefore shows the same licence as the repository.
 *
 * M16 — Comet identity strings. The audit trail file was comet-audit.jsonl
 * and the chat export dialogs defaulted to comet-chat-<ts>.txt/.pdf. Both are
 * user-visible names; they are aartiq-* now, and a legacy comet-audit.jsonl is
 * renamed on first load so an existing audit trail is kept, not abandoned.
 *
 * Source is the truth here: every assertion reads the shipped files. The
 * mutation record is docs-audit/mutation-check-licence-rename.txt.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('electron', () => ({ app: { getPath: jest.fn() } }));

const BROWSER = path.join(__dirname, '..');
const REPO = path.join(BROWSER, '..');
const read = (p) => fs.readFileSync(p, 'utf8');

// ─── M14 ──────────────────────────────────────────────────────────────────────

describe('M14 — the browser ships Apache-2.0, not the EULA', () => {
  test('LICENSE.txt is the Apache-2.0 text the root LICENSE carries', () => {
    const licence = read(path.join(BROWSER, 'LICENSE.txt'));
    expect(licence).toMatch(/Apache License/);
    expect(licence).toMatch(/Version 2\.0, January 2004/);
    expect(licence).not.toMatch(/END USER LICENSE AGREEMENT/);
    // Byte-identical to the root file the README badge and gh api both read.
    expect(licence).toBe(read(path.join(REPO, 'LICENSE')));
  });

  test('the manifest declares the licence the Windows installer also displays', () => {
    const pkg = JSON.parse(read(path.join(BROWSER, 'package.json')));
    expect(pkg.license).toBe('Apache-2.0');
    expect(pkg.build && pkg.build.nsis && pkg.build.nsis.license).toBe('LICENSE.txt');
  });

  test('the decision is recorded in docs-audit/licence-decision.md', () => {
    const decision = read(path.join(BROWSER, 'docs-audit/licence-decision.md'));
    expect(decision).toMatch(/Apache-2\.0/);
    expect(decision).toMatch(/EULA/);
  });
});

// ─── M16 ──────────────────────────────────────────────────────────────────────

describe('M16 — Comet → Aartiq persisted names', () => {
  test('first load migrates a legacy comet-audit.jsonl to aartiq-audit.jsonl', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aartiq-audit-'));
    try {
      const legacyPath = path.join(tmp, 'comet-audit.jsonl');
      const trail = '{"ts":1,"entry":"permission.grant x"}\n';
      fs.writeFileSync(legacyPath, trail);

      require('electron').app.getPath.mockReturnValue(tmp);
      const { PermissionStore } = require('../src/lib/permission-store');
      const store = new PermissionStore();
      await store.load();

      const newPath = path.join(tmp, 'aartiq-audit.jsonl');
      expect(store.auditPath).toBe(newPath);
      expect(fs.existsSync(newPath)).toBe(true);
      // The trail is moved, not copied: the old name is gone afterwards.
      expect(fs.existsSync(legacyPath)).toBe(false);
      expect(read(newPath)).toBe(trail);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('an existing aartiq-audit.jsonl is never clobbered by the legacy file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aartiq-audit-'));
    try {
      fs.writeFileSync(path.join(tmp, 'comet-audit.jsonl'), 'legacy\n');
      fs.writeFileSync(path.join(tmp, 'aartiq-audit.jsonl'), 'current\n');

      require('electron').app.getPath.mockReturnValue(tmp);
      const { PermissionStore } = require('../src/lib/permission-store');
      const store = new PermissionStore();
      await store.load();

      expect(read(path.join(tmp, 'aartiq-audit.jsonl'))).toBe('current\n');
      // Both exist after migration is skipped — nothing is silently destroyed.
      expect(fs.existsSync(path.join(tmp, 'comet-audit.jsonl'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('chat export dialogs default to aartiq-chat-*, not comet-chat-*', () => {
    const handlers = read(path.join(BROWSER, 'src/main/handlers/file-handlers.js'));
    expect(handlers).toMatch(/`aartiq-chat-\$\{Date\.now\(\)\}\.txt`/);
    expect(handlers).toMatch(/`aartiq-chat-\$\{Date\.now\(\)\}\.pdf`/);
    expect(handlers).not.toMatch(/comet-chat-/);

    const main = read(path.join(BROWSER, 'main.js'));
    expect(main).toMatch(/`aartiq-chat-session-\$\{Date\.now\(\)\}\.txt`/);
    expect(main).not.toMatch(/comet-chat-/);
  });
});
