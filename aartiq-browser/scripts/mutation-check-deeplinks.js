#!/usr/bin/env node
/**
 * Mutation check for tests/docs-deep-links-match-source.test.js.
 *
 * A docs-transcription test that cannot fail is worse than no test, because it
 * gets read as evidence. Every mutation below is a plausible way the page or
 * the handler could drift. A mutation is "killed" if the suite fails once it is
 * applied; a survivor means the suite is decorative and its green run means
 * nothing.
 *
 * Each mutation is a function that receives the current file contents and
 * returns new contents. It must throw if it cannot find its target, because a
 * mutation that silently does nothing would be recorded as a pass — which is
 * the exact failure this harness exists to prevent.
 *
 * Files are restored in a finally block, including after a crash, so a failed
 * run never leaves the working tree mutated.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const SUITE = 'tests/docs-deep-links-match-source.test.js';

const TARGETS = {
  page: path.join(REPO, '..', '..', 'Aartiq-Landing-Page/src/app/docs/deep-links/page.tsx'),
  main: path.join(REPO, 'main.js'),
  shortcuts: path.join(REPO, 'src/lib/SiriShortcutsIntegration.js'),
  preload: path.join(REPO, 'preload.js'),
};

/** Replace `pattern` exactly once, or throw. Refusing to no-op is the point. */
const once = (source, pattern, replacement, what) => {
  const matches = source.match(pattern);
  if (!matches) throw new Error(`target not found: ${what}`);
  const out = source.replace(pattern, replacement);
  if (out === source) throw new Error(`replacement changed nothing: ${what}`);
  return out;
};

