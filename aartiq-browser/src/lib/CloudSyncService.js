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
exports.cloudSyncService = exports.CloudSyncService = void 0;
var events_1 = require("events");
var database_1 = require("firebase/database");
var auth_1 = require("firebase/auth");
var storage_1 = require("firebase/storage");
var crypto_1 = require("crypto");
var FirebaseService_1 = __importDefault(require("./FirebaseService"));
var Security_1 = require("./Security");
var CloudSyncService = /** @class */ (function (_super) {
    __extends(CloudSyncService, _super);
    function CloudSyncService() {
        var _this = _super.call(this) || this;
        _this.db = null;
        _this.storage = null;
        _this.auth = null;
        _this.user = null;
        _this.userId = null;
        _this.deviceId = '';
        _this.deviceName = '';
        _this.deviceType = 'desktop';
        _this.connected = false;
        _this.cloudConfig = null;
        _this.deviceConnections = new Map();
        _this.devices = new Map();
        _this.unsubscribers = [];
        _this.syncPassphrase = '';
        _this.pendingQueue = [];
        _this.isP2PMode = true;
        _this.autoCleanupInterval = null;
        _this.pairingMasterKey = null;
        return _this;
    }
    CloudSyncService.getInstance = function () {
        if (!CloudSyncService.instance) {
            CloudSyncService.instance = new CloudSyncService();
        }
        return CloudSyncService.instance;
    };
    CloudSyncService.prototype.initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            var checkInterval;
            var _this = this;
            return __generator(this, function (_a) {
                console.log('[CloudSync] Initializing...');
                checkInterval = setInterval(function () {
                    if (FirebaseService_1.default.app && FirebaseService_1.default.auth) {
                        clearInterval(checkInterval);
                        _this._setupAuth();
                    }
                }, 500);
                return [2 /*return*/];
            });
        });
    };
    CloudSyncService.prototype._setupAuth = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                if (!FirebaseService_1.default.app)
                    return [2 /*return*/];
                this.auth = (0, auth_1.getAuth)(FirebaseService_1.default.app);
                this.db = (0, database_1.getDatabase)(FirebaseService_1.default.app);
                this.storage = (0, storage_1.getStorage)(FirebaseService_1.default.app);
                (0, auth_1.onAuthStateChanged)(this.auth, function (user) { return __awaiter(_this, void 0, void 0, function () {
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                if (!user) return [3 /*break*/, 3];
                                this.user = user;
                                this.userId = user.uid;
                                this.connected = true;
                                console.log('[CloudSync] User logged in:', user.uid);
                                return [4 /*yield*/, this._registerDevice()];
                            case 1:
                                _a.sent();
                                // Both devices on this Google account must hold the same
                                // pairing master key before any P2P traffic is allowed.
                                return [4 /*yield*/, this.ensurePairingMasterKey()];
                            case 2:
                                // Both devices on this Google account must hold the same
                                // pairing master key before any P2P traffic is allowed.
                                _a.sent();
                                this._startListeningForDevices();
                                this._startPromptListener();
                                this._startAIResponseListener();
                                this.emit('connected', user.uid);
                                return [3 /*break*/, 4];
                            case 3:
                                this.user = null;
                                this.userId = null;
                                this.connected = false;
                                this.pairingMasterKey = null;
                                console.log('[CloudSync] User logged out');
                                this.emit('disconnected');
                                _a.label = 4;
                            case 4: return [2 /*return*/];
                        }
                    });
                }); });
                return [2 /*return*/];
            });
        });
    };
    CloudSyncService.prototype.configure = function (config) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                console.log('[CloudSync] Configuring cloud provider:', config.provider);
                this.cloudConfig = config;
                return [2 /*return*/, true];
            });
        });
    };
    CloudSyncService.prototype.login = function (email, password) {
        return __awaiter(this, void 0, void 0, function () {
            var error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.auth) {
                            console.error('[CloudSync] Auth not initialized');
                            return [2 /*return*/, false];
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, (0, auth_1.signInWithEmailAndPassword)(this.auth, email, password)];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, true];
                    case 3:
                        error_1 = _a.sent();
                        console.error('[CloudSync] Login failed:', error_1);
                        return [2 /*return*/, false];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    CloudSyncService.prototype.logout = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.auth) return [3 /*break*/, 2];
                        return [4 /*yield*/, (0, auth_1.signOut)(this.auth)];
                    case 1:
                        _a.sent();
                        _a.label = 2;
                    case 2:
                        this._cleanup();
                        return [2 /*return*/];
                }
            });
        });
    };
    CloudSyncService.prototype.isConnected = function () {
        return this.connected;
    };
    CloudSyncService.prototype.getUserId = function () {
        return this.userId;
    };
    CloudSyncService.prototype.setDeviceInfo = function (deviceId, deviceName, deviceType) {
        this.deviceId = deviceId;
        this.deviceName = deviceName;
        this.deviceType = deviceType;
    };
    CloudSyncService.prototype.setSyncPassphrase = function (passphrase) {
        this.syncPassphrase = passphrase;
    };
    CloudSyncService.prototype.setP2PMode = function (enabled) {
        this.isP2PMode = enabled;
        console.log("[CloudSync] P2P Mode: ".concat(enabled ? 'enabled (temp storage only)' : 'disabled (permanent storage)'));
        if (enabled) {
            this._startAutoCleanup();
        }
    };
    CloudSyncService.prototype.isP2PEnabled = function () {
        return this.isP2PMode;
    };
    CloudSyncService.prototype._startAutoCleanup = function () {
        var _this = this;
        if (this.autoCleanupInterval)
            return;
        this.autoCleanupInterval = setInterval(function () { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._cleanupOldData()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); }, 15 * 60000); // Increased to 15 minutes
    };
    CloudSyncService.prototype._cleanupOldData = function () {
        return __awaiter(this, void 0, void 0, function () {
            var maxAge_1, now_1, paths, _loop_1, this_1, _i, paths_1, path, error_2;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.db || !this.userId || !this.isP2PMode)
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 6, , 7]);
                        maxAge_1 = 24 * 60 * 60 * 1000;
                        now_1 = Date.now();
                        paths = [
                            'clipboard', 'history', 'prompts', 'commands', 'files',
                            'temp_clipboard', 'temp_history', 'temp_files', 'p2p_relay_metadata'
                        ];
                        _loop_1 = function (path) {
                            var dataRef, snapshot, data, updated_1, hasUpdates_1;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        dataRef = (0, database_1.ref)(this_1.db, "".concat(path, "/").concat(this_1.userId));
                                        return [4 /*yield*/, (0, database_1.get)(dataRef)];
                                    case 1:
                                        snapshot = _b.sent();
                                        data = snapshot.val();
                                        if (!(data && typeof data === 'object')) return [3 /*break*/, 3];
                                        updated_1 = {};
                                        hasUpdates_1 = false;
                                        Object.entries(data).forEach(function (_a) { return __awaiter(_this, [_a], void 0, function (_b) {
                                            var fileRef, storageErr_1;
                                            var key = _b[0], value = _b[1];
                                            return __generator(this, function (_c) {
                                                switch (_c.label) {
                                                    case 0:
                                                        if (!((value === null || value === void 0 ? void 0 : value.timestamp) && (now_1 - value.timestamp) > maxAge_1)) return [3 /*break*/, 4];
                                                        updated_1[key] = null;
                                                        hasUpdates_1 = true;
                                                        if (!(path === 'p2p_relay_metadata' && value.storagePath && this.storage)) return [3 /*break*/, 4];
                                                        _c.label = 1;
                                                    case 1:
                                                        _c.trys.push([1, 3, , 4]);
                                                        fileRef = (0, storage_1.ref)(this.storage, value.storagePath);
                                                        return [4 /*yield*/, (0, storage_1.deleteObject)(fileRef)];
                                                    case 2:
                                                        _c.sent();
                                                        console.log("[CloudSync] Deleted orphan relay file: ".concat(value.storagePath));
                                                        return [3 /*break*/, 4];
                                                    case 3:
                                                        storageErr_1 = _c.sent();
                                                        return [3 /*break*/, 4];
                                                    case 4: return [2 /*return*/];
                                                }
                                            });
                                        }); });
                                        if (!hasUpdates_1) return [3 /*break*/, 3];
                                        return [4 /*yield*/, (0, database_1.update)(dataRef, updated_1)];
                                    case 2:
                                        _b.sent();
                                        console.log("[CloudSync] Cleaned up old ".concat(path, " data"));
                                        _b.label = 3;
                                    case 3: return [2 /*return*/];
                                }
                            });
                        };
                        this_1 = this;
                        _i = 0, paths_1 = paths;
                        _a.label = 2;
                    case 2:
                        if (!(_i < paths_1.length)) return [3 /*break*/, 5];
                        path = paths_1[_i];
                        return [5 /*yield**/, _loop_1(path)];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4:
                        _i++;
                        return [3 /*break*/, 2];
                    case 5: return [3 /*break*/, 7];
                    case 6:
                        error_2 = _a.sent();
                        console.error('[CloudSync] Cleanup error:', error_2);
                        return [3 /*break*/, 7];
                    case 7: return [2 /*return*/];
                }
            });
        });
    };
    CloudSyncService.prototype.queuePendingData = function (type, data) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.connected) return [3 /*break*/, 2];
                        return [4 /*yield*/, this._sendData(type, data)];
                    case 1:
                        _a.sent();
                        return [3 /*break*/, 3];
                    case 2:
                        this.pendingQueue.push({
                            type: type,
                            data: data,
                            timestamp: Date.now(),
                            deviceId: this.deviceId
                        });
                        console.log("[CloudSync] Queued ".concat(type, " data for later sync"));
                        _a.label = 3;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    CloudSyncService.prototype._flushPendingQueue = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _i, _a, item;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!this.pendingQueue.length)
                            return [2 /*return*/];
                        console.log("[CloudSync] Flushing ".concat(this.pendingQueue.length, " pending items"));
                        _i = 0, _a = this.pendingQueue;
                        _b.label = 1;
                    case 1:
                        if (!(_i < _a.length)) return [3 /*break*/, 4];
                        item = _a[_i];
                        return [4 /*yield*/, this._sendData(item.type, item.data)];
                    case 2:
                        _b.sent();
                        _b.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 1];
                    case 4:
                        this.pendingQueue = [];
                        return [2 /*return*/];
                }
            });
        });
    };
    CloudSyncService.prototype._sendData = function (type, data) {
        return __awaiter(this, void 0, void 0, function () {
            var tempRef, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!this.db || !this.userId)
                            return [2 /*return*/];
                        if (!(this.isP2PMode && type !== 'prompt')) return [3 /*break*/, 2];
                        tempRef = (0, database_1.ref)(this.db, "temp_".concat(type, "/").concat(this.userId, "/").concat(this.deviceId));
                        return [4 /*yield*/, (0, database_1.set)(tempRef, {
                                data: data,
                                timestamp: Date.now()
                            })];
                    case 1:
                        _b.sent();
                        return [2 /*return*/];
                    case 2:
                        _a = type;
                        switch (_a) {
                            case 'clipboard': return [3 /*break*/, 3];
                            case 'history': return [3 /*break*/, 5];
                            case 'file': return [3 /*break*/, 7];
                        }
                        return [3 /*break*/, 9];
                    case 3: return [4 /*yield*/, this.syncClipboard(data)];
                    case 4:
                        _b.sent();
                        return [3 /*break*/, 9];
                    case 5: return [4 /*yield*/, this.syncHistory(data)];
                    case 6:
                        _b.sent();
                        return [3 /*break*/, 9];
                    case 7: return [4 /*yield*/, this.syncFiles(data)];
                    case 8:
                        _b.sent();
                        return [3 /*break*/, 9];
                    case 9: return [2 /*return*/];
                }
            });
        });
    };
    CloudSyncService.prototype._startPromptListener = function () {
        var _this = this;
        if (!this.db || !this.userId || !this.deviceId)
            return;
        var promptsRef = (0, database_1.ref)(this.db, "prompts/".concat(this.userId, "/").concat(this.deviceId));
        var unsubscribe = (0, database_1.onValue)(promptsRef, function (snapshot) {
            var data = snapshot.val();
            if (data && data.prompt && data.status !== 'processed') {
                console.log("[CloudSync] Received prompt: ".concat(data.prompt.substring(0, 30), "..."));
                _this.emit('cloud-prompt', {
                    prompt: data.prompt,
                    promptId: data.promptId,
                    fromDeviceId: data.fromDeviceId
                });
                (0, database_1.update)(promptsRef, { status: 'processed' });
            }
        });
        this.unsubscribers.push(unsubscribe);
    };
    CloudSyncService.prototype.sendAIResponse = function (targetDeviceId, promptId, response, isStreaming) {
        if (!this.db || !this.userId)
            return;
        var responseRef = (0, database_1.ref)(this.db, "aiResponses/".concat(this.userId, "/").concat(targetDeviceId));
        (0, database_1.set)(responseRef, {
            promptId: promptId,
            response: response,
            isStreaming: isStreaming,
            timestamp: Date.now(),
            fromDeviceId: this.deviceId
        });
    };
    CloudSyncService.prototype._startAIResponseListener = function () {
        var _this = this;
        if (!this.db || !this.userId || !this.deviceId)
            return;
        var responsesRef = (0, database_1.ref)(this.db, "aiResponses/".concat(this.userId, "/").concat(this.deviceId));
        var unsubscribe = (0, database_1.onValue)(responsesRef, function (snapshot) {
            var data = snapshot.val();
            if (data && data.response !== undefined) {
                console.log("[CloudSync] Received AI response: ".concat(data.response.substring(0, 30), "..."));
                _this.emit('ai-response', {
                    response: data.response,
                    promptId: data.promptId,
                    isStreaming: data.isStreaming,
                    fromDeviceId: data.fromDeviceId
                });
            }
        });
        this.unsubscribers.push(unsubscribe);
    };
    CloudSyncService.prototype._registerDevice = function () {
        return __awaiter(this, void 0, void 0, function () {
            var deviceRef, deviceData;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.db || !this.userId || !this.deviceId)
                            return [2 /*return*/];
                        deviceRef = (0, database_1.ref)(this.db, "devices/".concat(this.userId, "/").concat(this.deviceId));
                        deviceData = {
                            deviceId: this.deviceId,
                            // P2P inbox id — both devices read this from the registry to find
                            // each other's Firebase signal inbox (p2p_signals/{uid}/{p2pId}).
                            p2pId: this.deviceId,
                            deviceName: this.deviceName,
                            deviceType: this.deviceType,
                            platform: process.platform,
                            lastSeen: Date.now(),
                            online: true,
                            port: this.deviceType === 'desktop' ? 3004 : undefined
                        };
                        return [4 /*yield*/, (0, database_1.set)(deviceRef, deviceData)];
                    case 1:
                        _a.sent();
                        (0, database_1.onDisconnect)(deviceRef).update({ online: false, lastSeen: Date.now() });
                        console.log('[CloudSync] Device registered:', this.deviceId);
                        return [2 /*return*/];
                }
            });
        });
    };
    CloudSyncService.prototype.getPairingMasterKey = function () {
        return this.pairingMasterKey;
    };
    /**
     * Create-or-read the account-scoped master key that both devices need to
     * connect. The first device to sign in generates it; every other device
     * on the same Google account reads the identical value. A transaction
     * guarantees a single winner if both sign in simultaneously.
     */
    CloudSyncService.prototype.ensurePairingMasterKey = function () {
        return __awaiter(this, void 0, void 0, function () {
            var keyRef, result, key, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.pairingMasterKey)
                            return [2 /*return*/, this.pairingMasterKey];
                        if (!this.db || !this.userId)
                            return [2 /*return*/, null];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        keyRef = (0, database_1.ref)(this.db, "pairing/".concat(this.userId, "/masterKey"));
                        return [4 /*yield*/, (0, database_1.runTransaction)(keyRef, function (current) {
                                if (typeof current === 'string' && current.length > 0)
                                    return current;
                                return (0, crypto_1.randomBytes)(32).toString('hex');
                            })];
                    case 2:
                        result = _a.sent();
                        key = result.snapshot.val();
                        if (typeof key === 'string' && key.length > 0) {
                            this.pairingMasterKey = key;
                            console.log('[CloudSync] Pairing master key ready (shared by both devices)');
                            return [2 /*return*/, key];
                        }
                        return [3 /*break*/, 4];
                    case 3:
                        error_3 = _a.sent();
                        console.error('[CloudSync] Failed to ensure pairing master key:', error_3);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/, null];
                }
            });
        });
    };
    /**
     * Resolve a device's P2P inbox id from the Firebase registry
     * (devices/{uid}/{deviceId}/p2pId), falling back to the device id itself
     * for peers registered before the bridge existed.
     */
    CloudSyncService.prototype.resolveP2pId = function (deviceId) {
        return __awaiter(this, void 0, void 0, function () {
            var snapshot, p2pId, error_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.db || !this.userId || !deviceId)
                            return [2 /*return*/, deviceId];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, (0, database_1.get)((0, database_1.ref)(this.db, "devices/".concat(this.userId, "/").concat(deviceId, "/p2pId")))];
                    case 2:
                        snapshot = _a.sent();
                        p2pId = snapshot.val();
                        if (typeof p2pId === 'string' && p2pId.length > 0 && p2pId !== deviceId) {
                            return [2 /*return*/, p2pId];
                        }
                        return [3 /*break*/, 4];
                    case 3:
                        error_4 = _a.sent();
                        console.warn('[CloudSync] p2pId lookup failed for', deviceId, error_4);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/, deviceId];
                }
            });
        });
    };
    CloudSyncService.prototype._startListeningForDevices = function () {
        var _this = this;
        if (!this.db || !this.userId)
            return;
        var devicesRef = (0, database_1.ref)(this.db, "devices/".concat(this.userId));
        var unsubscribe = (0, database_1.onValue)(devicesRef, function (snapshot) {
            var data = snapshot.val();
            if (data) {
                _this.devices.clear();
                Object.entries(data).forEach(function (_a) {
                    var id = _a[0], device = _a[1];
                    if (id !== _this.deviceId) {
                        _this.devices.set(id, device);
                        _this.emit('device-updated', __assign({ id: id }, device));
                    }
                });
                _this.emit('devices-list-changed', Array.from(_this.devices.values()));
            }
        });
        this.unsubscribers.push(unsubscribe);
    };
    CloudSyncService.prototype.connectToDevice = function (targetDeviceId) {
        return __awaiter(this, void 0, void 0, function () {
            var device, connectionRef, error_5;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.log('[CloudSync] Connecting to device:', targetDeviceId);
                        device = this.devices.get(targetDeviceId);
                        if (!device || !device.online) {
                            console.error('[CloudSync] Device not available or offline');
                            return [2 /*return*/, false];
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        connectionRef = (0, database_1.ref)(this.db, "connections/".concat(this.userId, "/").concat(this.deviceId, "/").concat(targetDeviceId));
                        return [4 /*yield*/, (0, database_1.set)(connectionRef, {
                                requestedAt: Date.now(),
                                status: 'pending'
                            })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, new Promise(function (resolve) {
                                var timeout = setTimeout(function () {
                                    resolve(false);
                                }, 30000);
                                var connStatusRef = (0, database_1.ref)(_this.db, "connections/".concat(_this.userId, "/").concat(targetDeviceId, "/").concat(_this.deviceId, "/status"));
                                var unsub = (0, database_1.onValue)(connStatusRef, function (snapshot) {
                                    var status = snapshot.val();
                                    if (status === 'accepted') {
                                        clearTimeout(timeout);
                                        unsub();
                                        _this.deviceConnections.set(targetDeviceId, { connected: true });
                                        _this.emit('device-connected', targetDeviceId);
                                        resolve(true);
                                    }
                                    else if (status === 'rejected') {
                                        clearTimeout(timeout);
                                        unsub();
                                        resolve(false);
                                    }
                                });
                            })];
                    case 3:
                        error_5 = _a.sent();
                        console.error('[CloudSync] Connection failed:', error_5);
                        return [2 /*return*/, false];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    CloudSyncService.prototype.disconnectFromDevice = function (targetDeviceId) {
        this.deviceConnections.delete(targetDeviceId);
        this.emit('device-disconnected', targetDeviceId);
    };
    CloudSyncService.prototype.syncClipboard = function (text) {
        return __awaiter(this, void 0, void 0, function () {
            var encrypted, clipboardRef, error_6;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.db || !this.userId || !this.syncPassphrase)
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        return [4 /*yield*/, Security_1.Security.encrypt(text, this.syncPassphrase)];
                    case 2:
                        encrypted = _a.sent();
                        clipboardRef = (0, database_1.ref)(this.db, "clipboard/".concat(this.userId));
                        return [4 /*yield*/, (0, database_1.set)(clipboardRef, {
                                content: encrypted,
                                timestamp: Date.now(),
                                deviceId: this.deviceId
                            })];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        error_6 = _a.sent();
                        console.error('[CloudSync] Clipboard sync failed:', error_6);
                        return [3 /*break*/, 5];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    CloudSyncService.prototype.syncHistory = function (history) {
        return __awaiter(this, void 0, void 0, function () {
            var encrypted, historyRef, error_7;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.db || !this.userId || !this.syncPassphrase)
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        return [4 /*yield*/, Promise.all(history.map(function (item) { return Security_1.Security.encrypt(item, _this.syncPassphrase); }))];
                    case 2:
                        encrypted = _a.sent();
                        historyRef = (0, database_1.ref)(this.db, "history/".concat(this.userId));
                        return [4 /*yield*/, (0, database_1.set)(historyRef, {
                                items: encrypted,
                                timestamp: Date.now()
                            })];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        error_7 = _a.sent();
                        console.error('[CloudSync] History sync failed:', error_7);
                        return [3 /*break*/, 5];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    CloudSyncService.prototype.syncFiles = function (files) {
        return __awaiter(this, void 0, void 0, function () {
            var encryptedFiles, filesRef, error_8;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.db || !this.userId || !this.syncPassphrase)
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        return [4 /*yield*/, Promise.all(files.map(function (file) { return __awaiter(_this, void 0, void 0, function () {
                                var _a;
                                var _b;
                                return __generator(this, function (_c) {
                                    switch (_c.label) {
                                        case 0:
                                            _a = [__assign({}, file)];
                                            _b = {};
                                            return [4 /*yield*/, Security_1.Security.encrypt(file.data, this.syncPassphrase)];
                                        case 1: return [2 /*return*/, (__assign.apply(void 0, _a.concat([(_b.data = _c.sent(), _b)])))];
                                    }
                                });
                            }); }))];
                    case 2:
                        encryptedFiles = _a.sent();
                        filesRef = (0, database_1.ref)(this.db, "files/".concat(this.userId, "/").concat(this.deviceId));
                        return [4 /*yield*/, (0, database_1.set)(filesRef, {
                                files: encryptedFiles,
                                timestamp: Date.now()
                            })];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        error_8 = _a.sent();
                        console.error('[CloudSync] File sync failed:', error_8);
                        return [3 /*break*/, 5];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    CloudSyncService.prototype.sendDesktopControl = function (targetDeviceId, action, args) {
        return __awaiter(this, void 0, void 0, function () {
            var commandRef, commandId;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.db || !this.userId)
                            return [2 /*return*/, null];
                        commandRef = (0, database_1.ref)(this.db, "commands/".concat(this.userId, "/").concat(targetDeviceId));
                        commandId = "cmd_".concat(Date.now());
                        return [4 /*yield*/, (0, database_1.set)(commandRef, {
                                commandId: commandId,
                                fromDeviceId: this.deviceId,
                                action: action,
                                args: args || {},
                                timestamp: Date.now(),
                                status: 'pending'
                            })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, new Promise(function (resolve) {
                                var timeout = setTimeout(function () {
                                    resolve({ error: 'Timeout' });
                                }, 30000);
                                var responseRef = (0, database_1.ref)(_this.db, "commandResponses/".concat(_this.userId, "/").concat(commandId));
                                var unsub = (0, database_1.onValue)(responseRef, function (snapshot) {
                                    var response = snapshot.val();
                                    if (response && response.result) {
                                        clearTimeout(timeout);
                                        unsub();
                                        resolve(response);
                                    }
                                });
                            })];
                }
            });
        });
    };
    CloudSyncService.prototype.forwardPrompt = function (targetDeviceId, prompt, promptId) {
        if (!this.db || !this.userId)
            return;
        var promptRef = (0, database_1.ref)(this.db, "prompts/".concat(this.userId, "/").concat(targetDeviceId));
        (0, database_1.set)(promptRef, {
            promptId: promptId || "prompt_".concat(Date.now()),
            fromDeviceId: this.deviceId,
            prompt: prompt,
            timestamp: Date.now()
        });
    };
    CloudSyncService.prototype.getDevices = function () {
        return Array.from(this.devices.values());
    };
    CloudSyncService.prototype.getOnlineDevices = function () {
        return Array.from(this.devices.values()).filter(function (d) { return d.online; });
    };
    CloudSyncService.prototype.getConnectedDevices = function () {
        return Array.from(this.deviceConnections.keys());
    };
    CloudSyncService.prototype._cleanup = function () {
        this.unsubscribers.forEach(function (unsub) { return unsub(); });
        this.unsubscribers = [];
        this.deviceConnections.clear();
    };
    CloudSyncService.prototype.disconnect = function () {
        this._cleanup();
        this.connected = false;
        console.log('[CloudSync] Disconnected');
    };
    return CloudSyncService;
}(events_1.EventEmitter));
exports.CloudSyncService = CloudSyncService;
exports.cloudSyncService = CloudSyncService.getInstance();
