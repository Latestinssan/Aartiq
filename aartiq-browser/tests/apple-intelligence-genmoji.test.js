/**
 * apple-intelligence-genmoji.test.js
 *
 * Acceptance tests for `apple-intelligence-genmoji`, the fourth Apple
 * Intelligence command. The handler, the Swift case and the preload bridge all
 * exist; what did not exist was a test, and what the docs omitted was the
 * command itself plus the real OS floor. These tests pin all four layers so the
 * next edit cannot quietly drop one of them.
 *
 * Division of labour, stated up front rather than discovered later:
 *
 *   automatable here  — export surface, request payload, the non-macOS refusal,
 *                       IPC channel agreement between main and preload, the
 *                       Swift availability gate, and the docs listing
 *   not automatable   — that macOS actually renders an emoji. That needs macOS
 *                       15.4+, Apple Intelligence enabled, and a human looking
 *                       at a picture. It is tracked in
 *                       docs-audit/manual-checks/apple-intelligence-genmoji.md
 *                       and stays "manual-verified" only after dated sign-off.
 *
 * No mock of the unit under test. `child_process` is the one true external
 * standing in for the helper process, and it is stubbed so the suite never
 * shells out. `process.resourcesPath` is pointed at a throwaway directory
 * holding a stub helper binary so `resolveAppleIntelligenceBinary` takes its
 * normal first branch instead of invoking `swiftc` — without this the test
 * compiles Swift as a side effect and its result depends on what is already in
 * `bin/`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..');
const LANDING = path.join(REPO, '..', '..', 'Aartiq-Landing-Page');

const read = (p) => fs.readFileSync(p, 'utf8');

let spawnCalls;
let helperOutput;
let fakeResources;

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    spawn: (command, args, options) => {
      const entry = { command, args, options, stdin: '', close: null };
      spawnCalls.push(entry);
      return {
        stdin: {
          write: (chunk) => { entry.stdin += chunk; },
          end: () => { setImmediate(() => entry.close(0)); },
        },
        stdout: { on: (event, cb) => { if (event === 'data') cb(helperOutput); } },
        stderr: { on: () => {} },
        on: (event, cb) => { if (event === 'close') entry.close = cb; },
      };
    },
  };
});

const appleIntelligence = require('../src/lib/apple-intelligence.js');

const swiftSource = () => read(path.join(REPO, 'src/lib/apple-intelligence.swift'));
const mainSource = () => read(path.join(REPO, 'main.js'));
const preloadSource = () => read(path.join(REPO, 'preload.js'));
const docsPage = (name) => read(path.join(LANDING, 'src/app/docs', name, 'page.tsx'));

/** The body of one `case "<name>":` arm of the helper's command switch. */
const swiftCase = (name) => {
  const src = swiftSource();
  const start = src.indexOf(`case "${name}":`);
  const end = src.indexOf('default:', start);
  return src.slice(start, end === -1 ? start + 4000 : end);
};

const sentPayload = () => JSON.parse(spawnCalls[0].stdin);

beforeAll(() => {
  fakeResources = fs.mkdtempSync(path.join(os.tmpdir(), 'aartiq-genmoji-'));
  fs.mkdirSync(path.join(fakeResources, 'bin'), { recursive: true });
  // A stub, not a real helper: resolveAppleIntelligenceBinary only checks that
  // this path exists, and spawn is stubbed, so nothing is ever executed.
  fs.writeFileSync(path.join(fakeResources, 'bin', 'Aartiq-AppleIntelligence'), '');
  Object.defineProperty(process, 'resourcesPath', { value: fakeResources, configurable: true });
});

afterAll(() => {
  fs.rmSync(fakeResources, { recursive: true, force: true });
});

beforeEach(() => {
  spawnCalls = [];
  helperOutput = '{"success":true,"genmojiAvailable":true,"genmojiPath":"/tmp/emoji.png"}';
});

// ── export surface ────────────────────────────────────────────────────────

