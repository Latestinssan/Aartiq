#!/usr/bin/env node
/**
 * mutation-check-manifest.js — does the manifest gate in scripts/check-docs.ts
 * catch a manifest that lies?
 *
 * The gate resolves every pointer in Landing_Page/data/features.manifest.json:
 * test files, test names, planned-test files, docs pages, manual-check sign-offs.
 * A resolver that has never been shown a broken pointer is a resolver nobody
 * knows the shape of, so each mutation here breaks one pointer in one way and
 * requires `npm run docs:check` to notice.
 *
 * Only the manifest is mutated. The gate and the files it reads are left alone,
 * because mutating those would be testing a different thing — that the gate can
 * be broken, not that it bites.
 *
 * Every mutation restores the file in a finally block, and the script refuses to
 * finish while the manifest differs from its starting bytes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..');
const FILE = path.join(REPO, 'Landing_Page', 'data', 'features.manifest.json');
const ORIGINAL = fs.readFileSync(FILE, 'utf8');

const read = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));

/** Apply `fn` to the parsed manifest and write it back. */
const write = (fn) => {
  const manifest = read();
  const result = fn(manifest);
  if (result === false) throw new Error('mutation could not find its target row or field');
  fs.writeFileSync(FILE, JSON.stringify(manifest, null, 2) + '\n');
};

const row = (manifest, id) => {
  const found = manifest.features.find((f) => f.id === id);
  if (!found) throw new Error(`no such feature: ${id}`);
  return found;
};

const MUTATIONS = [
  {
    label: 'a test id names a test file that does not exist',
    apply: () =>
      write((m) => {
        row(m, 'apple-intelligence.genmoji').tests[0] = 'tests/does-not-exist.test.js#anything';
      }),
  },
  {
    label: 'a test id names a test name the suite does not contain',
    apply: () =>
      write((m) => {
        row(m, 'keyboard.docs-table').tests[0] =
          'tests/docs-shortcuts-match-source.test.js#the docs list every shortcut and nothing elses';
      }),
  },
  {
    label: 'a test id has no #test-name suffix',
    apply: () =>
      write((m) => {
        row(m, 'linux.volume').tests[0] = 'tests/docs-platform-integration-match-source.test.js';
      }),
  },
  {
    label: 'a planned test is promoted in name only, while its file exists',
    apply: () =>
      write((m) => {
        row(m, 'linux.volume').plannedTestIds = [
          'tests/docs-platform-integration-match-source.test.js#something',
        ];
      }),
  },
  {
    label: 'a doc pointer names a page that does not exist',
    apply: () =>
      write((m) => {
        row(m, 'http-api.native-bridge').doc = ['docs/mcp-settings:239'];
      }),
  },
  {
    label: 'a manual-check sign-off names a document that does not exist',
    apply: () =>
      write((m) => {
        row(m, 'siri.appintents').manualCheck.signoff =
          'aartiq-browser/docs-audit/manual-checks/never-written.md';
      }),
  },
  {
    label: 'a manual-check document has no status line',
    // The row keeps its manualCheck, so the gate is obliged to read the document.
    // Deleting the field instead would leave the document unchecked, and the
    // mutation would prove nothing about the status-line rule.
    apply: () => {
      const doc = path.join(
        REPO,
        'aartiq-browser/docs-audit/manual-checks/siri-appintents.md'
      );
      const before = fs.readFileSync(doc, 'utf8');
      const after = before.replace(/^- status: *\S+\n/m, '');
      if (after === before) throw new Error('no status line to remove');
      DOC_BACKUP.push([doc, before]);
      fs.writeFileSync(doc, after);
    },
  },
  {
    label: 'a status is not one the manifest defines',
    apply: () =>
      write((m) => {
        row(m, 'deeplink.chat').status = 'probably-fine';
      }),
  },
  {
    label: 'a decision is not one the manifest defines',
    apply: () =>
      write((m) => {
        row(m, 'deeplink.chat').decision = 'ship-it';
      }),
  },
  {
    label: 'a risk tier is not one the manifest defines',
    apply: () =>
      write((m) => {
        row(m, 'deeplink.chat').riskTier = 'spicy';
      }),
  },
  {
    label: 'the same feature is listed twice',
    apply: () =>
      write((m) => {
        m.features.push(JSON.parse(JSON.stringify(row(m, 'deeplink.chat'))));
      }),
  },
  {
    label: 'a row claims to work with no evidence at all',
    apply: () =>
      write((m) => {
        row(m, 'deeplink.chat').evidence = [];
      }),
  },
  {
    label: 'a row is published as available with no test and no manual check',
    // This one is expected to SURVIVE as a failure and surface as a warning:
    // it is the maintainer's queue, and blocking every docs edit on it would not
    // make it true any sooner. Asserted as a warning below rather than ignored.
    expect: 'warn',
    apply: () =>
      write((m) => {
        const target = row(m, 'apple-intelligence.summary');
        target.tests = [];
        target.status = 'works';
      }),
  },
  {
    label: 'the baseline names a commit that does not exist',
    apply: () =>
      write((m) => {
        m.baseline.verifiedAgainst = 'deadbee1';
      }),
  },
  {
    label: 'a cited evidence file moved since the manifest was last re-read',
    // The strongest of these mutations: nothing about the manifest's own wording
    // is wrong, and every pointer still resolves. The rows are stale because the
    // code moved, which is exactly the case the baseline check exists for.
    apply: () =>
      write((m) => {
        // An ancestor far enough back that the cited files have certainly changed.
        m.baseline.verifiedAgainst = '63baa5ee';
      }),
    expect: 'warn',
  },
  {
    label: 'the manifest carries the project-origin brand name',
    apply: () => write((m) => {
      row(m, 'deeplink.chat').notes += ' Tracked upstream by the maintainer.';
    }),
  },
];

