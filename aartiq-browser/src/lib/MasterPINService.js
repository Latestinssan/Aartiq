"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.masterPinService = exports.MasterPINService = void 0;
var crypto = __importStar(require("crypto"));
var path = __importStar(require("path"));
var electron_1 = require("electron");
var electron_store_1 = __importDefault(require("electron-store"));
var PIN_STORE_KEY = 'master_pin_credentials';
/** Cost for every record created from now on. */
var ITERATIONS = 600000;
/** Cost of records written before the per-record `iterations` field existed. */
var LEGACY_ITERATIONS = 100000;
var KEY_LEN = 32;
var DIGEST = 'sha256';
var MAX_ATTEMPTS = 5;
var LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes
/**
 * The PBKDF2 cost a record's hash verifies at. Absent, malformed, or
 * below-legacy claims resolve to the legacy cost and are never honoured
 * below it: a wrong value can only cause a mismatch (fail closed), never a
 * cheaper comparison than the legacy one.
 */
function resolveIterations(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= LEGACY_ITERATIONS) {
        return value;
    }
    return LEGACY_ITERATIONS;
}
// Lazy-require native keychain helper if available
var nativeKeychain = null;
try {
    nativeKeychain = require('./native-keychain');
}
catch (_) { }
var MasterPINService = /** @class */ (function () {
    function MasterPINService() {
        var baseDir;
        try {
            baseDir = (electron_1.app && typeof electron_1.app.getPath === 'function')
                ? electron_1.app.getPath('userData')
                : path.join('/tmp', 'aartiq-data');
        }
        catch (_) {
            baseDir = path.join('/tmp', 'aartiq-data');
        }
        this.store = new electron_store_1.default({ name: 'aartiq-master-pin', cwd: baseDir });
    }
    MasterPINService.getInstance = function () {
        if (!MasterPINService.instance) {
            MasterPINService.instance = new MasterPINService();
        }
        return MasterPINService.instance;
    };
    /**
     * Compute PBKDF2 hash using SHA-256 (matches Flutter mobile PBKDF2).
     * Defaults to the current target cost; pass an explicit cost only to
     * verify or re-create a record made at that cost.
     */
    MasterPINService.hashPin = function (pin, salt, iterations) {
        if (iterations === void 0) { iterations = ITERATIONS; }
        return crypto.pbkdf2Sync(pin, salt, iterations, KEY_LEN, DIGEST).toString('hex');
    };
    /**
     * Save Master PIN credentials securely to Native OS Keychain / safeStorage
     */
    MasterPINService.prototype._saveDataToNativeOS = function (data) {
        var rawJson = JSON.stringify(data);
        var backend = 'fallback-store';
        // 1. Electron safeStorage (Native OS Encrypted hardware-backed store: Keychain / DPAPI / libsecret)
        try {
            var electron = require('electron');
            var safeStorage = electron === null || electron === void 0 ? void 0 : electron.safeStorage;
            if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
                var encryptedBuffer = safeStorage.encryptString(rawJson);
                this.store.set(PIN_STORE_KEY + '_native_encrypted', encryptedBuffer.toString('base64'));
                backend = 'safeStorage-native-keychain';
            }
        }
        catch (e) {
            console.warn('[MasterPIN] safeStorage encryption note:', e);
        }
        // 2. Native OS Keychain via native-keychain module
        if (nativeKeychain && typeof nativeKeychain.addPassword === 'function') {
            try {
                nativeKeychain.addPassword({
                    service: 'master-pin',
                    account: 'master_pin_credentials',
                    password: rawJson,
                    label: 'Aartiq Master PIN (Native OS)',
                }).catch(function (err) { return console.warn('[MasterPIN] Native Keychain addPassword note:', err === null || err === void 0 ? void 0 : err.message); });
                backend = 'native-os-keychain';
            }
            catch (err) {
                console.warn('[MasterPIN] Native Keychain write note:', err === null || err === void 0 ? void 0 : err.message);
            }
        }
        data.nativeStorageBackend = backend;
        this.store.set(PIN_STORE_KEY, data);
        console.log("[MasterPIN] Master PIN credentials saved using native OS backend: ".concat(backend));
    };
    MasterPINService.prototype.hasPIN = function () {
        var data = this.getMasterPinData();
        return !!(data && data.salt && data.hash);
    };
    /**
     * Retrieve Master PIN credentials from Native OS Keychain first, then safeStorage, then store
     */
    MasterPINService.prototype.getMasterPinData = function () {
        // 1. Try reading directly from safeStorage native OS keychain
        try {
            var electron = require('electron');
            var safeStorage = electron === null || electron === void 0 ? void 0 : electron.safeStorage;
            var encryptedB64 = this.store.get(PIN_STORE_KEY + '_native_encrypted');
            if (encryptedB64 && safeStorage && typeof safeStorage.decryptString === 'function') {
                var decryptedStr = safeStorage.decryptString(Buffer.from(encryptedB64, 'base64'));
                if (decryptedStr) {
                    return JSON.parse(decryptedStr);
                }
            }
        }
        catch (_) { }
        // 2. Fallback to store
        var data = this.store.get(PIN_STORE_KEY);
        return data || null;
    };
    MasterPINService.prototype.setupPIN = function (pin) {
        if (!pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
            return { success: false, error: 'Master PIN must be exactly 6 numeric digits' };
        }
        var salt = crypto.randomBytes(16).toString('hex');
        var hash = MasterPINService.hashPin(pin, salt);
        var data = {
            salt: salt,
            hash: hash,
            iterations: ITERATIONS,
            createdAt: Date.now(),
            failedAttempts: 0,
        };
        this._saveDataToNativeOS(data);
        return { success: true };
    };
    MasterPINService.prototype.verifyPIN = function (pin) {
        var data = this.getMasterPinData();
        if (!data) {
            return { verified: false, error: 'Master PIN is not configured yet' };
        }
        var now = Date.now();
        if (data.lockedUntil && now < data.lockedUntil) {
            var minutesLeft = Math.ceil((data.lockedUntil - now) / 60000);
            return {
                verified: false,
                locked: true,
                error: "Too many failed attempts. Locked for ".concat(minutesLeft, " more minute(s)"),
            };
        }
        var storedIterations = resolveIterations(data.iterations);
        var expectedHash = MasterPINService.hashPin(pin, data.salt, storedIterations);
        var match = crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(data.hash, 'hex'));
        if (match) {
            data.failedAttempts = 0;
            data.lockedUntil = undefined;
            data.lastVerifiedAt = now;
            if (storedIterations < ITERATIONS) {
                // Lazy migration: the plaintext PIN is in hand only here, on a
                // proven match — re-hash records below the target cost now.
                // A wrong PIN never reaches this branch, so legacy records
                // keep verifying at their stored cost until they first prove
                // correct; nothing is ever rewritten from a failed attempt.
                data.hash = MasterPINService.hashPin(pin, data.salt, ITERATIONS);
                data.iterations = ITERATIONS;
            }
            this._saveDataToNativeOS(data);
            return { verified: true };
        }
        else {
            data.failedAttempts = (data.failedAttempts || 0) + 1;
            var remaining = Math.max(0, MAX_ATTEMPTS - data.failedAttempts);
            if (data.failedAttempts >= MAX_ATTEMPTS) {
                data.lockedUntil = now + LOCKOUT_MS;
                this._saveDataToNativeOS(data);
                return {
                    verified: false,
                    locked: true,
                    remainingAttempts: 0,
                    error: 'Account locked due to 5 failed PIN attempts. Try again in 10 minutes.',
                };
            }
            this._saveDataToNativeOS(data);
            return {
                verified: false,
                remainingAttempts: remaining,
                error: "Incorrect Master PIN. ".concat(remaining, " attempt(s) remaining."),
            };
        }
    };
    MasterPINService.prototype.changePIN = function (oldPin, newPin) {
        var verifyRes = this.verifyPIN(oldPin);
        if (!verifyRes.verified) {
            return { success: false, error: verifyRes.error || 'Current Master PIN is incorrect' };
        }
        return this.setupPIN(newPin);
    };
    /**
     * Get safe sync payload containing salt, hash and the PBKDF2 cost the
     * hash was derived at (NEVER plaintext PIN). The peer must verify at that
     * cost, not at whatever its own build defaults to. Used for initial
     * pairing between Aartiq desktop and mobile app.
     */
    MasterPINService.prototype.getSyncPayload = function () {
        var data = this.getMasterPinData();
        if (!data)
            return { hasPin: false };
        return {
            hasPin: true,
            salt: data.salt,
            hash: data.hash,
            iterations: resolveIterations(data.iterations),
        };
    };
    /**
     * Set Master PIN from trusted mobile device sync
     */
    MasterPINService.prototype.setFromSync = function (salt, hash, iterations) {
        if (!salt || !hash)
            return false;
        var data = {
            salt: salt,
            hash: hash,
            // Senders predating the field hashed at the legacy cost; any
            // claim below legacy is clamped up, so a bogus value fails
            // verification instead of cheapening it.
            iterations: resolveIterations(iterations),
            createdAt: Date.now(),
            failedAttempts: 0,
        };
        this._saveDataToNativeOS(data);
        console.log('[MasterPIN] Master PIN synced from mobile into Native OS');
        return true;
    };
    MasterPINService.instance = null;
    return MasterPINService;
}());
exports.MasterPINService = MasterPINService;
exports.masterPinService = MasterPINService.getInstance();
