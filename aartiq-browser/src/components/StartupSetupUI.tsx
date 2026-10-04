import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Check,
  ChevronLeft,
  Cloud,
  Cpu,
  Copy,
  ExternalLink,
  Key,
  Loader2,
  Minus,
  Monitor,
  MoonStar,
  Palette,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Square,
  SunMedium,
  Wifi,
  X,
  CheckCircle2,
} from 'lucide-react';

import { useAppVersion } from '@/lib/useAppVersion';
import { useAppStore } from '@/store/useAppStore';

type ThemeChoice = 'system' | 'light' | 'dark' | 'minimal' | 'vibrant';

const themeOptions: Array<{
  id: ThemeChoice;
  title: string;
  description: string;
  preview: string;
  icon: React.ReactNode;
}> = [
    {
      id: 'system',
      title: 'System',
      description: 'Follow the look of your operating system automatically.',
      preview: 'linear-gradient(135deg, #111827 0%, #f8fafc 100%)',
      icon: <Monitor size={16} />,
    },
    {
      id: 'light',
      title: 'Light',
      description: 'A bright, polished workspace for daytime research and docs.',
      preview: 'linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)',
      icon: <SunMedium size={16} />,
    },
    {
      id: 'dark',
      title: 'Dark',
      description: 'Minimal contrast-first theme for long sessions and focus.',
      preview: 'linear-gradient(135deg, #020617 0%, #0f172a 100%)',
      icon: <MoonStar size={16} />,
    },
    {
      id: 'minimal',
      title: 'Minimal',
      description: 'Stripped-back chrome with compact tabs and minimal UI.',
      preview: 'linear-gradient(135deg, #0D0F12 0%, #15191E 100%)',
      icon: <Sparkles size={16} />,
    },
    {
      id: 'vibrant',
      title: 'Vibrant',
      description: 'A richer gradient look that still keeps the UI disciplined.',
      preview: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)',
      icon: <Sparkles size={16} />,
    },
  ];

const providerCards = [
  {
    id: 'ollama',
    title: 'Local Ollama',
    description: 'Keep prompts and responses on your machine with local models.',
    cta: 'Connect Ollama',
    accent: 'from-sky-400/20 to-sky-400/5',
    link: 'https://ollama.com/download',
    type: 'local'
  },
  {
    id: 'openai',
    title: 'OpenAI API',
    description: 'Connect GPT-4o and GPT-4 for strong general chat and coding.',
    cta: 'Connect OpenAI',
    accent: 'from-violet-400/18 to-violet-400/5',
    link: 'https://platform.openai.com/api-keys',
    type: 'cloud'
  },
  {
    id: 'google',
    title: 'Gemini API',
    description: 'Best cloud reasoning with huge context windows (up to 2M).',
    cta: 'Connect Gemini',
    accent: 'from-emerald-400/18 to-emerald-400/5',
    link: 'https://aistudio.google.com/app/apikey',
    type: 'cloud'
  },
  {
    id: 'anthropic',
    title: 'Claude API',
    description: 'Superior coding, analysis, and human-like reasoning.',
    cta: 'Connect Claude',
    accent: 'from-amber-400/18 to-amber-400/5',
    link: 'https://console.anthropic.com/settings/keys',
    type: 'cloud'
  },
  {
    id: 'groq',
    title: 'Groq LPU',
    description: 'Ultra-fast inference (800+ tokens/sec) for instant responses.',
    cta: 'Connect Groq',
    accent: 'from-orange-400/18 to-orange-400/5',
    link: 'https://console.groq.com/keys',
    type: 'cloud'
  },
  {
    id: 'xai',
    title: 'xAI Grok',
    description: 'Real-time knowledge and powerful reasoning capabilities.',
    cta: 'Connect xAI',
    accent: 'from-rose-400/18 to-rose-400/5',
    link: 'https://console.x.ai/',
    type: 'cloud'
  },
  {
    id: 'azure-openai',
    title: 'Azure OpenAI',
    description: 'Enterprise-grade OpenAI models hosted on Microsoft Azure.',
    cta: 'Connect Azure',
    accent: 'from-blue-400/18 to-blue-400/5',
    link: 'https://azure.microsoft.com/en-us/products/ai-services/openai-service',
    type: 'cloud'
  },
  {
    id: 'claude-mcp',
    title: 'Claude Desktop (MCP)',
    description: 'Connect Claude Desktop to control Aartiq via MCP — 64+ tools for browsing, automation, and system control.',
    cta: 'Connect Claude MCP',
    accent: 'from-violet-400/18 to-violet-400/5',
    link: 'https://claude.ai/download',
    type: 'mcp'
  },
];



