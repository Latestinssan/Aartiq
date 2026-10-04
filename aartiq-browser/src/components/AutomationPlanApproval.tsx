"use client";

import React, { memo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronRight,
  FolderOpen, Globe, Terminal, FileText, Brain, Zap, Lock, Eye, EyeOff,
  Clock, ArrowRight, Save, X, Smartphone
} from 'lucide-react';
import DeviceImage from './DeviceImage';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PlanOperation {
  id: string;
  type: string;
  description: string;
  target: string;
  risk: RiskLevel;
  details?: string;
  policyDenied?: boolean;
}

export interface AutomationPlan {
  taskName: string;
  taskType: string;
  operations: PlanOperation[];
  directories: string[];
  urls: string[];
  estimatedDuration: string;
  requiresNetwork: boolean;
  requiresFileAccess: boolean;
}

interface AutomationPlanApprovalProps {
  plan: AutomationPlan;
  onApprove: (options: { background: boolean; allowlistedDirs: string[] }) => void;
  onDeny: (reason?: string) => void;
  onModify: () => void;
  onClose: () => void;
}

const POLICY_VERDICT: Record<RiskLevel, { autoAction: 'allow' | 'approve' | 'deny'; label: string }> = {
  low: { autoAction: 'allow', label: 'Auto-allowed' },
  medium: { autoAction: 'approve', label: 'Requires approval' },
  high: { autoAction: 'approve', label: 'Requires approval' },
  critical: { autoAction: 'deny', label: 'Denied by policy' },
};

const RISK_COLORS: Record<RiskLevel, string> = {
  low: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  high: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  critical: 'text-red-400 bg-red-500/10 border-red-500/20',
};

const RISK_ICONS: Record<RiskLevel, React.ReactNode> = {
  low: <CheckCircle2 size={10} />,
  medium: <AlertTriangle size={10} />,
  high: <AlertTriangle size={10} />,
  critical: <XCircle size={10} />,
};

const DENIED_BADGE = 'text-red-400 bg-red-500/10 border-red-500/20';
const ALLOWED_BADGE = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
const NEEDS_APPROVAL_BADGE = 'text-amber-400 bg-amber-500/10 border-amber-500/20';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  navigate: <Globe size={10} />,
  click: null,
  fill_form: null,
  extract: <FileText size={10} />,
  screenshot: null,
  shell: <Terminal size={10} />,
  open_app: null,
  bookmark: null,
  pdf: <FileText size={10} />,
  search: <Globe size={10} />,
  default: <Zap size={10} />,
};

function getOperationIcon(type: string): React.ReactNode {
  return TYPE_ICONS[type] || TYPE_ICONS.default;
}

const ALLOWLIST_KEY = 'aartiq_automation_allowlist';

function getAllowlist(): string[] {
  try {
    const raw = localStorage.getItem(ALLOWLIST_KEY);
    if (raw) return JSON.parse(raw);
  } catch { }
  return [];
}

function saveAllowlist(dirs: string[]) {
  try {
    localStorage.setItem(ALLOWLIST_KEY, JSON.stringify([...new Set(dirs)]));
  } catch { }
}

