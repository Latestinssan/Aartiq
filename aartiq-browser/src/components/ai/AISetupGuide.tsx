"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sparkles, Cloud, Cpu, Shield, Key, 
  ChevronRight, ChevronLeft, ExternalLink, 
  Check, Wifi, Info, Globe, AlertCircle, Download, X, Monitor,
  Server, Copy, Loader2, CheckCircle2, RefreshCw
} from 'lucide-react';

import { useAppStore } from '@/store/useAppStore';
import { buildMcpSseUrl as mcpSseUrl } from '@/lib/mcp-bridge-url';

interface AISetupGuideProps {
  onClose: () => void;
  onComplete: () => void;
}

type TaskSummary = {
  id: string;
  name?: string;
  schedule?: string;
  description?: string;
  enabled?: boolean;
};

const featureHighlights = [
  { title: 'Autonomous Agents', detail: 'Chain reasoning + exploration with action logs that keep you informed.', icon: <Sparkles size={16} className="text-deep-space-accent-neon" /> },
  { title: 'Triple-lock Security', detail: 'Every automation asks for confirmation unless you remember the choice.', icon: <Shield size={16} className="text-white/70" /> },
  { title: 'Unified Workspace', detail: 'PDF exports, action logs, clipboard sync and downloads all in one cockpit.', icon: <Download size={16} className="text-sky-400" /> },
  { title: 'Local + Cloud', detail: 'Switch between Ollama, Gemini, OpenAI, Anthropic, or Groq instantly.', icon: <Cloud size={16} className="text-white/60" /> },
];

type ThemeOption = {
  id: 'system' | 'light' | 'dark';
  label: string;
  description: string;
  badge: string;
};

const themeOptions: ThemeOption[] = [
  { id: 'system', label: 'System Default', description: 'Follow macOS or Windows appearance automatically.', badge: 'Auto' },
  { id: 'light', label: 'Charm Light', description: 'Bright, glassy workspace inspired by the Charm palette.', badge: 'New' },
  { id: 'dark', label: 'Neural Night', description: 'Neon-on-black that you already know and love.', badge: 'Classic' },
];

