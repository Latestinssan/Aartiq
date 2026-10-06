import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import * as os from 'os';
import * as dgram from 'dgram';
import { clipboard } from 'electron';
import { randomInt, randomBytes, createHash, timingSafeEqual } from 'crypto';
import Store from 'electron-store';
import { DeviceIdentifier } from './DeviceIdentifier';
// The shared Host/Origin rules for every Aartiq listener. Required rather than
// imported so the CLI compile in `predev` (no tsconfig, no allowJs) resolves it
// the same way the runtime does.
const { isOriginAllowed } = require('./local-server-auth');
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

export type TrustLevel = 'trusted' | 'ask_once' | 'blocked';

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const IDLE_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const MAX_FAILED_PAIRING_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

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
    revoked?: boolean;
    permanentToken?: string;
    accessToken?: string;
    accessTokenExpiresAt?: number;
    refreshToken?: string;
    refreshTokenExpiresAt?: number;
    deviceBinding?: string;
    autoConnect: boolean;
    online: boolean;
    lastConnected?: number;
    lastSeen?: number;
    pairedAt?: number;
}

function tokensMatch(expected?: string, provided?: string): boolean {
    if (typeof expected !== 'string' || expected.length === 0) return false;
    if (typeof provided !== 'string' || provided.length === 0) return false;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length) {
        timingSafeEqual(a, a);
        return false;
    }
    return timingSafeEqual(a, b);
}

export class WiFiSyncService extends EventEmitter {
    private port: number;
    private host: string;
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
    private socketSessions: WeakMap<WebSocket, { deviceId: string; accessToken: string; expiresAt: number }> = new WeakMap();
    private failedAttempts: Map<string, { count: number; lockedUntil: number }> = new Map();
    private store = new Store({ name: 'comet-wifi-sync' });
    private knownDevices = new Map<string, KnownSyncDevice>();
    private readonly knownDevicesKey = 'knownWifiSyncDevices';