const openExternal = async (url: string) => {
  if (window.electronAPI?.openExternalUrl) {
    await window.electronAPI.openExternalUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};

export const StartupSetupUI = ({ onComplete }: { onComplete: () => void }) => {
  const store = useAppStore();
  const versionLabel = `v${useAppVersion()}`;
  const [isMac, setIsMac] = useState(false);
  const [step, setStep] = useState(1);
  const [wantsAI, setWantsAI] = useState(true);

  useEffect(() => {
    setIsMac(navigator.userAgent.toLowerCase().includes('mac'));
  }, []);

  const handleMinimize = () => window.electronAPI?.minimizeWindow();
  const handleMaximize = () => window.electronAPI?.maximizeWindow();
  const handleClose = () => window.electronAPI?.closeWindow();

  const isWindows = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /win/i.test(navigator.userAgent) || navigator.platform.toLowerCase().includes('win');
  }, []);

  const finishSetup = () => {
    store.setHasCompletedStartupSetup(true);
    onComplete();
  };

  const goNext = () => setStep((current) => {
    if (current === 3 && wantsAI && !verifiedProvider) return current;
    if (current === 3 && wantsAI && verifiedProvider) {
      store.setAIProvider(verifiedProvider);
    }
    return Math.min(current + 1, 4);
  });
  const goBack = () => setStep((current) => Math.max(current - 1, 1));

  const [activeProviderSetup, setActiveProviderSetup] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationSuccess, setVerificationSuccess] = useState<string | null>(null);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [verifiedProvider, setVerifiedProvider] = useState<string | null>(null);

  // Claude MCP state
  const [mcpAutoStatus, setMcpAutoStatus] = useState<'idle'|'writing'|'done'|'error'>('idle');
  const [mcpAutoResult, setMcpAutoResult] = useState('');
  const [mcpToken, setMcpToken] = useState<string>('');
  const [mcpPhase, setMcpPhase] = useState<'idle'|'copy'|'wait'|'done'>('idle');

  useEffect(() => {
    if (mcpPhase !== 'wait') return;
    if (!mcpToken) return;
    const interval = setInterval(async () => {
      try {
        // Every route on the bridge requires the token, including this one.
        const res = await fetch('http://127.0.0.1:3001/pairing/status', {
          headers: { 'X-Aartiq-Token': mcpToken },
        });
        if (!res.ok) return;
        const d = await res.json();
        if (d.paired) { setMcpPhase('done'); return clearInterval(interval); }
      } catch (e) {}
    }, 2000);
    const timer = setTimeout(() => { clearInterval(interval); }, 600000);
    return () => { clearInterval(interval); clearTimeout(timer); };
  }, [mcpPhase, mcpToken]);

  const testChatCompletion = async (
    url: string,
    body: Record<string, any>,
    headers: Record<string, string> = {}
  ): Promise<any> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`API error (${res.status}): ${errBody.slice(0, 200)}`);
    }
    return res.json();
  };

  const extractTextAndCheck = (responseText: string): void => {
    if (!responseText.includes('246')) {
      throw new Error(`Model gave wrong answer. Expected "246", got: "${responseText.trim().slice(0, 120)}"`);
    }
  };

  const handleVerifyProvider = async (providerId: string) => {
    setVerifying(true);
    setVerificationError(null);
    setVerificationSuccess(null);
    setFetchedModels([]);

    try {
      if (providerId === 'ollama') {
        const url = store.ollamaBaseUrl || 'http://127.0.0.1:11434';
        const tagsRes = await fetch(`${url}/api/tags`);
        if (!tagsRes.ok) throw new Error('Ollama responded with an error. Is it running?');
        const tagsData = await tagsRes.json();
        const models = tagsData.models?.map((m: any) => m.name) || [];
        setFetchedModels(models);
        if (!models.length) throw new Error('No models found on Ollama server. Pull one first (e.g. llama3.2).');
        const model = store.ollamaModel || models[0];
        const chatData = await testChatCompletion(`${url}/api/chat`, {
          model, messages: [{ role: 'user', content: '123+123' }], stream: false,
        });
        extractTextAndCheck(chatData.message?.content || '');
        setVerifiedProvider(providerId);
        store.setAIProvider(providerId);
        setVerificationSuccess(`Ollama "${model}" connected and passed the math test!`);
        if (!store.ollamaModel) store.setOllamaModel(model);
      } else if (providerId === 'openai') {
        if (!store.openaiApiKey) throw new Error('API key is required');
        const modelsRes = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${store.openaiApiKey}` }
        });
        if (!modelsRes.ok) throw new Error('Invalid OpenAI API key.');
        const modelsData = await modelsRes.json();
        const models = modelsData.data?.filter((m: any) => m.id.includes('gpt')).map((m: any) => m.id) || [];
        setFetchedModels(models);
        const chatData = await testChatCompletion('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-4o-mini', messages: [{ role: 'user', content: '123+123' }], max_tokens: 50,
        }, { 'Authorization': `Bearer ${store.openaiApiKey}` });
        extractTextAndCheck(chatData.choices?.[0]?.message?.content || '');
        setVerifiedProvider(providerId);
        store.setAIProvider(providerId);
        setVerificationSuccess('OpenAI key verified and passed the math test!');
      } else if (providerId === 'groq') {
        if (!store.groqApiKey) throw new Error('API key is required');
        const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { 'Authorization': `Bearer ${store.groqApiKey}` }
        });
        if (!modelsRes.ok) throw new Error('Invalid Groq API key.');
        const modelsData = await modelsRes.json();
        const models = modelsData.data?.map((m: any) => m.id) || [];
        setFetchedModels(models);
        const chatData = await testChatCompletion('https://api.groq.com/openai/v1/chat/completions', {
          model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: '123+123' }], max_tokens: 50,
        }, { 'Authorization': `Bearer ${store.groqApiKey}` });
        extractTextAndCheck(chatData.choices?.[0]?.message?.content || '');
        setVerifiedProvider(providerId);
        store.setAIProvider(providerId);
        setVerificationSuccess('Groq key verified and passed the math test!');
      } else if (providerId === 'google') {
        if (!store.geminiApiKey) throw new Error('Gemini API key is required');
        const chatData = await testChatCompletion(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${store.geminiApiKey}`,
          { contents: [{ parts: [{ text: '123+123' }] }] }
        );
        extractTextAndCheck(chatData.candidates?.[0]?.content?.parts?.[0]?.text || '');
        setVerifiedProvider(providerId);
        store.setAIProvider(providerId);
        setVerificationSuccess('Gemini key verified and passed the math test!');
      } else if (providerId === 'anthropic') {
        if (!store.anthropicApiKey) throw new Error('Claude API key is required');
        const chatData = await testChatCompletion('https://api.anthropic.com/v1/messages', {
          model: 'claude-3-haiku-20240307', max_tokens: 50,
          messages: [{ role: 'user', content: '123+123' }],
        }, { 'x-api-key': store.anthropicApiKey, 'anthropic-version': '2023-06-01' });
        extractTextAndCheck(chatData.content?.[0]?.text || '');
        setVerifiedProvider(providerId);
        store.setAIProvider(providerId);
        setVerificationSuccess('Claude key verified and passed the math test!');
      } else if (providerId === 'xai') {
        if (!store.xaiApiKey) throw new Error('xAI API key is required');
        const chatData = await testChatCompletion('https://api.x.ai/v1/chat/completions', {
          model: 'grok-2', messages: [{ role: 'user', content: '123+123' }], max_tokens: 50,
        }, { 'Authorization': `Bearer ${store.xaiApiKey}` });
        extractTextAndCheck(chatData.choices?.[0]?.message?.content || '');
        setVerifiedProvider(providerId);
        store.setAIProvider(providerId);
        setVerificationSuccess('xAI key verified and passed the math test!');
      } else if (providerId === 'azure-openai') {
        if (!store.azureOpenaiApiKey) throw new Error('Azure API key is required');
        if (!store.azureOpenaiEndpoint) throw new Error('Azure endpoint is required');
        const model = store.azureOpenaiModel || 'gpt-4o-mini';
        const endpoint = store.azureOpenaiEndpoint.replace(/\/+$/, '');
        const chatData = await testChatCompletion(
          `${endpoint}/openai/deployments/${model}/chat/completions?api-version=2024-08-01-preview`,
          { messages: [{ role: 'user', content: '123+123' }], max_tokens: 50 },
          { 'api-key': store.azureOpenaiApiKey }
        );
        extractTextAndCheck(chatData.choices?.[0]?.message?.content || '');
        setVerifiedProvider(providerId);
        store.setAIProvider(providerId);
        setVerificationSuccess('Azure OpenAI key verified and passed the math test!');
      } else if (providerId === 'claude-mcp') {
        if (mcpPhase === 'done') {
          setVerifiedProvider(providerId);
          store.setAIProvider(providerId);
          setVerificationSuccess('Claude Desktop MCP connected!');
        } else {
          setVerificationError('Click "Auto-Configure" then paste the prompt to Claude Desktop to connect.');
        }
      } else {
        setVerificationSuccess('Configuration saved!');
      }
    } catch (e: any) {
      setVerificationError(e.message || 'Verification failed. Please check your credentials.');
    } finally {
      setVerifying(false);
    }
  };

  const availableProviderCards = providerCards;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#061019]/94 p-6 text-white backdrop-blur-3xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.14),transparent_38%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.08),transparent_24%)]" />
      {!isMac && (
        <div className="fixed top-0 left-0 z-20 flex items-center h-10 px-2">
          <button
            onClick={handleMinimize}
            className="h-8 w-10 flex items-center justify-center text-white/50 hover:text-white/80 hover:bg-white/10 active:bg-white/15 transition-colors rounded"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="h-8 w-10 flex items-center justify-center text-white/50 hover:text-white/80 hover:bg-white/10 active:bg-white/15 transition-colors rounded"
            title="Maximize"
          >
            <Square size={11} />
          </button>
          <button
            onClick={handleClose}
            className="h-8 w-10 flex items-center justify-center text-white/50 hover:text-white hover:bg-red-500/80 active:bg-red-500 transition-colors rounded"
            title="Close"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative z-10 flex w-full max-w-4xl max-h-[90vh] flex-col overflow-hidden rounded-[36px] border border-white/10 bg-[#0a1720]/92 shadow-[0_40px_140px_rgba(0,0,0,0.35)]"
      >
        <div className="flex-none border-b border-white/10 bg-white/[0.03] px-8 py-7">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-300/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-sky-100/85">
                <Palette size={14} />
                Setup guide
              </div>
              <h2 className="text-3xl font-semibold tracking-[-0.03em]">Make Aartiq feel ready before the first tab opens.</h2>
              Choose how much AI you want, pick a theme, review provider options, then finish with sync and security basics.
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/40">Build</p>
              <p className="mt-1 text-sm font-semibold text-white/80">{versionLabel}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            {['Workspace', 'Theme', 'AI Access', 'Sync'].map((label, index) => {
              const stepNumber = index + 1;
              const active = step === stepNumber;
              const done = step > stepNumber;

              return (
                <div
                  key={label}
                  className={`rounded-2xl border px-4 py-3 transition ${active ? 'border-sky-300/30 bg-sky-300/10' : 'border-white/10 bg-white/[0.03]'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">{label}</span>
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${done || active ? 'bg-white text-slate-900' : 'bg-white/8 text-white/55'}`}>
                      {done ? <Check size={14} /> : stepNumber}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-8 thin-scrollbar">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="workspace"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                className="space-y-6"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setWantsAI(true);
                      store.setEnableAIAssist(true);
                    }}
                    className={`rounded-[28px] border p-6 text-left transition ${wantsAI ? 'border-sky-300/35 bg-sky-300/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.05]'}`}
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-sky-200">
                      <Bot size={22} />
                    </div>
                    <h3 className="mt-5 text-xl font-semibold tracking-[-0.02em]">Use Aartiq</h3>
                    <p className="mt-2 text-sm leading-7 text-white/58">
                      Turn on the in-browser assistant so setup can point you to Ollama or provider keys next.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setWantsAI(false);
                      store.setEnableAIAssist(false);
                    }}
                    className={`rounded-[28px] border p-6 text-left transition ${!wantsAI ? 'border-white/20 bg-white/[0.08]' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.05]'}`}
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-white/75">
                      <ShieldCheck size={22} />
                    </div>
                    <h3 className="mt-5 text-xl font-semibold tracking-[-0.02em]">Start simple</h3>
                    <p className="mt-2 text-sm leading-7 text-white/58">
                      Skip built-in AI for now and keep Aartiq as a focused browser while you finish the rest of onboarding.
                    </p>
                  </button>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/42">What changes</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {[
                      'The theme selector now lives in setup instead of only settings.',
                      'Windows users get an official Copilot companion path with no Aartiq API key needed.',
                      'You can still finish setup even if you want to connect AI later.',
                    ].map((item) => (
                      <div key={item} className="rounded-2xl border border-white/10 bg-black/10 p-4 text-sm leading-6 text-white/62">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="theme"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                className="space-y-6"
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/42">Pick your theme</p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Choose the look you want before you land in the app.</h3>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {themeOptions.map((option) => {
                    const active = store.theme === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => store.setTheme(option.id)}
                        className={`rounded-[26px] border p-5 text-left transition ${active ? 'border-sky-300/35 bg-sky-300/10 shadow-[0_20px_60px_rgba(56,189,248,0.15)]' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.05]'}`}
                      >
                        <div
                          className="h-24 rounded-2xl border border-white/10"
                          style={{ background: option.preview }}
                        />
                        <div className="mt-4 flex items-center justify-between">
                          <span className="flex items-center gap-2 text-sm font-semibold text-white">
                            {option.icon}
                            {option.title}
                          </span>
                          {active && <Check size={16} className="text-sky-200" />}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-white/56">{option.description}</p>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="ai-access"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                className="space-y-6"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/42">AI access</p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Choose how you want to power the assistant.</h3>
                  </div>
                  <div className="rounded-2xl border border-sky-300/18 bg-sky-300/10 px-4 py-3 text-sm leading-6 text-sky-50/82">
                    Aartiq supports Ollama (local), API keys for reasoning, or Claude Desktop via MCP. Your settings are synced across devices securely.
                  </div>
                </div>

                {wantsAI ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {availableProviderCards.map((provider) => (
                      <div key={provider.id} className={`relative flex flex-col rounded-[28px] border border-white/10 bg-gradient-to-br ${provider.accent} p-6 transition-all`}>
                        <div className="flex items-start justify-between">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/10 text-white">
                            {provider.id === 'ollama' ? <Monitor size={20} /> : provider.id === 'claude-mcp' ? <Server size={20} /> : <Cloud size={20} />}
                          </div>
                          {store.aiProvider === provider.id && (
                            <span className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white shadow-sm ring-1 ring-white/20">
                              <Check size={10} /> Active
                            </span>
                          )}
                        </div>

                        <h4 className="mt-5 text-xl font-semibold tracking-tight">{provider.title}</h4>
                        <p className="mt-2 text-sm leading-6 text-white/50">{provider.description}</p>

                        <div className="mt-6 flex flex-1 flex-col justify-end space-y-3">
                          {activeProviderSetup === provider.id ? (
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="mt-2 space-y-4 rounded-2xl bg-black/20 p-4 border border-white/5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Configuration</span>
                                <button onClick={() => setActiveProviderSetup(null)} className="text-white/30 hover:text-white transition-colors">
                                  <X size={14} />
                                </button>
                              </div>

                              {provider.id === 'claude-mcp' ? (
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2">
                                    <Server size={12} className="text-violet-400" />
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">MCP Bridge Setup</span>
                                  </div>
                                  <p className="text-[10px] leading-5 text-white/40">
                                    Aartiq will configure Claude Desktop to connect via MCP. After writing the config, restart Claude Desktop and Aartiq will auto-detect the connection.
                                  </p>
<button
                                      onClick={async () => {
                                        setMcpAutoStatus('writing');
                                        setMcpAutoResult('');
                                        try {
                                          if (window.electronAPI?.autoConfigureClaudeMcp) {
                                            const res = await window.electronAPI.autoConfigureClaudeMcp();
                                            if (res.success) {
                                              setMcpAutoStatus('done');
                                              setMcpAutoResult(res.path || 'Config written');
                                              // The bridge generates its own per-process
                                              // token and hands it back over IPC. The renderer
                                              // never chooses it — POST /pairing/token is
                                              // gone, so a reachable caller can no longer pick
                                              // the credential it will be compared against.
                                              const token = (res as any).token || '';
                                              setMcpToken(token);
                                              setMcpPhase('copy');
                                            } else {
                                              setMcpAutoStatus('error');
                                              setMcpAutoResult(res.error || 'Unknown error');
                                            }
                                          } else {
                                            setMcpAutoStatus('error');
                                            setMcpAutoResult('electronAPI not available');
                                          }
                                        } catch (e: any) {
                                          setMcpAutoStatus('error');
                                          setMcpAutoResult(e.message || 'Failed');
                                        }
                                      }}
                                    disabled={mcpAutoStatus === 'writing'}
                                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] transition-all hover:bg-white/8 disabled:opacity-70"
                                  >
                                    {mcpAutoStatus === 'writing' ? (
                                      <><Loader2 size={14} className="animate-spin" /> Writing config...</>
                                    ) : mcpAutoStatus === 'done' ? (
                                      <><CheckCircle2 size={14} className="text-emerald-400" /> Config installed</>
                                    ) : mcpAutoStatus === 'error' ? (
                                      <><AlertCircle size={14} className="text-rose-400" /> Failed</>
                                    ) : (
                                      <><Sparkles size={14} /> Auto-Configure Now</>
                                    )}
                                  </button>
                                  {mcpAutoStatus === 'error' && (
                                    <p className="text-[9px] text-rose-400/80">{mcpAutoResult}</p>
                                  )}
                                  {mcpAutoStatus === 'done' && mcpToken && (
                                    <div className="space-y-2 rounded-xl bg-black/30 border border-white/5 p-3">
                                      {mcpPhase === 'copy' && (
                                        <>
                                          <div className="text-xs font-bold uppercase tracking-wider text-white/40 mb-1">Step 2: Copy prompt (optional)</div>
                                          <p className="text-[9px] text-white/20 mb-2">Paste into Claude Desktop after restart — or just click "Restarted" below to auto-verify</p>
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

**Connection Token:** ${mcpToken}

Please call the confirm_pairing tool with the following token to verify the Aartiq Browser MCP connection.`;
                                              navigator.clipboard.writeText(prompt);
                                              setMcpPhase('wait');
                                            }}
                                            className="w-full flex items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-400/10 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-violet-300 transition-all hover:bg-violet-400/20"
                                          >
                                            <Copy size={14} /> Copy Prompt to Clipboard
                                          </button>
                                        </>
                                      )}
                                      {mcpPhase === 'wait' && (
                                        <div className="flex items-center gap-2 text-[10px] text-violet-300">
                                          <Loader2 size={12} className="animate-spin" /> Checking for connection...
                                        </div>
                                      )}
                                      {mcpPhase === 'done' && (
                                        <div className="flex items-center gap-2 text-[10px] text-emerald-400 font-bold">
                                          <CheckCircle2 size={14} /> Claude Desktop connected!
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/30">
                                    {provider.id === 'ollama' ? 'Ollama URL' :
                                     provider.id === 'azure-openai' ? 'Azure Endpoint' : 'API Key'}
                                  </label>
                                  <div className="relative">
                                    <input
                                      type={provider.id === 'ollama' || provider.id === 'azure-openai' ? 'text' : 'password'}
                                      value={
                                        provider.id === 'ollama' ? store.ollamaBaseUrl :
                                          provider.id === 'openai' ? store.openaiApiKey :
                                            provider.id === 'google' ? store.geminiApiKey :
                                              provider.id === 'anthropic' ? store.anthropicApiKey :
                                                provider.id === 'groq' ? store.groqApiKey :
                                                  provider.id === 'xai' ? store.xaiApiKey :
                                                    provider.id === 'azure-openai' ? store.azureOpenaiEndpoint : ''
                                      }
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        if (provider.id === 'ollama') store.setOllamaBaseUrl(val);
                                        if (provider.id === 'openai') store.setOpenaiApiKey(val);
                                        if (provider.id === 'google') store.setGeminiApiKey(val);
                                        if (provider.id === 'anthropic') store.setAnthropicApiKey(val);
                                        if (provider.id === 'groq') store.setGroqApiKey(val);
                                        if (provider.id === 'xai') store.setXaiApiKey(val);
                                        if (provider.id === 'azure-openai') store.setAzureOpenaiEndpoint(val);
                                      }}
                                      placeholder={
                                        provider.id === 'ollama' ? 'http://127.0.0.1:11434' :
                                        provider.id === 'azure-openai' ? 'https://my-resource.openai.azure.com' : 'sk-...'
                                      }
                                      className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:border-sky-400/40 focus:ring-0"
                                    />
                                    <Key size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20" />
                                  </div>
                                  {provider.id === 'azure-openai' && (
                                    <div className="relative mt-2">
                                      <label className="text-[10px] font-bold uppercase tracking-widest text-white/30">API Key</label>
                                      <input
                                        type="password"
                                        value={store.azureOpenaiApiKey}
                                        onChange={(e) => store.setAzureOpenaiApiKey(e.target.value)}
                                        placeholder="sk-..."
                                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:border-sky-400/40 focus:ring-0"
                                      />
                                    </div>
                                  )}
                                </div>
                              )}

                              {verificationError && (
                                <div className="flex items-start gap-2 text-[10px] text-rose-400 font-bold uppercase tracking-tighter leading-tight">
                                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                                  {verificationError}
                                </div>
                              )}

                              {verificationSuccess && (
                                <div className="flex items-start gap-2 text-[10px] text-emerald-400 font-bold uppercase tracking-tighter leading-tight">
                                  <Check size={12} className="shrink-0 mt-0.5" />
                                  {verificationSuccess}
                                </div>
                              )}

                              {fetchedModels.length > 0 && provider.id === 'ollama' && (
                                <div className="space-y-2">
                                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/30">Select Model to Test</label>
                                  <select
                                    value={store.ollamaModel || fetchedModels[0]}
                                    onChange={(e) => store.setOllamaModel(e.target.value)}
                                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white focus:border-sky-400/40 focus:ring-0"
                                  >
                                    {fetchedModels.map(m => (
                                      <option key={m} value={m} className="bg-[#0a1720]">{m}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              {fetchedModels.length > 0 && provider.id !== 'ollama' && (
                                <div className="space-y-2">
                                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/30">Detected Models</label>
                                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1 thin-scrollbar">
                                    {fetchedModels.slice(0, 8).map(m => (
                                      <span key={m} className="rounded-lg bg-white/5 border border-white/5 px-2 py-1 text-[9px] text-white/60 font-mono">
                                        {m}
                                      </span>
                                    ))}
                                    {fetchedModels.length > 8 && <span className="text-[9px] text-white/30 flex items-center px-1">+ {fetchedModels.length - 8} more</span>}
                                  </div>
                                </div>
                              )}

                              {provider.id === 'claude-mcp' ? (
                                <button
                                  onClick={() => handleVerifyProvider(provider.id)}
                                  disabled={verifying || mcpAutoStatus !== 'done' || mcpPhase !== 'done'}
                                  className="w-full rounded-xl bg-white px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.2em] text-slate-900 transition-all hover:bg-slate-100 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                  {verifying ? <Loader2 size={14} className="animate-spin" /> : mcpPhase === 'done' ? <CheckCircle2 size={14} /> : <Wifi size={14} />}
                                  {verifying ? 'Verifying...' : mcpPhase === 'done' ? 'Connected' : 'Waiting for connection...'}
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleVerifyProvider(provider.id)}
                                  disabled={verifying}
                                  className="w-full rounded-xl bg-white px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.2em] text-slate-900 transition-all hover:bg-slate-100 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                  {verifying ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                                  {verifying ? 'Verifying...' : 'Verify & Connect'}
                                </button>
                              )}
                            </motion.div>
                          ) : (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  store.setAIProvider(provider.id);
                                  setActiveProviderSetup(provider.id);
                                  setVerificationError(null);
                                  setVerificationSuccess(null);
                                  setFetchedModels([]);
                                  if (provider.id === 'ollama' && !store.ollamaBaseUrl) {
                                    store.setOllamaBaseUrl('http://127.0.0.1:11434');
                                  }
                                }}
                                className="flex-1 rounded-xl bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-slate-900 transition hover:bg-slate-100"
                              >
                                {provider.cta}
                              </button>
                              <button
                                type="button"
                                onClick={() => openExternal(provider.link)}
                                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/12 bg-white/8 text-white/60 transition hover:bg-white/12 hover:text-white"
                              >
                                <ExternalLink size={16} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6 text-sm leading-7 text-white/62">
                    Built-in AI is off for now. You can still finish setup and configure Ollama or cloud providers later from settings.
                  </div>
                )}


              </motion.div>
            )}

            {step === 4 && (
              <motion.div
                key="sync"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                className="space-y-6"
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/42">Final checks</p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">You are ready to open Aartiq.</h3>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  {[
                    {
                      icon: <Wifi size={18} />,
                      title: 'WiFi sync',
                      body: 'Pair with mobile later for clipboard sync, remote control, and automation follow-up.',
                    },
                    {
                      icon: <ShieldCheck size={18} />,
                      title: 'Permission manager',
                      body: 'Low, medium, and high-risk actions now route through a single approval flow.',
                    },
                    {
                      icon: <Palette size={18} />,
                      title: 'Theme saved',
                      body: `Current theme: ${store.theme}. You can change it anytime in Appearance settings.`,
                    },
                  ].map((item) => (
                    <div key={item.title} className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-sky-200">
                        {item.icon}
                      </div>
                      <h4 className="mt-4 text-lg font-semibold">{item.title}</h4>
                      <p className="mt-2 text-sm leading-6 text-white/58">{item.body}</p>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={finishSetup}
                  className="flex w-full items-center justify-center gap-2 rounded-[24px] bg-white px-5 py-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
                >
                  Finish setup
                  <ArrowRight size={16} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-none flex items-center justify-between border-t border-white/10 bg-white/[0.02] px-8 py-5">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition ${step === 1 ? 'cursor-default text-white/20' : 'text-white/65 hover:bg-white/6 hover:text-white'}`}
          >
            <ChevronLeft size={16} />
            Back
          </button>

          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className={`h-2 rounded-full transition-all ${step === item ? 'w-10 bg-white' : 'w-2 bg-white/18'}`}
              />
            ))}
          </div>

          {step < 4 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={step === 3 && wantsAI && !verifiedProvider}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                step === 3 && wantsAI && !verifiedProvider
                  ? 'bg-white/20 text-white/30 cursor-not-allowed pointer-events-none'
                  : 'bg-white text-slate-900 hover:bg-slate-100'
              }`}
            >
              Next
              <ArrowRight size={16} />
            </button>
          ) : (
            <div className="w-[88px]" />
          )}
        </div>
      </motion.div>
    </div>
  );
};
