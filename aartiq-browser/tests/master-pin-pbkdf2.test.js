/**
 * master-pin-pbkdf2.test.js — the Master PIN KDF cost and its migration.
 *
 * The cost was raised 100 000 → 600 000 SHA-256 PBKDF2 iterations. A naive
 * constant bump would have made every already-stored PIN fail to verify —
 * the record carries no iteration count, and verifyPIN recomputes with the
 * module constant — i.e. a silent mass lockout. The migration therefore
 * stores the cost *per record*:
 *
 *   - records created from now on hash at 600 000;
 *   - records without the field are legacy 100 000-iteration records and
 *     verify at that stored cost (no lockout on upgrade);
 *   - on the first *successful* verify — the only moment the plaintext PIN
 *     is in hand — the record is re-hashed to 600 000 (lazy migration; a
 *     wrong PIN never rewrites anything);
 *   - the sync payload carries the cost so the peer verifies the hash it
 *     receives at the cost it was made at, not at its own build's default;
 *   - cost claims below the legacy floor are clamped: a bogus value can
 *     only cause a mismatch (fail closed), never a cheaper comparison.
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
  return MockElectronStore;
});

// Never touch the real OS keychain from tests — addPassword would otherwise
// be attempted against it on every save.
jest.mock('../src/lib/native-keychain', () => ({}));

const crypto = require('crypto');
const { MasterPINService, masterPinService } = require('../src/lib/MasterPINService');

const PIN = '123456';
const WRONG_PIN = '000000';
const STORE_KEY = 'master_pin_credentials';
const TARGET = 600000;
const LEGACY = 100000;

function pbkdf2(pin, salt, iterations) {
  return crypto.pbkdf2Sync(pin, salt, iterations, 32, 'sha256').toString('hex');
}

function readRecord() {
  return masterPinService['store'].get(STORE_KEY);
}

function writeRecord(record) {
  masterPinService['store'].set(STORE_KEY, record);
}

/** A record exactly as written before the `iterations` field existed. */
function legacyRecord(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    salt,
    hash: pbkdf2(pin, salt, LEGACY),
    createdAt: Date.now(),
    failedAttempts: 0,
  };
}

beforeEach(() => {
  masterPinService['store'].clear();
});

afterEach(() => {
  masterPinService['store'].clear();
});

describe('Master PIN PBKDF2 cost (600 000 target, per-record cost field)', () => {
  test('new records hash at the target cost and verify', () => {
    const res = masterPinService.setupPIN(PIN);
    expect(res.success).toBe(true);

    const record = readRecord();
    expect(record.iterations).toBe(TARGET);
    expect(record.hash).toBe(pbkdf2(PIN, record.salt, TARGET));

    expect(masterPinService.verifyPIN(PIN).verified).toBe(true);
  });

  test('hashPin defaults to the target cost and accepts an explicit cost', () => {
    const salt = 'ab12'.repeat(8);
    expect(MasterPINService.hashPin(PIN, salt)).toBe(pbkdf2(PIN, salt, TARGET));
    expect(MasterPINService.hashPin(PIN, salt, LEGACY)).toBe(pbkdf2(PIN, salt, LEGACY));
  });

  test('a legacy record (no iterations field) still verifies — the upgrade must not lock users out — and is re-hashed to the target cost on that first successful verify', () => {
    const record = legacyRecord(PIN);
    writeRecord(record);

    // Verifies at the STORED cost: computing at the new constant instead
    // would be a mismatch, i.e. exactly the lockout this migration avoids.
    expect(masterPinService.verifyPIN(PIN).verified).toBe(true);

    // The plaintext PIN was in hand on that proven match → migrated.
    const upgraded = readRecord();
    expect(upgraded.iterations).toBe(TARGET);
    expect(upgraded.hash).toBe(pbkdf2(PIN, record.salt, TARGET));

    // …and the record still verifies after the re-hash.
    expect(masterPinService.verifyPIN(PIN).verified).toBe(true);
  });

  test('a wrong PIN against a legacy record fails without rewriting the record or its cost', () => {
    const record = legacyRecord(PIN);
    writeRecord(record);

    const res = masterPinService.verifyPIN(WRONG_PIN);
    expect(res.verified).toBe(false);
    expect(res.remainingAttempts).toBe(4);

    const stored = readRecord();
    expect(stored.iterations).toBeUndefined();
    expect(stored.hash).toBe(record.hash);
  });

  test('the sync payload reports the cost of the hash it carries', () => {
    masterPinService.setupPIN(PIN);
    expect(masterPinService.getSyncPayload()).toMatchObject({
      hasPin: true,
      iterations: TARGET,
    });

    writeRecord(legacyRecord(PIN));
    expect(masterPinService.getSyncPayload()).toMatchObject({
      hasPin: true,
      iterations: LEGACY,
    });
  });

  test('setFromSync stores the sender-stated cost; a sender predating the field is read as legacy', () => {
    const record = legacyRecord(PIN);

    expect(masterPinService.setFromSync(record.salt, record.hash, LEGACY)).toBe(true);
    expect(readRecord().iterations).toBe(LEGACY);
    expect(masterPinService.verifyPIN(PIN).verified).toBe(true);
    expect(readRecord().iterations).toBe(TARGET); // lazily migrated on verify

    expect(masterPinService.setFromSync(record.salt, record.hash)).toBe(true);
    expect(readRecord().iterations).toBe(LEGACY);
    expect(masterPinService.verifyPIN(PIN).verified).toBe(true);
  });

  test('a below-legacy cost claim is clamped up, never honoured', () => {
    const record = legacyRecord(PIN);

    expect(masterPinService.setFromSync(record.salt, record.hash, 5)).toBe(true);
    expect(readRecord().iterations).toBe(LEGACY);
  });
});
