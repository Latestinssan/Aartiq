import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SessionTab {
    id: string;
    url: string;
    title: string;
    favicon?: string;
    position: number;
    isActive: boolean;
    openedAt: number;
    lastAccessedAt: number;
}

export interface SessionHistoryEntry {
    id: string;
    url: string;
    title: string;
    visitedAt: number;
    duration?: number;
    referrer?: string;
}

export interface SessionTask {
    id: string;
    name: string;
    status: 'completed' | 'failed' | 'running' | 'queued';
    riskLevel: RiskLevel;
    steps: number;
    completedSteps: number;
    startedAt: number;
    completedAt?: number;
    command?: string;
    error?: string;
}

export interface SessionAIChat {
    id: string;
    startedAt: number;
    messages: {
        role: 'user' | 'assistant' | 'system';
        content: string;
        timestamp: number;
    }[];
    model?: string;
}

export interface SessionPermissionLog {
    id: string;
    timestamp: number;
    action: string;
    riskLevel: RiskLevel;
    decision: 'approved' | 'rejected' | 'auto_approved' | 'pending';
    approvedBy: 'desktop' | 'mobile' | 'auto';
    verificationMethod?: 'pin' | 'biometric' | 'screen_lock' | 'pin_and_screen_lock';
    deviceId?: string;
    details?: string;
}

export interface DeviceInfo {
    deviceId: string;
    deviceName: string;
    deviceType: 'desktop' | 'mobile';
    platform: string;
    hostname: string;
}

export interface UnifiedSession {
    id: string;
    deviceId: string;
    deviceInfo: DeviceInfo;
    startedAt: number;
    endedAt?: number;
    isActive: boolean;
    tabs: SessionTab[];
    history: SessionHistoryEntry[];
    automationTasks: SessionTask[];
    aiConversations: SessionAIChat[];
    permissions: SessionPermissionLog[];
    syncState: 'local' | 'synced' | 'pending';
    lastSyncedAt?: number;
    version: number;
}

export interface SessionSummary {
    id: string;
    deviceId: string;
    deviceName: string;
    startedAt: number;
    endedAt?: number;
    isActive: boolean;
    tabsCount: number;
    historyCount: number;
    tasksCount: number;
    aiChatsCount: number;
    permissionsCount: number;
    activeUrl?: string;
}

export class UnifiedSessionManager extends EventEmitter {
    private static instance: UnifiedSessionManager | null = null;
    private currentSession: UnifiedSession;
    private sessionsDir: string;
    private indexFile: string;
    private saveDebounceTimer: NodeJS.Timeout | null = null;

    private constructor() {
        super();
        let baseUserData: string;
        try {
            baseUserData = (app && typeof app.getPath === 'function')
                ? app.getPath('userData')
                : path.join('/tmp', 'aartiq-data');
        } catch (_) {
            baseUserData = path.join('/tmp', 'aartiq-data');
        }
        this.sessionsDir = path.join(baseUserData, 'sessions');
        this.indexFile = path.join(this.sessionsDir, 'sessions-index.json');

        this._ensureDirectories();
        this.currentSession = this._initNewSession();
        this._saveCurrentSession();
    }

    public static getInstance(): UnifiedSessionManager {
        if (!UnifiedSessionManager.instance) {
            UnifiedSessionManager.instance = new UnifiedSessionManager();
        }
        return UnifiedSessionManager.instance;
    }

    private _ensureDirectories() {
        try {
            if (!fs.existsSync(this.sessionsDir)) {
                fs.mkdirSync(this.sessionsDir, { recursive: true });
            }
        } catch (err) {
            try {
                this.sessionsDir = path.join('/tmp', 'aartiq-sessions');
                this.indexFile = path.join(this.sessionsDir, 'sessions-index.json');
                if (!fs.existsSync(this.sessionsDir)) {
                    fs.mkdirSync(this.sessionsDir, { recursive: true });
                }
            } catch (_) {}
        }
    }

    private _initNewSession(): UnifiedSession {
        const hostname = os.hostname();
        const deviceId = `desktop-${hostname.substring(0, 8)}`;
        return {
            id: randomUUID(),
            deviceId,
            deviceInfo: {
                deviceId,
                deviceName: hostname,
                deviceType: 'desktop',
                platform: os.platform(),
                hostname,
            },
            startedAt: Date.now(),
            isActive: true,
            tabs: [],
            history: [],
            automationTasks: [],
            aiConversations: [],
            permissions: [],
            syncState: 'local',
            version: 1,
        };
    }

    public getCurrentSession(): UnifiedSession {
        return this.currentSession;
    }

    public updateTabs(tabs: SessionTab[]) {
        this.currentSession.tabs = tabs;
        this.currentSession.version += 1;
        this._scheduleSave();
        this.emit('session-updated', this.currentSession);
    }

    public addHistoryEntry(entry: Omit<SessionHistoryEntry, 'id'>) {
        const fullEntry: SessionHistoryEntry = {
            id: randomUUID(),
            ...entry,
        };
        this.currentSession.history.unshift(fullEntry);
        // Cap session history in memory to recent 200 items
        if (this.currentSession.history.length > 200) {
            this.currentSession.history.pop();
        }
        this.currentSession.version += 1;
        this._scheduleSave();
        this.emit('session-updated', this.currentSession);
    }

