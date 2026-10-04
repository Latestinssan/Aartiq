import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { FolderLock, Terminal, X } from 'lucide-react';
import ClickPermissionModal from './ClickPermissionModal';
import {
  getActionPermissionKey,
  isActionAutoApproved,
  isIrreversibleCommand,
  getCommandDescription,
  normalizeActionType,
  normalizeRiskLevel,
  type ActionRiskLevel,
} from '@/lib/ai-action-security';
// The eligibility rule lives in the same module the main-process classifier
// reads, so the dialog cannot offer a grant the store would refuse to record.
import { alwaysApprovalEligibility } from '@/lib/shell-command-tiers';

interface PermissionContext {
  actionType: string;
  action: string;
  target?: string;
  what?: string;
  reason: string;
  risk: ActionRiskLevel;
  requiresDeviceUnlock?: boolean;
  affectedPaths?: string[];
  estimatedImpact?: string;
}

interface BatchCommandInfo {
  index: number;
  command: string;
  description: string;
  irreversible: boolean;
  risk: ActionRiskLevel;
  reason: string;
}

interface PendingPermission {
  resolve: (allowed: boolean) => void;
  context: PermissionContext;
  batchCommands?: BatchCommandInfo[];
}

interface PermissionRequestInput {
  actionType: string;
  action: string;
  target?: string;
  what?: string;
  reason: string;
  risk?: string;
}

async function getSecuritySettingsSafe() {
  try {
    return await window.electronAPI?.getSecuritySettings?.();
  } catch (error) {
    console.error('[AI Security] Failed to load security settings:', error);
    return null;
  }
}

interface DirectoryPermissionRequest {
  requestId: string;
  blockedPath: string;
  blockedPaths?: string[];
  command: string;
}

interface ShellPermissionRequest {
  requestId: string;
  command: string;
  reason?: string;
  riskLevel?: string;
}

