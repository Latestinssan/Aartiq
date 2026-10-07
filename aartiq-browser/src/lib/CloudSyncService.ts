import { EventEmitter } from 'events';
import { Database, ref, set, onValue, get, push, update, remove, onDisconnect, getDatabase, runTransaction } from 'firebase/database';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, User, getAuth } from 'firebase/auth';
import { getStorage, ref as storageRef, deleteObject, FirebaseStorage } from 'firebase/storage';
import { randomBytes } from 'crypto';
import firebaseService from './FirebaseService';
import { Security } from './Security';
import { CloudConfig } from './SyncMethodManager';

interface CloudDevice {
    deviceId: string;
    deviceName: string;
    deviceType: 'desktop' | 'mobile';
    platform: string;
    lastSeen: number;
    publicIp?: string;
    port?: number;
    online?: boolean;
}

interface PendingData {
    type: 'clipboard' | 'history' | 'file' | 'prompt';
    data: any;
    timestamp: number;
    deviceId: string;
}

export class CloudSyncService extends EventEmitter {
    private static instance: CloudSyncService;
    private db: Database | null = null;
    private storage: FirebaseStorage | null = null;
    private auth: any = null;
    private user: User | null = null;
    private userId: string | null = null;
    private deviceId: string = '';
    private deviceName: string = '';
    private deviceType: 'desktop' | 'mobile' = 'desktop';
    private connected: boolean = false;
    private cloudConfig: CloudConfig | null = null;
    private deviceConnections: Map<string, any> = new Map();
    private devices: Map<string, CloudDevice> = new Map();
    private unsubscribers: (() => void)[] = [];
    private syncPassphrase: string = '';
    private pendingQueue: PendingData[] = [];
    private isP2PMode: boolean = true;
    private autoCleanupInterval: NodeJS.Timeout | null = null;
    private pairingMasterKey: string | null = null;

    private constructor() {
        super();
    }

    public static getInstance(): CloudSyncService {
        if (!CloudSyncService.instance) {
            CloudSyncService.instance = new CloudSyncService();
        }
        return CloudSyncService.instance;
    }

    public async initialize(): Promise<void> {
        console.log('[CloudSync] Initializing...');

        const checkInterval = setInterval(() => {
            if (firebaseService.app && firebaseService.auth) {
                clearInterval(checkInterval);
                this._setupAuth();
            }
        }, 500);
    }

    private async _setupAuth(): Promise<void> {
        if (!firebaseService.app) return;
        this.auth = getAuth(firebaseService.app);
        this.db = getDatabase(firebaseService.app);
        this.storage = getStorage(firebaseService.app);

        onAuthStateChanged(this.auth, async (user) => {
            if (user) {
                this.user = user;
                this.userId = user.uid;
                this.connected = true;
                console.log('[CloudSync] User logged in:', user.uid);
                await this._registerDevice();
                // Both devices on this Google account must hold the same
                // pairing master key before any P2P traffic is allowed.
                await this.ensurePairingMasterKey();
                this._startListeningForDevices();
                this._startPromptListener();
                this._startAIResponseListener();
                this.emit('connected', user.uid);
            } else {
                this.user = null;
                this.userId = null;
                this.connected = false;
                this.pairingMasterKey = null;
                console.log('[CloudSync] User logged out');
                this.emit('disconnected');
            }
        });
    }

    public async configure(config: CloudConfig): Promise<boolean> {
        console.log('[CloudSync] Configuring cloud provider:', config.provider);
        this.cloudConfig = config;
        return true;
    }

    public async login(email: string, password: string): Promise<boolean> {
        if (!this.auth) {
            console.error('[CloudSync] Auth not initialized');
            return false;
        }

        try {
            await signInWithEmailAndPassword(this.auth, email, password);
            return true;
        } catch (error) {
            console.error('[CloudSync] Login failed:', error);
            return false;
        }
    }

    public async logout(): Promise<void> {
        if (this.auth) {
            await signOut(this.auth);
        }
        this._cleanup();
    }

    public isConnected(): boolean {
        return this.connected;
    }

    public getUserId(): string | null {
        return this.userId;
    }

    public setDeviceInfo(deviceId: string, deviceName: string, deviceType: 'desktop' | 'mobile'): void {
        this.deviceId = deviceId;
        this.deviceName = deviceName;
        this.deviceType = deviceType;
    }

    public setSyncPassphrase(passphrase: string): void {
        this.syncPassphrase = passphrase;
    }

    public setP2PMode(enabled: boolean): void {
        this.isP2PMode = enabled;
        console.log(`[CloudSync] P2P Mode: ${enabled ? 'enabled (temp storage only)' : 'disabled (permanent storage)'}`);
        if (enabled) {
            this._startAutoCleanup();
        }
    }

