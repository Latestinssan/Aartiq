/**
 * docs-platform-integration-match-source.test.js
 *
 * The windows-integration and linux-integration docs pages each described an
 * integration surface considerably larger than the one that exists. Both are
 * now transcriptions of their modules, kept in a separate repository, and both
 * make a claim a reader cannot check by reading: that a given action reaches
 * the app.
 *
 * That claim is what this suite derives rather than reads. For every action in
 * each module it determines, from source alone:
 *
 *   - is the action a key in the actionHandlers table?
 *   - does its handler send on an IPC channel?
 *   - does a renderer subscribe to that channel?
 *   - does the handler instead reach a real system API?
 *
 * and then requires the page's reach column to agree. A page that upgrades a
 * dead action to "works" fails here.
 *
 * It also pins the platform-wide facts the pages lead with:
 *
 *   - the protocol scheme is registered but never delivered, because the
 *     handler that would receive a URL is imported and never called;
 *   - the two IPC bridges are internally consistent — every channel the preload
 *     invokes has a handler — with one exception that is an exception in the
 *     other direction, on Linux, described below;
 *   - five Linux bridge channels are registered twice, once by the module and
 *     once by main.js.
 *
 * Findings this suite has already produced, recorded here because they are the
 * reason some assertions are shaped the way they are:
 *
 *   - An earlier version of this file reported that four of the eleven Linux
 *     bridge channels had no handler. That was a test bug: the grep that fed
 *     it only read src/lib/linux-integration.js and missed the eleven
 *     registrations in main.js. There is no gap. The suite now asserts the
 *     opposite, so the same bug cannot come back silently.
 *
 *   - `reachesApi` originally matched exec/execPromise/executeCommand and
 *     missed `executePowerShell`, which is how the Windows volume handler
 *     reaches the system. Windows volume therefore derived as "dead" and the
 *     page's correct "works" failed the suite. The list now includes it.
 *
 * No module under test is mocked. Every file is read from disk.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');
const docs = (slug) =>
  fs.readFileSync(
    path.join(REPO, '..', '..', 'Aartiq-Landing-Page', 'src/app/docs', slug, 'page.tsx'),
    'utf8'
  );

const MAIN_JS = read('main.js');
const WINDOWS_JS = read('src/lib/windows-integration.js');
const LINUX_JS = read('src/lib/linux-integration.js');
const PRELOAD_JS = read('preload.js');

const WINDOWS_DOCS = docs('windows-integration');
const LINUX_DOCS = docs('linux-integration');

/* ── prose helpers ───────────────────────────────────────────────────────── */

/**
 * The page as a reader sees it, minus two places a retracted claim is allowed
 * to survive: its explanatory comments, and its own "claims removed" array.
 *
 * Both exclusions are load-bearing. A page has to be able to say "this used to
 * claim X" — that is the correction — while being forbidden from claiming X
 * anywhere else. Asserting on the raw source forbids the correction; asserting
 * on a source with the array excised out of the way forbids the claim.
 */
const live = (source) => {
  const withoutComments = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  const start = withoutComments.indexOf('const REMOVED = [');
  if (start === -1) return withoutComments.replace(/\s+/g, ' ');
  const end = withoutComments.indexOf('];', start);
  return (
    withoutComments.slice(0, start) + withoutComments.slice(end)
  ).replace(/\s+/g, ' ');
};

