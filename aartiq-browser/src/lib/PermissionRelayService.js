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
Object.defineProperty(exports, "__esModule", { value: true });
exports.permissionRelayService = exports.PermissionRelayService = void 0;
var events_1 = require("events");
var crypto_1 = require("crypto");
var UnifiedSessionManager_1 = require("./UnifiedSessionManager");
var PermissionRelayService = /** @class */ (function (_super) {
    __extends(PermissionRelayService, _super);
    function PermissionRelayService() {
        var _this = _super.call(this) || this;
        _this.pendingRequests = new Map();
        return _this;
    }
    PermissionRelayService.getInstance = function () {
        if (!PermissionRelayService.instance) {
            PermissionRelayService.instance = new PermissionRelayService();
        }
        return PermissionRelayService.instance;
    };
    /**
     * Dispatch an interactive permission approval request to connected mobile device(s)
     */
    PermissionRelayService.prototype.createApprovalRequest = function (params) {
        var _this = this;
        var _a, _b, _c;
        var requestId = "perm-".concat(Date.now(), "-").concat((0, crypto_1.randomUUID)().substring(0, 8));
        var now = Date.now();
        var ttlMs = 5 * 60 * 1000; // 5 minutes TTL
        var riskLevel = params.riskLevel || 'medium';
        var isRemote = (_a = params.isRemote) !== null && _a !== void 0 ? _a : true;
        var requiresBiometric = isRemote || riskLevel === 'high' || riskLevel === 'critical';
        var ops = params.operations || (params.command ? [{
                id: "op-1",
                type: params.taskType || 'shell',
                description: params.description || "Execute command: ".concat(params.command),
                target: params.command,
                command: params.command,
                risk: riskLevel,
            }] : []);
        var factors = params.factors || [];
        if (factors.length === 0) {
            if (riskLevel === 'critical')
                factors.push('Irreversible system modification or privilege escalation');
            if (riskLevel === 'high')
                factors.push('Modifies local files, processes, or system settings');
            if (params.command)
                factors.push("Direct shell execution on host machine");
            if (params.directories && params.directories.length > 0)
                factors.push("Accesses directories: ".concat(params.directories.slice(0, 2).join(', ')));
        }
        var mitigations = params.mitigations || [];
        if (mitigations.length === 0) {
            mitigations.push('Dual-gate verification: Master PIN + Device Screen Lock');
            mitigations.push('Full audit logging in session timeline');
            if (riskLevel !== 'critical')
                mitigations.push('Rollback / process kill available');
        }
        var request = {
            requestId: requestId,
            taskName: params.taskName,
            taskType: params.taskType || 'automation',
            description: params.description,
            command: params.command,
            riskLevel: riskLevel,
            operations: ops,
            directories: params.directories || [],
            urls: params.urls || [],
            estimatedDuration: params.estimatedDuration || '1 min',
            requiresNetwork: (_b = params.requiresNetwork) !== null && _b !== void 0 ? _b : false,
            requiresFileAccess: (_c = params.requiresFileAccess) !== null && _c !== void 0 ? _c : (params.directories ? params.directories.length > 0 : false),
            factors: factors,
            mitigations: mitigations,
            requiresBiometric: requiresBiometric,
            isRemote: isRemote,
            originDeviceId: params.originDeviceId || 'desktop',
            originDeviceName: params.originDeviceName || 'Aartiq Desktop',
            createdAt: now,
            expiresAt: now + ttlMs,
        };
        var promise = new Promise(function (resolve) {
            var timer = setTimeout(function () {
                _this.pendingRequests.delete(requestId);
                var expiredResponse = {
                    requestId: requestId,
                    approved: false,
                    pinVerified: false,
                    screenLockVerified: false,
                    respondedAt: Date.now(),
                    reason: 'Permission request timed out after 5 minutes',
                };
                UnifiedSessionManager_1.unifiedSessionManager.logPermission({
                    action: request.taskName,
                    riskLevel: request.riskLevel,
                    decision: 'rejected',
                    approvedBy: 'mobile',
                    details: 'Timed out',
                });
                resolve(expiredResponse);
                _this.emit('request-expired', requestId);
            }, ttlMs);
            _this.pendingRequests.set(requestId, { request: request, resolve: resolve, timer: timer });
        });
        // Log pending in unified session
        UnifiedSessionManager_1.unifiedSessionManager.logPermission({
            action: request.taskName,
            riskLevel: request.riskLevel,
            decision: 'pending',
            approvedBy: 'mobile',
            details: request.command || request.description,
        });
        this.emit('new-approval-request', request);
        return { request: request, promise: promise };
    };
    /**
     * Called when a response is received from mobile (via WebSocket or Firebase)
     */
    PermissionRelayService.prototype.handleApprovalResponse = function (response) {
        var pending = this.pendingRequests.get(response.requestId);
        if (!pending) {
            console.warn("[PermissionRelay] No pending request found for ".concat(response.requestId));
            return false;
        }
        clearTimeout(pending.timer);
        this.pendingRequests.delete(response.requestId);
        // Security assertion: for remote / high / critical approvals, verify both conditions were met
        if (response.approved) {
            if (!response.pinVerified) {
                console.error("[PermissionRelay] Approval rejected: Master PIN was not verified");
                response.approved = false;
                response.reason = 'Security validation failed: Master PIN verification missing';
            }
            if (pending.request.requiresBiometric && !response.screenLockVerified) {
                console.error("[PermissionRelay] Approval rejected: Native screen lock / biometric verification missing");
                response.approved = false;
                response.reason = 'Security validation failed: Device screen lock verification missing';
            }
        }
        // Log decision in session manager
        UnifiedSessionManager_1.unifiedSessionManager.logPermission({
            action: pending.request.taskName,
            riskLevel: pending.request.riskLevel,
            decision: response.approved ? 'approved' : 'rejected',
            approvedBy: 'mobile',
            verificationMethod: response.screenLockVerified ? 'pin_and_screen_lock' : 'pin',
            deviceId: response.respondedByDeviceId,
            details: response.reason || (response.approved ? 'Approved from Aartiq Mobile' : 'Denied by user on mobile'),
        });
        pending.resolve(response);
        this.emit('approval-resolved', response);
        return true;
    };
    PermissionRelayService.prototype.getPendingRequest = function (requestId) {
        var entry = this.pendingRequests.get(requestId);
        return entry ? entry.request : null;
    };
    PermissionRelayService.prototype.listPendingRequests = function () {
        return Array.from(this.pendingRequests.values()).map(function (e) { return e.request; });
    };
    PermissionRelayService.prototype.cancelRequest = function (requestId, reason) {
        if (reason === void 0) { reason = 'Cancelled by user'; }
        var pending = this.pendingRequests.get(requestId);
        if (!pending)
            return false;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(requestId);
        pending.resolve({
            requestId: requestId,
            approved: false,
            pinVerified: false,
            screenLockVerified: false,
            respondedAt: Date.now(),
            reason: reason,
        });
        this.emit('request-cancelled', requestId);
        return true;
    };
    PermissionRelayService.instance = null;
    return PermissionRelayService;
}(events_1.EventEmitter));
exports.PermissionRelayService = PermissionRelayService;
exports.permissionRelayService = PermissionRelayService.getInstance();
