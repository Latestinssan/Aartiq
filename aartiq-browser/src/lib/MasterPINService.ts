import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import Store from 'electron-store';

export interface MasterPinData {
    salt: string;
    hash: string;
    createdAt: number;
    lastVerifiedAt?: number;
    failedAttempts: number;
    lockedUntil?: number;
    nativeStorageBackend?: string;
}

export interface PinVerifyResult {
    verified: boolean;
    locked?: boolean;
    remainingAttempts?: number;
    error?: string;
}

const PIN_STORE_KEY = 'master_pin_credentials';
const ITERATIONS = 100000;
const KEY_LEN = 32;
const DIGEST = 'sha256';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes

// Lazy-require native keychain helper if available
let nativeKeychain: any = null;
try {
    nativeKeychain = require('./native-keychain');
} catch (_) {}

export class MasterPINService {
    private static instance: MasterPINService | null = null;
    private store: Store;

    private constructor() {
        let baseDir: string;
        try {
            baseDir = (app && typeof app.getPath === 'function')
                ? app.getPath('userData')
                : path.join('/tmp', 'aartiq-data');
        } catch (_) {
            baseDir = path.join('/tmp', 'aartiq-data');
        }
        this.store = new Store({ name: 'aartiq-master-pin', cwd: baseDir });
    }

    public static getInstance(): MasterPINService {
        if (!MasterPINService.instance) {
            MasterPINService.instance = new MasterPINService();
        }
        return MasterPINService.instance;
    }

    /**
     * Compute PBKDF2 hash using SHA-256 (matches Flutter mobile PBKDF2)
     */
    public static hashPin(pin: string, salt: string): string {
        return crypto.pbkdf2Sync(pin, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex');
    }

    /**
     * Save Master PIN credentials securely to Native OS Keychain / safeStorage
     */
    private _saveDataToNativeOS(data: MasterPinData): void {
        const rawJson = JSON.stringify(data);
        let backend = 'fallback-store';

        // 1. Electron safeStorage (Native OS Encrypted hardware-backed store: Keychain / DPAPI / libsecret)
        try {
            const electron = require('electron');
            const safeStorage = electron?.safeStorage;
            if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
                const encryptedBuffer = safeStorage.encryptString(rawJson);
                this.store.set(PIN_STORE_KEY + '_native_encrypted', encryptedBuffer.toString('base64'));
                backend = 'safeStorage-native-keychain';
            }
        } catch (e) {
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
                }).catch((err: any) => console.warn('[MasterPIN] Native Keychain addPassword note:', err?.message));
                backend = 'native-os-keychain';
            } catch (err: any) {
                console.warn('[MasterPIN] Native Keychain write note:', err?.message);
            }
        }

        data.nativeStorageBackend = backend;
        this.store.set(PIN_STORE_KEY, data);
        console.log(`[MasterPIN] Master PIN credentials saved using native OS backend: ${backend}`);
    }

    public hasPIN(): boolean {
        const data = this.getMasterPinData();
        return !!(data && data.salt && data.hash);
    }

    /**
     * Retrieve Master PIN credentials from Native OS Keychain first, then safeStorage, then store
     */
    public getMasterPinData(): MasterPinData | null {
        // 1. Try reading directly from safeStorage native OS keychain
        try {
            const electron = require('electron');
            const safeStorage = electron?.safeStorage;
            const encryptedB64 = this.store.get(PIN_STORE_KEY + '_native_encrypted') as string | undefined;
            if (encryptedB64 && safeStorage && typeof safeStorage.decryptString === 'function') {
                const decryptedStr = safeStorage.decryptString(Buffer.from(encryptedB64, 'base64'));
                if (decryptedStr) {
                    return JSON.parse(decryptedStr) as MasterPinData;
                }
            }
        } catch (_) {}

        // 2. Fallback to store
        const data = this.store.get(PIN_STORE_KEY) as MasterPinData | undefined;
        return data || null;
    }

    public setupPIN(pin: string): { success: boolean; error?: string } {
        if (!pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
            return { success: false, error: 'Master PIN must be exactly 6 numeric digits' };
        }

        const salt = crypto.randomBytes(16).toString('hex');
        const hash = MasterPINService.hashPin(pin, salt);

        const data: MasterPinData = {
            salt,
            hash,
            createdAt: Date.now(),
            failedAttempts: 0,
        };

        this._saveDataToNativeOS(data);
        return { success: true };
    }

    public verifyPIN(pin: string): PinVerifyResult {
        const data = this.getMasterPinData();
        if (!data) {
            return { verified: false, error: 'Master PIN is not configured yet' };
        }

        const now = Date.now();
        if (data.lockedUntil && now < data.lockedUntil) {
            const minutesLeft = Math.ceil((data.lockedUntil - now) / 60000);
            return {
                verified: false,
                locked: true,
                error: `Too many failed attempts. Locked for ${minutesLeft} more minute(s)`,
            };
        }

        const expectedHash = MasterPINService.hashPin(pin, data.salt);
        const match = crypto.timingSafeEqual(
            Buffer.from(expectedHash, 'hex'),
            Buffer.from(data.hash, 'hex')
        );

        if (match) {
            data.failedAttempts = 0;
            data.lockedUntil = undefined;
            data.lastVerifiedAt = now;
            this._saveDataToNativeOS(data);
            return { verified: true };
        } else {
            data.failedAttempts = (data.failedAttempts || 0) + 1;
            const remaining = Math.max(0, MAX_ATTEMPTS - data.failedAttempts);

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
                error: `Incorrect Master PIN. ${remaining} attempt(s) remaining.`,
            };
        }
    }

    public changePIN(oldPin: string, newPin: string): { success: boolean; error?: string } {
        const verifyRes = this.verifyPIN(oldPin);
        if (!verifyRes.verified) {
            return { success: false, error: verifyRes.error || 'Current Master PIN is incorrect' };
        }

        return this.setupPIN(newPin);
    }

    /**
     * Get safe sync payload containing salt and hash (NEVER plaintext PIN).
     * Used for initial pairing between Aartiq desktop and mobile app.
     */
    public getSyncPayload(): { hasPin: boolean; salt?: string; hash?: string } {
        const data = this.getMasterPinData();
        if (!data) return { hasPin: false };
        return {
            hasPin: true,
            salt: data.salt,
            hash: data.hash,
        };
    }

    /**
     * Set Master PIN from trusted mobile device sync
     */
    public setFromSync(salt: string, hash: string): boolean {
        if (!salt || !hash) return false;
        const data: MasterPinData = {
            salt,
            hash,
            createdAt: Date.now(),
            failedAttempts: 0,
        };
        this._saveDataToNativeOS(data);
        console.log('[MasterPIN] Master PIN synced from mobile into Native OS');
        return true;
    }
}

export const masterPinService = MasterPINService.getInstance();
