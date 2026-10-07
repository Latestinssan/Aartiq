"use client";
import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { 
    Cloud, Wifi, WifiOff, HardDrive, Key, UploadCloud, DownloadCloud, 
    AlertTriangle, CheckCircle, RefreshCw, Info, Settings, Zap, 
    Globe, Server, Smartphone, Monitor, Users, Link, Unlink,
    Lock, Database, ChevronRight, X, Plus, Trash2, Edit3, Eye, EyeOff,
    Activity, CheckSquare, Square, Radio
} from 'lucide-react';

interface DeviceInfo {
    deviceId: string;
    deviceName: string;
    deviceType: 'desktop' | 'mobile';
    isOnline: boolean;
    connectionType: 'local' | 'cloud';
    lastSeen?: number;
    trustLevel?: 'trusted' | 'ask_once' | 'blocked';
    autoConnect?: boolean;
}

type SyncMode = 'local' | 'cloud' | 'local_cloud';
type CloudProvider = 'firebase' | 'mysql' | 'custom';

const SyncSettings: React.FC = () => {
    const store = useAppStore();
    const [syncMode, setSyncMode] = useState<SyncMode>('local');
    const [cloudProvider, setCloudProvider] = useState<CloudProvider>('firebase');
    const [wifiSyncQr, setWifiSyncQr] = useState<string | null>(null);
    const [wifiSyncInfo, setWifiSyncInfo] = useState<{deviceName: string; pairingCode: string; ip: string; port: number} | null>(null);
    const [wifiConnected, setWifiConnected] = useState(false);
    const [qrMode, setQrMode] = useState<'local' | 'cloud'>('local');
    const [cloudConnected, setCloudConnected] = useState(false);
    const [localDeviceId, setLocalDeviceId] = useState('');
    const [encryptionKey, setEncryptionKey] = useState(store.syncPassphrase || '');
    const [showCloudConfig, setShowCloudConfig] = useState(false);
    const [showDeviceList, setShowDeviceList] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [clipboardSync, setClipboardSync] = useState(true);
    const [historySync, setHistorySync] = useState(true);
    const [filesSync, setFilesSync] = useState(true);
    const [desktopControlSync, setDesktopControlSync] = useState(true);
    const [devices, setDevices] = useState<DeviceInfo[]>([]);
    const [showPassword, setShowPassword] = useState(false);
    const [customFirebaseConfig, setCustomFirebaseConfig] = useState({
        apiKey: '',
        authDomain: '',
        projectId: '',
        storageBucket: '',
        messagingSenderId: '',
        appId: ''
    });
    const [customMysqlConfig, setCustomMysqlConfig] = useState({
        host: '',
        port: 3306,
        user: '',
        password: '',
        database: ''
    });

    useEffect(() => {
        if (!window.electronAPI) return;

        const loadWifiDevices = async () => {
            try {
                const knownDevices = await window.electronAPI.getWifiSyncDevices();
                setDevices((knownDevices || []).map((device: any) => ({
                    deviceId: device.deviceId,
                    deviceName: device.deviceName,
                    deviceType: device.deviceType,
                    isOnline: !!device.online,
                    connectionType: 'local',
                    lastSeen: device.lastSeen || device.lastConnected,
                    trustLevel: device.trustLevel,
                    autoConnect: device.autoConnect,
                })));
            } catch (error) {
                console.error('[SyncSettings] Failed to load WiFi devices:', error);
            }
        };

        window.electronAPI.getWifiSyncQr(qrMode === 'cloud').then(qr => setWifiSyncQr(qr));
        window.electronAPI.getWifiSyncInfo().then(info => {
            if (info) setWifiSyncInfo(info);
        });
        loadWifiDevices();
        
        const cleanupWifiStatus = window.electronAPI.onWifiSyncStatus((data) => {
            setWifiConnected(data.connected);
        });
        const cleanupWifiDevices = window.electronAPI.onWifiSyncDevicesUpdated((updatedDevices) => {
            setDevices((updatedDevices || []).map((device: any) => ({
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                deviceType: device.deviceType,
                isOnline: !!device.online,
                connectionType: 'local',
                lastSeen: device.lastSeen || device.lastConnected,
                trustLevel: device.trustLevel,
                autoConnect: device.autoConnect,
            })));
        });

        const cleanupCloudStatus = window.electronAPI.onCloudSyncStatus((data) => {
            setCloudConnected(data.connected);
        });

        // A Firebase write that failed in the main process — shown in the same
        // status line as every other sync message, so it is never invisible.
        const cleanupCloudErrors = window.electronAPI.on('cloud-sync-error', (details: { operation?: string; error?: string; at?: number }) => {
            const when = details?.at ? new Date(details.at).toLocaleTimeString() : '';
            setStatusMessage(`Cloud sync write failed (${details?.operation || 'unknown'}${when ? ` at ${when}` : ''}): ${details?.error || 'unknown error'}`);
        });

        window.electronAPI.getP2PLocalDeviceId().then((id: string) => {
            if (id) setLocalDeviceId(id);
        });

        return () => {
            cleanupWifiStatus();
            cleanupWifiDevices();
            cleanupCloudStatus();
            cleanupCloudErrors();
        };
    }, [qrMode]);

    const setDeviceTrust = async (deviceId: string, trustLevel: 'trusted' | 'ask_once' | 'blocked', autoConnect?: boolean) => {
        if (!window.electronAPI?.setWifiSyncDeviceTrust) return;
        const result = await window.electronAPI.setWifiSyncDeviceTrust({ deviceId, trustLevel, autoConnect });
        if (!result?.success) {
            setStatusMessage(result?.error || 'Failed to update device trust');
        }
    };

    const removeDevice = async (deviceId: string) => {
        if (!window.electronAPI?.removeWifiSyncDevice) return;
        const result = await window.electronAPI.removeWifiSyncDevice(deviceId);
        if (!result?.success) {
            setStatusMessage(result?.error || 'Failed to remove device');
        }
    };

    const handleQrModeChange = async (mode: 'local' | 'cloud') => {
        setQrMode(mode);
        if (window.electronAPI) {
            const qr = await window.electronAPI.getWifiSyncQr(mode === 'cloud');
            setWifiSyncQr(qr);
        }
    };

    const handleModeChange = (mode: SyncMode) => {
        setSyncMode(mode);
        setStatusMessage(`Switched to ${mode === 'local' ? 'Local Only' : mode === 'cloud' ? 'Cloud Only' : 'Local + Cloud'} mode`);
    };

    const handleCloudLogin = async () => {
        setStatusMessage('Connecting to cloud...');
        if (window.electronAPI?.loginToCloud) {
            const success = await window.electronAPI.loginToCloud(store.userEmail || '', 'password');
            if (success) {
                setCloudConnected(true);
                setStatusMessage('Connected to cloud!');
            }
        }
    };

    const handleSaveCloudConfig = async () => {
        setStatusMessage('Saving cloud configuration...');
        if (window.electronAPI?.saveCloudConfig) {
            const config = cloudProvider === 'mysql' ? customMysqlConfig : customFirebaseConfig;
            await window.electronAPI.saveCloudConfig(cloudProvider, config);
            setStatusMessage('Cloud configuration saved!');
            setShowCloudConfig(false);
        }
    };

    const handleGenerateKey = () => {
        const newKey = crypto.randomUUID();
        setEncryptionKey(newKey);
        store.setSyncPassphrase(newKey);
        setStatusMessage('New encryption key generated!');
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                        <Zap className="text-cyan-400" size={28} />
                        Sync Center
                    </h2>
                    <p className="text-white/40 text-sm mt-1">Manage your device synchronization</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${wifiConnected ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-white/5 border-white/10 text-white/30'}`}>
                        <Radio size={12} className={wifiConnected ? 'animate-pulse' : ''} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">WiFi</span>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${cloudConnected ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/10 text-white/30'}`}>
                        <Cloud size={12} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Cloud</span>
                    </div>
                </div>
            </div>

            {/* Sync Mode Selection */}
            <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/5">
                <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Settings size={16} /> Sync Mode
                </h3>
                <div className="grid grid-cols-3 gap-4">
                    <button
                        onClick={() => handleModeChange('local')}
                        className={`relative p-5 rounded-2xl border-2 transition-all duration-300 ${
                            syncMode === 'local' 
                                ? 'border-cyan-400 bg-cyan-400/10 shadow-[0_0_20px_rgba(0,255,255,0.2)]' 
                                : 'border-white/10 hover:border-white/20 bg-white/5'
                        }`}
                    >
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 ${
                            syncMode === 'local' ? 'bg-cyan-400/20 text-cyan-400' : 'bg-white/10 text-white/40'
                        }`}>
                            <Wifi size={24} />
                        </div>
                        <h4 className="text-white font-bold text-lg">Local Only</h4>
                        <p className="text-white/40 text-xs mt-1">Same network sync</p>
                        {syncMode === 'local' && (
                            <CheckCircle size={20} className="absolute top-4 right-4 text-cyan-400" />
                        )}
                    </button>

                    <button
                        onClick={() => handleModeChange('cloud')}
                        className={`relative p-5 rounded-2xl border-2 transition-all duration-300 ${
                            syncMode === 'cloud' 
                                ? 'border-purple-400 bg-purple-400/10 shadow-[0_0_20px_rgba(168,85,247,0.2)]' 
                                : 'border-white/10 hover:border-white/20 bg-white/5'
                        }`}
                    >
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 ${
                            syncMode === 'cloud' ? 'bg-purple-400/20 text-purple-400' : 'bg-white/10 text-white/40'
                        }`}>
                            <Globe size={24} />
                        </div>
                        <h4 className="text-white font-bold text-lg">Cloud Only</h4>
                        <p className="text-white/40 text-xs mt-1">Remote access sync</p>
                        {syncMode === 'cloud' && (
                            <CheckCircle size={20} className="absolute top-4 right-4 text-purple-400" />
                        )}
                    </button>

                    <button
                        onClick={() => handleModeChange('local_cloud')}
                        className={`relative p-5 rounded-2xl border-2 transition-all duration-300 ${
                            syncMode === 'local_cloud' 
                                ? 'border-gradient-to-r from-cyan-400 to-purple-400 bg-gradient-to-br from-cyan-400/10 to-purple-400/10' 
                                : 'border-white/10 hover:border-white/20 bg-white/5'
                        }`}
                    >
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 bg-gradient-to-br from-cyan-400/20 to-purple-400/20 ${
                            syncMode === 'local_cloud' ? 'text-cyan-400' : 'text-white/40'
                        }`}>
                            <Link size={24} />
                        </div>
                        <h4 className="text-white font-bold text-lg">Local + Cloud</h4>
                        <p className="text-white/40 text-xs mt-1">Best of both worlds</p>
                        {syncMode === 'local_cloud' && (
                            <CheckCircle size={20} className="absolute top-4 right-4 text-cyan-400" />
                        )}
                    </button>
                </div>
            </div>

            {/* Cloud Configuration */}
            {(syncMode === 'cloud' || syncMode === 'local_cloud') && (
                <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider flex items-center gap-2">
                            <Server size={16} /> Cloud Configuration
                        </h3>
                        <button
                            onClick={() => setShowCloudConfig(!showCloudConfig)}
                            className="text-cyan-400 text-sm hover:underline flex items-center gap-1"
                        >
                            {showCloudConfig ? 'Hide' : 'Configure'}
                        </button>
                    </div>

                    {!showCloudConfig ? (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                                    {cloudProvider === 'firebase' ? <Database size={28} className="text-orange-400" /> : <Server size={28} className="text-blue-400" />}
                                </div>
                                <div>
                                    <h4 className="text-white font-bold">{cloudProvider === 'firebase' ? 'Firebase' : 'MySQL'}</h4>
                                    <p className="text-white/40 text-xs">
                                        {cloudProvider === 'firebase' ? 'Real-time database sync' : 'Custom database sync'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleCloudLogin}
                                    className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white font-bold rounded-xl transition-all"
                                >
                                    {cloudConnected ? 'Connected' : 'Connect'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Provider Selection */}
                            <div className="flex gap-3 mb-4">
                                <button
                                    onClick={() => setCloudProvider('firebase')}
                                    className={`flex-1 p-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${
                                        cloudProvider === 'firebase' ? 'border-orange-400 bg-orange-400/10 text-orange-400' : 'border-white/10 text-white/40'
                                    }`}
                                >
                                    <Database size={18} /> Firebase
                                </button>
                                <button
                                    onClick={() => setCloudProvider('mysql')}
                                    className={`flex-1 p-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${
                                        cloudProvider === 'mysql' ? 'border-blue-400 bg-blue-400/10 text-blue-400' : 'border-white/10 text-white/40'
                                    }`}
                                >
                                    <Server size={18} /> MySQL
                                </button>
                                <button
                                    onClick={() => setCloudProvider('custom')}
                                    className={`flex-1 p-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${
                                        cloudProvider === 'custom' ? 'border-purple-400 bg-purple-400/10 text-purple-400' : 'border-white/10 text-white/40'
                                    }`}
                                >
                                    <Settings size={18} /> Custom
                                </button>
                            </div>

                            {cloudProvider === 'firebase' && (
                                <div className="grid grid-cols-2 gap-4">
                                    <input
                                        type="text"
                                        placeholder="API Key"
                                        className="bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-cyan-400/50"
                                        value={customFirebaseConfig.apiKey}
                                        onChange={(e) => setCustomFirebaseConfig({...customFirebaseConfig, apiKey: e.target.value})}
                                    />
                                    <input
                                        type="text"
                                        placeholder="Auth Domain"
                                        className="bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-cyan-400/50"
                                        value={customFirebaseConfig.authDomain}
                                        onChange={(e) => setCustomFirebaseConfig({...customFirebaseConfig, authDomain: e.target.value})}
                                    />
                                    <input
                                        type="text"
                                        placeholder="Project ID"
                                        className="bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-cyan-400/50"
                                        value={customFirebaseConfig.projectId}
                                        onChange={(e) => setCustomFirebaseConfig({...customFirebaseConfig, projectId: e.target.value})}
                                    />
                                    <input
                                        type="text"
                                        placeholder="Storage Bucket"
                                        className="bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-cyan-400/50"
                                        value={customFirebaseConfig.storageBucket}
                                        onChange={(e) => setCustomFirebaseConfig({...customFirebaseConfig, storageBucket: e.target.value})}
                                    />
                                    <input
                                        type="text"
                                        placeholder="Messaging Sender ID"
                                        className="bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-cyan-400/50"
                                        value={customFirebaseConfig.messagingSenderId}
                                        onChange={(e) => setCustomFirebaseConfig({...customFirebaseConfig, messagingSenderId: e.target.value})}
                                    />
                                    <input
                                        type="text"
                                        placeholder="App ID"
                                        className="bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-cyan-400/50"
                                        value={customFirebaseConfig.appId}
                                        onChange={(e) => setCustomFirebaseConfig({...customFirebaseConfig, appId: e.target.value})}
                                    />
                                </div>
                            )}

                            {cloudProvider === 'mysql' && (
                                <div className="grid grid-cols-2 gap-4">
                                    <input
                                        type="text"
                                        placeholder="Host"
                                        className="bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-blue-400/50"
                                        value={customMysqlConfig.host}
                                        onChange={(e) => setCustomMysqlConfig({...customMysqlConfig, host: e.target.value})}
                                    />
                                    <input
                                        type="number"
                                        placeholder="Port"
                                        className="bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-blue-400/50"
                                        value={customMysqlConfig.port}
                                        onChange={(e) => setCustomMysqlConfig({...customMysqlConfig, port: parseInt(e.target.value)})}
                                    />
                                    <input
                                        type="text"
                                        placeholder="Database User"
                                        className="bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-blue-400/50"
                                        value={customMysqlConfig.user}
                                        onChange={(e) => setCustomMysqlConfig({...customMysqlConfig, user: e.target.value})}
                                    />
                                    <div className="relative">
                                        <input
                                            type={showPassword ? "text" : "password"}
                                            placeholder="Database Password"
                                            className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-blue-400/50 pr-12"
                                            value={customMysqlConfig.password}
                                            onChange={(e) => setCustomMysqlConfig({...customMysqlConfig, password: e.target.value})}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                                        >
                                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Database Name"
                                        className="bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-blue-400/50 col-span-2"
                                        value={customMysqlConfig.database}
                                        onChange={(e) => setCustomMysqlConfig({...customMysqlConfig, database: e.target.value})}
                                    />
                                </div>
                            )}

                            <button
                                onClick={handleSaveCloudConfig}
                                className="w-full py-3 bg-gradient-to-r from-cyan-500 to-purple-500 text-white font-bold rounded-xl hover:scale-[1.02] transition-all"
                            >
                                Save Configuration
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* WiFi Sync Section */}
            {(syncMode === 'local' || syncMode === 'local_cloud') && (
                <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider flex items-center gap-2">
                            <Wifi size={16} /> QR Sync
                        </h3>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleQrModeChange('local')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    qrMode === 'local' 
                                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' 
                                        : 'bg-white/5 text-white/40 border border-white/10'
                                }`}
                            >
                                Local
                            </button>
                            <button
                                onClick={() => handleQrModeChange('cloud')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    qrMode === 'cloud' 
                                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' 
                                        : 'bg-white/5 text-white/40 border border-white/10'
                                }`}
                            >
                                Cloud
                            </button>
                        </div>
                    </div>
                    
                    {!wifiConnected ? (
                        <div className="flex items-center gap-8">
                            <div className="p-4 bg-white rounded-2xl relative">
                                {wifiSyncQr ? (
                                    <>
                                        <img src={wifiSyncQr} alt="WiFi QR" className="w-40 h-40" />
                                        {qrMode === 'cloud' && (
                                            <div className="absolute -top-2 -right-2 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                                                <Cloud size={14} className="text-white" />
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="w-40 h-40 flex items-center justify-center">
                                        <RefreshCw className="animate-spin text-cyan-400" size={32} />
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 space-y-3">
                                {qrMode === 'local' ? (
                                    <>
                                        <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                                            <span className="text-white/60 text-sm">Pairing Code</span>
                                            <span className="text-cyan-400 font-black text-2xl tracking-widest">
                                                {wifiSyncInfo?.pairingCode || '------'}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-white/40">
                                            <span>IP: {wifiSyncInfo?.ip || '...'}</span>
                                            <span>Port: {wifiSyncInfo?.port || '3004'}</span>
                                        </div>
                                        <p className="text-white/30 text-xs">
                                            Scan QR code or use pairing code from mobile app
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-3 p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                                            <Cloud size={20} className="text-purple-400" />
                                            <div>
                                                <span className="text-white/60 text-sm">Cloud Sync</span>
                                                <p className="text-white/30 text-xs">Sync via your account across any network</p>
                                            </div>
                                        </div>
                                        <p className="text-white/30 text-xs">
                                            Scan QR with Aartiq mobile app logged into same account
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-4 p-4 bg-green-500/10 border border-green-500/30 rounded-2xl">
                            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                                <CheckCircle className="text-green-400" size={24} />
                            </div>
                            <div>
                                <h4 className="text-white font-bold">Mobile Device Connected</h4>
                                <p className="text-white/40 text-sm">Ready for remote commands</p>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Device Family */}
            <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider flex items-center gap-2">
                        <Users size={16} /> Device Family
                    </h3>
                    <button
                        onClick={() => setShowDeviceList(!showDeviceList)}
                        className="text-cyan-400 text-sm flex items-center gap-1"
                    >
                        {showDeviceList ? 'Hide' : 'View'} Devices
                    </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
                            <Monitor size={24} className="text-cyan-400" />
                        </div>
                        <div>
                            <h4 className="text-white font-bold">{localDeviceId || 'Desktop'}</h4>
                            <p className="text-white/40 text-xs">This device</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-lg">Online</span>
                    </div>
                </div>

                {showDeviceList && devices.length > 0 && (
                    <div className="mt-4 space-y-2">
                        {devices.map((device) => (
                            <div key={device.deviceId} className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                                        {device.deviceType === 'desktop' ? 
                                            <Monitor size={20} className="text-white/60" /> : 
                                            <Smartphone size={20} className="text-white/60" />
                                        }
                                    </div>
                                    <div>
                                        <h4 className="text-white font-bold text-sm">{device.deviceName}</h4>
                                        <p className="text-white/30 text-xs">{device.deviceId}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 text-xs rounded-lg ${device.isOnline ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/30'}`}>
                                        {device.isOnline ? 'Online' : 'Offline'}
                                    </span>
                                    <span className={`px-2 py-1 text-xs rounded-lg ${device.connectionType === 'cloud' ? 'bg-purple-500/20 text-purple-400' : 'bg-cyan-500/20 text-cyan-400'}`}>
                                        {device.connectionType}
                                    </span>
                                    <span className={`px-2 py-1 text-xs rounded-lg ${device.trustLevel === 'trusted' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-white/40'}`}>
                                        {device.trustLevel === 'trusted' ? 'Trusted' : 'Needs Trust'}
                                    </span>
                                    {device.deviceType === 'mobile' && (
                                        <>
                                            <button
                                                onClick={() => setDeviceTrust(device.deviceId, device.trustLevel === 'trusted' ? 'ask_once' : 'trusted')}
                                                className={`px-3 py-1 text-xs rounded-lg transition-all ${device.trustLevel === 'trusted' ? 'bg-white/10 text-white/60 hover:bg-white/15' : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'}`}
                                            >
                                                {device.trustLevel === 'trusted' ? 'Untrust' : 'Trust'}
                                            </button>
                                            <button
                                                onClick={() => removeDevice(device.deviceId)}
                                                className="p-2 rounded-lg bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-all"
                                                title="Remove device"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Sync Options */}
            <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/5">
                <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Activity size={16} /> Sync Options
                </h3>
                
                <div className="space-y-3">
                    {[
                        { id: 'clipboard', label: 'Clipboard Sync', icon: Copy, enabled: clipboardSync, setter: setClipboardSync },
                        { id: 'history', label: 'History Sync', icon: RefreshCw, enabled: historySync, setter: setHistorySync },
                        { id: 'files', label: 'File Sync', icon: HardDrive, enabled: filesSync, setter: setFilesSync },
                        { id: 'desktopControl', label: 'Desktop Control', icon: Monitor, enabled: desktopControlSync, setter: setDesktopControlSync },
                    ].map((option) => (
                        <button
                            key={option.id}
                            onClick={() => option.setter(!option.enabled)}
                            className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${
                                option.enabled 
                                    ? 'bg-cyan-400/10 border-cyan-400/30' 
                                    : 'bg-white/5 border-white/5'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                <option.icon size={20} className={option.enabled ? 'text-cyan-400' : 'text-white/30'} />
                                <span className={option.enabled ? 'text-white' : 'text-white/40'}>{option.label}</span>
                            </div>
                            {option.enabled ? 
                                <CheckSquare size={20} className="text-cyan-400" /> : 
                                <Square size={20} className="text-white/20" />
                            }
                        </button>
                    ))}
                </div>
            </div>

            {/* Encryption Key */}
            <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/5">
                <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Lock size={16} /> Encryption
                </h3>
                
                <div className="flex gap-3">
                    <input
                        type="password"
                        placeholder="Encryption key"
                        className="flex-1 bg-black/40 border border-white/10 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-cyan-400/50"
                        value={encryptionKey}
                        onChange={(e) => setEncryptionKey(e.target.value)}
                    />
                    <button
                        onClick={handleGenerateKey}
                        className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white/60 rounded-xl transition-all"
                    >
                        <RefreshCw size={18} />
                    </button>
                    <button
                        onClick={() => {
                            store.setSyncPassphrase(encryptionKey);
                            setStatusMessage('Encryption key saved!');
                        }}
                        className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-white font-bold rounded-xl transition-all"
                    >
                        Save
                    </button>
                </div>
            </div>

            {/* Status Message */}
            {statusMessage && (
                <div className="flex items-center gap-3 p-4 bg-cyan-500/10 border border-cyan-500/30 rounded-xl">
                    <Info size={18} className="text-cyan-400" />
                    <span className="text-white/80 text-sm">{statusMessage}</span>
                    <button onClick={() => setStatusMessage('')} className="ml-auto text-white/40 hover:text-white">
                        <X size={18} />
                    </button>
                </div>
            )}
        </div>
    );
};

const Copy = ({ size, className }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
);

export default SyncSettings;