const MUTATIONS = [
  {
    label: 'publish a dead command as working (index)',
    file: 'page',
    apply: (s) =>
      once(
        s,
        /(\{\s*\n\s*command: "index",[\s\S]*?)status: "dead",/,
        (m, pre) => `${pre}status: "works",`,
        'index status'
      ),
  },
  {
    label: 'publish a prepares command as working (run-command)',
    file: 'page',
    apply: (s) =>
      once(
        s,
        /(\{\s*\n\s*command: "run-command",[\s\S]*?)status: "prepares",/,
        (m, pre) => `${pre}status: "works",`,
        'run-command status'
      ),
  },
  {
    label: 'drop the create-doc row from the docs',
    file: 'page',
    apply: (s) => once(s, /\t?\{\s*\n\s*command: "create-doc",[\s\S]*?\n  \},\n/, '', 'create-doc row'),
  },
  {
    label: 'add an unregistered command to the handler',
    file: 'main',
    apply: (s) =>
      once(
        s,
        /(\s*)'index': 'open-main',/,
        (m, indent) => `${indent}'index': 'open-main',\n${indent}'teleport': 'open-main',`,
        'commandMap index entry'
      ),
  },
  {
    label: 'make create-pdf actually build a document',
    file: 'shortcuts',
    apply: (s) =>
      once(
        s,
        /return \{ success: true, message: `Prepared PDF request for \$\{title\}` \};/,
        (m) =>
          `await execPromise(\`pandoc out/\${title}.md -o out/\${title}.pdf\`);\n      ${m}`,
        'create-pdf return'
      ),
  },
  {
    // The first draft of this mutation added a *send* in the action runner and
    // expected the listener assertion to fail. It survived, correctly: sending
    // on a channel does not make anything listen to it. The mutation has to
    // create the fact the assertion measures, which is a subscription.
    label: 'give a dead command a real renderer listener',
    file: 'preload',
    apply: (s) =>
      once(
        s,
        /ipcRenderer\.on\('auth-callback', subscription\);/,
        (m) => `${m}\n    ipcRenderer.on('system:screenshot', () => {});`,
        'auth-callback subscription'
      ),
  },
  {
    label: 'subscribe the renderer to ai:request-speak-response',
    file: 'preload',
    apply: (s) =>
      once(
        s,
        /ipcRenderer\.on\('auth-callback', subscription\);/,
        (m) => `${m}\n    ipcRenderer.on('ai:request-speak-response', () => {});`,
        'auth-callback subscription'
      ),
  },
  {
    label: 'document a parameter the handler never reads',
    file: 'page',
    apply: (s) =>
      once(
        s,
        /\s*\["level", "volume"\],/,
        (m) => `${m}\n  ["theme", "every command"],`,
        'PARAMS_READ level row'
      ),
  },
  {
    label: 're-advertise the invented pdf-viewer route',
    file: 'page',
    apply: (s) =>
      once(
        s,
        /(command: "pdf",\n    params: "\(none\)",\n    effect: )/,
        (m) => `${m}"Open aartiq://pdf-viewer?file=report.pdf in the viewer. "`,
        'pdf command effect'
      ),
  },
  {
    label: 'add a second-instance handler, falsifying the macOS-only claim',
    file: 'main',
    apply: (s) =>
      once(
        s,
        /app\.on\('certificate-error',/,
        (m) => `app.on('second-instance', () => {});\n${m}`,
        'certificate-error handler'
      ),
  },
  {
    // Removes the caveat's substance, not just its heading. The first draft only
    // renamed the heading and survived, because the assertion was matching a
    // bare "macOS only" phrase that the page also uses for the osascript rows.
    label: 'delete the macOS-only caveat from the page',
    file: 'page',
    apply: (s) => {
      let out = once(s, /Delivery is macOS only/, (m) => 'Delivery', 'macOS-only heading');
      out = once(out, /requestSingleInstanceLock/, (m) => 'a lock', 'lock reference');
      out = once(out, /and is discarded/, (m) => 'and is dropped', 'discarded phrasing');
      return out;
    },
  },
  {
    label: 're-add Firebase Dynamic Links as a supported mechanism',
    file: 'page',
    apply: (s) =>
      once(
        s,
        /note: "main\.js:open-url accepts/,
        (m) => `note: "Firebase Dynamic Links are supported. ${m}`,
        'aartiq scheme note'
      ),
  },
];

const original = Object.fromEntries(
  Object.entries(TARGETS).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')])
);

const restore = () => {
  for (const [key, file] of Object.entries(TARGETS)) {
    fs.writeFileSync(file, original[key]);
  }
};

const runSuite = () => {
  try {
    execFileSync('npx', ['jest', SUITE, '--silent'], { cwd: REPO, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

let killed = 0;
let survived = 0;
let unapplied = 0;

console.log('=== mutation check: docs-deep-links-match-source ===');

try {
  // runSuite returns true on pass. A mutation harness is only meaningful on a
  // green baseline, so refuse to start otherwise rather than reporting every
  // mutation as "killed" for the wrong reason.
  if (!runSuite()) {
    console.error('  !! the suite fails on a clean tree; aborting');
    process.exit(1);
  }

  for (const mutation of MUTATIONS) {
    restore();
    const file = TARGETS[mutation.file];
    let mutated;
    try {
      mutated = mutation.apply(original[mutation.file]);
    } catch (error) {
      console.log(`  UNAPPLIED  ${mutation.label} — ${error.message}`);
      unapplied++;
      continue;
    }
    fs.writeFileSync(file, mutated);

    if (runSuite()) {
      console.log(`  SURVIVED   ${mutation.label}`);
      survived++;
    } else {
      console.log(`  killed     ${mutation.label}`);
      killed++;
    }
  }
} finally {
  restore();
}

console.log('');
console.log(`mutations attempted: ${MUTATIONS.length}`);
console.log(`killed:              ${killed}`);
console.log(`survived:            ${survived}`);
console.log(`failed to apply:     ${unapplied}`);

if (unapplied > 0) {
  console.error('FAIL: a mutation could not be applied, so it proves nothing');
  process.exit(1);
}
if (survived > 0) {
  console.error(`FAIL: ${survived} mutation(s) survived; the suite does not catch this drift`);
  process.exit(1);
}
console.log('PASS: every mutation was caught');