import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { RiskLevel, UnifiedSessionManager, unifiedSessionManager } from './UnifiedSessionManager';
import { MasterPINService, masterPinService } from './MasterPINService';

export interface PlanOperationDetail {
    id: string;
    type: string;
    description: string;
    target: string;
    risk: RiskLevel;
    command?: string;
    details?: string;
    policyDenied?: boolean;
}

export interface PermissionRelayRequest {
    requestId: string;
    taskName: string;
    taskType: string;
    description?: string;
    command?: string;
    riskLevel: RiskLevel;
    operations: PlanOperationDetail[];
    directories: string[];
    urls: string[];
    estimatedDuration: string;
    requiresNetwork: boolean;
    requiresFileAccess: boolean;
    factors: string[];
    mitigations: string[];
    requiresBiometric: boolean;
    isRemote: boolean;
    originDeviceId: string;
    originDeviceName: string;
    createdAt: number;
    expiresAt: number;
}

export interface PermissionRelayResponse {
    requestId: string;
    approved: boolean;
    pinVerified: boolean;
    screenLockVerified: boolean;
    respondedByDeviceId?: string;
    respondedAt: number;
    reason?: string;
}

export class PermissionRelayService extends EventEmitter {
    private static instance: PermissionRelayService | null = null;
    private pendingRequests: Map<string, {
        request: PermissionRelayRequest;
        resolve: (res: PermissionRelayResponse) => void;
        timer: NodeJS.Timeout;
    }> = new Map();

    private constructor() {
        super();
    }

    public static getInstance(): PermissionRelayService {
        if (!PermissionRelayService.instance) {
            PermissionRelayService.instance = new PermissionRelayService();
        }
        return PermissionRelayService.instance;
    }

    /**
     * Dispatch an interactive permission approval request to connected mobile device(s)
     */
    public createApprovalRequest(params: {
        taskName: string;
        taskType?: string;
        description?: string;
        command?: string;
        riskLevel: RiskLevel;
        operations?: PlanOperationDetail[];
        directories?: string[];
        urls?: string[];
        estimatedDuration?: string;
        requiresNetwork?: boolean;
        requiresFileAccess?: boolean;
        factors?: string[];
        mitigations?: string[];
        isRemote?: boolean;
        originDeviceId?: string;
        originDeviceName?: string;
    }): { request: PermissionRelayRequest; promise: Promise<PermissionRelayResponse> } {
        const requestId = `perm-${Date.now()}-${randomUUID().substring(0, 8)}`;
        const now = Date.now();
        const ttlMs = 5 * 60 * 1000; // 5 minutes TTL

        const riskLevel = params.riskLevel || 'medium';
        const isRemote = params.isRemote ?? true;
        const requiresBiometric = isRemote || riskLevel === 'high' || riskLevel === 'critical';

        const ops: PlanOperationDetail[] = params.operations || (params.command ? [{
            id: `op-1`,
            type: params.taskType || 'shell',
            description: params.description || `Execute command: ${params.command}`,
            target: params.command,
            command: params.command,
            risk: riskLevel,
        }] : []);

        const factors = params.factors || [];
        if (factors.length === 0) {
            if (riskLevel === 'critical') factors.push('Irreversible system modification or privilege escalation');
            if (riskLevel === 'high') factors.push('Modifies local files, processes, or system settings');
            if (params.command) factors.push(`Direct shell execution on host machine`);
            if (params.directories && params.directories.length > 0) factors.push(`Accesses directories: ${params.directories.slice(0, 2).join(', ')}`);
        }

        const mitigations = params.mitigations || [];
        if (mitigations.length === 0) {
            mitigations.push('Dual-gate verification: Master PIN + Device Screen Lock');
            mitigations.push('Full audit logging in session timeline');
            if (riskLevel !== 'critical') mitigations.push('Rollback / process kill available');
        }

        const request: PermissionRelayRequest = {
            requestId,
            taskName: params.taskName,
            taskType: params.taskType || 'automation',
            description: params.description,
            command: params.command,
            riskLevel,
            operations: ops,
            directories: params.directories || [],
            urls: params.urls || [],
            estimatedDuration: params.estimatedDuration || '1 min',
            requiresNetwork: params.requiresNetwork ?? false,
            requiresFileAccess: params.requiresFileAccess ?? (params.directories ? params.directories.length > 0 : false),
            factors,
            mitigations,
            requiresBiometric,
            isRemote,
            originDeviceId: params.originDeviceId || 'desktop',
            originDeviceName: params.originDeviceName || 'Aartiq Desktop',
            createdAt: now,
            expiresAt: now + ttlMs,
        };

        const promise = new Promise<PermissionRelayResponse>((resolve) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                const expiredResponse: PermissionRelayResponse = {
                    requestId,
                    approved: false,
                    pinVerified: false,
                    screenLockVerified: false,
                    respondedAt: Date.now(),
                    reason: 'Permission request timed out after 5 minutes',
                };
                unifiedSessionManager.logPermission({
                    action: request.taskName,
                    riskLevel: request.riskLevel,
                    decision: 'rejected',
                    approvedBy: 'mobile',
                    details: 'Timed out',
                });
                resolve(expiredResponse);
                this.emit('request-expired', requestId);
            }, ttlMs);

            this.pendingRequests.set(requestId, { request, resolve, timer });
        });

        // Log pending in unified session
        unifiedSessionManager.logPermission({
            action: request.taskName,
            riskLevel: request.riskLevel,
            decision: 'pending',
            approvedBy: 'mobile',
            details: request.command || request.description,
        });

        this.emit('new-approval-request', request);
        return { request, promise };
    }

    /**
     * Called when a response is received from mobile (via WebSocket or Firebase)
     */
    public handleApprovalResponse(response: PermissionRelayResponse): boolean {
        const pending = this.pendingRequests.get(response.requestId);
        if (!pending) {
            console.warn(`[PermissionRelay] No pending request found for ${response.requestId}`);
            return false;
        }

        clearTimeout(pending.timer);
        this.pendingRequests.delete(response.requestId);

        // Security assertion: for remote / high / critical approvals, verify both conditions were met
        if (response.approved) {
            if (!response.pinVerified) {
                console.error(`[PermissionRelay] Approval rejected: Master PIN was not verified`);
                response.approved = false;
                response.reason = 'Security validation failed: Master PIN verification missing';
            }
            if (pending.request.requiresBiometric && !response.screenLockVerified) {
                console.error(`[PermissionRelay] Approval rejected: Native screen lock / biometric verification missing`);
                response.approved = false;
                response.reason = 'Security validation failed: Device screen lock verification missing';
            }
        }

        // Log decision in session manager
        unifiedSessionManager.logPermission({
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
    }

    public getPendingRequest(requestId: string): PermissionRelayRequest | null {
        const entry = this.pendingRequests.get(requestId);
        return entry ? entry.request : null;
    }

    public listPendingRequests(): PermissionRelayRequest[] {
        return Array.from(this.pendingRequests.values()).map(e => e.request);
    }

    public cancelRequest(requestId: string, reason: string = 'Cancelled by user'): boolean {
        const pending = this.pendingRequests.get(requestId);
        if (!pending) return false;

        clearTimeout(pending.timer);
        this.pendingRequests.delete(requestId);

        pending.resolve({
            requestId,
            approved: false,
            pinVerified: false,
            screenLockVerified: false,
            respondedAt: Date.now(),
            reason,
        });

        this.emit('request-cancelled', requestId);
        return true;
    }
}

export const permissionRelayService = PermissionRelayService.getInstance();
