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
Object.defineProperty(exports, "__esModule", { value: true });
exports.unifiedSessionManager = exports.UnifiedSessionManager = void 0;
var fs = __importStar(require("fs"));
var path = __importStar(require("path"));
var os = __importStar(require("os"));
var electron_1 = require("electron");
var events_1 = require("events");
var crypto_1 = require("crypto");
var UnifiedSessionManager = /** @class */ (function (_super) {
    __extends(UnifiedSessionManager, _super);
    function UnifiedSessionManager() {
        var _this = _super.call(this) || this;
        _this.saveDebounceTimer = null;
        var baseUserData;
        try {
            baseUserData = (electron_1.app && typeof electron_1.app.getPath === 'function')
                ? electron_1.app.getPath('userData')
                : path.join('/tmp', 'aartiq-data');
        }
        catch (_) {
            baseUserData = path.join('/tmp', 'aartiq-data');
        }
        _this.sessionsDir = path.join(baseUserData, 'sessions');
        _this.indexFile = path.join(_this.sessionsDir, 'sessions-index.json');
        _this._ensureDirectories();
        _this.currentSession = _this._initNewSession();
        _this._saveCurrentSession();
        return _this;
    }
    UnifiedSessionManager.getInstance = function () {
        if (!UnifiedSessionManager.instance) {
            UnifiedSessionManager.instance = new UnifiedSessionManager();
        }
        return UnifiedSessionManager.instance;
    };
    UnifiedSessionManager.prototype._ensureDirectories = function () {
        try {
            if (!fs.existsSync(this.sessionsDir)) {
                fs.mkdirSync(this.sessionsDir, { recursive: true });
            }
        }
        catch (err) {
            try {
                this.sessionsDir = path.join('/tmp', 'aartiq-sessions');
                this.indexFile = path.join(this.sessionsDir, 'sessions-index.json');
                if (!fs.existsSync(this.sessionsDir)) {
                    fs.mkdirSync(this.sessionsDir, { recursive: true });
                }
            }
            catch (_) { }
        }
    };
    UnifiedSessionManager.prototype._initNewSession = function () {
        var hostname = os.hostname();
        var deviceId = "desktop-".concat(hostname.substring(0, 8));
        return {
            id: (0, crypto_1.randomUUID)(),
            deviceId: deviceId,
            deviceInfo: {
                deviceId: deviceId,
                deviceName: hostname,
                deviceType: 'desktop',
                platform: os.platform(),
                hostname: hostname,
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
    };
    UnifiedSessionManager.prototype.getCurrentSession = function () {
        return this.currentSession;
    };
    UnifiedSessionManager.prototype.updateTabs = function (tabs) {
        this.currentSession.tabs = tabs;
        this.currentSession.version += 1;
        this._scheduleSave();
        this.emit('session-updated', this.currentSession);
    };
    UnifiedSessionManager.prototype.addHistoryEntry = function (entry) {
        var fullEntry = __assign({ id: (0, crypto_1.randomUUID)() }, entry);
        this.currentSession.history.unshift(fullEntry);
        // Cap session history in memory to recent 200 items
        if (this.currentSession.history.length > 200) {
            this.currentSession.history.pop();
        }
        this.currentSession.version += 1;
        this._scheduleSave();
        this.emit('session-updated', this.currentSession);
    };
    UnifiedSessionManager.prototype.updateTask = function (task) {
        var existingIdx = this.currentSession.automationTasks.findIndex(function (t) { return t.id === task.id; });
        if (existingIdx >= 0) {
            this.currentSession.automationTasks[existingIdx] = task;
        }
        else {
            this.currentSession.automationTasks.unshift(task);
        }
        this.currentSession.version += 1;
        this._scheduleSave();
        this.emit('session-updated', this.currentSession);
    };
    UnifiedSessionManager.prototype.addAiChatMessage = function (chatId, message) {
        var chat = this.currentSession.aiConversations.find(function (c) { return c.id === chatId; });
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
    };
    UnifiedSessionManager.prototype.logPermission = function (log) {
        var fullLog = __assign({ id: (0, crypto_1.randomUUID)(), timestamp: Date.now() }, log);
        this.currentSession.permissions.unshift(fullLog);
        this.currentSession.version += 1;
        this._scheduleSave();
        this.emit('session-updated', this.currentSession);
    };
    UnifiedSessionManager.prototype.closeCurrentSession = function () {
        this.currentSession.isActive = false;
        this.currentSession.endedAt = Date.now();
        this._saveSessionToFile(this.currentSession);
        this._updateIndex(this.currentSession);
        var oldSession = this.currentSession;
        this.currentSession = this._initNewSession();
        this._saveCurrentSession();
        this.emit('session-rotated', { oldSession: oldSession, newSession: this.currentSession });
        return oldSession;
    };
    UnifiedSessionManager.prototype._scheduleSave = function () {
        var _this = this;
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(function () {
            _this._saveCurrentSession();
        }, 1000);
    };
    UnifiedSessionManager.prototype._saveCurrentSession = function () {
        this._saveSessionToFile(this.currentSession);
        this._updateIndex(this.currentSession);
    };
    UnifiedSessionManager.prototype._saveSessionToFile = function (session) {
        try {
            var filePath = path.join(this.sessionsDir, "".concat(session.id, ".json"));
            fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
        }
        catch (err) {
            console.error('[UnifiedSessionManager] Failed to save session:', err);
        }
    };
    UnifiedSessionManager.prototype._updateIndex = function (session) {
        try {
            var index = this.listSessions();
            var activeTab = session.tabs.find(function (t) { return t.isActive; }) || session.tabs[0];
            var summary = {
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
                activeUrl: activeTab === null || activeTab === void 0 ? void 0 : activeTab.url,
            };
            var existingIdx = index.findIndex(function (s) { return s.id === session.id; });
            if (existingIdx >= 0) {
                index[existingIdx] = summary;
            }
            else {
                index.unshift(summary);
            }
            fs.writeFileSync(this.indexFile, JSON.stringify(index, null, 2), 'utf-8');
        }
        catch (err) {
            console.error('[UnifiedSessionManager] Failed to update sessions index:', err);
        }
    };
    UnifiedSessionManager.prototype.listSessions = function (limit) {
        if (limit === void 0) { limit = 50; }
        try {
            if (fs.existsSync(this.indexFile)) {
                var data = fs.readFileSync(this.indexFile, 'utf-8');
                var parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    return parsed.slice(0, limit);
                }
            }
        }
        catch (err) {
            console.error('[UnifiedSessionManager] Error reading sessions index:', err);
        }
        return [];
    };
    UnifiedSessionManager.prototype.getSessionById = function (sessionId) {
        if (this.currentSession && this.currentSession.id === sessionId) {
            return this.currentSession;
        }
        try {
            var filePath = path.join(this.sessionsDir, "".concat(sessionId, ".json"));
            if (fs.existsSync(filePath)) {
                var data = fs.readFileSync(filePath, 'utf-8');
                return JSON.parse(data);
            }
        }
        catch (err) {
            console.error("[UnifiedSessionManager] Error loading session ".concat(sessionId, ":"), err);
        }
        return null;
    };
    /**
     * Payload sent to mobile to synchronize current + recent sessions
     */
    UnifiedSessionManager.prototype.getSyncPayload = function () {
        var _this = this;
        return {
            currentSession: this.currentSession,
            pastSessions: this.listSessions(20).filter(function (s) { return s.id !== _this.currentSession.id; }),
        };
    };
    /**
     * Import a session synced from mobile or remote device
     */
    UnifiedSessionManager.prototype.importSession = function (session) {
        try {
            if (!session || !session.id)
                return false;
            this._saveSessionToFile(session);
            this._updateIndex(session);
            this.emit('session-imported', session);
            return true;
        }
        catch (err) {
            console.error('[UnifiedSessionManager] Import session failed:', err);
            return false;
        }
    };
    UnifiedSessionManager.instance = null;
    return UnifiedSessionManager;
}(events_1.EventEmitter));
exports.UnifiedSessionManager = UnifiedSessionManager;
exports.unifiedSessionManager = UnifiedSessionManager.getInstance();
