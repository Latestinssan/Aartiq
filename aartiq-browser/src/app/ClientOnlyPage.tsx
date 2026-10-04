/// <reference path="../types/electron.d.ts" />
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store/useAppStore';
import { BrowserAI } from '@/lib/BrowserAI';
import { AnimatePresence, motion, Reorder } from 'framer-motion';
import { detectSchedulingIntent, type SchedulingIntent } from '@/components/ai/SchedulingIntentDetector';
import {
  ShoppingBag, FileText, Globe, Plus, Bookmark, ChevronLeft, ChevronRight,
  RotateCw, AlertTriangle, ShieldCheck, DownloadCloud, ShoppingCart, Copy as CopyIcon,
  Terminal, Settings as GhostSettings, FolderOpen, Sparkles, ScanLine, Search, X,
  Puzzle, Code2, Briefcase, Image as ImageIcon, User as UserIcon, Maximize2, Minimize2, RefreshCcw, Download as DownloadIcon,
  MoreVertical, MoreHorizontal, CreditCard, ArrowRight, Languages, Share2, Lock, Shield, Volume2, Square, Music2, Waves, Presentation, Package,
  Zap, Check, Paperclip, MousePointer2,
  // ── NEW: theme icon ──
  Sun, Moon, Palette,
} from 'lucide-react';
import AIChatSidebar from '@/components/AIChatSidebar';
import LandingPage from '@/components/LandingPage';
import { StartupSetupUI } from '@/components/StartupSetupUI';
import WebStore from '@/components/WebStore';
import PDFWorkspace from '@/components/PDFWorkspace';
import CodingDashboard from '@/components/CodingDashboard';
import ClipboardManager from '@/components/ClipboardManager';
import PhoneCamera from '@/components/PhoneCamera';
import { GoogleAuthProvider } from 'firebase/auth';
import SettingsPanel from '@/components/SettingsPanel';
import McpApprovalPopup from '@/components/McpApprovalPopup';
import { searchEngines } from '@/components/SearchEngineSettings';
import UnifiedCartPanel from '@/components/UnifiedCartPanel';
import WorkspaceDashboard from '@/components/WorkspaceDashboard';
import MediaStudio from '@/components/MediaStudio';
import Documentation from '@/components/Documentation';
import PresentonStudio from '@/components/PresentonStudio';
import PasswordManager from '@/components/PasswordManager';
import ProxyFirewallManager from '@/components/ProxyFirewallManager';
import P2PSyncManager from '@/components/P2PSyncManager';
import WelcomeScreen from '@/components/WelcomeScreen';
import SpotlightSearchOverlay from '@/components/SpotlightSearchOverlay';
import SchedulingModal from '@/components/ai/SchedulingModal';

import CloudSyncConsent from "@/components/CloudSyncConsent";
import NoNetworkGame from "@/components/DinoGame";
import AIAssistOverlay from "@/components/AIAssistOverlay";
import InitializingOverlay from "@/components/InitializingOverlay";
import PasswordSaveDialog from "@/components/PasswordSaveDialog";

import { firebaseSyncService } from "@/lib/FirebaseSyncService";
import firebaseService from '@/lib/FirebaseService';
import { firebaseConfigStorage } from '@/lib/firebaseConfigStorage';
import { QuickNavOverlay } from '@/components/QuickNavOverlay';
import TitleBar from '@/components/TitleBar';
import { useOptimizedTabs } from '@/hooks/useOptimizedTabs';
import ExtensionActionBar from '@/components/ExtensionActionBar';
import { VirtualizedTabBar } from '@/components/VirtualizedTabBar';
import { TabSwitcherOverlay } from '@/components/TabSwitcherOverlay';
import { selectClientOnlyPageStore } from '@/store/selectors';

type AiOverviewSource = { text: string; metadata: any };
interface AiOverviewState {
  query: string;
  result: string | null;
  sources: AiOverviewSource[] | null;
  isLoading: boolean;
  provider: string;
  model: string;
  statusMessage?: string;
  durationMs?: number;
  error?: string;
}
import { fetchAiOverview } from '@/lib/aiManager';
import type { AiOverviewResponse } from '@/lib/aiManager';
import { getRecommendedGeminiModel } from '@/lib/modelRegistry';
import { safeEval } from '@/lib/safe-eval';

// ─────────────────────────────────────────────────────────────────────────────
// THEME TYPES
// Three concrete themes + "system" (resolves to dark/light at runtime).
// "vibrant" maps to the .vibrant CSS class defined in globals.css.
// ─────────────────────────────────────────────────────────────────────────────
type AppTheme = 'dark' | 'light' | 'vibrant' | 'custom' | 'minimal' | 'system';
type BrowserTabLayout = 'top' | 'left' | 'right' | 'both';
type ToolbarActionId = 'downloads' | 'clipboard' | 'cart' | 'translate' | 'extensions' | 'quick-search';
type BrowserAccentPreset = 'minimal' | 'brave' | 'ocean' | 'mint' | 'rose' | 'mono';

/** Cycle order for the header toggle button */
const THEME_CYCLE: AppTheme[] = ['dark', 'light', 'minimal', 'vibrant', 'custom'];

const TAB_LAYOUTS: Array<{ id: BrowserTabLayout; label: string }> = [
  { id: 'top', label: 'Top' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'both', label: 'Both' },
];

const BROWSER_ACCENT_PRESETS: Array<{ id: BrowserAccentPreset; label: string; primary: string; secondary: string }> = [
  { id: 'minimal', label: 'Minimal', primary: '#8AA4FF', secondary: '#43D9AD' },
  { id: 'brave', label: 'Brave', primary: '#FB542B', secondary: '#8D5CFF' },
  { id: 'ocean', label: 'Ocean', primary: '#2DD4BF', secondary: '#38BDF8' },
  { id: 'mint', label: 'Mint', primary: '#34D399', secondary: '#A3E635' },
  { id: 'rose', label: 'Rose', primary: '#FB7185', secondary: '#F59E0B' },
  { id: 'mono', label: 'Mono', primary: '#E5E7EB', secondary: '#94A3B8' },
];

/** Icon + label shown in the header button for the CURRENT theme */
function ThemeIcon({ theme }: { theme: AppTheme }) {
  if (theme === 'light') return <Sun size={16} />;
  if (theme === 'vibrant' || theme === 'custom' || theme === 'minimal') return <Palette size={16} />;
  return <Moon size={16} />;
}

function displayText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const maybeLink = value as { title?: unknown; url?: unknown; name?: unknown; text?: unknown; path?: unknown };
    return displayText(maybeLink.text || maybeLink.title || maybeLink.name || maybeLink.url || maybeLink.path, fallback);
  }
  return fallback;
}

function normalizeSuggestion(suggestion: any, fallbackType = 'search') {
  const type = displayText(suggestion?.type, fallbackType);
  const url = displayText(suggestion?.url || suggestion?.path);
  const text = displayText(suggestion?.text || suggestion?.title || suggestion?.name || url, url || 'Suggestion');

  return {
    ...suggestion,
    type,
    text,
    url,
  };
}



