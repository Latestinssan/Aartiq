const { exec } = require('child_process');
const path = require('path');
const os = require('os');

class NativeApprovalManager {
  constructor(mainWindow, options = {}) {
    this.mainWindow = mainWindow;
    this.options = options;
    this.permissionStore = options.permissionStore || null;
    this.biometricVerifier = options.biometricVerifier || null;
    this.platform = options.platform || os.platform();
    this._sessionBiometricPassed = false;
  }

  getBiometricFlags() {
    const settings = this.permissionStore ? this.permissionStore.getSettings() : this.options;
    return {
      requireBiometricPerSession: settings?.requireBiometricPerSession !== undefined ? !!settings.requireBiometricPerSession : false,
      requireBiometricEveryTime: !!settings?.requireBiometricEveryTime,
      requireDeviceUnlockForManualApproval: !!settings?.requireDeviceUnlockForManualApproval,
    };
  }

  isBiometricRequired(risk = 'medium', explicitFlag) {
    if (explicitFlag !== undefined) return !!explicitFlag;
    const flags = this.getBiometricFlags();
    if (flags.requireBiometricEveryTime) return true;
    if (flags.requireBiometricPerSession && !this._sessionBiometricPassed) return true;
    if (flags.requireDeviceUnlockForManualApproval && risk !== 'low') return true;
    return false;
  }

  resetSessionBiometric() {
    this._sessionBiometricPassed = false;
  }

  async verifyBiometric(toolName, args, risk = 'medium') {
    const reason = `Approve ${toolName} in Aartiq`;

    // Injected verifier for testing / custom providers
    if (this.biometricVerifier) {
      try {
        const res = await this.biometricVerifier.authenticate({
          toolName,
          args,
          risk,
          platform: this.platform,
          reason,
        });
        return {
          supported: res.supported !== false,
          approved: res.approved === true || res.success === true,
          method: res.method || 'mock-verifier',
          error: res.error || null,
        };
      } catch (err) {
        return {
          supported: true,
          approved: false,
          error: err.message,
        };
      }
    }

    if (this.platform === 'darwin') {
      try {
        const { verifyNativeDeviceAccess, hasNativeDeviceUnlockSupport } = require('../../lib/native-os-verifier');
        if (!hasNativeDeviceUnlockSupport()) {
          return {
            supported: false,
            approved: false,
            error: 'LocalAuthentication is not available on this Mac',
          };
        }
        const result = await verifyNativeDeviceAccess({
          reason: `Approve ${toolName} in Aartiq with Touch ID or Mac password.`,
          actionText: toolName,
          riskLevel: risk,
        });
        return {
          supported: result.supported !== false,
          approved: result.approved === true,
          method: result.mode || 'macos-local-authentication',
          error: result.error || null,
        };
      } catch (err) {
        return {
          supported: false,
          approved: false,
          error: err.message,
        };
      }
    }

    if (this.platform === 'win32') {
      try {
        const { verifyNativeDeviceAccess } = require('../../lib/native-os-verifier');
        const result = await verifyNativeDeviceAccess({
          reason: `Approve ${toolName} in Aartiq with Windows Hello.`,
          actionText: toolName,
          riskLevel: risk,
        });
        return {
          supported: result.supported !== false,
          approved: result.approved === true,
          method: result.mode || 'windows-hello',
          error: result.error || null,
        };
      } catch (err) {
        return {
          supported: false,
          approved: false,
          error: err.message,
        };
      }
    }

    if (this.platform === 'linux') {
      try {
        const { BiometricAuthManager } = require('../../service/biometric-auth');
        const mgr = new BiometricAuthManager();
        const result = await mgr.authenticate(reason);
        return {
          supported: result.method !== undefined && result.method !== 'none',
          approved: result.success === true,
          method: result.method || 'linux-polkit',
          error: result.error || null,
        };
      } catch (err) {
        return {
          supported: false,
          approved: false,
          error: err.message,
        };
      }
    }

    return {
      supported: false,
      approved: false,
      error: `Biometric authentication is not supported on platform: ${this.platform}`,
    };
  }

