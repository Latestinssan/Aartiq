
/**
 * Peer-to-Peer File Sync Service
 * Syncs files, folders, images, PDFs across devices without cloud storage
 * Uses WebRTC for direct device-to-device transfer
 */

import { EventEmitter } from 'events';
import firebaseService from './FirebaseService';
import { getDatabase, ref, set, onValue, off, Database, DataSnapshot } from 'firebase/database';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject, FirebaseStorage } from 'firebase/storage';

export interface SyncFolder {
    id: string;
    localPath: string;
    remotePath: string;
    deviceId: string;
    autoSync: boolean;
    syncTypes: string[]; // ['images', 'pdfs', 'documents', 'all']
    lastSync: number;
}

export interface FileMetadata {
    id: string;
    name: string;
    path: string;
    size: number;
    type: string;
    hash: string;
    modifiedTime: number;
    iv?: string; // Base64 encoded ArrayBuffer
    authTag?: string; // Base64 encoded ArrayBuffer
    salt?: string; // Base64 encoded ArrayBuffer
    storagePath?: string; // Path in Firebase Storage
    downloadURL?: string; // Download URL from Firebase Storage
    senderDeviceId?: string; // The device that sent the file
    timestamp?: number; // When the file was relayed
}

// Define a type for the successful encryption/decryption result
interface EncryptionSuccessResult {
    encryptedData: ArrayBuffer;
    iv: ArrayBuffer;
    authTag: ArrayBuffer;
    salt: ArrayBuffer;
}

interface DecryptionSuccessResult {
    decryptedData: ArrayBuffer;
}

// Define a type for the error result
interface ErrorResult {
    error: string;
}

// Union types
type EncryptResult = EncryptionSuccessResult | ErrorResult;
type DecryptResult = DecryptionSuccessResult | ErrorResult;

// Type guard function
function isErrorResult(result: EncryptResult | DecryptResult): result is ErrorResult {
    return (result as ErrorResult).error !== undefined;
}

export class P2PFileSyncService extends EventEmitter {
    private peerConnection: RTCPeerConnection | null = null;
    private dataChannel: RTCDataChannel | null = null;
    private syncFolders: Map<string, SyncFolder> = new Map();
    private deviceId: string;
    private isConnected: boolean = false;
    private db: Database | null = null;
    private storage: FirebaseStorage | null = null; // Add storage property
    private userId: string | null = null;
    private remoteDeviceId: string | null = null; // Track the device we are trying to connect to
    private _initiator: boolean = true; // true = we create the offer, false = we answer
    private _passphrase: string;

