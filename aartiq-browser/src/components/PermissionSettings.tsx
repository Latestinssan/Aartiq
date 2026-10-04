"use client";

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  AppWindow,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  FolderPlus,
  Key,
  Lock,
  Monitor,
  Plus,
  RotateCw,
  Settings2,
  Shield,
  SunMedium,
  Terminal,
  Trash2,
  Volume2,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  AI_ACTIONS_BY_RISK,
  normalizeActionType,
  type AIActionSecurityDefinition,
} from '@/lib/ai-action-security';
import { normalizeCommandPattern } from '@/lib/shell-command-tiers';

const SAFE_COMMANDS = [
  { cmd: 'ls', desc: 'Lists directory contents', category: 'Navigation' },
  { cmd: 'cat', desc: 'Displays file contents', category: 'Navigation' },
  { cmd: 'head', desc: 'Shows first lines of a file', category: 'Navigation' },
  { cmd: 'tail', desc: 'Shows last lines of a file', category: 'Navigation' },
  { cmd: 'pwd', desc: 'Prints the current working directory', category: 'Navigation' },
  { cmd: 'cd', desc: 'Changes directories', category: 'Navigation' },
  { cmd: 'cp', desc: 'Copies files or folders', category: 'File Ops' },
  { cmd: 'mv', desc: 'Moves or renames files', category: 'File Ops' },
  { cmd: 'mkdir', desc: 'Creates directories', category: 'File Ops' },
  { cmd: 'touch', desc: 'Creates empty files', category: 'File Ops' },
  { cmd: 'find', desc: 'Searches for files', category: 'Search' },
  { cmd: 'grep', desc: 'Searches file contents', category: 'Search' },
  { cmd: 'git', desc: 'Runs version control workflows', category: 'Development' },
  { cmd: 'npm', desc: 'Runs Node package scripts', category: 'Development' },
  { cmd: 'node', desc: 'Runs JavaScript programs', category: 'Development' },
  { cmd: 'python', desc: 'Runs Python programs', category: 'Development' },
  { cmd: 'open', desc: 'Opens files with the default app', category: 'System' },
];

const MEDIUM_RISK_COMMANDS = [
  { cmd: 'kill', desc: 'Stops running processes', warning: 'Can terminate programs' },
  { cmd: 'pkill', desc: 'Kills processes by name', warning: 'Can terminate programs' },
  { cmd: 'curl', desc: 'Downloads or sends data to URLs', warning: 'Touches the network' },
  { cmd: 'wget', desc: 'Downloads data to disk', warning: 'Touches the network' },
  { cmd: 'launchctl', desc: 'Manages system services', warning: 'Affects background services' },
  { cmd: 'networksetup', desc: 'Changes network configuration', warning: 'Modifies networking' },
];

const HIGH_RISK_COMMANDS = [
  { cmd: 'sudo', desc: 'Admin privileges', warning: 'Requires elevated access' },
  { cmd: 'rm -rf', desc: 'Recursive delete', warning: 'Can erase large parts of the filesystem' },
  { cmd: 'shutdown', desc: 'Shutdown system', warning: 'Powers off the machine' },
  { cmd: 'reboot', desc: 'Restart system', warning: 'Restarts the machine' },
  { cmd: 'dd', desc: 'Low-level disk writes', warning: 'Can destroy drives and partitions' },
  { cmd: 'mkfs', desc: 'Format disk', warning: 'Erases all data on a disk' },
];

type SecuritySettings = {
  autoApproveLowRisk: boolean;
  autoApproveMidRisk: boolean;
  requireDeviceUnlockForManualApproval: boolean;
  requireDeviceUnlockForVaultAccess: boolean;
  requireBiometricPerSession: boolean;
  requireBiometricEveryTime: boolean;
  autoApprovedCommands: string[];
  autoApprovedActions: string[];
};

const DEFAULT_SETTINGS: SecuritySettings = {
  autoApproveLowRisk: false,
  autoApproveMidRisk: false,
  requireDeviceUnlockForManualApproval: true,
  requireDeviceUnlockForVaultAccess: true,
  requireBiometricPerSession: true,
  requireBiometricEveryTime: false,
  autoApprovedCommands: [],
  autoApprovedActions: [],
};

/**
 * Key for a persisted "Allow Always" command entry.
 *
 * Was first-word-only, which meant a grant for one `grep` covered every later
 * `grep`. It now delegates to the shared normaliser in shell-command-tiers.js —
 * the same function PermissionStore and command-validator use — so the panel
 * cannot disagree with the gate it is editing.
 */
function normalizeCommandKey(command: string) {
  return normalizeCommandPattern(command);
}

function actionIcon(actionType: string) {
  switch (actionType) {
    case 'OPEN_APP':
      return <AppWindow size={18} className="text-sky-300" />;
    case 'SET_VOLUME':
      return <Volume2 size={18} className="text-sky-300" />;
    case 'SET_BRIGHTNESS':
      return <SunMedium size={18} className="text-sky-300" />;
    default:
      return <Shield size={18} className="text-sky-300" />;
  }
}