/** The retracted-claims array, so a test can require a claim to be listed. */
const removedList = (source) => {
  const start = source.indexOf('const REMOVED = [');
  return [
    ...source.slice(start, source.indexOf('];', start)).matchAll(
      /^\s*"((?:[^"\\]|\\.)*)"/gm
    ),
  ].map((m) => m[1].replace(/\\"/g, '"'));
};

/**
 * Assert that a phrase appears nowhere in the live page, and report the check as
 * a small object so a failure prints the phrase rather than the whole page.
 */
const expectAbsent = (source, phrase, flags = 'i') => {
  const present = new RegExp(phrase, flags).test(live(source));
  expect({ phrase, present }).toEqual({ phrase, present: false });
};

/**
 * Language that turns a mention into a retraction. A page is allowed to name a
 * thing it does not have, in order to say that it does not have it — "the string
 * `Hey Aartiq` does not appear in this repository" is the correction, and
 * removing it would leave the reader unable to tell what changed.
 *
 * `no \w+` is deliberately absent even though the prose uses it ("the module
 * invokes no screenshot program"). It was tried and it was too loose: it matched
 * "and no module is installed", a negation about the PowerShell module, and used
 * that to excuse the same sentence asserting the wake word. A negation has to be
 * about the thing being mentioned, so the markers here are forms that can only
 * negate a verb or a clause rather than an unrelated noun phrase.
 */
const NEGATION =
  /\b(?:does not|do not|doesn't|don't|no longer|not |never|nothing|none of|without|removed|previously|the previous version|the old page|used to|absent|is not|are not|was not|has no|have no|had no)\b/i;

/** Split prose into sentences. live() has already collapsed the whitespace. */
const sentences = (text) => text.split(/(?<=[.;?!])\s+/);

/** How far back from a phrase a retraction in front of it may sit. */
const PREFIX_WINDOW = 60;

/**
 * A phrase must either be gone from the live page, or be retracted where it
 * appears.
 *
 * A retraction is either in the PREFIX_WINDOW characters immediately before the
 * phrase, or anywhere after it in the same sentence — which is where "does not
 * appear" and "is not supported" live, since English puts the negation on the
 * verb that follows its subject.
 *
 * Two looser designs were tried and both let a real claim through:
 *
 *   - a fixed 220-character window either side. It reached past the clause
 *     boundary and picked up "the previous version of this page listed twelve
 *     Hey Aartiq phrases", so that unrelated retraction excused the same
 *     paragraph asserting the wake word one clause later.
 *
 *   - requiring a negation anywhere in the sentence. A sentence that asserts
 *     the phrase and then negates something else in the same breath still
 *     passed.
 *
 * Known limit: a single sentence that both retracts and asserts the same phrase
 * — "the previous version listed Hey Aartiq phrases, and Hey Aartiq is the wake
 * word" — passes if the retraction falls inside the prefix window. That
 * paragraph is self-contradictory and no plausible edit produces it. It is
 * recorded here rather than papered over with a longer heuristic.
 *
 * Returning the offending sentences rather than the whole page keeps a failure
 * readable, which matters because these assertions fail by printing source.
 */
const expectAbsentOrNegated = (source, phrase) => {
  const stillAsserted = [];
  for (const sentence of sentences(live(source))) {
    const pattern = new RegExp(phrase, 'gi');
    for (const m of sentence.matchAll(pattern)) {
      const prefix = sentence.slice(Math.max(0, m.index - PREFIX_WINDOW), m.index);
      const suffix = sentence.slice(m.index + m[0].length);
      if (!NEGATION.test(prefix) && !NEGATION.test(suffix)) {
        stillAsserted.push(sentence.trim());
        break;
      }
    }
  }
  expect({ phrase, stillAsserted }).toEqual({ phrase, stillAsserted: [] });
};

/* ── renderer subscriptions ──────────────────────────────────────────────── */

const preloadSubscribed = new Set(
  [...PRELOAD_JS.matchAll(/ipcRenderer\.(?:on|once)\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
);

const rendererSubscribed = (() => {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        const text = fs.readFileSync(path.join(REPO, rel), 'utf8');
        for (const m of text.matchAll(
          /(?:ipcRenderer|electronAPI|window\.electron)\.(?:on|once)\(\s*['"]([^'"]+)['"]/g
        )) {
          found.add(m[1]);
        }
      }
    }
  };
  for (const dir of ['src/app', 'src/components', 'src/hooks']) {
    if (fs.existsSync(path.join(REPO, dir))) walk(dir);
  }
  return found;
})();

const channelIsListened = (channel) =>
  preloadSubscribed.has(channel) || rendererSubscribed.has(channel);

/* ── per-platform facts ──────────────────────────────────────────────────── */

/**
 * Calls that mean "this handler touches the machine", not just another channel.
 *
 * `executePowerShell` is here because the Windows volume and voice handlers
 * reach the system through it and through nothing else. Leaving it out made
 * volume derive as dead.
 */
const SYSTEM_CALLS =
  /exec\(|execPromise\(|executePowerShell\(|executeCommand\(|shell\.open|speakText\(/;

const analyse = (source) => {
  const handlers = [...source.matchAll(/async function (handle\w+Action)\(params\)/g)];
  const bodies = new Map();
  for (let i = 0; i < handlers.length; i++) {
    const from = handlers[i].index + handlers[i][0].length;
    const to = i + 1 < handlers.length ? handlers[i + 1].index : source.length;
    bodies.set(handlers[i][1], source.slice(from, to));
  }

  const table = source.slice(source.indexOf('const actionHandlers = {'));
  const actions = new Map();
  for (const m of table.slice(0, table.indexOf('};')).matchAll(/'([\w:-]+)'\s*:\s*(\w+)/g)) {
    const body = bodies.get(m[2]) || '';
    const sends = [...new Set([...body.matchAll(/\.send\('([\w:-]+)'/g)].map((x) => x[1]))];
    actions.set(m[1], {
      handler: m[2],
      sends,
      reachesApi: SYSTEM_CALLS.test(body),
      // A send only means something if something is listening for it.
      effective: sends.some((channel) => channelIsListened(channel)),
    });
  }
  return actions;
};

const windows = analyse(WINDOWS_JS);
const linux = analyse(LINUX_JS);

/** reach, as the pages state it, derived from whether anything hears the send. */
const derivedReach = (action) =>
  action.reachesApi || action.effective ? 'works' : 'dead-channel';

/** the docs' reach column */
const docsReach = (source) =>
  new Map(
    [...source.matchAll(/action:\s*"([\w:-]+)",\s*\n\s*reach:\s*"([\w-]+)"/g)].map((m) => [
      m[1],
      m[2],
    ])
  );

const WINDOWS_REACH = docsReach(WINDOWS_DOCS);
const LINUX_REACH = docsReach(LINUX_DOCS);

/* ── the pages, action by action ─────────────────────────────────────────── */

describe.each([
  ['windows', windows, WINDOWS_DOCS, WINDOWS_REACH],
  ['linux', linux, LINUX_DOCS, LINUX_REACH],
])('%s integration page matches its module', (_slug, actions, source, reach) => {
  test('the module still has the action table this suite parses', () => {
    expect(actions.size).toBe(12);
  });

  test('the page publishes exactly the actions the module handles', () => {
    expect([...reach.keys()].sort()).toEqual([...actions.keys()].sort());
  });

  test('every published reach value is the one derived from source', () => {
    const wrong = [...reach]
      .map(([action, published]) => ({
        action,
        published,
        derived: derivedReach(actions.get(action)),
      }))
      .filter((r) => r.published !== r.derived);
    expect(wrong).toEqual([]);
  });

  test('no action is published as working when its channel has no listener', () => {
    const inflated = [...actions]
      .filter(([, a]) => !a.reachesApi && !a.effective)
      .map(([name]) => name)
      .filter((name) => reach.get(name) === 'works');
    expect(inflated).toEqual([]);
  });

  test('the actions that reach a system API are the ones the source really executes', () => {
    // The mirror image of the check above, so a page cannot simply flip every
    // row to "works" or every row to "dead".
    const executed = [...actions]
      .filter(([, a]) => a.reachesApi)
      .map(([name]) => name)
      .sort();
    const publishedWorks = [...reach]
      .filter(([, status]) => status === 'works')
      .map(([action]) => action)
      .filter((action) => !actions.get(action).effective)
      .sort();
    expect(publishedWorks).toEqual(executed);
  });

  test('the page does not claim any action is reachable by a link', () => {
    // Delivery is broken on both platforms, so a reachable-by-link claim would
    // be false even for the actions that work when invoked in-process.
    expectAbsent(source, 'any (?:Windows|Linux) shortcut');
  });

  test('the page carries the delivery caveat', () => {
    expect({ text: live(source) }).toEqual({
      text: expect.stringMatching(/discarded|never delivered/),
    });
  });
});

/* ── delivery ────────────────────────────────────────────────────────────── */

describe('both platform pages describe a delivery path that does not exist', () => {
  test.each([
    ['handleURLSchemeEvent', WINDOWS_JS],
    ['handleLinuxURLScheme', LINUX_JS],
  ])('%s exists in its module but is never called from main.js', (name, source) => {
    expect(source).toContain(`function ${name}`);
    // The identifier appears in main.js only inside the destructuring require.
    // A call would be followed by an opening parenthesis.
    const occurrences = [...MAIN_JS.matchAll(new RegExp(`\\b${name}\\b`, 'g'))];
    const calls = occurrences.filter((m) =>
      /^\s*\(/.test(MAIN_JS.slice(m.index + name.length, m.index + name.length + 2))
    );
    expect({ name, calledTimes: calls.length }).toEqual({ name, calledTimes: 0 });
  });

  test('neither platform has a second-instance handler or argv URL parsing', () => {
    expect(MAIN_JS).not.toContain('second-instance');
    expect(MAIN_JS).not.toContain('requestSingleInstanceLock');
  });

  test('both schemes are registered, so the caveat is about delivery, not registration', () => {
    expect(WINDOWS_JS).toContain('app.setAsDefaultProtocolClient(AARTIQ_URL_SCHEME)');
    expect(LINUX_JS).toContain('app.setAsDefaultProtocolClient(AARTIQ_URL_SCHEME)');
  });

  test('both pages name the caveat in their own words', () => {
    expect(live(WINDOWS_DOCS)).toMatch(/Nothing on Windows can invoke/);
    expect(live(LINUX_DOCS)).toMatch(/discarded on Linux/);
  });
});

/* ── the IPC bridges ─────────────────────────────────────────────────────── */

describe('the IPC bridges have no missing channels', () => {
  const bridgeInvokes = (namespace) => [
    ...new Set(
      [...PRELOAD_JS.matchAll(new RegExp(`ipcRenderer\\.invoke\\('(${namespace}:[^']+)'`, 'g'))].map(
        (m) => m[1]
      )
    ),
  ];

  const moduleHandles = (source, namespace) => [
    ...new Set(
      [...source.matchAll(new RegExp(`ipcMain\\.handle\\('(${namespace}:[^']+)'`, 'g'))].map(
        (m) => m[1]
      )
    ),
  ];

  test('every Linux channel the bridge invokes has a handler', () => {
    // An earlier version of this suite asserted the opposite and reported four
    // missing channels. It was wrong: the handler search only covered the module
    // and missed main.js, which registers all eleven. Asserting the empty set is
    // how that mistake gets caught if it is ever reintroduced.
    const invoked = bridgeInvokes('linux');
    const handled = new Set([
      ...moduleHandles(MAIN_JS, 'linux'),
      ...moduleHandles(LINUX_JS, 'linux'),
    ]);
    expect({ invoked: invoked.length, unhandled: invoked.filter((c) => !handled.has(c)) }).toEqual({
      invoked: 11,
      unhandled: [],
    });
  });

  test('every Windows channel the bridge invokes has a handler', () => {
    const invoked = bridgeInvokes('windows');
    const handled = new Set(moduleHandles(WINDOWS_JS, 'windows'));
    expect({ unhandled: invoked.filter((c) => !handled.has(c)) }).toEqual({ unhandled: [] });
  });

  test('main.js registers no Windows bridge channel of its own', () => {
    // This is why Windows has no duplicate-registration problem and Linux does.
    expect(moduleHandles(MAIN_JS, 'windows')).toEqual([]);
  });

  test('the Linux page does not claim a missing channel', () => {
    for (const channel of [
      'linux:desktop:get',
      'linux:voice:get-voices',
      'linux:voice:listen',
      'linux:voice:speak',
    ]) {
      // Each is named, because the duplicate-registration discussion needs the
      // full list, but none may be presented as unhandled.
      expect(LINUX_DOCS).toContain(channel);
    }
    expectAbsent(LINUX_DOCS, 'have no handler and reject');
    expectAbsent(LINUX_DOCS, 'do not have a handler');
  });
});

/** The page's own DUPLICATE_HANDLERS array, parsed rather than merely searched for. */
const docsDuplicateList = (source) => {
  const start = source.indexOf('const DUPLICATE_HANDLERS = [');
  return [
    ...source
      .slice(start, source.indexOf('];', start))
      .matchAll(/"([^"]+)"/g),
  ].map((m) => m[1]);
};

/** The page's ORPHAN_HANDLERS array. */
const docsOrphanList = (source) => {
  const start = source.indexOf('const ORPHAN_HANDLERS = [');
  return [
    ...source
      .slice(start, source.indexOf('];', start))
      .matchAll(/"([^"]+)"/g),
  ].map((m) => m[1]);
};

describe('the Linux bridge registers each ipcMain channel exactly once', () => {
  const handledIn = (source) =>
    new Set([...source.matchAll(/ipcMain\.handle\('(linux:[^']+)'/g)].map((m) => m[1]));

  const duplicates = [...handledIn(LINUX_JS)].filter((c) => handledIn(MAIN_JS).has(c)).sort();
  const orphans = [...handledIn(LINUX_JS)].filter((c) => !handledIn(MAIN_JS).has(c)).sort();

  // The five channels the module used to register a second time. main.js's
  // copies are the ones kept, because they carry the platform guard that
  // answers { error: 'Not Linux' } on macOS and Windows, where the module's
  // setup function never runs at all.
  const FORMERLY_DUPLICATED = [
    'linux:create-launcher',
    'linux:create-shortcut',
    'linux:install-gnome-shortcut',
    'linux:notify',
    'linux:register-protocol',
  ];

  // Every test in this block previously asserted that the duplication was
  // still present, so that the docs page could report it honestly. The
  // duplication is fixed, so the block now asserts the opposite. An earlier
  // version of two of these tests kept passing after the fix because they only
  // read the *order* of the two registrations and the absence of a try/catch —
  // both still textually true, both describing a crash that no longer happens.
  // They are rewritten to assert the fixed state rather than left to go green
  // on stale reasoning.

  test('no channel is registered by both the module and main.js', () => {
    // Electron's ipcMain.handle throws on a second registration of a channel.
    // That throw was unguarded and at module top level, so on Linux the main
    // process stopped before the window was created.
    expect(duplicates).toEqual([]);
  });

  test('the module registers nothing main.js also registers', () => {
    const moduleChannels = [...handledIn(LINUX_JS)].sort();
    expect({ moduleChannels, overlapWithMain: moduleChannels.filter((c) => duplicates.includes(c)) }).toEqual({
      moduleChannels,
      overlapWithMain: [],
    });
  });

  test('main.js still owns the five channels that used to be registered twice', () => {
    // The fix removed the module's copies, not main.js's. If it had removed
    // these, every preload invoke() for them on macOS and Windows would reject
    // with "No handler registered" instead of returning { error: 'Not Linux' }.
    const main = [...handledIn(MAIN_JS)];
    for (const channel of FORMERLY_DUPLICATED) {
      expect(main).toContain(channel);
    }
  });

  test('each of those five is still guarded by a platform check', () => {
    for (const channel of FORMERLY_DUPLICATED) {
      const at = MAIN_JS.indexOf(`ipcMain.handle('${channel}'`);
      expect({ channel, registered: at > -1 }).toEqual({ channel, registered: true });
      expect(MAIN_JS.slice(at, at + 220)).toMatch(/process\.platform !== 'linux'/);
    }
  });

  test('preload can still reach every linux: channel it invokes', () => {
    const preload = new Set(
      [...PRELOAD_JS.matchAll(/ipcRenderer\.invoke\('(linux:[^']+)'/g)].map((m) => m[1])
    );
    const main = [...handledIn(MAIN_JS)];
    const unowned = [...preload].filter((c) => !main.includes(c));
    expect({ unowned }).toEqual({ unowned: [] });
  });

  test('the module still registers the five channels nothing else provides', () => {
    expect(orphans).toEqual([
      'linux:get-desktop',
      'linux:get-voices',
      'linux:shortcut-action',
      'linux:speak',
      'linux:start-voice',
    ]);
  });

  test('the Linux page reports the fix and keeps the orphan finding', () => {
    const text = live(LINUX_DOCS);
    // The crash narrative must be gone from the rendered page.
    expect(text).not.toMatch(/registers five channels a second time/);
    expect(text).not.toMatch(/Attempted to register a second handler/);
    expect(text).not.toMatch(/main\.js:781/);
    // And it must say the crash is fixed rather than merely going quiet.
    expect(text).toMatch(/fixed/i);
    // The orphan finding is unaffected by the fix and is still true.
    expect(text).toMatch(/never invoked/);
  });

  test("the page's duplicate list is empty, because nothing is duplicated", () => {
    expect({ published: docsDuplicateList(LINUX_DOCS) }).toEqual({ published: [] });
  });

  test("the page's orphan list is the derived set", () => {
    expect({ published: docsOrphanList(LINUX_DOCS).sort() }).toEqual({ published: orphans });
  });
});

/* ── claims that were removed ────────────────────────────────────────────── */

describe('the pages dropped features that do not exist', () => {
  test.each([
    ['windows-integration', WINDOWS_DOCS],
    ['linux-integration', LINUX_DOCS],
  ])('%s cites a module that exists', (_slug, source) => {
    expectAbsent(source, 'src/lib/platform/WindowsIntegration');
    expect({
      namesRealModule: /src\/lib\/(windows|linux)-integration\.js/.test(source),
    }).toEqual({ namesRealModule: true });
  });

  test('the wrong path is listed as removed rather than silently dropped', () => {
    expect(removedList(WINDOWS_DOCS).some((l) => l.includes('src/lib/platform'))).toBe(true);
  });

  test('the Windows page no longer documents a port-3000 API or Power Automate', () => {
    expectAbsent(WINDOWS_DOCS, 'localhost:3000');
    expectAbsent(WINDOWS_DOCS, 'Power Automate');
    expect(removedList(WINDOWS_DOCS).some((l) => l.includes('Power Automate'))).toBe(true);
  });

  test('the Windows page no longer claims a wake word or unregistered shortcuts', () => {
    for (const claim of [
      'Hey Aartiq',
      'Copilot:(explain|refactor|tests|doc)',
      'dual-chat|aartiq://compare',
      'Install-Module SpeechRecognition',
    ]) {
      expectAbsentOrNegated(WINDOWS_DOCS, claim);
    }
    // The retraction must be explicit rather than a silent deletion.
    expect(removedList(WINDOWS_DOCS).some((l) => l.includes('Hey Aartiq'))).toBe(true);
  });

  test('the Windows page does not list accelerators the app never registers', () => {
    // Every accelerator the page mentions must appear in constants.ts.
    const constants = read('src/lib/constants.ts');
    const mentioned = [
      ...new Set([...WINDOWS_DOCS.matchAll(/Ctrl (?:Shift )?\+ [A-Z]/g)].map((m) => m[0])),
    ];
    // The page lists them only inside the removed-claims correction.
    expect({ mentioned }).toEqual({ mentioned: [] });
    expect(constants).toBeTruthy();
  });

  test('the Windows registry snippet is not double-escaped', () => {
    // The raw file contains \\ because the snippet is a JS template literal.
    // Decode the literal before judging it, or the check is meaningless: a
    // .reg file needs single backslashes, and that is what the rendered value
    // has.
    const block = WINDOWS_DOCS.slice(WINDOWS_DOCS.indexOf('const REGISTRY = `'));
    const raw = block.slice(block.indexOf('`') + 1, block.indexOf('`;'));
    const rendered = raw.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
    const keyLines = rendered.split('\n').filter((l) => l.startsWith('[HKEY'));
    expect({ keyLines: keyLines.length }).toEqual({ keyLines: expect.any(Number) });
    expect(keyLines.length).toBeGreaterThan(0);
    for (const line of keyLines) {
      expect({ line, doubled: /\\\\/.test(line) }).toEqual({ line, doubled: false });
    }
    // And the raw source must carry the escapes that produce that.
    expect(/\\\\aartiq/.test(raw)).toBe(true);
  });

  test('the Linux page no longer documents tray, KRunner, scrot or pocketsphinx', () => {
    for (const claim of ['System Tray', 'KRunner', 'scrot', 'pocketsphinx', '80\\+ eSpeak']) {
      expectAbsentOrNegated(LINUX_DOCS, claim);
    }
    // The scrot mention survives in the screenshot row as a correction; require
    // that row to actually exist, so the negation cannot be a stray aside.
    expect(live(LINUX_DOCS)).toMatch(/invokes no screenshot program/);
  });

  test('the Linux page no longer claims dictation works', () => {
    const start = LINUX_JS.slice(LINUX_JS.indexOf('async function startVoiceRecognition'));
    expect(start.slice(0, 900)).toMatch(/success: false/);
    expectAbsent(LINUX_DOCS, '[Dd]ictate messages to AI');
    // Synthesis is real and may be claimed.
    expect(live(LINUX_DOCS)).toMatch(/espeak/);
  });

  test('the Linux page includes the screenshot action the old table omitted', () => {
    expect(LINUX_DOCS).toMatch(/action: "screenshot"/);
    expect(linux.has('screenshot')).toBe(true);
  });

  test.each([
    ['windows', WINDOWS_DOCS],
    ['linux', LINUX_DOCS],
  ])('the %s page names no project-origin domain', (_slug, source) => {
    expectAbsent(source, 'ponsri');
  });
});

/* ── the Windows shortcut id mismatch ────────────────────────────────────── */

describe('the Windows shortcut id mismatch is real and documented', () => {
  test('the ids the module advertises but cannot execute are exactly three', () => {
    const listed = [...WINDOWS_JS.matchAll(/\{ id: '([\w-]+)', name:/g)].map((m) => m[1]);
    expect(listed.length).toBe(12);
    expect(listed.filter((id) => !windows.has(id)).sort()).toEqual([
      'ask-and-speak',
      'set-volume',
      'voice-chat',
    ]);
  });

  test('the page names all three, and what the real key is', () => {
    for (const id of ['voice-chat', 'ask-and-speak', 'set-volume']) {
      expect(WINDOWS_DOCS).toContain(id);
    }
    expect(live(WINDOWS_DOCS)).toMatch(/Unknown action/);
  });
});