    private static generatePassphrase(): string {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID() + crypto.randomUUID();
        }
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        const array = new Uint8Array(64);
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(array);
        } else {
            const nodeCrypto = require('crypto');
            const buf = nodeCrypto.randomBytes(64);
            for (let i = 0; i < 64; i++) array[i] = buf[i];
        }
        for (let i = 0; i < 64; i++) result += chars[array[i] % chars.length];
        return result;
    }

    constructor(deviceId: string, passphrase?: string) {
        super();
        this.deviceId = deviceId;
        this._passphrase = passphrase || P2PFileSyncService.generatePassphrase();
        this.initializeFirebase();
    }

    setPassphrase(passphrase: string): void {
        if (passphrase && passphrase.length >= 8) {
            this._passphrase = passphrase;
        }
    }

    private initializeFirebase() {
        firebaseService.onAuthReady(() => {
            if (firebaseService.app && firebaseService.auth?.currentUser) {
                this.db = getDatabase(firebaseService.app);
                this.storage = getStorage(firebaseService.app);
                this.userId = firebaseService.auth.currentUser.uid;
                console.log('[P2P] Firebase initialized for user:', this.userId);
                this.emit('firebase-ready', this.userId);
                this._listenForRelayFiles(); // Start listening for relayed files
                // Always listen on OUR OWN inbox (p2p_signals/{uid}/{ourId}).
                // Previously the only listener was attached to the remote
                // device's inbox, so answers from the peer were never seen and
                // a phone-initiated offer was never answered.
                this._subscribeOwnSignals();
                // Make sure the account-scoped master key exists before any
                // signal needs to be signed or verified.
                this._cloudSync()?.ensurePairingMasterKey?.()?.catch?.(() => {});
            } else {
                console.warn('[P2P] Firebase not ready or no user logged in.');
            }
        });
    }

    /** Lazy access to the cloud sync singleton (avoids module-load cycles). */
    private _cloudSync(): any {
        try {
            return require('./CloudSyncService').cloudSyncService;
        } catch (_) {
            return null;
        }
    }

    private _ownSignalsSubscribed = false;

    private _subscribeOwnSignals(): void {
        if (!this.db || !this.userId || this._ownSignalsSubscribed) return;
        this._ownSignalsSubscribed = true;
        const signalRef = ref(this.db, `p2p_signals/${this.userId}/${this.deviceId}`);
        onValue(signalRef, (snapshot) => this._handleFirebaseSignal(snapshot));
    }

    /**
     * Fetch the shared pairing master key, creating it if this is the first
     * device of the account to ask. Returns null when cloud sync/auth is not
     * available — callers fail closed in that case.
     */
    private async _getMasterKey(): Promise<string | null> {
        const cloud = this._cloudSync();
        if (!cloud) return null;
        let key = typeof cloud.getPairingMasterKey === 'function' ? cloud.getPairingMasterKey() : null;
        if (!key && typeof cloud.ensurePairingMasterKey === 'function') {
            key = await cloud.ensurePairingMasterKey().catch(() => null);
        }
        return key || null;
    }

    // Call this from the renderer process when a connection is desired
    public async connectToRemoteDevice(remoteDeviceId: string): Promise<boolean> {
        if (!this.userId || !this.db) {
            console.error('[P2P] User not authenticated for Firebase signaling.');
            return false;
        }

        // Bridge: resolve the peer's P2P inbox id from the Firebase device
        // registry (devices/{uid}/{deviceId}/p2pId) so both devices find each
        // other by their recorded P2P id rather than by convention.
        const cloud = this._cloudSync();
        if (cloud && typeof cloud.resolveP2pId === 'function') {
            try {
                remoteDeviceId = await cloud.resolveP2pId(remoteDeviceId);
            } catch (_) {
                // fall back to the id we were given
            }
        }
        this.remoteDeviceId = remoteDeviceId;

        this._subscribeOwnSignals();

        return this.initializeP2PConnection(remoteDeviceId, true);
    }

    // Method to send signaling data via Firebase
    public async sendSignal(signal: any, remoteDeviceId: string) {
        if (!this.db || !this.userId || !remoteDeviceId) {
            console.error('[P2P] Cannot send signal: Firebase not ready, no user, or no remote device.');
            return;
        }
        // Both devices must hold the same account master key; unsigned
        // signals are never emitted (receivers fail closed).
        const masterKey = await this._getMasterKey();
        if (!masterKey) {
            console.error('[P2P] Not sending signal: shared pairing master key unavailable.');
            return;
        }
        const { computeSignalAuth } = require('./pairing-auth');
        const timestamp = Date.now();
        const signalPath = `p2p_signals/${this.userId}/${remoteDeviceId}`;
        await set(ref(this.db, signalPath), {
            signal,
            sender: this.deviceId,
            timestamp,
            auth: computeSignalAuth(masterKey, timestamp),
        });
        console.log(`[P2P] Sent signal to ${remoteDeviceId} via Firebase:`, signal);
    }

    private _pendingRemoteCandidates: any[] = [];

    // Handle incoming signaling data from Firebase
    private async _handleFirebaseSignal(snapshot: DataSnapshot) {
        const data = snapshot.val();
        if (!data || data.sender === this.deviceId) {
            return; // empty (or our own echo)
        }

        // Master-key gate: reject signals from anything that is not a device
        // on the same Google account holding the same shared key.
        const masterKey = await this._getMasterKey();
        const { verifySignalAuth } = require('./pairing-auth');
        if (!verifySignalAuth(masterKey, data.auth, data.timestamp)) {
            console.warn('[P2P] Rejected signal from', data.sender, '— master-key authentication failed');
            set(snapshot.ref, null);
            return;
        }

        const signal = data.signal;
        const sender = data.sender;
        console.log('[P2P] Received signal from Firebase:', sender);

        try {
            if (signal?.sdp) {
                await this._handleRemoteSdp(signal.sdp, sender);
            } else if (signal?.candidate) {
                if (this.peerConnection) {
                    await this.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
                } else {
                    // Candidate arrived before the peer connection exists — hold it.
                    this._pendingRemoteCandidates.push(signal.candidate);
                }
            }
        } catch (e) {
            console.error('[P2P] Error handling signal:', e);
        }
        // Clear the signal after processing to avoid re-processing
        set(snapshot.ref, null);
    }

    private async _handleRemoteSdp(sdp: any, sender: string) {
        const type = sdp?.type;
        if (type === 'offer') {
            this.remoteDeviceId = sender;
            // Answer on a connection configured as non-initiator (recreating
            // if we previously started our own negotiation).
            if (!this.peerConnection || this._initiator) {
                await this.initializeP2PConnection(sender, false);
            }
            await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await this.peerConnection!.createAnswer();
            await this.peerConnection!.setLocalDescription(answer);
            await this.sendSignal({ sdp: this.peerConnection!.localDescription }, sender);
            await this._flushPendingCandidates();
        } else if (type === 'answer') {
            if (this.peerConnection) {
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
                await this._flushPendingCandidates();
            }
        }
    }

    private async _flushPendingCandidates() {
        const pending = this._pendingRemoteCandidates.splice(0);
        for (const candidate of pending) {
            try {
                await this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.warn('[P2P] Failed to add queued ICE candidate:', e);
            }
        }
    }

    /**
     * Initialize WebRTC connection for P2P file transfer
     */
    async initializeP2PConnection(remoteDeviceId: string, initiator: boolean = true): Promise<boolean> {
        try {
            // Create peer connection with STUN servers
            if (this.peerConnection) {
                try { this.peerConnection.close(); } catch (_) { /* already closed */ }
                this.peerConnection = null;
            }
            this._initiator = initiator;
            this._pendingRemoteCandidates = [];
            this.remoteDeviceId = remoteDeviceId;
            this.peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            });

            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate && this.remoteDeviceId) {
                    this.sendSignal({ candidate: event.candidate }, this.remoteDeviceId);
                }
            };

            this.peerConnection.onnegotiationneeded = async () => {
                if (!this._initiator) return; // answer side drives negotiation explicitly
                try {
                    const offer = await this.peerConnection!.createOffer();
                    await this.peerConnection!.setLocalDescription(offer);
                    if (this.remoteDeviceId) {
                        this.sendSignal({ sdp: this.peerConnection!.localDescription }, this.remoteDeviceId);
                    }
                } catch (err) {
                    console.error('[P2P] Error creating or sending offer:', err);
                }
            };

            this.peerConnection.ondatachannel = (event) => {
                this.dataChannel = event.channel;
                this.setupDataChannel();
            };

            if (initiator) {
                // Creating the data channel triggers onnegotiationneeded → offer.
                this.dataChannel = this.peerConnection.createDataChannel('sync-channel');
                this.setupDataChannel();
            }
            return true;
        } catch (error) {
            console.error('[P2P] Connection failed:', error);
            return false;
        }
    }


    private setupDataChannel() {
        if (!this.dataChannel) return;

        this.dataChannel.onopen = () => {
            this.isConnected = true;
            this.emit('connected');
            console.log('[P2P] Data channel opened');
        };

        this.dataChannel.onclose = () => {
            this.isConnected = false;
            this.emit('disconnected');
            console.log('[P2P] Data channel closed');
        };

        this.dataChannel.onmessage = (event) => {
            this.handleIncomingData(event.data);
        };
    }

    /**
     * Add folder to sync configuration
     */
    addSyncFolder(config: Omit<SyncFolder, 'id' | 'lastSync'>): string {
        const id = `sync-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const folder: SyncFolder = {
            ...config,
            id,
            lastSync: 0
        };

        this.syncFolders.set(id, folder);
        this.emit('folder-added', folder);
        return id;
    }

    /**
     * Remove folder from sync
     */
    removeSyncFolder(id: string): boolean {
        const removed = this.syncFolders.delete(id);
        if (removed) {
            this.emit('folder-removed', id);
        }
        return removed;
    }

    /**
     * Get all sync folders
     */
    getSyncFolders(): SyncFolder[] {
        return Array.from(this.syncFolders.values());
    }

    /**
     * Scan folder and get file metadata
     */
    /**
     * Scan folder and get file metadata
     */
    async scanFolder(folderPath: string, types: string[]): Promise<FileMetadata[]> {
        if (typeof window !== 'undefined' && window.electronAPI) {
            return await window.electronAPI.scanFolder(folderPath, types);
        }

        // Main process implementation
        const fs = require('fs');
        const path = require('path');
        const results: FileMetadata[] = [];

        const scanRecursive = async (currentPath: string) => {
            const entries = fs.readdirSync(currentPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                if (entry.isDirectory()) {
                    await scanRecursive(fullPath);
                } else {
                    const ext = path.extname(entry.name).toLowerCase();
                    let match = false;
                    if (types.includes('all')) match = true;
                    else if (types.includes('images') && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) match = true;
                    else if (types.includes('pdfs') && ext === '.pdf') match = true;
                    else if (types.includes('documents') && ['.doc', '.docx', '.txt', '.md', '.rtf'].includes(ext)) match = true;

                    if (match) {
                        const stats = fs.statSync(fullPath);
                        results.push({
                            id: `file-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
                            name: entry.name,
                            path: fullPath,
                            size: stats.size,
                            type: ext.substring(1),
                            hash: '',
                            modifiedTime: stats.mtimeMs
                        });
                    }
                }
            }
        };

        try {
            await scanRecursive(folderPath);
        } catch (e) {
            console.error('[P2P] Scan error:', e);
        }
        return results;
    }

    /**
     * Sync specific folder
     */
    async syncFolder(folderId: string): Promise<{ success: boolean; filesSynced: number }> {
        const folder = this.syncFolders.get(folderId);
        if (!folder) {
            return { success: false, filesSynced: 0 };
        }

        if (!this.isConnected) {
            console.error('[P2P] Not connected to remote device');
            return { success: false, filesSynced: 0 };
        }

        try {
            // Scan local folder
            const localFiles = await this.scanFolder(folder.localPath, folder.syncTypes);

            // Request remote file list
            this.sendMessage({
                type: 'file-list-request',
                folderId,
                path: folder.remotePath
            });

            // Wait for response and compare
            // Transfer only changed files
            this.emit('sync-started', { folderId, fileCount: localFiles.length });

            let filesSynced = 0;
            for (const file of localFiles) {
                const transferred = await this.transferFile(file);
                if (transferred) filesSynced++;

                this.emit('sync-progress', {
                    folderId,
                    current: filesSynced,
                    total: localFiles.length
                });
            }

            folder.lastSync = Date.now();
            this.emit('sync-completed', { folderId, filesSynced });

            return { success: true, filesSynced };
        } catch (error) {
            console.error('[P2P] Sync failed, attempting relay...', error);

            // RELAY LOGIC: If P2P fails (offline), use temporary server relay
            return await this.syncViaRelay(folderId);
        }
    }

    /**
     * Relay & Queue System (For Offline Hardware)
     * Saves temporary file to server, deletes after sync complete.
     */
    private async syncViaRelay(folderId: string): Promise<{ success: boolean; filesSynced: number }> {
        const folder = this.syncFolders.get(folderId);
        if (!folder || !this.db || !this.storage || !this.userId || !this.remoteDeviceId) {
            console.error('[Relay] Offline sync failed: folder, DB, Storage, userId, or remoteDeviceId not available.');
            return { success: false, filesSynced: 0 };
        }

        console.log(`[Relay] Device ${this.remoteDeviceId} is offline. Queueing files to temporary Firebase Storage...`);

        try {
            const localFiles = await this.scanFolder(folder.localPath, folder.syncTypes);
            let filesQueued = 0;
            for (const file of localFiles) {
                const fileData = await this.readFileData(file.path);
                const encryptResult: EncryptResult = await this.encryptData(fileData, this._passphrase);

                if (isErrorResult(encryptResult)) {
                    console.error('[Relay] Encryption failed:', encryptResult.error);
                    continue;
                }
                const { encryptedData, iv, authTag, salt } = encryptResult;

                // Upload to Firebase Storage
                const storagePath = `users/${this.userId}/temp_relay_files/${this.remoteDeviceId}/${file.id}`;
                const fileRef = storageRef(this.storage, storagePath);
                await uploadBytes(fileRef, new Uint8Array(encryptedData));
                const downloadURL = await getDownloadURL(fileRef);

                // Store metadata in Firebase Realtime Database
                const fileRelayMetadata: FileMetadata = {
                    ...file,
                    storagePath,
                    downloadURL,
                    iv: Buffer.from(iv).toString('base64'),
                    authTag: Buffer.from(authTag).toString('base64'),
                    salt: Buffer.from(salt).toString('base64'),
                    senderDeviceId: this.deviceId,
                    timestamp: Date.now()
                };
                await set(ref(this.db, `p2p_relay_metadata/${this.remoteDeviceId}/${file.id}`), fileRelayMetadata);

                console.log(`[Relay] Uploaded ${file.name} to Firebase Storage and added metadata to DB.`);
                filesQueued++;
            }

            this.emit('relay-queued', { folderId, count: filesQueued });
            return { success: true, filesSynced: filesQueued };
        } catch (e: any) {
            console.error('[Relay] Offline queue failed:', e);
            return { success: false, filesSynced: 0 };
        }
    }

    private _relayListenerOff: (() => void) | null = null;
    private _listenForRelayFiles() {
        if (!this.db || !this.storage || !this.userId) return;

        const relayRef = ref(this.db, `p2p_relay_metadata/${this.deviceId}`);
        this._relayListenerOff = onValue(relayRef, async (snapshot) => {
            const filesToProcess = snapshot.val();
            if (!filesToProcess) return;

            for (const fileId in filesToProcess) {
                const fileMetadata: FileMetadata = filesToProcess[fileId];
                console.log(`[Relay] Device ${this.deviceId} detected new file to download: ${fileMetadata.name}`);

                try {
                    // Download from Firebase Storage
                    const fileRef = storageRef(this.storage!, fileMetadata.storagePath!);
                    const arrayBuffer = await (await fetch(fileMetadata.downloadURL!)).arrayBuffer();

                    const decryptResult: DecryptResult = await this.decryptData(
                        arrayBuffer,
                        this._passphrase,
                        Buffer.from(fileMetadata.iv!, 'base64').buffer,
                        Buffer.from(fileMetadata.authTag!, 'base64').buffer,
                        Buffer.from(fileMetadata.salt!, 'base64').buffer
                    );

                    if (isErrorResult(decryptResult)) {
                        console.error('[Relay] Decryption failed:', decryptResult.error);
                        continue;
                    }
                    const { decryptedData } = decryptResult;

                    // TODO: Save file locally (Electron main process will handle this via IPC)
                    console.log(`[Relay] Decrypted ${fileMetadata.name}. Ready to save locally.`);

                    // Delete metadata and file from Firebase after successful processing
                    await set(ref(this.db!, `p2p_relay_metadata/${this.deviceId}/${fileId}`), null);
                    await deleteObject(fileRef);
                    console.log(`[Relay] Cleaned up ${fileMetadata.name} from Firebase.`);

                    this.emit('file-relayed', { ...fileMetadata, decryptedData });
                } catch (e) {
                    console.error(`[Relay] Error processing relayed file ${fileMetadata.name}:`, e);
                }
            }
        });
    }

    /**
     * Transfer single file via P2P
     */
    private async transferFile(file: FileMetadata): Promise<boolean> {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            return false;
        }

        try {
            // Read file in chunks
            const CHUNK_SIZE = 16384; // 16KB chunks
            const fileData = await this.readFileData(file.path);

            // Send file metadata
            this.sendMessage({
                type: 'file-transfer-start',
                metadata: file
            });

            // Send file data in chunks
            for (let offset = 0; offset < fileData.byteLength; offset += CHUNK_SIZE) {
                const chunk = fileData.slice(offset, offset + CHUNK_SIZE);
                this.dataChannel.send(chunk);

                // Wait for buffer to drain if needed
                while (this.dataChannel.bufferedAmount > CHUNK_SIZE * 4) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }

            // Send completion message
            this.sendMessage({
                type: 'file-transfer-complete',
                fileId: file.id
            });

            return true;
        } catch (error) {
            console.error('[P2P] File transfer failed:', error);
            return false;
        }
    }

    private async readFileData(filePath: string): Promise<ArrayBuffer> {
        if (typeof window !== 'undefined' && window.electronAPI) {
            return await window.electronAPI.readFileBuffer(filePath);
        }

        // Main process implementation
        const fs = require('fs');
        try {
            const buffer = fs.readFileSync(filePath);
            return buffer.buffer;
        } catch (e) {
            console.error('[P2P] Read file error:', e);
            return new ArrayBuffer(0);
        }
    }

    private async encryptData(data: ArrayBuffer, key: string): Promise<EncryptResult> {
        if (typeof window !== 'undefined' && window.electronAPI) {
            return await window.electronAPI.encryptData(data, key);
        }

        // Node implementation
        const crypto = require('crypto');
        return new Promise((resolve) => {
            try {
                const salt = crypto.randomBytes(16);
                crypto.pbkdf2(key, salt, 100000, 32, 'sha512', (err: any, derivedKey: any) => {
                    if (err) {
                        resolve({ error: err.message });
                        return;
                    }
                    const iv = crypto.randomBytes(16);
                    const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
                    const encrypted = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
                    const authTag = cipher.getAuthTag();
                    resolve({
                        encryptedData: encrypted.buffer,
                        iv: iv.buffer,
                        authTag: authTag.buffer,
                        salt: salt.buffer
                    });
                });
            } catch (e: any) {
                resolve({ error: e.message });
            }
        });
    }

    private async decryptData(encryptedData: ArrayBuffer, key: string, iv: ArrayBuffer, authTag: ArrayBuffer, salt: ArrayBuffer): Promise<DecryptResult> {
        if (typeof window !== 'undefined' && window.electronAPI) {
            return await window.electronAPI.decryptData(encryptedData, key, iv, authTag, salt);
        }

        // Node implementation
        const crypto = require('crypto');
        return new Promise((resolve) => {
            try {
                crypto.pbkdf2(key, Buffer.from(salt), 100000, 32, 'sha512', (err: any, derivedKey: any) => {
                    if (err) {
                        resolve({ error: err.message });
                        return;
                    }
                    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, Buffer.from(iv));
                    decipher.setAuthTag(Buffer.from(authTag));
                    const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedData)), decipher.final()]);
                    resolve({ decryptedData: decrypted.buffer });
                });
            } catch (e: any) {
                resolve({ error: e.message });
            }
        });
    }

    private sendMessage(message: any) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(message));
        }
    }

    private handleIncomingData(data: any) {
        try {
            if (typeof data === 'string') {
                const message = JSON.parse(data);
                this.emit('message', message);

                switch (message.type) {
                    case 'file-list-request':
                        this.handleFileListRequest(message);
                        break;
                    case 'file-transfer-start':
                        this.handleFileTransferStart(message);
                        break;
                    case 'file-transfer-complete':
                        this.handleFileTransferComplete(message);
                        break;
                }
            } else {
                // Binary data (file chunk)
                this.emit('file-chunk', data);
            }
        } catch (error) {
            console.error('[P2P] Message handling failed:', error);
        }
    }

    private async handleFileListRequest(message: any) {
        const files = await this.scanFolder(message.path, ['all']);
        this.sendMessage({
            type: 'file-list-response',
            folderId: message.folderId,
            files
        });
    }

    private handleFileTransferStart(message: any) {
        this.emit('file-receiving', message.metadata);
    }

    private handleFileTransferComplete(message: any) {
        this.emit('file-received', message.fileId);
    }

    /**
     * Disconnect P2P connection
     */
    disconnect() {
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        if (this.db && this.userId && this.remoteDeviceId) {
            // Clean up Firebase signaling listener
            const signalRef = ref(this.db, `p2p_signals/${this.userId}/${this.remoteDeviceId}`);
            off(signalRef);
        }
        // Clean up Firebase relay listener
        if (this._relayListenerOff) {
            this._relayListenerOff();
            this._relayListenerOff = null;
        }
        this.isConnected = false;
        this.emit('disconnected');
    }

    /**
     * Get connection status
     */
    getStatus(): { connected: boolean; deviceId: string; syncFolders: number } {
        return {
            connected: this.isConnected,
            deviceId: this.deviceId,
            syncFolders: this.syncFolders.size
        };
    }
}

// Singleton instance
let p2pSyncInstance: P2PFileSyncService | null = null;

export function getP2PSync(deviceId?: string): P2PFileSyncService {
    if (!p2pSyncInstance && deviceId) {
        p2pSyncInstance = new P2PFileSyncService(deviceId);
    }
    return p2pSyncInstance!;
}
