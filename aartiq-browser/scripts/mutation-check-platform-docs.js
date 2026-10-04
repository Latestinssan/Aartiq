#!/usr/bin/env node
/**
 * Mutation check for tests/docs-platform-integration-match-source.test.js.
 *
 * A docs-transcription suite that cannot fail is worse than none, because it
 * gets read as evidence. Each mutation below is a plausible way the page or the
 * module could drift. A mutation is "killed" if the suite fails once applied; a
 * survivor means the suite is decorative.
 *
 * Findings already produced by this harness:
 *
 *   - "drop one duplicated channel from the Linux page list" survived at first,
 *     because the suite only required the page to *contain* each derived name,
 *     and every duplicated channel is also named in the page's bridge table. The
 *     suite now parses the page's DUPLICATE_HANDLERS and ORPHAN_HANDLERS arrays
 *     and compares them as sets.
 *
 *   - "make Windows volume stop calling PowerShell" survived at first because the
 *     mutation replaced the first bare `await executePowerShell(script)` in the
 *     file, which is not the volume handler's call — the volume handler passes a
 *     second argument. A mutation has to hit the code path the assertion is
 *     about.
 *
 *   - "add a genuine branch for a Windows dead channel" survived because it added
 *     a bare `webContents.send` on a channel that already had no listener. The
 *     suite derives reach by asking whether anything is *listening*, so a send on
 *     a dead channel does not move the fact being measured. Replaced with a
 *     mutation that adds a listener, which does.
 *
 *   - "restore the wake word as a supported phrase" survived because the suite
 *     located a retraction by searching a fixed window around the phrase, wide
 *     enough to reach a retraction in the previous clause. The suite now scopes
 *     the retraction to the phrase's own sentence, in front of or behind it.
 *
 * Each mutation throws if it cannot find its target, because a mutation that
 * silently does nothing would be recorded as a pass — the exact failure this
 * harness exists to prevent. Files are restored in a finally block.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const SUITE = 'tests/docs-platform-integration-match-source.test.js';

const TARGETS = {
  windowsDocs: path.join(REPO, '..', '..', 'Aartiq-Landing-Page/src/app/docs/windows-integration/page.tsx'),
  linuxDocs: path.join(REPO, '..', '..', 'Aartiq-Landing-Page/src/app/docs/linux-integration/page.tsx'),
  windowsJs: path.join(REPO, 'src/lib/windows-integration.js'),
  linuxJs: path.join(REPO, 'src/lib/linux-integration.js'),
  main: path.join(REPO, 'main.js'),
  preload: path.join(REPO, 'preload.js'),
};

/** Replace `pattern` exactly once, or throw. Refusing to no-op is the point. */
const once = (source, pattern, replacement, what) => {
  if (!pattern.test(source)) throw new Error(`target not found: ${what}`);
  const out = source.replace(pattern, replacement);
  if (out === source) throw new Error(`replacement changed nothing: ${what}`);
  return out;
};