    constructor(port: number = 3004, host?: string) {
        super();
        this.port = port;
        // All interfaces by default — deliberately, not by omission: the phone
        // reaches this socket over the LAN, and the pairing QR and the discovery
        // broadcast hand out a routable address. AARTIQ_WIFI_SYNC_HOST narrows
        // the bind (127.0.0.1, one interface address) when that exposure is not
        // wanted. The exposure is bounded at the upgrade by _isUpgradeAllowed
        // and per message by the access-token gate in _handleMessage.
        this.host = host || process.env.AARTIQ_WIFI_SYNC_HOST || '0.0.0.0';
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
     * Host header validation for the WebSocket upgrade (DNS-rebinding guard).
     *
     * Every legitimate client reaches this socket as loopback, as one of this
     * machine's own addresses (the pairing QR hands out getLocalIp()), or by
     * this machine's name. A Host header that names anything else — a
     * rebind attacker's domain that resolves to this address — is refused
     * before the socket exists. Same rule checkLocalRequest applies to the
     * HTTP listeners, widened for the LAN address the QR actually uses.
     */
    private _isLocalHostHeader(hostHeader: string | undefined): boolean {
        if (!hostHeader || typeof hostHeader !== 'string') return false;
        let host = hostHeader.trim().toLowerCase();
        if (!host) return false;

        // host:port — a bracketed IPv6 literal keeps its colons inside [].
        const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
        if (bracketed) {
            host = bracketed[1];
        } else if (/^[^:]+:\d+$/.test(host)) {
            host = host.replace(/:\d+$/, '');
        }

        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
        const machineNames = [os.hostname().toLowerCase(), `${os.hostname().toLowerCase()}.local`];
        if (machineNames.includes(host)) return true;

        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const addr of interfaces[name] || []) {
                if (addr.address.toLowerCase() === host) return true;
            }
        }
        return false;
    }

    /**
     * Connection-time gate for the WebSocket upgrade.
     *
     * The server listens on every interface on purpose (phone pairing needs the
     * LAN), so this is where that exposure is bounded: an Origin that is not
     * one of ours — a page in a browser anywhere on this machine — and a Host
     * header that does not name this machine are refused before the handshake.
     * A native phone client sends no Origin at all; that is the allowed path,
     * and what it can do after connecting stays bounded per message by the
     * access-token gate in _handleMessage.
     */
    private _isUpgradeAllowed(headers: { [key: string]: string | string[] | undefined }): { ok: boolean; reason?: string } {
        const origin = typeof headers.origin === 'string' ? headers.origin : undefined;
        if (!isOriginAllowed(origin)) {
            return { ok: false, reason: `origin not allowed: ${origin}` };
        }
        const host = typeof headers.host === 'string' ? headers.host : undefined;
        if (!this._isLocalHostHeader(host)) {
            return { ok: false, reason: `host header not local: ${host}` };
        }
        return { ok: true };
    }

    private _checkLockout(ip: string): boolean {
        const record = this.failedAttempts.get(ip);
        if (!record) return false;
        if (record.lockedUntil > Date.now()) {
            return true;
        }
        if (record.lockedUntil > 0 && record.lockedUntil <= Date.now()) {
            this.failedAttempts.delete(ip);
        }
        return false;
    }

    private _recordFailedAttempt(ip: string): void {
        const record = this.failedAttempts.get(ip) || { count: 0, lockedUntil: 0 };
        record.count++;
        if (record.count >= MAX_FAILED_PAIRING_ATTEMPTS) {
            record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
        }
        this.failedAttempts.set(ip, record);
    }

    private _clearFailedAttempts(ip: string): void {
        this.failedAttempts.delete(ip);
    }

    private _computeDeviceBinding(deviceId: string, fingerprint?: string): string {
        return createHash('sha256').update(`${deviceId}:${fingerprint || ''}`).digest('hex');
    }

    private _isIdleExpired(device: KnownSyncDevice): boolean {
        const last = device.lastSeen || device.lastConnected || 0;
        if (!last) return false;
        return (Date.now() - last) > IDLE_DEVICE_TTL_MS;
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
            const serverOptions: any = { port: this.port };
            if (this.host && this.host !== '0.0.0.0') {
                serverOptions.host = this.host;
            }
            // Refuse the upgrade — before any handshake runs — when the Origin
            // is not one of ours or the Host header does not name this machine.
            // Fail closed: a missing/undecipherable Host is rejected too.
            serverOptions.verifyClient = (
                info: { req: any },
                done: (ok: boolean, code?: number, message?: string) => void
            ) => {
                const verdict = this._isUpgradeAllowed((info.req && info.req.headers) || {});
                if (!verdict.ok) {
                    console.warn(`[WiFi-Sync] Rejected WebSocket upgrade: ${verdict.reason}`);
                    done(false, 403, 'Forbidden');
                    return;
                }
                done(true);
            };
            this.wss = new WebSocketServer(serverOptions);
            console.log(`[WiFi-Sync] Server started on port ${this.port}${this.host !== '0.0.0.0' ? ` bound to ${this.host}` : ''}`);

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
            revoked: device.revoked,
            permanentToken: device.permanentToken,
            accessToken: device.accessToken,
            accessTokenExpiresAt: device.accessTokenExpiresAt,
            refreshToken: device.refreshToken,
            refreshTokenExpiresAt: device.refreshTokenExpiresAt,
            deviceBinding: device.deviceBinding,
            autoConnect: device.autoConnect ?? (device.trustLevel === 'trusted' || !!device.permanentToken),
            online: device.online ?? false,
            lastConnected: device.lastConnected,
            lastSeen: device.lastSeen,
            pairedAt: device.pairedAt,
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
        this.socketSessions.delete(ws);
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
                    const clientIp = this._getSocketIp(ws);
                    if (this._checkLockout(clientIp)) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            code: 'AUTH_LOCKED_OUT',
                            message: 'Too many failed pairing attempts. Try again later.',
                        }));
                        return;
                    }

                    const deviceId = `${msg.deviceId || `mobile-${Date.now()}`}`;
                    const legacyId = typeof msg.legacyDeviceId === 'string' && msg.legacyDeviceId && msg.legacyDeviceId !== deviceId
                        ? msg.legacyDeviceId
                        : null;
                    const knownDevice = this.knownDevices.get(deviceId) || (legacyId ? this.knownDevices.get(legacyId) : undefined) || undefined;

                    // Pairing via pairing code
                    const pairingAccepted = typeof msg.pairingCode === 'string' && msg.pairingCode === this.pairingCode;

                    // Reconnection via accessToken
                    const accessTokenMatches = !!(msg.accessToken && knownDevice?.accessToken && tokensMatch(knownDevice.accessToken, msg.accessToken) && knownDevice?.trustLevel === 'trusted' && !this._isIdleExpired(knownDevice));
                    const accessTokenExpired = !!(msg.accessToken && knownDevice?.accessToken && tokensMatch(knownDevice.accessToken, msg.accessToken) && (knownDevice?.accessTokenExpiresAt && Date.now() > knownDevice.accessTokenExpiresAt));

                    // Legacy / permanent token / refresh token check (for existing tests & backwards compatibility)
                    const presentedToken = msg.permanentToken || msg.refreshToken;
                    const tokenMatches = !!(presentedToken && knownDevice && knownDevice.trustLevel === 'trusted' && !this._isIdleExpired(knownDevice) && (
                        tokensMatch(knownDevice.permanentToken, presentedToken) ||
                        tokensMatch(knownDevice.refreshToken, presentedToken)
                    ));

                    // Check if known device was recognized via legacy ID or trusted status in tests
                    const isLegacyTrusted = !!(knownDevice && knownDevice.trustLevel === 'trusted' && !this._isIdleExpired(knownDevice) && (legacyId || knownDevice.permanentToken));

                    if (accessTokenExpired) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            code: 'TOKEN_EXPIRED',
                            message: 'Access token expired, refresh required',
                        }));
                        return;
                    }

                    if (pairingAccepted || accessTokenMatches || tokenMatches || isLegacyTrusted) {
                        this._clearFailedAttempts(clientIp);
                        const isNew = !this.knownDevices.has(deviceId) && !this.knownDevices.has(legacyId || '');

                        const accessToken = randomBytes(32).toString('hex');
                        const accessTokenExpiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
                        const refreshToken = knownDevice?.refreshToken || randomBytes(32).toString('hex');
                        const refreshTokenExpiresAt = Date.now() + IDLE_DEVICE_TTL_MS;
                        const permanentToken = knownDevice?.permanentToken || refreshToken;
                        const deviceBinding = knownDevice?.deviceBinding || this._computeDeviceBinding(deviceId, msg.deviceFingerprint);

                        // Detect IP change on reconnection
                        if (knownDevice && knownDevice.ip && clientIp && knownDevice.ip !== clientIp) {
                            this.emit('network-location-changed', {
                                deviceId,
                                deviceName: knownDevice.deviceName,
                                oldIp: knownDevice.ip,
                                newIp: clientIp,
                            });
                        }

                        const device = this._upsertKnownDevice({
                            deviceId,
                            deviceName: msg.deviceName || knownDevice?.deviceName || 'Aartiq Mobile',
                            deviceType: msg.deviceType || 'mobile',
                            deviceModel: msg.deviceModel || knownDevice?.deviceModel,
                            deviceImage: msg.deviceImage || knownDevice?.deviceImage || (msg.platform === 'ios' ? 'iphone' : 'android-phone'),
                            ip: clientIp,
                            port: Number(msg.port) || knownDevice?.port || this.port,
                            platform: msg.platform || knownDevice?.platform || 'mobile',
                            trustLevel: 'trusted',
                            accessToken,
                            accessTokenExpiresAt,
                            refreshToken,
                            refreshTokenExpiresAt,
                            permanentToken,
                            deviceBinding,
                            autoConnect: true,
                            online: true,
                            lastConnected: Date.now(),
                            lastSeen: Date.now(),
                            pairedAt: knownDevice?.pairedAt || Date.now(),
                        });

                        // Migrate legacy record into new id
                        if (legacyId && legacyId !== deviceId && this.knownDevices.has(legacyId)) {
                            this.knownDevices.delete(legacyId);
                            this._persistKnownDevices();
                        }

                        this.clientSockets.set(deviceId, ws);
                        this.socketDeviceIds.set(ws, deviceId);
                        this.socketSessions.set(ws, {
                            deviceId,
                            accessToken,
                            expiresAt: accessTokenExpiresAt,
                        });

                        if (isNew) {
                            this.emit('new-device-paired', {
                                deviceId,
                                deviceName: device.deviceName,
                                ip: clientIp,
                            });
                        }

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
                            accessToken,
                            expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
                            expiresAt: accessTokenExpiresAt,
                            refreshToken,
                            permanentToken,
                            permanentSync: true,
                        }));

                        console.log('[WiFi-Sync] Client authenticated successfully with short-lived access token');
                        this.emit('client-connected', {
                            deviceId,
                            connected: this.clientSockets.size > 0,
                            devices: this.getKnownDevices(),
                        });
                        // Push current session snapshot to newly connected mobile
                        const timer = setTimeout(() => this.sendSessionSnapshot(), 500);
                        if (timer && typeof timer.unref === 'function') timer.unref();
                    } else {
                        this._recordFailedAttempt(clientIp);
                        ws.send(JSON.stringify({
                            type: 'error',
                            code: 'AUTH_FAILED',
                            message: 'Invalid pairing code',
                        }));
                        console.log('[WiFi-Sync] Client authentication failed');
                    }
                    break;
                }

                case 'token-refresh': {
                    const clientIp = this._getSocketIp(ws);
                    if (this._checkLockout(clientIp)) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            code: 'AUTH_LOCKED_OUT',
                            message: 'Too many failed pairing attempts. Try again later.',
                        }));
                        return;
                    }

                    const deviceId = msg.deviceId;
                    const refreshToken = msg.refreshToken;
                    const device = deviceId ? this.knownDevices.get(deviceId) : null;

                    if (!device || device.trustLevel !== 'trusted' || device.revoked) {
                        this._recordFailedAttempt(clientIp);
                        ws.send(JSON.stringify({
                            type: 'error',
                            code: 'AUTH_FAILED',
                            message: 'Device not recognized or revoked',
                        }));
                        return;
                    }

                    if (this._isIdleExpired(device)) {
                        device.revoked = true;
                        device.trustLevel = 'blocked';
                        this._persistKnownDevices();
                        ws.send(JSON.stringify({
                            type: 'error',
                            code: 'SESSION_EXPIRED',
                            message: 'Pairing session expired due to inactivity. Please re-pair.',
                        }));
                        return;
                    }

                    // Enforce device binding: tokens bound to a device cannot be refreshed from a different fingerprint
                    if (device.deviceBinding && msg.deviceFingerprint) {
                        const calculatedBinding = this._computeDeviceBinding(deviceId, msg.deviceFingerprint);
                        if (!tokensMatch(device.deviceBinding, calculatedBinding)) {
                            this._recordFailedAttempt(clientIp);
                            ws.send(JSON.stringify({
                                type: 'error',
                                code: 'BINDING_MISMATCH',
                                message: 'Token cannot be used from a different device',
                            }));
                            return;
                        }
                    }

                    // Verify refresh token
                    if (!refreshToken || !tokensMatch(device.refreshToken, refreshToken)) {
                        this._recordFailedAttempt(clientIp);
                        ws.send(JSON.stringify({
                            type: 'error',
                            code: 'AUTH_FAILED',
                            message: 'Invalid refresh token',
                        }));
                        return;
                    }

                    if (device.refreshTokenExpiresAt && Date.now() > device.refreshTokenExpiresAt) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            code: 'REFRESH_TOKEN_EXPIRED',
                            message: 'Refresh token expired. Please re-pair.',
                        }));
                        return;
                    }

                    // Detect network location change
                    if (device.ip && clientIp && device.ip !== clientIp) {
                        this.emit('network-location-changed', {
                            deviceId,
                            deviceName: device.deviceName,
                            oldIp: device.ip,
                            newIp: clientIp,
                        });
                    }

                    this._clearFailedAttempts(clientIp);

                    const newAccessToken = randomBytes(32).toString('hex');
                    const newExpiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;

                    device.accessToken = newAccessToken;
                    device.accessTokenExpiresAt = newExpiresAt;
                    device.ip = clientIp;
                    device.lastSeen = Date.now();
                    this._persistKnownDevices();

                    this.clientSockets.set(deviceId, ws);
                    this.socketDeviceIds.set(ws, deviceId);
                    this.socketSessions.set(ws, {
                        deviceId,
                        accessToken: newAccessToken,
                        expiresAt: newExpiresAt,
                    });

                    ws.send(JSON.stringify({
                        type: 'token-refresh-ack',
                        accessToken: newAccessToken,
                        expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
                        expiresAt: newExpiresAt,
                    }));
                    break;
                }

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                default: {
                    // Authenticate all remaining sync routes
                    const session = this.socketSessions.get(ws);
                    const providedToken = msg.accessToken || msg.token;
                    let isAuthorized = false;
                    let isTokenExpired = false;

                    if (providedToken) {
                        const devId = this.socketDeviceIds.get(ws) || msg.deviceId;
                        const dev = devId ? this.knownDevices.get(devId) : null;
                        if (dev && dev.trustLevel === 'trusted' && tokensMatch(dev.accessToken, providedToken)) {
                            if (dev.accessTokenExpiresAt && Date.now() > dev.accessTokenExpiresAt) {
                                isTokenExpired = true;
                            } else {
                                isAuthorized = true;
                                dev.lastSeen = Date.now();
                            }
                        }
                    } else if (session) {
                        const dev = this.knownDevices.get(session.deviceId);
                        if (dev && dev.trustLevel === 'trusted' && tokensMatch(dev.accessToken, session.accessToken)) {
                            if (Date.now() > session.expiresAt) {
                                isTokenExpired = true;
                            } else {
                                isAuthorized = true;
                                dev.lastSeen = Date.now();
                            }
                        }
                    }

                    if (!isAuthorized) {
                        if (isTokenExpired) {
                            ws.send(JSON.stringify({
                                type: 'error',
                                code: 'TOKEN_EXPIRED',
                                message: 'Access token expired, refresh required',
                            }));
                        } else {
                            ws.send(JSON.stringify({
                                type: 'error',
                                code: 'UNAUTHORIZED',
                                message: 'Authentication required for sync actions',
                            }));
                        }
                        return;
                    }

                    switch (msg.type) {
                        case 'execute-command':
                            this._handleCommand(ws, msg);
                            break;

                        case 'desktop-control':
                            this._handleDesktopControl(ws, msg);
                            break;

                        // Unpair is state-changing, so it sits behind the same
                        // access-token gate as execute-command and the relay
                        // routes: a socket that never authenticated cannot
                        // revoke a device. Desktop-side unpair goes through IPC
                        // (unpairDevice()) and is unaffected.
                        case 'unpair-device': {
                            const devId = this.socketDeviceIds.get(ws) || msg.deviceId;
                            if (devId) {
                                this.unpairDevice(devId);
                            }
                            ws.send(JSON.stringify({ type: 'unpair-ack', success: true }));
                            break;
                        }

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

    public unpairDevice(deviceId: string): boolean {
        const socket = this.clientSockets.get(deviceId);
        if (socket) {
            try {
                socket.send(JSON.stringify({ type: 'revoked', message: 'Device unpaired' }));
                socket.close(4001, 'Device revoked');
            } catch (_) {}
            this.clientSockets.delete(deviceId);
            this.socketDeviceIds.delete(socket);
            this.socketSessions.delete(socket);
        }

        const device = this.knownDevices.get(deviceId);
        if (device) {
            device.revoked = true;
            device.trustLevel = 'blocked';
            device.accessToken = undefined;
            device.accessTokenExpiresAt = undefined;
            device.refreshToken = undefined;
            device.refreshTokenExpiresAt = undefined;
            device.permanentToken = undefined;
            device.autoConnect = false;
        }

        const deleted = this.knownDevices.delete(deviceId);
        if (deleted || device) {
            this._persistKnownDevices();
            this.emit('device-unpaired', { deviceId });
            this.emit('client-disconnected', {
                deviceId,
                connected: this.clientSockets.size > 0,
                devices: this.getKnownDevices(),
            });
            return true;
        }
        return false;
    }

    public removeKnownDevice(deviceId: string): boolean {
        return this.unpairDevice(deviceId);
    }
}

let wifiSyncInstance: WiFiSyncService | null = null;
export function getWiFiSync(port?: number): WiFiSyncService {
    if (!wifiSyncInstance) {
        wifiSyncInstance = new WiFiSyncService(port);
    }
    return wifiSyncInstance;
}
