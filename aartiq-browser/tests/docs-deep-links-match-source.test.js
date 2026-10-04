/**
 * docs-deep-links-match-source.test.js
 *
 * The deep-links docs page previously described a routing system that does not
 * exist. It is now a transcription of the open-url handler in main.js, kept in
 * a separate repository.
 *
 * Two things can go wrong with a transcription like this, and they are very
 * different failures:
 *
 *   1. The source changes and the page does not. Caught by comparing the two
 *      command lists, and by re-deriving the mechanical facts below.
 *
 *   2. The page classifies a command wrongly — calling a command "works" when
 *      it only types text into a chat composer. This is the failure that
 *      actually matters, because it is the one a reader cannot detect, and it
 *      is the reason the old page was wrong.
 *
 * So the mechanical facts are derived from source: which commands the handler
 * recognises, which reach the action runner, which have a branch, and exactly
 * what each branch sends or executes. The status is a judgement on top of
 * those facts and cannot be read off them, because `chat` and `create-pdf`
 * have structurally identical branches — both open the chat and inject text —
 * and only one of them does what its name promises. Guessing that with a regex
 * would be the same error as guessing with prose.
 *
 * So the judgement is declared once, here, as CONTRACT, and every mechanical
 * precondition of each declared status is asserted against the source. If
 * somebody later makes the create-pdf branch actually build a PDF, the branch
 * starts executing something, the assertion below fails, and the contract has
 * to be revisited deliberately rather than left quietly wrong.
 *
 * No module under test is mocked. Every file is read from disk.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');

const MAIN_JS = read('main.js');
const SHORTCUTS_JS = read('src/lib/SiriShortcutsIntegration.js');
const PRELOAD_JS = read('preload.js');
const DOCS_SOURCE = fs.readFileSync(
  path.join(
    REPO,
    '..',
    '..',
    'Aartiq-Landing-Page',
    'src/app/docs/deep-links/page.tsx'
  ),
  'utf8'
);

/* ── facts derived from source ───────────────────────────────────────────── */