export function useAIActionSecurityManager() {
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const pendingPermissionRef = useRef<PendingPermission | null>(null);
  const biometricVerifiedRef = useRef(false);
  const batchResolveRef = useRef<((allowed: boolean[]) => void) | null>(null);
  const batchInputsLengthRef = useRef(0);
  const [dirPermissionRequest, setDirPermissionRequest] = useState<DirectoryPermissionRequest | null>(null);
  const [dirPermissionLoading, setDirPermissionLoading] = useState(false);
  const [shellPermissionRequest, setShellPermissionRequest] = useState<ShellPermissionRequest | null>(null);
  const [shellPermissionLoading, setShellPermissionLoading] = useState(false);

  // Whether "Always Allow" is offered for the command awaiting a decision.
  // A grant is withheld for network-capable, script-capable and destructive
  // commands, and for anything with a URL in its arguments.
  const shellAlwaysVerdict = useMemo(
    () => alwaysApprovalEligibility(shellPermissionRequest?.command ?? ''),
    [shellPermissionRequest?.command],
  );
  const shellAlwaysAllowed = Boolean(shellPermissionRequest) && shellAlwaysVerdict.eligible;
  const shellAlwaysReason = shellAlwaysVerdict.reason;

  // Keep ref in sync with state
  useEffect(() => {
    pendingPermissionRef.current = pendingPermission;
  }, [pendingPermission]);

  useEffect(() => {
    if (!window.electronAPI?.onDirectoryPermissionRequest) return;
    const unsubDir = window.electronAPI.onDirectoryPermissionRequest((req) => {
      setDirPermissionRequest(req);
    });
    return () => unsubDir();
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onShellPermissionRequest) return;
    const unsubShell = window.electronAPI.onShellPermissionRequest((req) => {
      setShellPermissionRequest(req);
    });
    return () => unsubShell();
  }, []);

  const requestPermission = useCallback(async (input: PermissionRequestInput): Promise<boolean> => {
    const actionType = normalizeActionType(input.actionType);
    const risk = normalizeRiskLevel(input.risk);
    const permissionKey = getActionPermissionKey(actionType, input.target, input.what);

    if (risk !== 'high' && window.electronAPI?.permCheck) {
      const existingPermission = await window.electronAPI.permCheck(permissionKey);
      if (existingPermission?.granted) {
        return true;
      }
    }

    const settings = await getSecuritySettingsSafe();
    if (isActionAutoApproved(settings, actionType, risk)) {
      if (risk === 'low' && settings?.requireBiometricEveryTime) {
        if (window.electronAPI?.authenticateBiometric) {
          const authResult = await window.electronAPI.authenticateBiometric(
            `Verify identity: ${input.action}`
          );
          if (!authResult?.success) return false;
        }
      } else if (risk === 'low' && settings?.requireBiometricPerSession && !biometricVerifiedRef.current) {
        if (window.electronAPI?.authenticateBiometric) {
          const authResult = await window.electronAPI.authenticateBiometric(
            'Verify identity for low-risk actions this session'
          );
          if (!authResult?.success) return false;
        }
        biometricVerifiedRef.current = true;
      }
      return true;
    }

    if (risk === 'low') {
      if (settings?.requireBiometricEveryTime && window.electronAPI?.authenticateBiometric) {
        const authResult = await window.electronAPI.authenticateBiometric(
          `Verify identity: ${input.action}`
        );
        return !!authResult?.success;
      }
      if (settings?.requireBiometricPerSession && !biometricVerifiedRef.current && window.electronAPI?.authenticateBiometric) {
        const authResult = await window.electronAPI.authenticateBiometric(
          'Verify identity for low-risk actions this session'
        );
        if (!authResult?.success) return false;
        biometricVerifiedRef.current = true;
        return true;
      }
    }

    const requiresDeviceUnlock = settings?.requireDeviceUnlockForManualApproval !== false;

    return new Promise((resolve) => {
      setPendingPermission({
        resolve,
        context: {
          actionType,
          action: input.action,
          target: input.target,
          what: input.what,
          reason: input.reason,
          risk,
          requiresDeviceUnlock: risk === 'high' ? true : requiresDeviceUnlock && risk !== 'low',
        },
      });
    });
  }, []);

  const requestBatchPermission = useCallback(async (inputs: PermissionRequestInput[]): Promise<boolean[]> => {
    if (inputs.length === 0) return [];
    if (inputs.length === 1) {
      const result = await requestPermission(inputs[0]);
      return [result];
    }

    const results = new Array<boolean>(inputs.length).fill(false);
    const enriched = await Promise.all(inputs.map(async (input) => {
      const actionType = normalizeActionType(input.actionType);
      const risk = normalizeRiskLevel(input.risk);
      const permissionKey = getActionPermissionKey(actionType, input.target, input.what);

      if (risk !== 'high' && window.electronAPI?.permCheck) {
        const existingPermission = await window.electronAPI.permCheck(permissionKey);
        if (existingPermission?.granted) return { ...input, actionType, risk, autoApproved: true as const };
      }

      const settings = await getSecuritySettingsSafe();
      if (isActionAutoApproved(settings, actionType, risk)) {
        if (risk === 'low' && settings?.requireBiometricEveryTime) {
          if (window.electronAPI?.authenticateBiometric) {
            const authResult = await window.electronAPI.authenticateBiometric(
              `Verify identity: ${input.action}`
            );
            if (!authResult?.success) return { ...input, actionType, risk, autoApproved: false as const };
          }
        } else if (risk === 'low' && settings?.requireBiometricPerSession && !biometricVerifiedRef.current) {
          if (window.electronAPI?.authenticateBiometric) {
            const authResult = await window.electronAPI.authenticateBiometric(
              'Verify identity for low-risk actions this session'
            );
            if (!authResult?.success) return { ...input, actionType, risk, autoApproved: false as const };
          }
          biometricVerifiedRef.current = true;
        }
        return { ...input, actionType, risk, autoApproved: true as const };
      }

      if (risk === 'low') {
        if (settings?.requireBiometricEveryTime && window.electronAPI?.authenticateBiometric) {
          const authResult = await window.electronAPI.authenticateBiometric(
            `Verify identity: ${input.action}`
          );
          return { ...input, actionType, risk, autoApproved: !!authResult?.success };
        }
        if (settings?.requireBiometricPerSession && !biometricVerifiedRef.current && window.electronAPI?.authenticateBiometric) {
          const authResult = await window.electronAPI.authenticateBiometric(
            'Verify identity for low-risk actions this session'
          );
          if (!authResult?.success) return { ...input, actionType, risk, autoApproved: false as const };
          biometricVerifiedRef.current = true;
          return { ...input, actionType, risk, autoApproved: true as const };
        }
      }

      return { ...input, actionType, risk, autoApproved: false as const };
    }));

    const pending = enriched.filter((e) => !e.autoApproved) as (PermissionRequestInput & { actionType: string; risk: ActionRiskLevel; autoApproved: false })[];
    if (pending.length === 0) return enriched.map(() => true);

    const settings = await getSecuritySettingsSafe();
    const requiresDeviceUnlock = settings?.requireDeviceUnlockForManualApproval !== false;

    return new Promise<boolean[]>((resolve) => {
      batchResolveRef.current = resolve;
      batchInputsLengthRef.current = inputs.length;

      setPendingPermission({
        resolve: (approved: boolean) => {
          batchResolveRef.current = null;
          if (!approved) {
            resolve(new Array<boolean>(inputs.length).fill(false));
          } else {
            resolve(new Array<boolean>(inputs.length).fill(true));
          }
        },
        context: {
          actionType: 'BATCH',
          action: `Batch Shell Commands (${pending.length})`,
          target: pending.map((p) => p.target || '').join('\n'),
          what: pending.map((p) => p.what || p.target || '').join('\n'),
          reason: `The AI wants to execute ${pending.length} shell commands.`,
          risk: 'medium',
          requiresDeviceUnlock,
        },
        batchCommands: pending.map((p) => ({
          index: enriched.indexOf(p),
          command: p.target || '',
          description: getCommandDescription(p.target || ''),
          irreversible: isIrreversibleCommand(p.target || ''),
          risk: p.risk,
          reason: p.reason,
        })),
      });
    });
  }, [requestPermission]);

  useEffect(() => {
    if (!window.electronAPI?.onAutomationShellApproval) {
      return;
    }

    const cleanup = window.electronAPI.onAutomationShellApproval(async (payload) => {
      const settings = await getSecuritySettingsSafe();
      const requiresDeviceUnlock = settings?.requireDeviceUnlockForManualApproval !== false;
      setPendingPermission({
        resolve: async (allowed: boolean) => {
          if (allowed && requiresDeviceUnlock && window.electronAPI?.authenticateBiometric) {
            const authResult = await window.electronAPI.authenticateBiometric(
              `Approve shell command: ${payload.command}`
            );
            if (authResult?.error === 'Authentication cancelled') {
              allowed = false;
            }
          }

          if (window.electronAPI?.respondAutomationShellApproval) {
            window.electronAPI.respondAutomationShellApproval({
              requestId: payload.requestId,
              allowed,
            });
          } else {
            window.electronAPI?.submitShellApprovalResponse?.(payload.requestId, allowed);
          }
          setPendingPermission(null);
        },
        context: {
          actionType: payload.actionType || 'SHELL_COMMAND',
          action: payload.action || 'Shell Command Approval',
          target: payload.command,
          what: payload.command,
          reason: payload.reason || 'An automated task needs to execute this shell command.',
          risk: normalizeRiskLevel(payload.risk),
          requiresDeviceUnlock,
        },
      });
    });

    return cleanup;
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onApprovalActionResolved) return;
    const cleanup = window.electronAPI.onApprovalActionResolved((data: { requestId: string; allowed: boolean }) => {
      if (!data.allowed) {
        setPendingPermission((prev) => {
          if (prev) { prev.resolve(false); }
          return null;
        });
        return;
      }
      setPendingPermission((prev) => {
        if (prev) { prev.resolve(true); }
        return null;
      });
    });
    return cleanup;
  }, []);

  // Listen for ticket-based approval requests from the main process
  useEffect(() => {
    if (!window.electronAPI?.onApprovalRequired) return;
    const cleanup = window.electronAPI.onApprovalRequired(async (ticket: {
      ticketId: string;
      action: string;
      params: Record<string, any>;
      metadata?: { riskLevel?: string; description?: string; approvalReason?: string };
      expiresAt: number;
    }) => {
      // Don't show approval UI if there's already a pending permission
      if (pendingPermissionRef.current) {
        // Auto-deny since user is already handling another approval
        await window.electronAPI?.denyTicket?.(ticket.ticketId, 'Another approval is pending');
        return;
      }

      const risk = (ticket.metadata?.riskLevel as 'low' | 'medium' | 'high') || 'medium';

      return new Promise<boolean>((resolve) => {
        const approve = async () => {
          resolve(true);
          await window.electronAPI?.approveTicket?.(ticket.ticketId);
        };

        const deny = async () => {
          resolve(false);
          await window.electronAPI?.denyTicket?.(ticket.ticketId, 'User denied');
        };

        pendingPermissionRef.current = {
          resolve: (allowed: boolean) => {
            if (allowed) {
              approve();
            } else {
              deny();
            }
          },
          context: {
            actionType: `TICKET:${ticket.action}`,
            action: ticket.metadata?.description || ticket.action.replace(/-/g, ' '),
            target: JSON.stringify(ticket.params || {}),
            what: ticket.metadata?.description || ticket.action.replace(/-/g, ' '),
            reason: ticket.metadata?.approvalReason || `Action "${ticket.action}" requires approval`,
            risk,
            requiresDeviceUnlock: risk === 'high',
          },
        };

        // Trigger re-render
        setPendingPermission(pendingPermissionRef.current);
      });
    });
    return cleanup;
  }, []);



  // Directory permission warning panel
  const directoryPermissionPanel = dirPermissionRequest ? (
    <div className="fixed inset-0 z-[10002] flex items-start justify-center overflow-y-auto py-6 px-4 bg-black/60 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 10 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="mx-auto max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] bg-[color-mix(in_srgb,var(--card-bg)_96%,transparent)] text-primary-text shadow-[0_24px_70px_rgba(0,0,0,0.28)] backdrop-blur-2xl"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-5">
          <div className="mb-5 flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-500">
              <FolderLock size={19} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-secondary-text">Allow Aartiq to</div>
              <h2 className="mt-0.5 text-lg font-semibold leading-tight text-primary-text">
                Access {(dirPermissionRequest.blockedPaths ?? [dirPermissionRequest.blockedPath]).length > 1
                  ? `${(dirPermissionRequest.blockedPaths ?? []).length} directories`
                  : 'restricted directory'}
              </h2>
              <div className="mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium text-red-500 bg-red-500/10 border-red-500/20">
                Outside allowed directories
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                window.electronAPI?.respondDirectoryPermission?.(dirPermissionRequest.requestId, false);
                setDirPermissionRequest(null);
              }}
              className="rounded-md p-2 text-secondary-text hover:bg-[color-mix(in_srgb,var(--primary-text)_8%,transparent)] hover:text-primary-text"
              title="Deny"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4">
            {/* Reason */}
            <div>
              <div className="mb-1 text-[12px] font-medium text-secondary-text">Reason</div>
              <p className="text-[14px] leading-relaxed text-primary-text">
                The AI wants to run a command that accesses {(dirPermissionRequest.blockedPaths ?? [dirPermissionRequest.blockedPath]).length > 1 ? 'paths' : 'a path'} outside the allowed directory list.
              </p>
            </div>

            {/* All blocked paths */}
            <div>
              <div className="mb-2 text-[12px] font-medium text-secondary-text">
                Blocked {(dirPermissionRequest.blockedPaths ?? [dirPermissionRequest.blockedPath]).length > 1 ? 'Paths' : 'Path'}
              </div>
              <div className="flex flex-col gap-1.5">
                {(dirPermissionRequest.blockedPaths ?? [dirPermissionRequest.blockedPath]).map((p) => (
                  <span
                    key={p}
                    className="block rounded-md bg-red-500/10 border border-red-500/20 px-2.5 py-1.5 font-mono text-[11px] text-red-400 break-all"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>

            {/* Command */}
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--border-color)_55%,transparent)]">
              <div className="px-3 py-2 text-[12px] text-secondary-text font-medium">Command</div>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-b-lg bg-black/30 px-3 pb-3 font-mono text-[11px] text-secondary-text">
                {dirPermissionRequest.command}
              </pre>
            </div>

            {/* Info */}
            <p className="text-[12px] leading-relaxed text-secondary-text">
              Granting access adds {(dirPermissionRequest.blockedPaths ?? [dirPermissionRequest.blockedPath]).length > 1 ? 'these directories' : 'this directory'} to the AI allowlist permanently. Manage in{' '}
              <strong className="text-primary-text">Settings › Permissions › Directory Allowlist</strong>.
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 border-t border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] p-5 pt-4">
          <button
            type="button"
            disabled={dirPermissionLoading}
            onClick={() => {
              window.electronAPI?.respondDirectoryPermission?.(dirPermissionRequest.requestId, false);
              setDirPermissionRequest(null);
            }}
            className="flex-1 rounded-lg border border-[color-mix(in_srgb,var(--border-color)_65%,transparent)] px-4 py-2.5 text-sm font-medium text-secondary-text hover:bg-[color-mix(in_srgb,var(--primary-text)_6%,transparent)] hover:text-primary-text"
          >
            Deny
          </button>
          <button
            type="button"
            disabled={dirPermissionLoading}
            onClick={async () => {
              setDirPermissionLoading(true);
              window.electronAPI?.respondDirectoryPermission?.(dirPermissionRequest.requestId, true);
              setDirPermissionRequest(null);
              setDirPermissionLoading(false);
            }}
            className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {dirPermissionLoading ? 'Granting…' : '✓ Grant Access'}
          </button>
        </div>
      </motion.div>
    </div>
  ) : null;

  const approvalModal = useMemo(() => {
    if (!pendingPermission) {
      return null;
    }

    const isBatch = !!pendingPermission.batchCommands && pendingPermission.batchCommands.length > 0;

    return (
      <div className="fixed inset-0 z-[10001] flex items-start justify-center overflow-y-auto py-6 px-4 bg-black/60 backdrop-blur-md">
        {isBatch ? (
          <ClickPermissionModal
            context={pendingPermission.context}
            batchCommands={pendingPermission.batchCommands}
            onAllowBatch={(allowedIndices) => {
              const commands = pendingPermission.batchCommands!;
              const result = new Array<boolean>(batchInputsLengthRef.current).fill(true);
              const selectedSet = new Set(allowedIndices);
              for (let i = 0; i < commands.length; i++) {
                if (!selectedSet.has(i)) {
                  result[commands[i].index] = false;
                }
              }
              batchResolveRef.current?.(result);
              batchResolveRef.current = null;
              setPendingPermission(null);
            }}
            onDeny={() => {
              pendingPermission.resolve(false);
              setPendingPermission(null);
            }}
          />
        ) : (
          <ClickPermissionModal
            context={pendingPermission.context}
            onAllow={async (alwaysAllow) => {
              try {
                const context = pendingPermission.context;

                if (context.risk !== 'high' && context.requiresDeviceUnlock && window.electronAPI?.authenticateBiometric) {
                  const authResult = await window.electronAPI.authenticateBiometric(
                    `Approve action: ${context.action}`
                  );
                  if (authResult?.error === 'Authentication cancelled') {
                    pendingPermission.resolve(false);
                    setPendingPermission(null);
                    return;
                  }
                }

                if (alwaysAllow && window.electronAPI?.permGrant && context.risk !== 'high') {
                  const permissionKey = getActionPermissionKey(context.actionType, context.target, context.what);
                  await window.electronAPI.permGrant(permissionKey, 'execute', context.action, false);

                  if (
                    context.actionType === 'SHELL_COMMAND' &&
                    window.electronAPI?.setAutoApprovalCommand &&
                    context.target
                  ) {
                    await window.electronAPI.setAutoApprovalCommand({
                      command: context.target,
                      enabled: true,
                    });
                  }
                }

                pendingPermission.resolve(true);
                setPendingPermission(null);
              } catch (e) {
                console.error('[AI Security] Error in approval handler:', e);
                pendingPermission.resolve(false);
                setPendingPermission(null);
              }
            }}
            onDeny={() => {
              pendingPermission.resolve(false);
              setPendingPermission(null);
            }}
          />
        )}
      </div>
    );
  }, [pendingPermission]);

  const shellPermissionPanel = shellPermissionRequest ? (
    <div className="fixed inset-0 z-[10002] flex items-start justify-center overflow-y-auto py-6 px-4 bg-black/60 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 10 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="mx-auto max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] bg-[color-mix(in_srgb,var(--card-bg)_96%,transparent)] text-primary-text shadow-[0_24px_70px_rgba(0,0,0,0.28)] backdrop-blur-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-5">
          {/* Header */}
          <div className="mb-5 flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-500">
              <Terminal size={19} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-secondary-text">Allow Aartiq to</div>
              <h2 className="mt-0.5 text-lg font-semibold leading-tight text-primary-text">Shell Command Execution</h2>
              <div className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                shellPermissionRequest.riskLevel === 'high'
                  ? 'text-red-500 bg-red-500/10 border-red-500/20'
                  : shellPermissionRequest.riskLevel === 'medium'
                    ? 'text-amber-500 bg-amber-500/10 border-amber-500/20'
                    : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
              }`}>
                {shellPermissionRequest.riskLevel === 'high' ? 'High risk' : shellPermissionRequest.riskLevel === 'medium' ? 'Needs approval' : 'Low risk'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                window.electronAPI?.respondShellPermission?.(shellPermissionRequest.requestId, false, false);
                setShellPermissionRequest(null);
              }}
              className="rounded-md p-2 text-secondary-text hover:bg-[color-mix(in_srgb,var(--primary-text)_8%,transparent)] hover:text-primary-text"
              title="Deny"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4">
            {/* Reason */}
            <div>
              <div className="mb-1 text-[12px] font-medium text-secondary-text">Reason</div>
              <p className="text-[14px] leading-relaxed text-primary-text">
                {shellPermissionRequest.reason || 'Command needs authorization before running in the sandboxed shell.'}
              </p>
            </div>

            {/* Command */}
            <div>
              <div className="mb-1 text-[12px] font-medium text-secondary-text">Command</div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 font-mono text-[12px] text-secondary-text">
                {shellPermissionRequest.command}
              </pre>
            </div>
          </div>
        </div>

        {/* Action buttons — Deny | Allow Once | Always Allow */}
        <div className="flex gap-2 border-t border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] p-5 pt-4">
          <button
            type="button"
            disabled={shellPermissionLoading}
            onClick={() => {
              window.electronAPI?.respondShellPermission?.(shellPermissionRequest.requestId, false, false);
              setShellPermissionRequest(null);
            }}
            className="flex-1 rounded-lg border border-[color-mix(in_srgb,var(--border-color)_65%,transparent)] px-4 py-2.5 text-sm font-medium text-secondary-text hover:bg-[color-mix(in_srgb,var(--primary-text)_6%,transparent)] hover:text-primary-text"
          >
            Deny
          </button>
          <button
            type="button"
            disabled={shellPermissionLoading}
            onClick={() => {
              setShellPermissionLoading(true);
              window.electronAPI?.respondShellPermission?.(shellPermissionRequest.requestId, true, false);
              setShellPermissionRequest(null);
              setShellPermissionLoading(false);
            }}
            className="flex-1 rounded-lg border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] disabled:opacity-50"
          >
            Allow Once
          </button>
          {shellAlwaysAllowed ? (
            <button
              type="button"
              disabled={shellPermissionLoading}
              onClick={() => {
                setShellPermissionLoading(true);
                window.electronAPI?.respondShellPermission?.(shellPermissionRequest.requestId, true, true);
                setShellPermissionRequest(null);
                setShellPermissionLoading(false);
              }}
              className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ✓ Always Allow
            </button>
          ) : (
            <div
              className="flex-1 rounded-lg border border-[color-mix(in_srgb,var(--border-color)_65%,transparent)] px-4 py-2.5 text-center text-[11px] leading-tight text-secondary-text/70"
              title="A permanent grant is not offered for this command. Commands that reach the network, run other applications, or change permissions would carry that authority into every later invocation you did not see."
            >
              Always Allow unavailable
              <span className="block text-[10px] opacity-70">
                {shellAlwaysReason === 'url-argument' ? 'the command takes a URL' : 'network- or script-capable command'}
              </span>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  ) : null;

  return {
    pendingPermission,
    requestPermission,
    requestBatchPermission,
    approvalModal,
    directoryPermissionPanel,
    shellPermissionPanel,
  };
}
