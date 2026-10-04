"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useAppStore, BrowserState } from '@/store/useAppStore';
import {
    Monitor, Shield, Globe, Info, Download,
    ChevronRight, ShieldCheck, Key, Package, Keyboard,
    Briefcase, ShieldAlert, Database, LogIn, LogOut, History as HistoryIcon, User as UserIcon, Zap, RefreshCw, Languages, Music2, Eye, EyeOff, Lock, BookOpen, Sparkles, Puzzle, ScanLine, LayoutGrid
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useSidebarPrefs } from './sidebar/useSidebarPrefs';
import CustomizationPanel from './sidebar/CustomizationPanel';
import SearchEngineSettings from './SearchEngineSettings';
import KeyboardShortcutSettings from './KeyboardShortcutSettings';
import UserAgentSettings from './UserAgentSettings';
import AutofillSettings from './AutofillSettings';
import AdminDashboard from './AdminDashboard';
import HistoryPanel from './HistoryPanel';
import ApiKeysSettings from './ApiKeysSettings';
import PerformanceSettings from './PerformanceSettings';
import LoginPrompt from './LoginPrompt';
import firebaseService from '@/lib/FirebaseService';
import { User } from 'firebase/auth';
import SyncSettings from './SyncSettings'; // Import the new SyncSettings component
import { firebaseConfigStorage } from '@/lib/firebaseConfigStorage';
import ExtensionSettings from './ExtensionSettings';
import McpSettings from './McpSettings';
import PermissionSettings from './PermissionSettings';
import AutomationSettings from './AutomationSettings';
import UpdatesSettings from './UpdatesSettings';
import PluginSettings from './PluginSettings';
import { useAppVersion } from '@/lib/useAppVersion';
import ThemeSettings from './ThemeSettings';
import AiMemoryManagerSection from './ai/AiMemoryManagerSection';

