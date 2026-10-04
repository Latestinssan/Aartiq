/**
 * native-approval-biometrics.test.js
 *
 * Tests for Issue 4: "Approve with Touch ID" label correction & real biometric verification.
 * - Accurate dialog button labels (no misleading "Approve with Touch ID" when no biometric API is called)
 * - Biometric flag enforcement (requireBiometricEveryTime, requireBiometricPerSession)
 * - Flag ON and verification fails -> DENIED (fail closed)
 * - Flag ON and platform unsupported -> DENIED (fail closed)
 * - Flag OFF -> normal approval dialog without biometric gate
 * - Per-session biometric verification caching & reset
 */

const { NativeApprovalManager } = require('../src/main/handlers/native-approval-manager');

// Mock electron dialog
let mockMessageBoxResult = { response: 1 };
let lastMessageBoxOptions = null;

jest.mock('electron', () => ({
  dialog: {
    showMessageBox: jest.fn(async (win, options) => {
      lastMessageBoxOptions = options;
      return mockMessageBoxResult;
    }),
  },
}));

describe('Issue 4: Native Approval Manager & Biometric Verification', () => {
  beforeEach(() => {
    mockMessageBoxResult = { response: 1 };
    lastMessageBoxOptions = null;
  });

  describe('UI Accuracy: Button labels never falsely claim Touch ID in message boxes', () => {
    it('uses ["Deny", "Approve"] for macOS dialog instead of misleading "Approve with Touch ID"', async () => {
      const manager = new NativeApprovalManager(null, {
        platform: 'darwin',
        requireBiometricEveryTime: false,
        requireBiometricPerSession: false,
      });

      const result = await manager.requestNativeApproval('bash', { command: 'rm -rf /tmp/test' }, 'high', 'req-1');

      expect(lastMessageBoxOptions).toBeTruthy();
      // Button must NOT say "Approve with Touch ID"
      expect(lastMessageBoxOptions.buttons).toEqual(['Deny', 'Approve']);
      expect(lastMessageBoxOptions.buttons).not.toContain('Approve with Touch ID');
      expect(result.approved).toBe(true);
    });

    it('denies approval when user clicks Deny button in normal dialog', async () => {
      mockMessageBoxResult = { response: 0 }; // User clicks Deny
      const manager = new NativeApprovalManager(null, {
        platform: 'darwin',
        requireBiometricEveryTime: false,
        requireBiometricPerSession: false,
      });

      const result = await manager.requestNativeApproval('read_file', { path: '/tmp/test' }, 'low', 'req-2');
      expect(result.approved).toBe(false);
    });
  });

  describe('Flag enforcement: requireBiometric* with mocked biometric layer', () => {
    it('approves when biometric flag is ON and verification succeeds', async () => {
      const mockVerifier = {
        authenticate: jest.fn().mockResolvedValue({
          supported: true,
          approved: true,
          method: 'touch-id',
        }),
      };

      const manager = new NativeApprovalManager(null, {
        platform: 'darwin',
        requireBiometricEveryTime: true,
        biometricVerifier: mockVerifier,
      });

      const result = await manager.requestNativeApproval('execute_script', {}, 'high', 'req-3');

      expect(mockVerifier.authenticate).toHaveBeenCalled();
      expect(result.approved).toBe(true);
      expect(result.biometricEnforced).toBe(true);
      expect(result.method).toBe('touch-id');
      // Dialog should NOT have been shown because real native biometric API was used
      expect(lastMessageBoxOptions).toBeNull();
    });

    it('FAILS CLOSED (denied) when biometric flag is ON and verification fails or is cancelled', async () => {
      const mockVerifier = {
        authenticate: jest.fn().mockResolvedValue({
          supported: true,
          approved: false,
          error: 'User cancelled biometric prompt',
        }),
      };

      const manager = new NativeApprovalManager(null, {
        platform: 'darwin',
        requireBiometricEveryTime: true,
        biometricVerifier: mockVerifier,
      });

      const result = await manager.requestNativeApproval('delete_database', {}, 'high', 'req-4');

      expect(mockVerifier.authenticate).toHaveBeenCalled();
      expect(result.approved).toBe(false);
      expect(result.biometricEnforced).toBe(true);
      expect(result.error).toMatch(/cancelled|failed/i);
      expect(lastMessageBoxOptions).toBeNull();
    });

    it('FAILS CLOSED (denied) when biometric flag is ON and platform cannot provide biometrics', async () => {
      const mockVerifier = {
        authenticate: jest.fn().mockResolvedValue({
          supported: false,
          approved: false,
          error: 'Hardware biometric device not available',
        }),
      };

      const manager = new NativeApprovalManager(null, {
        platform: 'linux',
        requireBiometricEveryTime: true,
        biometricVerifier: mockVerifier,
      });

      const result = await manager.requestNativeApproval('power_off', {}, 'high', 'req-5');

      expect(mockVerifier.authenticate).toHaveBeenCalled();
      // MUST NOT fall back to silently approving or showing unauthenticated dialog
      expect(result.approved).toBe(false);
      expect(result.biometricEnforced).toBe(true);
      expect(result.supported).toBe(false);
      expect(lastMessageBoxOptions).toBeNull();
    });

    it('FAILS CLOSED on an unsupported platform without a verifier', async () => {
      const manager = new NativeApprovalManager(null, {
        platform: 'freebsd', // unsupported OS
        requireBiometricEveryTime: true,
      });

      const result = await manager.requestNativeApproval('shell', {}, 'high', 'req-6');

      expect(result.approved).toBe(false);
      expect(result.error).toMatch(/not supported/i);
    });
  });

  describe('Session caching: requireBiometricPerSession', () => {
    it('requires biometric verification on first call, caches success for the session', async () => {
      let callCount = 0;
      const mockVerifier = {
        authenticate: jest.fn().mockImplementation(async () => {
          callCount++;
          return { supported: true, approved: true, method: 'windows-hello' };
        }),
      };

      const manager = new NativeApprovalManager(null, {
        platform: 'darwin',
        requireBiometricPerSession: true,
        requireBiometricEveryTime: false,
        biometricVerifier: mockVerifier,
      });

      // First call requires biometric
      const firstResult = await manager.requestNativeApproval('tool-1', {}, 'medium', 'req-7');
      expect(firstResult.approved).toBe(true);
      expect(firstResult.biometricEnforced).toBe(true);
      expect(callCount).toBe(1);

      // Second call in same session does not re-invoke biometric prompt
      // Falls back to normal prompt/dialog
      const secondResult = await manager.requestNativeApproval('tool-2', {}, 'medium', 'req-8');
      expect(secondResult.approved).toBe(true);
      expect(callCount).toBe(1); // not called again

      // Resetting session requires biometric verification again
      manager.resetSessionBiometric();
      const thirdResult = await manager.requestNativeApproval('tool-3', {}, 'medium', 'req-9');
      expect(thirdResult.approved).toBe(true);
      expect(callCount).toBe(2); // re-invoked
    });
  });
});
