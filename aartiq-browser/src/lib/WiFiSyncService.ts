import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import * as os from 'os';
import * as dgram from 'dgram';
import { clipboard } from 'electron';
import { randomInt, randomBytes } from 'crypto';
import Store from 'electron-store';
import { DeviceIdentifier } from './DeviceIdentifier';
// Late-require to avoid circular deps at module load time
let _permissionRelayService: any = null;
let _unifiedSessionManager: any = null;
function getPermissionRelayService() {
    if (!_permissionRelayService) {
        try { _permissionRelayService = require('./PermissionRelayService').permissionRelayService; } catch(_) {}
    }
    return _permissionRelayService;
}
function getUnifiedSessionManager() {
    if (!_unifiedSessionManager) {
        try { _unifiedSessionManager = require('./UnifiedSessionManager').unifiedSessionManager; } catch(_) {}
    }
    return _unifiedSessionManager;
}

type TrustLevel = 'trusted' | 'ask_once' | 'blocked';

export interface KnownSyncDevice {
    deviceId: string;
    deviceName: string;
    deviceType: 'mobile' | 'desktop';
    deviceModel?: string;
    deviceImage?: string;
    ip: string;
    port: number;
    platform?: string;
    trustLevel: TrustLevel;
    permanentToken?: string;
    autoConnect: boolean;
    online: boolean;
    lastConnected?: number;
    lastSeen?: number;
}

export class WiFiSyncService extends EventEmitter {
    private port: number;
    private wss: WebSocketServer | null = null;
    private discoverySocket: dgram.Socket | null = null;
    private discoveryInterval: any = null;
    private clients: Set<WebSocket> = new Set();
    private deviceId: string;
    private deviceName: string;
    private pairingCode: string;
    private _lastReceivedClipboard = '';
    private clientSockets: Map<string, WebSocket> = new Map();
    private socketDeviceIds: WeakMap<WebSocket, string> = new WeakMap();
    private store = new Store({ name: 'comet-wifi-sync' });
    private knownDevices = new Map<string, KnownSyncDevice>();
    private readonly knownDevicesKey = 'knownWifiSyncDevices';

    constructor(port: number = 3004) {
        super();
        this.port = port;
        const meta = DeviceIdentifier.getDeviceMetadata();
        this.deviceId = meta.deviceId;
        this.deviceName = meta.deviceName; // Real friendly device name (e.g. "Sandip's MacBook Pro")
        // The pairing code must survive desktop restarts: a fresh random code
        // per process made the code shown in the UI (or read from a saved
        // device) invalid after every relaunch → "Invalid pairing code" on
        // reconnect for a device that had already been paired.
        const savedCode = this.store.get('pairingCode');
        if (typeof savedCode === 'string' && /^\d{6}$/.test(savedCode)) {
            this.pairingCode = savedCode;
        } else {
            this.pairingCode = String(100000 + randomInt(900000));
            this.store.set('pairingCode', this.pairingCode);
        }
        this._loadKnownDevices();
    }

    /**
     * The device id format used before DeviceIdentifier existed
     * (`desktop-<hostname:8>`). Phones that paired against an older build
     * keyed their stored permanent token by it, so it must keep working.
     */
    public getLegacyDeviceId(): string {
        return `desktop-${os.hostname().substring(0, 8)}`;
    }

    public setDeviceId(deviceId: string, deviceName: string): void {
        this.deviceId = deviceId;
        this.deviceName = deviceName;
    }

    public getDeviceId(): string {
        return this.deviceId;
    }

    public getDeviceName(): string {
        return this.deviceName;
    }

    public start(): boolean {
        try {
            this.wss = new WebSocketServer({ port: this.port });
            console.log(`[WiFi-Sync] Server started on port ${this.port}`);

            this.wss.on('connection', (ws: WebSocket) => {
                console.log('[WiFi-Sync] Mobile client connected');
                this.clients.add(ws);

                ws.on('message', (message: any) => {
                    this._handleMessage(ws, message);
                });

                ws.on('close', () => {
                    console.log('[WiFi-Sync] Mobile client disconnected');
                    this.clients.delete(ws);
                    this._handleSocketClose(ws);
                });

                ws.on('error', (err) => {
                    console.error('[WiFi-Sync] WebSocket error:', err);
                });
            });

            this._startDiscovery();
            return true;
        } catch (e) {
            console.error('[WiFi-Sync] Failed to start server:', e);
            return false;
        }
    }