/** Every `.on(` / `.once(` subscription in preload.js, as a Set of channels. */
const preloadSubscribedChannels = new Set(
  [...PRELOAD_JS.matchAll(/ipcRenderer\.(?:on|once)\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
);

/**
 * Renderer subscriptions that do not go through preload, searched across the
 * renderer sources. Main-process registrations are excluded because a
 * webContents.send does not reach them.
 */
const rendererSubscribedChannels = (() => {
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
  }
  for (const dir of ['src/app', 'src/components', 'src/hooks']) {
    if (fs.existsSync(path.join(REPO, dir))) walk(dir);
  }
  return found;
})();

const channelIsListened = (channel) =>
  preloadSubscribedChannels.has(channel) || rendererSubscribedChannels.has(channel);

/** command -> IPC channel, transcribed from the handler. */
const commandMap = (() => {
  const start = MAIN_JS.indexOf('const commandMap = {');
  expect(start).toBeGreaterThan(-1);
  const open = MAIN_JS.indexOf('{', start);
  const close = MAIN_JS.indexOf('};', open);
  const map = new Map();
  for (const m of MAIN_JS.slice(open + 1, close).matchAll(/'([\w:-]+)'\s*:\s*'([\w:-]+)'/g)) {
    map.set(m[1], m[2]);
  }
  return map;
})();

/** The subset of commands additionally routed to executeShortcutAction. */
const siriActions = new Set(
  (() => {
    const start = MAIN_JS.indexOf('const siriActions = [');
    const end = MAIN_JS.indexOf('];', start);
    return [...MAIN_JS.slice(start, end).matchAll(/'([\w:-]+)'/g)].map((m) => m[1]);
  })()
);

/**
 * Every action branch, with what it sends and whether it executes anything.
 *
 * A guard may name several actions in one condition —
 *   if (normalizedAction === 'chat' || normalizedAction === 'ask-ai') {
 * — so the condition is captured whole and every name in it maps to the same
 * body. Matching only the first name would make `ask-ai` look branchless and
 * the page would call a working command dead.
 */
const actionBranches = (() => {
  const start = SHORTCUTS_JS.indexOf('async function executeShortcutAction');
  expect(start).toBeGreaterThan(-1);
  const end = SHORTCUTS_JS.indexOf('\nasync function speakWithSiri', start);
  const body = SHORTCUTS_JS.slice(start, end);

  const guards = [...body.matchAll(/if \((normalizedAction.*?)\) \{/gs)];
  const branches = new Map();
  for (let i = 0; i < guards.length; i++) {
    const names = [...guards[i][1].matchAll(/'([\w:-]+)'/g)].map((m) => m[1]);
    const from = guards[i].index + guards[i][0].length;
    const to = i + 1 < guards.length ? guards[i + 1].index : body.length;
    const text = body.slice(from, to);
    for (const name of names) {
      branches.set(name, {
        sends: [...new Set([...text.matchAll(/send\('([\w:-]+)'/g)].map((m) => m[1]))],
        executes: /execPromise\(/.test(text),
      });
    }
  }
  return branches;
})();

/** Parameter names actually read, covering both access and destructuring. */
const sourceParams = new Set([
  ...[...SHORTCUTS_JS.matchAll(/params\.([A-Za-z]+)/g)].map((m) => m[1]),
  ...[...MAIN_JS.matchAll(/params\.([A-Za-z]+)/g)].map((m) => m[1]),
  // `const { appName } = params;` never spells `params.appName`.
  ...[...SHORTCUTS_JS.matchAll(/const\s*\{([^}]+)\}\s*=\s*params/g)].flatMap((m) =>
    m[1].split(',').map((s) => s.trim())
  ),
]);

/* ── what the page publishes ─────────────────────────────────────────────── */

/** The docs command table: command -> published status. */
const docsCommands = (() => {
  const rows = [
    ...DOCS_SOURCE.matchAll(
      /\{\s*\n\s*command:\s*"([\w:-]+)",[\s\S]*?status:\s*"(works|prepares|dead)",/g
    ),
  ];
  return new Map(rows.map((m) => [m[1], m[2]]));
})();

/**
 * The docs' claimed parameters. Only the first column of each tuple names a
 * parameter; the second says which commands read it, and reading that column
 * as parameters would make every command name look invented.
 */
const docsParams = (() => {
  const start = DOCS_SOURCE.indexOf('const PARAMS_READ = [');
  const rows = [
    ...DOCS_SOURCE.slice(start, DOCS_SOURCE.indexOf('];', start)).matchAll(
      /\[\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\]/g
    ),
  ];
  return new Set(
    rows.flatMap((m) => m[1].split(/\s*[/,]\s*/)).map((s) => s.trim()).filter(Boolean)
  );
})();

/** The page's own list of claims it removed, which is where a correction lives. */
const REMOVED_LIST = (() => {
  const start = DOCS_SOURCE.indexOf('const REMOVED = [');
  return [
    ...DOCS_SOURCE.slice(start, DOCS_SOURCE.indexOf('];', start)).matchAll(
      /^\s*"((?:[^"\\]|\\.)*)"/gm
    ),
  ].map((m) => m[1].replace(/\\"/g, '"'));
})();

/**
 * The page with its explanatory comments and its removed-claims array taken out.
 * A phrase may appear in either and still be a correction; it may not appear
 * anywhere else while still being presented as support.
 */
const liveSource = (() => {
  const withoutComments = DOCS_SOURCE.split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  const start = withoutComments.indexOf('const REMOVED = [');
  return (
    withoutComments.slice(0, start) + withoutComments.slice(withoutComments.indexOf('];', start))
  );
})();

/* ── the judgement, declared once ────────────────────────────────────────── */

/**
 * Why each command is classified the way it is. Every mechanical precondition
 * below is asserted against the source, so a branch that starts really doing
 * the thing fails the suite instead of quietly leaving the page wrong.
 */
const CONTRACT = {
  // Delivers what the name promises: the prompt reaches the composer.
  chat: { status: 'works', because: 'the point of the command is to put the text in the chat' },
  'ask-ai': { status: 'works', because: 'shares the chat branch' },
  'voice-chat': { status: 'works', because: 'opens the sidebar and does nothing else, which is the name' },
  navigate: { status: 'works', because: 'reaches navigate-to-url, which a renderer listens for' },
  search: { status: 'works', because: 'reaches add-new-tab' },
  volume: { status: 'works', because: 'executes a command, but only osascript, so it is macOS-only' },
  'open-app': { status: 'works', because: 'executes open -a, but only on macOS' },

  // Opens the chat and types a sentence. Does not do the thing it names.
  'create-pdf': { status: 'prepares', because: 'types a request; no document is produced' },
  'run-command': { status: 'prepares', because: 'types a request; no process is started' },
  schedule: { status: 'prepares', because: 'types a request; no automation is created' },

  // Never routed to the action runner at all.
  browse: { status: 'dead', because: 'absent from siriActions' },
  ocr: { status: 'dead', because: 'absent from siriActions' },
  pdf: { status: 'dead', because: 'absent from siriActions' },
  automation: { status: 'dead', because: 'absent from siriActions' },
  settings: { status: 'dead', because: 'absent from siriActions' },
  index: { status: 'dead', because: 'absent from siriActions, and the fallback for anything unknown' },

  // Routed, but the runner has no branch, so it answers "unsupported action".
  screenshot: { status: 'dead', because: 'routed but branchless' },
  'set-model': { status: 'dead', because: 'routed but branchless' },
  // Pointed at the create-pdf channel but branchless in its own right.
  'create-doc': { status: 'dead', because: 'the string does not appear in the action runner' },
};

describe('the published deep-link reference matches the handler', () => {
  test('the handler still has the structures this suite compares against', () => {
    expect(commandMap.size).toBe(19);
    expect(siriActions.size).toBe(13);
    expect(actionBranches.size).toBeGreaterThan(0);
  });

  test('the docs publish exactly the commands the handler recognises', () => {
    expect([...docsCommands.keys()].sort()).toEqual([...commandMap.keys()].sort());
  });

  test('the contract covers every command the handler recognises', () => {
    expect(Object.keys(CONTRACT).sort()).toEqual([...commandMap.keys()].sort());
  });

  test('every published status matches the declared contract', () => {
    const wrong = [...docsCommands]
      .map(([command, published]) => ({
        command,
        published,
        contract: CONTRACT[command].status,
      }))
      .filter((r) => r.published !== r.contract);
    expect(wrong).toEqual([]);
  });

  test('a dead command is genuinely unreachable in the source', () => {
    const notActuallyDead = Object.entries(CONTRACT)
      .filter(([, c]) => c.status === 'dead')
      .filter(([command]) => {
        const branch = actionBranches.get(command);
        return siriActions.has(command) && branch;
      })
      .map(([command]) => command);
    expect(notActuallyDead).toEqual([]);
  });

  test('a dead command is also sent on a channel nobody listens for', () => {
    // Otherwise it is merely misrouted, and calling it dead would be wrong.
    const listened = Object.entries(CONTRACT)
      .filter(([, c]) => c.status === 'dead')
      .filter(([command]) => channelIsListened(commandMap.get(command)))
      .map(([command]) => command);
    expect(listened).toEqual([]);
  });

  test('a prepares command does nothing but open the chat and type into it', () => {
    // The precondition that makes the declared judgement true. If this stops
    // holding, the command has started doing its own work and the page is wrong.
    const violating = Object.entries(CONTRACT)
      .filter(([, c]) => c.status === 'prepares')
      .map(([command, c]) => {
        const branch = actionBranches.get(command);
        return {
          command,
          status: c.status,
          branch: branch || null,
          sendsOnlyChat: branch
            ? branch.sends.every((ch) => ch === 'execute-shortcut' || ch === 'ai-chat-input-text')
            : null,
          injectsText: branch ? branch.sends.includes('ai-chat-input-text') : null,
          executes: branch ? branch.executes : null,
        };
      })
      .filter((r) => !(r.sendsOnlyChat && r.injectsText && !r.executes));
    expect(violating).toEqual([]);
  });

  test('a works command either reaches something other than chat text, or executes', () => {
    const violating = Object.entries(CONTRACT)
      .filter(([, c]) => c.status === 'works')
      .map(([command]) => {
        const branch = actionBranches.get(command);
        return {
          command,
          branch: branch || null,
          reachesNonText:
            branch ? branch.sends.some((ch) => ch !== 'ai-chat-input-text') : null,
        };
      })
      .filter((r) => !(r.reachesNonText || (r.branch && r.branch.executes)));
    expect(violating).toEqual([]);
  });

  test('the two commands that shell out are the two the page calls macOS-only', () => {
    const shelling = [...actionBranches.entries()]
      .filter(([, b]) => b.executes)
      .map(([name]) => name)
      .sort();
    expect(shelling).toEqual(['open-app', 'volume']);
  });

  test('the page does not claim more working commands than the contract allows', () => {
    const contractWorks = Object.entries(CONTRACT)
      .filter(([, c]) => c.status === 'works')
      .map(([command]) => command)
      .sort();
    const publishedWorks = [...docsCommands]
      .filter(([, status]) => status === 'works')
      .map(([command]) => command)
      .sort();
    expect(publishedWorks).toEqual(contractWorks);
  });

  test('navigate-to-url is one of the few channels that is listened for', () => {
    expect(channelIsListened('navigate-to-url')).toBe(true);
  });

  test('the page states that most commandMap channels have no listener', () => {
    const dead = [...commandMap.entries()].filter(([, ch]) => !channelIsListened(ch));
    // Recorded as an observation about the source. If this flips, the page's
    // "nothing happens" framing needs revisiting.
    expect(dead.length).toBeGreaterThan(10);
    expect(DOCS_SOURCE).toMatch(/channel with no listener/);
  });
});

describe('the deep-links page does not repeat claims with no code behind them', () => {
  const prose = DOCS_SOURCE.split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join(' ')
    .replace(/\s+/g, ' ');

  test('the documented parameters are the parameters the source reads', () => {
    expect([...docsParams].filter((p) => !sourceParams.has(p))).toEqual([]);
  });

  test('the page states macOS-only delivery, which the handler supports', () => {
    // open-url is the only delivery path. Windows and Linux activation would
    // need argv parsing or a second-instance handler, and neither exists.
    expect(MAIN_JS).toContain("app.on('open-url'");
    expect(MAIN_JS).not.toContain('second-instance');
    expect(MAIN_JS).not.toContain('requestSingleInstanceLock');

    // Anchored on the caveat itself rather than on the bare phrase "macOS only",
    // which recurs in this page for the osascript commands. An earlier version
    // of this assertion matched the bare phrase and therefore kept passing after
    // the entire delivery caveat had been deleted from the page — which is how
    // this mutation survived the first run.
    expect(prose).toMatch(/Delivery is macOS only/);
    expect(prose).toMatch(/requestSingleInstanceLock/);
    expect(prose).toMatch(/is discarded/);
  });

  test('the page no longer advertises the invented route table', () => {
    // /chat, /automation, /settings and the rest were presented as in-app
    // routes. None is a routing target; the handler matches command names.
    for (const route of ['/pdf-viewer?file=', '/docs/ai-commands', '/desktop-control']) {
      expect(prose).not.toContain(route);
    }
  });

  test('the page does not cite the retired or absent link mechanisms', () => {
    for (const claim of [
      'Firebase Dynamic Links',
      'apple-app-site-association',
      'assetlinks.json',
      'Jump List',
    ]) {
      // Allowed only inside the "claims removed" list, which reads as a
      // correction. Appearing anywhere else would be a surviving claim.
      const escaped = claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect({
        claim,
        stillPresented: new RegExp(escaped).test(liveSource),
        listedAsRemoved: REMOVED_LIST.some((line) => line.includes(claim)),
      }).toEqual({ claim, stillPresented: false, listedAsRemoved: true });
    }
  });

  test('the removed-claims list is present and explicit', () => {
    expect(REMOVED_LIST.length).toBeGreaterThan(5);
    expect(prose).toMatch(/Claims removed from this page/);
  });

  test('?speak=true is described as having no listener, which is the truth', () => {
    expect(channelIsListened('ai:request-speak-response')).toBe(false);
    expect(prose).toMatch(/speak=true does nothing/);
  });

  test('the page contains no real brand domain or project-origin string', () => {
    expect(prose).not.toMatch(/ponsri/i);
  });
});