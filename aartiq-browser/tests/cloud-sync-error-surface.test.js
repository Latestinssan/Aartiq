/**
 * cloud-sync-error-surface.test.js
 *
 * Deferred audit finding: "silent Firebase update failure".
 *
 * CloudSyncService dropped Firebase write promises on the floor —
 * `update(promptsRef, { status: 'processed' })` in the prompt listener,
 * `set(responseRef, …)` in sendAIResponse and
 * `onDisconnect(deviceRef).update(…)` in _registerDevice had no handler, so a
 * rejected write produced no log, no event and no way to tell why a prompt
 * stayed `pending`. Every write failure now goes through `_reportSyncError`,
 * which logs and emits `cloud-sync-error`; sync-handlers forwards the event to
 * the renderer, where Settings → Sync shows it in the status line.
 *
 * The service is loaded down BOTH paths, because they are different files:
 *   - main.js requires the compiled `src/lib/CloudSyncService.js` explicitly;
 *   - jest resolves `src/lib/CloudSyncService` to the `.ts` first
 *     (moduleFileExtensions puts ts before js).
 * A twin that loses the handling fails here — rebuild with `npm run predev`.
 */

jest.mock('electron', () => ({ ipcMain: { handle: jest.fn(), on: jest.fn() } }));
jest.mock('firebase/database', () => ({
  ref: jest.fn(() => 'ref'),
  set: jest.fn(() => Promise.resolve()),
  update: jest.fn(() => Promise.resolve()),
  onValue: jest.fn(() => () => {}),
  get: jest.fn(() => Promise.resolve({ val: () => null })),
  push: jest.fn(() => ({ key: 'push-key' })),
  remove: jest.fn(() => Promise.resolve()),
  onDisconnect: jest.fn(() => ({ update: jest.fn(() => Promise.resolve()) })),
  getDatabase: jest.fn(),
  runTransaction: jest.fn(() => Promise.resolve()),
}));
jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  onAuthStateChanged: jest.fn(),
  getAuth: jest.fn(),
}));
jest.mock('firebase/storage', () => ({
  getStorage: jest.fn(),
  ref: jest.fn(() => 'storage-ref'),
  deleteObject: jest.fn(() => Promise.resolve()),
}));
jest.mock('../src/lib/FirebaseService', () => ({
  __esModule: true,
  default: { app: null, auth: null },
}));
jest.mock('../src/lib/Security', () => ({
  Security: {
    encrypt: jest.fn(async (data) => `enc(${data})`),
    decrypt: jest.fn(async (data) => data),
  },
}));
jest.mock('../src/lib/SyncMethodManager', () => ({ CloudConfig: {} }));

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const TS_SPECIFIER = '../src/lib/CloudSyncService';
const JS_SPECIFIER = '../src/lib/CloudSyncService.js';

let db; // the current firebase/database mock (re-created on every resetModules)

/** Load a fresh singleton of one twin, with its Firebase fields wired. */
function freshService(specifier) {
  jest.resetModules();
  db = require('firebase/database');
  const svc = require(specifier).cloudSyncService;
  svc.db = {}; // Database — any truthy stand-in; every call goes to the mock
  svc.userId = 'user-1';
  svc.deviceId = 'device-1';
  svc.syncPassphrase = 'passphrase';
  svc.deviceName = 'Test Device';
  return svc;
}

