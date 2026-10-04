const { ipcMain } = require('electron');
const QRCode = require('qrcode');
const os = require('os');

module.exports = function registerSyncHandlers(ipcMain, handlers) {
  const { store, wifiSyncService, cloudSyncService, p2pSyncService, mainWindow } = handlers;

  // Resolve the target window LIVE at send time. handlerDeps captures the
  // startup window by value, so after that window is closed the captured
  // reference is a destroyed BrowserWindow: `if (mainWindow)` still passes
  // (the object is non-null) and `webContents.send` throws
  // "Object has been destroyed". Every throw is counted by the main
  // process uncaughtException guard, which force-quits after 5 — that is
  // what disconnected mobile clients after the control window closed, and
  // it also silently swallowed AI prompts (send-prompt reported success
  // while the renderer never received 'remote-ai-prompt').
  const liveWindow = () => {
    const win = (typeof handlers.getMainWindow === 'function' && handlers.getMainWindow()) || mainWindow;
    return win && !win.isDestroyed() ? win : null;
  };

  ipcMain.handle('get-wifi-sync-uri', () => {
    return wifiSyncService ? wifiSyncService.getConnectUri() : null;
  });

  ipcMain.handle('wifi-sync-broadcast', async (event, message) => {
    if (!wifiSyncService) return { success: false, error: 'WiFi Sync not initialized' };
    wifiSyncService.broadcast(message);
    return { success: true };
  });

  ipcMain.handle('get-wifi-sync-qr', async (event, cloudMode = false) => {
    if (!wifiSyncService) return null;
    let uri;
    if (cloudMode && cloudSyncService && cloudSyncService.isConnected()) {
      uri = wifiSyncService.getCloudConnectUri(cloudSyncService.getDeviceId() || 'unknown');
    } else {
      uri = wifiSyncService.getConnectUri();
    }
    try { return await QRCode.toDataURL(uri); }
    catch (err) { return null; }
  });

  ipcMain.handle('get-wifi-sync-info', () => {
    if (!wifiSyncService) return null;
    return {
      deviceName: os.hostname(),
      pairingCode: wifiSyncService.getPairingCode(),
      ip: wifiSyncService.getLocalIp(),
      port: 3004
    };
  });

  ipcMain.handle('generate-high-risk-qr', async (event, actionId) => {
    const deviceId = os.hostname();
    const { randomBytes } = require('crypto');
    const token = actionId || randomBytes(5).toString('hex');
    const pin = String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
    const deepLinkUrl = `aartiq://approve?id=${token}&deviceId=${encodeURIComponent(deviceId)}&pin=${pin}`;
    try { return JSON.stringify({ qrImage: await QRCode.toDataURL(deepLinkUrl), pin, token }); }
    catch (err) { return null; }
  });

  ipcMain.handle('login-to-cloud', async (event, email, password) => {
    if (!cloudSyncService) return { success: false, error: 'Cloud sync not initialized' };
    try { await cloudSyncService.login(email, password); return { success: true }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('logout-from-cloud', async () => {
    if (!cloudSyncService) return;
    await cloudSyncService.logout();
  });

  ipcMain.handle('save-cloud-config', async (event, provider, config) => {
    if (!cloudSyncService) return { success: false };
    try { await cloudSyncService.configure({ provider, ...config }); return { success: true }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('get-cloud-devices', async () => {
    if (!cloudSyncService) return [];
    return cloudSyncService.getDevices();
  });

  ipcMain.handle('connect-to-cloud-device', async (event, deviceId) => {
    if (!cloudSyncService) return { success: false };
    try { const success = await cloudSyncService.connectToDevice(deviceId); return { success }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('disconnect-from-cloud-device', async (event, deviceId) => {
    if (!cloudSyncService) return;
    cloudSyncService.disconnectFromDevice(deviceId);
  });

  ipcMain.handle('sync-clipboard', async (event, text) => {
    if (!cloudSyncService) return;
    await cloudSyncService.syncClipboard(text);
  });

  ipcMain.handle('sync-history', async (event, history) => {
    if (!cloudSyncService) return;
    await cloudSyncService.syncHistory(history);
  });

  ipcMain.handle('send-desktop-control', async (event, targetDeviceId, action, args) => {
    if (!cloudSyncService) return { error: 'Cloud sync not initialized' };
    return await cloudSyncService.sendDesktopControl(targetDeviceId, action, args);
  });

  ipcMain.handle('connect-to-remote-device', async (event, remoteDeviceId) => {
    if (!p2pSyncService) return false;
    return await p2pSyncService.connectToRemoteDevice(remoteDeviceId);
  });

  ipcMain.handle('p2p-sync-history', async (event, data) => {
    if (p2pSyncService && p2pSyncService.getStatus().connected) {
      p2pSyncService.sendMessage({ type: 'history-sync', data });
      return { success: true };
    }
    return { success: false, error: 'Not connected to peer' };
  });

  ipcMain.handle('p2p-get-device-id', async () => {
    return p2pSyncService ? p2pSyncService.getStatus().deviceId : null;
  });

  ipcMain.on('send-p2p-signal', (event, { signal, remoteDeviceId }) => {
    if (!p2pSyncService) return;
    p2pSyncService.sendSignal(signal, remoteDeviceId);
  });

  ipcMain.handle('forward-ai-stream', (event, { promptId, response, isStreaming, fromDeviceId, mode }) => {
    if (mode === 'cloud' && cloudSyncService && fromDeviceId) {
      cloudSyncService.sendAIResponse(fromDeviceId, promptId, response, isStreaming);
    } else if (wifiSyncService) {
      wifiSyncService.sendAIResponse(promptId, response, isStreaming);
    }
    return { success: true };
  });

  ipcMain.on('wifi-sync-set-last-clipboard', (event, text) => {
    if (wifiSyncService) wifiSyncService._lastReceivedClipboard = text;
  });

  ipcMain.handle('get-active-sync-devices', () => {
    return wifiSyncService ? wifiSyncService.getConnectedDevices() : [];
  });

  ipcMain.handle('sync-remove-device', (event, deviceId) => {
    if (wifiSyncService) {
      if (typeof wifiSyncService.unpairDevice === 'function') {
        wifiSyncService.unpairDevice(deviceId);
      } else if (typeof wifiSyncService.removeKnownDevice === 'function') {
        wifiSyncService.removeKnownDevice(deviceId);
      }
    }
    return { success: true };
  });

  ipcMain.handle('unpair-wifi-sync-device', (event, deviceId) => {
    if (wifiSyncService) {
      if (typeof wifiSyncService.unpairDevice === 'function') {
        return { success: wifiSyncService.unpairDevice(deviceId) };
      }
      return { success: wifiSyncService.removeKnownDevice(deviceId) };
    }
    return { success: false };
  });

  // Flutter Bridge Handlers
  ipcMain.handle('bridge-get-pairing-code', async () => {
    if (!handlers.flutterBridge) return { success: false, error: 'Bridge not initialized' };
    return { success: true, code: handlers.flutterBridge.getPairingCode() };
  });

  ipcMain.handle('bridge-get-status', async () => {
    return {
      running: !!handlers.flutterBridge?.server,
      connectedDevices: handlers.flutterBridge?.getConnectedCount() || 0,
    };
  });

  ipcMain.handle('bridge-rotate-secret', async () => {
    if (!handlers.flutterBridge) return { success: false, error: 'Bridge not initialized' };
    handlers.flutterBridge.rotateSecret();
    return { success: true, code: handlers.flutterBridge.getPairingCode() };
  });

  ipcMain.handle('bridge-broadcast', async (event, message) => {
    if (!handlers.flutterBridge) return { success: false, error: 'Bridge not initialized' };
    handlers.flutterBridge.broadcast(message);
    return { success: true };
  });

  // WiFi Sync Event Listeners
  if (wifiSyncService) {
    wifiSyncService.on('command', async (data) => {
      const { command, args, sendResponse } = data;

      if (command === 'approve-high-risk') {
        const win = liveWindow();
        if (win) {
          win.webContents.send('mobile-approve-high-risk', {
            pin: args.pin,
            id: args.id || args.token,
          });
        }
        sendResponse({ success: true });
        return;
      }

      if (command === 'desktop-control') {
        const { action, prompt, promptId, ...restArgs } = args || {};
        const { generateShellApprovalQR } = handlers;
        const { capabilityController } = handlers;
        const actionArgs = restArgs;

        if (action === 'send-prompt') {
          const win = liveWindow();
          if (!win) {
            // Fail honestly: reporting success here left the phone waiting
            // forever for AI stream chunks that could never arrive.
            sendResponse({
              success: false,
              error: 'Aartiq desktop window is closed. Open the desktop app window to run AI prompts.',
            });
            return;
          }
          win.webContents.send('remote-ai-prompt', { prompt, promptId, streamToMobile: true });
          sendResponse({ success: true, promptId });
        } else if (action === 'get-status') {
          sendResponse({ success: true, desktopName: os.hostname(), platform: os.platform() });
        } else if (action === 'shell-command') {
          // ====================================================================
          // SECURITY FIX (audit-doc §3e): Remote shell execution from WiFi Sync.
          //
          // Previously this was: exec(actionArgs.command || args.command, …)
          // with zero validation — a paired mobile device could run arbitrary
          // shell commands on the desktop.
          //
          // Now:
          //   1. Validate via SecurityValidator (dangerous patterns, blocked list)
          //   2. Classify risk and escalate to 'high' (remote origin = elevated risk)
          //   3. Route through capability controller (ticket-based approval)
          //   4. Require QR/PIN approval (same flow as shutdown/restart/sleep/lock)
          //   5. Execute via execFile (no shell interpretation)
          //
          // The remote origin bumps risk by one tier: medium→high, high→critical.
          // Critical-risk commands are never auto-approved.
          // ====================================================================
          const { validateCommand, analyzeCommandRisk } = require('../../core/command-validator');
          const { validateCommand: securityValidate } = require('../../lib/SecurityValidator');

          const shellCmd = actionArgs.command || args.command;
          if (!shellCmd) {
            sendResponse({ success: false, error: 'No command provided' });
            return;
          }

          // 1. Validate command (dangerous patterns, blocked list)
          try {
            validateCommand(shellCmd);
          } catch (e) {
            sendResponse({ success: false, error: `Command validation failed: ${e.message}` });
            return;
          }

          // 2. Classify risk and escalate for remote origin
          let riskLevel = analyzeCommandRisk(shellCmd);
          // Remote origin always elevates risk
          if (riskLevel === 'low') riskLevel = 'medium';
          else if (riskLevel === 'medium') riskLevel = 'high';
          else riskLevel = 'critical'; // already high → critical

          const ticketId = actionArgs.ticketId || args.ticketId || actionArgs.token || args.token;
          const pin = actionArgs.pin || args.pin;

          // 3. If no ticket / PIN provided, request approval via capabilityController (origin: remote)
          if (!ticketId || !pin) {
            if (capabilityController) {
              const capResult = await capabilityController.executeAction('execute-shell-command', {
                rawCommand: shellCmd,
                command: shellCmd,
                origin: 'remote',
                riskLevel,
                reason: `Remote shell command from paired mobile device`,
                waitForApproval: false,
              });

              if (capResult.needsApproval && capResult.ticketId) {
                // 4. Require QR/PIN approval (dual-gate mobile approval flow)
                const { randomBytes } = require('crypto');
                const generatedPin = String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
                const ticket = capabilityController.ticketManager?.tickets?.get(capResult.ticketId);
                if (ticket) {
                  ticket.metadata = { ...(ticket.metadata || {}), pin: generatedPin, command: shellCmd };
                }

                const qrResult = await generateShellApprovalQR(shellCmd, capResult.ticketId, generatedPin);
                wifiSyncService.sendToMobile({
                  action: 'shell-approval-qr',
                  commandId: capResult.ticketId,
                  ticketId: capResult.ticketId,
                  pin: generatedPin,
                  command: shellCmd,
                  qrData: qrResult ? qrResult.qrImage : null,
                });
                sendResponse({ success: true, awaiting_approval: true, ticketId: capResult.ticketId });
                return;
              }
              sendResponse({ success: false, error: capResult.reason || 'Shell command denied by capability controller.' });
              return;
            }
            sendResponse({ success: false, error: 'Approval required: capability controller not available.' });
            return;
          }

          // 4. Ticket and PIN provided — verify ticket exists, matches command, and PIN is valid
          if (!capabilityController || !capabilityController.ticketManager) {
            sendResponse({ success: false, error: 'Capability controller ticket manager unavailable.' });
            return;
          }

          const ticket = capabilityController.ticketManager.tickets.get(ticketId);
          if (!ticket) {
            sendResponse({ success: false, error: 'Invalid or expired ticket.' });
            return;
          }

          if (ticket.action !== 'execute-shell-command') {
            sendResponse({ success: false, error: 'Ticket action mismatch.' });
            return;
          }

          const ticketCmd = ticket.params?.rawCommand || ticket.params?.command;
          if (ticketCmd !== shellCmd) {
            sendResponse({ success: false, error: 'Ticket parameter mismatch: command differs from approval.' });
            return;
          }

          if (!ticket.metadata?.pin || String(ticket.metadata.pin) !== String(pin)) {
            sendResponse({ success: false, error: 'Invalid PIN for approval ticket.' });
            return;
          }

          // 5. Approve and Redeem single-use ticket (input-hash verification)
          const approveRes = capabilityController.ticketManager.approveTicket(ticketId, 'mobile-qr-pin');
          if (!approveRes.success) {
            sendResponse({ success: false, error: `Ticket approval failed: ${approveRes.reason}` });
            return;
          }

          const redeemRes = capabilityController.ticketManager.redeemTicket(ticketId);
          if (!redeemRes.success) {
            sendResponse({ success: false, error: `Ticket redemption failed: ${redeemRes.reason}` });
            return;
          }

          // 6. Execute — sandboxed with direct execFile fallback
          const { executeSandboxed } = require('../../core/sandbox-executor');
          const { execFile: execFileFn } = require('child_process');
          const cmdParts = shellCmd.trim().split(/\s+/);
          const cmdBinary = cmdParts[0];
          const cmdArgs = cmdParts.slice(1);

          try {
            const result = await executeSandboxed(cmdBinary, cmdArgs, { timeout: 30000 });
            if (result && result.code === 0) {
              sendResponse({ success: true, output: result.stdout || result.stderr || '' });
            } else if (result && result.code !== undefined) {
              sendResponse({ success: false, error: result.stderr || result.error || `Command exited with code ${result.code}` });
            } else {
              execFileFn(cmdBinary, cmdArgs, { timeout: 30000 }, (err, stdout, stderr) => {
                sendResponse(err
                  ? { success: false, error: err.message }
                  : { success: true, output: stdout || stderr });
              });
            }
          } catch (e) {
            execFileFn(cmdBinary, cmdArgs, { timeout: 30000 }, (err, stdout, stderr) => {
              sendResponse(err
                ? { success: false, error: err.message }
                : { success: true, output: stdout || stderr });
            });
          }
        } else if (action === 'high-risk-approve') {
          const win = liveWindow();
          if (win) {
            win.webContents.send('mobile-approve-high-risk', {
              pin: actionArgs.pin || args.pin,
              id: actionArgs.id || actionArgs.token || args.id || args.token,
            });
          }
          sendResponse({ success: true });
        } else if (action === 'get-clipboard') {
          const { clipboard } = require('electron');
          sendResponse({ success: true, clipboard: clipboard.readText() });
        } else if (action === 'update-setting') {
          const { key, value } = actionArgs;
          if (key === 'theme') { require('electron').nativeTheme.themeSource = value; }
          else { const keyMap = { 'llm_provider': 'ai_provider', 'llm_model': 'gemini_model' }; store.set(keyMap[key] || key, value); }
          sendResponse({ success: true });
        } else if (action === 'shutdown' || action === 'restart' || action === 'sleep' || action === 'lock') {
          const powerAction = action;
          const descriptions = { shutdown: 'Shutdown', restart: 'Restart', sleep: 'Sleep', lock: 'Lock' };
          const { qrImage, pin, token } = await generateShellApprovalQR(descriptions[powerAction] || powerAction);
          wifiSyncService.sendToMobile({ action: 'power-approval-qr', commandId: token, pin, powerAction, qrData: qrImage });
          sendResponse({ success: true, awaiting_approval: true });
        } else {
          sendResponse({ success: false, error: `Unknown action: ${action}` });
        }
        return;
      }
    });

    wifiSyncService.on('client-connected', () => { const w = liveWindow(); if (w) w.webContents.send('wifi-sync-status', { connected: true }); });
    wifiSyncService.on('client-disconnected', () => { const w = liveWindow(); if (w) w.webContents.send('wifi-sync-status', { connected: false }); });
    wifiSyncService.on('new-device-paired', (info) => {
      const w = liveWindow();
      if (w) w.webContents.send('wifi-sync-new-device', info);
      try {
        const { Notification } = require('electron');
        if (Notification && Notification.isSupported()) {
          new Notification({
            title: 'New Device Paired',
            body: `${info.deviceName || 'A mobile device'} (${info.ip || 'local network'}) was paired with Aartiq.`,
          }).show();
        }
      } catch (_) {}
    });
    wifiSyncService.on('network-location-changed', (info) => {
      const w = liveWindow();
      if (w) w.webContents.send('wifi-sync-location-change', info);
      try {
        const { Notification } = require('electron');
        if (Notification && Notification.isSupported()) {
          new Notification({
            title: 'Paired Device IP Changed',
            body: `${info.deviceName || 'Paired device'} reconnected from a new address: ${info.newIp || 'unknown'}.`,
          }).show();
        }
      } catch (_) {}
    });
    wifiSyncService.on('device-unpaired', ({ deviceId }) => {
      const w = liveWindow();
      if (w) w.webContents.send('wifi-sync-device-unpaired', { deviceId });
    });
  }

  // Cloud Sync Event Listeners
  if (cloudSyncService) {
    cloudSyncService.on('cloud-prompt', async ({ prompt, promptId, fromDeviceId }) => {
      const win = liveWindow();
      if (win) {
        win.webContents.send('remote-ai-prompt', { prompt, promptId, fromDeviceId, streamToMobile: true });
      }
    });

    cloudSyncService.on('cloud-file-sync', ({ files, fromDeviceId }) => {
      const w = liveWindow();
      if (w) w.webContents.send('cloud-files-received', { files, fromDeviceId });
    });

    cloudSyncService.on('cloud-message', (data) => {
      const win = liveWindow();
      if (data?.action === 'high-risk-approve' && win) {
        win.webContents.send('mobile-approve-high-risk', {
          pin: data.args?.pin,
          id: data.args?.id || data.args?.token,
        });
      }
    });
  }

  console.log('[Handlers] Sync handlers registered');
};