    public updateTask(task: SessionTask) {
        const existingIdx = this.currentSession.automationTasks.findIndex(t => t.id === task.id);
        if (existingIdx >= 0) {
            this.currentSession.automationTasks[existingIdx] = task;
        } else {
            this.currentSession.automationTasks.unshift(task);
        }
        this.currentSession.version += 1;
        this._scheduleSave();
        this.emit('session-updated', this.currentSession);
    }

    public addAiChatMessage(chatId: string, message: { role: 'user' | 'assistant' | 'system'; content: string }) {
        let chat = this.currentSession.aiConversations.find(c => c.id === chatId);
        if (!chat) {
            chat = {
                id: chatId,
                startedAt: Date.now(),
                messages: [],
            };
            this.currentSession.aiConversations.unshift(chat);
        }
        chat.messages.push({
            role: message.role,
            content: message.content,
            timestamp: Date.now(),
        });
        this.currentSession.version += 1;
        this._scheduleSave();
        this.emit('session-updated', this.currentSession);
    }

    public logPermission(log: Omit<SessionPermissionLog, 'id' | 'timestamp'>) {
        const fullLog: SessionPermissionLog = {
            id: randomUUID(),
            timestamp: Date.now(),
            ...log,
        };
        this.currentSession.permissions.unshift(fullLog);
        this.currentSession.version += 1;
        this._scheduleSave();
        this.emit('session-updated', this.currentSession);
    }

    public closeCurrentSession(): UnifiedSession {
        this.currentSession.isActive = false;
        this.currentSession.endedAt = Date.now();
        this._saveSessionToFile(this.currentSession);
        this._updateIndex(this.currentSession);

        const oldSession = this.currentSession;
        this.currentSession = this._initNewSession();
        this._saveCurrentSession();
        this.emit('session-rotated', { oldSession, newSession: this.currentSession });
        return oldSession;
    }

    private _scheduleSave() {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            this._saveCurrentSession();
        }, 1000);
    }

    private _saveCurrentSession() {
        this._saveSessionToFile(this.currentSession);
        this._updateIndex(this.currentSession);
    }

    private _saveSessionToFile(session: UnifiedSession) {
        try {
            const filePath = path.join(this.sessionsDir, `${session.id}.json`);
            fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
        } catch (err) {
            console.error('[UnifiedSessionManager] Failed to save session:', err);
        }
    }

    private _updateIndex(session: UnifiedSession) {
        try {
            const index: SessionSummary[] = this.listSessions();
            const activeTab = session.tabs.find(t => t.isActive) || session.tabs[0];
            const summary: SessionSummary = {
                id: session.id,
                deviceId: session.deviceId,
                deviceName: session.deviceInfo.deviceName,
                startedAt: session.startedAt,
                endedAt: session.endedAt,
                isActive: session.isActive,
                tabsCount: session.tabs.length,
                historyCount: session.history.length,
                tasksCount: session.automationTasks.length,
                aiChatsCount: session.aiConversations.length,
                permissionsCount: session.permissions.length,
                activeUrl: activeTab?.url,
            };

            const existingIdx = index.findIndex(s => s.id === session.id);
            if (existingIdx >= 0) {
                index[existingIdx] = summary;
            } else {
                index.unshift(summary);
            }

            fs.writeFileSync(this.indexFile, JSON.stringify(index, null, 2), 'utf-8');
        } catch (err) {
            console.error('[UnifiedSessionManager] Failed to update sessions index:', err);
        }
    }

    public listSessions(limit: number = 50): SessionSummary[] {
        try {
            if (fs.existsSync(this.indexFile)) {
                const data = fs.readFileSync(this.indexFile, 'utf-8');
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    return parsed.slice(0, limit);
                }
            }
        } catch (err) {
            console.error('[UnifiedSessionManager] Error reading sessions index:', err);
        }
        return [];
    }

    public getSessionById(sessionId: string): UnifiedSession | null {
        if (this.currentSession && this.currentSession.id === sessionId) {
            return this.currentSession;
        }

        try {
            const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf-8');
                return JSON.parse(data) as UnifiedSession;
            }
        } catch (err) {
            console.error(`[UnifiedSessionManager] Error loading session ${sessionId}:`, err);
        }
        return null;
    }

    /**
     * Payload sent to mobile to synchronize current + recent sessions
     */
    public getSyncPayload(): {
        currentSession: UnifiedSession;
        pastSessions: SessionSummary[];
    } {
        return {
            currentSession: this.currentSession,
            pastSessions: this.listSessions(20).filter(s => s.id !== this.currentSession.id),
        };
    }

    /**
     * Import a session synced from mobile or remote device
     */
    public importSession(session: UnifiedSession): boolean {
        try {
            if (!session || !session.id) return false;
            this._saveSessionToFile(session);
            this._updateIndex(session);
            this.emit('session-imported', session);
            return true;
        } catch (err) {
            console.error('[UnifiedSessionManager] Import session failed:', err);
            return false;
        }
    }
}

export const unifiedSessionManager = UnifiedSessionManager.getInstance();
