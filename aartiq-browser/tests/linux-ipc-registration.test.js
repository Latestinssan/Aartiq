/**
 * linux-ipc-registration.test.js
 *
 * The Linux startup crash, reproduced rather than read. On Linux,
 * setupLinuxIPCHandlers() runs from inside main.js's platform guard and used
 * to register five channels that main.js then registered again at module
 * scope. Electron's ipcMain.handle throws on a second registration for the
 * same channel, the call was not wrapped, and it ran before the window was
 * created — so the main process died at boot on Linux and nowhere else.
 *
 * The mocked ipcMain below throws the same error Electron throws, and the
 * module is required for real (only `electron` is replaced). The boot
 * sequence mirrors source order: the module's setup call first, then main.js's
 * module-scope registrations, extracted from main.js itself. Re-introducing
 * any shared name fails here the way it fails in production.
 *
 * See also tests/docs-platform-integration-match-source.test.js, which gates
 * the docs page's account of the same fact.
 */

const fs = require('fs');
const path = require('path');

jest.mock('electron', () => {
  // Electron's contract: one handler per channel, and the second registration
  // for the same channel throws instead of replacing the first.
  const handlers = new Map();
  return {
    __handlers: handlers,
    app: { getPath: () => '/tmp' },
    shell: {},
    exec: () => {},
    ipcMain: {
      handle: (channel, listener) => {
        if (handlers.has(channel)) {
          throw new Error(`Attempted to register a second handler for '${channel}'`);
        }
        handlers.set(channel, listener);
      },
      removeHandler: (channel) => handlers.delete(channel),
    },
  };
});

const electron = require('electron');
const MAIN_JS = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const PRELOAD_JS = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

const { setupLinuxIPCHandlers } = require('../src/lib/linux-integration');

/** Channels main.js registers at module scope, in source order. */
const MAIN_CHANNELS = [...MAIN_JS.matchAll(/ipcMain\.handle\('(linux:[^']+)'/g)].map((m) => m[1]);

/** Unique channels the preload bridge invokes over ipcRenderer. */
const BRIDGE_CHANNELS = [
  ...new Set([...PRELOAD_JS.matchAll(/ipcRenderer\.invoke\('(linux:[^']+)'/g)].map((m) => m[1])),
];

/** The five names the module registers on its own — none of them main.js's. */
const MODULE_CHANNELS = [
  'linux:get-desktop',
  'linux:get-voices',
  'linux:shortcut-action',
  'linux:speak',
  'linux:start-voice',
];

/** The exact order of a Linux boot: guarded setup call, then main.js's scope. */
const boot = () => {
  setupLinuxIPCHandlers();
  for (const channel of MAIN_CHANNELS) {
    electron.ipcMain.handle(channel, async () => {});
  }
};

describe('the Linux IPC registrations do not collide', () => {
  beforeEach(() => {
    electron.__handlers.clear();
  });

  test('requiring the module registers nothing on its own', () => {
    expect([...electron.__handlers.keys()]).toEqual([]);
  });

  test('the boot sequence registers every channel exactly once, without throwing', () => {
    expect(MAIN_CHANNELS.length).toBe(11);
    expect(() => boot()).not.toThrow();
    expect([...electron.__handlers.keys()].sort()).toEqual(
      [...new Set([...MAIN_CHANNELS, ...MODULE_CHANNELS])].sort()
    );
  });

  test('the setup call registers exactly the five module-only names', () => {
    setupLinuxIPCHandlers();
    expect([...electron.__handlers.keys()].sort()).toEqual([...MODULE_CHANNELS].sort());
  });

  test('every channel the preload bridge invokes is registered by boot', () => {
    boot();
    const missing = BRIDGE_CHANNELS.filter((channel) => !electron.__handlers.has(channel));
    expect({ invoked: BRIDGE_CHANNELS.length, missing }).toEqual({ invoked: 11, missing: [] });
  });
});