describe('generateGenmoji is a real export, not an alias of the image path', () => {
  test('the module exports generateGenmoji as a function', () => {
    expect(typeof appleIntelligence.generateGenmoji).toBe('function');
  });

  test('generateGenmoji is not the same function object as generateAppleIntelligenceImage', () => {
    // A copy-paste that wired genmoji to the image command would satisfy the
    // export check above; only identity distinguishes them.
    expect(appleIntelligence.generateGenmoji)
      .not.toBe(appleIntelligence.generateAppleIntelligenceImage);
  });

  test('all four Apple Intelligence commands are exported', () => {
    for (const name of [
      'getAppleIntelligenceStatus',
      'summarizeWithAppleIntelligence',
      'generateAppleIntelligenceImage',
      'generateGenmoji',
    ]) {
      expect(typeof appleIntelligence[name]).toBe('function');
    }
  });
});

// ── request payload ───────────────────────────────────────────────────────

describe('generateGenmoji sends exactly one genmoji command with the prompt', () => {
  test('it spawns the helper once, with command "genmoji" and the prompt', async () => {
    const result = await appleIntelligence.generateGenmoji('a cat wearing a hat');

    expect(spawnCalls).toHaveLength(1);
    expect(path.basename(spawnCalls[0].command)).toBe('Aartiq-AppleIntelligence');
    expect(sentPayload()).toEqual({ command: 'genmoji', prompt: 'a cat wearing a hat' });
    expect(result).toMatchObject({ success: true, genmojiAvailable: true });
  });

  test('a prompt containing shell metacharacters travels as JSON data, not as a shell string', async () => {
    await appleIntelligence.generateGenmoji('"; rm -rf ~ #');

    expect(sentPayload().prompt).toBe('"; rm -rf ~ #');
    // Nothing was concatenated into a command line. The metacharacters are
    // escaped by JSON encoding and the helper is exec'd with no argv and no
    // shell, which is the property that matters.
    expect(spawnCalls[0].stdin).toContain('\\"');
    expect(spawnCalls[0].args).toEqual([]);
    expect(spawnCalls[0].options.shell).toBeUndefined();
  });

  test('an undefined prompt is still serialised, so the helper can refuse it', async () => {
    await appleIntelligence.generateGenmoji(undefined);
    expect(sentPayload()).toEqual({ command: 'genmoji', prompt: undefined });
  });
});

// ── the non-macOS refusal ─────────────────────────────────────────────────

describe('Apple Intelligence refuses off macOS before doing any work', () => {
  const realPlatform = process.platform;
  const asPlatform = (value) =>
    Object.defineProperty(process, 'platform', { value, configurable: true });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
  });

  test.each(['win32', 'linux'])('on %s it returns the platform error and never spawns', async (platform) => {
    asPlatform(platform);
    await expect(appleIntelligence.generateGenmoji('a cat')).resolves.toEqual({
      success: false,
      error: 'Apple Intelligence is only available on macOS.',
    });
    expect(spawnCalls).toHaveLength(0);
  });

  test('the same refusal covers status, summary and image', async () => {
    asPlatform('linux');
    for (const call of [
      () => appleIntelligence.getAppleIntelligenceStatus(),
      () => appleIntelligence.summarizeWithAppleIntelligence('some text'),
      () => appleIntelligence.generateAppleIntelligenceImage('a cat'),
      () => appleIntelligence.generateGenmoji('a cat'),
    ]) {
      await expect(call()).resolves.toMatchObject({ success: false });
    }
    expect(spawnCalls).toHaveLength(0);
  });
});

// ── IPC wiring ────────────────────────────────────────────────────────────