    public isP2PEnabled(): boolean {
        return this.isP2PMode;
    }

    private _startAutoCleanup(): void {
        if (this.autoCleanupInterval) return;
        
        this.autoCleanupInterval = setInterval(async () => {
            await this._cleanupOldData();
        }, 15 * 60000); // Increased to 15 minutes
    }

    private async _cleanupOldData(): Promise<void> {
        if (!this.db || !this.userId || !this.isP2PMode) return;

        try {
            const maxAge = 24 * 60 * 60 * 1000;
            const now = Date.now();

            const paths = [
                'clipboard', 'history', 'prompts', 'commands', 'files',
                'temp_clipboard', 'temp_history', 'temp_files', 'p2p_relay_metadata'
            ];
            
            for (const path of paths) {
                const dataRef = ref(this.db, `${path}/${this.userId}`);
                const snapshot = await get(dataRef);
                const data = snapshot.val();
                
                if (data && typeof data === 'object') {
                    const updated: any = {};
                    let hasUpdates = false;
                    
                    Object.entries(data).forEach(async ([key, value]: [string, any]) => {
                        if (value?.timestamp && (now - value.timestamp) > maxAge) {
                            updated[key] = null;
                            hasUpdates = true;
                            
                            // Specific cleanup for relay files in Storage
                            if (path === 'p2p_relay_metadata' && value.storagePath && this.storage) {
                                try {
                                    const fileRef = storageRef(this.storage, value.storagePath);
                                    await deleteObject(fileRef);
                                    console.log(`[CloudSync] Deleted orphan relay file: ${value.storagePath}`);
                                } catch (storageErr) {
                                    // Ignore if file already deleted
                                }
                            }
                        }
                    });
                    
                    if (hasUpdates) {
                        await update(dataRef, updated);
                        console.log(`[CloudSync] Cleaned up old ${path} data`);
                    }
                }
            }
        } catch (error) {
            this._reportSyncError('cleanup', error);
        }
    }

    public async queuePendingData(type: PendingData['type'], data: any): Promise<void> {
        if (this.connected) {
            await this._sendData(type, data);
        } else {
            this.pendingQueue.push({
                type,
                data,
                timestamp: Date.now(),
                deviceId: this.deviceId
            });
            console.log(`[CloudSync] Queued ${type} data for later sync`);
        }
    }

    private async _flushPendingQueue(): Promise<void> {
        if (!this.pendingQueue.length) return;
        
        console.log(`[CloudSync] Flushing ${this.pendingQueue.length} pending items`);
        
        for (const item of this.pendingQueue) {
            await this._sendData(item.type, item.data);
        }
        
        this.pendingQueue = [];
    }

    private async _sendData(type: PendingData['type'], data: any): Promise<void> {
        if (!this.db || !this.userId) return;

        if (this.isP2PMode && type !== 'prompt') {
            const tempRef = ref(this.db, `temp_${type}/${this.userId}/${this.deviceId}`);
            await set(tempRef, {
                data,
                timestamp: Date.now()
            });
            return;
        }

        switch (type) {
            case 'clipboard':
                await this.syncClipboard(data);
                break;
            case 'history':
                await this.syncHistory(data);
                break;
            case 'file':
                await this.syncFiles(data);
                break;
        }
    }

