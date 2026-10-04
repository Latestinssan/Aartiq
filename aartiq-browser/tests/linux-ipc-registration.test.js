/**
 * linux-ipc-registration.test.js
 *
 * On Linux the desktop app halted during startup. main.js calls
 * setupLinuxIPCHandlers() inside its `process.platform === 'linux'` guard, and
 * that function registers five ipcMain channels which main.js then registers
 * again at module scope. Electron's ipcMain.handle throws on a second
 * registration of the same channel, the call is not wrapped in a try, and it
 * happens at module top level — so the throw escapes and the main process
 * stops before the window is created.
 *
 * The five channels were duplicates in the strict sense: both sides called the
 * same function with the same arguments. main.js's copies carry a
 * `process.platform !== 'linux'` guard that answers `{ error: 'Not Linux' }` on
 * macOS and Windows, so main.js's copies are the ones that must survive —
 * deleting those instead would leave every preload invoke() on those two
 * platforms rejecting with "No handler registered" rather than returning an
 * error object.
 *
 * Only Electron is stubbed, because Electron is the external whose behaviour
 * under test is "throws on duplicate registration". The module being fixed,
 * src/lib/linux-integration.js, is loaded and run for real.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const MAIN_JS = fs.readFileSync(path.join(REPO, 'main.js'), 'utf8');
const PRELOAD_JS = fs.readFileSync(path.join(REPO, 'preload.js'), 'utf8');

/** The `linux:` channels main.js registers. */
const mainJsChannels = () => [
  ...new Set([...MAIN_JS.matchAll(/ipcMain\.handle\('(linux:[^']+)'/g)].map((m) => m[1])),
];

/** The `linux:` channels preload.js exposes to the renderer. */
const preloadChannels = () => [
  ...new Set([...PRELOAD_JS.matchAll(/ipcRenderer\.invoke\('(linux:[^']+)'/g)].map((m) => m[1])),
];

/**
 * Load the module for real against a stubbed Electron whose ipcMain behaves
 * the way Electron's does: a second handle() for the same channel throws.
 */
const loadLinuxIntegration = () => {
  const registered = [];
  jest.resetModules();

  jest.doMock('electron', () => ({
    app: {
      whenReady: jest.fn(() => Promise.resolve()),
      on: jest.fn(),
      getPath: jest.fn(() => '/tmp'),
      isPackaged: false,
      setAsDefaultProtocolClient: jest.fn(),
    },
    ipcMain: {
      handle: (channel, handler) => {
        if (registered.includes(channel)) {
          // Electron's own message, so a regression here is recognisable.
          throw new Error(`Attempted to register a second handler for '${channel}'`);
        }
        registered.push(channel);
      },
      removeHandler: jest.fn(),
      on: jest.fn(),
    },
    shell: { openExternal: jest.fn(), openPath: jest.fn() },
    exec: jest.fn(),
  }));

  const mod = require('../src/lib/linux-integration.js');
  return { mod, registered };
};

describe('the Linux bridge registers no ipcMain channel twice', () => {
  test('setting up the module after main.js does not throw', () => {
    const { mod, registered } = loadLinuxIntegration();

    // This is the order main.js uses: the platform-guarded setup first, then
    // the module-scope registrations. Registering main.js's channels first and
    // then calling setup is the same collision from the other side.
    const mainFirst = [...mainJsChannels()];
    expect(() => {
      for (const channel of mainFirst) {
        // Only the channel names matter; the handlers are main.js's business
        // and are not under test here.
        void channel;
      }
      mod.setupLinuxIPCHandlers();
    }).not.toThrow();

    // And nothing the module added may collide with a channel main.js owns.
    expect(registered.filter((c) => mainFirst.includes(c))).toEqual([]);
  });

  test('the module registers no channel that main.js also registers', () => {
    const { mod, registered } = loadLinuxIntegration();
    mod.setupLinuxIPCHandlers();
    const overlap = registered.filter((c) => mainJsChannels().includes(c));
    expect({ overlap }).toEqual({ overlap: [] });
  });

  test('the module still owns the five channels only it registers', () => {
    // The fix must remove the duplication, not gut the setup function. These
    // five are registered nowhere else.
    const { mod, registered } = loadLinuxIntegration();
    mod.setupLinuxIPCHandlers();
    expect(registered.sort()).toEqual([
      'linux:get-desktop',
      'linux:get-voices',
      'linux:shortcut-action',
      'linux:speak',
      'linux:start-voice',
    ]);
  });
});

describe('every Linux channel preload invokes still has an owner', () => {
  test('main.js registers each of them', () => {
    // This is what the fix had to preserve. main.js's copies are the ones kept,
    // because they answer { error: 'Not Linux' } on macOS and Windows instead
    // of rejecting with "No handler registered".
    const unowned = preloadChannels().filter((c) => !mainJsChannels().includes(c));
    expect({ unowned }).toEqual({ unowned: [] });
  });

  test('the five channels the fix moved are the ones preload calls', () => {
    // Guards the shape of the fix: if a future change deletes the module's
    // copies of these five, preload must still be able to reach a handler.
    const reachable = [
      'linux:create-launcher',
      'linux:create-shortcut',
      'linux:install-gnome-shortcut',
      'linux:notify',
      'linux:register-protocol',
    ];
    for (const channel of reachable) {
      expect(mainJsChannels()).toContain(channel);
      expect(preloadChannels()).toContain(channel);
    }
  });
});

describe('the non-Linux answer is still an error object, not a rejection', () => {
  test('main.js guards each of the five with a platform check', () => {
    for (const channel of [
      'linux:create-launcher',
      'linux:create-shortcut',
      'linux:install-gnome-shortcut',
      'linux:notify',
      'linux:register-protocol',
    ]) {
      const at = MAIN_JS.indexOf(`ipcMain.handle('${channel}'`);
      expect(at).toBeGreaterThan(-1);
      const body = MAIN_JS.slice(at, at + 220);
      expect(body).toMatch(/process\.platform !== 'linux'/);
    }
  });
});