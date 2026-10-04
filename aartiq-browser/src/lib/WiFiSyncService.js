"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WiFiSyncService = void 0;
exports.getWiFiSync = getWiFiSync;
var events_1 = require("events");
var ws_1 = require("ws");
var os = __importStar(require("os"));
var dgram = __importStar(require("dgram"));
var electron_1 = require("electron");
var crypto_1 = require("crypto");
var electron_store_1 = __importDefault(require("electron-store"));
var DeviceIdentifier_1 = require("./DeviceIdentifier");
// Late-require to avoid circular deps at module load time
var _permissionRelayService = null;
var _unifiedSessionManager = null;
function getPermissionRelayService() {
    if (!_permissionRelayService) {
        try {
            _permissionRelayService = require('./PermissionRelayService').permissionRelayService;
        }
        catch (_) { }
    }
    return _permissionRelayService;
}
function getUnifiedSessionManager() {
    if (!_unifiedSessionManager) {
        try {
            _unifiedSessionManager = require('./UnifiedSessionManager').unifiedSessionManager;
        }
        catch (_) { }
    }
    return _unifiedSessionManager;
}
var WiFiSyncService = /** @class */ (function (_super) {
    __extends(WiFiSyncService, _super);
    function WiFiSyncService(port) {
        if (port === void 0) { port = 3004; }
        var _this = _super.call(this) || this;
        _this.wss = null;
        _this.discoverySocket = null;
        _this.discoveryInterval = null;
        _this.clients = new Set();
        _this._lastReceivedClipboard = '';
        _this.clientSockets = new Map();
        _this.socketDeviceIds = new WeakMap();
        _this.store = new electron_store_1.default({ name: 'comet-wifi-sync' });
        _this.knownDevices = new Map();
        _this.knownDevicesKey = 'knownWifiSyncDevices';
        _this.port = port;
        var meta = DeviceIdentifier_1.DeviceIdentifier.getDeviceMetadata();
        _this.deviceId = meta.deviceId;
        _this.deviceName = meta.deviceName; // Real friendly device name (e.g. "Sandip's MacBook Pro")
        // The pairing code must survive desktop restarts: a fresh random code
        // per process made the code shown in the UI (or read from a saved
        // device) invalid after every relaunch → "Invalid pairing code" on
        // reconnect for a device that had already been paired.
        var savedCode = _this.store.get('pairingCode');
        if (typeof savedCode === 'string' && /^\d{6}$/.test(savedCode)) {
            _this.pairingCode = savedCode;
        }
        else {
            _this.pairingCode = String(100000 + (0, crypto_1.randomInt)(900000));
            _this.store.set('pairingCode', _this.pairingCode);
        }
        _this._loadKnownDevices();
        return _this;
    }
    /**
     * The device id format used before DeviceIdentifier existed
     * (`desktop-<hostname:8>`). Phones that paired against an older build
     * keyed their stored permanent token by it, so it must keep working.
     */
    WiFiSyncService.prototype.getLegacyDeviceId = function () {
        return "desktop-".concat(os.hostname().substring(0, 8));
    };
    WiFiSyncService.prototype.setDeviceId = function (deviceId, deviceName) {
        this.deviceId = deviceId;
        this.deviceName = deviceName;
    };
    WiFiSyncService.prototype.getDeviceId = function () {
        return this.deviceId;
    };
    WiFiSyncService.prototype.getDeviceName = function () {
        return this.deviceName;
    };
    WiFiSyncService.prototype.start = function () {
        var _this = this;
        try {
            this.wss = new ws_1.WebSocketServer({ port: this.port });
            console.log("[WiFi-Sync] Server started on port ".concat(this.port));
            this.wss.on('connection', function (ws) {
                console.log('[WiFi-Sync] Mobile client connected');
                _this.clients.add(ws);
                ws.on('message', function (message) {
                    _this._handleMessage(ws, message);
                });
                ws.on('close', function () {
                    console.log('[WiFi-Sync] Mobile client disconnected');
                    _this.clients.delete(ws);
                    _this._handleSocketClose(ws);
                });
                ws.on('error', function (err) {
                    console.error('[WiFi-Sync] WebSocket error:', err);
                });
            });
            this._startDiscovery();
            return true;
        }
        catch (e) {
            console.error('[WiFi-Sync] Failed to start server:', e);
            return false;
        }
    };
    WiFiSyncService.prototype._loadKnownDevices = function () {
        var saved = this.store.get(this.knownDevicesKey);
        if (!Array.isArray(saved))
            return;
        for (var _i = 0, saved_1 = saved; _i < saved_1.length; _i++) {
            var entry = saved_1[_i];
            if (!entry || typeof entry !== 'object' || !entry.deviceId)
                continue;
            var normalized = this._normalizeKnownDevice(entry);
            normalized.online = false;
            this.knownDevices.set(normalized.deviceId, normalized);
        }
    };
    WiFiSyncService.prototype._persistKnownDevices = function () {
        this.store.set(this.knownDevicesKey, Array.from(this.knownDevices.values()));
        this.emit('devices-updated', this.getKnownDevices());
    };
    WiFiSyncService.prototype._normalizeKnownDevice = function (device) {
        var _a, _b;
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
            autoConnect: (_a = device.autoConnect) !== null && _a !== void 0 ? _a : (device.trustLevel === 'trusted' || !!device.permanentToken),
            online: (_b = device.online) !== null && _b !== void 0 ? _b : false,
            lastConnected: device.lastConnected,
            lastSeen: device.lastSeen,
        };
    };
    WiFiSyncService.prototype._upsertKnownDevice = function (device) {
        var existing = this.knownDevices.get(device.deviceId);
        var merged = this._normalizeKnownDevice(__assign(__assign({}, (existing || {})), device));
        this.knownDevices.set(merged.deviceId, merged);
        this._persistKnownDevices();
        return merged;
    };
    WiFiSyncService.prototype._getSocketIp = function (ws) {
        var _a;
        var remoteAddress = (_a = ws === null || ws === void 0 ? void 0 : ws._socket) === null || _a === void 0 ? void 0 : _a.remoteAddress;
        return (remoteAddress === null || remoteAddress === void 0 ? void 0 : remoteAddress.replace(/^::ffff:/, '')) || '';
    };
    WiFiSyncService.prototype._handleSocketClose = function (ws) {
        var deviceId = this.socketDeviceIds.get(ws);
        if (!deviceId)
            return;
        this.clientSockets.delete(deviceId);
        this.socketDeviceIds.delete(ws);
        var device = this.knownDevices.get(deviceId);
        if (device) {
            this._upsertKnownDevice(__assign(__assign({}, device), { online: false, lastSeen: Date.now() }));
        }
        this.emit('client-disconnected', {
            deviceId: deviceId,
            connected: this.clientSockets.size > 0,
            devices: this.getKnownDevices(),
        });
    };
    WiFiSyncService.prototype._startDiscovery = function () {
        var _this = this;
        try {
            this.discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
            var discoveryPort_1 = 3005;
            var meta_1 = DeviceIdentifier_1.DeviceIdentifier.getDeviceMetadata();
            var beacon_1 = function () { return JSON.stringify({
                type: 'aartiq-beacon',
                deviceId: _this.deviceId,
                deviceName: _this.deviceName,
                model: meta_1.model,
                deviceImage: meta_1.deviceImage,
                ip: _this.getLocalIp(),
                port: _this.port,
            }); };
            this.discoveryInterval = setInterval(function () {
                if (!_this.discoverySocket)
                    return;
                var message = Buffer.from(beacon_1());
                _this.discoverySocket.send(message, discoveryPort_1, '255.255.255.255', function (err) {
                    if (err)
                        console.error('[WiFi-Sync] Discovery send failed:', err);
                });
            }, 3000);
            this.discoverySocket.bind(0, function () {
                if (_this.discoverySocket) {
                    _this.discoverySocket.setBroadcast(true);
                    console.log('[WiFi-Sync] Discovery beacon started');
                }
            });
        }
        catch (e) {
            console.error('[WiFi-Sync] Failed to start discovery:', e);
        }
    };
    WiFiSyncService.prototype._handleMessage = function (ws, data) {
        var _this = this;
        var _a;
        try {
            var msg = JSON.parse(data.toString());
            console.log("[WiFi-Sync] Received: ".concat(msg.type));
            switch (msg.type) {
                case 'handshake': {
                    var deviceId = "".concat(msg.deviceId || "mobile-".concat(Date.now()));
                    // Devices that paired before the id migration present a
                    // new id (the phone's secure-storage id) while the desktop
                    // trusted their legacy id. Fall back to the legacy id so an
                    // already-paired phone is still recognized as trusted.
                    var legacyId = typeof msg.legacyDeviceId === 'string' && msg.legacyDeviceId && msg.legacyDeviceId !== deviceId
                        ? msg.legacyDeviceId
                        : null;
                    var knownDevice = this.knownDevices.get(deviceId) || (legacyId ? this.knownDevices.get(legacyId) : undefined) || undefined;
                    var permanentTokenMatches = !!(msg.permanentToken && (knownDevice === null || knownDevice === void 0 ? void 0 : knownDevice.permanentToken) && msg.permanentToken === knownDevice.permanentToken);
                    var isTrusted = (knownDevice === null || knownDevice === void 0 ? void 0 : knownDevice.trustLevel) === 'trusted';
                    var pairingAccepted = typeof msg.pairingCode === 'string' && msg.pairingCode === this.pairingCode;
                    console.log('[WiFi-Sync] Handshake received from:', deviceId, 'permanentMatch=', permanentTokenMatches, 'trusted=', isTrusted);
                    if (permanentTokenMatches || isTrusted || pairingAccepted) {
                        var permanentToken = (knownDevice === null || knownDevice === void 0 ? void 0 : knownDevice.permanentToken) || (0, crypto_1.randomBytes)(32).toString('hex');
                        var device = this._upsertKnownDevice({
                            deviceId: deviceId,
                            deviceName: msg.deviceName || (knownDevice === null || knownDevice === void 0 ? void 0 : knownDevice.deviceName) || 'Aartiq Mobile',
                            deviceType: msg.deviceType || 'mobile',
                            deviceModel: msg.deviceModel || (knownDevice === null || knownDevice === void 0 ? void 0 : knownDevice.deviceModel),
                            deviceImage: msg.deviceImage || (knownDevice === null || knownDevice === void 0 ? void 0 : knownDevice.deviceImage) || (msg.platform === 'ios' ? 'iphone' : 'android-phone'),
                            ip: this._getSocketIp(ws),
                            port: Number(msg.port) || (knownDevice === null || knownDevice === void 0 ? void 0 : knownDevice.port) || this.port,
                            platform: msg.platform || (knownDevice === null || knownDevice === void 0 ? void 0 : knownDevice.platform) || 'mobile',
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
                        var meta = DeviceIdentifier_1.DeviceIdentifier.getDeviceMetadata();
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
                            deviceId: deviceId,
                            connected: this.clientSockets.size > 0,
                            devices: this.getKnownDevices(),
                        });
                        // Push current session snapshot to newly connected mobile
                        setTimeout(function () { return _this.sendSessionSnapshot(); }, 500);
                    }
                    else {
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
                        electron_1.clipboard.writeText(msg.text);
                        this.emit('clipboard-received', msg.text);
                    }
                    break;
                case 'clipboard-sync-request': {
                    var currentClipboard = electron_1.clipboard.readText();
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
                    var relay = getPermissionRelayService();
                    if (relay && msg.payload) {
                        var response = __assign(__assign({}, msg.payload), { respondedByDeviceId: this.socketDeviceIds.get(ws) || 'unknown-mobile' });
                        var handled = relay.handleApprovalResponse(response);
                        ws.send(JSON.stringify({
                            type: 'permission-relay-ack',
                            requestId: (_a = msg.payload) === null || _a === void 0 ? void 0 : _a.requestId,
                            received: handled,
                        }));
                    }
                    break;
                }
                // ── Mobile requests current + past sessions ────────────────
                case 'session-sync-request': {
                    var usm = getUnifiedSessionManager();
                    if (usm) {
                        var payload = usm.getSyncPayload();
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
                        var pinSvc = require('./MasterPINService').masterPinService;
                        var pinPayload = pinSvc.getSyncPayload();
                        ws.send(JSON.stringify(__assign({ type: 'pin-sync-response' }, pinPayload)));
                    }
                    catch (e) {
                        ws.send(JSON.stringify({ type: 'pin-sync-response', hasPin: false }));
                    }
                    break;
                }
                // ── Mobile syncs an imported session back ──────────────────
                case 'session-import': {
                    var usm2 = getUnifiedSessionManager();
                    if (usm2 && msg.session) {
                        usm2.importSession(msg.session);
                        ws.send(JSON.stringify({ type: 'session-import-ack', success: true, id: msg.session.id }));
                    }
                    break;
                }
            }
        }
        catch (e) {
            console.error('[WiFi-Sync] Error parsing message:', e);
        }
    };
    WiFiSyncService.prototype._handleCommand = function (ws, msg) {
        return __awaiter(this, void 0, void 0, function () {
            var commandId, command, args;
            return __generator(this, function (_a) {
                commandId = msg.commandId, command = msg.command, args = msg.args;
                this.emit('command', {
                    commandId: commandId,
                    command: command,
                    args: args,
                    sendResponse: function (responseBody) {
                        ws.send(JSON.stringify(__assign({ type: 'command-response', commandId: commandId }, responseBody)));
                    },
                });
                return [2 /*return*/];
            });
        });
    };
    WiFiSyncService.prototype.sendToMobile = function (message) {
        this.broadcast(__assign(__assign({ type: 'desktop-to-mobile' }, message), { timestamp: Date.now() }));
    };
    WiFiSyncService.prototype.sendAIResponse = function (promptId, response, isStreaming) {
        this.broadcast({
            type: 'ai-stream-response',
            promptId: promptId,
            response: response,
            isStreaming: isStreaming !== null && isStreaming !== void 0 ? isStreaming : false,
            timestamp: Date.now(),
        });
    };
    WiFiSyncService.prototype.sendDesktopStatus = function (status) {
        this.broadcast(__assign(__assign({ type: 'desktop-status' }, status), { timestamp: Date.now() }));
    };
    WiFiSyncService.prototype.sendDesktopControl = function (action, args) {
        this.broadcast({
            type: 'desktop-control',
            action: action,
            args: args || {},
            timestamp: Date.now(),
        });
    };
    /**
     * Send a permission relay request (HIGH/CRITICAL automation approval) to mobile.
     * Replaces/extends the QR-based shell-approval-qr mechanism for rich, plan-aware approvals.
     */
    WiFiSyncService.prototype.sendPermissionRequest = function (request) {
        this.broadcast({
            type: 'permission-relay-request',
            payload: request,
            timestamp: Date.now(),
        });
        console.log("[WiFi-Sync] Sent permission-relay-request to mobile: ".concat(request.requestId, " (risk=").concat(request.riskLevel, ")"));
    };
    /**
     * Push a session delta (tabs, history, or task update) to mobile in real time.
     */
    WiFiSyncService.prototype.sendSessionDelta = function (deltaType, data) {
        this.broadcast({
            type: 'session-delta',
            deltaType: deltaType,
            data: data,
            timestamp: Date.now(),
        });
    };
    /**
     * Push full session snapshot to mobile on demand (called on initial connect or explicit refresh).
     */
    WiFiSyncService.prototype.sendSessionSnapshot = function () {
        try {
            var usm = getUnifiedSessionManager();
            if (usm) {
                var payload = usm.getSyncPayload();
                this.broadcast({
                    type: 'session-sync-response',
                    currentSession: payload.currentSession,
                    pastSessions: payload.pastSessions,
                    timestamp: Date.now(),
                });
                console.log("[WiFi-Sync] Sent session snapshot to mobile, sessionId=".concat(payload.currentSession.id));
            }
        }
        catch (e) {
            console.error('[WiFi-Sync] Failed to send session snapshot:', e);
        }
    };
    WiFiSyncService.prototype.sendFileToMobile = function (filename, fileBuffer, mimeType, metadata) {
        var base64Data = fileBuffer.toString('base64');
        this.broadcast(__assign(__assign({ type: 'file-transfer', filename: filename, mimeType: mimeType, data: base64Data, size: fileBuffer.length }, metadata), { timestamp: Date.now() }));
        console.log("[WiFi-Sync] Sent file to mobile: ".concat(filename, " (").concat((fileBuffer.length / 1024).toFixed(1), " KB)"));
    };
    WiFiSyncService.prototype._handleDesktopControl = function (ws, msg) {
        return __awaiter(this, void 0, void 0, function () {
            var commandId, action, prompt, promptId, args;
            return __generator(this, function (_a) {
                commandId = msg.commandId, action = msg.action, prompt = msg.prompt, promptId = msg.promptId, args = msg.args;
                console.log("[WiFi-Sync] Desktop Control: action=".concat(action));
                this.emit('command', {
                    commandId: commandId,
                    command: 'desktop-control',
                    args: __assign({ action: action, prompt: prompt, promptId: promptId }, args),
                    sendResponse: function (responseBody) {
                        ws.send(JSON.stringify(__assign({ type: 'desktop-control-response', commandId: commandId, action: action }, responseBody)));
                    },
                });
                return [2 /*return*/];
            });
        });
    };
    WiFiSyncService.prototype.getLocalIp = function () {
        var interfaces = os.networkInterfaces();
        for (var _i = 0, _a = Object.keys(interfaces); _i < _a.length; _i++) {
            var name_1 = _a[_i];
            var ifaceEntry = interfaces[name_1];
            if (!ifaceEntry)
                continue;
            for (var _b = 0, ifaceEntry_1 = ifaceEntry; _b < ifaceEntry_1.length; _b++) {
                var iface = ifaceEntry_1[_b];
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return '127.0.0.1';
    };
    WiFiSyncService.prototype.getConnectUri = function () {
        return "aartiq://connect?ip=".concat(this.getLocalIp(), "&port=").concat(this.port, "&device=").concat(this.deviceId);
    };
    WiFiSyncService.prototype.getCloudConnectUri = function (cloudDeviceId) {
        return "aartiq://cloud-connect?cloudId=".concat(cloudDeviceId, "&device=").concat(this.deviceId, "&name=").concat(encodeURIComponent(this.deviceName));
    };
    WiFiSyncService.prototype.stop = function () {
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
    };
    WiFiSyncService.prototype.getPairingCode = function () {
        return this.pairingCode;
    };
    WiFiSyncService.prototype.broadcast = function (message) {
        var data = JSON.stringify(message);
        var recipients = this.clientSockets.size > 0
            ? Array.from(this.clientSockets.values())
            : Array.from(this.clients.values());
        recipients.forEach(function (client) {
            if (client.readyState === ws_1.WebSocket.OPEN) {
                client.send(data);
            }
        });
    };
    WiFiSyncService.prototype.broadcastClipboard = function (text) {
        this.broadcast({
            type: 'clipboard-sync',
            text: text,
            timestamp: Date.now(),
        });
    };
    WiFiSyncService.prototype.connectToDevice = function (deviceId) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                console.log('[WiFi-Sync] Attempting to connect to device via cloud relay:', deviceId);
                return [2 /*return*/, false];
            });
        });
    };
    WiFiSyncService.prototype.disconnectFromDevice = function (deviceId) {
        var socket = this.clientSockets.get(deviceId);
        if (socket) {
            socket.close();
            this.clientSockets.delete(deviceId);
        }
    };
    WiFiSyncService.prototype.getConnectedClients = function () {
        return Array.from(this.clientSockets.keys());
    };
    WiFiSyncService.prototype.getKnownDevices = function () {
        return Array.from(this.knownDevices.values()).sort(function (a, b) { return (b.lastSeen || b.lastConnected || 0) - (a.lastSeen || a.lastConnected || 0); });
    };
    WiFiSyncService.prototype.setDeviceTrust = function (deviceId, trustLevel, autoConnect) {
        var existing = this.knownDevices.get(deviceId);
        if (!existing)
            return null;
        var updated = this._upsertKnownDevice(__assign(__assign({}, existing), { trustLevel: trustLevel, autoConnect: autoConnect !== null && autoConnect !== void 0 ? autoConnect : trustLevel === 'trusted', lastSeen: Date.now() }));
        var socket = this.clientSockets.get(deviceId);
        if (socket && socket.readyState === ws_1.WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'device-trust-updated',
                deviceId: deviceId,
                deviceName: updated.deviceName,
                trustLevel: updated.trustLevel,
                autoConnect: updated.autoConnect,
                timestamp: Date.now(),
            }));
        }
        return updated;
    };
    WiFiSyncService.prototype.removeKnownDevice = function (deviceId) {
        var socket = this.clientSockets.get(deviceId);
        if (socket) {
            socket.close();
        }
        this.clientSockets.delete(deviceId);
        var deleted = this.knownDevices.delete(deviceId);
        if (deleted) {
            this._persistKnownDevices();
        }
        return deleted;
    };
    return WiFiSyncService;
}(events_1.EventEmitter));
exports.WiFiSyncService = WiFiSyncService;
var wifiSyncInstance = null;
function getWiFiSync(port) {
    if (!wifiSyncInstance) {
        wifiSyncInstance = new WiFiSyncService(port);
    }
    return wifiSyncInstance;
}
