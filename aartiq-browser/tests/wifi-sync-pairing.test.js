/**
 * wifi-sync-pairing.test.js — Desktop-side pairing/handshake behaviour.
 *
 * Regression coverage for the "Invalid pairing code" reports:
 *   1. The pairing code was randomized per process start, so a code saved or
 *      shown before a relaunch stopped working.
 *   2. The phone presents a new secure-storage device id while the desktop
 *      only knows its pre-migration legacy id, so an already-paired phone
 *      was treated as unknown and rejected without a code.
 *
 * Unknown devices must still fail closed (AUTH_FAILED / invalid code).
 */

jest.mock('electron', () => ({
  clipboard: { writeText: jest.fn(), readText: jest.fn(() => '') },
}));

// Shared in-memory backing store so persistence can be asserted across
// WiFiSyncService instances (exposed on the class as `.data`).
jest.mock('electron-store', () => {
  const mockData = {};
  class MockElectronStore {
    get(key) {
      return mockData[key];
    }
    set(key, value) {
      mockData[key] = value;
    }
    delete(key) {
      delete mockData[key];
    }
    clear() {
      for (const key of Object.keys(mockData)) delete mockData[key];
    }
  }
  MockElectronStore.data = mockData;
  return MockElectronStore;
});

jest.mock('../src/lib/DeviceIdentifier', () => ({
  DeviceIdentifier: {
    getDeviceMetadata: () => ({
      deviceId: 'desktop-testhost01',
      deviceName: 'Test Host',
      model: 'TestModel',
      deviceImage: 'macbook',
      hostname: 'testhost',
    }),
  },
}));

const Store = require('electron-store');
const { WiFiSyncService } = require('../src/lib/WiFiSyncService');

// A successful handshake schedules sendSessionSnapshot() 500ms later; keep
// that timer from requiring modules after the Jest environment is torn down.
// The spy is intentionally never restored — it lives exactly as long as this
// file's module registry.
beforeAll(() => {
  jest
    .spyOn(WiFiSyncService.prototype, 'sendSessionSnapshot')
    .mockImplementation(() => {});
});

function fakeWs() {
  const sent = [];
  return {
    sent,
    send: (payload) => sent.push(JSON.parse(payload)),
  };
}

function handshake(ws, payload) {
  const service = new WiFiSyncService(3004);
  service._handleMessage(ws, JSON.stringify({ type: 'handshake', ...payload }));
  return service;
}

describe('WiFi sync pairing (desktop)', () => {
  beforeEach(() => {
    for (const key of Object.keys(Store.data)) delete Store.data[key];
  });

  it('keeps the pairing code stable across service restarts', () => {
    const first = new WiFiSyncService(3004);
    const code = first.getPairingCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(Store.data.pairingCode).toBe(code);

    const second = new WiFiSyncService(3004);
    expect(second.getPairingCode()).toBe(code);
  });

  it('rejects an unknown device that sends no pairing code', () => {
    const ws = fakeWs();
    handshake(ws, { deviceId: 'brand-new-phone' });

    const error = ws.sent.find((m) => m.type === 'error');
    expect(error).toMatchObject({
      code: 'AUTH_FAILED',
      message: 'Invalid pairing code',
    });
  });

  it('rejects an unknown device with a wrong pairing code', () => {
    const ws = fakeWs();
    handshake(ws, { deviceId: 'brand-new-phone', pairingCode: '000000' });

    expect(ws.sent.find((m) => m.type === 'error')).toMatchObject({
      code: 'AUTH_FAILED',
    });
  });

  it('accepts an unknown device that sends the current pairing code', () => {
    const service = new WiFiSyncService(3004);
    const ws = fakeWs();
    service._handleMessage(
      ws,
      JSON.stringify({
        type: 'handshake',
        deviceId: 'brand-new-phone',
        pairingCode: service.getPairingCode(),
      })
    );

    const ack = ws.sent.find((m) => m.type === 'handshake-ack');
    expect(ack).toMatchObject({ authenticated: true, trusted: true });
    expect(ack.permanentToken).toMatch(/^[0-9a-f]{64}$/);
    // The ack advertises BOTH id forms so the phone can key its stored
    // token under either (legacy formula and new DeviceIdentifier id).
    expect(ack.deviceId).toBe('desktop-testhost01');
    expect(ack.legacyDeviceId).toMatch(/^desktop-/);
  });

  it('recognises a paired phone that presents its new id plus trusted legacy id', () => {
    Store.data.knownWifiSyncDevices = [
      {
        deviceId: 'legacy-phone-uuid',
        deviceName: 'Old Phone',
        deviceType: 'mobile',
        ip: '',
        port: 3004,
        trustLevel: 'trusted',
        permanentToken: 'token-abc',
        autoConnect: true,
        online: false,
      },
    ];

    const ws = fakeWs();
    const service = handshake(ws, {
      deviceId: 'new-secure-id',
      legacyDeviceId: 'legacy-phone-uuid',
    });

    const ack = ws.sent.find((m) => m.type === 'handshake-ack');
    expect(ack).toMatchObject({ authenticated: true, trusted: true });
    // The permanent token carries over instead of being re-minted.
    expect(ack.permanentToken).toBe('token-abc');

    // Record migrated to the new id; the legacy key is gone.
    const devices = service.getKnownDevices();
    expect(devices.map((d) => d.deviceId)).toEqual(['new-secure-id']);
    expect(devices[0].trustLevel).toBe('trusted');
    expect(devices[0].permanentToken).toBe('token-abc');
  });

  it('still rejects a phone whose legacy id was never trusted', () => {
    const ws = fakeWs();
    handshake(ws, {
      deviceId: 'unknown-new-id',
      legacyDeviceId: 'unknown-legacy-id',
    });

    expect(ws.sent.find((m) => m.type === 'error')).toMatchObject({
      code: 'AUTH_FAILED',
    });
  });
});