    private _loadKnownDevices(): void {
        const saved = this.store.get(this.knownDevicesKey);
        if (!Array.isArray(saved)) return;

        for (const entry of saved) {
            if (!entry || typeof entry !== 'object' || !entry.deviceId) continue;
            const normalized = this._normalizeKnownDevice(entry as Partial<KnownSyncDevice> & { deviceId: string });
            normalized.online = false;
            this.knownDevices.set(normalized.deviceId, normalized);
        }
    }

    private _persistKnownDevices(): void {
        this.store.set(this.knownDevicesKey, Array.from(this.knownDevices.values()));
        this.emit('devices-updated', this.getKnownDevices());
    }

    private _normalizeKnownDevice(device: Partial<KnownSyncDevice> & { deviceId: string }): KnownSyncDevice {
        return {
            deviceId: device.deviceId,
            deviceName: device.deviceName || 'Unknown Mobile',
            deviceType: device.deviceType || 'mobile',
            deviceModel: device.deviceModel || (device.platform === 'android' ? 'Android Device' : device.platform === 'ios' ? 'iPhone' : undefined),
            deviceImage: device.deviceImage || (device.platform === 'ios' ? 'iphone' : 'android-phone'),
            ip: device.ip || '',
            port: device.port || this.port,
            platform: device.platform || 'unknown',
            trustLevel: device.trustLevel || 'ask_once',
            permanentToken: device.permanentToken,
            autoConnect: device.autoConnect ?? (device.trustLevel === 'trusted' || !!device.permanentToken),
            online: device.online ?? false,
            lastConnected: device.lastConnected,
            lastSeen: device.lastSeen,
        };
    }

    private _upsertKnownDevice(device: Partial<KnownSyncDevice> & { deviceId: string }): KnownSyncDevice {
        const existing = this.knownDevices.get(device.deviceId);
        const merged = this._normalizeKnownDevice({
            ...(existing || {}),
            ...device,
        } as Partial<KnownSyncDevice> & { deviceId: string });

        this.knownDevices.set(merged.deviceId, merged);
        this._persistKnownDevices();
        return merged;
    }

    private _getSocketIp(ws: WebSocket): string {
        const remoteAddress = (ws as any)?._socket?.remoteAddress as string | undefined;
        return remoteAddress?.replace(/^::ffff:/, '') || '';
    }

    private _handleSocketClose(ws: WebSocket): void {
        const deviceId = this.socketDeviceIds.get(ws);
        if (!deviceId) return;

        this.clientSockets.delete(deviceId);
        this.socketDeviceIds.delete(ws);

        const device = this.knownDevices.get(deviceId);
        if (device) {
            this._upsertKnownDevice({
                ...device,
                online: false,
                lastSeen: Date.now(),
            });
        }

        this.emit('client-disconnected', {
            deviceId,
            connected: this.clientSockets.size > 0,
            devices: this.getKnownDevices(),
        });
    }

    private _startDiscovery() {
        try {
            this.discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

            const discoveryPort = 3005;
            const meta = DeviceIdentifier.getDeviceMetadata();
            const beacon = () => JSON.stringify({
                type: 'aartiq-beacon',
                deviceId: this.deviceId,
                deviceName: this.deviceName,
                model: meta.model,
                deviceImage: meta.deviceImage,
                ip: this.getLocalIp(),
                port: this.port,
            });

            this.discoveryInterval = setInterval(() => {
                if (!this.discoverySocket) return;
                const message = Buffer.from(beacon());
                this.discoverySocket.send(message, discoveryPort, '255.255.255.255', (err) => {
                    if (err) console.error('[WiFi-Sync] Discovery send failed:', err);
                });
            }, 3000);

            this.discoverySocket.bind(0, () => {
                if (this.discoverySocket) {
                    this.discoverySocket.setBroadcast(true);
                    console.log('[WiFi-Sync] Discovery beacon started');
                }
            });
        } catch (e) {
            console.error('[WiFi-Sync] Failed to start discovery:', e);
        }
    }