const SettingsPanel = ({ onClose, defaultSection = 'profile' }: { onClose: () => void, defaultSection?: string }) => {
    const store = useAppStore();
    const setUser = useAppStore((state: BrowserState) => state.setUser);
    const fetchHistory = useAppStore((state: BrowserState) => state.fetchHistory);
    const [activeSection, setActiveSection] = React.useState(store.settingsSection || defaultSection);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [licenseKey, setLicenseKey] = useState("");
    const { isGuestMode, setGuestMode } = useAppStore();
    const [showFirebaseConfig, setShowFirebaseConfig] = useState(false);
    const [showMysqlConfig, setShowMysqlConfig] = useState(false);
    const [automationMode, setAutomationMode] = useState<'dom' | 'ocr'>('dom');
    const versionLabel = `v${useAppVersion()}`;
    const isMacOS = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
    const sidebar = useSidebarPrefs();
    const [showSidebarCustomize, setShowSidebarCustomize] = useState(false);

    useEffect(() => {
      window.electronAPI?.loadPersistentData('automation_mode').then((r: any) => {
        if (r?.data === 'dom' || r?.data === 'ocr') setAutomationMode(r.data);
      }).catch(() => {});
    }, []);

    useEffect(() => {
        if (store.settingsSection && store.settingsSection !== activeSection) {
            setActiveSection(store.settingsSection);
        }
    }, [store.settingsSection]);

    useEffect(() => {
        // Listen for auth state changes to update the UI
        const unsubscribe = firebaseService.onAuthStateChanged((user) => {
            setCurrentUser(user);
            if (user) {
                setUser({ uid: user.uid, email: user.email || '', displayName: user.displayName || '', photoURL: user.photoURL || '' });
                fetchHistory();
            } else {
                // Avoid force-logging-out sessions established via custom auth flows when Firebase isn't signed in
                console.warn('[Auth] Firebase auth is null; retaining existing local session.');
            }
        });

        // Handle the redirect result when the component mounts
        firebaseService.handleRedirectResult()
            .then(user => {
                if (user) {
                    setCurrentUser(user);
                    setUser({ uid: user.uid, email: user.email || '', displayName: user.displayName || '', photoURL: user.photoURL || '' });
                    fetchHistory();
                }
            })
            .catch(err => console.error("Firebase redirect result error:", err));

        // Listen for auth-callback from main process to handle OAuth redirect
        let authCallbackUnsubscribe: (() => void) | null = null;
        if (window.electronAPI?.onAuthCallback) {
            authCallbackUnsubscribe = window.electronAPI.onAuthCallback(async (url: string) => {
                console.log('[Auth] Received auth callback, processing redirect result...');
                try {
                    const user = await firebaseService.handleRedirectResult();
                    if (user) {
                        setCurrentUser(user);
                        setUser({ uid: user.uid, email: user.email || '', displayName: user.displayName || '', photoURL: user.photoURL || '' });
                        fetchHistory();
                    }
                } catch (err) {
                    console.error('[Auth] Error handling redirect result:', err);
                }
            });
        }

        return () => {
            unsubscribe();
            if (authCallbackUnsubscribe) authCallbackUnsubscribe();
        };
    }, [setUser, fetchHistory]);

    const handleLogin = async () => {
        if (window.electronAPI) {
            const authUrl = `https://aartiq-three.vercel.app/auth?client_id=desktop-app&redirect_uri=aartiq-browser%3A%2F%2Fauth&firebase_config=${btoa(JSON.stringify(firebaseConfigStorage.load() || {}))}`;
            window.electronAPI.openAuthWindow(authUrl);
        } else {
            const url = `https://aartiq-three.vercel.app/auth?client_id=web-app&redirect_uri=${encodeURIComponent(window.location.origin + '/auth')}`;
            window.open(url, "_blank");
        }
    };

    const handleGuestMode = () => {
        setGuestMode(true);
        onClose();
    };

    const handleLicenseLogin = async () => {
        if (!licenseKey) {
            alert("Please enter a license key.");
            return;
        }
        if (!firebaseService.app) {
            alert("Firebase is not initialized. Please set up a custom Firebase config first if you are not using the default.");
            return;
        }
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_LANDING_PAGE_URL}/api/verify-license`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ licenseKey }),
            });
            const data = await res.json();
            if (data.customToken) {
                await firebaseService.signInWithCustomToken(data.customToken);
                // Mirror the session into the main process (cloud sync / P2P).
                window.electronAPI?.signInFirebaseMain?.({ provider: 'custom', token: data.customToken })?.catch?.(() => {});
            } else {
                alert(data.error || "Failed to verify license key.");
            }
        } catch (error) {
            console.error("Error verifying license key: ", error);
            alert("An error occurred while verifying the license key.");
        }
    };

    const handleSignOut = async () => {
        try {
            await firebaseService.signOut();
            store.logout();
            console.log('Signed out from workspace');
        } catch (error) {
            console.error('Error signing out:', error);
        }
    };

    const sections = [
        { id: 'profile', icon: <UserIcon size={18} />, label: 'Neural Identity' },
        { id: 'appearance', icon: <Monitor size={18} />, label: 'Appearance' },
        { id: 'sidebar', icon: <LayoutGrid size={18} />, label: 'Sidebar' },
        { id: 'performance', icon: <Zap size={18} />, label: 'Performance' },
        { id: 'automation', icon: <Zap size={18} />, label: 'Automation' },
        { id: 'search', icon: <Globe size={18} />, label: 'Search Engine' },
        { id: 'privacy', icon: <Shield size={18} />, label: 'Privacy & Security' },
        { id: 'permissions', icon: <Lock size={18} />, label: 'Permissions' },
        { id: 'vault', icon: <Key size={18} />, label: 'Vault & Autofill' },
        { id: 'history', icon: <HistoryIcon size={18} />, label: 'History' },
        { id: 'api-keys', icon: <Sparkles size={18} />, label: 'AI Providers' },
        { id: 'languages', icon: <Languages size={18} />, label: 'Regional Languages' },
        { id: 'shortcuts', icon: <Keyboard size={18} />, label: 'Keyboard Shortcuts' },
        { id: 'sync', icon: <RefreshCw size={18} />, label: 'Sync' },
        { id: 'extensions', icon: <Package size={18} />, label: 'Extensions' },
        { id: 'plugins', icon: <Puzzle size={18} />, label: 'Plugins' },
        { id: 'tabs', icon: <Monitor size={18} />, label: 'Tab Management' },
        { id: 'integrations', icon: <Briefcase size={18} />, label: 'Integrations' },
        { id: 'mcp', icon: <Globe size={18} />, label: 'MCP Servers' },
        { id: 'system', icon: <Globe size={18} />, label: 'System' },
        { id: 'ambient-music', icon: <Music2 size={18} />, label: 'Ambient Music' },
        ...(store.isAdmin ? [{ id: 'admin', icon: <ShieldAlert size={18} />, label: 'Admin Console' }] : []),
        { id: 'updates', icon: <Download size={18} />, label: 'Updates' },
        { id: 'about', icon: <Info size={18} />, label: 'About Aartiq' },
    ];

    return (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center p-4 md:p-12 bg-black/60 backdrop-blur-3xl no-drag-region">
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="adaptive-theme-surface w-full max-w-6xl h-[85vh] border rounded-[2.5rem] overflow-hidden flex shadow-[0_30px_100px_rgba(0,0,0,0.28)] no-drag-region"
                style={{
                    background: 'color-mix(in srgb, var(--primary-bg) 94%, var(--card-bg))',
                    borderColor: 'var(--border-color)',
                    color: 'var(--primary-text)',
                }}
            >
                {/* Navigation Sidebar */}
                <div
                    className="w-72 border-r p-8 flex flex-col gap-2"
                    style={{
                        background: 'linear-gradient(180deg, color-mix(in srgb, var(--navbar-bg) 88%, transparent), color-mix(in srgb, var(--primary-bg) 96%, transparent))',
                        borderColor: 'var(--border-color)',
                    }}
                >
                    <div className="flex items-center gap-4 px-4 mb-10 drag-region cursor-move" title="Drag to move window">
                        <img src="/logo-transparent.png" alt="Aartiq" className="w-10 h-10 object-contain drop-shadow-[0_0_10px_rgba(56,189,248,0.5)]" />
                        <span className="text-xl font-black tracking-tighter uppercase text-primary-text">AARTIQ</span>
                    </div>

                    <div className="flex-1 overflow-y-auto no-scrollbar space-y-2 pr-2">
                        {sections.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => setActiveSection(s.id)}
                                className={`w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl transition-all font-bold text-xs relative group ${activeSection === s.id
                                    ? 'bg-deep-space-accent-neon/10 text-deep-space-accent-neon shadow-[0_0_20px_rgba(0,255,255,0.1)] border border-deep-space-accent-neon/20'
                                    : 'text-white/30 hover:bg-white/[0.03] hover:text-white border border-transparent hover:border-white/5'
                                    }`}
                            >
                                <div className={`transition-transform duration-300 ${activeSection === s.id ? 'scale-110' : 'group-hover:scale-110'}`}>
                                    {s.icon}
                                </div>
                                <span className="flex-1 text-left uppercase tracking-widest">{s.label}</span>
                                {activeSection === s.id && (
                                    <motion.div
                                        layoutId="active-pill"
                                        className="absolute left-0 w-1 h-6 bg-deep-space-accent-neon rounded-r-full"
                                    />
                                )}
                            </button>
                        ))}
                    </div>

                    <div className="mt-6">
                        <div className="p-4 bg-deep-space-accent-neon/5 rounded-2xl border border-deep-space-accent-neon/10 text-[10px] font-medium text-deep-space-accent-neon/60 text-center leading-relaxed">
                            Version {versionLabel} Stable <br /> (Enhancement Update)
                        </div>
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 flex flex-col p-12 overflow-y-auto custom-scrollbar" style={{ background: 'color-mix(in srgb, var(--card-bg) 84%, transparent)' }}>
                    <header className="flex items-center justify-between mb-12 no-drag-region">
                        <div>
                            <h2 className="text-3xl font-black text-primary-text mb-2 uppercase tracking-tight">
                                {activeSection.replace('-', ' ')}
                            </h2>
                            <p className="text-secondary-text text-sm">Configure your hardware-accelerated workspace.</p>
                        </div>
                        <button onClick={onClose} className="px-6 py-3 rounded-2xl transition-all text-sm font-black uppercase tracking-widest border no-drag-region text-primary-text" style={{ background: 'color-mix(in srgb, var(--card-bg) 92%, transparent)', borderColor: 'var(--border-color)' }}>Close</button>
                    </header>

                    <div className="space-y-12 max-w-3xl">
                        {activeSection === 'profile' && (
                            <div className="space-y-10">
                                <div className="p-10 rounded-[2.5rem] bg-white/[0.02] border border-white/5 relative overflow-hidden group">
                                    <div className="absolute inset-0 bg-deep-space-accent-neon/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    <div className="flex items-center gap-8 relative z-10">
                                        <div className="relative">
                                            {store.user?.photoURL || store.localPhotoURL ? (
                                                <img src={store.user?.photoURL || store.localPhotoURL || ''} alt="Profile" className="rounded-full border-2 border-deep-space-accent-neon/20 shadow-2xl object-cover h-16 w-16" />
                                            ) : (
                                                <div className="w-[64px] h-[64px] rounded-full bg-white/5 border-2 border-white/10 flex items-center justify-center text-white/20">
                                                    <UserIcon size={24} />
                                                </div>
                                            )}
                                            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-deep-space-accent-neon flex items-center justify-center text-black border-2 border-[#020205]">
                                                <ShieldCheck size={12} />
                                            </div>
                                        </div>
                                        <div className="flex-1">
                                            <h3 className="text-3xl font-black text-white mb-2 uppercase tracking-tight">
                                                {store.user?.displayName || (isGuestMode ? 'Guest Mode Account' : 'Anonymous Entity')}
                                            </h3>
                                            <p className="text-secondary-text font-medium mb-6">
                                                {store.user?.email || 'Unauthorized Local Session'}
                                            </p>
                                            <div className="flex gap-3">
                                                {store.user ? (
                                                    <button onClick={handleSignOut} className="btn-vibrant-secondary px-6 no-drag-region">Terminate session</button>
                                                ) : (
                                                    <>
                                                        <button onClick={handleLogin} className="btn-vibrant-primary px-8 no-drag-region">Authorize Workspace</button>
                                                        <button
                                                            onClick={async () => {
                                                                if (window.electronAPI) {
                                                                    const filePath = await window.electronAPI.selectLocalFile({
                                                                        filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'webp'] }]
                                                                    });
                                                                    if (filePath) {
                                                                        try {
                                                                            const buffer = await window.electronAPI.readFileBuffer(filePath);
                                                                            const base64 = btoa(
                                                                                new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                                                                            );
                                                                            store.setLocalPhotoURL(`data:image/png;base64,${base64}`);
                                                                        } catch (err) {
                                                                            console.error("Failed to load local photo:", err);
                                                                        }
                                                                    }
                                                                }
                                                            }}
                                                            className="px-6 py-2.5 bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all no-drag-region"
                                                        >
                                                            Upload Photo
                                                        </button>
                                                    </>
                                                )}
                                                {isGuestMode && !store.user && (
                                                    <div className="px-6 py-2.5 bg-white/5 border border-white/10 text-white/40 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                                                        <Zap size={12} /> Guest Mode Enabled
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-6">
                                    <div className="p-8 rounded-[2rem] bg-white/[0.01] border border-white/5">
                                        <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-4">Cloud Status</p>
                                        <div className="flex items-center gap-3">
                                            <div className={`w-3 h-3 rounded-full ${store.user ? 'bg-deep-space-accent-neon animate-pulse shadow-[0_0_10px_#38bdf8]' : 'bg-red-500'}`} />
                                            <span className="text-sm font-bold text-white">{store.user ? 'Synchronized with Aartiq Cloud' : 'Isolated Local Session'}</span>
                                        </div>
                                    </div>
                                    <div className="p-8 rounded-[2rem] bg-white/[0.01] border border-white/5">
                                        <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-4">Workspace Tier</p>
                                        <div className="flex items-center gap-3 text-white">
                                            <Zap size={16} className="text-amber-400" />
                                            <span className="text-sm font-bold">Foundation (Alpha 0.1.7)</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeSection === 'appearance' && (
                            <div className="space-y-8">
                                <div className="p-8 rounded-[2rem] bg-white/[0.03] border border-white/5 space-y-8">
                                    <ThemeSettings
                                        theme={store.theme}
                                        setTheme={store.setTheme}
                                        backgroundImage=""
                                        setBackgroundImage={() => {}}
                                        showCanvasOverlay={false}
                                    />
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="font-bold text-white mb-1">Layout Position</p>
                                            <p className="text-xs text-white/30">Primary sidebar alignment.</p>
                                        </div>
                                        <div className="flex gap-2 p-1 bg-black/40 rounded-xl border border-white/5">
                                            {['left', 'right'].map((side) => (
                                                <button
                                                    key={side}
                                                    onClick={() => store.setSidebarSide(side as 'left' | 'right')}
                                                    className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${store.sidebarSide === side ? 'bg-deep-space-accent-neon text-deep-space-bg shadow-[0_0_15px_#38bdf8]' : 'text-white/40 hover:text-white'}`}
                                                >
                                                    {side}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <p className="font-bold text-white">Panel Width</p>
                                            <span className="text-[10px] font-black text-deep-space-accent-neon">{store.sidebarWidth}px</span>
                                        </div>
                                        <input
                                            type="range" min="280" max="600" step="10"
                                            value={store.sidebarWidth}
                                            onChange={(e) => store.setSidebarWidth(parseInt(e.target.value))}
                                            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-deep-space-accent-neon"
                                            aria-label="Panel Width"
                                        />
                                    </div>
                                    {isMacOS && (
                                        <div className="pt-6 border-t border-white/5 space-y-5">
                                            <div className="flex items-start justify-between gap-4">
                                                <div>
                                                    <h3 className="font-bold text-white mb-1 flex items-center gap-2">
                                                        <Sparkles size={16} className="text-deep-space-accent-neon" />
                                                        Native SwiftUI Panels
                                                    </h3>
                                                    <p className="text-xs text-white/30">
                                                        Run the AI sidebar and Action Chain as detached macOS windows while keeping the Electron sidebar available as a fallback.
                                                    </p>
                                                </div>
                                                <div className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-deep-space-accent-neon/20 text-deep-space-accent-neon bg-deep-space-accent-neon/10">
                                                    macOS only
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className="rounded-2xl border border-white/5 bg-black/20 p-4 space-y-4">
                                                    <div>
                                                        <p className="text-sm font-bold text-white">AI Sidebar Surface</p>
                                                        <p className="text-xs text-white/40">Choose whether prompts live inside the browser or in a detached SwiftUI panel, and optionally let idle sessions collapse into a minimal shell.</p>
                                                    </div>
                                                    <div className="flex gap-2 p-1 bg-black/40 rounded-xl border border-white/5">
                                                        {[
                                                            { id: 'electron', label: 'Electron' },
                                                            { id: 'swiftui', label: 'SwiftUI' },
                                                        ].map((option) => (
                                                            <button
                                                                key={option.id}
                                                                onClick={() => store.setMacNativeSidebarMode(option.id as 'electron' | 'swiftui')}
                                                                className={`flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${store.macNativeSidebarMode === option.id ? 'bg-deep-space-accent-neon text-deep-space-bg shadow-[0_0_15px_#38bdf8]' : 'text-white/40 hover:text-white'}`}
                                                            >
                                                                {option.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-black/30 border border-white/5">
                                                        <div>
                                                            <p className="text-[11px] font-black uppercase tracking-widest text-white/80">Auto-minimize when idle</p>
                                                            <p className="text-[11px] text-white/35">Shrinks the AI sidebar into a compact minimal state when it has been inactive for a bit.</p>
                                                        </div>
                                                        <button
                                                            onClick={() => store.setMacNativeSidebarAutoMinimize(!store.macNativeSidebarAutoMinimize)}
                                                            className={`relative w-12 h-6 rounded-full border transition-all ${store.macNativeSidebarAutoMinimize ? 'bg-deep-space-accent-neon/20 border-deep-space-accent-neon shadow-[0_0_14px_rgba(56,189,248,0.35)]' : 'bg-white/5 border-white/10'}`}
                                                        >
                                                            <span className={`absolute top-[2px] left-[2px] w-5 h-5 rounded-full transition-transform ${store.macNativeSidebarAutoMinimize ? 'translate-x-6 bg-deep-space-accent-neon' : 'translate-x-0 bg-white/70'}`} />
                                                        </button>
                                                    </div>
                                                    <button
                                                    onClick={() => {
                                                        window.electronAPI?.hideAllViews?.();
                                                        window.electronAPI?.showMacNativePanel?.('sidebar');
                                                    }}
                                                    className="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white/80 hover:text-white hover:bg-white/10 text-[10px] font-black uppercase tracking-widest transition-all"
                                                    >
                                                        Open Detached AI Sidebar
                                                    </button>
                                                </div>

                                                <div className="rounded-2xl border border-white/5 bg-black/20 p-4 space-y-4">
                                                    <div>
                                                        <p className="text-sm font-bold text-white">Action Chain Surface</p>
                                                        <p className="text-xs text-white/40">Mirror command execution and approvals inside a native SwiftUI control window.</p>
                                                    </div>
                                                    <div className="flex gap-2 p-1 bg-black/40 rounded-xl border border-white/5">
                                                        {[
                                                            { id: 'electron', label: 'Electron' },
                                                            { id: 'swiftui', label: 'SwiftUI' },
                                                        ].map((option) => (
                                                            <button
                                                                key={option.id}
                                                                onClick={() => store.setMacNativeActionChainMode(option.id as 'electron' | 'swiftui')}
                                                                className={`flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${store.macNativeActionChainMode === option.id ? 'bg-deep-space-accent-neon text-deep-space-bg shadow-[0_0_15px_#38bdf8]' : 'text-white/40 hover:text-white'}`}
                                                            >
                                                                {option.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <button
                                                    onClick={() => {
                                                        window.electronAPI?.hideAllViews?.();
                                                        window.electronAPI?.showMacNativePanel?.('action-chain');
                                                    }}
                                                    className="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white/80 hover:text-white hover:bg-white/10 text-[10px] font-black uppercase tracking-widest transition-all"
                                                    >
                                                        Open Detached Action Chain
                                                    </button>
                                                </div>

                                                <div className="rounded-2xl border border-white/5 bg-black/20 p-4 space-y-4">
                                                    <div>
                                                        <p className="text-sm font-bold text-white">Utility Panels</p>
                                                        <p className="text-xs text-white/40">Use SwiftUI for settings, downloads, clipboard, and the native command menu.</p>
                                                    </div>
                                                    <div className="flex gap-2 p-1 bg-black/40 rounded-xl border border-white/5">
                                                        {[
                                                            { id: 'electron', label: 'Electron' },
                                                            { id: 'swiftui', label: 'SwiftUI' },
                                                        ].map((option) => (
                                                            <button
                                                                key={option.id}
                                                                onClick={() => store.setMacNativeUtilityPanelMode(option.id as 'electron' | 'swiftui')}
                                                                className={`flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${store.macNativeUtilityPanelMode === option.id ? 'bg-deep-space-accent-neon text-deep-space-bg shadow-[0_0_15px_#38bdf8]' : 'text-white/40 hover:text-white'}`}
                                                            >
                                                                {option.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <button
                                                    onClick={() => {
                                                        window.electronAPI?.hideAllViews?.();
                                                        window.electronAPI?.showMacNativePanel?.('menu');
                                                    }}
                                                    className="px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white/80 hover:text-white hover:bg-white/10 text-[10px] font-black uppercase tracking-widest transition-all"
                                                    >
                                                        Open Menu
                                                        </button>
                                                        <button
                                                    onClick={() => {
                                                        window.electronAPI?.hideAllViews?.();
                                                        window.electronAPI?.showMacNativePanel?.('settings');
                                                    }}
                                                    className="px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white/80 hover:text-white hover:bg-white/10 text-[10px] font-black uppercase tracking-widest transition-all"
                                                    >
                                                        Open Settings
                                                        </button>
                                                        <button
                                                    onClick={() => {
                                                        window.electronAPI?.hideAllViews?.();
                                                        window.electronAPI?.showMacNativePanel?.('downloads');
                                                    }}
                                                    className="px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white/80 hover:text-white hover:bg-white/10 text-[10px] font-black uppercase tracking-widest transition-all"
                                                    >
                                                        Open Downloads
                                                        </button>
                                                        <button
                                                    onClick={() => {
                                                        window.electronAPI?.hideAllViews?.();
                                                        window.electronAPI?.showMacNativePanel?.('clipboard');
                                                    }}
                                                    className="px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white/80 hover:text-white hover:bg-white/10 text-[10px] font-black uppercase tracking-widest transition-all"
                                                    >
                                                        Open Clipboard
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="rounded-2xl border border-white/5 bg-black/20 p-4 space-y-4">
                                                    <div>
                                                        <p className="text-sm font-bold text-white">Permission Prompts</p>
                                                        <p className="text-xs text-white/40">Show low, medium, and high-risk approval prompts as native macOS sheets.</p>
                                                    </div>
                                                    <div className="flex gap-2 p-1 bg-black/40 rounded-xl border border-white/5">
                                                        {[
                                                            { id: 'electron', label: 'Electron' },
                                                            { id: 'swiftui', label: 'SwiftUI' },
                                                        ].map((option) => (
                                                            <button
                                                                key={option.id}
                                                                onClick={() => store.setMacNativePermissionMode(option.id as 'electron' | 'swiftui')}
                                                                className={`flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${store.macNativePermissionMode === option.id ? 'bg-deep-space-accent-neon text-deep-space-bg shadow-[0_0_15px_#38bdf8]' : 'text-white/40 hover:text-white'}`}
                                                            >
                                                                {option.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <button
                                                    onClick={() => {
                                                        window.electronAPI?.hideAllViews?.();
                                                        window.electronAPI?.showMacNativePanel?.('permissions');
                                                    }}
                                                    className="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white/80 hover:text-white hover:bg-white/10 text-[10px] font-black uppercase tracking-widest transition-all"
                                                    >
                                                        Preview Native Approval Panel
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    <div className="pt-6 border-t border-white/5 space-y-4">
                                        <div>
                                            <h3 className="font-bold text-white mb-1">Top Bar Icons</h3>
                                            <p className="text-xs text-white/30">Select which quick-action icons appear in your address bar.</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 mt-4">
                                            {[
                                                { id: 'downloads', label: 'Downloads', state: store.showDownloadsIcon, setter: store.setShowDownloadsIcon },
                                                { id: 'clipboard', label: 'Clipboard', state: store.showClipboardIcon, setter: store.setShowClipboardIcon },
                                                { id: 'cart', label: 'Shopping Cart', state: store.showCartIcon, setter: store.setShowCartIcon },
                                                { id: 'translate', label: 'Translate', state: store.showTranslateIcon, setter: store.setShowTranslateIcon },
                                                { id: 'extensions', label: 'Extensions', state: store.showExtensionsIcon, setter: store.setShowExtensionsIcon },
                                                { id: 'bookmark', label: 'Bookmark', state: store.showBookmarkIcon, setter: store.setShowBookmarkIcon },
                                            ].map((icon) => (
                                                <div key={icon.id} className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-white/5">
                                                    <span className="text-xs text-white/70">{icon.label}</span>
                                                    <button
                                                        onClick={() => icon.setter(!icon.state)}
                                                        className={`relative w-10 h-5 rounded-full border transition-all ${icon.state ? 'bg-deep-space-accent-neon/20 border-deep-space-accent-neon shadow-[0_0_10px_rgba(56,189,248,0.3)]' : 'bg-white/5 border-white/10'}`}
                                                    >
                                                        <span className={`absolute top-[1px] left-[2px] w-[16px] h-[16px] rounded-full bg-white transition-transform ${icon.state ? 'translate-x-[18px] bg-deep-space-accent-neon text-black' : 'translate-x-0'}`} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    {store.theme === 'minimal' && (
                                        <div className="pt-6 border-t border-white/5 space-y-4">
                                            <div>
                                                <h3 className="font-bold text-white mb-1">Minimal Theme Animations</h3>
                                                <p className="text-xs text-white/30">Fluid transitions for tabs, chrome reveal, and UI interactions.</p>
                                            </div>
                                            <div className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-white/5">
                                                <span className="text-xs text-white/70">Smooth Motion</span>
                                                <button
                                                    onClick={() => store.setMinimalAnimations(!store.minimalAnimations)}
                                                    className={`relative w-10 h-5 rounded-full border transition-all ${store.minimalAnimations ? 'bg-deep-space-accent-neon/20 border-deep-space-accent-neon shadow-[0_0_10px_rgba(56,189,248,0.3)]' : 'bg-white/5 border-white/10'}`}
                                                >
                                                    <span className={`absolute top-[1px] left-[2px] w-[16px] h-[16px] rounded-full bg-white transition-transform ${store.minimalAnimations ? 'translate-x-[18px] bg-deep-space-accent-neon text-black' : 'translate-x-0'}`} />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeSection === 'sidebar' && (
                            <div className="space-y-8">
                                <div className="p-8 rounded-[2rem] bg-white/[0.03] border border-white/5 space-y-8">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <p className="font-bold text-white mb-1">Modular Widget Home</p>
                                            <p className="text-xs text-white/30">When off, the empty home shows a minimal AI-suggestions surface instead of the widget grid.</p>
                                        </div>
                                        <button
                                            onClick={() => sidebar.setShowWidgets(!sidebar.prefs.showWidgets)}
                                            className={`relative w-12 h-6 rounded-full border transition-all ${sidebar.prefs.showWidgets ? 'bg-deep-space-accent-neon/20 border-deep-space-accent-neon shadow-[0_0_14px_rgba(56,189,248,0.35)]' : 'bg-white/5 border-white/10'}`}
                                            aria-pressed={sidebar.prefs.showWidgets}
                                            aria-label="Toggle modular widget home"
                                        >
                                            <span className={`absolute top-[2px] left-[2px] w-5 h-5 rounded-full transition-transform ${sidebar.prefs.showWidgets ? 'translate-x-6 bg-deep-space-accent-neon' : 'translate-x-0 bg-white/70'}`} />
                                        </button>
                                    </div>

                                    <div className="space-y-4">
                                        <p className="font-bold text-white">History-based Suggestions</p>
                                        <p className="text-xs text-white/30 -mt-2">
                                            Let Aartiq read your browsing history to suggest prompts from past and repetitive tasks.
                                        </p>
                                        <div className="flex gap-2 p-1 bg-black/40 rounded-xl border border-white/5">
                                            {([
                                                { id: 'ask', label: 'Ask each time' },
                                                { id: 'always', label: 'Allow always' },
                                                { id: 'never', label: 'Never' },
                                            ] as const).map((option) => (
                                                <button
                                                    key={option.id}
                                                    onClick={() => sidebar.setHistorySuggestions(option.id)}
                                                    className={`flex-1 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${sidebar.prefs.historySuggestions === option.id ? 'bg-deep-space-accent-neon text-deep-space-bg shadow-[0_0_15px_#38bdf8]' : 'text-white/40 hover:text-white'}`}
                                                >
                                                    {option.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="pt-2">
                                        <button
                                            onClick={() => setShowSidebarCustomize(true)}
                                            className="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white/80 hover:text-white hover:bg-white/10 text-[10px] font-black uppercase tracking-widest transition-all"
                                        >
                                            Open Full Customization
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeSection === 'performance' && <PerformanceSettings />}

                        {activeSection === 'automation' && (
                          <div className="space-y-6">
                            <div className="p-6 rounded-[2rem] bg-white/[0.03] border border-white/5">
                              <div className="flex items-center gap-4 mb-4">
                                <ScanLine size={20} className="text-white/60" />
                                <div>
                                  <h3 className="text-sm font-black text-white uppercase tracking-wide">Extraction Method</h3>
                                  <p className="text-xs text-white/40">Choose DOM queries (in-browser) or OCR (cross-app) for finding elements.</p>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <button
                                  onClick={() => {
                                    setAutomationMode('dom');
                                    window.electronAPI?.savePersistentData('automation_mode', 'dom');
                                  }}
                                  className={`p-4 rounded-xl border transition-all text-left ${automationMode === 'dom' ? 'bg-deep-space-accent-neon/10 border-deep-space-accent-neon/40' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                                >
                                  <Globe size={20} className={`mb-2 ${automationMode === 'dom' ? 'text-deep-space-accent-neon' : 'text-white/40'}`} />
                                  <p className={`text-sm font-bold ${automationMode === 'dom' ? 'text-white' : 'text-white/60'}`}>DOM Mode</p>
                                  <p className="text-[10px] text-white/40 mt-1">Fast in-browser element selection</p>
                                </button>
                                <button
                                  onClick={() => {
                                    setAutomationMode('ocr');
                                    window.electronAPI?.savePersistentData('automation_mode', 'ocr');
                                  }}
                                  className={`p-4 rounded-xl border transition-all text-left ${automationMode === 'ocr' ? 'bg-deep-space-accent-neon/10 border-deep-space-accent-neon/40' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                                >
                                  <ScanLine size={20} className={`mb-2 ${automationMode === 'ocr' ? 'text-deep-space-accent-neon' : 'text-white/40'}`} />
                                  <p className={`text-sm font-bold ${automationMode === 'ocr' ? 'text-white' : 'text-white/60'}`}>OCR Mode</p>
                                  <p className="text-[10px] text-white/40 mt-1">Screen recognition across apps</p>
                                </button>
                              </div>
                            </div>
                            <AutomationSettings />
                          </div>
                        )}

                        {activeSection === 'search' && <SearchEngineSettings selectedEngine={store.selectedEngine} setSelectedEngine={store.setSelectedEngine} />}

                        {activeSection === 'privacy' && (
                            <div className="space-y-8">
                                <div className="p-8 rounded-[2rem] bg-white/[0.03] border border-white/5">
                                    <div className="flex items-center gap-4 mb-4">
                                        <Lock size={20} className="text-white/60" />
                                        <div>
                                            <h3 className="text-sm font-black text-white uppercase tracking-wide">Privacy Settings</h3>
                                            <p className="text-xs text-white/40">Configure browser privacy options</p>
                                        </div>
                                    </div>
                                    <p className="text-white/60 text-sm">Configure macOS permissions in the Permissions section to enable shell commands and automation features.</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col gap-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-bold text-white">Ad blocker</p>
                                                <p className="text-xs text-white/40">Strip ads & trackers across all tabs.</p>
                                            </div>
                                            <button
                                                onClick={() => store.setEnableAdblocker(!store.enableAdblocker)}
                                                className={`relative w-14 h-8 rounded-full border transition-all ${store.enableAdblocker ? 'bg-deep-space-accent-neon/20 border-deep-space-accent-neon shadow-[0_0_12px_rgba(56,189,248,0.35)]' : 'bg-white/5 border-white/10'}`}
                                                aria-label="Toggle ad blocker"
                                            >
                                                <span
                                                    className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white transition-transform duration-200 ${store.enableAdblocker ? 'translate-x-6 bg-deep-space-accent-neon text-black' : 'translate-x-0'}`}
                                                />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                            <ShieldCheck size={14} className={store.enableAdblocker ? 'text-deep-space-accent-neon' : 'text-white/30'} />
                                            <span className={store.enableAdblocker ? 'text-deep-space-accent-neon' : 'text-white/40'}>
                                                {store.enableAdblocker ? 'Enabled - quietly blocking clutter' : 'Disabled - allow all site assets'}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col gap-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-bold text-white">AI Overview</p>
                                                <p className="text-xs text-white/40">One-glance summaries on page load.</p>
                                            </div>
                                            <button
                                                onClick={() => store.setEnableAiOverview(!store.enableAiOverview)}
                                                className={`relative w-14 h-8 rounded-full border transition-all ${store.enableAiOverview ? 'bg-deep-space-accent-neon/20 border-deep-space-accent-neon shadow-[0_0_12px_rgba(56,189,248,0.35)]' : 'bg-white/5 border-white/10'}`}
                                                aria-label="Toggle AI overview"
                                            >
                                                <span
                                                    className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white transition-transform duration-200 ${store.enableAiOverview ? 'translate-x-6 bg-deep-space-accent-neon text-black' : 'translate-x-0'}`}
                                                />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                            <Sparkles size={14} className={store.enableAiOverview ? 'text-deep-space-accent-neon' : 'text-white/30'} />
                                            <span className={store.enableAiOverview ? 'text-deep-space-accent-neon' : 'text-white/40'}>
                                                {store.enableAiOverview ? 'Enabled - show instant AI cards' : 'Disabled - keep pages untouched'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col gap-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-bold text-white">AI Preference Learning</p>
                                                <p className="text-xs text-white/40">AI auto-learns your preferences from conversations.</p>
                                            </div>
                                            <button
                                                onClick={() => store.setEnableAiPreferenceLearning(!store.enableAiPreferenceLearning)}
                                                className={`relative w-14 h-8 rounded-full border transition-all ${store.enableAiPreferenceLearning ? 'bg-deep-space-accent-neon/20 border-deep-space-accent-neon shadow-[0_0_12px_rgba(56,189,248,0.35)]' : 'bg-white/5 border-white/10'}`}
                                                aria-label="Toggle AI preference learning"
                                            >
                                                <span
                                                    className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white transition-transform duration-200 ${store.enableAiPreferenceLearning ? 'translate-x-6 bg-deep-space-accent-neon text-black' : 'translate-x-0'}`}
                                                />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                            <BookOpen size={14} className={store.enableAiPreferenceLearning ? 'text-deep-space-accent-neon' : 'text-white/30'} />
                                            <span className={store.enableAiPreferenceLearning ? 'text-deep-space-accent-neon' : 'text-white/40'}>
                                                {store.enableAiPreferenceLearning ? 'Active - AI learns from chat' : 'Inactive - preferences not saved'}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col gap-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-bold text-white">Cross-Session Memory</p>
                                                <p className="text-xs text-white/40">AI remembers past conversations via RAG memory.</p>
                                            </div>
                                            <button
                                                onClick={() => store.setEnableCrossSessionMemory(!store.enableCrossSessionMemory)}
                                                className={`relative w-14 h-8 rounded-full border transition-all ${store.enableCrossSessionMemory ? 'bg-deep-space-accent-neon/20 border-deep-space-accent-neon shadow-[0_0_12px_rgba(56,189,248,0.35)]' : 'bg-white/5 border-white/10'}`}
                                                aria-label="Toggle cross-session memory"
                                            >
                                                <span
                                                    className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white transition-transform duration-200 ${store.enableCrossSessionMemory ? 'translate-x-6 bg-deep-space-accent-neon text-black' : 'translate-x-0'}`}
                                                />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                            <Database size={14} className={store.enableCrossSessionMemory ? 'text-deep-space-accent-neon' : 'text-white/30'} />
                                            <span className={store.enableCrossSessionMemory ? 'text-deep-space-accent-neon' : 'text-white/40'}>
                                                {store.enableCrossSessionMemory ? 'Active - cross-session RAG enabled' : 'Inactive - no memory across chats'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <AiMemoryManagerSection />
                            </div>
                        )}

                        {activeSection === 'permissions' && <PermissionSettings />}

                        {activeSection === 'vault' && (
                            <div className="space-y-8">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-xs font-black text-white/20 uppercase tracking-[0.3em]">Credentials & Vault</h3>
                                    <button className="px-4 py-2 bg-deep-space-accent-neon text-black rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">Add Password</button>
                                </div>
                                <AutofillSettings />
                            </div>
                        )}

                        {activeSection === 'history' && <HistoryPanel />}

                        {activeSection === 'shortcuts' && <KeyboardShortcutSettings />}

                        {activeSection === 'sync' && (<SyncSettings />)}

                        {activeSection === 'languages' && (
                            <div className="space-y-8">
                                <div className="p-8 rounded-[2rem] bg-white/[0.03] border border-white/5 space-y-8">
                                    <div>
                                        <h3 className="text-lg font-bold text-white mb-2">Regional Language Support</h3>
                                        <p className="text-xs text-white/30 mb-8">Select your preferred Indian regional language for browser interface and AI interaction.</p>

                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                            {store.availableLanguages.map((lang) => {
                                                const names: Record<string, string> = {
                                                    en: 'English', hi: 'Hindi (हिन्दी)', bn: 'Bengali (বাংলা)', te: 'Telugu (తెలుగు)',
                                                    mr: 'Marathi (मराठी)', ta: 'Tamil (தமிழ்)', gu: 'Gujarati (ગુજરાતી)', ur: 'Urdu (اردو)',
                                                    kn: 'Kannada (ಕನ್ನಡ)', or: 'Odia (ଓଡ଼ିଆ)', ml: 'Malayalam (മലയാളം)', pa: 'Punjabi (ਪੰਜਾਬੀ)',
                                                    as: 'Assamese (অসমীয়া)', mai: 'Maithili (मैथिली)', sat: 'Santali (संताली)', ks: 'Kashmiri (کأشُر)',
                                                    ne: 'Nepali (नेपाली)', kok: 'Konkani (कोंकणी)', sd: 'Sindhi (سنڌي)', doi: 'Dogri (डोगरी)',
                                                    mni: 'Manipuri (মৈতৈলোন)', sa: 'Sanskrit (संस्कृतम्)', brx: 'Bodo (बड़ो)',
                                                    es: 'Spanish (Español)', fr: 'French (Français)', de: 'German (Deutsch)',
                                                    ja: 'Japanese (日本語)', zh: 'Chinese (中文)', ru: 'Russian (Русский)',
                                                    pt: 'Portuguese (Português)', it: 'Italian (Italiano)', ko: 'Korean (한국어)',
                                                    ar: 'Arabic (العربية)', tr: 'Turkish (Türkçe)', vi: 'Vietnamese (Tiếng Việt)',
                                                    th: 'Thai (ไทย)', nl: 'Dutch (Nederlands)', pl: 'Polish (Polski)'
                                                };
                                                return (
                                                    <button
                                                        key={lang}
                                                        onClick={() => store.setSelectedLanguage(lang)}
                                                        className={`p-4 rounded-2xl border transition-all text-left ${store.selectedLanguage === lang ? 'bg-deep-space-accent-neon/10 border-deep-space-accent-neon/40 text-deep-space-accent-neon' : 'bg-white/5 border-white/5 hover:bg-white/10 text-white/60'}`}
                                                    >
                                                        <p className="text-sm font-bold">{names[lang] || lang}</p>
                                                        <p className="text-[10px] opacity-40 uppercase font-black tracking-widest mt-1">{lang}</p>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="p-6 bg-deep-space-accent-neon/5 rounded-2xl border border-deep-space-accent-neon/10 flex items-center gap-4">
                                        <Languages size={24} className="text-deep-space-accent-neon" />
                                        <div className="flex-1">
                                            <p className="text-xs font-bold text-white">AI Neural Translation</p>
                                            <p className="text-[10px] text-white/40">The browser will now prioritize {store.selectedLanguage} for real-time web translation and neural insights.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeSection === 'system' && (
                            <div className="space-y-8">
                                <div className="p-8 rounded-[2rem] bg-white/[0.03] border border-white/5 space-y-8">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="font-bold text-white mb-1">Default Browser</p>
                                            <p className="text-xs text-white/30">Make Aartiq your primary portal for external links.</p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                if (window.electronAPI) {
                                                    const success = await window.electronAPI.setAsDefaultBrowser();
                                                    if (success) {
                                                        alert("Aartiq is now your default browser!");
                                                    } else {
                                                        alert("Failed to set as default browser. Please try manual settings.");
                                                    }
                                                }
                                            }}
                                            className="px-6 py-2.5 bg-deep-space-accent-neon/10 border border-deep-space-accent-neon/30 text-deep-space-accent-neon rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-deep-space-accent-neon hover:text-black transition-all no-drag-region"
                                        >
                                            Set as Default
                                        </button>
                                    </div>
                                </div>
                                <UserAgentSettings />
                            </div>
                        )}

                        {activeSection === 'ambient-music' && (
                            <div className="space-y-8">
                                <div className="p-8 rounded-[2rem] bg-white/[0.03] border border-white/5 space-y-8">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-lg font-bold text-white mb-2">Ambient Music</h3>
                                            <p className="text-xs text-white/30">Enable or disable background ambient music.</p>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={store.enableAmbientMusic}
                                                onChange={() => {
                                                    const newValue = !store.enableAmbientMusic;
                                                    store.setEnableAmbientMusic(newValue);
                                                    if (newValue && store.ambientMusicMode === 'off') {
                                                        store.setAmbientMusicMode('always');
                                                    }
                                                }}
                                                className="sr-only peer"
                                            />
                                            <div className="relative w-11 h-6 bg-white/10 rounded-full peer peer-checked:after:translate-x-full peer peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-deep-space-accent-neon" />
                                        </label>
                                    </div>

                                    <div className="pt-8 border-t border-white/5 space-y-6">
                                        <div>
                                            <h3 className="text-sm font-bold text-white mb-2">Ambient Music Mode</h3>
                                            <p className="text-xs text-white/30 mb-8">Choose when to play ambient background music.</p>
                                        </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        {['off', 'always', 'idle', 'google'].map((mode) => (
                                            <button
                                                key={mode}
                                                onClick={() => store.setAmbientMusicMode(mode as 'off' | 'always' | 'idle' | 'google')}
                                                className={`p-6 rounded-2xl border transition-all text-left group ${store.ambientMusicMode === mode ? 'bg-deep-space-accent-neon/10 border-deep-space-accent-neon/40' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                                            >
                                                <p className={`font-bold capitalize ${store.ambientMusicMode === mode ? 'text-white' : 'text-white/60'}`}>{mode === 'google' ? 'On Google Search' : mode}</p>
                                            </button>
                                        ))}
                                    </div>
                                    </div>

                                    <div className="pt-8 border-t border-white/5 space-y-6">
                                        <div className="flex justify-between items-center">
                                            <div>
                                                <h4 className="text-sm font-bold text-white uppercase tracking-widest">Master Volume</h4>
                                                <p className="text-[10px] text-white/30">Adjust the intensity of the background ambience.</p>
                                            </div>
                                            <span className="text-xl font-black text-deep-space-accent-neon">{Math.round(store.ambientMusicVolume * 100)}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="1"
                                            step="0.01"
                                            value={store.ambientMusicVolume}
                                            onChange={(e) => store.setAmbientMusicVolume(parseFloat(e.target.value))}
                                            className="w-full accent-deep-space-accent-neon opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeSection === 'integrations' && (
                            <div className="space-y-8">
                                <div className="p-8 rounded-[2rem] bg-white/[0.03] border border-white/5 space-y-8">
                                    <div className="space-y-6">
                                        <div>
                                            <h3 className="text-lg font-bold text-white mb-2">Backend Strategy</h3>
                                            <p className="text-xs text-white/30 mb-6">Choose how your data is synchronized and stored.</p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            {['firebase', 'mysql'].map((strategy) => (
                                                <button
                                                    key={strategy}
                                                    onClick={() => store.setBackendStrategy(strategy as 'firebase' | 'mysql')}
                                                    className={`p-6 rounded-2xl border transition-all text-left group ${store.backendStrategy === strategy ? 'bg-deep-space-accent-neon/10 border-deep-space-accent-neon/40' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                                                    disabled={isGuestMode}
                                                >
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${store.backendStrategy === strategy ? 'bg-deep-space-accent-neon text-deep-space-bg' : 'bg-white/5 text-white/40'}`}>
                                                        {strategy === 'firebase' ? <Globe size={20} /> : <Database size={20} />}
                                                    </div>
                                                    <p className={`font-bold capitalize ${store.backendStrategy === strategy ? 'text-white' : 'text-white/60'}`}>{strategy}</p>
                                                    <p className="text-[10px] text-white/30 mt-1 uppercase tracking-widest font-black">
                                                        {strategy === 'firebase' ? 'Google Cloud Backend' : 'Self-Hosted SQL'}
                                                    </p>
                                                </button>
                                            ))}
                                        </div>

                                        {store.backendStrategy === 'firebase' && (
                                            <div className="pt-6 border-t border-white/5 space-y-4">
                                                {currentUser && !isGuestMode ? (
                                                    <div className="flex items-center justify-between bg-white/5 rounded-xl p-4">
                                                        <div className="flex items-center gap-3">
                                                            {currentUser.photoURL && (
                                                                <Image src={currentUser.photoURL} alt="User Avatar" width={32} height={32} className="rounded-full" />
                                                            )}
                                                            <div>
                                                                <p className="text-sm font-medium text-white">{currentUser.displayName || currentUser.email}</p>
                                                                <p className="text-xs text-white/50">{currentUser.email}</p>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={handleSignOut}
                                                            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all"
                                                        >
                                                            <LogOut size={16} />
                                                            Sign Out
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <LoginPrompt onLogin={handleLogin} />
                                                )}

                                                <div className="flex items-center justify-between">
                                                    <p className="text-xs font-bold text-white/60 uppercase tracking-widest">Custom Firebase Config</p>
                                                    <div className="flex items-center gap-4">
                                                        <button
                                                            onClick={() => setShowFirebaseConfig(!showFirebaseConfig)}
                                                            className="text-[10px] text-deep-space-accent-neon flex items-center gap-1 hover:underline"
                                                            title={showFirebaseConfig ? "Hide Config" : "Show Config"}
                                                        >
                                                            {showFirebaseConfig ? <EyeOff size={12} /> : <Eye size={12} />}
                                                            {showFirebaseConfig ? "Hide" : "Show"}
                                                        </button>
                                                        <button
                                                            onClick={() => store.setCustomFirebaseConfig(null)}
                                                            className="text-[10px] text-deep-space-accent-neon hover:underline"
                                                        >
                                                            Reset to Default
                                                        </button>
                                                    </div>
                                                </div>
                                                <textarea
                                                    className="w-full bg-black/40 border border-white/5 rounded-xl p-4 text-xs font-mono text-deep-space-accent-neon placeholder:text-white/10 h-32 outline-none focus:border-deep-space-accent-neon/30"
                                                    placeholder='{ "apiKey": "...", "authDomain": "...", ... }'
                                                    value={showFirebaseConfig ? (store.customFirebaseConfig ? JSON.stringify(store.customFirebaseConfig, null, 2) : '') : (store.customFirebaseConfig ? '{\n  "apiKey": "****************",\n  "authDomain": "****************",\n  "projectId": "****************",\n  "storageBucket": "****************",\n  "messagingSenderId": "****************",\n  "appId": "****************",\n  "measurementId": "****************"\n}' : '')}
                                                    onChange={(e) => {
                                                        if (!showFirebaseConfig) return;
                                                        try {
                                                            const config = JSON.parse(e.target.value);
                                                            store.setCustomFirebaseConfig(config);
                                                        } catch { }
                                                    }}
                                                    readOnly={!showFirebaseConfig}
                                                    disabled={isGuestMode}
                                                />
                                            </div>
                                        )}

                                        {store.backendStrategy === 'mysql' && (
                                            <div className="pt-6 border-t border-white/5">
                                                <div className="flex items-center justify-between mb-4">
                                                    <p className="text-xs font-bold text-white/60 uppercase tracking-widest">SQL Connection Details</p>
                                                    <button
                                                        onClick={() => setShowMysqlConfig(!showMysqlConfig)}
                                                        className="text-[10px] text-deep-space-accent-neon flex items-center gap-1 hover:underline"
                                                        title={showMysqlConfig ? "Hide Config" : "Show Config"}
                                                    >
                                                        {showMysqlConfig ? <EyeOff size={12} /> : <Eye size={12} />}
                                                        {showMysqlConfig ? "Hide" : "Show"}
                                                    </button>
                                                </div>
                                                <div className="grid grid-cols-2 gap-4">
                                                    {['host', 'port', 'user', 'database'].map((field) => (
                                                        <div key={field} className="space-y-1">
                                                            <label htmlFor={field} className="text-[9px] font-black uppercase tracking-widest text-white/20 px-1">{field}</label>
                                                            <input
                                                                id={field}
                                                                type={showMysqlConfig ? "text" : "password"}
                                                                placeholder={`Enter ${field}`}
                                                                className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-2 text-xs text-white outline-none focus:border-deep-space-accent-neon/30"
                                                                value={store.customMysqlConfig?.[field] || ''}
                                                                onChange={(e) => store.setCustomMysqlConfig({ ...store.customMysqlConfig, [field]: e.target.value })}
                                                                disabled={isGuestMode}
                                                            />
                                                        </div>
                                                    ))}
                                                    <div className="col-span-2 space-y-1">
                                                        <p className="text-[9px] font-black uppercase tracking-widest text-white/20 px-1">password</p>
                                                            <input
                                                                type={showMysqlConfig ? "text" : "password"}
                                                                placeholder="Enter database password"
                                                            className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-2 text-xs text-white outline-none focus:border-deep-space-accent-neon/30"
                                                            value={store.customMysqlConfig?.password || ''}
                                                            onChange={(e) => store.setCustomMysqlConfig({ ...store.customMysqlConfig, password: e.target.value })}
                                                            disabled={isGuestMode}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeSection === 'extensions' && (
                            <ExtensionSettings />
                        )}
                        {activeSection === 'plugins' && (
                            <PluginSettings />
                        )}

                        {activeSection === 'tabs' && (
                            <div className="p-8 rounded-[2rem] bg-white/[0.03] border border-white/5 space-y-8">
                                <div className="text-center py-12">
                                    <Monitor size={48} className="mx-auto mb-4 text-white/20" />
                                    <p className="text-white/40">Tab management settings coming soon</p>
                                </div>
                            </div>
                        )}

                        {activeSection === 'mcp' && <McpSettings />}

                        {activeSection === 'admin' && <AdminDashboard />}

                        {activeSection === 'history' && <HistoryPanel />}

                        {activeSection === 'api-keys' && <ApiKeysSettings />}

                        {activeSection === 'updates' && <UpdatesSettings />}
                        
                        {activeSection === 'about' && (
                            <div className="text-center py-16 space-y-8">
                                <img src="/logo-transparent.png" alt="Aartiq" className="w-24 h-24 mx-auto mb-2 shadow-2xl drop-shadow-[0_0_20px_rgba(56,189,248,0.4)] animate-pulse" />
                                <h2 className="text-5xl font-black tracking-tighter">{store.appName}</h2>
                                <p className="text-white/40 max-w-md mx-auto text-sm leading-relaxed font-medium">
                                    AI browser with permission-gated automation and ticket-based security.
                                </p>

                                {/* Onboarding Actions */}
                                <div className="max-w-sm mx-auto space-y-4 pt-4">
                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mb-6">Onboarding</p>

                                    <button
                                        onClick={() => {
                                            store.setHasSeenWelcomePage(false);
                                            store.setHasCompletedStartupSetup(false);
                                            onClose();
                                        }}
                                        className="w-full flex items-center gap-4 px-6 py-4 rounded-2xl bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 hover:border-sky-500/40 transition-all group"
                                    >
                                        <div className="w-10 h-10 rounded-xl bg-sky-500/20 flex items-center justify-center text-sky-400 group-hover:bg-sky-500 group-hover:text-black transition-all flex-shrink-0">
                                            <Sparkles size={18} />
                                        </div>
                                        <div className="text-left flex-1">
                                            <p className="text-sm font-black text-white uppercase tracking-wide">View Welcome Screen</p>
                                            <p className="text-[10px] text-white/40 mt-0.5">Re-launch the intro &amp; sign-in screen</p>
                                        </div>
                                        <ChevronRight size={16} className="text-white/20 group-hover:text-sky-400 transition-colors" />
                                    </button>

                                    <button
                                        onClick={() => {
                                            store.setHasSeenWelcomePage(true);
                                            store.setHasCompletedStartupSetup(false);
                                            onClose();
                                        }}
                                        className="w-full flex items-center gap-4 px-6 py-4 rounded-2xl bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 hover:border-violet-500/40 transition-all group"
                                    >
                                        <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center text-violet-400 group-hover:bg-violet-500 group-hover:text-black transition-all flex-shrink-0">
                                            <BookOpen size={18} />
                                        </div>
                                        <div className="text-left flex-1">
                                            <p className="text-sm font-black text-white uppercase tracking-wide">View Setup Guide</p>
                                            <p className="text-[10px] text-white/40 mt-0.5">Replay the AI &amp; API key configuration wizard</p>
                                        </div>
                                        <ChevronRight size={16} className="text-white/20 group-hover:text-violet-400 transition-colors" />
                                    </button>
                                </div>

                                {/* Contributors Section */}
                                <div className="pt-8 border-t border-white/5 max-w-lg mx-auto">
                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mb-6">Contributors</p>
                                    
                                    <div className="space-y-4">
                                        {/* Shashank Shekhar */}
                                        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-left">
                                            <div className="flex items-center gap-3 mb-2">
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-500/20 to-violet-500/20 flex items-center justify-center text-xs font-bold text-white/60">SS</div>
                                                <div>
                                                    <p className="text-sm font-bold text-white">Shashank Shekhar</p>
                                                    <p className="text-[10px] text-white/30">Microsoft Store Advisor · UI/UX Feedback</p>
                                                </div>
                                            </div>
                                            <p className="text-[11px] text-white/40 leading-relaxed">Guided Microsoft Store submission, flagged macOS UI on Windows, suggested ad-blocker and Zen-inspired design.</p>
                                        </div>

                                        {/* eddzsh */}
                                        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-left">
                                            <div className="flex items-center gap-3 mb-2">
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center text-xs font-bold text-white/60">ed</div>
                                                <div>
                                                    <p className="text-sm font-bold text-white">eddzsh</p>
                                                    <p className="text-[10px] text-white/30">Security Architecture · Approval System Design</p>
                                                </div>
                                            </div>
                                            <p className="text-[11px] text-white/40 leading-relaxed">Designed the ticket-based approval system. Hash verification, pre-registered call shapes, pattern-based approval for unattended execution.</p>
                                        </div>

                                        {/* Dxrkaa */}
                                        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-left">
                                            <div className="flex items-center gap-3 mb-2">
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500/20 to-red-500/20 flex items-center justify-center text-xs font-bold text-white/60">Dx</div>
                                                <div>
                                                    <p className="text-sm font-bold text-white">Dxrkaa</p>
                                                    <p className="text-[10px] text-white/30">First Issue Reporter · Early Adopter</p>
                                                </div>
                                            </div>
                                            <p className="text-[11px] text-white/40 leading-relaxed">Opened the first community bug report (Issue #6). Helped identify and fix a critical Windows launch regression.</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-6 border-t border-white/5 max-w-sm mx-auto">
                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20">Version {versionLabel} Stable</p>
                                    <p className="text-[10px] text-white/20 mt-1">Aartiq Intelligence System • Security Update</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </motion.div>

            {showSidebarCustomize && (
                <CustomizationPanel
                    initialPrefs={sidebar.prefs}
                    initialGlobalTheme={useAppStore.getState().theme}
                    onPreview={(prefs) => sidebar.preview(prefs)}
                    onApply={(prefs) => sidebar.commit(prefs)}
                    onClose={() => setShowSidebarCustomize(false)}
                    setGlobalTheme={(t) => useAppStore.getState().setTheme(t)}
                />
            )}
        </div>
    );
};

export default SettingsPanel;