const MUTATIONS = [
  {
    label: 'publish a dead Linux action as working (chat)',
    file: 'linuxDocs',
    apply: (s) =>
      once(
        s,
        /(action: "chat",\s*\n\s*reach: )"dead-channel"/,
        (m) => `${m[1]}"works"`,
        'linux chat reach'
      ),
  },
  {
    label: 'publish a working Linux action as dead (notify)',
    file: 'linuxDocs',
    apply: (s) =>
      once(
        s,
        /(action: "notify",\s*\n\s*reach: )"works"/,
        (m) => `${m[1]}"dead-channel"`,
        'linux notify reach'
      ),
  },
  {
    label: 'publish every Windows action as working',
    file: 'windowsDocs',
    apply: (s) =>
      once(s, /reach: "dead-channel" as Reach/g, 'reach: "works" as Reach', 'windows dead rows'),
  },
  {
    label: 'remove the Linux duplicate-registration section',
    file: 'linuxDocs',
    apply: (s) => {
      const start = s.indexOf('{/* The duplicate registration */}');
      const end = s.indexOf('{/* Desktop entries */}', start);
      if (start === -1 || end === -1) throw new Error('section markers not found');
      return s.slice(0, start) + s.slice(end);
    },
  },
  {
    label: 'drop one duplicated channel from the Linux page list',
    file: 'linuxDocs',
    apply: (s) => once(s, /  "linux:notify",\n/, '', 'DUPLICATE_HANDLERS entry'),
  },
  {
    label: 're-claim that Linux bridge methods have no handler',
    file: 'linuxDocs',
    apply: (s) =>
      once(
        s,
        /(registered twice\n)/,
        (m) => `${m[1]}Four of these methods have no handler and reject when called.\n`,
        'duplicate section body'
      ),
  },
  {
    label: 'add a second-instance handler, falsifying the delivery caveat',
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
    label: 'delete the Linux screenshot row',
    file: 'linuxDocs',
    apply: (s) =>
      once(
        s,
        /  \{\n    action: "screenshot",[\s\S]*?\n  \},\n/,
        '',
        'screenshot action row'
      ),
  },
  {
    label: 'double-escape the rendered Windows registry snippet',
    file: 'windowsDocs',
    apply: (s) =>
      once(s, /\[HKEY_CLASSES_ROOT\\\\aartiq\]/, '[HKEY_CLASSES_ROOT\\\\\\\\aartiq]', 'registry key'),
  },
  {
    label: 'restore the wake word as a supported phrase',
    file: 'windowsDocs',
    apply: (s) =>
      once(
        s,
        /(<code className="font-mono text-blue-300">Hey Aartiq<\/code>) does not appear anywhere/,
        '$1 is the wake word',
        'wake-word negation'
      ),
  },
  {
    label: 'remove a duplicated Linux channel from the module',
    file: 'linuxJs',
    apply: (s) =>
      once(
        s,
        /  ipcMain\.handle\('linux:notify',[\s\S]*?\n  \}\);\n/,
        '',
        'module linux:notify handler'
      ),
  },
  {
    label: 'add a preload invoke with no handler behind it',
    file: 'preload',
    apply: (s) =>
      once(
        s,
        /getDesktop: \(\) => ipcRenderer\.invoke\('linux:desktop:get'\),/,
        (m) => `${m}\n    launchUrl: () => ipcRenderer.invoke('linux:launch-url'),`,
        'linux getDesktop bridge method'
      ),
  },
  {
    label: 'let main.js register a Windows bridge channel too',
    file: 'main',
    apply: (s) =>
      once(
        s,
        /ipcMain\.handle\('linux:execute-action',/,
        (m) => `ipcMain.handle('windows:execute-action', () => {});\n${m}`,
        'linux:execute-action handler'
      ),
  },
  {
    label: 'make Windows volume stop calling PowerShell',
    file: 'windowsJs',
    apply: (s) =>
      once(
        s,
        /await executePowerShell\(script, \[String\(volumeLevel\)\]\);/,
        'const unused = volumeLevel;',
        'volume PowerShell call'
      ),
  },
  {
    label: 'give a dead Windows channel a renderer listener',
    // The suite measures reach by asking whether anything is listening, so a
    // mutation has to create a listener. Adding a bare send would not move the
    // fact being measured — that was the mistake in the first draft of this
    // harness.
    file: 'preload',
    apply: (s) =>
      once(
        s,
        /    ipcRenderer\.on\('ai-query-detected', subscription\);/,
        (m) => `${m}\n    ipcRenderer.on('ai:chat-message', () => {});`,
        'ai-query-detected subscription'
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

console.log('=== mutation check: docs-platform-integration-match-source ===');

try {
  // runSuite returns true on pass. A mutation harness is only meaningful on a
  // green baseline, so refuse to start otherwise rather than reporting every
  // mutation as killed for the wrong reason.
  if (!runSuite()) {
    console.error('  !! the suite fails on a clean tree; aborting');
    process.exit(1);
  }

  for (const mutation of MUTATIONS) {
    restore();
    let mutated;
    try {
      mutated = mutation.apply(original[mutation.file]);
    } catch (error) {
      console.log(`  UNAPPLIED  ${mutation.label} — ${error.message}`);
      unapplied++;
      continue;
    }
    fs.writeFileSync(TARGETS[mutation.file], mutated);

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