  async requestNativeApproval(toolName, args, risk = 'medium', requestId, options = {}) {
    const biometricRequired = this.isBiometricRequired(risk, options.requireBiometric);

    // Enforce real biometric verification when required
    if (biometricRequired) {
      const verifResult = await this.verifyBiometric(toolName, args, risk);

      // FAIL CLOSED: If the platform cannot provide biometric verification and flag is on
      if (!verifResult.supported) {
        return {
          approved: false,
          error: verifResult.error || 'Biometric verification required but unsupported on this platform',
          biometricEnforced: true,
          supported: false,
        };
      }

      // FAIL CLOSED: If biometric verification failed or was denied
      if (!verifResult.approved) {
        return {
          approved: false,
          error: verifResult.error || 'Biometric verification failed or was cancelled',
          biometricEnforced: true,
          supported: true,
        };
      }

      // Success
      this._sessionBiometricPassed = true;
      return {
        approved: true,
        biometricEnforced: true,
        method: verifResult.method,
      };
    }

    // Flag is OFF: show normal native dialog (with accurate labels, no misleading Touch ID claim)
    if (this.platform === 'darwin') {
      return this._macOSApproval(toolName, args, risk, requestId);
    } else if (this.platform === 'win32') {
      return this._windowsApproval(toolName, args, risk, requestId);
    } else {
      return this._linuxApproval(toolName, args, risk, requestId);
    }
  }

  _macOSApproval(toolName, args, risk, requestId) {
    return new Promise((resolve) => {
      const { dialog } = require('electron');

      const isHighRisk = risk === 'high';
      // Renamed to an accurate label ("Approve"); removed misleading "Approve with Touch ID"
      const buttons = ['Deny', 'Approve'];

      const type = isHighRisk ? 'warning' : 'question';
      const detail = typeof args === 'object' ? JSON.stringify(args, null, 2) : String(args || '');

      const message = isHighRisk
        ? 'Destructive command detected. This can permanently modify or destroy data.'
        : `Tool approval requested: ${toolName}`;

      dialog.showMessageBox(this.mainWindow, {
        type,
        title: 'Aartiq - Tool Approval',
        message,
        detail: `Tool: ${toolName}\n\nArguments:\n${detail.substring(0, 1000)}\n\nSource: Tool Execution via MCP`,
        buttons,
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }).then(({ response }) => {
        resolve({ approved: response === 1 });
      }).catch(() => {
        resolve({ approved: false });
      });
    });
  }

  _windowsApproval(toolName, args, risk, requestId) {
    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'native-approval-dialog.ps1');
      const argsStr = typeof args === 'object' ? JSON.stringify(args) : String(args || '');

      const psCommand = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -ToolName "${toolName.replace(/"/g, '""')}" -Risk "${risk}" -Args "${argsStr.replace(/"/g, '""').replace(/\n/g, ' ')}" -RequestId "${requestId}"`;

      exec(psCommand, { timeout: 120000 }, (error, stdout) => {
        if (error) {
          resolve({ approved: false });
          return;
        }
        try {
          const result = JSON.parse(stdout.trim());
          resolve({ approved: !!result.approved });
        } catch {
          resolve({ approved: false });
        }
      });
    });
  }

  _linuxApproval(toolName, args, risk, requestId) {
    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'native-approval-dialog.sh');
      const argsStr = typeof args === 'object' ? JSON.stringify(args) : String(args || '');

      const cmd = `bash "${scriptPath}" --tool "${toolName.replace(/"/g, '\\"')}" --risk "${risk}" --args "${argsStr.replace(/"/g, '\\"').replace(/\n/g, ' ')}" --request-id "${requestId}"`;

      exec(cmd, { timeout: 120000 }, (error, stdout) => {
        if (error) {
          resolve({ approved: false });
          return;
        }
        try {
          const lastLine = stdout.trim().split('\n').pop();
          const result = JSON.parse(lastLine);
          resolve({ approved: result.approved === true });
        } catch {
          resolve({ approved: false });
        }
      });
    });
  }
}

module.exports = { NativeApprovalManager };
