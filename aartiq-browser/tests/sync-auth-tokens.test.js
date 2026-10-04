/**
 * sync-auth-tokens.test.js
 *
 * Comprehensive tests for Issue 3:
 * - Short-lived access tokens (15 minutes) + device-bound refresh tokens
 * - Expired tokens rejected
 * - Token refresh with device binding verification
 * - Token reuse from a different device rejected
 * - Explicit revocation / unpair invalidates immediately and closes socket
 * - Unauthenticated access to WiFi sync and PDF sync listeners rejected
 * - PDF sync authentication with Bearer / X-Aartiq-Token / query param
 * - PDF sync Host header validation
 * - Brute-force pairing rate limiting and lockout
 * - Notifications on new pairing and network location changes
 * - Idle device expiration
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

const http = require('http');
const { WiFiSyncService, ACCESS_TOKEN_TTL_MS, IDLE_DEVICE_TTL_MS } = require('../src/lib/WiFiSyncService');
const { PDFSyncService } = require('../src/service/pdf-sync');

beforeAll(() => {
  jest
    .spyOn(WiFiSyncService.prototype, 'sendSessionSnapshot')
    .mockImplementation(() => {});
});

function createMockSocket(ip = '192.168.1.50') {
  const sent = [];
  let closed = false;
  let closeCode = null;
  let closeReason = null;

  return {
    sent,
    readyState: 1, // WebSocket.OPEN
    _socket: { remoteAddress: ip },
    send: (payload) => {
      try {
        sent.push(JSON.parse(payload));
      } catch (_) {
        sent.push(payload);
      }
    },
    close: (code, reason) => {
      closed = true;
      closeCode = code;
      closeReason = reason;
    },
    isClosed: () => closed,
    getCloseCode: () => closeCode,
    getCloseReason: () => closeReason,
  };
}

describe('Issue 3: Short-lived sync tokens, device binding, and listener authentication', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockStoreData)) delete mockStoreData[k];
  });

  describe('WiFi Sync: Short-lived access tokens and pairing', () => {
    it('issues a 15-minute access token and refresh token on pairing', () => {
      const service = new WiFiSyncService(3004);
      const ws = createMockSocket('192.168.1.100');

      service._handleMessage(
        ws,
        JSON.stringify({
          type: 'handshake',
          deviceId: 'phone-alice',
          deviceName: "Alice's iPhone",
          pairingCode: service.getPairingCode(),
          deviceFingerprint: 'fingerprint-hardware-xyz',
        })
      );

      const ack = ws.sent.find((m) => m.type === 'handshake-ack');
      expect(ack).toBeTruthy();
      expect(ack.authenticated).toBe(true);
      expect(ack.accessToken).toMatch(/^[0-9a-f]{64}$/);
      expect(ack.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(ack.expiresIn).toBe(Math.floor(ACCESS_TOKEN_TTL_MS / 1000));
      expect(ack.expiresAt).toBeGreaterThan(Date.now());
    });

    it('emits new-device-paired notification on first pairing', () => {
      const service = new WiFiSyncService(3004);
      const ws = createMockSocket('192.168.1.101');
      const pairedEvents = [];
      service.on('new-device-paired', (evt) => pairedEvents.push(evt));

      service._handleMessage(
        ws,
        JSON.stringify({
          type: 'handshake',
          deviceId: 'phone-bob',
          deviceName: "Bob's Android",
          pairingCode: service.getPairingCode(),
        })
      );

      expect(pairedEvents.length).toBe(1);
      expect(pairedEvents[0]).toMatchObject({
        deviceId: 'phone-bob',
        deviceName: "Bob's Android",
        ip: '192.168.1.101',
      });
    });
  });

  describe('WiFi Sync: Listener authentication and token expiration', () => {
    it('rejects unauthenticated sync messages without handshake or token', () => {
      const service = new WiFiSyncService(3004);
      const ws = createMockSocket('192.168.1.102');

      // Attempt to invoke command directly
      service._handleMessage(
        ws,
        JSON.stringify({
          type: 'execute-command',
          commandId: 'cmd-1',
          command: 'whoami',
        })
      );

      const err = ws.sent.find((m) => m.type === 'error');
      expect(err).toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects sync messages when access token is expired', () => {
      const service = new WiFiSyncService(3004);
      const ws = createMockSocket('192.168.1.103');

      // First pair
      service._handleMessage(
        ws,
        JSON.stringify({
          type: 'handshake',
          deviceId: 'phone-expired-test',
          pairingCode: service.getPairingCode(),
        })
      );
      const ack = ws.sent.find((m) => m.type === 'handshake-ack');
      const token = ack.accessToken;

      // Simulate token expiration by modifying the device record
      const dev = service.getKnownDevices().find((d) => d.deviceId === 'phone-expired-test');
      expect(dev).toBeTruthy();
      dev.accessTokenExpiresAt = Date.now() - 1000; // expired in past

      const commandWs = createMockSocket('192.168.1.103');
      service._handleMessage(
        commandWs,
        JSON.stringify({
          type: 'session-sync-request',
          deviceId: 'phone-expired-test',
          accessToken: token,
        })
      );

      const err = commandWs.sent.find((m) => m.type === 'error');
      expect(err).toMatchObject({
        code: 'TOKEN_EXPIRED',
      });
    });
  });

  describe('WiFi Sync: Token refresh and device binding', () => {
    it('refreshes an access token with valid refreshToken and matching device binding', () => {
      const service = new WiFiSyncService(3004);
      const ws = createMockSocket('192.168.1.104');

      // Pair with fingerprint binding
      service._handleMessage(
        ws,
        JSON.stringify({
          type: 'handshake',
          deviceId: 'phone-refresh-test',
          deviceName: 'Bound Phone',
          pairingCode: service.getPairingCode(),
          deviceFingerprint: 'secure-hardware-chip-id-99',
        })
      );
      const ack = ws.sent.find((m) => m.type === 'handshake-ack');
      const refreshToken = ack.refreshToken;

      // Refresh
      const refreshWs = createMockSocket('192.168.1.104');
      service._handleMessage(
        refreshWs,
        JSON.stringify({
          type: 'token-refresh',
          deviceId: 'phone-refresh-test',
          refreshToken,
          deviceFingerprint: 'secure-hardware-chip-id-99',
        })
      );

      const refreshAck = refreshWs.sent.find((m) => m.type === 'token-refresh-ack');
      expect(refreshAck).toBeTruthy();
      expect(refreshAck.accessToken).toMatch(/^[0-9a-f]{64}$/);
      expect(refreshAck.expiresAt).toBeGreaterThan(Date.now());
    });

    it('rejects token refresh when device fingerprint binding does not match (stolen token on another device)', () => {
      const service = new WiFiSyncService(3004);
      const ws = createMockSocket('192.168.1.105');

      // Pair with fingerprint binding
      service._handleMessage(
        ws,
        JSON.stringify({
          type: 'handshake',
          deviceId: 'phone-stolen-test',
          pairingCode: service.getPairingCode(),
          deviceFingerprint: 'original-device-fingerprint',
        })
      );
      const ack = ws.sent.find((m) => m.type === 'handshake-ack');
      const refreshToken = ack.refreshToken;

      // Attacker copies refreshToken to another device with different hardware fingerprint
      const attackerWs = createMockSocket('192.168.1.200');
      service._handleMessage(
        attackerWs,
        JSON.stringify({
          type: 'token-refresh',
          deviceId: 'phone-stolen-test',
          refreshToken,
          deviceFingerprint: 'rogue-device-fingerprint',
        })
      );

      const err = attackerWs.sent.find((m) => m.type === 'error');
      expect(err).toMatchObject({
        code: 'BINDING_MISMATCH',
      });
    });

    it('notifies user when token is refreshed from a new network location', () => {
      const service = new WiFiSyncService(3004);
      const ws = createMockSocket('192.168.1.50');

      service._handleMessage(
        ws,
        JSON.stringify({
          type: 'handshake',
          deviceId: 'phone-roaming',
          deviceName: 'Roaming Phone',
          pairingCode: service.getPairingCode(),
        })
      );
      const ack = ws.sent.find((m) => m.type === 'handshake-ack');

      const locationEvents = [];
      service.on('network-location-changed', (e) => locationEvents.push(e));

      // Refresh from a new IP
      const roamingWs = createMockSocket('10.0.0.99');
      service._handleMessage(
        roamingWs,
        JSON.stringify({
          type: 'token-refresh',
          deviceId: 'phone-roaming',
          refreshToken: ack.refreshToken,
        })
      );

      expect(locationEvents.length).toBe(1);
      expect(locationEvents[0]).toMatchObject({
        deviceId: 'phone-roaming',
        oldIp: '192.168.1.50',
        newIp: '10.0.0.99',
      });
    });

    it('rejects refresh for devices idle past expiration threshold', () => {
      const service = new WiFiSyncService(3004);
      const ws = createMockSocket('192.168.1.106');

      service._handleMessage(
        ws,
        JSON.stringify({
          type: 'handshake',
          deviceId: 'phone-idle',
          pairingCode: service.getPairingCode(),
        })
      );
      const ack = ws.sent.find((m) => m.type === 'handshake-ack');

      // Simulate device being idle for 31 days
      const dev = service.getKnownDevices().find((d) => d.deviceId === 'phone-idle');
      dev.lastSeen = Date.now() - (IDLE_DEVICE_TTL_MS + 10000);

      const refreshWs = createMockSocket('192.168.1.106');
      service._handleMessage(
        refreshWs,
        JSON.stringify({
          type: 'token-refresh',
          deviceId: 'phone-idle',
          refreshToken: ack.refreshToken,
        })
      );

      const err = refreshWs.sent.find((m) => m.type === 'error');
      expect(err).toMatchObject({
        code: 'SESSION_EXPIRED',
      });
    });
  });

  describe('WiFi Sync: Explicit revocation / Unpair device', () => {
    it('unpairDevice immediately revokes trust, clears tokens, and closes connection', () => {
      const service = new WiFiSyncService(3004);
      const ws = createMockSocket('192.168.1.107');

      service._handleMessage(
        ws,
        JSON.stringify({
          type: 'handshake',
          deviceId: 'phone-to-unpair',
          pairingCode: service.getPairingCode(),
        })
      );
      const ack = ws.sent.find((m) => m.type === 'handshake-ack');
      expect(ack).toBeTruthy();

      // Explicitly unpair device
      const unpaired = service.unpairDevice('phone-to-unpair');
      expect(unpaired).toBe(true);
      expect(ws.isClosed()).toBe(true);

      // Subsequent attempt with old refresh token fails
      const refreshWs = createMockSocket('192.168.1.107');
      service._handleMessage(
        refreshWs,
        JSON.stringify({
          type: 'token-refresh',
          deviceId: 'phone-to-unpair',
          refreshToken: ack.refreshToken,
        })
      );

      const err = refreshWs.sent.find((m) => m.type === 'error');
      expect(err).toMatchObject({
        code: 'AUTH_FAILED',
      });
    });
  });

  describe('WiFi Sync: Rate limiting and brute-force lockout', () => {
    it('locks out a client IP after 5 failed pairing attempts', () => {
      const service = new WiFiSyncService(3004);
      const bruteIp = '192.168.1.222';

      for (let i = 0; i < 5; i++) {
        const ws = createMockSocket(bruteIp);
        service._handleMessage(
          ws,
          JSON.stringify({
            type: 'handshake',
            deviceId: 'brute-force-phone',
            pairingCode: `wrong-${i}`,
          })
        );
        const err = ws.sent.find((m) => m.type === 'error');
        expect(err.code).toBe('AUTH_FAILED');
      }

      // 6th attempt is locked out
      const lockedWs = createMockSocket(bruteIp);
      service._handleMessage(
        lockedWs,
        JSON.stringify({
          type: 'handshake',
          deviceId: 'brute-force-phone',
          pairingCode: service.getPairingCode(), // even with correct code!
        })
      );
      const lockoutErr = lockedWs.sent.find((m) => m.type === 'error');
      expect(lockoutErr).toMatchObject({
        code: 'AUTH_LOCKED_OUT',
      });
    });
  });

  describe('PDF Sync Listener: HTTP token authentication & Host header validation', () => {
    let pdfService;
    let testPort;
    const testToken = 'secret-pdf-sync-token-12345';

    beforeAll(async () => {
      testPort = 43999;
      pdfService = new PDFSyncService({
        port: testPort,
        authToken: testToken,
      });
      await pdfService.startServer();
    });

    afterAll((done) => {
      if (pdfService.server) {
        pdfService.server.close(done);
      } else {
        done();
      }
    });

    it('rejects unauthenticated requests to /api/files with 401', (done) => {
      http.get(`http://127.0.0.1:${testPort}/api/files`, (res) => {
        expect(res.statusCode).toBe(401);
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const body = JSON.parse(data);
          expect(body.error).toBe('Unauthorized');
          done();
        });
      });
    });

    it('accepts requests with valid Authorization Bearer header', (done) => {
      const req = http.request(
        `http://127.0.0.1:${testPort}/api/status`,
        {
          headers: {
            Authorization: `Bearer ${testToken}`,
          },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          done();
        }
      );
      req.end();
    });

    it('accepts requests with valid X-Aartiq-Token header', (done) => {
      const req = http.request(
        `http://127.0.0.1:${testPort}/api/status`,
        {
          headers: {
            'X-Aartiq-Token': testToken,
          },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          done();
        }
      );
      req.end();
    });

    it('accepts requests with valid ?token= query parameter', (done) => {
      http.get(`http://127.0.0.1:${testPort}/api/status?token=${testToken}`, (res) => {
        expect(res.statusCode).toBe(200);
        done();
      });
    });

    it('rejects requests with an invalid Host header with 403 (DNS rebinding protection)', (done) => {
      const req = http.request(
        `http://127.0.0.1:${testPort}/api/status`,
        {
          headers: {
            Host: 'attacker.evil.com',
            Authorization: `Bearer ${testToken}`,
          },
        },
        (res) => {
          expect(res.statusCode).toBe(403);
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            const body = JSON.parse(data);
            expect(body.error).toBe('Forbidden');
            done();
          });
        }
      );
      req.end();
    });
  });
});