function collectErrors(svc) {
  const events = [];
  svc.on('cloud-sync-error', (details) => events.push(details));
  return events;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const promptSnapshot = () => ({
  val: () => ({ prompt: 'say hi', promptId: 'p-1', status: 'pending' }),
});

describe.each([
  ['TypeScript source (.ts)', TS_SPECIFIER],
  ['compiled runtime (.js)', JS_SPECIFIER],
])('cloud write failures via %s', (_label, specifier) => {
  let consoleError;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a rejected prompt-status update is logged and emitted, not swallowed', async () => {
    const svc = freshService(specifier);
    const events = collectErrors(svc);
    db.update.mockImplementation(() => Promise.reject(new Error('PERMISSION_DENIED')));

    let onSnapshot;
    db.onValue.mockImplementation((_ref, callback) => {
      onSnapshot = callback;
      return () => {};
    });
    svc._startPromptListener();
    onSnapshot(promptSnapshot());
    await flush();

    expect(db.update).toHaveBeenCalledWith('ref', { status: 'processed' });
    expect(events).toEqual([
      expect.objectContaining({
        operation: 'mark-prompt-processed',
        error: expect.stringContaining('PERMISSION_DENIED'),
        at: expect.any(Number),
      }),
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      '[CloudSync] mark-prompt-processed failed:',
      expect.stringContaining('PERMISSION_DENIED'),
    );
  });

  test('a rejected AI-response write is logged and emitted', async () => {
    const svc = freshService(specifier);
    const events = collectErrors(svc);
    db.set.mockImplementation(() => Promise.reject(new Error('network')));

    svc.sendAIResponse('device-2', 'p-2', 'the answer', false);
    await flush();

    expect(events).toEqual([
      expect.objectContaining({ operation: 'send-ai-response', error: 'network' }),
    ]);
    expect(consoleError).toHaveBeenCalledWith('[CloudSync] send-ai-response failed:', 'network');
  });

  test('a rejected on-disconnect registration is logged and emitted', async () => {
    const svc = freshService(specifier);
    const events = collectErrors(svc);
    db.onDisconnect.mockReturnValue({ update: jest.fn(() => Promise.reject(new Error('timeout'))) });

    await svc._registerDevice();
    await flush();

    expect(events).toEqual([
      expect.objectContaining({ operation: 'device-on-disconnect-registration', error: 'timeout' }),
    ]);
    expect(consoleError).toHaveBeenCalledWith('[CloudSync] device-on-disconnect-registration failed:', 'timeout');
  });

  test('the already-caught clipboard failure now also reaches the event channel', async () => {
    const svc = freshService(specifier);
    const events = collectErrors(svc);
    db.set.mockImplementation(() => Promise.reject(new Error('offline')));

    await svc.syncClipboard('copied text');
    await flush();

    expect(events).toEqual([
      expect.objectContaining({ operation: 'clipboard-sync', error: 'offline' }),
    ]);
    expect(consoleError).toHaveBeenCalledWith('[CloudSync] clipboard-sync failed:', 'offline');
  });

  test('a successful write emits nothing — the channel carries failures only', async () => {
    const svc = freshService(specifier);
    const events = collectErrors(svc);

    let onSnapshot;
    db.onValue.mockImplementation((_ref, callback) => {
      onSnapshot = callback;
      return () => {};
    });
    svc._startPromptListener();
    onSnapshot(promptSnapshot());
    await flush();

    expect(db.update).toHaveBeenCalledWith('ref', { status: 'processed' });
    expect(events).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('the compiled twin', () => {
  test('the .js main.js requires carries the same handling as the .ts', () => {
    // The runtime file is checked in, not built in CI: editing only the .ts
    // would ship a stale .js whose writes fail silently again.
    const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const ts = read('src/lib/CloudSyncService.ts');
    const js = read('src/lib/CloudSyncService.js');
    for (const marker of [
      '_reportSyncError',
      "'mark-prompt-processed'",
      "'send-ai-response'",
      "'device-on-disconnect-registration'",
      "'cloud-sync-error'",
    ]) {
      expect({ marker, inTs: ts.includes(marker), inJs: js.includes(marker) }).toEqual({
        marker,
        inTs: true,
        inJs: true,
      });
    }
    // Both must drop the old silent call, so a revert in either fails here.
    expect(ts).not.toMatch(/update\(promptsRef, \{ status: 'processed' \}\);/);
    expect(js).not.toMatch(/update\)\(promptsRef, \{ status: 'processed' \}\);/);
  });
});

describe('the failure reaches the renderer', () => {
  test('sync-handlers forwards cloud-sync-error to a live window', () => {
    const registerSyncHandlers = require('../src/main/handlers/sync-handlers');
    const win = { isDestroyed: () => false, webContents: { send: jest.fn() } };
    const cloudSyncService = new EventEmitter();
    const wifiSyncService = new EventEmitter();
    wifiSyncService.sendToMobile = jest.fn();
    const handlers = {
      store: { get: jest.fn(), set: jest.fn() },
      wifiSyncService,
      cloudSyncService,
      p2pSyncService: null,
      mainWindow: null,
      getMainWindow: () => win,
      generateShellApprovalQR: jest.fn(),
      capabilityController: null,
    };
    registerSyncHandlers({ handle: jest.fn(), on: jest.fn() }, handlers);

    const details = { operation: 'mark-prompt-processed', error: 'PERMISSION_DENIED', at: 123 };
    cloudSyncService.emit('cloud-sync-error', details);

    expect(win.webContents.send).toHaveBeenCalledWith('cloud-sync-error', details);
  });

  test('SyncSettings subscribes to the event and shows it in the status line', () => {
    // No React test harness in this repo — pin the wiring itself: the page
    // that shows sync status must listen, and must unsubscribe on unmount.
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src/components/SyncSettings.tsx'),
      'utf8',
    );
    expect(source).toMatch(/electronAPI\.on\('cloud-sync-error'/);
    expect(source).toContain('cleanupCloudErrors()');
    expect(source).toMatch(/Cloud sync write failed/);
  });
});