    private _handleMessage(ws: WebSocket, data: any) {
        try {
            const msg = JSON.parse(data.toString());
            console.log(`[WiFi-Sync] Received: ${msg.type}`);

            switch (msg.type) {
                case 'handshake': {
                    const deviceId = `${msg.deviceId || `mobile-${Date.now()}`}`;
                    // Devices that paired before the id migration present a
                    // new id (the phone's secure-storage id) while the desktop
                    // trusted their legacy id. Fall back to the legacy id so an
                    // already-paired phone is still recognized as trusted.
                    const legacyId = typeof msg.legacyDeviceId === 'string' && msg.legacyDeviceId && msg.legacyDeviceId !== deviceId
                        ? msg.legacyDeviceId
                        : null;
                    const knownDevice = this.knownDevices.get(deviceId) || (legacyId ? this.knownDevices.get(legacyId) : undefined) || undefined;
                    const permanentTokenMatches = !!(msg.permanentToken && knownDevice?.permanentToken && msg.permanentToken === knownDevice.permanentToken);
                    const isTrusted = knownDevice?.trustLevel === 'trusted';
                    const pairingAccepted = typeof msg.pairingCode === 'string' && msg.pairingCode === this.pairingCode;

                    console.log('[WiFi-Sync] Handshake received from:', deviceId, 'permanentMatch=', permanentTokenMatches, 'trusted=', isTrusted);

                    if (permanentTokenMatches || isTrusted || pairingAccepted) {
                        const permanentToken = knownDevice?.permanentToken || randomBytes(32).toString('hex');
                        const device = this._upsertKnownDevice({
                            deviceId,
                            deviceName: msg.deviceName || knownDevice?.deviceName || 'Aartiq Mobile',
                            deviceType: msg.deviceType || 'mobile',
                            deviceModel: msg.deviceModel || knownDevice?.deviceModel,
                            deviceImage: msg.deviceImage || knownDevice?.deviceImage || (msg.platform === 'ios' ? 'iphone' : 'android-phone'),
                            ip: this._getSocketIp(ws),
                            port: Number(msg.port) || knownDevice?.port || this.port,
                            platform: msg.platform || knownDevice?.platform || 'mobile',
                            trustLevel: 'trusted',
                            permanentToken: permanentToken,
                            autoConnect: true,
                            online: true,
                            lastConnected: Date.now(),
                            lastSeen: Date.now(),
                        });

                        // Migrate the legacy record into the new id so future
                        // lookups resolve directly (the merged trust/token above
                        // already carries over).
                        if (legacyId && legacyId !== deviceId && this.knownDevices.has(legacyId)) {
                            this.knownDevices.delete(legacyId);
                            this._persistKnownDevices();
                        }

                        this.clientSockets.set(deviceId, ws);
                        this.socketDeviceIds.set(ws, deviceId);

                        const meta = DeviceIdentifier.getDeviceMetadata();
                        ws.send(JSON.stringify({
                            type: 'handshake-ack',
                            deviceId: this.deviceId,
                            legacyDeviceId: this.getLegacyDeviceId(),
                            deviceName: this.deviceName,
                            hostname: os.hostname(),
                            platform: os.platform(),
                            model: meta.model,
                            deviceImage: meta.deviceImage,
                            authenticated: true,
                            trusted: true,
                            autoConnect: true,
                            permanentToken: permanentToken,
                            permanentSync: true,
                        }));

                        console.log('[WiFi-Sync] Client permanently authenticated successfully');
                        this.emit('client-connected', {
                            deviceId,
                            connected: this.clientSockets.size > 0,
                            devices: this.getKnownDevices(),
                        });
                        // Push current session snapshot to newly connected mobile
                        setTimeout(() => this.sendSessionSnapshot(), 500);
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            code: 'AUTH_FAILED',
                            message: 'Invalid pairing code',
                        }));
                        console.log('[WiFi-Sync] Client authentication failed');
                    }
                    break;
                }

                case 'execute-command':
                    this._handleCommand(ws, msg);
                    break;

                case 'desktop-control':
                    this._handleDesktopControl(ws, msg);
                    break;

                case 'clipboard-sync':
                    if (msg.text && msg.text !== this._lastReceivedClipboard) {
                        this._lastReceivedClipboard = msg.text;
                        clipboard.writeText(msg.text);
                        this.emit('clipboard-received', msg.text);
                    }
                    break;

                case 'clipboard-sync-request': {
                    const currentClipboard = clipboard.readText();
                    ws.send(JSON.stringify({
                        type: 'clipboard-sync',
                        text: currentClipboard,
                    }));
                    break;
                }

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                // ── Permission relay response from mobile ──────────────────
                case 'permission-relay-response': {
                    const relay = getPermissionRelayService();
                    if (relay && msg.payload) {
                        const response = {
                            ...msg.payload,
                            respondedByDeviceId: this.socketDeviceIds.get(ws) || 'unknown-mobile',
                        };
                        const handled = relay.handleApprovalResponse(response);
                        ws.send(JSON.stringify({
                            type: 'permission-relay-ack',
                            requestId: msg.payload?.requestId,
                            received: handled,
                        }));
                    }
                    break;
                }