const PermissionSettings = () => {
  const [settings, setSettings] = useState<SecuritySettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showLowRiskActions, setShowLowRiskActions] = useState(true);
  const [showMediumRiskActions, setShowMediumRiskActions] = useState(true);
  const [showHighRiskActions, setShowHighRiskActions] = useState(true);
  const [showSafeCommands, setShowSafeCommands] = useState(false);
  const [showMediumCommands, setShowMediumCommands] = useState(false);
  const [showHighCommands, setShowHighCommands] = useState(false);
  const [allowedDirectories, setAllowedDirectories] = useState<Array<{path:string;recursive:boolean;access:string;grantedAt:number;grantedVia:string}>>([]);
  const [newDirectoryPath, setNewDirectoryPath] = useState('');
  const [newDirectoryAccess, setNewDirectoryAccess] = useState<'read'|'read-write'>('read-write');
  const [newDirectoryRecursive, setNewDirectoryRecursive] = useState(true);
  const [directoryError, setDirectoryError] = useState('');
  const [cliToken, setCliToken] = useState<string>('');
  const [cliTokenPath, setCliTokenPath] = useState<string>('');
  const [showCliToken, setShowCliToken] = useState<boolean>(false);
  const [cliTokenCopied, setCliTokenCopied] = useState<boolean>(false);
  const [customCommandInput, setCustomCommandInput] = useState<string>('');

  const loadSettings = async () => {
    try {
      const nextSettings = await window.electronAPI?.getSecuritySettings?.();
      if (nextSettings) {
        setSettings({
          autoApproveLowRisk: !!nextSettings.autoApproveLowRisk,
          autoApproveMidRisk: !!nextSettings.autoApproveMidRisk,
          requireDeviceUnlockForManualApproval:
            nextSettings.requireDeviceUnlockForManualApproval !== false,
          requireDeviceUnlockForVaultAccess:
            nextSettings.requireDeviceUnlockForVaultAccess !== false,
          requireBiometricPerSession:
            nextSettings.requireBiometricPerSession !== false,
          requireBiometricEveryTime:
            (nextSettings as any).requireBiometricEveryTime === true,
          autoApprovedCommands: Array.isArray(nextSettings.autoApprovedCommands)
            ? nextSettings.autoApprovedCommands.map((command) => normalizeCommandKey(command))
            : [],
          autoApprovedActions: Array.isArray(nextSettings.autoApprovedActions)
            ? nextSettings.autoApprovedActions.map((action) => normalizeActionType(action))
            : [],
        });
      }

      // Load directory allowlist
      try {
        const dirResult = await (window as any).electronAPI?.getDirectoryAllowlist?.();
        if (dirResult?.success && Array.isArray(dirResult.directories)) {
          const dirs = dirResult.directories.map((d: any) =>
            typeof d === 'string'
              ? { path: d, recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'migrated' }
              : d
          );
          setAllowedDirectories(dirs);
        }
      } catch (dirErr) {
        console.error('[PermissionSettings] Failed to load directory allowlist:', dirErr);
      }

      // Load CLI Token
      try {
        const tokenRes = await (window as any).electronAPI?.getCliToken?.();
        if (tokenRes?.success && tokenRes.token) {
          setCliToken(tokenRes.token);
          setCliTokenPath(tokenRes.tokenPath || '');
        }
      } catch (tokenErr) {
        console.error('[PermissionSettings] Failed to load CLI token:', tokenErr);
      }
    } catch (error) {
      console.error('[PermissionSettings] Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateCliToken = async () => {
    try {
      const res = await (window as any).electronAPI?.regenerateCliToken?.();
      if (res?.success && res.token) {
        setCliToken(res.token);
        if (res.tokenPath) setCliTokenPath(res.tokenPath);
      }
    } catch (e) {
      console.error('[PermissionSettings] Failed to regenerate CLI token:', e);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const updateSetting = async (
    key: 'autoApproveLowRisk' | 'autoApproveMidRisk' | 'requireDeviceUnlockForManualApproval' | 'requireDeviceUnlockForVaultAccess' | 'requireBiometricPerSession' | 'requireBiometricEveryTime',
    value: boolean
  ) => {
    const previous = settings;
    const next = { ...settings, [key]: value };
    setSettings(next);
    setSaving(true);

    try {
      await window.electronAPI?.updateSecuritySettings?.({ [key]: value });
    } catch (error) {
      console.error('[PermissionSettings] Failed to update setting:', error);
      setSettings(previous);
    } finally {
      setSaving(false);
    }
  };

  const toggleAutoCommand = async (command: string) => {
    const key = normalizeCommandKey(command);
    const enabled = !settings.autoApprovedCommands.includes(key);

    setSettings((current) => ({
      ...current,
      autoApprovedCommands: enabled
        ? [...current.autoApprovedCommands, key]
        : current.autoApprovedCommands.filter((entry) => entry !== key),
    }));

    try {
      await window.electronAPI?.setAutoApprovalCommand?.({ command: key, enabled });
    } catch (error) {
      console.error('[PermissionSettings] Failed to update command override:', error);
      await loadSettings();
    }
  };

  const toggleAutoAction = async (actionType: string) => {
    const normalized = normalizeActionType(actionType);
    const enabled = !settings.autoApprovedActions.includes(normalized);

    setSettings((current) => ({
      ...current,
      autoApprovedActions: enabled
        ? [...current.autoApprovedActions, normalized]
        : current.autoApprovedActions.filter((entry) => entry !== normalized),
    }));

    try {
      await window.electronAPI?.setAutoApprovalAction?.({ actionType: normalized, enabled });
    } catch (error) {
      console.error('[PermissionSettings] Failed to update action override:', error);
      await loadSettings();
    }
  };

  const addDirectoryToAllowlist = async () => {
    if (!newDirectoryPath.trim()) return;
    setDirectoryError('');
    try {
      const result = await (window as any).electronAPI?.addDirectoryToAllowlist?.(newDirectoryPath.trim(), {
        access: newDirectoryAccess,
        recursive: newDirectoryRecursive,
        grantedVia: 'settings',
      });
      if (result?.success) {
        const dirs = result.directories.map((d: any) =>
          typeof d === 'string'
            ? { path: d, recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'migrated' }
            : d
        );
        setAllowedDirectories(dirs);
        setNewDirectoryPath('');
      } else {
        setDirectoryError(result?.error || 'Failed to add directory.');
      }
    } catch (error) {
      console.error('[PermissionSettings] Failed to add directory:', error);
      setDirectoryError('Failed to add directory.');
    }
  };

  const removeDirectoryFromAllowlist = async (dirPath: string) => {
    setDirectoryError('');
    try {
      const result = await (window as any).electronAPI?.removeDirectoryFromAllowlist?.(dirPath);
      if (result?.success) {
        const dirs = result.directories.map((d: any) =>
          typeof d === 'string'
            ? { path: d, recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'migrated' }
            : d
        );
        setAllowedDirectories(dirs);
      } else {
        setDirectoryError(result?.error || 'Failed to remove directory.');
      }
    } catch (error) {
      console.error('[PermissionSettings] Failed to remove directory:', error);
    }
  };

  const openSystemSettings = (type: 'screen' | 'accessibility' | 'automation') => {
    const urls: Record<string, string> = {
      screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
    };
    void window.electronAPI?.openSystemSettings?.(urls[type]);
  };

  const platform = typeof window !== 'undefined' && window.electronAPI?.getPlatform
    ? window.electronAPI.getPlatform()
    : 'darwin';
  const isMac = platform === 'darwin';

  const autoApprovedActionSet = useMemo(
    () => new Set(settings.autoApprovedActions.map((action) => normalizeActionType(action))),
    [settings.autoApprovedActions]
  );

  const autoApprovedCommandSet = useMemo(
    () => new Set(settings.autoApprovedCommands.map((command) => normalizeCommandKey(command))),
    [settings.autoApprovedCommands]
  );

  const renderActionSection = (
    title: string,
    subtitle: string,
    actions: AIActionSecurityDefinition[],
    expanded: boolean,
    setExpanded: (value: boolean) => void,
    tone: 'green' | 'yellow' | 'red'
  ) => {
    const tones = {
      green: {
        icon: <CheckCircle size={18} className="text-green-400" />,
        card: 'bg-green-500/5 border-green-500/20',
        badge: 'text-green-300 bg-green-500/10 border-green-500/20',
        enabled: 'bg-green-500/80 text-white',
      },
      yellow: {
        icon: <AlertTriangle size={18} className="text-yellow-400" />,
        card: 'bg-yellow-500/5 border-yellow-500/20',
        badge: 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20',
        enabled: 'bg-yellow-500/80 text-white',
      },
      red: {
        icon: <XCircle size={18} className="text-red-400" />,
        card: 'bg-red-500/5 border-red-500/20',
        badge: 'text-red-300 bg-red-500/10 border-red-500/20',
        enabled: 'bg-red-500/80 text-white',
      },
    }[tone];

    return (
      <div className="bg-white/5 rounded-3xl border border-white/10 overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/5 transition-all"
        >
          <div className="flex items-center gap-3">
            {tones.icon}
            <div className="text-left">
              <div className="text-white font-bold">{title}</div>
              <div className="text-[11px] text-white/45">{subtitle}</div>
            </div>
            <span className="text-xs text-white/40 bg-white/10 px-2 py-1 rounded-full">
              {actions.length} actions
            </span>
          </div>
          {expanded ? <ChevronUp size={18} className="text-white/40" /> : <ChevronDown size={18} className="text-white/40" />}
        </button>

        {expanded && (
          <div className="p-4 border-t border-white/10 grid gap-3 md:grid-cols-2">
            {actions.map((action) => {
              const individuallyEnabled = autoApprovedActionSet.has(action.actionType);
              const globallyEnabled = action.risk === 'low'
                ? settings.autoApproveLowRisk
                : action.risk === 'medium'
                  ? settings.autoApproveMidRisk
                  : false;
              const effectiveEnabled = individuallyEnabled || globallyEnabled;
              const manualOnly = action.risk === 'high' || action.toggleable === false;

              return (
                <div key={action.actionType} className={`rounded-2xl border px-4 py-4 ${tones.card}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-black/30 border border-white/10 flex items-center justify-center flex-shrink-0">
                        {actionIcon(action.actionType)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h5 className="text-white font-bold">{action.label}</h5>
                          <span className={`px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-[0.3em] ${tones.badge}`}>
                            {action.category}
                          </span>
                        </div>
                        <p className="text-[12px] text-white/65 mt-1">{action.description}</p>
                        <p className="text-[11px] text-white/40 mt-2 leading-relaxed">{action.detail}</p>
                      </div>
                    </div>

                    {manualOnly ? (
                      <span className="px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.3em] bg-red-500/10 border border-red-500/20 text-red-300 flex-shrink-0">
                        Manual Only
                      </span>
                    ) : (
                      <button
                        disabled={globallyEnabled}
                        onClick={() => void toggleAutoAction(action.actionType)}
                        className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.35em] transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                          effectiveEnabled ? tones.enabled : 'bg-white/10 text-white/60'
                        }`}
                      >
                        {globallyEnabled ? 'Global ON' : individuallyEnabled ? 'Auto ON' : 'Auto OFF'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-sky-500/10 to-blue-500/10 rounded-3xl p-6 border border-sky-500/20">
        <div className="flex items-center gap-4 mb-3">
          <Shield size={28} className="text-sky-400" />
          <div>
            <h3 className="text-xl font-black text-white uppercase tracking-wide">AI Action Security Manager</h3>
            <p className="text-white/50 text-sm">
              Unified approval controls for AI browser actions, OS changes, shell commands, and native unlock rules.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white/5 rounded-3xl p-6 border border-white/10">
        <div className="flex items-center gap-3 mb-4">
          <Zap size={20} className="text-yellow-400" />
          <h4 className="text-lg font-bold text-white">Risk Profiles</h4>
          {saving && <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin ml-2" />}
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-green-500/5 rounded-2xl border border-green-500/20">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <CheckCircle size={20} className="text-green-400" />
                </div>
                <div>
                  <h5 className="text-white font-bold">Low Risk AI Actions</h5>
                  <p className="text-white/50 text-xs">Navigation, page reads, and other inside-Aartiq safe actions.</p>
                </div>
              </div>
              <button
                onClick={() => void updateSetting('autoApproveLowRisk', !settings.autoApproveLowRisk)}
                className={`relative w-14 h-8 rounded-full transition-all duration-300 ${settings.autoApproveLowRisk ? 'bg-green-500' : 'bg-white/10'}`}
              >
                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${settings.autoApproveLowRisk ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </div>

          <div className="p-4 bg-yellow-500/5 rounded-2xl border border-yellow-500/20">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                  <AlertTriangle size={20} className="text-yellow-400" />
                </div>
                <div>
                  <h5 className="text-white font-bold">Medium Risk AI Actions</h5>
                  <p className="text-white/50 text-xs">Clicks, form fill, app launch, volume, brightness, and other interactive actions.</p>
                </div>
              </div>
              <button
                onClick={() => void updateSetting('autoApproveMidRisk', !settings.autoApproveMidRisk)}
                className={`relative w-14 h-8 rounded-full transition-all duration-300 ${settings.autoApproveMidRisk ? 'bg-yellow-500' : 'bg-white/10'}`}
              >
                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${settings.autoApproveMidRisk ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </div>

          <div className="p-4 bg-red-500/5 rounded-2xl border border-red-500/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                <XCircle size={20} className="text-red-400" />
              </div>
              <div>
                <h5 className="text-white font-bold">High Risk Lane</h5>
                <p className="text-white/50 text-xs">High-risk shell actions always stay manual and never become globally auto-run.</p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-sky-500/5 rounded-2xl border border-sky-500/20">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 flex items-center justify-center">
                  <Lock size={20} className="text-sky-400" />
                </div>
                <div>
                  <h5 className="text-white font-bold">Device Unlock For Manual Approval</h5>
                  <p className="text-white/50 text-xs">Require a native OS unlock prompt after manual shell approval and before execution.</p>
                </div>
              </div>
              <button
                onClick={() => void updateSetting('requireDeviceUnlockForManualApproval', !settings.requireDeviceUnlockForManualApproval)}
                className={`relative w-14 h-8 rounded-full transition-all duration-300 ${settings.requireDeviceUnlockForManualApproval ? 'bg-sky-500' : 'bg-white/10'}`}
              >
                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${settings.requireDeviceUnlockForManualApproval ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </div>

          <div className="p-4 bg-violet-500/5 rounded-2xl border border-violet-500/20">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
                  <Lock size={20} className="text-violet-400" />
                </div>
                <div>
                  <h5 className="text-white font-bold">Device Unlock For Neural Vault</h5>
                  <p className="text-white/50 text-xs">Require a native OS unlock prompt before revealing or autofilling saved credentials.</p>
                </div>
              </div>
              <button
                onClick={() => void updateSetting('requireDeviceUnlockForVaultAccess', !settings.requireDeviceUnlockForVaultAccess)}
                className={`relative w-14 h-8 rounded-full transition-all duration-300 ${settings.requireDeviceUnlockForVaultAccess ? 'bg-violet-500' : 'bg-white/10'}`}
              >
                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${settings.requireDeviceUnlockForVaultAccess ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </div>

          <div className="p-4 bg-purple-500/5 rounded-2xl border border-purple-500/20">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                  <Lock size={20} className="text-purple-400" />
                </div>
                <div>
                  <h5 className="text-white font-bold">Biometric Per Session</h5>
                  <p className="text-white/50 text-xs">Require Touch ID / Windows Hello once per session before auto-approving low risk actions.</p>
                </div>
              </div>
              <button
                onClick={() => void updateSetting('requireBiometricPerSession', !settings.requireBiometricPerSession)}
                className={`relative w-14 h-8 rounded-full transition-all duration-300 ${settings.requireBiometricPerSession ? 'bg-purple-500' : 'bg-white/10'}`}
              >
                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${settings.requireBiometricPerSession ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </div>

          <div className="p-4 bg-rose-500/5 rounded-2xl border border-rose-500/20">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center">
                  <Lock size={20} className="text-rose-400" />
                </div>
                <div>
                  <h5 className="text-white font-bold">Biometric Every Action</h5>
                  <p className="text-white/50 text-xs">Require Touch ID / Windows Hello for EVERY low risk action. Stricter than per-session.</p>
                </div>
              </div>
              <button
                onClick={() => void updateSetting('requireBiometricEveryTime', !settings.requireBiometricEveryTime)}
                className={`relative w-14 h-8 rounded-full transition-all duration-300 ${settings.requireBiometricEveryTime ? 'bg-rose-500' : 'bg-white/10'}`}
              >
                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${settings.requireBiometricEveryTime ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white/5 rounded-3xl p-6 border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-lg font-bold text-white">AI Action Policies</h4>
            <p className="text-xs text-white/40">Per-action overrides for browser automation, app launch, and system controls.</p>
          </div>
          <span className="text-[11px] uppercase tracking-[0.4em] text-white/40">
            {settings.autoApprovedActions.length} custom actions
          </span>
        </div>

        {renderActionSection(
          'Low Risk Actions',
          'Navigation and read-only browser actions.',
          AI_ACTIONS_BY_RISK.low,
          showLowRiskActions,
          setShowLowRiskActions,
          'green'
        )}
        {renderActionSection(
          'Medium Risk Actions',
          'Interactive AI actions including clicks, form fill, open app, volume, and brightness.',
          AI_ACTIONS_BY_RISK.medium,
          showMediumRiskActions,
          setShowMediumRiskActions,
          'yellow'
        )}
        {renderActionSection(
          'High Risk Actions',
          'Manual-only actions that stay behind explicit approval.',
          AI_ACTIONS_BY_RISK.high,
          showHighRiskActions,
          setShowHighRiskActions,
          'red'
        )}
      </div>

      {/* CLI & Automation Token Management Section */}
      <div className="bg-white/5 rounded-3xl p-6 border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Key size={20} className="text-amber-400" />
            <div>
              <h4 className="text-lg font-bold text-white">CLI Authentication Token</h4>
              <p className="text-xs text-white/40">
                Token used by <code className="text-amber-300 font-mono">aartiq-cli</code> and external shell automation scripts.
              </p>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.3em] bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-bold">
            Active & Secured
          </span>
        </div>

        <div className="bg-black/30 border border-white/10 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>Token File Location:</span>
            <code className="text-white/80 font-mono text-[11px] bg-white/5 px-2 py-0.5 rounded">{cliTokenPath || '~/.aartiq-token'}</code>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showCliToken ? "text" : "password"}
                readOnly
                value={cliToken || '••••••••••••••••••••••••••••••••'}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono text-amber-300 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowCliToken(!showCliToken)}
                className="absolute right-3 top-2.5 p-1 text-white/40 hover:text-white transition-all"
                title={showCliToken ? "Hide token" : "Show token"}
              >
                {showCliToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                if (cliToken) {
                  navigator.clipboard.writeText(cliToken);
                  setCliTokenCopied(true);
                  setTimeout(() => setCliTokenCopied(false), 2000);
                }
              }}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-xs text-white font-semibold transition-all flex items-center gap-1.5 shrink-0"
            >
              <Copy size={15} />
              {cliTokenCopied ? 'Copied!' : 'Copy Token'}
            </button>

            <button
              type="button"
              onClick={handleRegenerateCliToken}
              className="px-4 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-xl text-xs text-amber-300 font-bold transition-all flex items-center gap-1.5 shrink-0"
              title="Regenerate CLI authentication token"
            >
              <RotateCw size={15} />
              Regenerate
            </button>
          </div>
        </div>

        <div className="text-[11px] text-white/40 leading-relaxed bg-white/5 p-3 rounded-xl border border-white/5">
          💡 Use this token in automated shell scripts or terminal tools via: <code className="text-amber-300/80 font-mono">aartiq --token &lt;TOKEN&gt; "exec &lt;command&gt;"</code> or setting <code className="text-amber-300/80 font-mono">AARTIQ_TOKEN</code> in your environment.
        </div>
      </div>

      <div className="bg-white/5 rounded-3xl p-6 border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-lg font-bold text-white">Shell Command Policies & Allowlist</h4>
            <p className="text-xs text-white/40">Manage auto-approved shell binaries and per-command execution policies.</p>
          </div>
          <span className="text-[11px] uppercase tracking-[0.4em] text-white/40">
            {settings.autoApprovedCommands.length} command overrides
          </span>
        </div>

        {/* Custom Command Input */}
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={customCommandInput}
            onChange={(e) => setCustomCommandInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customCommandInput.trim()) {
                const cmdKey = normalizeCommandKey(customCommandInput.trim());
                if (cmdKey) {
                  void toggleAutoCommand(cmdKey);
                  setCustomCommandInput('');
                }
              }
            }}
            placeholder="Add custom command binary (e.g. docker, grep, npm, python3, find)"
            className="flex-1 min-w-[200px] bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-sky-500/50 transition-all"
          />
          <button
            type="button"
            onClick={() => {
              if (customCommandInput.trim()) {
                const cmdKey = normalizeCommandKey(customCommandInput.trim());
                if (cmdKey) {
                  void toggleAutoCommand(cmdKey);
                  setCustomCommandInput('');
                }
              }
            }}
            disabled={!customCommandInput.trim()}
            className="px-4 py-2.5 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/30 rounded-xl text-sm text-sky-300 font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
          >
            <Plus size={16} />
            Add Command
          </button>
        </div>

        {/* Active Auto-approved Command Tags */}
        <div className="flex flex-wrap gap-2 pt-1">
          {settings.autoApprovedCommands.length === 0 ? (
            <span className="text-[11px] text-white/40">No custom shell command overrides configured yet.</span>
          ) : (
            settings.autoApprovedCommands.map((command) => (
              <span
                key={command}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 text-xs font-mono text-sky-300"
              >
                <span>{command}</span>
                <button
                  type="button"
                  onClick={() => void toggleAutoCommand(command)}
                  className="p-0.5 hover:text-red-400 text-white/40 transition-colors"
                  title={`Remove ${command} from auto-approve list`}
                >
                  <Trash2 size={12} />
                </button>
              </span>
            ))
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {[...SAFE_COMMANDS, ...MEDIUM_RISK_COMMANDS].map((command) => {
            const enabled = autoApprovedCommandSet.has(normalizeCommandKey(command.cmd));
            const globallyEnabled = SAFE_COMMANDS.some((entry) => entry.cmd === command.cmd)
              ? settings.autoApproveLowRisk
              : settings.autoApproveMidRisk;

            return (
              <div key={command.cmd} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.4em] text-white/40">
                    {'category' in command ? command.category : 'Medium Risk'}
                  </div>
                  <p className="text-sm font-bold text-white">{command.cmd}</p>
                  <p className="text-[11px] text-white/60">{command.desc}</p>
                </div>
                <button
                  disabled={globallyEnabled}
                  onClick={() => void toggleAutoCommand(command.cmd)}
                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.35em] transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                    enabled || globallyEnabled ? 'bg-green-500/80 text-white' : 'bg-white/10 text-white/60'
                  }`}
                >
                  {globallyEnabled ? 'Global ON' : enabled ? 'Auto ON' : 'Auto OFF'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-white/5 rounded-3xl border border-white/10 overflow-hidden">
          <button
            onClick={() => setShowSafeCommands(!showSafeCommands)}
            className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-all"
          >
            <div className="flex items-center gap-3">
              <CheckCircle size={18} className="text-green-400" />
              <span className="text-white font-bold">Low Risk Shell Commands</span>
              <span className="text-xs text-white/40 bg-white/10 px-2 py-1 rounded-full">{SAFE_COMMANDS.length} commands</span>
            </div>
            {showSafeCommands ? <ChevronUp size={18} className="text-white/40" /> : <ChevronDown size={18} className="text-white/40" />}
          </button>
          {showSafeCommands && (
            <div className="p-4 border-t border-white/10 grid gap-2">
              {SAFE_COMMANDS.map((command) => (
                <div key={command.cmd} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                  <code className="text-sky-400 font-mono text-sm bg-black/30 px-2 py-1 rounded">{command.cmd}</code>
                  <span className="text-white/60 text-sm flex-1">{command.desc}</span>
                  <span className="text-xs text-green-400/60 bg-green-500/10 px-2 py-1 rounded-full">{command.category}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white/5 rounded-3xl border border-white/10 overflow-hidden">
          <button
            onClick={() => setShowMediumCommands(!showMediumCommands)}
            className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-all"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle size={18} className="text-yellow-400" />
              <span className="text-white font-bold">Medium Risk Shell Commands</span>
              <span className="text-xs text-white/40 bg-white/10 px-2 py-1 rounded-full">{MEDIUM_RISK_COMMANDS.length} commands</span>
            </div>
            {showMediumCommands ? <ChevronUp size={18} className="text-white/40" /> : <ChevronDown size={18} className="text-white/40" />}
          </button>
          {showMediumCommands && (
            <div className="p-4 border-t border-white/10 grid gap-2">
              {MEDIUM_RISK_COMMANDS.map((command) => (
                <div key={command.cmd} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                  <code className="text-sky-400 font-mono text-sm bg-black/30 px-2 py-1 rounded">{command.cmd}</code>
                  <span className="text-white/60 text-sm flex-1">{command.desc}</span>
                  <span className="text-xs text-yellow-400/80 bg-yellow-500/10 px-2 py-1 rounded-full">{command.warning}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white/5 rounded-3xl border border-white/10 overflow-hidden">
          <button
            onClick={() => setShowHighCommands(!showHighCommands)}
            className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-all"
          >
            <div className="flex items-center gap-3">
              <XCircle size={18} className="text-red-400" />
              <span className="text-white font-bold">High Risk Shell Commands</span>
              <span className="text-xs text-white/40 bg-white/10 px-2 py-1 rounded-full">{HIGH_RISK_COMMANDS.length} commands</span>
            </div>
            {showHighCommands ? <ChevronUp size={18} className="text-white/40" /> : <ChevronDown size={18} className="text-white/40" />}
          </button>
          {showHighCommands && (
            <div className="p-4 border-t border-white/10 grid gap-2">
              {HIGH_RISK_COMMANDS.map((command) => (
                <div key={command.cmd} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                  <code className="text-red-400 font-mono text-sm bg-black/30 px-2 py-1 rounded">{command.cmd}</code>
                  <span className="text-white/60 text-sm flex-1">{command.desc}</span>
                  <span className="text-xs text-red-400/80 bg-red-500/10 px-2 py-1 rounded-full">{command.warning}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Directory Allowlist Section */}
      <div className="bg-white/5 rounded-3xl p-6 border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FolderOpen size={20} className="text-emerald-400" />
            <div>
              <h4 className="text-lg font-bold text-white">Directory Allowlist</h4>
              <p className="text-xs text-white/40">
                Control which directories the AI can access. Scoped, explicit, and revocable.
              </p>
            </div>
          </div>
          <span className="text-[11px] uppercase tracking-[0.4em] text-white/40">
            {allowedDirectories.length} directories
          </span>
        </div>

        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={newDirectoryPath}
            onChange={(e) => { setNewDirectoryPath(e.target.value); setDirectoryError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && addDirectoryToAllowlist()}
            placeholder="/path/to/directory"
            className="flex-1 min-w-[200px] bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50 transition-all"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                const dirPath = await (window as any).electronAPI?.selectLocalFile?.({ properties: ['openDirectory'] });
                if (dirPath) {
                  setNewDirectoryPath(dirPath);
                  setDirectoryError('');
                }
              } catch (e) {
                console.error('Failed to browse directory:', e);
              }
            }}
            className="px-3 py-2.5 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-xs text-white/90 font-semibold transition-all flex items-center gap-1.5 shrink-0"
            title="Browse folder from system"
          >
            <FolderOpen size={15} />
            Browse...
          </button>
          <select
            value={newDirectoryAccess}
            onChange={(e) => setNewDirectoryAccess(e.target.value as 'read' | 'read-write')}
            className="bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white/80 focus:outline-none focus:border-emerald-500/50"
          >
            <option value="read-write">Read & Write</option>
            <option value="read">Read Only</option>
          </select>
          <label className="flex items-center gap-2 bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white/80 cursor-pointer">
            <input
              type="checkbox"
              checked={newDirectoryRecursive}
              onChange={(e) => setNewDirectoryRecursive(e.target.checked)}
              className="accent-emerald-500"
            />
            Recursive
          </label>
          <button
            onClick={addDirectoryToAllowlist}
            disabled={!newDirectoryPath.trim()}
            className="px-4 py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-xl text-sm text-emerald-300 font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <FolderPlus size={16} />
            Add
          </button>
        </div>

        {directoryError && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">
            {directoryError}
          </div>
        )}

        <div className="space-y-2">
          {allowedDirectories.map((dir) => (
            <div
              key={dir.path}
              className="flex items-center justify-between bg-black/20 border border-white/5 rounded-xl px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <FolderOpen size={16} className="text-emerald-400/60 flex-shrink-0" />
                <div className="min-w-0">
                  <code className="text-sm text-white/80 font-mono truncate block">{dir.path}</code>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      dir.access === 'read-write'
                        ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                        : 'text-amber-300 bg-amber-500/10 border-amber-500/20'
                    }`}>
                      {dir.access === 'read-write' ? 'Read & Write' : 'Read Only'}
                    </span>
                    {dir.recursive && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border text-sky-300 bg-sky-500/10 border-sky-500/20">
                        Recursive
                      </span>
                    )}
                    {dir.grantedVia && dir.grantedVia !== 'default' && (
                      <span className="text-[10px] text-white/30">
                        via {dir.grantedVia}
                        {dir.grantedAt > 0 && ` · ${new Date(dir.grantedAt).toLocaleDateString()}`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => removeDirectoryFromAllowlist(dir.path)}
                className="p-2 hover:bg-red-500/10 rounded-lg transition-all flex-shrink-0"
                title="Remove directory"
              >
                <Trash2 size={14} className="text-red-400/60 hover:text-red-400" />
              </button>
            </div>
          ))}
          {allowedDirectories.length === 0 && (
            <div className="text-xs text-white/40 text-center py-4">
              No directories in allowlist. Add a directory to grant AI access.
            </div>
          )}
        </div>

        <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 mt-4">
          <div className="flex items-start gap-3">
            <Shield size={16} className="text-blue-400 mt-0.5" />
            <div>
              <h5 className="text-blue-300 font-bold text-xs mb-1">How Directory Access Works</h5>
              <ul className="text-blue-200/70 text-[11px] space-y-0.5">
                <li>• Paths are resolved via realpath before checking — symlinks and traversal (../) are followed to their real target.</li>
                <li>• <strong>Read Only</strong> grants can view files but cannot write, delete, or move them.</li>
                <li>• When the AI needs a directory not on this list, it will ask you first (Allow Once / Allow Always / Deny).</li>
                <li>• Revoking a directory here immediately removes access — no caching layer holds stale permissions.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <Settings2 size={18} className="text-blue-400 mt-0.5" />
          <div>
            <h5 className="text-blue-300 font-bold mb-1">How The Security Manager Works</h5>
            <ul className="text-blue-200/70 text-sm space-y-1">
              <li>• Low risk covers read-only and navigation-oriented AI actions.</li>
              <li>• Medium risk covers interactive actions like clicking, form fill, open app, volume, and brightness.</li>
              <li>• High risk stays manual and is reserved for shell execution and destructive workflows.</li>
              <li>• Per-action toggles add narrow exceptions on top of the global low and medium policies.</li>
            </ul>
          </div>
        </div>
      </div>

      {isMac && (
        <div className="bg-white/5 rounded-3xl p-6 border border-white/10">
          <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Lock size={18} className="text-white/60" />
            macOS System Permissions
          </h4>

          <div className="grid gap-3">
            <div className="bg-white/5 rounded-2xl p-4 border border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Monitor size={20} className="text-red-400" />
                <div>
                  <span className="text-white font-medium">Screen Recording</span>
                  <p className="text-white/40 text-xs">Needed for screenshots and OCR workflows.</p>
                </div>
              </div>
              <button
                onClick={() => openSystemSettings('screen')}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm text-white transition-all"
              >
                Configure
              </button>
            </div>

            <div className="bg-white/5 rounded-2xl p-4 border border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Terminal size={20} className="text-purple-400" />
                <div>
                  <span className="text-white font-medium">Automation</span>
                  <p className="text-white/40 text-xs">Needed for shell commands and cross-app control.</p>
                </div>
              </div>
              <button
                onClick={() => openSystemSettings('automation')}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm text-white transition-all"
              >
                Configure
              </button>
            </div>

            <div className="bg-white/5 rounded-2xl p-4 border border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Lock size={20} className="text-sky-400" />
                <div>
                  <span className="text-white font-medium">Accessibility</span>
                  <p className="text-white/40 text-xs">Needed for screen clicks, OCR click, and native automation.</p>
                </div>
              </div>
              <button
                onClick={() => openSystemSettings('accessibility')}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm text-white transition-all"
              >
                Configure
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PermissionSettings;
