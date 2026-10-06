/**
 * wifi-sync-upgrade.test.js — connection-time gate for the WiFi sync socket.
 *
 * docs-audit/issues/wifi-sync-bind-address.md: the WebSocket server binds every
 * interface on purpose (the phone reaches it over the LAN), so the exposure is
 * bounded before the handshake instead of assumed away:
 *
 *   1. Upgrade gate — an Origin that is not one of ours, or a Host header that
 *      does not name this machine (DNS rebinding), is refused with 403 before
 *      any socket exists. A native phone client sends no Origin; that is the
 *      allowed path.
 *   2. Unpair gate — `unpair-device` is state-changing, so it lives inside the
 *      access-token gate with the other sync routes: a socket that never
 *      authenticated cannot revoke a device.
 */

jest.mock('electron', () => ({
  clipboard: { writeText: jest.fn(), readText: jest.fn(() => '') },
}));

const mockStoreData = {};
jest.mock('electron-store', () => {
  class MockElectronStore {
    get(key) {
      return mockStoreData[key];
    }
    set(key, value) {
      mockStoreData[key] = value;
    }
    delete(key) {
      delete mockStoreData[key];
    }
    clear() {
      for (const k of Object.keys(mockStoreData)) delete mockStoreData[k];
    }
  }
  MockElectronStore.data = mockStoreData;
  return MockElectronStore;
});

jest.mock('../src/lib/DeviceIdentifier', () => ({
  DeviceIdentifier: {
    getDeviceMetadata: () => ({
      deviceId: 'desktop-testhost01',
      deviceName: 'Test Desktop Host',
      model: 'TestModel',
      deviceImage: 'macbook',
      hostname: 'testhost',
    }),
  },
}));

const os = require('os');
const WebSocket = require('ws');
const { WiFiSyncService } = require('../src/lib/WiFiSyncService');

beforeAll(() => {
  jest
    .spyOn(WiFiSyncService.prototype, 'sendSessionSnapshot')
    .mockImplementation(() => {});
});

beforeEach(() => {
  for (const k of Object.keys(mockStoreData)) delete mockStoreData[k];
});

function createMockSocket(ip = '192.168.1.50') {
  const sent = [];
  return {
    sent,
    readyState: 1,
    _socket: { remoteAddress: ip },
    send: (payload) => {
      try {
        sent.push(JSON.parse(payload));
      } catch (_) {
        sent.push(payload);
      }
    },
    close: () => {},
  };
}

function firstInterfaceAddresses() {
  const out = { v4: null, v6: null };
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const addr of interfaces[name] || []) {
      if (!addr.internal && !out.v4 && addr.family === 'IPv4') out.v4 = addr.address;
      if (!addr.internal && !out.v6 && addr.family === 'IPv6') out.v6 = addr.address;
    }
  }
  return out;
}

describe('upgrade gate: Origin and Host are checked before the handshake', () => {
  const service = new WiFiSyncService(3004);

  test('allows a native client: no Origin, Host is loopback', () => {
    expect(service._isUpgradeAllowed({ host: '127.0.0.1:3004' })).toEqual({ ok: true });
    expect(service._isUpgradeAllowed({ host: '[::1]:3004' })).toEqual({ ok: true });
    expect(service._isUpgradeAllowed({ host: 'localhost:3004' })).toEqual({ ok: true });
  });

  test('allows this machine\'s own names and addresses — what the QR hands out', () => {
    expect(service._isUpgradeAllowed({ host: `${os.hostname()}:3004` })).toEqual({ ok: true });
    expect(service._isUpgradeAllowed({ host: `${os.hostname()}.local:3004` })).toEqual({ ok: true });

    const addrs = firstInterfaceAddresses();
    if (addrs.v4) {
      expect(service._isUpgradeAllowed({ host: `${addrs.v4}:3004` })).toEqual({ ok: true });
    }
    if (addrs.v6) {
      expect(service._isUpgradeAllowed({ host: `[${addrs.v6}]:3004` })).toEqual({ ok: true });
    }
  });

  test('refuses a Host header that names a domain (DNS rebinding), fail closed', () => {
    const verdict = service._isUpgradeAllowed({ host: 'attacker.example:3004' });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/host header not local/);

    // A malformed upgrade with no Host at all is refused, not waved through.
    expect(service._isUpgradeAllowed({}).ok).toBe(false);
    expect(service._isUpgradeAllowed({ host: '' }).ok).toBe(false);
  });

  test('refuses an Origin that is not one of ours', () => {
    const verdict = service._isUpgradeAllowed({
      host: '127.0.0.1:3004',
      origin: 'https://evil.example',
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/origin not allowed/);
  });

  test('allows the origins a real Aartiq client sends, including none at all', () => {
    // Native phone client: no Origin header, Host is this machine's LAN
    // address — the exact value getLocalIp() puts in the pairing QR.
    const lan = firstInterfaceAddresses().v4 || '127.0.0.1';
    expect(service._isUpgradeAllowed({ host: `${lan}:3004` }).ok).toBe(true);
    // Electron renderer (dev and packaged) and the sandboxed "null" origin.
    expect(
      service._isUpgradeAllowed({ host: '127.0.0.1:3004', origin: 'http://localhost:3003' }).ok
    ).toBe(true);
    expect(
      service._isUpgradeAllowed({ host: '127.0.0.1:3004', origin: 'file://' }).ok
    ).toBe(true);
    expect(
      service._isUpgradeAllowed({ host: '127.0.0.1:3004', origin: 'null' }).ok
    ).toBe(true);
  });
});