const openExternal = async (url: string) => {
  if (window.electronAPI?.openExternalUrl) {
    await window.electronAPI.openExternalUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};

const AISetupGuide: React.FC<AISetupGuideProps> = ({ onClose, onComplete }) => {
  const {
    theme,
    setTheme,
    aiProvider,
    setAIProvider,
    openaiApiKey,
    geminiApiKey,
    anthropicApiKey,
    groqApiKey,
    xaiApiKey,
    ollamaBaseUrl,
  } = useAppStore();

  const [step, setStep] = useState(1);
  const totalSteps = 5;
  const [setupWarning, setSetupWarning] = useState<string | null>(null);
  const [automationTasks, setAutomationTasks] = useState<TaskSummary[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [selectedProviderForSetup, setSelectedProviderForSetup] = useState<string | null>(null);
  const [verifyingProvider, setVerifyingProvider] = useState<string | null>(null);
  const [providerVerification, setProviderVerification] = useState<Record<string, { success: boolean; message: string }>>({});

  // Claude MCP token-based state
  const [claudeMcpAutoStatus, setClaudeMcpAutoStatus] = useState<'idle'|'writing'|'done'|'error'>('idle');
  const [claudeMcpAutoResult, setClaudeMcpAutoResult] = useState<string>('');
  const [claudeMcpToken, setClaudeMcpToken] = useState<string>('');
  const [claudeMcpPhase, setClaudeMcpPhase] = useState<'idle'|'copy'|'wait'|'done'>('idle');

  useEffect(() => {
    if (claudeMcpPhase !== 'wait') return;
    if (!claudeMcpToken) return;
    const interval = setInterval(async () => {
      try {
        // Every route on the bridge requires the token, including this one.
        const res = await fetch('http://127.0.0.1:3001/pairing/status', {
          headers: { 'X-Aartiq-Token': claudeMcpToken },
        });
        if (!res.ok) return;
        const d = await res.json();
        if (d.paired) { setClaudeMcpPhase('done'); return clearInterval(interval); }
      } catch (e) {}
    }, 2000);
    const timer = setTimeout(() => { clearInterval(interval); }, 600000);
    return () => { clearInterval(interval); clearTimeout(timer); };
  }, [claudeMcpPhase, claudeMcpToken]);

  const isWindows = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /win/i.test(navigator.userAgent) || navigator.platform.toLowerCase().includes('win');
  }, []);

  const timezone = useMemo(() => {
    if (typeof Intl === 'undefined') return 'UTC';
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }, []);

  const providerSetupSteps: Record<string, { url: string; steps: string[] }> = {
    ollama: {
      url: 'https://ollama.com/download/',
      steps: [
        'Download Ollama from ollama.com/downloads for your OS',
        'Run the installer and wait for installation to complete',
        'Open Terminal and run: ollama run gpt-oss-cloud:120b',
        'Or run: ollama run llama3.3:70b (for faster local model)',
        'To enable network access: export OLLAMA_HOST=0.0.0.0',
        'Restart Ollama if needed. Aartiq connects to http://localhost:11434'
      ]
    },
    openai: {
      url: 'https://platform.openai.com/api-keys',
      steps: [
        'Go to platform.openai.com/api-keys',
        'Click "Create new secret key" button',
        'Name your key and set permissions',
        'Copy the key (starts with sk-)',
        'Paste it in the API key field above',
        'We recommend gpt-5.1 or gpt-4.1 for best results'
      ]
    },
    google: {
      url: 'https://aistudio.google.com/app/apikey',
      steps: [
        'Visit aistudio.google.com/app/apikey',
        'Click "Create API Key" button',
        'Select "Create API key in new project"',
        'Copy your API key (starts with AIza...)',
        'Paste in the API key field above',
        'Recommended: gemini-2.5-pro or gemini-2.5-flash'
      ]
    },
    anthropic: {
      url: 'https://console.anthropic.com/settings/keys',
      steps: [
        'Go to console.anthropic.com/settings/keys',
        'Click "Create Key" button',
        'Name your key and set organization',
        'Copy the key (starts with sk-ant-...)',
        'Paste in the API key field above',
        'Recommended: claude-sonnet-4-20250514 or claude-opus-4'
      ]
    },
    groq: {
      url: 'https://console.groq.com/keys',
      steps: [
        'Visit console.groq.com/keys',
        'Click "Create API Key" button',
        'Name your key (e.g., Aartiq)',
        'Copy the key (starts with gsk_...)',
        'Paste in the API key field above',
        'Recommended: llama-3.3-70b-versatile (ultra-fast LPU)'
      ]
    },
    xai: {
      url: 'https://console.x.ai/',
      steps: [
        'Go to console.x.ai/',
        'Click "Create API Key" in API Keys section',
        'Name your key and select permissions',
        'Copy the key (starts with xai-...)',
        'Paste in the API key field above',
        'Recommended: grok-4-fast-reasoning'
      ]
    },
    'azure-openai': {
      url: 'https://azure.microsoft.com/en-us/products/ai-services/openai-service',
      steps: [
        'Create Azure account at azure.com',
        'Create Azure OpenAI resource in your subscription',
        'Go to "Keys and Endpoint" in your resource',
        'Copy one of the keys and the endpoint URL',
        'Paste both in the API key and Base URL fields',
        'Deploy a model (gpt-4, gpt-4o) and use deployment name as model'
      ]
    },
    'google-flash': {
      url: 'https://aistudio.google.com/app/apikey',
      steps: [
        'Visit aistudio.google.com/app/apikey',
        'Click "Create API Key" button',
        'Select "Create API key in new project"',
        'Copy your API key (starts with AIza...)',
        'Paste in the API key field above',
        'Recommended: gemini-2.5-flash (fast & free tier available)'
      ]
    },
    'claude-mcp': {
      url: 'https://claude.ai/download',
      steps: [
        'Download Claude Desktop from claude.ai/download',
        'Click "Auto-Configure" below to write the config file',
        'Restart Claude Desktop after configuration',
        'Claude will connect to Aartiq via MCP bridge',
        'Verify the connection with the PIN code shown here'
      ]
    },

  };

  const verifyProviderConfig = async (providerId: string) => {
    setVerifyingProvider(providerId);
    try {
      let success = false;
      let message = '';
      
      if (providerId === 'ollama') {
        try {
          const res = await fetch(`${ollamaBaseUrl || 'http://localhost:11434'}/api/tags`);
          if (res.ok) {
            success = true;
            message = 'Ollama connected! Models available.';
          } else {
            message = 'Ollama not responding. Is it running?';
          }
        } catch (e) {
          message = 'Cannot connect to Ollama. Run "ollama start" first.';
        }
      } else if (providerId === 'google' || providerId === 'google-flash') {
        if (geminiApiKey && geminiApiKey.length > 5) {
          success = true;
          message = 'Gemini API key configured!';
        } else {
          message = 'Please add a valid Gemini API key.';
        }
      } else if (providerId === 'openai') {
        if (openaiApiKey && openaiApiKey.startsWith('sk-')) {
          success = true;
          message = 'OpenAI API key configured!';
        } else {
          message = 'Please add a valid OpenAI key (starts with sk-).';
        }
      } else if (providerId === 'anthropic') {
        if (anthropicApiKey && anthropicApiKey.startsWith('sk-ant-')) {
          success = true;
          message = 'Anthropic API key configured!';
        } else {
          message = 'Please add a valid Anthropic key (starts with sk-ant-).';
        }
      } else if (providerId === 'groq') {
        if (groqApiKey && groqApiKey.startsWith('gsk_')) {
          success = true;
          message = 'Groq API key configured!';
        } else {
          message = 'Please add a valid Groq key (starts with gsk_).';
        }
      } else if (providerId === 'xai') {
        if (xaiApiKey && xaiApiKey.startsWith('xai-')) {
          success = true;
          message = 'xAI API key configured!';
        } else {
          message = 'Please add a valid xAI key (starts with xai-).';
        }

      } else if (providerId === 'azure-openai') {
        success = true;
        message = 'Azure OpenAI configured!';
      } else if (providerId === 'claude-mcp') {
        if (claudeMcpPhase === 'done') {
          success = true;
          message = 'Claude Desktop MCP connected!';
        } else {
          message = 'Auto-configure Claude Desktop first.';
        }
      }
      
      setProviderVerification(prev => ({ ...prev, [providerId]: { success, message } }));
    } catch (e) {
      setProviderVerification(prev => ({ ...prev, [providerId]: { success: false, message: 'Verification failed' } }));
    }
    setVerifyingProvider(null);
  };

  const getProviderStatus = (providerId: string): 'configured' | 'missing' | 'invalid' => {
    if (providerId === 'ollama') {
      return ollamaBaseUrl ? 'configured' : 'missing';
    }
    if (providerId === 'google' || providerId === 'google-flash') {
      return geminiApiKey && geminiApiKey.length > 5 ? 'configured' : 'missing';
    }
    if (providerId === 'openai') {
      return openaiApiKey && openaiApiKey.startsWith('sk-') ? 'configured' : 'missing';
    }
    if (providerId === 'anthropic') {
      return anthropicApiKey && anthropicApiKey.startsWith('sk-ant-') ? 'configured' : 'missing';
    }
    if (providerId === 'groq') {
      return groqApiKey && groqApiKey.startsWith('gsk_') ? 'configured' : 'missing';
    }
    if (providerId === 'xai') {
      return xaiApiKey && xaiApiKey.startsWith('xai-') ? 'configured' : 'missing';
    }
    if (providerId === 'azure-openai') {
      return 'configured';
    }
    if (providerId === 'claude-mcp') {
      return claudeMcpPhase === 'done' ? 'configured' : 'missing';
    }
    return 'missing';
  };

  const isAiConfigured = useMemo(() => {
    // Check if the SPECIFICALLY SELECTED provider is actually configured
    if (aiProvider === 'ollama') return !!ollamaBaseUrl;
    if (aiProvider === 'openai') return !!openaiApiKey && openaiApiKey.length > 5;
    if (aiProvider === 'google' || aiProvider === 'gemini') return !!geminiApiKey && geminiApiKey.length > 5;
    if (aiProvider === 'anthropic') return !!anthropicApiKey && anthropicApiKey.length > 5;
    if (aiProvider === 'groq') return !!groqApiKey && groqApiKey.length > 5;
    if (aiProvider === 'xai') return !!xaiApiKey && xaiApiKey.length > 5;
    if (aiProvider === 'claude-mcp') return claudeMcpPhase === 'done';
    
    // Fallback: is anything at all configured?
    return !!(openaiApiKey || geminiApiKey || anthropicApiKey || groqApiKey || xaiApiKey || ollamaBaseUrl || claudeMcpPhase === 'done');
  }, [aiProvider, openaiApiKey, geminiApiKey, anthropicApiKey, groqApiKey, xaiApiKey, ollamaBaseUrl, claudeMcpPhase]);

  const loadAutomationTasks = useCallback(async () => {
    if (!window.electronAPI?.getScheduledTasks) return;
    setTasksLoading(true);
    try {
      const result = await window.electronAPI.getScheduledTasks();
      const tasks = Array.isArray(result)
        ? result
        : Array.isArray((result as any)?.tasks)
          ? (result as any).tasks
          : [];
      setAutomationTasks(tasks);
    } catch (error) {
      console.error('[Setup Guide] Failed to load automation tasks:', error);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAutomationTasks();
  }, [loadAutomationTasks]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    if (!window.electronAPI?.deleteScheduledTask) return;
    try {
      await window.electronAPI.deleteScheduledTask(taskId);
      await loadAutomationTasks();
    } catch (error) {
      console.error('[Setup Guide] Failed to delete task:', error);
    }
  }, [loadAutomationTasks]);

  const goToStep = (target: number) => {
    setSetupWarning(null);
    setStep(target);
  };

  const nextStep = () => goToStep(Math.min(step + 1, totalSteps));
  const prevStep = () => goToStep(Math.max(step - 1, 1));

  const handleThemeChange = (value: 'light' | 'dark' | 'system') => {
    setTheme(value);
    setSetupWarning(null);
  };

  const handleComplete = () => {
    if (!isAiConfigured) {
      goToStep(3);
      setSetupWarning(`Please configure your ${aiProvider} API key correctly so the AI has a brain before waking the agent.`);
      return;
    }
    setSetupWarning(null);
    onComplete();
  };

  const handleClose = () => {
    if (!isAiConfigured) {
      goToStep(3);
      setSetupWarning('Finish the provider setup so the AI has a brain before closing this guide.');
      return;
    }
    onClose();
  };

  const providers = [
    { 
      id: 'ollama', 
      name: 'Ollama (Local AI)', 
      url: 'https://ollama.com/download/', 
      icon: <Download size={16} className="text-sky-400" />, 
      desc: 'Private offline AI - Recommended for privacy',
      recommended: 'gpt-oss-cloud:120b (free, 120B params)'
    },
    { 
      id: 'google', 
      name: 'Google Gemini Pro', 
      url: 'https://aistudio.google.com/app/apikey', 
      icon: <Sparkles size={16} className="text-deep-space-accent-neon" />, 
      desc: 'Best reasoning + 1M token context',
      recommended: 'gemini-2.5-pro (auto-updated)'
    },
    { 
      id: 'google-flash', 
      name: 'Google Gemini Flash', 
      url: 'https://aistudio.google.com/app/apikey', 
      icon: <Sparkles size={16} className="text-cyan-400" />, 
      desc: 'Fast + free tier available',
      recommended: 'gemini-2.5-flash'
    },
    { 
      id: 'openai', 
      name: 'OpenAI (GPT-4/5)', 
      url: 'https://platform.openai.com/api-keys', 
      icon: <Cloud size={16} className="text-emerald-400" />, 
      desc: 'Industry standard reasoning',
      recommended: 'gpt-5.1'
    },
    { 
      id: 'anthropic', 
      name: 'Anthropic Claude', 
      url: 'https://console.anthropic.com/settings/keys', 
      icon: <Shield size={16} className="text-amber-400" />, 
      desc: 'Superior coding & analysis',
      recommended: 'claude-sonnet-4-20250514'
    },
    { 
      id: 'groq', 
      name: 'Groq (LPU)', 
      url: 'https://console.groq.com/keys', 
      icon: <Cpu size={16} className="text-orange-400" />, 
      desc: 'Ultra-fast inference - Free tier',
      recommended: 'llama-3.3-70b-versatile'
    },
    { 
      id: 'xai', 
      name: 'xAI Grok', 
      url: 'https://console.x.ai/', 
      icon: <Cpu size={16} className="text-purple-400" />, 
      desc: 'Real-time knowledge + wit',
      recommended: 'grok-4-fast-reasoning'
    },
    { 
      id: 'azure-openai', 
      name: 'Azure OpenAI', 
      url: 'https://azure.microsoft.com/en-us/products/ai-services/openai-service', 
      icon: <Cloud size={16} className="text-blue-400" />, 
      desc: 'Enterprise + compliance features',
      recommended: 'gpt-4.1-mini'
    },
    { 
      id: 'claude-mcp', 
      name: 'Claude Desktop (MCP)', 
      url: 'https://claude.ai/download', 
      icon: <Server size={16} className="text-violet-400" />, 
      desc: 'Connect Claude Desktop to control Aartiq via MCP',
      recommended: 'One-time PIN setup'
    },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="absolute inset-0 z-[100] bg-[#0d0d1a]/98 backdrop-blur-3xl p-8 flex flex-col border border-white/10 rounded-[2rem] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.8)]"
    >
      {/* Abstract Background Decor */}
      <div className="absolute -top-40 -left-40 w-80 h-80 bg-deep-space-accent-neon/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-80 h-80 bg-purple-500/5 blur-[120px] rounded-full pointer-events-none" />

      {/* Progress Header */}
        <div className="flex items-center justify-between mb-10 relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-deep-space-accent-neon/20 to-transparent border border-deep-space-accent-neon/20 flex items-center justify-center shadow-[0_0_20px_rgba(0,255,242,0.1)]">
            <Key size={24} className="text-deep-space-accent-neon" />
          </div>
          <div>
            <h2 className="text-base font-black uppercase tracking-[0.2em] text-white">Neural Setup</h2>
            <p className="text-[10px] text-white/30 uppercase tracking-[0.4em] font-black">NODE INITIALIZATION {step}/{totalSteps}</p>
          </div>
        </div>
        <button onClick={handleClose} className="w-10 h-10 rounded-full hover:bg-white/5 text-white/20 hover:text-white transition-all border border-white/5 flex items-center justify-center">
          <X size={20} />
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto modern-scrollbar pr-2 relative z-10">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              className="space-y-6"
            >
              <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/10 relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-sky-500/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <h3 className="text-sm font-black text-sky-400 mb-3 flex items-center gap-2 uppercase tracking-widest">
                  <Info size={16} /> Galactic Intelligence
                </h3>
                <p className="text-xs text-white/50 leading-relaxed font-medium">
                  Welcome to Aartiq. Build a mind that thinks in chains, stays secure, and owns your workspace. 
                  From action logs to PDF exports and automation, every outcome is traceable.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {featureHighlights.map((feature) => (
                  <div key={feature.title} className="p-5 rounded-3xl bg-black/40 border border-white/5 hover:border-sky-400/40 transition-all flex gap-4 items-start">
                    <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center text-sky-300">
                      {feature.icon}
                    </div>
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.3em] text-white/60 mb-1">{feature.title}</div>
                      <p className="text-[10px] text-white/40 leading-relaxed">{feature.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              className="space-y-6"
            >
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 mb-1">Design your Charm</div>
                <p className="text-[10px] text-white/50 leading-relaxed">
                  Pick the palette that matches your desk. Aartiq remembers your choice until you change it again.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {themeOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleThemeChange(option.id)}
                    className={`flex flex-col gap-2 p-4 rounded-3xl border transition-all text-left ${theme === option.id ? 'border-sky-400 bg-white/10 shadow-[0_15px_40px_rgba(56,189,248,0.25)]' : 'border-white/10 bg-white/5 hover:border-white/30'} `}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black uppercase tracking-[0.3em]">{option.label}</span>
                      <span className="text-[8px] font-black uppercase tracking-[0.4em] text-white/50">{option.badge}</span>
                    </div>
                    <p className="text-[10px] text-white/40 leading-relaxed">{option.description}</p>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              className="space-y-5"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">Configure AI Providers</p>
                <span className="text-[8px] font-black text-deep-space-accent-neon uppercase tracking-widest px-2 py-0.5 rounded-full bg-deep-space-accent-neon/5 border border-deep-space-accent-neon/20">All 8 Providers</span>
              </div>

              {/* Recommended Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-500/10 to-sky-500/10 border border-purple-500/20">
                <div className="flex items-center gap-3 mb-2">
                  <Sparkles size={16} className="text-purple-400" />
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white">Recommended: Ollama + gpt-oss-cloud:120b</span>
                </div>
                <p className="text-[9px] text-white/50 leading-relaxed">
                  120B parameter open-source model with reasoning capabilities - completely free and runs locally on your machine. 
                  <button 
                    onClick={() => { setAIProvider('ollama'); openExternal('https://ollama.com/download/'); }}
                    className="ml-2 text-sky-400 hover:underline"
                  >
                    Download Ollama →
                  </button>
                </p>
              </div>

              {/* Provider List with Status */}
              <div className="grid grid-cols-1 gap-3">
                {providers.map((p, idx) => {
                  const status = getProviderStatus(p.id);
                  const isConfigured = status === 'configured';
                  const isVerifying = verifyingProvider === p.id;
                  const verification = providerVerification[p.id];
                  const showSetup = selectedProviderForSetup === p.id;
                  const setupInfo = providerSetupSteps[p.id];
                  
                  return (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      key={p.id}
                      className={`rounded-2xl border transition-all ${isConfigured ? 'bg-green-500/5 border-green-500/20' : 'bg-white/[0.02] border-white/5'}`}
                    >
                      {/* Provider Header */}
                      <div className="flex items-center gap-3 p-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${isConfigured ? 'bg-green-500/10 border-green-500/30' : 'bg-black/40 border-white/5'}`}>
                          {isConfigured ? <Check size={18} className="text-green-400" /> : p.icon}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="text-[11px] font-black text-white uppercase tracking-widest">{p.name}</div>
                            {isConfigured && <span className="text-[8px] font-black bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">Ready</span>}
                            {aiProvider === p.id && <span className="text-[8px] font-black bg-deep-space-accent-neon/20 text-deep-space-accent-neon px-2 py-0.5 rounded-full">Active</span>}
                          </div>
                          <div className="text-[9px] text-white/30 font-medium uppercase tracking-tighter">{p.desc}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openExternal(p.url)}
                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[9px] font-black uppercase tracking-[0.2em] text-white/60 transition-all"
                          >
                            Get Key
                          </button>
                          <button
                            onClick={() => {
                              if (selectedProviderForSetup === p.id) {
                                setSelectedProviderForSetup(null);
                              } else {
                                setSelectedProviderForSetup(p.id);
                              }
                            }}
                            className={`px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-[0.2em] transition-all ${showSetup ? 'bg-white/10 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}
                          >
                            {showSetup ? 'Close' : 'Setup'}
                          </button>
                          <button
                            onClick={() => { setAIProvider(p.id); verifyProviderConfig(p.id); }}
                            disabled={isVerifying}
                            className="px-3 py-1.5 rounded-lg bg-deep-space-accent-neon/10 hover:bg-deep-space-accent-neon/20 border border-deep-space-accent-neon/20 text-deep-space-accent-neon text-[9px] font-black uppercase tracking-[0.2em] transition-all disabled:opacity-50"
                          >
                            {isVerifying ? 'Checking...' : 'Verify'}
                          </button>
                        </div>
                      </div>

                      {/* Recommended Model Tag */}
                      {p.recommended && (
                        <div className="px-4 pb-3">
                          <span className="text-[8px] text-sky-400/60 uppercase tracking-wider">
                            → {p.recommended}
                          </span>
                        </div>
                      )}

                      {/* Verification Message */}
                      {verification && (
                        <div className={`px-4 pb-3 text-[9px] ${verification.success ? 'text-green-400' : 'text-amber-400'}`}>
                          {verification.message}
                        </div>
                      )}

                      {/* Setup Guide Panel */}
                      {showSetup && setupInfo && (
                        <div className="border-t border-white/5 p-4 bg-black/20">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/40">Step-by-Step Setup</span>
                            <button onClick={() => openExternal(setupInfo.url)} className="text-[8px] text-sky-400 hover:underline flex items-center gap-1">
                              Open {setupInfo.url.replace('https://', '').split('/')[0]} <ExternalLink size={10} />
                            </button>
                          </div>
                          <ol className="space-y-2">
                            {setupInfo.steps.map((step, i) => (
                              <li key={i} className="flex items-start gap-2 text-[9px] text-white/50">
                                <span className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[8px] font-black text-white/60 flex-shrink-0">{i + 1}</span>
                                <span className="leading-relaxed">{step}</span>
                              </li>
                            ))}
                          </ol>

                          {/* Claude MCP: Auto-Configure + PIN */}
                          {p.id === 'claude-mcp' && (
                            <div className="mt-4 space-y-3">
                              <p className="text-[10px] text-white/40 leading-relaxed">
                                Auto-configure Claude Desktop to connect via MCP. After installing, restart Claude Desktop and Aartiq will auto-detect the connection.
                              </p>
                              <button
                                onClick={async () => {
                                  setClaudeMcpAutoStatus('writing');
                                  setClaudeMcpAutoResult('');
                                  try {
                                    if (window.electronAPI?.autoConfigureClaudeMcp) {
                                      const res = await window.electronAPI.autoConfigureClaudeMcp();
                                      if (res.success) {
                                        setClaudeMcpAutoStatus('done');
                                        setClaudeMcpAutoResult(res.path || 'Config written');
                                        // Generated by the bridge and returned over IPC. The
                                        // renderer no longer chooses it, so a page that can
                                        // reach port 3001 cannot pick the credential.
                                        const token = (res as any).token || '';
                                        setClaudeMcpToken(token);
                                        setClaudeMcpPhase('copy');
                                      } else {
                                        setClaudeMcpAutoStatus('error');
                                        setClaudeMcpAutoResult(res.error || 'Unknown error');
                                      }
                                    } else {
                                      setClaudeMcpAutoStatus('error');
                                      setClaudeMcpAutoResult('electronAPI not available');
                                    }
                                  } catch (e: any) {
                                    setClaudeMcpAutoStatus('error');
                                    setClaudeMcpAutoResult(e.message || 'Failed');
                                  }
                                }}
                                disabled={claudeMcpAutoStatus === 'writing'}
                                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border text-[10px] font-black uppercase tracking-[0.2em] transition-all disabled:opacity-70"
                                style={{
                                  background: claudeMcpAutoStatus === 'done' ? 'rgba(34,197,94,0.1)' : claudeMcpAutoStatus === 'error' ? 'rgba(239,68,68,0.1)' : 'var(--accent)',
                                  borderColor: claudeMcpAutoStatus === 'done' ? 'rgba(34,197,94,0.3)' : claudeMcpAutoStatus === 'error' ? 'rgba(239,68,68,0.3)' : 'transparent',
                                  color: claudeMcpAutoStatus === 'done' ? '#22c55e' : claudeMcpAutoStatus === 'error' ? '#ef4444' : 'var(--primary-bg)',
                                }}
                              >
                                {claudeMcpAutoStatus === 'writing' ? (
                                  <><Loader2 size={14} className="animate-spin" /> Writing config...</>
                                ) : claudeMcpAutoStatus === 'done' ? (
                                  <><CheckCircle2 size={14} /> Config installed! Restart Claude Desktop</>
                                ) : claudeMcpAutoStatus === 'error' ? (
                                  <><AlertCircle size={14} /> Failed: {claudeMcpAutoResult || 'Retry'}</>
                                ) : (
                                  <><Sparkles size={14} /> Auto-Configure Now</>
                                )}
                              </button>

                              {claudeMcpAutoStatus === 'error' && (
                                <button
                                  onClick={() => navigator.clipboard.writeText(JSON.stringify({
                                    mcpServers: { "aartiq-browser": { command: "npx", args: ["-y", "mcp-remote@0.1.17", mcpSseUrl(claudeMcpToken)] } }
                                  }, null, 2))}
                                  className="w-full flex items-center justify-center gap-1.5 p-2 rounded-xl border text-[9px] font-bold text-white/60 hover:text-white/80 transition-all"
                                  style={{ borderColor: 'var(--border-color)' }}
                                >
                                  <Copy size={12} /> Copy Config Manually
                                </button>
                              )}

                              {claudeMcpAutoStatus === 'done' && claudeMcpToken && (
                                <div className="p-3 rounded-xl bg-black/30 border border-white/5 space-y-3">
                                  {claudeMcpPhase === 'copy' && (
                                    <>
                                      <div className="text-xs font-bold uppercase tracking-wider text-white/40 mb-1">Step 2: Copy prompt</div>
                                      <p className="text-[9px] text-white/20 mb-2">Paste this into Claude Desktop after restart</p>
                                      <button
                                        onClick={() => {
                                          const prompt = `Hi! I'm connecting to Aartiq Browser running as a **local MCP server** on this machine. Here's what you need to know:

**About Aartiq Browser (Local MCP Server):**
Aartiq is an AI-native browser with OS automation running locally via MCP. You have access to 64+ tools including:
- Browser control (tabs, navigation, form filling, screenshots, PDF generation)
- System automation (shell commands, AppleScript, file operations)
- Clipboard management (view/copy/clear clipboard history, specify how many items to retrieve)
- Scheduling & automation (create cron/interval/one-time tasks, run shell commands, HTTP requests)
- AI features (send prompts, translate, summarize, generate documents)
- Settings control (open any settings section)
- App search & launch, volume/brightness control, alarms
- Web search and content extraction

**Security Model:**
- **Biometric approval** required for high-risk actions (Touch ID on macOS, Windows Hello on Windows)
- **Per-action approval prompts** for medium-risk operations (shell commands, file writes, clipboard access)
- **Low-risk actions** (reading tabs, navigation, search) auto-approved based on your preferences
- **Native OS integration** — approvals appear as native system dialogs, not web popups
- **Encrypted local vault** — API keys and tokens stored with 256-bit encryption, never leave this machine

**Connection Token:** ${claudeMcpToken}

Please call the confirm_pairing tool with the following token to verify the Aartiq Browser MCP connection.`;
                                          navigator.clipboard.writeText(prompt);
                                          setClaudeMcpPhase('wait');
                                        }}
                                        className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border text-[10px] font-black uppercase tracking-[0.2em] transition-all hover:opacity-90"
                                        style={{
                                          background: 'rgba(139,92,246,0.15)',
                                          borderColor: 'rgba(139,92,246,0.3)',
                                          color: '#a78bfa',
                                        }}
                                      >
                                        <Copy size={14} /> Copy Prompt to Clipboard
                                      </button>
                                    </>
                                  )}
                                  {claudeMcpPhase === 'wait' && (
                                    <div className="flex items-center gap-2 text-[10px] text-violet-300">
                                      <Loader2 size={12} className="animate-spin" /> Waiting for Claude to confirm...
                                    </div>
                                  )}
                                  {claudeMcpPhase === 'done' && (
                                    <div className="py-4 text-center space-y-3">
                                      <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ type: 'spring', damping: 15, stiffness: 200 }}
                                        className="w-14 h-14 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center mx-auto"
                                      >
                                        <CheckCircle2 size={28} className="text-green-400" />
                                      </motion.div>
                                      <div>
                                        <p className="text-sm font-black text-green-400 uppercase tracking-wider">Successfully Connected!</p>
                                        <p className="text-[10px] text-white/40 mt-1">Claude Desktop is now connected to Aartiq Browser via MCP.</p>
                                      </div>
                                      <div className="flex items-center justify-center gap-2 text-[9px] text-white/30">
                                        <Server size={10} /> 64+ tools available to Claude
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>

              <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10 flex items-start gap-4">
                <Shield size={18} className="text-amber-500/60 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-500/60 leading-relaxed font-bold uppercase tracking-tight">
                  Aartiq vault secures your keys locally with 256-bit encryption. Your keys never leave this machine.
                </p>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-3 p-4 bg-sky-500/5 border border-sky-500/10 rounded-2xl">
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                  <Wifi size={20} className="text-sky-400" />
                </div>
                <div>
                  <h3 className="text-xs font-black text-white uppercase tracking-[0.2em]">Ollama Network Tunnel</h3>
                  <p className="text-[9px] text-sky-400/60 font-black uppercase tracking-widest">Configuration required</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3 group hover:border-sky-400/20 transition-all">
                  <div className="text-[10px] font-black text-white/40 uppercase tracking-widest flex items-center justify-between">
                    <span>1. Allow External Network</span>
                    <span className="text-[8px] bg-sky-500/20 px-2 py-0.5 rounded-full text-sky-400">Critical</span>
                  </div>
                  <p className="text-[10px] text-white/40 leading-relaxed font-medium">
                    To connect Aartiq's AI engine to your external Ollama node, expose the host:
                  </p>
                  <div className="bg-black/60 p-3 rounded-xl font-mono text-[10px] text-sky-300 border border-white/10 shadow-inner select-all">
                    export OLLAMA_HOST=0.0.0.0
                  </div>
                  <p className="text-[8px] text-sky-400/50 italic">Allows Aartiq to bridge through your router/network firewall.</p>
                </div>

                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3 group hover:border-sky-400/20 transition-all">
                  <div className="text-[10px] font-black text-white/40 uppercase tracking-widest flex items-center justify-between">
                    <span>2. Extreme Intelligence</span>
                    <span className="text-[8px] bg-purple-500/20 px-2 py-0.5 rounded-full text-purple-400">GPT-OSS 120B</span>
                  </div>
                  <p className="text-[10px] text-white/40 leading-relaxed font-medium">
                    Unlock elite reasoning with the 120B parameter "Free Cloud" model:
                  </p>
                  <div className="bg-black/60 p-3 rounded-xl font-mono text-[10px] text-purple-400 border border-white/10 shadow-inner select-all">
                    ollama run gpt-oss-cloud:120b
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/10 flex items-start gap-4">
                  <Info size={18} className="text-blue-400/60 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-blue-400/60 leading-relaxed font-bold uppercase tracking-tight">
                    Restart your machine or Ollama process to apply bridge settings.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">Active Automations</p>
                    <p className="text-[9px] text-white/50">Timezone detected: {timezone}</p>
                  </div>
                  <button onClick={loadAutomationTasks} className="text-[10px] font-black uppercase tracking-[0.3em] text-deep-space-accent-neon hover:text-white transition-colors">
                    Refresh
                  </button>
                </div>
                {tasksLoading ? (
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-xs font-medium text-white/50 flex items-center justify-center">
                    Loading tasks...
                  </div>
                ) : automationTasks.length === 0 ? (
                  <div className="p-5 rounded-2xl bg-black/30 border border-white/5 text-[10px] uppercase tracking-widest text-white/40 flex flex-col gap-2 items-center">
                    <Sparkles size={24} className="text-white/20" />
                    <span>No automations yet</span>
                    <span className="text-[8px] text-white/30">Ask the agent to schedule a task next.</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {automationTasks.map((task) => (
                      <div key={task.id} className="p-4 rounded-2xl border border-white/10 bg-white/[0.02]">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-black text-white truncate">{task.name || 'Scheduled Task'}</div>
                            <p className="text-[9px] text-white/40 uppercase tracking-[0.2em]">{task.schedule || 'Custom schedule'}</p>
                          </div>
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="text-[9px] font-black uppercase tracking-[0.3em] text-red-400 hover:text-red-200 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                        {task.description && (
                          <p className="mt-2 text-[10px] text-white/50 leading-relaxed">{task.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div
              key="step5"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center space-y-8 py-10"
            >
              <div className="relative">
                <motion.div
                  animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5] }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute inset-0 bg-deep-space-accent-neon/20 blur-[40px] rounded-full"
                />
                <div className="w-24 h-24 rounded-full bg-deep-space-accent-neon/10 border-2 border-deep-space-accent-neon/30 flex items-center justify-center relative z-10 shadow-[0_0_50px_rgba(0,255,242,0.2)]">
                  <Sparkles size={48} className="text-deep-space-accent-neon" />
                </div>
              </div>

              <div className="text-center space-y-3">
                <h3 className="text-xl font-black text-white uppercase tracking-[0.3em]">Synapse Ready</h3>
                <p className="text-xs text-white/30 max-w-[320px] leading-relaxed mx-auto font-medium uppercase tracking-tighter">
                  Your AI brain is connected. We detected your timezone ({timezone}) and synced automations above.
                </p>
              </div>

              <button
                onClick={handleComplete}
                className="group relative px-10 py-4 rounded-2xl bg-deep-space-accent-neon text-black text-[11px] font-black uppercase tracking-[0.3em] overflow-hidden transition-all shadow-[0_10px_40px_rgba(0,255,242,0.2)] hover:shadow-[0_15px_60px_rgba(0,255,242,0.4)] hover:scale-105 active:scale-95"
              >
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative z-10">Wake Agent</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {setupWarning && (
          <div className="pt-6 text-[9px] uppercase tracking-[0.4em] text-amber-300 text-center">
            {setupWarning}
          </div>
        )}
      </div>

      {/* Navigation Footer */}
      <div className="pt-8 flex items-center justify-between gap-6 relative z-10 border-t border-white/5">
        <button 
          onClick={prevStep}
          disabled={step === 1}
          className={`group flex items-center gap-3 px-6 py-3 rounded-xl border border-white/5 text-[10px] font-black uppercase tracking-widest transition-all ${step === 1 ? 'opacity-0 cursor-default' : 'hover:bg-white/5 text-white/40 hover:text-white'}`}
        >
          <ChevronLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> Back
        </button>
        
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map(i => (
            <div 
              key={i} 
              className={`h-1 rounded-full transition-all duration-500 ${step === i ? 'w-8 bg-deep-space-accent-neon shadow-[0_0_10px_rgba(0,255,242,0.5)]' : 'w-2 bg-white/10'}`} 
            />
          ))}
        </div>

        <button 
          onClick={nextStep}
          disabled={step === totalSteps}
          className={`group flex items-center gap-3 px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest transition-all ${step === totalSteps ? 'opacity-0 cursor-default' : 'hover:bg-white/10 text-white'}`}
        >
          Next <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </motion.div>
  );
};

export default AISetupGuide;
