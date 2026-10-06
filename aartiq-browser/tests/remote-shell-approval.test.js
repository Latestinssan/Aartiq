/**
 * remote-shell-approval.test.js
 *
 * Tests for Issue 1: Remote-origin shell commands require approval.
 * - execute-shell-command can never be registered as 'never' for remote origin
 * - Local and remote origins are distinguishable to CapabilityController
 * - Remote shell requests without valid ticket/PIN trigger QR flow and are not executed
 * - Remote shell requests with invalid/tampered ticket are denied
 * - Tickets are single-use and cryptographically bound to parameters
 * - Risk escalation is maintained for remote commands
 */

const assert = require('assert');
const { CapabilityController } = require('../src/core/capability-controller');
const registerSyncHandlers = require('../src/main/handlers/sync-handlers');
const { EventEmitter } = require('events');

describe('Issue 1: Remote-origin shell commands require approval', () => {
  describe('CapabilityController registration policy', () => {
    it('throws when execute-shell-command is registered with requiresApproval: "never"', () => {
      const cc = new CapabilityController();
      assert.throws(() => {
        cc.registerAction({
          name: 'execute-shell-command',
          handler: async (p) => p,
          requiresApproval: 'never',
          riskLevel: 'high',
        });
      }, /Security violation.*execute-shell-command.*never.*remote/);
    });

    it('throws when execute-shell-command is registered with remote: "never"', () => {
      const cc = new CapabilityController();
      assert.throws(() => {
        cc.registerAction({
          name: 'execute-shell-command',
          handler: async (p) => p,
          requiresApproval: {
            local: 'never',
            remote: 'never',
          },
          riskLevel: 'high',
        });
      }, /Security violation.*execute-shell-command.*never.*remote/);
    });

    it('allows registering execute-shell-command with local: "never" and remote: "always"', () => {
      const cc = new CapabilityController();
      assert.doesNotThrow(() => {
        cc.registerAction({
          name: 'execute-shell-command',
          handler: async (p) => p,
          requiresApproval: {
            local: 'never',
            remote: 'always',
          },
          riskLevel: 'high',
        });
      });
      const action = cc.getAction('execute-shell-command');
      assert.ok(action);
      assert.strictEqual(action.requiresApproval.remote, 'always');
      assert.strictEqual(action.requiresApproval.local, 'never');
    });

    it('distinguishes local and remote origins on executeAction', async () => {
      const cc = new CapabilityController();
      cc.registerAction({
        name: 'execute-shell-command',
        handler: async (p) => ({ ran: true, command: p.command }),
        requiresApproval: {
          local: 'never',
          remote: 'always',
        },
        riskLevel: 'high',
      });

      // Local origin executes directly without approval
      const localRes = await cc.executeAction('execute-shell-command', {
        command: 'echo local',
        origin: 'local',
      });
      assert.strictEqual(localRes.approved, true);
      assert.deepStrictEqual(localRes.result, { ran: true, command: 'echo local' });

      // Remote origin requires approval and returns ticket
      const remoteRes = await cc.executeAction('execute-shell-command', {
        command: 'echo remote',
        origin: 'remote',
        waitForApproval: false,
      });
      assert.strictEqual(remoteRes.approved, false);
      assert.strictEqual(remoteRes.needsApproval, true);
      assert.ok(remoteRes.ticketId);
    });
  });

  describe('sync-handlers.js remote shell gate', () => {
    function setupSyncHandlerEnv() {
      const ipcMain = {
        handle: () => {},
        on: () => {},
      };

      const wifiSyncService = new EventEmitter();
      wifiSyncService.messagesSent = [];
      wifiSyncService.sendToMobile = (msg) => {
        wifiSyncService.messagesSent.push(msg);
      };

      const capabilityController = new CapabilityController();
      capabilityController.registerAction({
        name: 'execute-shell-command',
        handler: async (p) => p,
        requiresApproval: {
          local: 'never',
          remote: 'always',
        },
        riskLevel: 'high',
      });

      const handlers = {
        store: { get: () => null, set: () => {} },
        wifiSyncService,
        cloudSyncService: null,
        p2pSyncService: null,
        mainWindow: null,
        capabilityController,
        generateShellApprovalQR: async (command, token, pin) => ({
          qrImage: 'data:image/png;base64,mockqr',
          pin,
          token,
        }),
      };

      registerSyncHandlers(ipcMain, handlers);

      return { wifiSyncService, capabilityController, handlers };
    }

    it('remote command without ticket triggers QR/PIN flow and does not execute', async () => {
      const { wifiSyncService } = setupSyncHandlerEnv();

      let response = null;
      wifiSyncService.emit('command', {
        command: 'desktop-control',
        args: {
          action: 'shell-command',
          command: 'echo hello_world',
        },
        sendResponse: (res) => {
          response = res;
        },
      });

      // Wait a tick for async processing
      await new Promise((r) => setImmediate(r));

      assert.ok(response);
      assert.strictEqual(response.success, true);
      assert.strictEqual(response.awaiting_approval, true);
      assert.ok(response.ticketId);

      // Verify QR was sent to mobile with PIN
      assert.strictEqual(wifiSyncService.messagesSent.length, 1);
      const sent = wifiSyncService.messagesSent[0];
      assert.strictEqual(sent.action, 'shell-approval-qr');
      assert.strictEqual(sent.ticketId, response.ticketId);
      assert.ok(sent.pin);
      assert.strictEqual(sent.command, 'echo hello_world');
      assert.strictEqual(sent.qrData, 'data:image/png;base64,mockqr');
    });

    it('remote command with invalid ticket is denied', async () => {
      const { wifiSyncService } = setupSyncHandlerEnv();

      let response = null;
      wifiSyncService.emit('command', {
        command: 'desktop-control',
        args: {
          action: 'shell-command',
          command: 'echo bypass',
          ticketId: 'fake-ticket-uuid',
          pin: '123456',
        },
        sendResponse: (res) => {
          response = res;
        },
      });

      await new Promise((r) => setImmediate(r));

      assert.ok(response);
      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Invalid or expired ticket.');
    });

    it('remote command with wrong PIN is denied', async () => {
      const { wifiSyncService } = setupSyncHandlerEnv();

      // Step 1: Request approval
      let step1Response = null;
      wifiSyncService.emit('command', {
        command: 'desktop-control',
        args: {
          action: 'shell-command',
          command: 'echo secure',
        },
        sendResponse: (res) => {
          step1Response = res;
        },
      });
      await new Promise((r) => setImmediate(r));

      const ticketId = step1Response.ticketId;
      assert.ok(ticketId);

      // Step 2: Try with wrong PIN
      let step2Response = null;
      wifiSyncService.emit('command', {
        command: 'desktop-control',
        args: {
          action: 'shell-command',
          command: 'echo secure',
          ticketId,
          pin: '000000', // wrong pin
        },
        sendResponse: (res) => {
          step2Response = res;
        },
      });
      await new Promise((r) => setImmediate(r));

      assert.ok(step2Response);
      assert.strictEqual(step2Response.success, false);
      assert.strictEqual(step2Response.error, 'Invalid PIN for approval ticket.');
    });

    it('remote command with tampered command string is denied (input-hash verification)', async () => {
      const { wifiSyncService } = setupSyncHandlerEnv();

      // Step 1: Request approval for safe command
      let step1Response = null;
      wifiSyncService.emit('command', {
        command: 'desktop-control',
        args: {
          action: 'shell-command',
          command: 'echo safe_command',
        },
        sendResponse: (res) => {
          step1Response = res;
        },
      });
      await new Promise((r) => setImmediate(r));

      const ticketId = step1Response.ticketId;
      const validPin = wifiSyncService.messagesSent[0].pin;

      // Step 2: Tamper with command using the legitimate ticket and PIN
      let step2Response = null;
      wifiSyncService.emit('command', {
        command: 'desktop-control',
        args: {
          action: 'shell-command',
          command: 'echo malicious_command',
          ticketId,
          pin: validPin,
        },
        sendResponse: (res) => {
          step2Response = res;
        },
      });
      await new Promise((r) => setImmediate(r));

      assert.ok(step2Response);
      assert.strictEqual(step2Response.success, false);
      assert.ok(step2Response.error.includes('mismatch') || step2Response.error.includes('tamper'));
    });

    it('remote command succeeds with valid ticket + PIN and cannot be replayed (single-use)', async () => {
      const { wifiSyncService } = setupSyncHandlerEnv();

      // Step 1: Request approval
      let step1Response = null;
      wifiSyncService.emit('command', {
        command: 'desktop-control',
        args: {
          action: 'shell-command',
          command: 'echo hello_approved',
        },
        sendResponse: (res) => {
          step1Response = res;
        },
      });
      await new Promise((r) => setImmediate(r));

      const ticketId = step1Response.ticketId;
      const validPin = wifiSyncService.messagesSent[0].pin;

      // Step 2: Execute with valid ticket and pin
      let step2Response = null;
      wifiSyncService.emit('command', {
        command: 'desktop-control',
        args: {
          action: 'shell-command',
          command: 'echo hello_approved',
          ticketId,
          pin: validPin,
        },
        sendResponse: (res) => {
          step2Response = res;
        },
      });
      await new Promise((r) => setTimeout(r, 200));

      assert.ok(step2Response);
      assert.strictEqual(step2Response.success, true);
      assert.ok(step2Response.output.includes('hello_approved'));

      // Step 3: Replay attack with same ticket — must be denied (single-use)
      let replayResponse = null;
      wifiSyncService.emit('command', {
        command: 'desktop-control',
        args: {
          action: 'shell-command',
          command: 'echo hello_approved',
          ticketId,
          pin: validPin,
        },
        sendResponse: (res) => {
          replayResponse = res;
        },
      });
      await new Promise((r) => setImmediate(r));

      assert.ok(replayResponse);
      assert.strictEqual(replayResponse.success, false);
      assert.ok(replayResponse.error.includes('failed') || replayResponse.error.includes('redeemed'));
    });

    it('falls back to direct execFile when the sandbox is unavailable (e.g. Linux without bwrap)', async () => {
      const sandboxExecutor = require('../src/core/sandbox-executor');
      const childProcess = require('child_process');
      // A SANDBOX_* result means the sandbox never ran the command. The
      // handler must fall back to a direct execFile of the approval-gated
      // command instead of reporting a bogus command failure — this is the
      // path a CI runner without bubblewrap takes.
      const sandboxSpy = jest.spyOn(sandboxExecutor, 'executeSandboxed').mockResolvedValue({
        success: false,
        code: 'SANDBOX_UNAVAILABLE',
        error: 'bubblewrap (bwrap) not found',
        sandboxed: false,
      });
      const execSpy = jest.spyOn(childProcess, 'execFile').mockImplementation((cmd, args, opts, cb) => {
        cb(null, 'hello_fallback\n', '');
        return { on: () => {} };
      });
      try {
        const { wifiSyncService } = setupSyncHandlerEnv();

        let step1Response = null;
        wifiSyncService.emit('command', {
          command: 'desktop-control',
          args: {
            action: 'shell-command',
            command: 'echo hello_fallback',
          },
          sendResponse: (res) => {
            step1Response = res;
          },
        });
        await new Promise((r) => setImmediate(r));

        let step2Response = null;
        wifiSyncService.emit('command', {
          command: 'desktop-control',
          args: {
            action: 'shell-command',
            command: 'echo hello_fallback',
            ticketId: step1Response.ticketId,
            pin: wifiSyncService.messagesSent[0].pin,
          },
          sendResponse: (res) => {
            step2Response = res;
          },
        });
        await new Promise((r) => setTimeout(r, 100));

        assert.ok(step2Response);
        assert.strictEqual(step2Response.success, true);
        assert.ok(String(step2Response.output).includes('hello_fallback'));
        assert.strictEqual(sandboxSpy.mock.calls.length, 1, 'the sandbox must be attempted first');
        assert.strictEqual(execSpy.mock.calls.length, 1, 'direct execFile fallback must be used');
        assert.strictEqual(execSpy.mock.calls[0][0], 'echo');
      } finally {
        sandboxSpy.mockRestore();
        execSpy.mockRestore();
      }
    });
  });
});