const DOC_BACKUP = [];

const runCheck = () => {
  try {
    const stdout = execFileSync('npm', ['run', '--silent', 'docs:check'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { failed: false, stdout };
  } catch (error) {
    return {
      failed: true,
      stdout: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
};

/**
 * Idempotent on purpose. restore() runs at the top of every iteration as well as
 * in the finally block, so an earlier version that deleted its own .bak files
 * threw on the second pass — and it threw from inside the restore path, which is
 * the one place that must never fail.
 */
const restore = () => {
  fs.writeFileSync(FILE, ORIGINAL);
  while (DOC_BACKUP.length > 0) {
    const [doc, before] = DOC_BACKUP.pop();
    fs.writeFileSync(doc, before);
  }
};

let caught = 0;
let missed = 0;

console.log('=== mutation check: the feature manifest gate ===');
console.log('');

try {
  const baseline = runCheck();
  if (baseline.failed) {
    console.error('  !! docs:check already fails on a clean tree; aborting');
    console.error(baseline.stdout.slice(-2000));
    process.exit(1);
  }

  for (const mutation of MUTATIONS) {
    restore();
    try {
      mutation.apply();
    } catch (error) {
      console.log(`  UNAPPLIED  ${mutation.label} — ${error.message}`);
      missed++;
      continue;
    }

    const result = runCheck();
    const shouldWarn = mutation.expect === 'warn';
    const noticed = result.failed || /feature\(s\) are marked "works"/.test(result.stdout);

    if (noticed && shouldWarn) {
      console.log(`  warned     ${mutation.label}`);
      caught++;
    } else if (noticed) {
      console.log(`  killed     ${mutation.label}`);
      caught++;
    } else {
      console.log(`  SURVIVED   ${mutation.label}`);
      missed++;
    }
  }
} finally {
  restore();
}

const final = fs.readFileSync(FILE, 'utf8');
console.log('');
console.log(`mutations attempted: ${MUTATIONS.length}`);
console.log(`noticed:             ${caught}`);
console.log(`missed:              ${missed}`);

if (final !== ORIGINAL) {
  console.error('FAIL: the manifest was not restored to its starting bytes');
  process.exit(1);
}
if (missed > 0) {
  console.error('FAIL: a mutation went unnoticed, so the gate does not catch that class of drift');
  process.exit(1);
}
console.log('PASS: every mutation was noticed');
