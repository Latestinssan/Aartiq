"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  KeyRound, ShieldCheck, ShieldAlert, CheckCircle2, Lock, Eye, EyeOff,
  Smartphone, RefreshCw, X, AlertCircle
} from 'lucide-react';

interface MasterPINSetupProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const MasterPINSetup: React.FC<MasterPINSetupProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [hasExistingPIN, setHasExistingPIN] = useState<boolean>(false);
  const [mode, setMode] = useState<'setup' | 'change' | 'verify'>('setup');
  const [oldPin, setOldPin] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const checkPinStatus = useCallback(async () => {
    try {
      if (typeof window !== 'undefined' && (window as any).electronAPI?.invoke) {
        const res = await (window as any).electronAPI.invoke('master-pin-has');
        setHasExistingPIN(!!res?.hasPIN);
        setMode(res?.hasPIN ? 'change' : 'setup');
      }
    } catch (e) {
      console.error('Failed to check Master PIN status:', e);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      checkPinStatus();
      setOldPin('');
      setPin('');
      setConfirmPin('');
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [isOpen, checkPinStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setErrorMessage('Master PIN must be exactly 6 numeric digits');
      return;
    }

    if (mode === 'setup' || mode === 'change') {
      if (pin !== confirmPin) {
        setErrorMessage('New PIN and confirmation do not match');
        return;
      }
    }

    if (mode === 'change' && (!oldPin || oldPin.length !== 6)) {
      setErrorMessage('Please enter your current 6-digit Master PIN');
      return;
    }

    setIsLoading(true);

    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI?.invoke) {
        throw new Error('Electron API not available');
      }

      if (mode === 'setup') {
        const res = await electronAPI.invoke('master-pin-setup', pin);
        if (!res?.success) {
          throw new Error(res?.error || 'Failed to setup Master PIN');
        }
        setSuccessMessage('Master PIN created! Use this same PIN on Aartiq Mobile for remote approvals.');
        setHasExistingPIN(true);
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 1500);
      } else if (mode === 'change') {
        const res = await electronAPI.invoke('master-pin-change', { oldPin, newPin: pin });
        if (!res?.success) {
          throw new Error(res?.error || 'Failed to change Master PIN');
        }
        setSuccessMessage('Master PIN updated successfully across desktop and paired mobile devices.');
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 1500);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="w-full max-w-md p-6 bg-[#0E0E1B] border border-white/10 rounded-2xl shadow-2xl overflow-hidden relative"
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>

          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <KeyRound size={22} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">
                {mode === 'setup' ? 'Setup Master PIN' : 'Change Master PIN'}
              </h3>
              <p className="text-xs text-white/50">
                Shared security secret for Desktop & Mobile approvals
              </p>
            </div>
          </div>

          {/* Information Notice */}
          <div className="p-3 mb-5 rounded-xl bg-cyan-950/30 border border-cyan-500/20 flex gap-2.5 text-xs text-cyan-200/80 leading-relaxed">
            <Smartphone size={16} className="text-cyan-400 shrink-0 mt-0.5" />
            <div>
              This 6-digit Master PIN is required on Aartiq Mobile (along with native Android screen lock) to authorize high-risk desktop automations remotely.
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Current PIN (if changing) */}
            {mode === 'change' && (
              <div>
                <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-1.5">
                  Current Master PIN
                </label>
                <div className="relative">
                  <input
                    type={showPin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={6}
                    value={oldPin}
                    onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••••"
                    className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-center text-lg tracking-[0.5em] text-white focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>
              </div>
            )}

            {/* New PIN */}
            <div>
              <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-1.5">
                {mode === 'change' ? 'New 6-Digit PIN' : 'Enter 6-Digit Master PIN'}
              </label>
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••••"
                  className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-center text-lg tracking-[0.5em] text-white focus:outline-none focus:border-cyan-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                >
                  {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Confirm PIN */}
            <div>
              <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-1.5">
                Confirm Master PIN
              </label>
              <input
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
                className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-center text-lg tracking-[0.5em] text-white focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>

            {/* Error & Success Messages */}
            {errorMessage && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
            {successMessage && (
              <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
                <CheckCircle2 size={14} className="shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 px-4 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-xl text-sm font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || pin.length !== 6 || (confirmPin.length !== 6)}
                className="flex-1 py-2.5 px-4 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:pointer-events-none text-black font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    <span>{mode === 'setup' ? 'Set Master PIN' : 'Save Changes'}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default MasterPINSetup;