const AutomationPlanApproval = memo(function AutomationPlanApproval({
  plan, onApprove, onDeny, onModify, onClose,
}: AutomationPlanApprovalProps) {
  const [expandedOps, setExpandedOps] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState(false);
  const [runInBackground, setRunInBackground] = useState(true);
  const [rememberDirs, setRememberDirs] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const [showDenyInput, setShowDenyInput] = useState(false);
  const [waitingMobileApproval, setWaitingMobileApproval] = useState(false);
  const [mobileError, setMobileError] = useState<string | null>(null);

  const criticalCount = plan.operations.filter(o => o.risk === 'critical').length;
  const highRiskCount = plan.operations.filter(o => o.risk === 'high').length;
  const medRiskCount = plan.operations.filter(o => o.risk === 'medium').length;
  const lowRiskCount = plan.operations.filter(o => o.risk === 'low').length;

  const handleApprove = useCallback(() => {
    const allowlisted = rememberDirs ? [...new Set([...getAllowlist(), ...plan.directories])] : getAllowlist();
    if (rememberDirs) saveAllowlist(allowlisted);
    onApprove({ background: runInBackground, allowlistedDirs: allowlisted });
  }, [plan.directories, rememberDirs, runInBackground, onApprove]);

  const handleRequestMobileApproval = useCallback(async () => {
    setWaitingMobileApproval(true);
    setMobileError(null);
    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI?.invoke) {
        throw new Error('Electron API unavailable');
      }

      const overallRisk = criticalCount > 0 ? 'critical' : highRiskCount > 0 ? 'high' : medRiskCount > 0 ? 'medium' : 'low';

      const response = await electronAPI.invoke('permission-relay-request-mobile', {
        taskName: plan.taskName,
        taskType: plan.taskType,
        riskLevel: overallRisk,
        operations: plan.operations.map(op => ({
          id: op.id,
          type: op.type,
          description: op.description,
          target: op.target,
          risk: op.risk,
          details: op.details,
          policyDenied: op.policyDenied,
        })),
        directories: plan.directories,
        urls: plan.urls,
        estimatedDuration: plan.estimatedDuration,
        requiresNetwork: plan.requiresNetwork,
        requiresFileAccess: plan.requiresFileAccess,
      });

      if (response?.approved) {
        const allowlisted = rememberDirs ? [...new Set([...getAllowlist(), ...plan.directories])] : getAllowlist();
        if (rememberDirs) saveAllowlist(allowlisted);
        onApprove({ background: runInBackground, allowlistedDirs: allowlisted });
      } else {
        setMobileError(response?.reason || 'Mobile approval was denied');
      }
    } catch (e: any) {
      setMobileError(e.message || 'Mobile relay failed');
    } finally {
      setWaitingMobileApproval(false);
    }
  }, [plan, criticalCount, highRiskCount, medRiskCount, rememberDirs, runInBackground, onApprove]);

  const handleDeny = useCallback(() => {
    onDeny(denyReason || undefined);
  }, [denyReason, onDeny]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
      className="rounded-xl border border-[color-mix(in_srgb,var(--border-color)_30%,transparent)] bg-[color-mix(in_srgb,var(--card-bg)_96%,transparent)] backdrop-blur-2xl overflow-hidden shadow-2xl w-full max-w-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-sky-400" />
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-secondary-text">Execution Plan</h3>
        </div>
        <button onClick={onClose} className="p-1 rounded-md hover:bg-white/10 text-secondary-text/50 hover:text-secondary-text transition-all">
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3 max-h-[70vh] overflow-y-auto modern-scrollbar">
        {/* Task name */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-secondary-text/40 uppercase tracking-wider font-medium">Task:</span>
          <span className="text-[11px] text-secondary-text font-medium truncate">{plan.taskName}</span>
        </div>

        {/* Risk summary */}
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06]">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-emerald-400/70 font-bold">{lowRiskCount}</span>
            <span className="text-[7px] text-secondary-text/40 uppercase">low</span>
          </div>
          {medRiskCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-amber-400/70 font-bold">{medRiskCount}</span>
              <span className="text-[7px] text-secondary-text/40 uppercase">medium</span>
            </div>
          )}
          {criticalCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-red-400/70 font-bold">{criticalCount}</span>
              <span className="text-[7px] text-secondary-text/40 uppercase">critical</span>
            </div>
          )}
          {highRiskCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-orange-400/70 font-bold">{highRiskCount}</span>
              <span className="text-[7px] text-secondary-text/40 uppercase">high</span>
            </div>
          )}
          <span className="text-[8px] text-secondary-text/30 ml-auto font-mono">{plan.estimatedDuration}</span>
        </div>

        {/* Operations */}
        <div>
          <button
            onClick={() => setExpandedOps(v => !v)}
            className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-secondary-text/50 hover:text-secondary-text transition-colors w-full text-left"
          >
            <motion.span animate={{ rotate: expandedOps ? 90 : 0 }}>
              <ChevronRight size={10} />
            </motion.span>
            {plan.operations.length} Operations
          </button>
          <AnimatePresence>
            {expandedOps && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-1.5 space-y-1">
                  {plan.operations.map((op) => {
                    const verdict = POLICY_VERDICT[op.risk];
                    const policyBadgeClass = verdict.autoAction === 'deny' ? DENIED_BADGE
                      : verdict.autoAction === 'allow' ? ALLOWED_BADGE
                      : NEEDS_APPROVAL_BADGE;
                    return (
                      <div key={op.id} className={`flex items-start gap-2 px-2 py-1.5 rounded-lg border ${op.policyDenied ? 'border-red-500/20 bg-red-500/5' : 'border-white/[0.04] bg-white/[0.02]'}`}>
                        <span className="mt-0.5 text-secondary-text/40 shrink-0">{getOperationIcon(op.type)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[9px] text-secondary-text/70 truncate">{op.description}</span>
                            <span className={`shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded text-[7px] font-bold uppercase border ${RISK_COLORS[op.risk]}`}>
                              {RISK_ICONS[op.risk]}
                              {op.risk}
                            </span>
                            <span className={`shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded text-[7px] font-bold uppercase border ${policyBadgeClass}`}>
                              {verdict.label}
                            </span>
                          </div>
                          <span className="text-[8px] text-secondary-text/30 font-mono truncate block">{op.target}</span>
                          {op.details && (
                            <span className="text-[8px] text-secondary-text/40 mt-0.5 block">{op.details}</span>
                          )}
                          {op.policyDenied && (
                            <span className="text-[7px] text-red-400/60 mt-0.5 block">Blocked by security policy — cannot execute</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Directories accessed */}
        {plan.directories.length > 0 && (
          <div>
            <button
              onClick={() => setExpandedDirs(v => !v)}
              className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-secondary-text/50 hover:text-secondary-text transition-colors w-full text-left"
            >
              <motion.span animate={{ rotate: expandedDirs ? 90 : 0 }}>
                <ChevronRight size={10} />
              </motion.span>
              <FolderOpen size={10} /> {plan.directories.length} Directories
            </button>
            <AnimatePresence>
              {expandedDirs && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-1.5 space-y-1">
                    {plan.directories.map((dir, i) => {
                      const isAllowlisted = getAllowlist().includes(dir);
                      return (
                        <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                          <FolderOpen size={9} className="text-secondary-text/40 shrink-0" />
                          <span className="text-[9px] text-secondary-text/60 font-mono truncate flex-1">{dir}</span>
                          {isAllowlisted && (
                            <span className="text-[7px] text-emerald-400/50 uppercase flex items-center gap-0.5">
                              <CheckCircle2 size={7} /> allowed
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* URLs accessed */}
        {plan.urls.length > 0 && (
          <div className="space-y-1">
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-secondary-text/50">
              <Globe size={10} /> {plan.urls.length} URL{plan.urls.length > 1 ? 's' : ''}
            </span>
            <div className="space-y-0.5">
              {plan.urls.map((url, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-0.5">
                  <Globe size={7} className="text-secondary-text/30 shrink-0" />
                  <span className="text-[8px] text-secondary-text/40 font-mono truncate">{url}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Options */}
        <div className="space-y-2 pt-1 border-t border-white/[0.06]">
          {/* Run in background */}
          <label className="flex items-center gap-2 cursor-pointer group">
            <div className="relative">
              <input
                type="checkbox"
                checked={runInBackground}
                onChange={() => setRunInBackground(v => !v)}
                className="sr-only"
              />
              <div className={`w-7 h-4 rounded-full transition-colors ${runInBackground ? 'bg-sky-500/40' : 'bg-white/[0.08]'}`}>
                <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${runInBackground ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Clock size={10} className="text-secondary-text/40" />
              <span className="text-[9px] text-secondary-text/70">Run in background</span>
            </div>
          </label>

          {/* Remember directories */}
          {plan.directories.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={rememberDirs}
                  onChange={() => setRememberDirs(v => !v)}
                  className="sr-only"
                />
                <div className={`w-7 h-4 rounded-full transition-colors ${rememberDirs ? 'bg-emerald-500/40' : 'bg-white/[0.08]'}`}>
                  <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${rememberDirs ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Save size={10} className="text-secondary-text/40" />
                <span className="text-[9px] text-secondary-text/70">Allowlist these directories</span>
              </div>
            </label>
          )}
        </div>

        {/* Risk warnings */}
        {plan.operations.some(o => o.policyDenied) && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <XCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-[9px] text-red-400/70">
              {plan.operations.filter(o => o.policyDenied).length} operation{plan.operations.filter(o => o.policyDenied).length > 1 ? 's' : ''} denied by policy and cannot be executed.
            </p>
          </div>
        )}

        {highRiskCount > 0 && !plan.operations.some(o => o.policyDenied) && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertTriangle size={12} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-[9px] text-red-400/70">
              {highRiskCount} high-risk operation{highRiskCount > 1 ? 's' : ''} detected. Review carefully before approving.
            </p>
          </div>
        )}

        {medRiskCount > 0 && runInBackground && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[9px] text-amber-400/70">
              Medium-risk operations will run without oversight in background mode.
            </p>
          </div>
        )}

        {/* Deny input */}
        {showDenyInput && (
          <div className="space-y-1.5">
            <textarea
              value={denyReason}
              onChange={e => setDenyReason(e.target.value)}
              placeholder="Reason for denying..."
              className="w-full px-2.5 py-1.5 text-[10px] bg-white/[0.05] border border-white/[0.08] rounded-lg text-secondary-text placeholder-secondary-text/30 resize-none focus:outline-none focus:border-red-400/30"
              rows={2}
            />
          </div>
        )}
        {/* Mobile Error Notice */}
        {mobileError && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px]">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            <span>{mobileError}</span>
          </div>
        )}

        {/* Waiting for Mobile Approval Overlay */}
        {waitingMobileApproval && (
          <div className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-400/30 text-cyan-200 text-[11px] flex items-center gap-3">
            <DeviceImage
              deviceType="phone"
              deviceImage="android-phone"
              size={42}
              isOnline={true}
              isPermanentSynced={true}
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <p className="font-bold text-white text-xs">Waiting for Mobile Approval...</p>
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              </div>
              <p className="text-[10px] text-cyan-200/70 mt-0.5">
                Permanent sync active. Confirm with Master PIN + Android Screen Lock on your phone.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-t border-white/[0.06]">
        <button
          onClick={showDenyInput ? handleDeny : () => setShowDenyInput(true)}
          disabled={waitingMobileApproval}
          className={`px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all ${
            showDenyInput
              ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
              : 'bg-white/[0.05] text-secondary-text/50 hover:text-secondary-text hover:bg-white/[0.08]'
          }`}
        >
          {showDenyInput ? 'Confirm Deny' : 'Deny'}
        </button>
        <button
          onClick={onModify}
          disabled={waitingMobileApproval}
          className="px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider rounded-lg bg-white/[0.05] text-secondary-text/50 hover:text-secondary-text hover:bg-white/[0.08] transition-all"
        >
          Modify
        </button>
        <button
          onClick={handleRequestMobileApproval}
          disabled={waitingMobileApproval}
          className="flex-1 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-all flex items-center justify-center gap-1 border border-cyan-500/30"
          title="Send approval request to paired mobile device (requires Master PIN + Android Screen Lock)"
        >
          <Smartphone size={10} /> Mobile
        </button>
        <button
          onClick={handleApprove}
          disabled={waitingMobileApproval}
          className="flex-1 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider rounded-lg bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 transition-all flex items-center justify-center gap-1"
        >
          <CheckCircle2 size={10} /> Approve
        </button>
      </div>
    </motion.div>
  );
});

export { getAllowlist, saveAllowlist };
export default memo(AutomationPlanApproval);
