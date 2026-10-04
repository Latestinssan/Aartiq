/**
 * sync-handlers-window.test.js — The window reference sync-handlers sends to
 * must be resolved LIVE.
 *
 * handlerDeps captures the startup window by value. After that window closes
 * the captured reference is a destroyed BrowserWindow: truthiness checks still
 * pass (the object is non-null) and `webContents.send` throws "Object has
 * been destroyed". Every such throw counts toward the main process force-quit
 * threshold, which is what disconnected mobile clients after the desktop
 * control window was closed — and 'send-prompt' additionally reported success
 * while the renderer never received 'remote-ai-prompt', so the phone waited
 * forever for AI output that could never arrive.
 */

jest.mock('electron', () => ({ ipcMain: { handle: jest.fn(), on: jest.fn() } }));

const EventEmitter = require('events');
const registerSyncHandlers = require('../src/main/handlers/sync-handlers');

function makeWindow({ destroyed }) {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: jest.fn() },
    focus: jest.fn(),
  };
}

function setup({ getMainWindow, staleWindow }) {
  const ipcMain = { handle: jest.fn(), on: jest.fn() };
  const wifiSyncService = new EventEmitter();
  wifiSyncService.sendToMobile = jest.fn();
  wifiSyncService.getPairingCode = jest.fn(() => '123456');
  const handlers = {
    store: { get: jest.fn(), set: jest.fn() },
    wifiSyncService,
    cloudSyncService: null,
    p2pSyncService: null,
    mainWindow: staleWindow,
    getMainWindow,
    generateShellApprovalQR: jest.fn(),
    capabilityController: null,
  };
  registerSyncHandlers(ipcMain, handlers);
  return { wifiSyncService, ipcMain };
}

function sendPrompt(wifiSyncService) {
  return new Promise((resolve) => {
    wifiSyncService.emit('command', {
      command: 'desktop-control',
      args: { action: 'send-prompt', prompt: 'hello', promptId: 'p1' },
      sendResponse: resolve,
    });
  });
}

function getStatus(wifiSyncService) {
  return new Promise((resolve) => {
    wifiSyncService.emit('command', {
      command: 'desktop-control',
      args: { action: 'get-status' },
      sendResponse: resolve,
    });
  });
}

describe('sync-handlers live window resolution', () => {
  it('delivers the AI prompt through a live window', async () => {
    const live = makeWindow({ destroyed: false });
    const { wifiSyncService } = setup({
      getMainWindow: () => live,
      staleWindow: makeWindow({ destroyed: true }),
    });

    const response = await sendPrompt(wifiSyncService);
    expect(response).toEqual({ success: true, promptId: 'p1' });
    expect(live.webContents.send).toHaveBeenCalledWith('remote-ai-prompt', {
      prompt: 'hello',
      promptId: 'p1',
      streamToMobile: true,
    });
  });

  it('fails honestly when every window is closed (no silent success)', async () => {
    const stale = makeWindow({ destroyed: true });
    const { wifiSyncService } = setup({
      getMainWindow: () => stale,
      staleWindow: stale,
    });

    const response = await sendPrompt(wifiSyncService);
    expect(response.success).toBe(false);
    expect(response.error).toMatch(/closed/i);
    expect(stale.webContents.send).not.toHaveBeenCalled();
  });

  it('fails honestly when there is no window at all (getMainWindow → null)', async () => {
    const { wifiSyncService } = setup({
      getMainWindow: () => null,
      staleWindow: null,
    });

    const response = await sendPrompt(wifiSyncService);
    expect(response.success).toBe(false);
    expect(response.error).toMatch(/closed/i);
  });

  it('does not throw when connection events fire with a destroyed window', () => {
    const stale = makeWindow({ destroyed: true });
    const { wifiSyncService } = setup({
      getMainWindow: () => stale,
      staleWindow: stale,
    });

    // Previously: `if (mainWindow) mainWindow.webContents.send(...)` threw
    // "Object has been destroyed" — five of those force-quit the app.
    expect(() => wifiSyncService.emit('client-connected')).not.toThrow();
    expect(() => wifiSyncService.emit('client-disconnected')).not.toThrow();
    expect(stale.webContents.send).not.toHaveBeenCalled();
  });

  it('falls back to the captured window when no getter is provided', async () => {
    const stale = makeWindow({ destroyed: true });
    const { wifiSyncService } = setup({ getMainWindow: undefined, staleWindow: stale });

    const response = await sendPrompt(wifiSyncService);
    expect(response.success).toBe(false);
    expect(stale.webContents.send).not.toHaveBeenCalled();
  });

  it('get-status needs no window', async () => {
    const { wifiSyncService } = setup({ getMainWindow: () => null, staleWindow: null });
    const response = await getStatus(wifiSyncService);
    expect(response.success).toBe(true);
    expect(response.desktopName).toEqual(expect.any(String));
  });
});