                // ── Mobile requests current + past sessions ────────────────
                case 'session-sync-request': {
                    const usm = getUnifiedSessionManager();
                    if (usm) {
                        const payload = usm.getSyncPayload();
                        ws.send(JSON.stringify({
                            type: 'session-sync-response',
                            currentSession: payload.currentSession,
                            pastSessions: payload.pastSessions,
                            timestamp: Date.now(),
                        }));
                    }
                    break;
                }

                // ── Mobile requests Master PIN sync payload (salt + hash) ──
                case 'pin-sync-request': {
                    try {
                        const pinSvc = require('./MasterPINService').masterPinService;
                        const pinPayload = pinSvc.getSyncPayload();
                        ws.send(JSON.stringify({
                            type: 'pin-sync-response',
                            ...pinPayload,
                        }));
                    } catch (e) {
                        ws.send(JSON.stringify({ type: 'pin-sync-response', hasPin: false }));
                    }
                    break;
                }

                // ── Mobile syncs an imported session back ──────────────────
                case 'session-import': {
                    const usm2 = getUnifiedSessionManager();
                    if (usm2 && msg.session) {
                        usm2.importSession(msg.session);
                        ws.send(JSON.stringify({ type: 'session-import-ack', success: true, id: msg.session.id }));
                    }
                    break;
                }
            }
        } catch (e) {
            console.error('[WiFi-Sync] Error parsing message:', e);
        }
    }

    private async _handleCommand(ws: WebSocket, msg: any) {
        const { commandId, command, args } = msg;

        this.emit('command', {
            commandId,
            command,
            args,
            sendResponse: (responseBody: any) => {
                ws.send(JSON.stringify({
                    type: 'command-response',
                    commandId,
                    ...responseBody,
                }));
            },
        });
    }

    public sendToMobile(message: any) {
        this.broadcast({
            type: 'desktop-to-mobile',
            ...message,
            timestamp: Date.now(),
        });
    }

    public sendAIResponse(promptId: string, response: string, isStreaming?: boolean) {
        this.broadcast({
            type: 'ai-stream-response',
            promptId,
            response,
            isStreaming: isStreaming ?? false,
            timestamp: Date.now(),
        });
    }

    public sendDesktopStatus(status: { screenOn?: boolean; activeApp?: string; tabs?: number }) {
        this.broadcast({
            type: 'desktop-status',
            ...status,
            timestamp: Date.now(),
        });
    }

    public sendDesktopControl(action: string, args?: Record<string, any>) {
        this.broadcast({
            type: 'desktop-control',
            action,
            args: args || {},
            timestamp: Date.now(),
        });
    }

    /**
     * Send a permission relay request (HIGH/CRITICAL automation approval) to mobile.
     * Replaces/extends the QR-based shell-approval-qr mechanism for rich, plan-aware approvals.
     */
    public sendPermissionRequest(request: any) {
        this.broadcast({
            type: 'permission-relay-request',
            payload: request,
            timestamp: Date.now(),
        });
        console.log(`[WiFi-Sync] Sent permission-relay-request to mobile: ${request.requestId} (risk=${request.riskLevel})`);
    }

    /**
     * Push a session delta (tabs, history, or task update) to mobile in real time.
     */
    public sendSessionDelta(deltaType: 'tabs' | 'history' | 'task' | 'permission', data: any) {
        this.broadcast({
            type: 'session-delta',
            deltaType,
            data,
            timestamp: Date.now(),
        });
    }

    /**
     * Push full session snapshot to mobile on demand (called on initial connect or explicit refresh).
     */
    public sendSessionSnapshot() {
        try {
            const usm = getUnifiedSessionManager();
            if (usm) {
                const payload = usm.getSyncPayload();
                this.broadcast({
                    type: 'session-sync-response',
                    currentSession: payload.currentSession,
                    pastSessions: payload.pastSessions,
                    timestamp: Date.now(),
                });
                console.log(`[WiFi-Sync] Sent session snapshot to mobile, sessionId=${payload.currentSession.id}`);
            }
        } catch (e) {
            console.error('[WiFi-Sync] Failed to send session snapshot:', e);
        }
    }

    public sendFileToMobile(filename: string, fileBuffer: Buffer, mimeType: string, metadata?: Record<string, any>) {
        const base64Data = fileBuffer.toString('base64');
        this.broadcast({
            type: 'file-transfer',
            filename,
            mimeType,
            data: base64Data,
            size: fileBuffer.length,
            ...metadata,
            timestamp: Date.now(),
        });
        console.log(`[WiFi-Sync] Sent file to mobile: ${filename} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);
    }

    private async _handleDesktopControl(ws: WebSocket, msg: any) {
        const { commandId, action, prompt, promptId, args } = msg;
        console.log(`[WiFi-Sync] Desktop Control: action=${action}`);

        this.emit('command', {
            commandId,
            command: 'desktop-control',
            args: { action, prompt, promptId, ...args },
            sendResponse: (responseBody: any) => {
                ws.send(JSON.stringify({
                    type: 'desktop-control-response',
                    commandId,
                    action,
                    ...responseBody,
                }));
            },
        });
    }

    public getLocalIp(): string {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            const ifaceEntry = interfaces[name];
            if (!ifaceEntry) continue;
            for (const iface of ifaceEntry) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return '127.0.0.1';
    }

    public getConnectUri(): string {
        return `aartiq://connect?ip=${this.getLocalIp()}&port=${this.port}&device=${this.deviceId}`;
    }

    public getCloudConnectUri(cloudDeviceId: string): string {
        return `aartiq://cloud-connect?cloudId=${cloudDeviceId}&device=${this.deviceId}&name=${encodeURIComponent(this.deviceName)}`;
    }

    public stop() {
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
            this.discoveryInterval = null;
        }
        if (this.discoverySocket) {
            this.discoverySocket.close();
            this.discoverySocket = null;
        }
    }

    public getPairingCode(): string {
        return this.pairingCode;
    }

    public broadcast(message: any) {
        const data = JSON.stringify(message);
        const recipients = this.clientSockets.size > 0
            ? Array.from(this.clientSockets.values())
            : Array.from(this.clients.values());

        recipients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        });
    }

    public broadcastClipboard(text: string): void {
        this.broadcast({
            type: 'clipboard-sync',
            text,
            timestamp: Date.now(),
        });
    }

    public async connectToDevice(deviceId: string): Promise<boolean> {
        console.log('[WiFi-Sync] Attempting to connect to device via cloud relay:', deviceId);
        return false;
    }

    public disconnectFromDevice(deviceId: string): void {
        const socket = this.clientSockets.get(deviceId);
        if (socket) {
            socket.close();
            this.clientSockets.delete(deviceId);
        }
    }

    public getConnectedClients(): string[] {
        return Array.from(this.clientSockets.keys());
    }

    public getKnownDevices(): KnownSyncDevice[] {
        return Array.from(this.knownDevices.values()).sort(
            (a, b) => (b.lastSeen || b.lastConnected || 0) - (a.lastSeen || a.lastConnected || 0),
        );
    }

    public setDeviceTrust(deviceId: string, trustLevel: TrustLevel, autoConnect?: boolean): KnownSyncDevice | null {
        const existing = this.knownDevices.get(deviceId);
        if (!existing) return null;

        const updated = this._upsertKnownDevice({
            ...existing,
            trustLevel,
            autoConnect: autoConnect ?? trustLevel === 'trusted',
            lastSeen: Date.now(),
        });

        const socket = this.clientSockets.get(deviceId);
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'device-trust-updated',
                deviceId,
                deviceName: updated.deviceName,
                trustLevel: updated.trustLevel,
                autoConnect: updated.autoConnect,
                timestamp: Date.now(),
            }));
        }

        return updated;
    }

    public removeKnownDevice(deviceId: string): boolean {
        const socket = this.clientSockets.get(deviceId);
        if (socket) {
            socket.close();
        }
        this.clientSockets.delete(deviceId);
        const deleted = this.knownDevices.delete(deviceId);
        if (deleted) {
            this._persistKnownDevices();
        }
        return deleted;
    }
}

let wifiSyncInstance: WiFiSyncService | null = null;
export function getWiFiSync(port?: number): WiFiSyncService {
    if (!wifiSyncInstance) {
        wifiSyncInstance = new WiFiSyncService(port);
    }
    return wifiSyncInstance;
}