    /**
     * A Firebase write failed.
     *
     * Nothing in this service may fail silently: `update()`/`set()` promises
     * that are dropped on the floor reject into the void — no log, no
     * caller, no way to tell why a prompt stayed `pending` or a device
     * stayed `online`. Every write failure goes through here instead: it is
     * logged and emitted as `cloud-sync-error`, which the sync handlers
     * forward to the renderer so Settings → Sync can show it.
     */
    private _reportSyncError(operation: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[CloudSync] ${operation} failed:`, message);
        this.emit('cloud-sync-error', { operation, error: message, at: Date.now() });
    }

    private _startPromptListener(): void {
        if (!this.db || !this.userId || !this.deviceId) return;

        const promptsRef = ref(this.db, `prompts/${this.userId}/${this.deviceId}`);
        const unsubscribe = onValue(promptsRef, (snapshot) => {
            const data = snapshot.val();
            if (data && data.prompt && data.status !== 'processed') {
                console.log(`[CloudSync] Received prompt: ${data.prompt.substring(0, 30)}...`);
                
                this.emit('cloud-prompt', {
                    prompt: data.prompt,
                    promptId: data.promptId,
                    fromDeviceId: data.fromDeviceId
                });

                update(promptsRef, { status: 'processed' }).catch((err) => {
                    this._reportSyncError('mark-prompt-processed', err);
                });
            }
        });

        this.unsubscribers.push(unsubscribe);
    }

    public sendAIResponse(targetDeviceId: string, promptId: string, response: string, isStreaming: boolean): void {
        if (!this.db || !this.userId) return;

        const responseRef = ref(this.db, `aiResponses/${this.userId}/${targetDeviceId}`);
        set(responseRef, {
            promptId,
            response,
            isStreaming,
            timestamp: Date.now(),
            fromDeviceId: this.deviceId
        }).catch((err) => {
            this._reportSyncError('send-ai-response', err);
        });
    }

    private _startAIResponseListener(): void {
        if (!this.db || !this.userId || !this.deviceId) return;

        const responsesRef = ref(this.db, `aiResponses/${this.userId}/${this.deviceId}`);
        const unsubscribe = onValue(responsesRef, (snapshot) => {
            const data = snapshot.val();
            if (data && data.response !== undefined) {
                console.log(`[CloudSync] Received AI response: ${data.response.substring(0, 30)}...`);
                
                this.emit('ai-response', {
                    response: data.response,
                    promptId: data.promptId,
                    isStreaming: data.isStreaming,
                    fromDeviceId: data.fromDeviceId
                });
            }
        });

        this.unsubscribers.push(unsubscribe);
    }

    private async _registerDevice(): Promise<void> {
        if (!this.db || !this.userId || !this.deviceId) return;

        const deviceRef = ref(this.db, `devices/${this.userId}/${this.deviceId}`);
        const deviceData = {
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

        await set(deviceRef, deviceData);

        onDisconnect(deviceRef).update({ online: false, lastSeen: Date.now() }).catch((err) => {
            this._reportSyncError('device-on-disconnect-registration', err);
        });
        console.log('[CloudSync] Device registered:', this.deviceId);
    }

    public getPairingMasterKey(): string | null {
        return this.pairingMasterKey;
    }

    /**
     * Create-or-read the account-scoped master key that both devices need to
     * connect. The first device to sign in generates it; every other device
     * on the same Google account reads the identical value. A transaction
     * guarantees a single winner if both sign in simultaneously.
     */
    public async ensurePairingMasterKey(): Promise<string | null> {
        if (this.pairingMasterKey) return this.pairingMasterKey;
        if (!this.db || !this.userId) return null;
        try {
            const keyRef = ref(this.db, `pairing/${this.userId}/masterKey`);
            const result = await runTransaction(keyRef, (current: any) => {
                if (typeof current === 'string' && current.length > 0) return current;
                return randomBytes(32).toString('hex');
            });
            const key = result.snapshot.val();
            if (typeof key === 'string' && key.length > 0) {
                this.pairingMasterKey = key;
                console.log('[CloudSync] Pairing master key ready (shared by both devices)');
                return key;
            }
        } catch (error) {
            console.error('[CloudSync] Failed to ensure pairing master key:', error);
        }
        return null;
    }

    /**
     * Resolve a device's P2P inbox id from the Firebase registry
     * (devices/{uid}/{deviceId}/p2pId), falling back to the device id itself
     * for peers registered before the bridge existed.
     */
    public async resolveP2pId(deviceId: string): Promise<string> {
        if (!this.db || !this.userId || !deviceId) return deviceId;
        try {
            const snapshot = await get(ref(this.db, `devices/${this.userId}/${deviceId}/p2pId`));
            const p2pId = snapshot.val();
            if (typeof p2pId === 'string' && p2pId.length > 0 && p2pId !== deviceId) {
                return p2pId;
            }
        } catch (error) {
            console.warn('[CloudSync] p2pId lookup failed for', deviceId, error);
        }
        return deviceId;
    }

    private _startListeningForDevices(): void {
        if (!this.db || !this.userId) return;

        const devicesRef = ref(this.db, `devices/${this.userId}`);
        const unsubscribe = onValue(devicesRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                this.devices.clear();
                Object.entries(data).forEach(([id, device]: [string, any]) => {
                    if (id !== this.deviceId) {
                        this.devices.set(id, device as CloudDevice);
                        this.emit('device-updated', { id, ...device });
                    }
                });
                this.emit('devices-list-changed', Array.from(this.devices.values()));
            }
        });

        this.unsubscribers.push(unsubscribe);
    }

    public async connectToDevice(targetDeviceId: string): Promise<boolean> {
        console.log('[CloudSync] Connecting to device:', targetDeviceId);
        const device = this.devices.get(targetDeviceId);
        
        if (!device || !device.online) {
            console.error('[CloudSync] Device not available or offline');
            return false;
        }

        try {
            const connectionRef = ref(this.db!, `connections/${this.userId}/${this.deviceId}/${targetDeviceId}`);
            await set(connectionRef, {
                requestedAt: Date.now(),
                status: 'pending'
            });

            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve(false);
                }, 30000);

                const connStatusRef = ref(this.db!, `connections/${this.userId}/${targetDeviceId}/${this.deviceId}/status`);
                const unsub = onValue(connStatusRef, (snapshot) => {
                    const status = snapshot.val();
                    if (status === 'accepted') {
                        clearTimeout(timeout);
                        unsub();
                        this.deviceConnections.set(targetDeviceId, { connected: true });
                        this.emit('device-connected', targetDeviceId);
                        resolve(true);
                    } else if (status === 'rejected') {
                        clearTimeout(timeout);
                        unsub();
                        resolve(false);
                    }
                });
            });
        } catch (error) {
            console.error('[CloudSync] Connection failed:', error);
            return false;
        }
    }

    public disconnectFromDevice(targetDeviceId: string): void {
        this.deviceConnections.delete(targetDeviceId);
        this.emit('device-disconnected', targetDeviceId);
    }

    public async syncClipboard(text: string): Promise<void> {
        if (!this.db || !this.userId || !this.syncPassphrase) return;

        try {
            const encrypted = await Security.encrypt(text, this.syncPassphrase);
            const clipboardRef = ref(this.db, `clipboard/${this.userId}`);
            await set(clipboardRef, {
                content: encrypted,
                timestamp: Date.now(),
                deviceId: this.deviceId
            });
        } catch (error) {
            this._reportSyncError('clipboard-sync', error);
        }
    }

    public async syncHistory(history: string[]): Promise<void> {
        if (!this.db || !this.userId || !this.syncPassphrase) return;

        try {
            const encrypted = await Promise.all(
                history.map(item => Security.encrypt(item, this.syncPassphrase))
            );
            const historyRef = ref(this.db, `history/${this.userId}`);
            await set(historyRef, {
                items: encrypted,
                timestamp: Date.now()
            });
        } catch (error) {
            this._reportSyncError('history-sync', error);
        }
    }

    public async syncFiles(files: { path: string, name: string, data: string }[]): Promise<void> {
        if (!this.db || !this.userId || !this.syncPassphrase) return;

        try {
            const encryptedFiles = await Promise.all(
                files.map(async (file) => ({
                    ...file,
                    data: await Security.encrypt(file.data, this.syncPassphrase)
                }))
            );

            const filesRef = ref(this.db, `files/${this.userId}/${this.deviceId}`);
            await set(filesRef, {
                files: encryptedFiles,
                timestamp: Date.now()
            });
        } catch (error) {
            this._reportSyncError('file-sync', error);
        }
    }

    public async sendDesktopControl(targetDeviceId: string, action: string, args?: Record<string, any>): Promise<any> {
        if (!this.db || !this.userId) return null;

        const commandRef = ref(this.db, `commands/${this.userId}/${targetDeviceId}`);
        const commandId = `cmd_${Date.now()}`;
        
        await set(commandRef, {
            commandId,
            fromDeviceId: this.deviceId,
            action,
            args: args || {},
            timestamp: Date.now(),
            status: 'pending'
        });

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({ error: 'Timeout' });
            }, 30000);

            const responseRef = ref(this.db!, `commandResponses/${this.userId}/${commandId}`);
            const unsub = onValue(responseRef, (snapshot) => {
                const response = snapshot.val();
                if (response && response.result) {
                    clearTimeout(timeout);
                    unsub();
                    resolve(response);
                }
            });
        });
    }

    public forwardPrompt(targetDeviceId: string, prompt: string, promptId?: string): void {
        if (!this.db || !this.userId) return;

        const promptRef = ref(this.db, `prompts/${this.userId}/${targetDeviceId}`);
        set(promptRef, {
            promptId: promptId || `prompt_${Date.now()}`,
            fromDeviceId: this.deviceId,
            prompt,
            timestamp: Date.now()
        });
    }

    public getDevices(): CloudDevice[] {
        return Array.from(this.devices.values());
    }

    public getOnlineDevices(): CloudDevice[] {
        return Array.from(this.devices.values()).filter(d => d.online);
    }

    public getConnectedDevices(): string[] {
        return Array.from(this.deviceConnections.keys());
    }

    private _cleanup(): void {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        this.deviceConnections.clear();
    }

    public disconnect(): void {
        this._cleanup();
        this.connected = false;
        console.log('[CloudSync] Disconnected');
    }
}

export const cloudSyncService = CloudSyncService.getInstance();