describe('upgrade gate over a real socket', () => {
  let service;
  let port;

  beforeAll(async () => {
    service = new WiFiSyncService(0);
    service._startDiscovery = jest.fn(); // no UDP broadcast inside jest
    expect(service.start()).toBe(true);
    port = service.wss.address().port;
  });

  afterAll(() => {
    service.stop();
  });

  function connect(opts = {}) {
    return new Promise((resolve) => {
      const result = { open: false, status: null };
      let ws;
      try {
        ws = new WebSocket(`ws://127.0.0.1:${port}`, opts);
      } catch (e) {
        result.error = e;
        resolve(result);
        return;
      }
      const finish = () => {
        try {
          ws.close();
        } catch (_) {}
        resolve(result);
      };
      ws.on('open', () => {
        result.open = true;
        finish();
      });
      ws.on('unexpected-response', (_req, res) => {
        result.status = res.statusCode;
        res.resume();
        finish();
      });
      ws.on('error', () => finish());
      ws.on('close', () => finish());
    });
  }

  test('a native client (no Origin, local Host) connects', async () => {
    const result = await connect();
    expect(result.open).toBe(true);
  });

  test('the Electron dev origin connects', async () => {
    const result = await connect({ origin: 'http://localhost:3003' });
    expect(result.open).toBe(true);
  });

  test('a browser page from another origin is refused with 403', async () => {
    const result = await connect({ origin: 'https://evil.example' });
    expect(result.open).toBe(false);
    expect(result.status).toBe(403);
  });

  test('a rebinding Host header is refused with 403', async () => {
    const result = await connect({ headers: { Host: 'attacker.example' } });
    expect(result.open).toBe(false);
    expect(result.status).toBe(403);
  });
});

describe('unpair-device sits behind the access-token gate', () => {
  function pairDevice(service, deviceId) {
    const ws = createMockSocket('192.168.1.77');
    service._handleMessage(
      ws,
      JSON.stringify({
        type: 'handshake',
        deviceId,
        deviceName: `${deviceId} phone`,
        pairingCode: service.getPairingCode(),
        deviceFingerprint: `fp-${deviceId}`,
      })
    );
    const ack = ws.sent.find((m) => m.type === 'handshake-ack');
    expect(ack).toBeTruthy();
    expect(ack.authenticated).toBe(true);
    return ws;
  }

  test('an authenticated socket can unpair its device', () => {
    const service = new WiFiSyncService(3004);
    const ws = pairDevice(service, 'phone-unpair-ok');
    expect(service.knownDevices.has('phone-unpair-ok')).toBe(true);

    service._handleMessage(ws, JSON.stringify({ type: 'unpair-device', deviceId: 'phone-unpair-ok' }));

    expect(ws.sent.find((m) => m.type === 'unpair-ack')).toBeTruthy();
    expect(service.knownDevices.has('phone-unpair-ok')).toBe(false);
  });

  test('a socket that never authenticated cannot unpair anyone', () => {
    const service = new WiFiSyncService(3004);
    pairDevice(service, 'phone-unpair-victim');

    const attacker = createMockSocket('192.168.1.99');
    service._handleMessage(
      attacker,
      JSON.stringify({ type: 'unpair-device', deviceId: 'phone-unpair-victim' })
    );

    const err = attacker.sent.find((m) => m.type === 'error');
    expect(err).toBeTruthy();
    expect(err.code).toBe('UNAUTHORIZED');
    expect(attacker.sent.find((m) => m.type === 'unpair-ack')).toBeUndefined();
    // The victim device is untouched.
    expect(service.knownDevices.has('phone-unpair-victim')).toBe(true);
  });
});
