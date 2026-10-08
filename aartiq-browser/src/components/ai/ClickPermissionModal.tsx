import React, { memo, useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileWarning,
  Fingerprint,
  Lock,
  MousePointer2,
  QrCode,
  Search,
  Shield,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import type { ActionRiskLevel } from '@/lib/ai-action-security';

interface BatchCommandInfo {
  index: number;
  command: string;
  description: string;
  irreversible: boolean;
  risk: ActionRiskLevel;
  reason: string;
}

interface ClickPermissionModalProps {
  context?: {
    action: string;
    target?: string;
    reason: string;
    risk: ActionRiskLevel;
    actionType?: string;
    what?: string;
    requiresDeviceUnlock?: boolean;
    affectedPaths?: string[];
    estimatedImpact?: string;
    /** Present for TICKET:* actions; identifies the approval ticket. */
    ticketId?: string;
  };
  onAllow?: (alwaysAllow?: boolean) => void;
  onDeny: () => void;
  batchCommands?: BatchCommandInfo[];
  onAllowBatch?: (allowedIndices: number[]) => void;
}

const riskTone = {
  low: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20',
  medium: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
  high: 'text-red-600 bg-red-500/10 border-red-500/20',
  critical: 'text-rose-600 bg-rose-500/10 border-rose-500/20',
};

const actionIcon = (actionType?: string) => {
  if (actionType === 'SHELL_COMMAND') return <Terminal size={18} />;
  if (actionType === 'FIND_AND_CLICK' || actionType === 'WEB_SEARCH') return <Search size={18} />;
  if (actionType?.includes('CLICK') || actionType === 'FILL_FORM') return <MousePointer2 size={18} />;
  return <Zap size={18} />;
};

const humanAction = (action?: string, actionType?: string) => {
  if (action) return action;
  if (!actionType) return 'Perform an action';
  return actionType.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
};

function TechnicalDetails({ children, label = 'Show Technical Details' }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-[color-mix(in_srgb,var(--border-color)_55%,transparent)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2 text-[12px] text-secondary-text hover:text-primary-text"
        aria-expanded={open}
      >
        <span>{label}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 px-3 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DangerousActionNotice({ command, risk }: { command?: string; risk: ActionRiskLevel }) {
  const destructiveCommand = command && /^(rm\s+-rf|dd\s+|mkfs|format|fdisk)/i.test(command.trim());
  const pipedCommand = command && /[|>]/.test(command);
  if (risk !== 'high' && risk !== 'critical' && !destructiveCommand && !pipedCommand) return null;

  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-red-500">
        <FileWarning size={15} />
        {risk === 'high' || risk === 'critical' || destructiveCommand ? 'This action can modify or delete data' : 'This command redirects or pipes output'}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-secondary-text">
        Review the details before allowing Aartiq to continue.
      </p>
    </div>
  );
}

function HighRiskQrSection({
  qrImage,
  expectedPin,
  pinInput,
  setPinInput,
  pinVerified,
  setPinVerified,
  mobileApproved,
  qrLoading,
  qrError,
  phoneApprovalOnly = false,
}: {
  qrImage: string | null;
  expectedPin: string;
  pinInput: string;
  setPinInput: (val: string) => void;
  pinVerified: boolean;
  setPinVerified: (val: boolean) => void;
  mobileApproved: boolean;
  qrLoading: boolean;
  qrError: boolean;
  /** Remote-shell tickets: the phone scans THIS screen's QR and types the PIN
   *  shown here — the desktop enters nothing and cannot approve. */
  phoneApprovalOnly?: boolean;
}) {
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 space-y-4">
      <div className="flex items-center gap-2 text-[13px] font-medium text-red-500">
        <QrCode size={15} />
        Mobile QR + PIN verification required
      </div>
      <p className="text-[12px] leading-relaxed text-secondary-text">
        {phoneApprovalOnly
          ? 'Approve from your phone: scan this QR with Aartiq Mobile, then enter the PIN shown here on the phone.'
          : 'Scan the QR code with Aartiq Mobile, then enter the matching PIN to confirm this high-risk action.'}
      </p>

      {qrLoading && (
        <div className="flex items-center gap-2 text-[12px] text-secondary-text">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-500/30 border-t-red-500" />
          Generating QR code...
        </div>
      )}

      {!qrLoading && qrError && (
        <p className="text-[12px] text-amber-400">Could not generate QR code. Connect to mobile to approve.</p>
      )}

      {qrImage && (
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-xl border border-white/10 bg-white p-3">
            <img src={qrImage} alt="Scan with Aartiq Mobile" className="h-36 w-36" />
          </div>

          <div className="text-center">
            <div className="text-[10px] font-bold uppercase tracking-widest text-secondary-text">Device PIN</div>
            <div className="mt-1 font-mono text-2xl font-black tracking-[0.3em] text-primary-text">{expectedPin}</div>
          </div>

          {phoneApprovalOnly ? (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-500" />
              Waiting for your phone: scan this QR with Aartiq Mobile and enter the PIN shown above
            </div>
          ) : (
            <>
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] ${mobileApproved ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                {mobileApproved ? <Check size={14} /> : <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-500" />}
                {mobileApproved ? 'Mobile approval received!' : 'Waiting for mobile approval...'}
              </div>

              <div className="w-full max-w-xs space-y-1.5">
                <label className="text-[11px] font-medium text-secondary-text">Enter PIN to confirm</label>
                <input
                  type="password"
                  value={pinInput}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setPinInput(val);
                    if (val.length === expectedPin.length && expectedPin.length > 0) {
                      setPinVerified(val === expectedPin);
                    } else {
                      setPinVerified(false);
                    }
                  }}
                  disabled={false}
                  maxLength={expectedPin.length || 6}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  placeholder={`Enter ${expectedPin.length || 6}-digit PIN`}
                  className={`w-full rounded-lg border px-3 py-2.5 text-center font-mono text-sm font-semibold tracking-widest outline-none transition-colors ${
                    pinVerified
                      ? 'border-emerald-500/50 bg-emerald-500/5 text-emerald-400'
                      : pinInput.length === expectedPin.length
                        ? 'border-red-500/50 bg-red-500/5 text-red-400'
                        : 'border-white/20 bg-white/5 text-primary-text focus:border-[var(--accent)]'
                  }`}
                />
                {pinInput.length === expectedPin.length && !pinVerified && (
                  <p className="text-[11px] text-red-400">PIN does not match</p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SinglePermissionCard({
  context,
  onAllow,
  onDeny,
}: {
  context: NonNullable<ClickPermissionModalProps['context']>;
  onAllow: (alwaysAllow?: boolean) => void;
  onDeny: () => void;
}) {
  const [alwaysAllow, setAlwaysAllow] = useState(false);
  const actionName = humanAction(context.action, context.actionType);
  const isHighRisk = context.risk === 'high' || context.risk === 'critical';
  // A remote-shell ticket is approved from the PHONE (scan the desktop QR,
  // type the PIN shown here) — see action_approval_page on the paired side.
  // The desktop dialog only displays that QR and can deny; it must not offer
  // its own approve button, which would redeem the ticket without executing
  // anything and leave the phone's later confirm dead.
  const isRemoteShellTicket = context.actionType === 'TICKET:execute-shell-command';

  const [qrImage, setQrImage] = useState<string | null>(null);
  const [expectedPin, setExpectedPin] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinVerified, setPinVerified] = useState(false);
  const [mobileApproved, setMobileApproved] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState(false);

  const expectedPinRef = useRef('');
  const cleanupMobileListenerRef = useRef<(() => void) | null>(null);
  const actionIdRef = useRef(`${context.actionType || 'high-risk'}-${Date.now()}`);

  useEffect(() => {
    if (!isHighRisk) return;

    let cancelled = false;
    setQrLoading(true);
    setQrError(false);

    const actionId = actionIdRef.current;

    (async () => {
      try {
        const electronAPI = (window as any).electronAPI;
        // Remote-shell tickets render the TICKET's own QR (its PIN never
        // leaves the network — this screen is the only place it is shown);
        // other high-risk actions keep their per-action QR.
        const result = isRemoteShellTicket
          ? await electronAPI?.generateShellTicketQr?.(context.ticketId)
          : await electronAPI?.generateHighRiskQr?.(actionId);
        if (cancelled) return;

        if (result) {
          const parsed = typeof result === 'string' ? JSON.parse(result) : result;
          if (!cancelled) {
            if (parsed && parsed.error) {
              setQrError(true);
            } else {
              setQrImage(parsed.qrImage || null);
              setExpectedPin(parsed.pin || '');
              expectedPinRef.current = parsed.pin || '';
            }
          }
        } else {
          if (!cancelled) setQrError(true);
        }
      } catch (e) {
        console.warn('[PermissionModal] Failed to generate QR:', e);
        if (!cancelled) setQrError(true);
      } finally {
        if (!cancelled) setQrLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isHighRisk, context.actionType, context.ticketId, isRemoteShellTicket]);

  useEffect(() => {
    if (!isHighRisk || isRemoteShellTicket) return;

    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.onMobileApproveHighRisk) return;

    const cleanup = electronAPI.onMobileApproveHighRisk((data: { pin: string; id: string }) => {
      if (!data) return;
      const currentExpectedPin = expectedPinRef.current;
      if (currentExpectedPin && data.pin === currentExpectedPin && data.id) {
        setMobileApproved(true);
      }
    });

    cleanupMobileListenerRef.current = cleanup;

    return () => {
      cleanupMobileListenerRef.current?.();
      cleanupMobileListenerRef.current = null;
    };
  }, [isHighRisk, isRemoteShellTicket]);

  // Remote-shell tickets approve on the phone; this dialog only shows the QR
  // and can deny, so its approve affordance is never enabled.
  const canApprove = isRemoteShellTicket ? false : isHighRisk ? (mobileApproved && pinVerified) : true;
  const approveLabel = isHighRisk
    ? (!mobileApproved || !pinVerified)
      ? (!mobileApproved ? 'Scan QR on Mobile' : 'Enter PIN to Approve')
      : 'Approve (Verified)'
    : alwaysAllow
      ? 'Always Allow'
      : 'Allow Once';

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.shiftKey && event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        if (canApprove) {
          onAllow(false); // Triggers "Allow Once"
        }
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [canApprove, onAllow]);

  return (
    <PermissionShell>
      <div className="p-5">
        <div className="mb-5 flex items-start gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${riskTone[context.risk]}`}>
            {context.risk === 'high' || context.risk === 'critical' ? <Shield size={19} /> : actionIcon(context.actionType)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-secondary-text">Allow Aartiq to</div>
            <h2 className="mt-0.5 text-lg font-semibold leading-tight text-primary-text">{actionName}</h2>
            <div className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${riskTone[context.risk]}`}>
              {context.risk === 'high' || context.risk === 'critical'
                ? 'High risk — QR + PIN required'
                : context.risk === 'medium'
                  ? 'Needs approval'
                  : 'Low risk'}
            </div>
          </div>
          <button type="button" onClick={onDeny} className="rounded-md p-2 text-secondary-text hover:bg-[color-mix(in_srgb,var(--primary-text)_8%,transparent)] hover:text-primary-text" title="Deny">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-1 text-[12px] font-medium text-secondary-text">Reason</div>
            <p className="text-[14px] leading-relaxed text-primary-text">{context.reason}</p>
          </div>

          {context.what && context.what !== actionName && (
            <div>
              <div className="mb-1 text-[12px] font-medium text-secondary-text">Action</div>
              <p className="text-[14px] leading-relaxed text-primary-text">{context.what}</p>
            </div>
          )}

          {context.affectedPaths && context.affectedPaths.length > 0 && (
            <div>
              <div className="mb-2 text-[12px] font-medium text-secondary-text">Files</div>
              <div className="flex flex-wrap gap-1.5">
                {context.affectedPaths.map((path) => (
                  <span key={path} className="max-w-full truncate rounded-md bg-[color-mix(in_srgb,var(--primary-text)_6%,transparent)] px-2 py-1 font-mono text-[11px] text-secondary-text">
                    {path}
                  </span>
                ))}
              </div>
            </div>
          )}

          {context.estimatedImpact && (
            <div className="rounded-lg bg-[color-mix(in_srgb,var(--primary-text)_5%,transparent)] px-3 py-2 text-[12px] leading-relaxed text-secondary-text">
              {context.estimatedImpact}
            </div>
          )}

          <DangerousActionNotice command={context.target} risk={context.risk} />

          {isHighRisk && (
            <HighRiskQrSection
              qrImage={qrImage}
              expectedPin={expectedPin}
              pinInput={pinInput}
              setPinInput={setPinInput}
              pinVerified={pinVerified}
              setPinVerified={setPinVerified}
              mobileApproved={mobileApproved}
              qrLoading={qrLoading}
              qrError={qrError}
              phoneApprovalOnly={isRemoteShellTicket}
            />
          )}

          {context.requiresDeviceUnlock && context.risk !== 'high' && context.risk !== 'critical' && (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-3 py-3">
              <div className="flex items-center gap-2 text-[13px] font-medium text-primary-text">
                <Lock size={15} />
                Device unlock required
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-secondary-text">
                macOS, Windows, or Linux will ask you to verify before this runs.
              </p>
            </div>
          )}

          {context.target && (
            <TechnicalDetails>
              <div className="space-y-1">
                <div className="text-[11px] text-secondary-text">Target</div>
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-2 font-mono text-[11px] text-secondary-text">
                  {context.target}
                </pre>
              </div>
              <div className="grid grid-cols-[90px_1fr] gap-2 text-[11px] text-secondary-text">
                <span>Action type</span><span className="font-mono">{context.actionType || 'unknown'}</span>
                <span>Risk</span><span>{context.risk}</span>
                <span>Verification</span><span>{isHighRisk ? 'QR + PIN' : context.requiresDeviceUnlock ? 'Device unlock' : 'None'}</span>
              </div>
            </TechnicalDetails>
          )}
        </div>
      </div>

      {context.risk !== 'high' && (
        <label className="flex cursor-pointer items-center gap-3 border-t border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] px-5 py-3">
          <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${alwaysAllow ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[color-mix(in_srgb,var(--border-color)_80%,transparent)]'}`}>
            {alwaysAllow && <Check size={13} />}
          </span>
          <span className="text-[13px] text-secondary-text">Always allow this action</span>
          <input className="sr-only" type="checkbox" checked={alwaysAllow} onChange={(event) => setAlwaysAllow(event.target.checked)} />
        </label>
      )}

      <div className="flex gap-2 border-t border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] p-5 pt-4">
        <button
          type="button"
          onClick={onDeny}
          className="flex-1 rounded-lg border border-[color-mix(in_srgb,var(--border-color)_65%,transparent)] px-4 py-2.5 text-sm font-medium text-secondary-text hover:bg-[color-mix(in_srgb,var(--primary-text)_6%,transparent)] hover:text-primary-text"
        >
          Deny
        </button>
        {!isRemoteShellTicket && (
          <button
            type="button"
            onClick={() => onAllow(context.risk === 'high' || context.risk === 'critical' ? false : alwaysAllow)}
            disabled={!canApprove}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm ${
              canApprove
                ? 'bg-[var(--accent)]'
                : 'cursor-not-allowed bg-white/10 text-secondary-text/50'
            }`}
          >
            {approveLabel}
          </button>
        )}
      </div>
    </PermissionShell>
  );
}

function BatchPermissionCard({
  batchCommands,
  onAllowBatch,
  onDeny,
}: {
  batchCommands: BatchCommandInfo[];
  onAllowBatch: (indices: number[]) => void;
  onDeny: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(batchCommands.map((_, index) => index)));
  const selectedCount = selected.size;
  const anyIrreversible = batchCommands.some((command) => command.irreversible);

  const toggleIndex = (index: number) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.shiftKey && event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        if (selected.size > 0) {
          onAllowBatch(Array.from(selected));
        }
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [selected, onAllowBatch]);

  return (
    <PermissionShell wide>
      <div className="p-5">
        <div className="mb-5 flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-600">
            <Terminal size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-secondary-text">Allow Aartiq to</div>
            <h2 className="mt-0.5 text-lg font-semibold leading-tight text-primary-text">Run {batchCommands.length} commands</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-secondary-text">Needed to complete the automation.</p>
          </div>
          <button type="button" onClick={onDeny} className="rounded-md p-2 text-secondary-text hover:bg-[color-mix(in_srgb,var(--primary-text)_8%,transparent)] hover:text-primary-text" title="Deny">
            <X size={16} />
          </button>
        </div>

        {anyIrreversible && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-3">
            <div className="flex items-center gap-2 text-[13px] font-medium text-red-500">
              <AlertTriangle size={15} />
              Some commands may be destructive
            </div>
          </div>
        )}

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {batchCommands.map((command, index) => {
            const isSelected = selected.has(index);
            return (
              <button
                key={`${command.index}-${index}`}
                type="button"
                onClick={() => toggleIndex(index)}
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${isSelected ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]' : 'border-[color-mix(in_srgb,var(--border-color)_55%,transparent)] bg-transparent'}`}
              >
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${isSelected ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[color-mix(in_srgb,var(--border-color)_80%,transparent)]'}`}>
                  {isSelected && <Check size={13} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-primary-text">{command.description || 'Run command'}</span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-secondary-text">{command.reason}</span>
                </span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${riskTone[command.risk]}`}>{command.risk}</span>
              </button>
            );
          })}
        </div>

        <TechnicalDetails label="Show Commands">
          {batchCommands.map((command, index) => (
            <pre key={`${command.index}-raw-${index}`} className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-2 font-mono text-[11px] text-secondary-text">
              {command.command}
            </pre>
          ))}
        </TechnicalDetails>
      </div>

      <div className="flex gap-2 border-t border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] p-5 pt-4">
        <button
          type="button"
          onClick={onDeny}
          className="flex-1 rounded-lg border border-[color-mix(in_srgb,var(--border-color)_65%,transparent)] px-4 py-2.5 text-sm font-medium text-secondary-text hover:bg-[color-mix(in_srgb,var(--primary-text)_6%,transparent)] hover:text-primary-text"
        >
          Deny
        </button>
        <button
          type="button"
          onClick={() => onAllowBatch(Array.from(selected))}
          disabled={selectedCount === 0}
          className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          Allow {selectedCount > 0 ? selectedCount : ''}
        </button>
      </div>
    </PermissionShell>
  );
}

function PermissionShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 10 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={`mx-auto max-h-[88vh] w-full ${wide ? 'max-w-lg' : 'max-w-md'} overflow-y-auto rounded-2xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] bg-[color-mix(in_srgb,var(--card-bg)_96%,transparent)] text-primary-text shadow-[0_24px_70px_rgba(0,0,0,0.28)] backdrop-blur-2xl`}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </motion.div>
  );
}

const ClickPermissionModal = memo(function ClickPermissionModal(props: ClickPermissionModalProps) {
  const { context, onAllow, onDeny, batchCommands, onAllowBatch } = props;

  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDeny();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onAllow, onDeny]);

  if (batchCommands && batchCommands.length > 1 && onAllowBatch) {
    return <BatchPermissionCard batchCommands={batchCommands} onAllowBatch={onAllowBatch} onDeny={onDeny} />;
  }

  if (!context || !onAllow) return null;
  return <SinglePermissionCard context={context} onAllow={onAllow} onDeny={onDeny} />;
});

export default ClickPermissionModal;