// ─────────────────────────────────────────────────────────────────────────────
// MUSIC VISUALIZER (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
const MusicVisualizer = ({ color = 'rgb', isPlaying = false }: { color?: string, isPlaying: boolean }) => {
  if (!isPlaying) return null;

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 'auto', opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      className="flex items-center gap-1.5 px-2 py-1 bg-deep-space-accent-neon/5 backdrop-blur-sm rounded-lg border border-deep-space-accent-neon/20 h-7 group hover:bg-deep-space-accent-neon/10 transition-all duration-300 cursor-pointer"
      title="Audio playing"
    >
      <div className="flex gap-[2px] items-center h-3.5">
        {[...Array(5)].map((_, i) => (
          <motion.div
            key={i}
            animate={{
              height: [3, 12, 5, 10, 3],
              backgroundColor: color === 'rgb'
                ? ['#38bdf8', '#818cf8', '#38bdf8']
                : [color, color, color]
            }}
            transition={{
              duration: 0.5 + Math.random() * 0.3,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.1,
            }}
            className="w-[2px] rounded-full"
          />
        ))}
      </div>
      <Music2 size={12} className="text-deep-space-accent-neon/60" />
    </motion.div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// HOME PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
  const store = useAppStore(useShallow(selectClientOnlyPageStore));
  const { shouldRenderTab, isTabSuspended } = useOptimizedTabs();
  const [isInitializing, setIsInitializing] = useState(true);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    const loadOnboardingState = async () => {
      try {
        await window.electronAPI?.getOnboardingState?.();
      } catch {
        // Boot should not stall on onboarding state lookup failures.
      } finally {
        if (!active) return;
        setOnboardingLoaded(true);
        setIsInitializing(false);
      }
    };

    loadOnboardingState();

    return () => {
      active = false;
    };
  }, []);

  // Expose history getter for MCP bridge (called from main.js via executeJavaScript)
  useEffect(() => {
    (window as any).__GET_HISTORY__ = (limit = 50) => {
      const state = useAppStore.getState();
      return (state.history || []).slice(-limit).reverse();
    };
    // Expose store for bridge tab control
    (window as any).__AARTIQ_STORE__ = useAppStore;
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('aartiq_ai_sidebar_workspace_preferences');
      if (stored) clickSoundEnabledRef.current = !!JSON.parse(stored)?.soundsEnabled;
    } catch {
    }

    const playClick = (variant: 'tap' | 'confirm' | 'success' | 'error' | 'toggle' | 'drag' | 'navigate' | 'delete' = 'tap') => {
      if (!clickSoundEnabledRef.current) return;
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;
      const context = clickAudioContextRef.current || new AudioContextCtor();
      clickAudioContextRef.current = context;

      const configs: Record<string, { freq: number; gain: number; dur: number; type: OscillatorType; endFreq?: number }> = {
        tap:      { freq: 440, gain: 0.025, dur: 0.08, type: 'sine' },
        confirm:  { freq: 660, gain: 0.045, dur: 0.09, type: 'sine' },
        success:  { freq: 523, gain: 0.035, dur: 0.12, type: 'sine', endFreq: 659 },
        error:    { freq: 220, gain: 0.04,  dur: 0.15, type: 'triangle', endFreq: 180 },
        toggle:   { freq: 580, gain: 0.02,  dur: 0.06, type: 'sine', endFreq: 780 },
        drag:     { freq: 300, gain: 0.012, dur: 0.04, type: 'sine' },
        navigate: { freq: 500, gain: 0.03,  dur: 0.07, type: 'sine', endFreq: 700 },
        delete:   { freq: 350, gain: 0.035, dur: 0.1,  type: 'triangle', endFreq: 200 },
      };

      const cfg = configs[variant] || configs.tap;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = cfg.type;
      oscillator.frequency.setValueAtTime(cfg.freq, context.currentTime);
      if (cfg.endFreq) {
        oscillator.frequency.exponentialRampToValueAtTime(cfg.endFreq, context.currentTime + cfg.dur * 0.7);
      }
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(cfg.gain, context.currentTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + cfg.dur);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + cfg.dur + 0.01);
    };

    const handlePreference = (event: Event) => {
      clickSoundEnabledRef.current = !!(event as CustomEvent<{ enabled?: boolean }>).detail?.enabled;
    };
    const handleManualSound = (event: Event) => {
      const v = (event as CustomEvent<{ variant?: string }>).detail?.variant || 'tap';
      playClick(v as any);
    };
    const handleDocumentClick = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest('button,a,[role="button"],input,select,textarea')) {
        playClick('tap');
      }
    };

    window.addEventListener('aartiq-click-sound-preference', handlePreference);
    window.addEventListener('aartiq-play-click-sound', handleManualSound);
    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      window.removeEventListener('aartiq-click-sound-preference', handlePreference);
      window.removeEventListener('aartiq-play-click-sound', handleManualSound);
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, []);
  const isMacOS = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
  const [showClipboard, setShowClipboard] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState('profile');

  // Helper to open settings and disable browser
  const openSettingsPanel = (section: string = 'profile', options: { preferElectron?: boolean } = {}) => {
    const preferElectron = options.preferElectron === true;
    const canUseNativeUtilityPanel = section === 'profile' || section === 'downloads' || section === 'clipboard';

    if (isMacOS && !preferElectron && canUseNativeUtilityPanel && useAppStore.getState().macNativeUtilityPanelMode === 'swiftui') {
      window.electronAPI?.hideAllViews();
      window.electronAPI?.showMacNativePanel?.(section === 'downloads' ? 'downloads' : section === 'clipboard' ? 'clipboard' : 'settings');
      return;
    }
    setSettingsSection(section);
    store.setSettingsSection(section);
    setShowSettings(true);
    setIsBrowserDisabled(true);
  };

  const openClipboardPanel = useCallback(() => {
    if (isMacOS && useAppStore.getState().macNativeUtilityPanelMode === 'swiftui') {
      window.electronAPI?.hideAllViews();
      window.electronAPI?.showMacNativePanel?.('clipboard');
      return;
    }
    setShowClipboard(true);
  }, [isMacOS]);

  const openDownloadsPanel = useCallback(() => {
    if (isMacOS && useAppStore.getState().macNativeUtilityPanelMode === 'swiftui') {
      window.electronAPI?.hideAllViews();
      window.electronAPI?.showMacNativePanel?.('downloads');
      return;
    }
    setShowDownloads(true);
    setIsBrowserDisabled(true);
  }, [isMacOS]);

  const [showCart, setShowCart] = useState(false);
  const [urlPrediction, setUrlPrediction] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, visible: boolean } | null>(null);
  const [aiOverview, setAiOverview] = useState<AiOverviewState | null>(null);
  const [showTabSwitcher, setShowTabSwitcher] = useState(false);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState<{ x: number, y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [aiPickColor, setAiPickColor] = useState('rgb');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'in_progress' | 'completed' | 'failed'>('idle');
  const [showDownloads, setShowDownloads] = useState(false);
  const [showExtensionsPopup, setShowExtensionsPopup] = useState(false);
  const [downloads, setDownloads] = useState<Array<{ name: string, status: string, progress?: number, path?: string }>>([]);
  const [activeManager, setActiveManager] = useState<string | null>(null);
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [showTranslateDialog, setShowTranslateDialog] = useState(false);
  const [showChromeCustomizer, setShowChromeCustomizer] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [draggedToolbarAction, setDraggedToolbarAction] = useState<ToolbarActionId | null>(null);
  const [compactRevealed, setCompactRevealed] = useState(false);
  const compactHideTimerRef = useRef<NodeJS.Timeout | null>(null);

  const revealCompact = useCallback(() => {
    if (compactHideTimerRef.current) clearTimeout(compactHideTimerRef.current);
    setCompactRevealed(true);
  }, []);

  const scheduleHideCompact = useCallback(() => {
    if (compactHideTimerRef.current) clearTimeout(compactHideTimerRef.current);
    compactHideTimerRef.current = setTimeout(() => {
      setCompactRevealed(false);
    }, 2000);
  }, []);

  const closeTranslateDialog = () => {
    setShowTranslateDialog(false);
    setIsBrowserDisabled(false);
    window.electronAPI?.showAllViews();
  };

  const openTranslateDialog = () => {
    setShowTranslateDialog(true);
    setIsBrowserDisabled(true);
    window.electronAPI?.hideAllViews();
  };

  const [translateMethod, setTranslateMethod] = useState<'google' | 'chrome-ai'>('google');
  const [passwordSaveDialog, setPasswordSaveDialog] = useState<{ domain: string; url?: string; username: string; password: string; type: string } | null>(null);
  const ambientAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isAmbientPlaying, setIsAmbientPlaying] = useState(false);
  const clickSoundEnabledRef = useRef(false);
  const clickAudioContextRef = useRef<AudioContext | null>(null);
  const [inputValue, setInputValue] = useState(store.currentUrl);
  const [showSpotlightSearch, setShowSpotlightSearch] = useState(false);
  const [isPopupWindow, setIsPopupWindow] = useState(false);
  const [activeExtensions, setActiveExtensions] = useState<any[]>([]);
  const [isBrowserDisabled, setIsBrowserDisabled] = useState(false);
  const [showSchedulingModal, setShowSchedulingModal] = useState(false);
  const [schedulingIntent, setSchedulingIntent] = useState<SchedulingIntent | null>(null);
  const clearClipboardHistory = useAppStore((state) => state.clearClipboard);

  const isFirebaseIdToken = useCallback((token: string) => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1] || ''));
      return typeof payload?.iss === 'string' && payload.iss.includes('securetoken.google.com');
    } catch {
      return false;
    }
  }, []);

  const isJwtExpired = useCallback((token: string) => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1] || ''));
      return typeof payload?.exp === 'number' ? payload.exp * 1000 <= Date.now() + 30_000 : false;
    } catch {
      return true;
    }
  }, []);

  const handleSettingsClose = useCallback(() => {
    setShowSettings(false);
    setSettingsSection('profile');
    setIsBrowserDisabled(false);
  }, []);

  // Go back to browser view from any studio/panel
  const goBackToBrowser = useCallback(() => {
    store.setActiveView('browser');
    window.electronAPI?.showAllViews();
  }, []);

  // Synchronize inputValue with store.currentUrl
  useEffect(() => {
    setInputValue(store.currentUrl);
  }, [store.currentUrl]);

  useEffect(() => {
    if (!window.electronAPI?.getMacNativeUIPreferences) return;

    let disposed = false;
    const applyPreferences = (preferences?: { sidebarMode: 'electron' | 'swiftui'; actionChainMode: 'electron' | 'swiftui'; utilityMode: 'electron' | 'swiftui'; permissionMode: 'electron' | 'swiftui'; sidebarAutoMinimize?: boolean }) => {
      if (!preferences || disposed) return;
      useAppStore.getState().applyMacNativeUiPreferences({
        macNativeSidebarMode: preferences.sidebarMode,
        macNativeActionChainMode: preferences.actionChainMode,
        macNativeUtilityPanelMode: preferences.utilityMode,
        macNativePermissionMode: preferences.permissionMode,
        macNativeSidebarAutoMinimize: preferences.sidebarAutoMinimize,
      });
      if (preferences.sidebarMode === 'swiftui') {
        useAppStore.setState({ sidebarOpen: false });
      }
    };

    window.electronAPI.getMacNativeUIPreferences().then((result) => {
      if (result?.success) {
        applyPreferences(result.preferences);
      }
    }).catch((error) => {
      console.warn('Failed to load mac native UI preferences:', error);
    });

    const cleanup = window.electronAPI.onMacNativeUIPreferencesChanged?.((preferences) => {
      applyPreferences(preferences);
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  // Mirror tabs/history state for Raycast integration
  useEffect(() => {
    if (window.electronAPI?.updateRaycastState) {
      const tabsSnapshot = store.tabs.map(tab => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        isActive: tab.id === store.activeTabId,
        isLoading: tab.isLoading || false,
      }));
      const historySnapshot = store.history.slice(-50).reverse().map(entry => ({
        title: entry.title,
        url: entry.url,
        timestamp: entry.timestamp,
      }));
      window.electronAPI.updateRaycastState({
        tabs: tabsSnapshot,
        history: historySnapshot,
      });
    }
  }, [store.tabs, store.activeTabId, store.history]);

  // Consolidated tools config — used in the ⋮ dropdown menu
  const mainTools = [
    { icon: <Globe size={14} />, label: 'Browser', view: 'browser' },
    { icon: <Lock size={14} />, label: 'Passwords', view: 'passwords' },
    { icon: <Shield size={14} />, label: 'Nexus Shield', view: 'firewall' },
    { icon: <Share2 size={14} />, label: 'P2P Sync', view: 'p2psync' },
  ];

  const extraTools = [
    { icon: <Briefcase size={14} />, label: 'Workspace', view: 'workspace' },
    { icon: <ShoppingBag size={14} />, label: 'Web Store', view: 'webstore' },
    { icon: <FileText size={14} />, label: 'PDF Tools', view: 'pdf' },
    { icon: <Code2 size={14} />, label: 'Coding', view: 'coding' },
    { icon: <ImageIcon size={14} />, label: 'Media Studio', view: 'media' },
    { icon: <Presentation size={14} />, label: 'Presenton', view: 'presenton' },
  ];

  const handleToolSelect = (item: { view?: string; popup?: string; manager?: string }) => {
    setShowToolsMenu(false);
    if (item.view) {
      store.setActiveView(item.view as any);
      setActiveManager(null);
      if (item.view !== 'browser') {
        window.electronAPI?.hideAllViews();
      } else {
        window.electronAPI?.showAllViews();
      }
    } else if (item.manager) {
      setActiveManager(item.manager as any);
      store.setActiveView('browser');
      setShowClipboard(false);
      setShowSettings(false);
    } else if (item.popup) {
      switch (item.popup) {
        case 'plugins': setShowExtensionsPopup(true); setIsBrowserDisabled(true); break;
        case 'settings': openSettingsPanel(); setShowClipboard(false); break;
        case 'clipboard': openClipboardPanel(); break;
        case 'translate': openTranslateDialog(); break;
        case 'search': setShowSpotlightSearch(true); setIsBrowserDisabled(true); break;
        case 'downloads': openDownloadsPanel(); break;
        case 'cart': setShowCart(true); setIsBrowserDisabled(true); break;
      }
    }
  };


  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const panel = params.get('panel');
      if (panel) {
        setIsPopupWindow(true);
        const settingsPanels = ['settings', 'profile', 'extensions', 'downloads', 'clipboard', 'history', 'performance', 'sync', 'account'];
        if (settingsPanels.includes(panel)) {
          openSettingsPanel(panel === 'settings' ? 'profile' : panel);
        } else if (panel === 'cart') {
          setShowCart(true);
          setIsBrowserDisabled(true);
        } else if (panel === 'translate') {
          openTranslateDialog();
          window.electronAPI?.bringWindowToTop();
        } else if (panel === 'search' || panel === 'apps') {
          setShowSpotlightSearch(true);
          setIsBrowserDisabled(true);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanStart = window.electronAPI.on('download-started', ({ name, path }: { name: string, path?: string }) => {
      setDownloads(prev => {
        if (prev.some(d => d.name === name)) return prev;
        return [{ name, status: 'downloading', progress: 0, path }, ...prev].slice(0, 5);
      });
      setIsDownloading(true);
      setDownloadStatus('in_progress');
      openDownloadsPanel();
    });

    const cleanProgress = window.electronAPI.on('download-progress', ({ name, progress }: { name: string, progress: number }) => {
      setDownloads(prev => prev.map(d => d.name === name ? { ...d, progress } : d));
    });

    const cleanDone = window.electronAPI.on('download-complete', ({ name, path }: { name: string, path?: string }) => {
      setDownloads(prev => prev.map(d => d.name === name ? { ...d, status: 'completed', progress: 100, path } : d));
      setIsDownloading(false);
      setDownloadStatus('completed');
    });

    const cleanFail = window.electronAPI.on('download-failed', (name: string) => {
      setDownloads(prev => prev.map(d => d.name === name ? { ...d, status: 'failed' } : d));
      setIsDownloading(false);
      setDownloadStatus('failed');
    });

    return () => {
      cleanStart();
      cleanProgress();
      cleanDone();
      cleanFail();
    };
  }, [openDownloadsPanel]);

  useEffect(() => {
    if (window.electronAPI) {
      const cleanExtInstalled = window.electronAPI.on('extension-installed', ({ name, id }: { name: string, id: string }) => {
        const providerId = store.aiProvider || 'ollama';
        const modelName = resolveProviderModel(providerId);
        setAiOverview({ query: `Extension Installed: ${name}`, result: `Successfully installed extension ${name}. You can manage it in settings.`, sources: null, isLoading: false, provider: providerId, model: modelName });
      });

      const cleanTheme = window.electronAPI.on('apply-theme', (theme: any) => {
        if (theme && theme.colors) {
          const colors = theme.colors;
          const root = document.documentElement;
          if (colors.frame) root.style.setProperty('--primary-bg', `rgb(${colors.frame.join(',')})`);
          if (colors.toolbar) root.style.setProperty('--navbar-bg', `rgb(${colors.toolbar.join(',')})`);
          if (colors.tab_text) root.style.setProperty('--primary-text', `rgb(${colors.tab_text.join(',')})`);
          const providerId = store.aiProvider || 'ollama';
          const modelName = resolveProviderModel(providerId);
          setAiOverview({ query: `Theme Applied`, result: `Successfully applied Chrome theme.`, sources: null, isLoading: false, provider: providerId, model: modelName });
        }
      });

      const cleanTranslation = window.electronAPI.on('trigger-translation-dialog', () => {
        setShowTranslateDialog(true);
        window.electronAPI?.bringWindowToTop();
      });

      return () => {
        cleanExtInstalled();
        cleanTheme();
        cleanTranslation();
      };
    }
  }, []);

  // Close tools dropdown on outside click
  useEffect(() => {
    if (!showToolsMenu) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.tools-menu-container')) setShowToolsMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showToolsMenu]);

  // Listen for actions forwarded from popup windows
  useEffect(() => {
    if (!window.electronAPI) return;
    const clean = window.electronAPI.on('execute-popup-action', (action: any) => {
      if (action.action === 'tool-select') {
        setShowToolsMenu(false);
        store.setActiveView(action.view as any);
        setActiveManager(null);
        if (action.view !== 'browser') {
          window.electronAPI?.hideAllViews();
        } else {
          window.electronAPI?.showAllViews();
        }
      } else if (action.action === 'open-setting') {
        openSettingsPanel(action.section);
      } else if (action.action === 'open-popup') {
        setShowToolsMenu(false);
        setIsBrowserDisabled(true);
        switch (action.popupType) {
          case 'plugins': setShowExtensionsPopup(true); break;
          case 'clipboard': openClipboardPanel(); break;
          case 'translate': openTranslateDialog(); break;
          case 'search': setShowSpotlightSearch(true); break;
          case 'downloads': openDownloadsPanel(); break;
          case 'cart': setShowCart(true); break;
        }
      } else if (action.action === 'cycle-theme') {
        cycleTheme();
      } else if (action.action === 'create-shortcut') {
        handleCreateShortcut();
      } else if (action.action === 'save-page') {
        handleOfflineSave();
      } else if (action.action === 'search-with-ai') {
        runAiOverview(store.currentUrl);
      }
    });
    return () => clean();
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  const handleReadAloud = async () => {
    if (isReadingAloud) {
      window.speechSynthesis.cancel();
      setIsReadingAloud(false);
      return;
    }

    if (window.electronAPI) {
      let text = await window.electronAPI.getSelectedText();

      if (!text || text.trim().length === 0) {
        const pageContent = await window.electronAPI.extractPageContent();
        if (pageContent && pageContent.content) {
          text = pageContent.content.substring(0, 5000);
        }
      }

      const pageText = text || "No readable content found on this page.";

      const utterance = new SpeechSynthesisUtterance(pageText);
      const voices = window.speechSynthesis.getVoices();

      const langMap: Record<string, string> = {
        'hi': 'Hindi', 'ta': 'Tamil', 'te': 'Telugu', 'bn': 'Bengali', 'ml': 'Malayalam', 'kn': 'Kannada'
      };

      const targetLang = store.selectedLanguage;
      const voice = voices.find(v => v.lang.startsWith(targetLang) || (langMap[targetLang] && v.name.includes(langMap[targetLang]))) || voices[0];

      if (voice) utterance.voice = voice;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      utterance.onend = () => setIsReadingAloud(false);
      utterance.onerror = () => setIsReadingAloud(false);

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
      setIsReadingAloud(true);
    }
  };

  const handleMusicUpload = async () => {
    if (window.electronAPI) {
      const filePath = await window.electronAPI.selectLocalFile({
        filters: [
          { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile', 'openDirectory']
      });
      if (filePath) {
        store.setAmbientMusicUrl(`media://${filePath}`);
      }
    }
  };

  const handlePopSearch = async () => {
    if (window.electronAPI) {
      const selectedText = await window.electronAPI.getSelectedText();
      if (window.electronAPI.popSearchShowAtCursor) {
        await window.electronAPI.popSearchShowAtCursor(selectedText || '');
      } else if (window.electronAPI.popSearchShow) {
        await window.electronAPI.popSearchShow(selectedText || '', 140, 140);
      }
    }
  };

  // Ambient Music Control
  useEffect(() => {
    const shouldPlay = () => {
      if (!store.enableAmbientMusic) return false;
      switch (store.ambientMusicMode) {
        case 'always': return true;
        case 'google': return store.currentUrl.includes('google.com/search');
        case 'idle': return false;
        case 'off':
        default: return false;
      }
    };

    if (shouldPlay()) {
      if (ambientAudioRef.current) {
        ambientAudioRef.current.play().catch(e => console.log("Autoplay blocked", e));
        setIsAmbientPlaying(true);
      }
    } else {
      if (ambientAudioRef.current) {
        ambientAudioRef.current.pause();
        setIsAmbientPlaying(false);
      }
    }
  }, [store.currentUrl, store.enableAmbientMusic, store.ambientMusicMode]);

  // Ambient Music Volume Control
  useEffect(() => {
    if (ambientAudioRef.current) {
      ambientAudioRef.current.volume = store.ambientMusicVolume;
    }
  }, [store.ambientMusicVolume]);

  // Translation Trigger
  useEffect(() => {
    if (window.electronAPI) {
      const clean = window.electronAPI.onTriggerTranslationDialog(() => {
        setShowTranslateDialog(true);
        window.electronAPI?.bringWindowToTop();
      });
      return clean;
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const rightClickTimerRef = useRef<any>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) {
      rightClickTimerRef.current = setTimeout(() => {
        handlePopSearch();
      }, 500);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (rightClickTimerRef.current) {
      clearTimeout(rightClickTimerRef.current);
      rightClickTimerRef.current = null;
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.electronAPI) {
      window.electronAPI.openContextMenuPopup({
        x: Math.round(e.screenX),
        y: Math.round(e.screenY),
        width: 240,
        height: 420,
      });
    } else {
      const menuWidth = 192;
      const menuHeight = 250;
      const padding = 16;
      let x = e.clientX;
      let y = e.clientY;
      if (e.clientX + menuWidth + padding > window.innerWidth) x = window.innerWidth - menuWidth - padding;
      if (e.clientY + menuHeight + padding > window.innerHeight) y = window.innerHeight - menuHeight - padding;
      setShowContextMenu({ x, y });
    }
  };

  const handleTranslate = async () => {
    setShowContextMenu(null);
    if (window.electronAPI) {
      const selectedText = await window.electronAPI.getSelectedText();
      const textToTranslate = selectedText || store.currentUrl;
      const targetLang = store.selectedLanguage || 'English';

      const providerId = store.aiProvider || 'ollama';
      const modelName = resolveProviderModel(providerId);

      setAiOverview({ query: `Translating: ${textToTranslate.substring(0, 30)}...`, result: null, sources: null, isLoading: true, provider: providerId, model: modelName });

      const translated = await BrowserAI.translateText(textToTranslate, targetLang);
      setAiOverview({ query: `Neural Translation (to ${targetLang})`, result: translated, sources: null, isLoading: false, provider: providerId, model: modelName });
    }
  };

  const isBookmarked = store.bookmarks.some(b => b.url === store.currentUrl);
  const normalizedToolbarOrder = (store.toolbarIconOrder?.length ? store.toolbarIconOrder : ['downloads', 'clipboard', 'cart', 'translate', 'extensions', 'quick-search']).filter((id, index, order) => order.indexOf(id) === index) as ToolbarActionId[];
  const toolbarOrder = [...normalizedToolbarOrder, ...(['downloads', 'clipboard', 'cart', 'translate', 'extensions', 'quick-search'] as ToolbarActionId[]).filter((id) => !normalizedToolbarOrder.includes(id))];
  const hasSideTabs = store.browserTabLayout === 'left' || store.browserTabLayout === 'right' || store.browserTabLayout === 'both';
  const sideTabsOnRight = store.browserTabLayout === 'right';
  const topTabsHeight = 0;
  const sideTabsWidth = hasSideTabs ? 220 : 0;

  const isToolbarActionVisible = (id: ToolbarActionId) => {
    switch (id) {
      case 'downloads': return store.showDownloadsIcon;
      case 'clipboard': return store.showClipboardIcon;
      case 'cart': return store.showCartIcon;
      case 'translate': return store.showTranslateIcon;
      case 'extensions': return store.showExtensionsIcon;
      case 'quick-search': return true;
      default: return true;
    }
  };

  const setToolbarActionVisible = (id: ToolbarActionId, visible: boolean) => {
    switch (id) {
      case 'downloads': store.setShowDownloadsIcon(visible); break;
      case 'clipboard': store.setShowClipboardIcon(visible); break;
      case 'cart': store.setShowCartIcon(visible); break;
      case 'translate': store.setShowTranslateIcon(visible); break;
      case 'extensions': store.setShowExtensionsIcon(visible); break;
    }
  };

  const reorderToolbarAction = (targetId: ToolbarActionId) => {
    if (!draggedToolbarAction || draggedToolbarAction === targetId) return;
    const nextOrder = toolbarOrder.filter((id) => id !== draggedToolbarAction);
    const targetIndex = nextOrder.indexOf(targetId);
    nextOrder.splice(Math.max(0, targetIndex), 0, draggedToolbarAction);
    store.setToolbarIconOrder(nextOrder);
    setDraggedToolbarAction(null);
  };

  const handleBookmark = () => {
    const activeTab = store.tabs.find(t => t.id === store.activeTabId);
    if (activeTab) {
      if (isBookmarked) {
        store.removeBookmark(activeTab.url);
      } else {
        store.addBookmark({ url: activeTab.url, title: activeTab.title || activeTab.url });
      }
    }
  };

  // Tab Switching logic (Alt + Tab and Alt + Scroll)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close all panels and return to browser view when ESC is pressed
        let panelWasOpen = false;
        
        if (showSettings) { handleSettingsClose(); panelWasOpen = true; }
        if (showDownloads) { setShowDownloads(false); panelWasOpen = true; }
        if (showCart) { setShowCart(false); panelWasOpen = true; }
        if (showExtensionsPopup) { setShowExtensionsPopup(false); panelWasOpen = true; }
        if (showClipboard) { setShowClipboard(false); panelWasOpen = true; }
        if (showSpotlightSearch) { setShowSpotlightSearch(false); panelWasOpen = true; }
        if (showTranslateDialog) { closeTranslateDialog(); panelWasOpen = true; }
        if (showSchedulingModal) { setShowSchedulingModal(false); panelWasOpen = true; }
        if (aiOverview) { setAiOverview(null); panelWasOpen = true; }
        
        // Close any active manager (Studio, PresentOn, etc.) and return to browser
        if (activeManager) { 
          setActiveManager(null); 
          store.setActiveView('browser');
          window.electronAPI?.showAllViews();
          panelWasOpen = true; 
        }
        
        // If no panel was open, check if we're in a non-browser view and return to browser
        if (!panelWasOpen && store.activeView !== 'browser') {
          store.setActiveView('browser');
          window.electronAPI?.showAllViews();
        }
        
        return;
      }

      if (e.altKey && e.key === 'Tab') {
        e.preventDefault();
        setShowTabSwitcher(true);
      }

      if (e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          window.electronAPI?.changeZoom(-1);
        } else if (e.key === '-') {
          e.preventDefault();
          window.electronAPI?.changeZoom(1);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setShowTabSwitcher(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [showSettings, showDownloads, showCart, showExtensionsPopup, showClipboard, showSpotlightSearch, aiOverview, showTranslateDialog, showSchedulingModal, activeManager, store.activeView]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (window.electronAPI) {
          window.electronAPI.changeZoom(e.deltaY);
        }
      } else if (e.altKey) {
        e.preventDefault();
        if (e.deltaY > 0) store.nextTab();
        else store.prevTab();
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [store]);

  const resolveProviderModel = useCallback((providerId: string) => {
    switch (providerId) {
      case 'google-flash': return store.geminiFlashModel || getRecommendedGeminiModel('google-flash');
      case 'google': return store.geminiModel || getRecommendedGeminiModel('google');
      case 'openai': return store.openaiModel || 'gpt-4o';
      case 'azure-openai': return store.azureOpenaiModel || 'gpt-4.1-mini';
      case 'anthropic': return store.anthropicModel || 'claude-sonnet-4-20250514';
      case 'xai': return store.xaiModel || 'grok-4-fast-reasoning';
      case 'groq': return store.groqModel || 'llama-3.3-70b-versatile';
      case 'ollama': return store.ollamaModel;
      default: return providerId;
    }
  }, [
    store.anthropicModel,
    store.azureOpenaiModel,
    store.geminiFlashModel,
    store.geminiModel,
    store.groqModel,
    store.openaiModel,
    store.xaiModel,
    store.ollamaModel,
  ]);

  const runAiOverview = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query || !store.enableAIAssist) return null;
    const providerId = store.aiProvider || 'ollama';
    const modelName = resolveProviderModel(providerId);

    setAiOverview({
      query,
      result: null,
      sources: null,
      isLoading: true,
      provider: providerId,
      model: modelName,
      statusMessage: 'Gathering context…',
    });

    const [contextItems, webSearchResults] = await Promise.all([
      BrowserAI.retrieveContext(query),
      window.electronAPI.webSearchRag(query).catch(() => []) as Promise<string[]>
    ]);

    setAiOverview(prev => prev ? {
      ...prev,
      statusMessage: `${contextItems.length} local memories + ${webSearchResults.length} live results ready`
    } : prev);

    const contextString = [
      "--- LOCAL MEMORIES ---",
      contextItems.map((c) => c.text).join('\n\n'),
      "--- LIVE WEB RESULTS ---",
      webSearchResults.join('\n\n')
    ].join('\n\n');

    const prompt = `Synthesize a comprehensive, Perplexity-style answer for: "${query}". 
    
    CRITICAL INSTRUCTIONS:
    1. Use the [LIVE WEB RESULTS] for primary factual information.
    2. ALWAYS cite the source using the exact Markdown format provided [Title](URL) whenever you state a fact or insight from that source.
    3. Include a clear direct answer (2 paragraphs max).
    4. Provide 3 deep insights.
    5. Mention contextual relevance to the user's local data (from LOCAL MEMORIES).
    
    Format with HTML bolding and clear sections.`;

    const startTime = Date.now();
    let response: AiOverviewResponse;
    try {
      response = await fetchAiOverview({
        query: prompt,
        context: contextString,
        provider: providerId,
        model: modelName,
        baseUrl: store.ollamaBaseUrl,
        localLlmMode: store.localLlmMode,
        extraInstructions: 'Use HTML bolding for highlights and number the insights.',
      });
    } catch (error: any) {
      const message = error?.message || 'Overview failed';
      setAiOverview({
        query,
        result: null,
        sources: contextItems,
        isLoading: false,
        provider: providerId,
        model: modelName,
        statusMessage: message,
        durationMs: Date.now() - startTime,
        error: message,
      });
      return { error: message, provider: providerId, model: modelName, durationMs: Date.now() - startTime };
    }

    const statusMsg = response.error
      ? `Error: ${response.error}`
      : `Delivered in ${response.durationMs ?? (Date.now() - startTime)}ms | ${contextItems.length} contexts`;

    setAiOverview({
      query,
      result: response.text || response.error || null,
      sources: contextItems,
      isLoading: false,
      provider: providerId,
      model: modelName,
      statusMessage: statusMsg,
      durationMs: response.durationMs,
      error: response.error,
    });

    return response;
  }, [
    resolveProviderModel,
    store.enableAIAssist,
    store.aiProvider,
    store.localLlmMode,
  ]);

  // ─────────────────────────────────────────────────────────────────────────
  // APPLY THEME
  // Resolves 'system' → OS preference, then applies the correct CSS class.
  // 'vibrant' and 'minimal' add dedicated CSS classes (defined in globals.css) so
  // browser chrome can pick up its own surface and accent tokens.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const root = window.document.documentElement;

    // Remove all theme classes first
    root.classList.remove('light', 'dark', 'vibrant', 'custom', 'minimal');

    let resolved: AppTheme = store.theme as AppTheme;

    if (resolved === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    root.style.setProperty('--custom-primary', store.customThemePrimary || '#ff6b6b');
    root.style.setProperty('--custom-secondary', store.customThemeSecondary || '#22d3ee');
    const accentPreset = BROWSER_ACCENT_PRESETS.find((preset) => preset.id === store.browserAccentPreset) || BROWSER_ACCENT_PRESETS[0];
    root.style.setProperty('--browser-accent-1', accentPreset.primary);
    root.style.setProperty('--browser-accent-2', accentPreset.secondary);

    // Apply the resolved class
    root.classList.add(resolved);

    const browserThemeSource =
      store.theme === 'system'
        ? 'system'
        : resolved === 'light'
          ? 'light'
          : 'dark';

    window.electronAPI?.setNativeThemeSource?.(browserThemeSource).catch((error: unknown) => {
      console.warn('[Theme] Failed to sync native theme source:', error instanceof Error ? error.message : error);
    });
  }, [store.theme, store.customThemePrimary, store.customThemeSecondary, store.browserAccentPreset]);

  // ─────────────────────────────────────────────────────────────────────────
  // THEME CYCLE HELPER  (dark → light → vibrant → dark → …)
  // Calls the existing store.setTheme so settings panel stays in sync.
  // ─────────────────────────────────────────────────────────────────────────
  const cycleTheme = useCallback(() => {
    const current = store.theme as AppTheme;
    // Treat 'system' as 'dark' for cycling purposes
    const idx = THEME_CYCLE.indexOf(current === 'system' ? 'dark' : current);
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    store.setTheme(next);
  }, [store.theme, store.setTheme]);

  // Init Browser Intelligence
  useEffect(() => {
    BrowserAI.initURLPredictor();
    if (useAppStore.getState().enableCrossSessionMemory) {
      BrowserAI.loadVectorMemory();
    }
  }, []);

  // AI Query Interception
  useEffect(() => {
    if (window.electronAPI && store.enableAIAssist && store.enableAiOverview) {
      const cleanup = window.electronAPI.onAiQueryDetected((query: any) => {
        runAiOverview(query);
      });
      return cleanup;
    }
  }, [store.enableAIAssist, store.enableAiOverview, runAiOverview]);

  // Automatic Sidebar & AI Scaling
  useEffect(() => {
    const handleSmartScaling = () => {
      if (isResizingRef.current) return;
      const width = window.innerWidth;
      if (width < 1200) {
        if (store.sidebarWidth > 350) store.setSidebarWidth(350);
      } else if (width > 1800) {
        if (store.sidebarWidth < 500) store.setSidebarWidth(500);
      }
    };

    window.addEventListener('resize', handleSmartScaling);
    handleSmartScaling();
    return () => window.removeEventListener('resize', handleSmartScaling);
  }, [store.sidebarWidth]);

  // PWA Service Worker Registration
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') return;

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then((reg) => {
          console.log('SW registered:', reg);
        }).catch((err) => {
          console.log('SW reg failed:', err);
        });
      });
    }
  }, []);

  // Fetch initial online status
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getIsOnline().then((onlineStatus) => {
        store.setIsOnline(onlineStatus);
        console.log("Initial online status:", onlineStatus);
      });

      if (store.enableAdblocker) {
        window.electronAPI.toggleAdblocker(true);
      }
    }
  }, []);

  const addClipboardItem = useAppStore(state => state.addClipboardItem);

  // Clipboard sync
  useEffect(() => {
    if (window.electronAPI) {
      console.log("[Renderer] Setting up clipboard listener");
      const clean = window.electronAPI.on('clipboard-changed', (text: string) => {
        if (text) {
          console.log("[Renderer] Received clipboard update:", text.substring(0, 20));
          addClipboardItem(text);
        }
      });
      return clean;
    }
  }, [addClipboardItem]);

  useEffect(() => {
    if (!window.electronAPI?.on) return;
    const cleanup = window.electronAPI.on('native-mac-ui-clear-clipboard', () => {
      clearClipboardHistory();
    });
    return cleanup;
  }, [clearClipboardHistory]);

  useEffect(() => {
    if (!window.electronAPI?.onShowPasswordSaveDialog) return;
    const cleanup = window.electronAPI.onShowPasswordSaveDialog((data) => {
      setPasswordSaveDialog(data);
    });
    return cleanup;
  }, []);

  // Debounced Predictor and Suggestions Fetcher
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (isTyping && inputValue.length > 1) {
        const preds = await BrowserAI.predictUrl(inputValue, store.history.map(h => h.url));
        setUrlPrediction(preds[0] || null);

        if (window.electronAPI) {
          const rawWebSuggestions = await window.electronAPI.getSuggestions(inputValue);
          const webSuggestions = Array.isArray(rawWebSuggestions)
            ? rawWebSuggestions.map((suggestion: any) => normalizeSuggestion(suggestion)).filter((suggestion: any) => suggestion.text || suggestion.url)
            : [];
          const appSearch = await window.electronAPI.searchApplications(inputValue);
          const appSuggestions = appSearch.success ? appSearch.results.map((app: any) => ({
            type: 'app',
            text: displayText(app.name || app.path, 'Application'),
            url: displayText(app.path),
            icon: <Briefcase size={14} />
          })) : [];

          setSuggestions([...webSuggestions, ...appSuggestions.map((suggestion: any) => normalizeSuggestion(suggestion, 'app'))]);
        }
      } else {
        setUrlPrediction(null);
        setSuggestions([]);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [inputValue, isTyping, store.history]);

  const inputRef = useRef<HTMLInputElement>(null);

  // Active Time Tracker
  useEffect(() => {
    if (store.user && store.activeStartTime) {
      const interval = setInterval(() => {
        store.updateActiveTime();
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [store.user, store.activeStartTime]);

  useEffect(() => {
    if (store.cloudSyncConsent) {
      console.log("Cloud sync consented. Initializing sync...");
      firebaseSyncService.syncClipboard();
      firebaseSyncService.syncHistory();
      firebaseSyncService.syncApiKeys();
    }
  }, [store.cloudSyncConsent]);

  // Audio Playback Listener
  useEffect(() => {
    if (window.electronAPI) {
      const cleanup = window.electronAPI.onAudioStatusChanged((isPlaying) => {
        setIsAudioPlaying(isPlaying);

        if (isPlaying) {
          const premiumColors = ['rgb', '#00E5FF', '#FF00E5', '#7000FF', '#00FF94', '#FFD600'];
          const randomColor = premiumColors[Math.floor(Math.random() * premiumColors.length)];
          setAiPickColor(randomColor);
        }
      });
      return cleanup;
    }
  }, []);

  // Download Status Listener
  useEffect(() => {
    if (window.electronAPI) {
      const cleanupStarted = window.electronAPI.onDownloadStarted((filename: string) => {
        console.log(`Download started: ${filename}`);
        setDownloadStatus('in_progress');
        setIsDownloading(true);
      });

      const cleanupComplete = window.electronAPI.on('download-complete', (filename: string) => {
        console.log(`Download completed: ${filename}`);
        setDownloadStatus('completed');
        setIsDownloading(false);
        setTimeout(() => setDownloadStatus('idle'), 3000);
      });

      const cleanupFailed = window.electronAPI.on('download-failed', (filename: string) => {
        console.error(`Download failed: ${filename}`);
        setDownloadStatus('failed');
        setIsDownloading(false);
        setTimeout(() => setDownloadStatus('idle'), 3000);
      });

      return () => {
        cleanupStarted();
        cleanupComplete();
        cleanupFailed();
      };
    }
  }, []);

  // Handle Global Shortcuts from Main Process
  useEffect(() => {
    if (window.electronAPI) {
      const cleanupShortcuts = window.electronAPI.onShortcut((action: string) => {
        switch (action) {
          case 'new-tab': store.addTab(); break;
          case 'close-tab': store.removeTab(store.activeTabId); break;
          case 'next-tab': store.nextTab(); break;
          case 'prev-tab': store.prevTab(); break;
          case 'toggle-sidebar':
            if (isMacOS && useAppStore.getState().macNativeSidebarMode === 'swiftui') {
              useAppStore.setState({ activeView: 'browser', sidebarOpen: false });
              window.electronAPI.toggleMacNativePanel?.('sidebar');
            } else {
              store.toggleSidebar();
            }
            break;
          case 'open-settings':
            openSettingsPanel('profile');
            break;
          case 'new-incognito-tab': store.addIncognitoTab(); break;
          case 'toggle-spotlight': setShowSpotlightSearch(prev => !prev); break;
          case 'cycle-theme': cycleTheme(); break;
          case 'open-history': openSettingsPanel('history', { preferElectron: true }); break;
          case 'clear-history': store.clearHistory(); break;
          case 'open-downloads':
            if (isMacOS && useAppStore.getState().macNativeUtilityPanelMode === 'swiftui') {
              window.electronAPI.showMacNativePanel?.('downloads');
            } else {
              setShowDownloads(true);
            }
            break;
          case 'open-extensions': openSettingsPanel('extensions', { preferElectron: true }); break;
          case 'open-bookmarks': openSettingsPanel('vault', { preferElectron: true }); break;
          case 'open-workspace': store.setActiveView('workspace'); break;
          case 'open-webstore': store.setActiveView('webstore'); break;
          case 'open-ai-chat':
            store.setActiveView('browser');
            if (isMacOS && useAppStore.getState().macNativeSidebarMode === 'swiftui') {
              useAppStore.setState({ sidebarOpen: false });
              window.electronAPI.showMacNativePanel?.('sidebar');
            } else {
              useAppStore.setState({ sidebarOpen: true });
            }
            break;
          case 'open-media-studio': store.setActiveView('media'); break;
          case 'open-presenton': store.setActiveView('presenton'); break;
          case 'open-p2p-sync': store.setActiveView('p2psync'); break;
          case 'open-password-manager': store.setActiveView('passwords'); break;
          case 'open-proxy-firewall': store.setActiveView('firewall'); break;
          case 'open-pdf-workspace': store.setActiveView('pdf'); break;
          case 'open-coding-dashboard': store.setActiveView('coding'); break;
          case 'open-documentation': store.setActiveView('documentation'); break;
          case 'open-cart': setShowCart(true); break;
          case 'open-camera': setShowCamera(true); break;
          case 'open-clipboard':
            if (isMacOS && useAppStore.getState().macNativeUtilityPanelMode === 'swiftui') {
              window.electronAPI.showMacNativePanel?.('clipboard');
            } else {
              setShowClipboard(true);
            }
            break;
          case 'toggle-ai-assist': store.setEnableAIAssist(!store.enableAIAssist); break;
          case 'toggle-ai-overview': store.setEnableAiOverview(!store.enableAiOverview); break;
          case 'command-center':
            window.dispatchEvent(new CustomEvent('aartiq:command-center'));
            break;
          case 'focus-ai-prompt':
            window.dispatchEvent(new CustomEvent('aartiq:focus-ai'));
            break;
          case 'toggle-autonomous':
            window.dispatchEvent(new CustomEvent('aartiq:toggle-autonomous'));
            break;
          case 'abort-action':
            window.dispatchEvent(new CustomEvent('aartiq:abort-action'));
            break;
          case 'focus-ai':
          case 'focus-ai-chat':
            useAppStore.setState({ sidebarOpen: true });
            window.dispatchEvent(new CustomEvent('aartiq:focus-ai'));
            break;
          case 'reload-tab': window.electronAPI.reload(); break;
        }
      });

      const cleanupSettings = window.electronAPI.on('set-settings-section', (section: string) => {
        openSettingsPanel(section, { preferElectron: true });
      });

      return () => {
        cleanupShortcuts();
        cleanupSettings();
      };
    }
  }, [store.addTab, store.removeTab, store.activeTabId, store.nextTab, store.prevTab, store.toggleSidebar, cycleTheme]);

  // Fetch extensions when popup is opened
  useEffect(() => {
    if (showExtensionsPopup && window.electronAPI) {
      window.electronAPI.getExtensions().then((exts: any) => {
        setActiveExtensions(exts);
      });
    }
  }, [showExtensionsPopup]);

  // Dynamic Ollama Model Fetch
  useEffect(() => {
    if (window.electronAPI && store.aiProvider === 'ollama') {
      window.electronAPI.ollamaListModels().then((res: any) => {
        if (res.models) {
          store.setOllamaModelsList(res.models);
          console.log('Loaded Ollama models:', res.models);
        } else if (res.error) {
          console.error('Failed to load Ollama models:', res.error);
        }
      });
    }
  }, [store.aiProvider]);

  const handleGo = (urlToNavigate?: string, options?: { newTab?: boolean; active?: boolean }) => {
    const { newTab = false, active = true } = options || {};
    let raw = urlToNavigate || inputValue.trim();
    if (!raw) return;

    if (raw.startsWith('>>')) {
      if (window.electronAPI) {
        window.electronAPI.wifiSyncBroadcast({ type: 'agent-task', task: raw.substring(2).trim() });
        setInputValue('');
        return;
      } else {
        console.warn("Electron API not available for agent task");
        return;
      }
    }

    const isAuthUrl = (testUrl: string) => {
      try {
        const hostname = new URL(testUrl).hostname;
        return hostname.includes('accounts.google.com') || hostname.includes('accounts.youtube.com') || hostname.includes('aartiq-three.vercel.app');
      } catch {
        return false;
      }
    };

    if (isAuthUrl(raw) && window.electronAPI) {
      window.electronAPI.openAuthWindow(raw);
      return;
    }

    const mathChars = /^[0-9+\-*/().\s^%]+$/;
    if (mathChars.test(raw)) {
      try {
        const result = safeEval(raw.replace(/\^/g, '**'));
        if (typeof result === 'number' && !isNaN(result)) {
          const searchUrl = `${searchEngines[store.selectedEngine as keyof typeof searchEngines].url}${encodeURIComponent(raw + " = " + result)}`;
          if (window.electronAPI) {
            window.electronAPI.navigateBrowserView({ tabId: store.activeTabId, url: searchUrl });
          }
          return;
        }
      } catch (e) { }
    }

    // Normalize URL: detect if input is a URL or search query
    let url = raw;
    const hasProtocol = /^https?:\/\//i.test(url);
    const hasDot = /\.\w{2,}/.test(url);
    const hasSpace = url.includes(' ');
    const isIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?(\/.*)?$/.test(url);
    const isLocalhost = /^localhost(:\d+)?(\/.*)?$/i.test(url);
    const isDomainWithPort = /^[a-zA-Z0-9-]+:\d+(\/.*)?$/.test(url);

    if (!hasProtocol) {
      if (isIp || isLocalhost || hasDot || isDomainWithPort) {
        url = `https://${url}`;
      } else {
        url = `${searchEngines[store.selectedEngine as keyof typeof searchEngines].url}${encodeURIComponent(url)}`;
        if (store.enableAIAssist) runAiOverview(raw);
      }
    }

    if (newTab) {
      store.addTab(url);
    } else {
      store.setCurrentUrl(url);
      if (window.electronAPI) {
        window.electronAPI.navigateBrowserView({ tabId: store.activeTabId, url });
      }
    }
  };

  const handleSuggestionClick = (suggestion: any) => {
    const targetUrl = displayText(suggestion?.url);
    if (suggestion.type === 'app') {
      if (window.electronAPI && targetUrl) {
        window.electronAPI.openExternalApp(targetUrl);
      }
    } else {
      handleGo(targetUrl);
    }
    setSuggestions([]);
    setIsTyping(false);
  };

  const handleOfflineSave = async () => {
    if (!window.electronAPI) return;
    const html = await window.electronAPI.capturePageHtml();
    const activeTab = store.tabs.find(t => t.id === store.activeTabId);
    if (activeTab) {
      await window.electronAPI.saveOfflinePage({ url: activeTab.url, title: activeTab.title, html });
      store.savePageOffline(activeTab.url, activeTab.title, html);
    }
  };

  const handleCreateShortcut = async () => {
    if (!window.electronAPI) return;
    const activeTab = store.tabs.find(t => t.id === store.activeTabId);
    if (activeTab) {
      const result = await (window.electronAPI as any).createDesktopShortcut({ url: activeTab.url, title: activeTab.title });
      if (result.success) {
        alert(`Shortcut created on Desktop: ${activeTab.title}`);
      } else {
        alert(`Failed to create shortcut: ${result.error}`);
      }
    }
  };

  const handleCartScan = async () => {
    if (!window.electronAPI) return;
    setShowCart(true);
    setIsBrowserDisabled(true);
    try {
      const result = await window.electronAPI.executeJavaScript(`
        (function() {
          const items = [];
          const priceRegex = /\\$[0-9,]+(\\.[0-9]{2})?/;
          
          document.querySelectorAll('h1, h2, .product-title, .product-name').forEach(el => {
            const text = el.innerText.trim();
            if (text.length > 5 && text.length < 100) {
              const priceMatch = document.body.innerText.match(priceRegex);
              items.push({
                id: Math.random().toString(36).substr(2, 9),
                item: text,
                site: window.location.hostname,
                price: priceMatch ? priceMatch[0] : '$???'
              });
            }
          });
          return items.slice(0, 5);
        })()
      `);
      if (result && result.length > 0) {
        result.forEach((item: any) => store.addToUnifiedCart(item));
      }
    } catch (e) {
      console.error("Cart scan failed:", e);
    }
  };

  const calculateBounds = useCallback(() => {
    if (!store.hasCompletedStartupSetup || !store.hasSeenWelcomePage || store.activeView !== 'browser') {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const hasActiveOverlay = showSettings || activeManager !== null || showCamera || showDownloads || showCart || showExtensionsPopup || showClipboard || showSpotlightSearch || aiOverview || showTranslateDialog || showSchedulingModal;
    if (hasActiveOverlay) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const aiSidebarWidth = !store.sidebarOpen ? 0 : (store.isSidebarCollapsed ? 70 : store.sidebarWidth);
    const isCompactMode = store.theme === 'minimal' && store.minimalCompactMode;
    const headerHeight = isCompactMode ? 0 : (40 + 56 + topTabsHeight);
    const effectiveSideTabsWidth = isCompactMode ? 0 : sideTabsWidth;

    let x = 0;
    if (store.sidebarSide === 'left') {
      x = aiSidebarWidth;
    }

    if (hasSideTabs && !sideTabsOnRight) {
      x += effectiveSideTabsWidth;
    }

    const width = window.innerWidth - aiSidebarWidth - effectiveSideTabsWidth;
    const height = window.innerHeight - headerHeight;

    return {
      x: Math.round(x),
      y: Math.round(headerHeight),
      width: Math.max(0, Math.round(width)),
      height: Math.max(0, Math.round(height))
    };
  }, [store.sidebarOpen, store.isSidebarCollapsed, store.sidebarWidth, store.sidebarSide, store.hasCompletedStartupSetup, store.hasSeenWelcomePage, store.activeView, topTabsHeight, hasSideTabs, sideTabsOnRight, sideTabsWidth, store.theme, store.minimalCompactMode, showSettings, activeManager, showCamera, showDownloads, showCart, showExtensionsPopup, showClipboard, showSpotlightSearch, aiOverview, showTranslateDialog, showSchedulingModal]);

  const handleResize = useCallback(() => {
    if (window.electronAPI) {
      const bounds = calculateBounds();
      window.electronAPI.setBrowserViewBounds(bounds);
    }
  }, [calculateBounds]);

  useEffect(() => {
    if (window.electronAPI) {
      const bounds = calculateBounds();
      window.electronAPI.setBrowserViewBounds(bounds);
    }

    if (store.activeView === 'browser') {
      window.addEventListener('resize', handleResize);
    }

    let cleanupFullscreen: (() => void) | undefined;
    if (window.electronAPI?.onWindowFullscreenChanged) {
      cleanupFullscreen = window.electronAPI.onWindowFullscreenChanged(() => {
        requestAnimationFrame(() => {
          handleResize();
        });
      });
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      cleanupFullscreen?.();
    };
  }, [handleResize, store.activeView]);

  // View Management Effects
  useEffect(() => {
    if (window.electronAPI) {
      store.tabs.forEach(tab => {
        window.electronAPI.createView({ tabId: tab.id, url: tab.url });
      });

      if (store.activeTabId) {
        const bounds = calculateBounds();
        window.electronAPI.activateView({ tabId: store.activeTabId, bounds });
      }
    }
  }, []);

  useEffect(() => {
    if (window.electronAPI) {
      const hasFullScreenOverlay = !store.hasSeenWelcomePage || !store.hasCompletedStartupSetup || showSettings || activeManager !== null || showCamera || showDownloads || showCart || showExtensionsPopup || showClipboard || showSpotlightSearch || aiOverview || (isTyping && suggestions.length > 0) || showTranslateDialog || showSchedulingModal || store.customizationPanelOpen || store.activeView !== 'browser';

      if (hasFullScreenOverlay) {
        window.electronAPI.hideAllViews();
        return;
      }

      if (store.activeView === 'browser' && store.activeTabId) {
        const bounds = calculateBounds();
        window.electronAPI.activateView({ tabId: store.activeTabId, bounds });
      } else {
        window.electronAPI.hideAllViews();
      }
    }
  }, [
    store.activeTabId,
    store.activeView,
    calculateBounds,
    showSettings,
    activeManager,
    showCamera,
    showDownloads,
    showCart,
    showExtensionsPopup,
    showClipboard,
    showSpotlightSearch,
    aiOverview,
    isTyping,
    suggestions.length,
    store.hasSeenWelcomePage,
    store.hasCompletedStartupSetup,
    showTranslateDialog,
    showSchedulingModal,
    store.customizationPanelOpen
  ]);

  useEffect(() => {
    if (window.electronAPI) {
      const cleanUrl = window.electronAPI.onBrowserViewUrlChanged(({ tabId, url }) => {
        if (store.tabs.find(t => t.id === tabId)) {
          store.updateTab(tabId, { url });
          if (tabId === store.activeTabId) {
            store.setCurrentUrl(url);
            if (url && url !== 'about:blank' && !url.startsWith('file:') && !url.includes('google.com/search')) {
              store.addToHistory({ url, title: url });
            }
          }
        }
      });

      const cleanTitle = window.electronAPI.onBrowserViewTitleChanged(({ tabId, title }) => {
        if (store.tabs.find(t => t.id === tabId)) {
          store.updateTab(tabId, { title });
          if (tabId === store.activeTabId && store.currentUrl) {
            store.updateHistoryTitle(store.currentUrl, title);
          }
        }
      });

      const cleanLoading = window.electronAPI.onTabLoadingStatus(({ tabId, isLoading }) => {
        if (store.tabs.find(t => t.id === tabId)) {
          store.updateTab(tabId, { isLoading });
        }
      });

      return () => {
        cleanUrl();
        cleanTitle();
        cleanLoading();
      };
    }
  }, [store.activeTabId, store.tabs]);

  useEffect(() => {
    if (window.electronAPI) {
      const cleanup = window.electronAPI.onAddNewTab((url: string) => {
        store.addTab(url);
      });
      const cleanupNav = window.electronAPI.on('navigate-to-url', (url: string) => {
        handleGo(url);
      });
      return () => {
        cleanup();
        cleanupNav();
      };
    }
  }, [store, handleGo]);

  useEffect(() => {
    if (!window.electronAPI) {
      console.warn("electronAPI is not available. Running outside of Electron or preload script failed.");
      return;
    }

    let disposed = false;
    const restoreStoredSession = async () => {
      try {
        const savedSession = await window.electronAPI.getAuthSession();
        if (disposed || !savedSession?.user) {
          return;
        }

        store.setUser(savedSession.user);
        store.setHasSeenWelcomePage(true);

        const token = typeof savedSession.token === 'string' ? savedSession.token : null;
        if (token && !isFirebaseIdToken(token) && !isJwtExpired(token)) {
          await firebaseService.signInWithCredential(GoogleAuthProvider.credential(token));
          // Mirror the session into the main process (cloud sync / P2P live there).
          window.electronAPI?.signInFirebaseMain?.({ provider: 'google', idToken: token })?.catch?.(() => {});
          console.log('[Auth] Restored Firebase session from secure token cache.');
        }
      } catch (error) {
        console.warn('[Auth] Failed to restore stored auth session:', error);
      }
    };

    restoreStoredSession();

    const cleanup = window.electronAPI.onAuthCallback(async (event: any, url: string) => {
      console.log("Auth callback received in ClientOnlyPage:", url);
      try {
        const parsed = new URL(url);

        const code = parsed.searchParams.get("code");
        if (code) {
          console.log('[Auth] Received OAuth code — exchanging for tokens...');
          const clientId = store.clientId || '601898745585-8g9t0k72gq4q1a4s1o4d1t6t7e5v4c4g.apps.googleusercontent.com';
          const clientSecret = store.clientSecret || '';
          const redirectUri = store.redirectUri || 'https://aartiq-three.vercel.app/oauth2callback';

          if (!clientSecret) {
            console.error('[Auth] No clientSecret available — cannot exchange code for token.');
            return;
          }

          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirectUri,
              grant_type: 'authorization_code',
            }),
          });

          if (!tokenRes.ok) {
            const errBody = await tokenRes.text();
            console.error('[Auth] Token exchange failed:', errBody);
            return;
          }

          const tokens = await tokenRes.json();
          console.log('[Auth] Token exchange successful');

          if (tokens.refresh_token && window.electronAPI) {
            window.electronAPI.saveGoogleConfig({ clientId, clientSecret, redirectUri });
          }

          const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });
          const profile = await profileRes.json();

          if (tokens.id_token) {
            try {
              const { GoogleAuthProvider } = await import('firebase/auth');
              const credential = GoogleAuthProvider.credential(tokens.id_token);
              await firebaseService.signInWithCredential(credential);
              console.log('[Auth] Firebase sign-in successful');
            } catch (firebaseErr) {
              console.warn('[Auth] Firebase sign-in skipped (non-critical):', firebaseErr);
            }
          }

          store.setUser({
            uid: profile.sub,
            email: profile.email || '',
            displayName: profile.name || profile.email?.split('@')[0] || '',
            photoURL: profile.picture || '',
          });
          window.electronAPI.saveAuthSession({
            token: tokens.id_token || tokens.access_token || null,
            accessToken: tokens.access_token || null,
            idToken: tokens.id_token || null,
            refreshToken: tokens.refresh_token || null,
            scope: tokens.scope || '',
            scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : [],
            expiresIn: tokens.expires_in || null,
            provider: 'google-id-token',
            user: {
              uid: profile.sub,
              email: profile.email || '',
              displayName: profile.name || profile.email?.split('@')[0] || '',
              photoURL: profile.picture || '',
            },
            firebaseConfig: firebaseConfigStorage.load(),
            savedAt: Date.now(),
          });
          if (profile.email?.endsWith('@ponsrischool.in')) store.setAdmin(true);
          store.setHasSeenWelcomePage(true);
          store.setActiveView('landing-page');
          store.startActiveSession();
          console.log('[Auth] User signed in:', profile.email);
          return;
        }

        const status = parsed.searchParams.get("auth_status");
        const token = parsed.searchParams.get("id_token") || parsed.searchParams.get("token");
        const accessToken = parsed.searchParams.get("access_token") || parsed.searchParams.get("token");
        const idToken = parsed.searchParams.get("id_token");
        const refreshToken = parsed.searchParams.get("refresh_token");
        const scope = parsed.searchParams.get("scope") || "";
        const expiresIn = parsed.searchParams.get("expires_in");
        const uid = parsed.searchParams.get("uid");
        const email = parsed.searchParams.get("email");
        const name = parsed.searchParams.get("name");
        const photo = parsed.searchParams.get("photo");
        const configParam = parsed.searchParams.get("firebase_config");
        let parsedFirebaseConfig: any = firebaseConfigStorage.load();

        if (status === "success" && uid && email) {
          if (configParam) {
            try {
              const config = JSON.parse(atob(configParam));
              firebaseConfigStorage.save(config);
              store.setCustomFirebaseConfig(config);
              firebaseService.reinitialize();
              parsedFirebaseConfig = config;
            } catch (e) {
              console.error("Failed to parse returned firebase config:", e);
            }
          }

          if (token) {
            const credential = GoogleAuthProvider.credential(token);

            try {
              if (isFirebaseIdToken(token)) {
                console.log('[Auth] Received Firebase ID token from deep link; skipping Google credential sign-in.');
              } else {
                await firebaseService.signInWithCredential(credential);
                // Mirror the Google session into the main process so cloud
                // sync / P2P share the same account uid.
                window.electronAPI?.signInFirebaseMain?.({ provider: 'google', idToken: token })?.catch?.(() => {});
                console.log("Firebase signed in successfully via deep link");
              }
            } catch (e) {
              console.error("Firebase sign-in failed:", e);
            }
          }

          store.setUser({
            uid,
            email,
            displayName: name || email.split('@')[0],
            photoURL: photo || "",
          });
          window.electronAPI.saveAuthSession({
            token: token || null,
            accessToken: accessToken || null,
            idToken: idToken || null,
            refreshToken: refreshToken || null,
            scope,
            scopes: scope ? scope.split(/\s+/).filter(Boolean) : [],
            expiresIn: expiresIn ? Number(expiresIn) : null,
            provider: token ? (isFirebaseIdToken(token) ? 'firebase-id-token' : 'google-id-token') : 'profile-only',
            user: {
              uid,
              email,
              displayName: name || email.split('@')[0],
              photoURL: photo || "",
            },
            firebaseConfig: parsedFirebaseConfig,
            savedAt: Date.now(),
          });

          if (email.endsWith("@ponsrischool.in")) store.setAdmin(true);

          store.setHasSeenWelcomePage(true);
          store.setActiveView('browser');
          store.startActiveSession();
        }
      } catch (e) {
        console.error("Error processing auth callback:", e);
      }
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [store, isFirebaseIdToken, isJwtExpired]);

  useEffect(() => {
    if (!store.clientId) {
      store.fetchAppConfig();
    }
  }, [store.user, store.hasSeenWelcomePage, store.clientId]);

  useEffect(() => {
    return () => {
      if (compactHideTimerRef.current) clearTimeout(compactHideTimerRef.current);
    };
  }, []);

  // macOS native UI bridge - must be before early return to keep hook count consistent
  useEffect(() => {
    if (!window.electronAPI?.updateNativeMacUIState) return;
    window.electronAPI.updateNativeMacUIState({
      downloads,
      clipboardItems: store.clipboard,
    });
  }, [downloads, store.clipboard]);

  // ── Early return for standalone popup windows (unchanged) ──
  if (isPopupWindow) {
    const params = new URLSearchParams(window.location.search);
    const panel = params.get('panel');

    return (
      <div className="h-screen w-full bg-black flex flex-col overflow-hidden">
        {panel === 'clipboard' && <ClipboardManager />}
        {panel === 'cart' && <UnifiedCartPanel onClose={() => window.close()} onScan={handleCartScan} />}
        {(panel === 'search' || panel === 'apps') && <SpotlightSearchOverlay show={true} onClose={() => window.close()} />}
        {panel === 'context-menu' && (
          <div className="w-full h-full bg-[#0a0a0f]/95 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl overflow-hidden py-1.5 flex flex-col">
            <button onClick={() => { window.electronAPI?.reload(); window.close(); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left">
              <RotateCw size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Reload</span>
            </button>
            <button onClick={() => { window.electronAPI?.goBack(); window.close(); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left">
              <ChevronLeft size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Back</span>
            </button>
            <button onClick={() => { window.electronAPI?.goForward(); window.close(); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left">
              <ChevronRight size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Forward</span>
            </button>
            <div className="h-[1px] bg-white/5 my-1" />
            <button onClick={() => { window.electronAPI?.openTranslatePopup(); window.close(); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left">
              <Languages size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Translate</span>
            </button>
            <button onClick={async () => { try { await window.electronAPI?.invoke('popup-action', { action: 'save-page' }); } catch {} window.close(); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left">
              <DownloadIcon size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Save Page</span>
            </button>
            <div className="h-[1px] bg-white/5 my-1" />
            <button onClick={() => { window.electronAPI?.toggleFullscreen(); window.close(); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left">
              <Maximize2 size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Fullscreen</span>
            </button>
            <button onClick={() => { window.electronAPI?.openDevTools(); window.close(); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left">
              <Code2 size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Inspect</span>
            </button>
            <button onClick={async () => { try { await window.electronAPI?.invoke('popup-action', { action: 'create-shortcut' }); } catch {} window.close(); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left">
              <Plus size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Create Shortcut</span>
            </button>
            <button onClick={async () => { try { await window.electronAPI?.invoke('popup-action', { action: 'cycle-theme' }); } catch {} window.close(); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left">
              <Palette size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Switch Theme</span>
            </button>
            <button onClick={async () => { try { await window.electronAPI?.invoke('popup-action', { action: 'search-with-ai' }); } catch {} window.close(); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left">
              <Sparkles size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Search with AI</span>
            </button>
            <button onClick={async () => { try { await window.electronAPI?.invoke('popup-action', { action: 'open-setting', section: 'profile' }); } catch {} window.close(); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left">
              <GhostSettings size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Settings</span>
            </button>
          </div>
        )}
        {panel === 'tools-menu' && (
          <div className="w-full h-full bg-[#0a0a0f]/95 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl overflow-hidden py-1.5 flex flex-col">
            <div className="px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-white/30">Main</div>
            {[
              { action: 'tool-select', view: 'browser', icon: <Globe size={14} />, label: 'Browser' },
              { action: 'tool-select', view: 'passwords', icon: <Lock size={14} />, label: 'Passwords' },
              { action: 'tool-select', view: 'firewall', icon: <Shield size={14} />, label: 'Nexus Shield' },
              { action: 'tool-select', view: 'p2psync', icon: <Share2 size={14} />, label: 'P2P Sync' },
            ].map((item) => (
              <button key={item.view} onClick={async () => { try { await window.electronAPI?.invoke('popup-action', { action: item.action, view: item.view }); } catch {} window.close(); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left">
                {item.icon}
                <span className="text-[10px] font-black uppercase tracking-widest">{item.label}</span>
              </button>
            ))}
            <div className="h-[1px] bg-white/5 my-1.5 mx-3" />
            <div className="px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-white/30">Extras</div>
            {[
              { action: 'tool-select', view: 'workspace', icon: <Briefcase size={14} />, label: 'Workspace' },
              { action: 'tool-select', view: 'webstore', icon: <ShoppingBag size={14} />, label: 'Web Store' },
              { action: 'tool-select', view: 'pdf', icon: <FileText size={14} />, label: 'PDF Tools' },
              { action: 'tool-select', view: 'coding', icon: <Code2 size={14} />, label: 'Coding' },
              { action: 'tool-select', view: 'media', icon: <ImageIcon size={14} />, label: 'Media Studio' },
              { action: 'tool-select', view: 'presenton', icon: <Presentation size={14} />, label: 'Presenton' },
            ].map((item) => (
              <button key={item.view} onClick={async () => { try { await window.electronAPI?.invoke('popup-action', { action: item.action, view: item.view }); } catch {} window.close(); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left">
                {item.icon}
                <span className="text-[10px] font-black uppercase tracking-widest">{item.label}</span>
              </button>
            ))}
          </div>
        )}
        {panel === 'translate' && (
          <div className="flex-1 p-6 flex flex-col items-center justify-center relative drag-region">
            <button onClick={() => window.close()} className="absolute top-4 right-4 p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-full transition-all no-drag-region">
              <X size={16} />
            </button>
            <h3 className="text-sm font-black uppercase tracking-widest text-white mb-6">Neural Translation</h3>
            <div className="grid grid-cols-2 gap-3 w-full max-w-sm overflow-y-auto max-h-[400px] custom-scrollbar no-drag-region">
              {store.availableLanguages.map(langCode => (
                <button
                  key={langCode}
                  onClick={async () => {
                    if (window.electronAPI) {
                      await window.electronAPI.translateWebsite({ targetLanguage: langCode });
                      window.close();
                    }
                  }}
                  className="p-4 bg-white/5 hover:bg-accent/10 border border-white/5 rounded-xl transition-all"
                >
                  <span className="text-sm font-bold text-white tracking-widest uppercase">{langCode}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {(panel === 'settings' || panel === 'profile' || panel === 'extensions' || panel === 'downloads') && (
          <SettingsPanel onClose={() => window.close()} defaultSection={settingsSection} />
        )}
        {panel === 'mcp-approval' && <McpApprovalPopup />}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  const useNativeSidebarShell = isMacOS && store.macNativeSidebarMode === 'swiftui';
  const useNativeActionChainShell = isMacOS && store.macNativeActionChainMode === 'swiftui';
  const keepNativeBridgeMounted = useNativeSidebarShell || useNativeActionChainShell;
  const showEmbeddedSidebar = store.sidebarOpen && !useNativeSidebarShell;
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);

  const renderToolbarAction = (id: ToolbarActionId) => {
    if (!isToolbarActionVisible(id)) return null;

    const baseClass = 'p-1.5 rounded-lg transition-all hover:bg-white/5 cursor-grab active:cursor-grabbing';
    const dragProps = {
      draggable: true,
      onDragStart: () => setDraggedToolbarAction(id),
      onDragOver: (event: React.DragEvent) => event.preventDefault(),
      onDrop: () => reorderToolbarAction(id),
      onDragEnd: () => setDraggedToolbarAction(null),
    };

    switch (id) {
      case 'downloads':
        return (
          <button
            key={id}
            {...dragProps}
            onClick={() => {
              if (isMacOS && useAppStore.getState().macNativeUtilityPanelMode === 'swiftui') {
                window.electronAPI?.hideAllViews();
                window.electronAPI?.showMacNativePanel?.('downloads');
              } else {
                setShowDownloads(!showDownloads);
              }
            }}
            className={`${baseClass} ${isDownloading ? 'text-accent animate-pulse' : ''} ${downloadStatus === 'completed' ? 'text-green-400' : ''} ${downloadStatus === 'failed' ? 'text-red-400' : ''} ${downloadStatus === 'idle' ? 'text-secondary-text hover:text-sky-400' : ''} ${showDownloads ? 'bg-sky-500/10 text-sky-400' : ''}`}
            title="Downloads"
          >
            <DownloadCloud size={14} />
          </button>
        );
      case 'clipboard':
        return (
          <button
            key={id}
            {...dragProps}
            onClick={() => {
              if (isMacOS && useAppStore.getState().macNativeUtilityPanelMode === 'swiftui') {
                window.electronAPI?.hideAllViews();
                window.electronAPI?.showMacNativePanel?.('clipboard');
              } else {
                setShowClipboard(!showClipboard);
              }
            }}
            className={`${baseClass} ${showClipboard ? 'text-accent bg-sky-500/10' : 'text-secondary-text hover:text-sky-400'}`}
            title="Clipboard"
          >
            <CopyIcon size={14} />
          </button>
        );
      case 'cart':
        return (
          <button
            key={id}
            {...dragProps}
            onClick={() => setShowCart(!showCart)}
            className={`${baseClass} ${showCart ? 'text-accent bg-sky-500/10' : 'text-secondary-text hover:text-sky-400'}`}
            title="Unified Cart"
          >
            <ShoppingCart size={14} />
          </button>
        );
      case 'translate':
        return (
          <button
            key={id}
            {...dragProps}
            onClick={() => setShowTranslateDialog(true)}
            className={`${baseClass} ${showTranslateDialog ? 'text-accent bg-sky-500/10' : 'text-secondary-text hover:text-sky-400'}`}
            title="Translate Page"
          >
            <Languages size={14} />
          </button>
        );
      case 'extensions':
        return (
          <button
            key={id}
            {...dragProps}
            onClick={() => setShowExtensionsPopup(!showExtensionsPopup)}
            className={`${baseClass} ${showExtensionsPopup ? 'text-accent bg-sky-500/10' : 'text-secondary-text hover:text-sky-400'}`}
            title="Extensions"
          >
            <Puzzle size={14} />
          </button>
        );
      case 'quick-search':
        return (
          <button
            key={id}
            {...dragProps}
            onClick={handlePopSearch}
            className={`${baseClass} text-secondary-text/70 hover:text-sky-400`}
            title="Quick Search"
          >
            <Search size={12} />
          </button>
        );
      default:
        return null;
    }
  };

  const renderSideTabs = () => {
    if (!hasSideTabs || store.activeView !== 'browser') return null;

    return (
      <aside
        className={`h-full w-[220px] flex-shrink-0 border-border-color/70 minimal-browser-chrome no-drag-region ${sideTabsOnRight ? 'border-l order-last' : 'border-r order-first'}`}
      >
        <div className="h-10 px-3 flex items-center justify-between border-b border-border-color/60">
          <span className="text-[10px] font-black uppercase tracking-[0.22em] text-secondary-text">Tabs</span>
          <button onClick={() => store.addTab()} className="p-1.5 rounded-lg hover:bg-accent/10 text-secondary-text hover:text-accent transition-all" title="New Tab">
            <Plus size={14} />
          </button>
        </div>
        <Reorder.Group
          as="div"
          axis="y"
          values={store.tabs}
          onReorder={(nextTabs) => store.setTabs(nextTabs as any)}
          className="h-[calc(100%-2.5rem)] overflow-y-auto p-2 space-y-1 custom-scrollbar"
        >
          {store.tabs.map((tab) => {
            const active = tab.id === store.activeTabId;
            return (
              <Reorder.Item key={tab.id} value={tab} className="list-none">
                <button
                  onClick={() => store.setActiveTab(tab.id)}
                  className={`group w-full min-h-10 px-2.5 py-2 rounded-lg border flex items-center gap-2 text-left transition-all ${active ? 'minimal-tab-active text-primary-text' : 'border-transparent text-secondary-text hover:bg-white/[0.04] hover:text-primary-text'}`}
                  title={tab.title || tab.url}
                >
                  {tab.url?.startsWith('http') ? (
                    <img
                      src={`https://www.google.com/s2/favicons?sz=64&domain=${(() => {
                        try { return new URL(tab.url).hostname; } catch { return 'google.com'; }
                      })()}`}
                      className="w-4 h-4 flex-shrink-0"
                      alt=""
                    />
                  ) : (
                    <Globe size={14} className="flex-shrink-0" />
                  )}
                  <span className="flex-1 truncate text-[11px] font-semibold">{tab.title || 'New Tab'}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      store.removeTab(tab.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        store.removeTab(tab.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-white/10"
                    title="Close Tab"
                  >
                    <X size={12} />
                  </span>
                </button>
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
      </aside>
    );
  };

  return (
      <div
        className={`flex flex-col h-screen w-full bg-deep-space overflow-hidden relative font-sans text-primary-text${store.theme === 'minimal' && store.minimalCompactMode && !compactRevealed ? ' minimal-compact-active' : ''}${store.theme === 'minimal' && store.minimalAnimations ? ' minimal-animations-enabled' : ''}${store.theme === 'minimal' && !store.minimalAnimations ? ' minimal-animations-disabled' : ''}`}
        onMouseMove={(e) => {
          if (store.theme === 'minimal' && store.minimalCompactMode) {
            if (e.clientY < 100) {
              revealCompact();
            } else if (compactRevealed && e.clientY > 200) {
              scheduleHideCompact();
            }
          }
        }}
      >
      {store.theme === 'minimal' && store.minimalCompactMode && !compactRevealed && (
        <div
          className="fixed top-0 left-0 right-0 h-2 z-[9999] cursor-default"
          onMouseEnter={revealCompact}
        />
      )}
      <TitleBar
        onToggleSpotlightSearch={() => setShowSpotlightSearch(prev => !prev)}
        onOpenSettings={() => openSettingsPanel()}
      />

      <AnimatePresence mode="wait">
        {isInitializing && <InitializingOverlay key="init" />}
      </AnimatePresence>

      {!isInitializing && onboardingLoaded && !store.hasSeenWelcomePage && (
        <WelcomeScreen key="welcome" />
      )}

      {!isInitializing && onboardingLoaded && store.hasSeenWelcomePage && !store.hasCompletedStartupSetup && (
        <StartupSetupUI key="setup" onComplete={() => store.setHasCompletedStartupSetup(true)} />
      )}

      <div
        className={`flex flex-1 overflow-hidden relative pt-10`}
        style={{ background: 'var(--primary-bg)' }}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >


        <AnimatePresence>
          {(showEmbeddedSidebar || keepNativeBridgeMounted) && store.sidebarOpen && (
            <motion.div
              drag={isResizing ? false : "x"}
              dragConstraints={{ left: 0, right: 0 }}
              onDragStart={() => {
                window.dispatchEvent(new CustomEvent('aartiq-play-click-sound', { detail: { variant: 'drag' } }));
              }}
              onDragEnd={(e, info) => {
                const switched = (info.offset.x > 100 && store.sidebarSide === 'left') ||
                                 (info.offset.x < -100 && store.sidebarSide === 'right');
                if (switched) {
                  window.dispatchEvent(new CustomEvent('aartiq-play-click-sound', { detail: { variant: 'navigate' } }));
                }
                if (info.offset.x > 100 && store.sidebarSide === 'left') {
                  store.setSidebarSide('right');
                  if (window.electronAPI) window.dispatchEvent(new Event('resize'));
                }
                if (info.offset.x < -100 && store.sidebarSide === 'right') {
                  store.setSidebarSide('left');
                  if (window.electronAPI) window.dispatchEvent(new Event('resize'));
                }
              }}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: showEmbeddedSidebar ? (store.isSidebarCollapsed ? 70 : store.sidebarWidth) : 0, opacity: showEmbeddedSidebar ? 1 : 0 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: isResizing ? 0 : 0.3, ease: 'easeOut' }}
              className={`relative h-full cursor-grab active:cursor-grabbing ${store.sidebarSide === 'left' ? (showEmbeddedSidebar ? 'order-first border-r border-border-color' : 'order-first') : (showEmbeddedSidebar ? 'order-last border-l border-border-color' : 'order-last')} no-drag-region outline-none ring-0`}
              style={{
                background: `linear-gradient(180deg, color-mix(in srgb, var(--navbar-bg) ${store.themeOpacity - 3}%, transparent), color-mix(in srgb, var(--primary-bg) ${Math.max(0, store.themeOpacity - 7)}%, transparent), color-mix(in srgb, var(--primary-bg) ${Math.max(0, store.themeOpacity - 2)}%, transparent))`,
                backdropFilter: `blur(${store.themeBlur}px)`,
                overflow: showEmbeddedSidebar ? 'visible' : 'hidden',
                pointerEvents: showEmbeddedSidebar ? 'auto' : 'none',
              }}
              onUpdate={() => {
                if (window.electronAPI) window.dispatchEvent(new Event('resize'));
              }}
            >
              {showEmbeddedSidebar && !store.isSidebarCollapsed && (
                <div
                  className={`group absolute top-0 bottom-0 z-50 flex w-3 cursor-col-resize items-center justify-center hover:bg-deep-space-accent-neon/20 transition-colors ${store.sidebarSide === 'left' ? 'right-0' : 'left-0'}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setIsResizing(true);
                    isResizingRef.current = true;
                    const startX = e.clientX;
                    const startWidth = store.sidebarWidth;

                    const onMouseMove = (moveEvent: MouseEvent) => {
                      const delta = store.sidebarSide === 'left'
                        ? moveEvent.clientX - startX
                        : startX - moveEvent.clientX;
                      const newWidth = Math.max(280, Math.min(640, startWidth + delta));
                      store.setSidebarWidth(newWidth);
                      window.dispatchEvent(new CustomEvent('aartiq:sidebar-resize', { detail: { width: newWidth } }));
                      if (window.electronAPI) window.dispatchEvent(new Event('resize'));
                    };

                    const onMouseUp = () => {
                      setIsResizing(false);
                      isResizingRef.current = false;
                      document.removeEventListener('mousemove', onMouseMove);
                      document.removeEventListener('mouseup', onMouseUp);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                  }}
                >
                  <span className="h-10 w-0.5 rounded-full bg-deep-space-accent-neon/40 group-hover:bg-deep-space-accent-neon/80 transition-colors" />
                </div>
              )}
              <AIChatSidebar
                studentMode={store.studentMode}
                toggleStudentMode={() => store.setStudentMode(!store.studentMode)}
                isCollapsed={store.isSidebarCollapsed}
                toggleCollapse={() => {
                  store.toggleSidebarCollapse();
                  setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                }}
                selectedEngine={store.selectedEngine}
                setSelectedEngine={store.setSelectedEngine}
                theme={store.theme}
                setTheme={store.setTheme}
                backgroundImage=""
                setBackgroundImage={() => { }}
                backend={store.backendStrategy}
                setBackend={store.setBackendStrategy}
                mysqlConfig={store.customMysqlConfig}
                setMysqlConfig={store.setCustomMysqlConfig}
                side={store.sidebarSide}
                setShowSettings={setShowSettings}
                setSettingsSection={setSettingsSection}
                setBrowserDisabled={setIsBrowserDisabled}
                showSchedulingModal={showSchedulingModal}
                setShowSchedulingModal={setShowSchedulingModal}
                schedulingIntent={schedulingIntent}
                setSchedulingIntent={setSchedulingIntent}
                bridgeOnly={!showEmbeddedSidebar}
                isResizing={isResizing}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <main className="flex-1 flex flex-col relative overflow-hidden min-w-0" style={{ background: 'color-mix(in srgb, var(--primary-bg) 92%, var(--card-bg))' }}>
          {store.activeView === 'browser' && (
            <header
              className="h-[56px] flex-shrink-0 flex items-center px-6 gap-6 border-b backdrop-blur-3xl z-40 no-drag-region transition-all duration-500 outline-none ring-0"
              style={{
                background: `color-mix(in srgb, var(--navbar-bg) ${store.themeOpacity}%, transparent)`,
                borderColor: 'var(--border-color)',
                backdropFilter: `blur(${store.themeBlur}px)`,
              }}
            >
              <div className="flex items-center gap-1">

                <button onClick={async () => {
                  if (window.electronAPI) {
                    const selectedText = await window.electronAPI.getSelectedText();
                    if (selectedText) {
                      window.electronAPI.sendToAIChatInput(selectedText);
                    }
                  }
                  if (isMacOS && useAppStore.getState().macNativeSidebarMode === 'swiftui') {
                    useAppStore.setState({ activeView: 'browser', sidebarOpen: false });
                    window.electronAPI?.toggleMacNativePanel?.('sidebar');
                  } else {
                    store.toggleSidebar();
                  }
                }} className="p-2 rounded-xl hover:bg-primary-bg/10 text-secondary-text hover:text-primary-text transition-all" title="AI Analyst">
                  <Sparkles size={18} />
                </button>
                <div className="w-[1px] h-4 bg-border-color mx-1" />
                <button onClick={() => window.electronAPI?.goBack()} className="p-2 rounded-xl hover:bg-primary-bg/10 text-secondary-text hover:text-primary-text transition-all" title="Go Back"><ChevronLeft size={18} /></button>
                <button onClick={() => window.electronAPI?.goForward()} className="p-2 rounded-xl hover:bg-primary-bg/10 text-secondary-text hover:text-primary-text transition-all" title="Go Forward"><ChevronRight size={18} /></button>
                <button onClick={() => window.electronAPI?.reload()} className="p-2 rounded-xl hover:bg-primary-bg/10 text-secondary-text hover:text-primary-text transition-all" title="Reload Page"><RotateCw size={18} /></button>
              </div>

              {/* ── URL BAR (unchanged) ── */}
              <div className="flex-1 flex justify-center">
                <div className="w-full max-w-2xl relative group">
                  <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                    <Search size={14} className="text-secondary-text group-focus-within:text-primary-text transition-colors" />
                  </div>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => { setInputValue(e.target.value); setIsTyping(true); }}
                    onFocus={() => setIsTyping(true)}
                    onBlur={() => setIsTyping(false)}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.shiftKey) {
                        e.preventDefault();
                        const input = e.target as HTMLInputElement;
                        const start = input.selectionStart || inputValue.length;
                        const newValue = inputValue.slice(0, start) + '\n' + inputValue.slice(start);
                        setInputValue(newValue);
                        setTimeout(() => { input.setSelectionRange(start + 1, start + 1); }, 0);
                        return;
                      }
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleGo(inputValue, { newTab: true, active: true });
                        return;
                      }
                      if (e.key === 'Enter' && e.altKey) {
                        e.preventDefault();
                        handleGo(inputValue, { newTab: true, active: false });
                        return;
                      }
                      if (e.key === 'Enter') handleGo(inputValue);
                      if (e.key === 'Tab' && urlPrediction && isTyping) {
                        e.preventDefault();
                        setInputValue(urlPrediction);
                        setUrlPrediction(null);
                        handleGo(urlPrediction);
                      }
                    }}
                    placeholder={`Search with ${store.selectedEngine} or enter URL...`}
                    className="w-full bg-white/[0.03] border border-border-color/30 rounded-2xl py-2.5 pl-12 pr-[230px] text-[13px] text-primary-text placeholder:text-secondary-text focus:outline-none focus:ring-1 focus:ring-accent/30 focus:bg-white/[0.07] transition-all font-medium backdrop-blur-md relative z-10"
                  />
                  {urlPrediction && isTyping && (
                    <div className="absolute inset-y-0 left-11 right-4 flex items-center pointer-events-none text-xs text-white/20 font-medium z-0">
                      <span>{inputValue}</span>
                      <span className="opacity-100">{urlPrediction.substring(inputValue.length)}</span>
                    </div>
                  )}
                  {store.tabs.find(t => t.id === store.activeTabId)?.isLoading && (
                    <div className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden pointer-events-none rounded-t-2xl">
                      <motion.div
                        initial={{ x: '-100%' }}
                        animate={{ x: '100%' }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                        className="w-1/2 h-full gradient-progressbar"
                      />
                    </div>
                  )}
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 no-drag-region z-20 flex items-center gap-1.5">
                    {toolbarOrder.filter((id) => store.theme !== 'minimal' || id === 'downloads' || id === 'quick-search').map((id) => renderToolbarAction(id))}
                    <ExtensionActionBar />
                  </div>
                  {isTyping && suggestions.length > 0 && (
                    <div
                      className="absolute left-0 right-0 top-full mt-1 bg-primary-bg/95 backdrop-blur-md border border-border-color rounded-xl shadow-lg z-50 overflow-hidden"
                      style={{ width: inputRef.current ? inputRef.current.offsetWidth : 'auto' }}
                    >
                      {suggestions.map((s, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-3 px-4 py-2 hover:bg-accent/10 cursor-pointer text-sm"
                          onClick={() => { handleSuggestionClick(s); }}
                        >
                          {s.type === 'search' && <Search size={14} className="text-secondary-text" />}
                          {s.type === 'history' && <RefreshCcw size={14} className="text-secondary-text" />}
                          {s.type === 'bookmark' && <Bookmark size={14} className="text-secondary-text" />}
                          {s.type === 'app' && s.icon}
                          <span className="flex-1 text-primary-text truncate">{displayText(s.text, 'Suggestion')}</span>
                          <span className="text-secondary-text text-xs">{displayText(s.url)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ── BOOKMARK BUTTON ── */}
              {store.showBookmarkIcon && (
                <button
                  onClick={handleBookmark}
                  className={`p-2 rounded-xl transition-all ${isBookmarked ? 'text-yellow-400 hover:text-yellow-300' : 'text-secondary-text hover:text-yellow-400'}`}
                  title={isBookmarked ? 'Remove Bookmark' : 'Bookmark Page'}
                >
                  <Bookmark size={16} fill={isBookmarked ? 'currentColor' : 'none'} />
                </button>
              )}

              {/* ── RIGHT HEADER ACTIONS ── */}
              <div className="flex items-center gap-1">
                <button onClick={() => { openSettingsPanel('history'); }} className="p-1.5 rounded-lg text-secondary-text hover:text-primary-text transition-all" title="History">
                  <RefreshCcw size={14} />
                </button>
                <button onClick={handleReadAloud} className={`p-1.5 rounded-lg transition-all ${isReadingAloud ? 'text-accent animate-pulse' : 'text-secondary-text hover:text-primary-text'}`} title="Read Aloud">
                  {isReadingAloud ? <Square size={14} /> : <Volume2 size={14} />}
                </button>

                <div className="relative">
                  <button
                    onClick={() => setShowChromeCustomizer((value) => !value)}
                    onDoubleClick={cycleTheme}
                    className={`p-1.5 rounded-lg transition-all ${showChromeCustomizer ? 'bg-accent/10 text-accent' : 'text-secondary-text hover:text-primary-text'}`}
                    title={`Theme: ${store.theme} - double-click to switch`}
                  >
                    <ThemeIcon theme={store.theme as AppTheme} />
                  </button>
                  <AnimatePresence>
                    {showChromeCustomizer && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        className="absolute right-0 top-full mt-3 w-[330px] rounded-2xl border shadow-2xl p-4 z-[200] minimal-browser-chrome backdrop-blur-3xl"
                        style={{ boxShadow: '0 20px 70px var(--shadow-color)' }}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-primary-text">Clean Theme</p>
                            <p className="text-[10px] text-secondary-text mt-1">Minimal chrome, tabs, and icon order</p>
                          </div>
                          <button onClick={() => setShowChromeCustomizer(false)} className="p-1.5 rounded-lg text-secondary-text hover:text-primary-text hover:bg-white/5">
                            <X size={14} />
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {(['minimal', 'light', 'dark', 'vibrant', 'custom', 'system'] as AppTheme[]).map((themeId) => (
                            <button
                              key={themeId}
                              onClick={() => store.setTheme(themeId)}
                              className={`px-3 py-2 rounded-lg border text-[10px] font-black uppercase tracking-wider transition-all ${store.theme === themeId ? 'border-accent/50 bg-accent/12 text-primary-text' : 'border-border-color/70 text-secondary-text hover:text-primary-text hover:bg-white/[0.04]'}`}
                            >
                              {themeId}
                            </button>
                          ))}
                        </div>

                        <div className="mb-4">
                          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-secondary-text mb-2">Tab placement</p>
                          <div className="grid grid-cols-4 gap-2">
                            {TAB_LAYOUTS.map((layout) => (
                              <button
                                key={layout.id}
                                onClick={() => {
                                  store.setBrowserTabLayout(layout.id);
                                  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
                                }}
                                className={`px-2 py-2 rounded-lg border text-[10px] font-bold transition-all ${store.browserTabLayout === layout.id ? 'border-accent/50 bg-accent/12 text-primary-text' : 'border-border-color/70 text-secondary-text hover:text-primary-text hover:bg-white/[0.04]'}`}
                              >
                                {layout.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="mb-4">
                          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-secondary-text mb-2">Color accents</p>
                          <div className="grid grid-cols-6 gap-2">
                            {BROWSER_ACCENT_PRESETS.map((preset) => (
                              <button
                                key={preset.id}
                                onClick={() => store.setBrowserAccentPreset(preset.id)}
                                className={`h-9 rounded-lg border transition-all ${store.browserAccentPreset === preset.id ? 'border-primary-text scale-105' : 'border-border-color/70 hover:border-primary-text/50'}`}
                                style={{ background: `linear-gradient(135deg, ${preset.primary}, ${preset.secondary})` }}
                                title={preset.label}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="mb-4">
                          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-secondary-text mb-2">Compact mode</p>
                          <button
                            onClick={() => {
                              store.setMinimalCompactMode(!store.minimalCompactMode);
                              requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
                            }}
                            className={`w-full px-3 py-2 rounded-lg border text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-between ${store.minimalCompactMode ? 'border-accent/50 bg-accent/12 text-primary-text' : 'border-border-color/70 text-secondary-text hover:text-primary-text hover:bg-white/[0.04]'}`}
                          >
                            <span>{store.minimalCompactMode ? '⏺ Auto-hide' : '⊟ Auto-hide UI'}</span>
                            <span className={`w-2 h-2 rounded-full ${store.minimalCompactMode ? 'bg-accent' : 'bg-secondary-text/30'}`} />
                          </button>
                          <p className="text-[7px] text-secondary-text/50 mt-1">Hide chrome on idle, reveal on hover — like Minimal Browser</p>
                        </div>

                        <div className="mb-4">
                          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-secondary-text mb-2">Animations</p>
                          <button
                            onClick={() => store.setMinimalAnimations(!store.minimalAnimations)}
                            className={`w-full px-3 py-2 rounded-lg border text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-between ${store.minimalAnimations ? 'border-accent/50 bg-accent/12 text-primary-text' : 'border-border-color/70 text-secondary-text hover:text-primary-text hover:bg-white/[0.04]'}`}
                          >
                            <span>{store.minimalAnimations ? '✦ Smooth animations' : '⊟ Reduced motion'}</span>
                            <span className={`w-2 h-2 rounded-full ${store.minimalAnimations ? 'bg-accent' : 'bg-secondary-text/30'}`} />
                          </button>
                          <p className="text-[7px] text-secondary-text/50 mt-1">Fluid transitions for tabs, chrome reveal, and UI interactions</p>
                        </div>

                        <div>
                          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-secondary-text mb-2">Toolbar icons</p>
                          <div className="space-y-1.5">
                            {toolbarOrder.filter((id) => id !== 'quick-search').map((id) => (
                              <button
                                key={id}
                                draggable
                                onDragStart={() => setDraggedToolbarAction(id)}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => reorderToolbarAction(id)}
                                onDragEnd={() => setDraggedToolbarAction(null)}
                                onClick={() => setToolbarActionVisible(id, !isToolbarActionVisible(id))}
                                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border-color/70 text-secondary-text hover:text-primary-text hover:bg-white/[0.04] transition-all cursor-grab active:cursor-grabbing"
                              >
                                <span className="text-[10px] font-bold uppercase tracking-wider">{id.replace('-', ' ')}</span>
                                <span className={`w-2 h-2 rounded-full ${isToolbarActionVisible(id) ? 'bg-accent' : 'bg-secondary-text/30'}`} />
                              </button>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="w-[1px] h-6 bg-border-color mx-1" />

                <button onClick={toggleFullscreen} className="p-2 rounded-xl hover:bg-primary-bg/10 text-secondary-text hover:text-primary-text transition-all" title="Toggle Fullscreen">
                  {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>

                <button onClick={() => openSettingsPanel()} className="p-1 rounded-2xl hover:scale-110 transition-all outline-none border border-white/10 bg-white/5 overflow-hidden">
                  {(store.user?.photoURL || store.localPhotoURL) ? (
                    <img
                      src={store.user?.photoURL || store.localPhotoURL || ''}
                      alt="Profile"
                      className="w-6 h-6 rounded-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(store.user?.displayName || 'User')}&background=0D8ABC&color=fff`;
                      }}
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-primary-bg/5 border border-border-color flex items-center justify-center text-secondary-text">
                      <UserIcon size={14} />
                    </div>
                  )}
                </button>

                <div className="relative tools-menu-container">
                  <button onClick={() => setShowToolsMenu(!showToolsMenu)} className="p-2 rounded-xl hover:bg-primary-bg/10 text-secondary-text hover:text-primary-text transition-all" title="Tools">
                    <MoreVertical size={18} />
                  </button>
                  {showToolsMenu && (
                    <div className="absolute right-0 top-full mt-2 w-48 border rounded-2xl shadow-2xl z-[200] p-2 backdrop-blur-2xl bg-[#0a0a0f]/95 border-white/10" onClick={() => setShowToolsMenu(false)}>
                      <div className="px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-white/30">Main</div>
                      {[
                        { view: 'browser', icon: <Globe size={14} />, label: 'Browser' },
                        { view: 'passwords', icon: <Lock size={14} />, label: 'Passwords' },
                        { view: 'firewall', icon: <Shield size={14} />, label: 'Nexus Shield' },
                        { view: 'p2psync', icon: <Share2 size={14} />, label: 'P2P Sync' },
                      ].map((item) => (
                        <button key={item.view} onClick={() => { store.setActiveView(item.view as any); setActiveManager(null); if (item.view !== 'browser') window.electronAPI?.hideAllViews(); else window.electronAPI?.showAllViews(); setShowToolsMenu(false); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left rounded-xl">
                          {item.icon}
                          <span className="text-[10px] font-black uppercase tracking-widest">{item.label}</span>
                        </button>
                      ))}
                      <div className="h-[1px] bg-white/5 my-1.5 mx-3" />
                      <div className="px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-white/30">Extras</div>
                      {[
                        { view: 'workspace', icon: <Briefcase size={14} />, label: 'Workspace' },
                        { view: 'webstore', icon: <ShoppingBag size={14} />, label: 'Web Store' },
                        { view: 'pdf', icon: <FileText size={14} />, label: 'PDF Tools' },
                        { view: 'coding', icon: <Code2 size={14} />, label: 'Coding' },
                        { view: 'media', icon: <ImageIcon size={14} />, label: 'Media Studio' },
                        { view: 'presenton', icon: <Presentation size={14} />, label: 'Presenton' },
                      ].map((item) => (
                        <button key={item.view} onClick={() => { store.setActiveView(item.view as any); setActiveManager(null); if (item.view !== 'browser') window.electronAPI?.hideAllViews(); else window.electronAPI?.showAllViews(); setShowToolsMenu(false); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-sky-500/10 text-white/60 hover:text-sky-400 transition-all text-left rounded-xl">
                          {item.icon}
                          <span className="text-[10px] font-black uppercase tracking-widest">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </header>
          )}

          {/* ── VIEWS (all unchanged) ── */}
          <div className="flex-1 relative z-50">
            {/* View container remains for browser and landing page */}
            {store.activeView === 'landing-page' && (
              <div key="landing-page" className="absolute inset-0 z-50 bg-[var(--primary-bg)] overflow-auto custom-scrollbar">
                <LandingPage />
              </div>
            )}
            {store.activeView === 'browser' && (
              <div className={`h-full flex ${store.studentMode ? 'p-4 gap-4' : 'p-2'}`}>
                {renderSideTabs()}
                <div className={`flex-[3] relative bg-[var(--primary-bg)] ${store.studentMode ? 'rounded-3xl' : 'rounded-2xl'} overflow-hidden border border-[var(--border-color)]`} style={{ boxShadow: '0 8px 32px var(--shadow-color)' }}>
                  {!store.isOnline && (
                    <div className="absolute inset-0 z-[100] bg-[var(--primary-bg)]">
                      <NoNetworkGame />
                    </div>
                  )}
                  {isBrowserDisabled && (
                    <div className="absolute inset-0 z-[90] backdrop-blur-sm flex items-center justify-center transition-all duration-500" style={{ background: 'var(--overlay-bg)' }}>
                      <div className="text-center">
                        <Sparkles size={48} className="mx-auto mb-4 text-deep-space-accent-neon animate-pulse" />
                        <p className="text-white text-lg font-bold">Automation in Progress</p>
                        <p className="text-white/50 text-sm mt-2">Browser is paused while task is being configured</p>
                      </div>
                    </div>
                  )}
                  <div className="absolute top-0 left-0 right-0 h-1 bg-transparent pointer-events-none" />
                </div>
                {store.studentMode && (
                  <div className="flex-1 glass-vibrant shadow-3xl rounded-3xl p-6 flex flex-col border border-border-color bg-primary-bg/5">
                    <div className="flex items-center gap-3 mb-6">
                      <Sparkles size={20} className="text-accent" />
                      <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-secondary-text">Context Intelligence</h3>
                    </div>
                    <textarea
                      className="flex-1 bg-transparent text-primary-text text-sm leading-relaxed resize-none focus:outline-none placeholder:text-secondary-text custom-scrollbar font-medium"
                      placeholder="Insights reflect current tab content..."
                    />
                  </div>
                )}
              </div>
            )}
            {store.activeView === 'webstore' && (
              <div key="webstore" className="absolute inset-0 z-50 bg-[var(--primary-bg)] h-full w-full">
                <WebStore onClose={() => store.setActiveView('browser')} />
              </div>
            )}
            {store.activeView === 'workspace' && (
              <div key="workspace" className="absolute inset-0 z-50 bg-[var(--primary-bg)] h-full w-full">
                <button onClick={goBackToBrowser} className="absolute top-4 right-4 z-50 p-2 rounded-xl bg-[var(--glass-bg)] border hover:bg-[var(--accent)] hover:text-white text-[var(--text-secondary)] transition-all" title="Close (Esc)">
                  <X size={20} />
                </button>
                <WorkspaceDashboard />
              </div>
            )}
            {store.activeView === 'pdf' && (
              <div key="pdf" className="absolute inset-0 z-50 bg-[var(--primary-bg)] h-full w-full">
                <button onClick={goBackToBrowser} className="absolute top-4 right-4 z-50 p-2 rounded-xl bg-[var(--glass-bg)] border hover:bg-[var(--accent)] hover:text-white text-[var(--text-secondary)] transition-all" title="Close (Esc)">
                  <X size={20} />
                </button>
                <PDFWorkspace />
              </div>
            )}
            {store.activeView === 'coding' && (
              <div key="coding" className="absolute inset-0 z-50 bg-[var(--primary-bg)] h-full w-full">
                <button onClick={goBackToBrowser} className="absolute top-4 right-4 z-50 p-2 rounded-xl bg-[var(--glass-bg)] border hover:bg-[var(--accent)] hover:text-white text-[var(--text-secondary)] transition-all" title="Close (Esc)">
                  <X size={20} />
                </button>
                <CodingDashboard />
              </div>
            )}
            {store.activeView === 'media' && (
              <div key="media" className="absolute inset-0 z-50 bg-[var(--primary-bg)] h-full w-full">
                <button onClick={goBackToBrowser} className="absolute top-4 right-4 z-50 p-2 rounded-xl bg-[var(--glass-bg)] border hover:bg-[var(--accent)] hover:text-white text-[var(--text-secondary)] transition-all" title="Close (Esc)">
                  <X size={20} />
                </button>
                <MediaStudio />
              </div>
            )}
            {store.activeView === 'documentation' && (
              <div key="documentation" className="absolute inset-0 z-50 bg-[var(--primary-bg)] overflow-auto custom-scrollbar">
                <button onClick={goBackToBrowser} className="fixed top-4 right-4 z-50 p-2 rounded-xl bg-[var(--glass-bg)] border hover:bg-[var(--accent)] hover:text-white text-[var(--text-secondary)] transition-all" title="Close (Esc)">
                  <X size={20} />
                </button>
                <Documentation />
              </div>
            )}
            {store.activeView === 'presenton' && (
              <div key="presenton" className="absolute inset-0 z-50 bg-[var(--primary-bg)] h-full w-full">
                <button onClick={goBackToBrowser} className="absolute top-4 right-4 z-50 p-2 rounded-xl bg-[var(--glass-bg)] border hover:bg-[var(--accent)] hover:text-white text-[var(--text-secondary)] transition-all" title="Close (Esc)">
                  <X size={20} />
                </button>
                <PresentonStudio />
              </div>
            )}
            {store.activeView === 'passwords' && (
              <div key="passwords" className="absolute inset-0 z-50 bg-[var(--primary-bg)] h-full w-full overflow-auto custom-scrollbar pt-6">
                <button onClick={goBackToBrowser} className="absolute top-4 right-4 z-50 p-2 rounded-xl bg-[var(--glass-bg)] border hover:bg-[var(--accent)] hover:text-white text-[var(--text-secondary)] transition-all" title="Close (Esc)">
                  <X size={20} />
                </button>
                <PasswordManager />
              </div>
            )}
            {store.activeView === 'firewall' && (
              <div key="firewall" className="absolute inset-0 z-50 bg-[var(--primary-bg)] h-full w-full overflow-auto custom-scrollbar pt-6">
                <button onClick={goBackToBrowser} className="absolute top-4 right-4 z-50 p-2 rounded-xl bg-[var(--glass-bg)] border hover:bg-[var(--accent)] hover:text-white text-[var(--text-secondary)] transition-all" title="Close (Esc)">
                  <X size={20} />
                </button>
                <ProxyFirewallManager />
              </div>
            )}
            {store.activeView === 'p2psync' && (
              <div key="p2psync" className="absolute inset-0 z-50 bg-[var(--primary-bg)] h-full w-full overflow-auto custom-scrollbar pt-6">
                <button onClick={goBackToBrowser} className="absolute top-4 right-4 z-50 p-2 rounded-xl bg-[var(--glass-bg)] border hover:bg-[var(--accent)] hover:text-white text-[var(--text-secondary)] transition-all" title="Close (Esc)">
                  <X size={20} />
                </button>
                <P2PSyncManager />
              </div>
            )}

            {/* Feature Overlays (all unchanged) */}
            <AnimatePresence>
              {activeManager === 'password' && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="absolute inset-0 z-[100] backdrop-blur-sm flex items-center justify-center" style={{ background: 'var(--overlay-bg)' }}>
                  <div className="w-full max-w-4xl h-[80vh] rounded-2xl border shadow-2xl overflow-hidden relative" style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}>
                    <button onClick={() => setActiveManager(null)} className="absolute top-4 right-4 z-50 p-2 hover:bg-black/5 rounded-xl text-secondary-text hover:text-primary-text transition-all" title="Close"><X size={20} /></button>
                    <PasswordManager />
                  </div>
                </motion.div>
              )}

              {activeManager === 'firewall' && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="absolute inset-0 z-[100] backdrop-blur-sm flex items-center justify-center" style={{ background: 'var(--overlay-bg)' }}>
                  <div className="w-full max-w-4xl h-[80vh] rounded-2xl border shadow-2xl overflow-hidden relative" style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}>
                    <button onClick={() => setActiveManager(null)} className="absolute top-4 right-4 z-50 p-2 hover:bg-black/5 rounded-xl text-secondary-text hover:text-primary-text transition-all" title="Close"><X size={20} /></button>
                    <ProxyFirewallManager />
                  </div>
                </motion.div>
              )}

              {activeManager === 'p2p' && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="absolute inset-0 z-[100] backdrop-blur-sm flex items-center justify-center" style={{ background: 'var(--overlay-bg)' }}>
                  <div className="w-full max-w-4xl h-[80vh] rounded-2xl border shadow-2xl overflow-hidden relative" style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}>
                    <button onClick={() => setActiveManager(null)} className="absolute top-4 right-4 z-50 p-2 hover:bg-black/5 rounded-xl text-secondary-text hover:text-primary-text transition-all" title="Close"><X size={20} /></button>
                    <P2PSyncManager />
                  </div>
                </motion.div>
              )}

              {showCamera && (
                <div className="absolute inset-0 z-[200] bg-black/80 flex items-center justify-center">
                  <div className="relative w-[800px] h-[600px] bg-black rounded-3xl overflow-hidden border border-white/20">
                    <button onClick={() => setShowCamera(false)} className="absolute top-4 right-4 z-50 text-white" title="Close Camera"><X /></button>
                    <PhoneCamera onClose={() => setShowCamera(false)} />
                  </div>
                </div>
              )}

              {showTabSwitcher && (
                <TabSwitcherOverlay visible={showTabSwitcher} />
              )}
            </AnimatePresence>

            {/* Neural Context Overlay */}
            <AnimatePresence>
              {aiOverview && (
                <AIAssistOverlay
                  query={aiOverview.query}
                  result={aiOverview.result}
                  sources={aiOverview.sources}
                  isLoading={aiOverview.isLoading}
                  provider={aiOverview.provider}
                  model={aiOverview.model}
                  statusMessage={aiOverview.statusMessage}
                  durationMs={aiOverview.durationMs}
                  onRefresh={() => runAiOverview(aiOverview.query)}
                  availableOllamaModels={store.ollamaModelsList}
                  selectedOllamaModel={store.ollamaModel}
                  onOllamaModelSelect={(modelName) => store.setOllamaModel(modelName)}
                  onOllamaModelsUpdate={(models) => store.setOllamaModelsList(models)}
                  onClose={() => setAiOverview(null)}
                />
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* ── CONTEXT MENU (unchanged) ── */}
      <AnimatePresence>
        {showContextMenu && (
          <>
            <div className="fixed inset-0 z-[1000]" onClick={() => setShowContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setShowContextMenu(null); }} />
            <motion.div
              ref={contextMenuRef}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed z-[1001] w-56 rounded-xl border shadow-2xl overflow-hidden py-1.5 backdrop-blur-3xl"
              style={{
                left: showContextMenu.x,
                top: showContextMenu.y,
                background: 'var(--glass-bg)',
                borderColor: 'var(--glass-border)',
                boxShadow: '0 10px 40px var(--shadow-color)'
              }}
            >
              <button onClick={() => { window.electronAPI?.reload(); setShowContextMenu(null); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 text-secondary-text hover:text-primary-text transition-all">
                <RefreshCcw size={14} />
                <span className="text-xs font-bold uppercase tracking-widest">Reload</span>
              </button>
              <button onClick={() => { window.electronAPI?.goBack(); setShowContextMenu(null); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 text-secondary-text hover:text-primary-text transition-all">
                <ChevronLeft size={14} />
                <span className="text-xs font-bold uppercase tracking-widest">Back</span>
              </button>
              <button onClick={() => { window.electronAPI?.goForward(); setShowContextMenu(null); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 text-secondary-text hover:text-primary-text transition-all">
                <ChevronRight size={14} />
                <span className="text-xs font-bold uppercase tracking-widest">Forward</span>
              </button>
              <button onClick={() => { setShowTranslateDialog(true); setShowContextMenu(null); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 text-secondary-text hover:text-primary-text transition-all">
                <Languages size={14} />
                <span className="text-xs font-bold uppercase tracking-widest">Translate Website</span>
              </button>
              <div className="h-[1px] bg-border-color my-1" />
              <button onClick={() => { handleOfflineSave(); setShowContextMenu(null); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 text-secondary-text hover:text-primary-text transition-all">
                <DownloadIcon size={14} />
                <span className="text-xs font-bold uppercase tracking-widest">Save Page</span>
              </button>
              <button onClick={() => { toggleFullscreen(); setShowContextMenu(null); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 text-secondary-text hover:text-primary-text transition-all">
                <Maximize2 size={14} />
                <span className="text-xs font-bold uppercase tracking-widest">Fullscreen</span>
              </button>
              <button onClick={() => { window.electronAPI?.openDevTools(); setShowContextMenu(null); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 text-secondary-text hover:text-primary-text transition-all">
                <Code2 size={14} />
                <span className="text-xs font-bold uppercase tracking-widest">Inspect</span>
              </button>
              <button onClick={() => { handleCreateShortcut(); setShowContextMenu(null); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 text-secondary-text hover:text-primary-text transition-all">
                <Plus size={14} />
                <span className="text-xs font-bold uppercase tracking-widest">Create Shortcut</span>
              </button>
              <button onClick={() => { cycleTheme(); setShowContextMenu(null); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 text-secondary-text hover:text-primary-text transition-all">
                <Palette size={14} />
                <span className="text-xs font-bold uppercase tracking-widest">Switch Theme</span>
              </button>
              <button onClick={async () => {
                setShowContextMenu(null);
                if (window.electronAPI) {
                  const selectedText = await window.electronAPI.getSelectedText();
                  if (selectedText) {
                    runAiOverview(selectedText);
                  } else {
                    runAiOverview(store.currentUrl);
                  }
                }
              }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 text-secondary-text hover:text-primary-text transition-all">
                <Sparkles size={14} />
                <span className="text-xs font-bold uppercase tracking-widest">Search with AI</span>
              </button>
              <button onClick={() => { openSettingsPanel(); setShowContextMenu(null); }} className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 text-secondary-text hover:text-primary-text transition-all">
                <GhostSettings size={14} />
                <span className="text-xs font-bold uppercase tracking-widest">Settings</span>
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── TRANSLATE DIALOG (unchanged) ── */}
      <AnimatePresence>
        {showTranslateDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] backdrop-blur-md flex items-center justify-center p-4 transition-all duration-500"
            style={{ background: 'var(--overlay-bg)' }}
          >
            <div className="w-full max-w-sm max-h-[80vh] rounded-2xl border shadow-3xl overflow-hidden flex flex-col" style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}>
              <div className="flex-shrink-0 p-6 pb-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-primary-text mb-4 text-center">TRANSLATE SITE</h3>
                <div className="flex gap-2 mb-4">
                  <button onClick={() => setTranslateMethod('google')} className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold border transition-all ${translateMethod === 'google' ? 'bg-accent/10 border-accent/20 text-accent' : 'bg-[var(--primary-bg)]/5 border-border-color text-secondary-text hover:text-primary-text'}`}>
                    Google
                  </button>
                  <button onClick={() => setTranslateMethod('chrome-ai')} className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold border transition-all ${translateMethod === 'chrome-ai' ? 'bg-accent/10 border-accent/20 text-accent' : 'bg-[var(--primary-bg)]/5 border-border-color text-secondary-text hover:text-primary-text'}`}>
                    Chrome AI
                  </button>
                </div>
                <p className="text-[10px] text-secondary-text/30 text-center">
                  {translateMethod === 'google' ? 'Google: Fast, relies on Google servers' : 'Chrome AI: On-device, private, requires Chrome 144+'}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-4 custom-scrollbar">
                <div className="grid grid-cols-2 gap-2">
                  {store.availableLanguages.map((langCode) => {
                    const names: Record<string, string> = {
                      en: 'English', hi: 'Hindi', bn: 'Bengali', te: 'Telugu',
                      mr: 'Marathi', ta: 'Tamil', gu: 'Gujarati', ur: 'Urdu',
                      kn: 'Kannada', or: 'Odia', ml: 'Malayalam', pa: 'Punjabi',
                      as: 'Assamese', mai: 'Maithili', sat: 'Santali', ks: 'Kashmiri',
                      ne: 'Nepali', kok: 'Konkani', sd: 'Sindhi', doi: 'Dogri',
                      mni: 'Manipuri', sa: 'Sanskrit', brx: 'Bodo',
                      es: 'Spanish', fr: 'French', de: 'German',
                      ja: 'Japanese', zh: 'Chinese', ru: 'Russian',
                      pt: 'Portuguese', it: 'Italian', ko: 'Korean'
                    };
                    return (
                      <button
                        key={langCode}
                        onClick={async () => {
                          if (window.electronAPI) {
                            await window.electronAPI.translateWebsite({ targetLanguage: langCode, method: translateMethod });
                          }
                          setShowTranslateDialog(false);
                        }}
                        className="flex flex-col items-center justify-center p-4 bg-[var(--primary-bg)] hover:bg-accent/5 border border-border-color/10 hover:border-accent/40 rounded-xl transition-all group"
                      >
                        <span className="text-sm font-black text-primary-text group-hover:text-accent transition-colors">{names[langCode] || langCode}</span>
                        <span className="text-[10px] font-bold text-secondary-text/30 uppercase tracking-widest mt-1">{langCode}</span>
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => setShowTranslateDialog(false)} className="w-full mt-6 py-2 text-[10px] font-black uppercase tracking-widest text-secondary-text/40 hover:text-primary-text">Close</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <audio ref={ambientAudioRef} src={store.ambientMusicUrl} loop hidden />

      {/* ── SETTINGS / OVERLAYS (all unchanged) ── */}
      <AnimatePresence>
        {showSettings && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-md p-10"
            onPointerDown={handleSettingsClose}
          >
            <div className="w-full max-w-4xl" onPointerDown={(event) => event.stopPropagation()}>
              <SettingsPanel onClose={handleSettingsClose} defaultSection={settingsSection} />
            </div>
          </div>
        )}
        {showDownloads && (
          <div className="fixed inset-0 z-[9998]" onPointerDown={() => setShowDownloads(false)}>
            <div
              className="fixed top-24 right-10 z-[9999] w-[400px] h-[600px] rounded-3xl border shadow-2xl p-6 overflow-hidden flex flex-col backdrop-blur-3xl"
              style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-black uppercase tracking-widest text-accent">Downloads</h3>
                <button onClick={() => setShowDownloads(false)} className="p-2 hover:bg-black/5 rounded-full transition-all text-secondary-text">
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4">
                {downloads.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center opacity-30 gap-4">
                    <DownloadCloud size={40} />
                    <p className="text-xs font-bold uppercase tracking-widest">No Active Downloads</p>
                  </div>
                ) : (
                  downloads.map((d, i) => (
                    <div
                      key={i}
                      className="p-4 bg-[var(--primary-bg)]/5 rounded-2xl border border-border-color/10 flex items-center justify-between group hover:border-accent/30 transition-all cursor-pointer"
                      onClick={async () => {
                        if (d.status === 'completed' && window.electronAPI?.openFile) {
                          const fileToOpen = d.path || d.name;
                          await window.electronAPI.openFile(fileToOpen);
                        }
                      }}
                    >
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-primary-text truncate max-w-[200px]">{d.name}</span>
                        <span className="text-[10px] uppercase font-black tracking-tighter text-accent/60">
                          {d.status === 'completed' ? '✓ Click to Open' : d.status}
                        </span>
                      </div>
                      <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: d.status === 'completed' ? '100%' : `${d.progress || 0}%` }}
                          className="h-full bg-sky-400"
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
        {showClipboard && (
          <div className="fixed inset-0 z-[9998]" onPointerDown={() => setShowClipboard(false)}>
            <div
              className="fixed top-24 right-10 z-[9999] w-[450px] h-[650px] overflow-hidden"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <ClipboardManager onClose={() => setShowClipboard(false)} />
            </div>
          </div>
        )}
        {showCart && (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-md" onPointerDown={() => setShowCart(false)}>
            <div className="w-full max-w-[900px]" onPointerDown={(event) => event.stopPropagation()}>
              <UnifiedCartPanel onClose={() => setShowCart(false)} onScan={handleCartScan} />
            </div>
          </div>
        )}
        {showExtensionsPopup && (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-md p-10" onPointerDown={() => setShowExtensionsPopup(false)}>
            <div
              className="w-full max-w-4xl h-full max-h-[800px] rounded-[40px] border shadow-2xl p-8 overflow-hidden flex flex-col backdrop-blur-3xl"
              style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-sky-400/20 flex items-center justify-center text-sky-400">
                    <Puzzle size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black uppercase tracking-tighter text-white">Extension Forge</h2>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-sky-400/60">Manage your neural plugins</p>
                  </div>
                </div>
                <button onClick={() => setShowExtensionsPopup(false)} className="p-3 hover:bg-white/10 rounded-full transition-all group">
                  <X size={20} className="text-white/40 group-hover:text-white" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-4 pb-10">
                <div className="grid grid-cols-2 gap-6">
                  {activeExtensions.length === 0 ? (
                    <div className="col-span-2 py-20 text-center opacity-20">
                      <Puzzle size={64} className="mx-auto mb-6" />
                      <p className="text-sm font-black uppercase tracking-[0.3em]">No Extensions Installed</p>
                    </div>
                  ) : (
                    activeExtensions.map(ext => (
                      <div key={ext.id} className="p-6 rounded-3xl border transition-all group" style={{ background: 'color-mix(in srgb, var(--card-bg) 40%, transparent)', borderColor: 'var(--glass-border)' }}>
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-black/10 rounded-xl flex items-center justify-center overflow-hidden border border-border-color">
                              {ext.icon ? <img src={ext.icon} className="w-full h-full object-cover" /> : <Puzzle size={20} className="text-secondary-text" />}
                            </div>
                            <div>
                              <h4 className="text-sm font-black text-primary-text">{ext.name}</h4>
                              <p className="text-[10px] text-secondary-text uppercase tracking-widest">{ext.id}</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => window.electronAPI?.toggleExtension(ext.id)} className={`p-2 rounded-lg transition-all ${ext.enabled ? 'bg-accent/10 text-accent' : 'bg-black/5 text-secondary-text'}`}>
                              <Zap size={14} />
                            </button>
                            <button onClick={() => window.electronAPI?.uninstallExtension(ext.id)} className="p-2 hover:bg-red-500/10 hover:text-red-400 text-secondary-text rounded-lg transition-all">
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      <SpotlightSearchOverlay show={showSpotlightSearch} onClose={() => setShowSpotlightSearch(false)} />

      {showSchedulingModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <SchedulingModal
            isOpen={showSchedulingModal}
            onClose={() => {
              setShowSchedulingModal(false);
              setIsBrowserDisabled(false);
            }}
            onConfirm={async (config) => {
              if (window.electronAPI?.scheduleTask) {
                await window.electronAPI.scheduleTask({
                  name: 'Scheduled Task',
                  type: 'ai-prompt',
                  cronExpression: config.schedule,
                  prompt: schedulingIntent?.taskName || 'Run AI task',
                  outputPath: config.outputPath,
                  enabled: config.enabled,
                });
              }
              setShowSchedulingModal(false);
              setIsBrowserDisabled(false);
            }}
            taskDetails={{
              taskName: schedulingIntent?.taskName || 'Scheduled Task',
              taskType: schedulingIntent?.taskType || 'ai-prompt',
              schedule: schedulingIntent?.schedule.expression || '0 8 * * *',
              description: schedulingIntent?.schedule.description || 'Configure your scheduled task',
            }}
          />
        </div>
      )}

      <PasswordSaveDialog
        data={passwordSaveDialog}
        onClose={() => setPasswordSaveDialog(null)}
      />
    </div>
  );
}