describe('the renderer reaches the command through one agreed channel name', () => {
  test('main registers apple-intelligence-genmoji and forwards the prompt', () => {
    expect(mainSource()).toMatch(
      /ipcMain\.handle\(\s*'apple-intelligence-genmoji',\s*async \(event, \{ prompt \} = \{\}\) => \{\s*return generateGenmoji\(prompt\);/,
    );
  });

  test('preload invokes the same channel and exposes generateGenmoji on electronAPI', () => {
    expect(preloadSource()).toMatch(
      /generateGenmoji:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(\s*'apple-intelligence-genmoji'/,
    );
  });

  test('electronAPI is the only bridge preload exposes', () => {
    const bridges = [...preloadSource().matchAll(/exposeInMainWorld\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(bridges).toEqual(['electronAPI']);
  });

  test('remote pages get no Apple Intelligence entry point', () => {
    // view_preload.js is what a browsed web page runs. An emoji generator
    // reachable from an arbitrary site is not a feature, it is an oracle.
    const viewPreload = read(path.join(REPO, 'view_preload.js'));
    expect(viewPreload).not.toMatch(/genmoji/i);
    expect(viewPreload).not.toMatch(/apple-intelligence/i);
  });

  test('the channel name appears in main and preload and nowhere else', () => {
    const files = ['main.js', 'preload.js'];
    const hits = files.filter((f) => read(path.join(REPO, f)).includes("'apple-intelligence-genmoji"));
    expect(hits).toEqual(['main.js', 'preload.js']);
  });
});

// ── the Swift gate ────────────────────────────────────────────────────────

describe('the Swift helper gates genmoji the way the docs must describe it', () => {
  test('the helper handles a "genmoji" command', () => {
    expect(swiftSource()).toMatch(/case\s+"genmoji"\s*:/);
  });

  test('genmoji is refused below macOS 15.4 with a reason the UI can show', () => {
    const arm = swiftCase('genmoji');
    expect(arm).toMatch(/#available\(macOS 15\.4, \*\)/);
    expect(arm).toMatch(/genmojiReason:\s*"Genmoji requires macOS 15\.4 or newer\."/);
    expect(arm).toMatch(/error:\s*"Genmoji requires macOS 15\.4\. Current:/);
  });

  test('an empty prompt is refused before any framework call', () => {
    expect(swiftCase('genmoji')).toMatch(/No prompt provided for Genmoji/);
  });

  test('the three commands have three different OS floors', () => {
    // The docs used to state a single "macOS 15.0 or later" for all of them.
    expect(swiftCase('summary')).toMatch(/#available\(macOS 26\.0, \*\)/);
    expect(swiftSource()).toMatch(/Image Playground requires macOS 15\.1 or newer\./);
    expect(swiftSource()).toMatch(/Genmoji requires macOS 15\.4 or newer\./);
  });
});

// ── documentation ─────────────────────────────────────────────────────────

describe('the docs describe the command and its real OS floor', () => {
  test('native-api lists apple-intelligence-genmoji', () => {
    expect(docsPage('native-api')).toMatch(/['"]apple-intelligence-genmoji['"]/);
  });

  test('api-reference lists apple-intelligence-genmoji', () => {
    expect(docsPage('api-reference')).toMatch(/['"]apple-intelligence-genmoji['"]/);
  });

  test('the Apple page no longer claims one OS floor for all three commands', () => {
    const page = docsPage('apple-integration');
    expect(page).not.toMatch(/macOS 15\.0 or later/);
    expect(page).toMatch(/26\.0/);
    expect(page).toMatch(/15\.4/);
  });

  test('no docs page calls a bridge that does not exist', () => {
    // window.electron is exposed by no preload; window.electronAPI is. A page
    // may still *mention* the phantom global while correcting it, so this
    // asserts on call sites rather than on the substring: a call is
    // `window.electron.` followed by something that looks like a member
    // access, which is what a copy-paste would hit.
    for (const name of ['native-api', 'api-reference', 'apple-integration']) {
      const page = docsPage(name);
      // Strip line comments and the prose corrections before looking for calls.
      const executable = page
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');

      const phantom = executable.match(/window\.electron\.\s*[A-Za-z_$]/g) || [];
      expect({ page: name, phantom }).toEqual({ page: name, phantom: [] });
    }
  });

  test('every docs page that mentions the phantom global says it does not exist', () => {
    // Otherwise the correction reads as documentation of a real API.
    for (const name of ['native-api', 'api-reference', 'apple-integration']) {
      const page = docsPage(name);
      if (!/window\.electron[^A]/.test(page)) continue;
      expect({ page, corrects: /does not exist|no preload (exposes|creates)|only bridge/i.test(page) })
        .toEqual({ page, corrects: true });
    }
  });

  test('the Apple page drops features with no implementation behind them', () => {
    expect(docsPage('apple-integration')).not.toMatch(/Priority Notifications/);
  });
});
