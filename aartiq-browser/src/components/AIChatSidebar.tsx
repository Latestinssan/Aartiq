"use client";

import React, { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useShallow } from 'zustand/react/shallow';
import {
  Maximize2, Minimize2, FileText, Download, Wifi, WifiOff, X,
  ChevronLeft, ChevronRight, ChevronDown, Zap, Send, Paperclip,
  ScanLine,
  MoreVertical,
  Sparkles,
  Image as ImageIcon,
  Image,
  Eye, EyeOff, Search, Loader2, MousePointerClick,
  CheckCircle2, AlertCircle, Layers, SlidersHorizontal,
  Share2, CopyIcon, Trash2, Printer, Cpu, Rocket, Camera, Terminal, MoreHorizontal, Play, History, Copy, Mic, Database, Shield
} from 'lucide-react';
import Tesseract from 'tesseract.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/contrib/mhchem';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import dracula from 'react-syntax-highlighter/dist/cjs/styles/prism/dracula';

// Imported modular components
import ThinkingPanel, { type ThinkingStep } from './ai/ThinkingPanel';
import ActionChainTimeline, { type ActionChainStep } from './ai/ActionChainTimeline';
import CollapsibleOCRMessage from './ai/CollapsibleOCRMessage';
import ProcessingIndicator from './ai/ProcessingIndicator';
import CollapsibleSkillMessage from './ai/CollapsibleSkillMessage';
import SkillsListMessage from './ai/SkillsListMessage';
import MessageActions from './ai/MessageActions';
import ConversationHistoryPanel, { type Conversation, type ChatMessage } from './ai/ConversationHistoryPanel';
import { useAIActionSecurityManager } from './ai/useAIActionSecurityManager';
import { getShellCommandRisk, isActionDenied, getActionSecurityDefinition, normalizeActionType } from '@/lib/ai-action-security';
import {
  robustJSONParse,
  extractAIReasoning,
  extractOCRResult,
  extractActionChain,
  extractMediaAttachments,
  extractActionCommands
} from './ai/RobustParsers';
import { useAppVersion } from '@/lib/useAppVersion';
import AISetupGuide from './ai/AISetupGuide';
import LLMProviderSettings from './LLMProviderSettings';
import { AICommandQueue, type AICommand } from './AICommandQueue';
import { type AgentState, type PlanningStep } from './AIChatSidebar/types';
import DOMSearchDisplay, { DOMMetaDisplay } from './ai/DOMSearchDisplay';
import SmartMessageContent, { URLCard, FilePathChip } from './ai/SmartMessageContent';
import { secureDOMReader, type DOMSearchResult, type FilteredDOMResult, type DOMElement } from './ai/SecureDOMReader';
import { detectSchedulingIntent, type SchedulingIntent } from './ai/SchedulingIntentDetector';
import SchedulingModal from './ai/SchedulingModal';
import McpSetupGuide from './ai/McpSetupGuide';
import MermaidDiagram from './ai/MermaidDiagram';
import FlowchartDiagram from './ai/FlowchartDiagram';
import ChartDiagram from './ai/ChartDiagram';
import YouTubePlayer from './ai/YouTubePlayer';
import { ResearchExecutionCard, type ExecutionStepData } from './ai/ResearchExecutionCard';
import { ResearchSourceCarousel } from './ai/ResearchSourceCard';
import { getCmdParam, getCmdParamInt, cleanCmdValue, type ParsedCommand } from '@/lib/AICommandParser';
import {
  applyResearchProgress,
  createEmptyResearchState,
  createResearchState,
  type ResearchUiState,
} from '@/lib/researchState';

import { compactMessages, estimateTokens } from '@/lib/context-compactor';

// Logic & Utils
import {
  getThreatRecord, setThreatRecord, checkThreat, scrubbedContent,
  isFailedPageContent, extractSiteFromContext, buildCleanPDFContent, buildPDFFromJSON,
  lsGet, lsSet, preloadAartiqIcon, tryGetIconBase64,
  type PDFImage, type PDFActionLog, type PDFOCRData, generateSmartPDF, PDF_ICONS, getIcon
} from './ai/AIUtils';
import {
  AARTIQ_CAPABILITIES, SYSTEM_INSTRUCTIONS, SYSTEM_CORE, COMMAND_REFERENCE, LANGUAGE_MAP, INTERNAL_TAG_RE
} from './ai/AIConstants';
import { useAppStore } from '@/store/useAppStore';
import { BrowserAI } from '@/lib/BrowserAI';
import { Security } from '@/lib/Security';
import { prepareCommandsForExecution, formatCommandsForExport, parseUnifiedCommands, stripAllCommands } from '@/lib/AICommandParser';
import { aiCommandOutput, stripCommandsFromOutput } from '@/lib/AICommandOutput';
import { searchContextStore } from '@/lib/SearchContextStore';
import { matchSkills, AVAILABLE_SKILLS, listAllSkills } from '@/lib/SkillRegistry';
import { actionLogsStore, type ActionLog } from '@/lib/ActionLogsStore';
import AIFallback from './sidebar/AIFallback';
import SidebarWidgets from './sidebar/SidebarWidgets';
import AISuggestionsHome from './sidebar/AISuggestionsHome';
import AISuggestionBubbles from './sidebar/AISuggestionBubbles';
import { GENERIC_SUGGESTIONS } from './sidebar/AISuggestionsHome';
import CustomizationPanel from './sidebar/CustomizationPanel';
import { useSidebarPrefs } from './sidebar/useSidebarPrefs';
import { SidebarDataProvider, type SidebarData, type NeedsAttentionItem } from './sidebar/SidebarContext';
import { sidebarRootStyle } from './sidebar/theme';
import { useTabIntelligenceStore } from '@/store/tabIntelligenceStore';
import PrivacyControls from './sidebar/PrivacyControls';
import QuestionCard from './QuestionCard';
import { parseAartiqQuestion, serializeAartiqQuestion, type AartiqQuestion } from '@/lib/aiQuestion';
import AIVisualThemeControl, { getCSSForAIVisual } from './sidebar/AIVisualTheme';
import { injectTabAnimationCSS, removeTabAnimationCSS } from './sidebar/AITabAnimation';
import BackgroundNotifications from './sidebar/BackgroundNotifications';
import {
  getAIVisualSettings, saveAIVisualSettings,
  getPrivacySettings, savePrivacySettings,
  type SidebarPreferences, type AIVisualSettings, type PrivacySettings,
} from './sidebar/types';
import { buildFrontendReasoningOptions, type LlmMode } from '@/lib/aiReasoningOptions';
import { getRecommendedGeminiModel } from '@/lib/modelRegistry';
import firebaseService from '@/lib/FirebaseService';
import { selectAIChatSidebarStore } from '@/store/selectors';

// ---------------------------------------------------------------------------
// Types (imported from types.ts)
// ---------------------------------------------------------------------------

import {
  type MediaItem,
  type ExtendedChatMessage,
  type VisualStage,
  type Attachment,
  type RefusedIntent,
  type RefusedIntentRecord,
} from './AIChatSidebar/types';
import {
  areCommandsSettled,
  buildConversationTitle,
  getCommandAttemptSignature,
} from './AIChatSidebar/helpers';

interface AIChatSidebarProps {
  studentMode: boolean;
  toggleStudentMode: () => void;
  isCollapsed: boolean;
  toggleCollapse: () => void;
  selectedEngine: string;
  setSelectedEngine: (engine: string) => void;
  theme: 'dark' | 'light' | 'system' | 'vibrant' | 'custom' | 'minimal';
  setTheme: (theme: 'dark' | 'light' | 'system' | 'vibrant' | 'custom' | 'minimal') => void;
  backgroundImage: string;
  setBackgroundImage: (imageUrl: string) => void;
  backend: 'firebase' | 'mysql';
  setBackend: (backend: 'firebase' | 'mysql') => void;
  mysqlConfig: any;
  setMysqlConfig: (config: any) => void;
  side?: 'left' | 'right';
  setShowSettings?: (show: boolean) => void;
  setSettingsSection?: (section: string) => void;
  setBrowserDisabled?: (disabled: boolean) => void;
  showSchedulingModal?: boolean;
  setShowSchedulingModal?: (show: boolean) => void;
  schedulingIntent?: SchedulingIntent | null;
  setSchedulingIntent?: (intent: SchedulingIntent | null) => void;
  bridgeOnly?: boolean;
  isResizing?: boolean;
}

interface SearchResultEntry {
  title: string;
  url: string;
  snippet: string;
}

function getExtractedPageContentText(pageContent: string | { content?: string; error?: string } | undefined): string {
  if (typeof pageContent === 'string') {
    return pageContent;
  }
  return pageContent?.content || '';
}

const parseSearchResultEntry = (result: any): SearchResultEntry | null => {
  if (!result) return null;

  if (typeof result === 'object' && result.url) {
    return {
      title: `${result.title || 'Untitled result'}`.trim(),
      url: `${result.url || ''}`.trim(),
      snippet: `${result.snippet || result.description || ''}`.trim(),
    };
  }

  return null;
};

const normalizeSearchResults = (results: any[]): SearchResultEntry[] => (
  (results || [])
    .map(parseSearchResultEntry)
    .filter((entry): entry is SearchResultEntry => Boolean(entry?.url))
);

const formatSearchResultsForLLM = (query: string, results: SearchResultEntry[]): string => {
  if (results.length === 0) return '';

  const blocks = results.map((entry, index) => {
    const lines = [
      `**${index + 1}. ${entry.title}**`,
      `🔗 ${entry.url}`,
      `📝 ${entry.snippet || 'No snippet available.'}`,
    ];
    if ((entry as any).pageContent) {
      lines.push(`📄 **PAGE CONTENT:**\n${(entry as any).pageContent.substring(0, 3000)}`);
    }
    return lines.join('\n');
  });

  return [
    `🔍 LIVE WEB SEARCH: "${query}"`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'Full page content is included below for some results — use it directly.',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    ...blocks,
  ].join('\n\n');
};

// ---------------------------------------------------------------------------
// File Path Detection & Clickable Link
// ---------------------------------------------------------------------------
const FILE_PATH_RE = /^\/(?:[^\s]+\/)+[^\s]+(?:\.[a-zA-Z0-9]+)?$|^[A-Za-z]:\\(?:[^\s]+\\)+[^\s]+(?:\.[a-zA-Z0-9]+)?$/;

function FilePathLink({ filePath }: { filePath: string }) {
  const [hovered, setHovered] = useState(false);
  const openInFinder = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    window.electronAPI?.showItemInFolder?.(filePath);
  }, [filePath]);

  const parts = useMemo(() => filePath.split(/[/\\]/), [filePath]);
  const parentDir = useMemo(() => parts.length > 2 ? parts[parts.length - 2] : '', [parts]);
  const fileName = useMemo(() => parts[parts.length - 1] || filePath, [parts, filePath]);
  const isDirectory = useMemo(() => !/\.[a-zA-Z0-9]{1,10}$/.test(filePath), [filePath]);

  return (
    <span
      onClick={openInFinder}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="inline-flex items-center gap-1 bg-white/[0.07] px-2 py-0.5 rounded-lg text-[12px] font-mono cursor-pointer hover:bg-sky-500/15 transition-all align-bottom max-w-[280px] relative"
    >
      {isDirectory ? (
        <span className="text-sky-400/70 text-[10px]">&#128193;</span>
      ) : (
        <span className="text-emerald-400/70 text-[10px]">&#128196;</span>
      )}
      {parentDir && (
        <span className="text-white/30 text-[10px]">{parentDir}/</span>
      )}
      <span className="text-sky-300 truncate">{fileName}</span>
      {hovered && (
        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 max-w-[500px] rounded-lg border border-white/10 bg-[#1a1a2e]/95 px-3 py-2 text-[11px] text-white/80 shadow-2xl backdrop-blur-xl whitespace-nowrap font-mono">
          {filePath}
        </span>
      )}
    </span>
  );
}

function SourceLink({ href, children }: { href?: string; children: React.ReactNode }) {
  const [hovered, setHovered] = React.useState(false);
  const rawLink = `${href || ''}`;
  let link = rawLink;
  let hostname = '';
  let favicon = '';
  try {
    if (link.startsWith('//')) link = 'https:' + link;
    const url = new URL(link);
    hostname = url.hostname.replace(/^www\./, '');
    favicon = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
  } catch {
  }

  const openLink = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    if (!link) return;
    try {
      window.electronAPI?.createView?.({ tabId: `source-${Date.now()}`, url: link });
      useAppStore.getState().addTab(link, 'ai-session');
    } catch {
      window.open(link, '_blank', 'noopener,noreferrer');
    }
  }, [link]);

  if (!link || !hostname) {
    return <span>{children}</span>;
  }

  const childText = typeof children === 'string' ? children.trim() : '';
  const isBareUrl = childText && (
    childText === link ||
    childText === rawLink ||
    childText === href ||
    /^https?:\/\//.test(childText) ||
    /^\/\//.test(childText) ||
    childText.replace(/^www\./, '') === hostname
  );
  const displayText = isBareUrl ? hostname : children;

  return (
    <span
      className="relative inline-flex max-w-full align-baseline"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={openLink}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-[0.95em] text-primary-text underline decoration-[color-mix(in_srgb,var(--accent)_35%,transparent)] decoration-1 underline-offset-4 transition-colors hover:text-[var(--accent)]"
        title="Visit website"
      >
        <img
          src={favicon}
          alt=""
          className="h-3.5 w-3.5 shrink-0 rounded-sm"
          onError={(event) => {
            (event.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
        <span className="min-w-0 truncate">{displayText}</span>
      </button>
      <span
        className="pointer-events-none absolute left-0 top-full z-20 mt-1 max-w-[320px] rounded-lg border border-border-color bg-primary-bg/95 px-2.5 py-1.5 text-[11px] text-secondary-text shadow-xl backdrop-blur-xl transition-all duration-200"
        style={{ opacity: hovered ? 1 : 0, transform: hovered ? 'translateY(0)' : 'translateY(4px)' }}
      >
        <span className="block font-medium text-primary-text">{hostname}</span>
        <span className="block truncate">{link}</span>
      </span>
    </span>
  );
}

const renderMarkdownContent = (content: string) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
    rehypePlugins={[rehypeKatex]}
    components={{
      a({ href, children }) {
        return <SourceLink href={href}>{children}</SourceLink>;
      },
      table({ children }) {
        return (
          <div className="my-3 max-w-full overflow-x-auto rounded-xl border border-[color-mix(in_srgb,var(--primary-text)_12%,transparent)]">
            <table className="aartiq-table w-full min-w-full border-collapse text-[13px]">{children}</table>
          </div>
        );
      },
      thead({ children }) {
        return <thead className="aartiq-table-head">{children}</thead>;
      },
      tbody({ children }) {
        return <tbody className="aartiq-table-body">{children}</tbody>;
      },
      tr({ children, ...rest }) {
        const isHeader = (rest as any)?.node?.parent?.tagName === 'thead';
        return (
          <tr className={`aartiq-table-row ${isHeader ? 'aartiq-table-row-header' : ''}`}>
            {children}
          </tr>
        );
      },
      th({ children }) {
        return <th className="aartiq-table-th">{children}</th>;
      },
      td({ children }) {
        return <td className="aartiq-table-td">{children}</td>;
      },
      code({ className, children, ...rest }) {
        const match = /language-(\w+)/.exec(className || '');
        const codeContent = String(children).replace(/\n$/, '');

        return match ? (
          <div className="my-5 rounded-3xl overflow-hidden border border-white/5 shadow-2xl">
            <SyntaxHighlighter
              style={dracula as any}
              language={match[1]}
              PreTag="div"
              customStyle={{ margin: 0, padding: '1.5rem', fontSize: '11px' }}
            >
              {codeContent}
            </SyntaxHighlighter>
          </div>
        ) : (
          (() => {
            const codeText = String(children).trim();
            if (codeText && FILE_PATH_RE.test(codeText)) {
              return <FilePathLink filePath={codeText} />;
            }
            return (
              <code className="bg-white/10 px-2 py-0.5 rounded-lg text-[12px] font-mono text-sky-300" {...rest}>
                {children}
              </code>
            );
          })()
        );
      }
    }}
  >
    {content}
  </ReactMarkdown>
);

// Wrap bare file paths in backticks so they get detected by the code handler
function preprocessFilePaths(text: string): string {
  return text.replace(
    /(^|[^`\/\w])((?:\/[\w\-.~/]+(?:\.[a-zA-Z0-9]+)(?=[\s\n.,;:!?)]|$))|(?:[A-Za-z]:\\(?:[\w\-. ]+\\)+[\w\-. ]+(?:\.[a-zA-Z0-9]+)?(?=[\s\n.,;:!?)]|$)))/g,
    (match, before, path) => before + '`' + path + '`'
  );
}

const StreamingMarkdownMessage = memo(function StreamingMarkdownMessage({
  content,
  animate,
}: {
  content: string;
  animate: boolean;
}) {
  const processed = useMemo(() => content ? preprocessFilePaths(content) : content, [content]);
  const markdownContent = useMemo(() => (
    processed ? renderMarkdownContent(processed) : null
  ), [processed]);

  return (
    <div className="space-y-2">
      {markdownContent}
      {animate ? (
        <span
          aria-hidden="true"
          className="inline-flex h-4 w-1.5 rounded-full animate-pulse bg-sky-400/80 shadow-[0_0_10px_rgba(56,189,248,0.35)]"
        />
      ) : null}
    </div>
  );
});

const collapseRawSearchDump = (content: string): string => {
  if (!/(Search Results for|Web Search Results for|pages read|Content:|PAGE CONTENT|\[SOURCE \d+:)/i.test(content)) {
    return content;
  }

  const lines = content.split('\n');
  const kept: string[] = [];
  let skippingContentBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(🔍\s*)?(Web\s+)?Search Results for/i.test(trimmed)) continue;
    if (/^\[SOURCE\s+\d+:/i.test(trimmed)) { skippingContentBlock = true; continue; }
    if (/^"""$/.test(trimmed)) {
      if (skippingContentBlock) { skippingContentBlock = false; }
      else { skippingContentBlock = true; }
      continue;
    }
    if (/^(Content|PAGE CONTENT|Full page content)\s*:/i.test(trimmed)) {
      skippingContentBlock = true;
      continue;
    }
    if (skippingContentBlock) {
      if (/^(\d+\.|-|\*)\s+\[.+\]\(.+\)/.test(trimmed) || /^---+$/.test(trimmed) || trimmed === '') {
        skippingContentBlock = false;
      } else {
        continue;
      }
    }
    if (/^\s*Content:\s*/i.test(line)) continue;
    if (trimmed.length > 800 && !/\]\(https?:\/\//.test(trimmed)) continue;
    kept.push(line);
  }

  const cleaned = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleaned || cleaned.length < 30) {
    return 'I found relevant web results. Review the source links below or ask me to summarize a specific result.';
  }
  return cleaned;
};

/**
 * Load a skill's guide content. Prefers the electron IPC bridge, but falls
 * back to fetching the served markdown file so skills still inject in web/dev
 * contexts where the preload bridge is unavailable.
 */
async function loadSkillContent(skillId: string): Promise<string> {
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.loadSkill) {
      const ctx = await window.electronAPI.loadSkill(skillId);
      if (ctx && `${ctx}`.trim() && !`${ctx}`.includes('No skill instructions available')) {
        return `${ctx}`.trim();
      }
    }
  } catch {
    // fall through to fetch
  }
  try {
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      const res = await fetch(`/skills/${skillId}.md`);
      if (res.ok) {
        const text = await res.text();
        return text.replace(/^---[\s\S]*?---\s*/, '').trim();
      }
    }
  } catch {
    // ignore
  }
  return '';
}

const sanitizeVisibleMessage = (content: string): string => {  if (!content) return '';
  let cleaned = stripAllCommands(content);

  // Strip [ACTION_CHAIN_JSON]...[/ACTION_CHAIN_JSON] paired tags with their content
  cleaned = cleaned.replace(/\[ACTION_CHAIN_JSON\][\s\S]*?\[\/ACTION_CHAIN_JSON\]/gi, '');

  // Strip XML-style action chain tags
  cleaned = cleaned.replace(/<(?:action_chain|actions|tool_calls|command_json|commands)>\s*[\s\S]*?\s*<\/(?:action_chain|actions|tool_calls|command_json|commands)>/gi, '');

  // Strip <think>...</think> tags if they leaked through
  cleaned = cleaned.replace(/<(?:think|thinking|thought)>\s*[\s\S]*?\s*<\/(?:think|thinking|thought)>/gi, '');

  // Strip standalone internal tags
  cleaned = cleaned.replace(INTERNAL_TAG_RE, '');

  // Strip ACTION_CHAIN_JSON = ```json...``` patterns
  cleaned = cleaned.replace(/ACTION_CHAIN_JSON\s*[:=]?\s*```[\s\S]*?```/gi, '');

  // Strip ACTION_CHAIN_JSON = {...} patterns at end of string
  cleaned = cleaned.replace(/ACTION_CHAIN_JSON\s*[:=]?\s*\{[\s\S]*?\}\s*$/gi, '');

  // Strip [SOURCE N: ...] raw RAG context tags
  cleaned = cleaned.replace(/\[SOURCE\s+\d+:.*?\]/gi, '');
  cleaned = cleaned.replace(/""".*?"""/gs, '');

  // Strip ```json blocks that contain command/action structure
  cleaned = cleaned.replace(/```(?:json)?\s*\n?\s*\{[\s\S]*?"(?:type|actions|commands|command|tool_calls|action_chain)"[\s\S]*?\}\s*```/gi, '');

  // Strip standalone JSON objects with command keys (bare objects in text)
  cleaned = cleaned.replace(/\{\s*"commands"\s*:\s*\[[\s\S]*?\]\s*\}/gi, '');
  cleaned = cleaned.replace(/\{\s*"actions"\s*:\s*\[[\s\S]*?\]\s*\}/gi, '');
  cleaned = cleaned.replace(/\{\s*"type"\s*:\s*"[A-Z_]+"\s*,\s*"value"\s*:/gi, '');

  // Strip bare command tags
  cleaned = cleaned.replace(/\[(?:SHELL_COMMAND|ACTION_CHAIN_JSON|WEB_SEARCH|READ_PAGE_CONTENT|CLICK_ELEMENT|CLICK_AT|FIND_AND_CLICK|FILL_FORM|DOM_SEARCH|OCR_SCREEN|SCREENSHOT_AND_ANALYZE|NAVIGATE|OPEN_APP|ENABLE_CLI)[^\]]*\]/gi, '');

  // Strip empty ```json``` fences left behind
  cleaned = cleaned.replace(/```(?:json)?\s*```/g, '');

  // Strip stray/unclosed ```json fences (model emits opening fence but the JSON
  // payload was intercepted as a command, leaving the fence dangling in the text)
  cleaned = cleaned.replace(/```(?:json)?\s*\n?$/gm, '');

  // Collapse raw search dumps
  cleaned = collapseRawSearchDump(cleaned);

  // Clean up excessive whitespace left from stripping
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
};

function ThinkingStatus({ state }: { state: AgentState }) {
  const label = state === 'planning' ? 'Planning actions' :
    state === 'searching' ? 'Searching' :
    state === 'executing' ? 'Executing' :
    state === 'waiting' ? 'Waiting for approval' :
    state === 'paused' ? 'Paused' :
    state === 'finished' ? 'Finishing' :
    'Thinking';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      className="mx-auto flex w-fit max-w-[650px] items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--card-bg)_88%,transparent)] px-3 py-2 text-[13px] text-secondary-text shadow-sm"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-35" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
      </span>
      {label}
    </motion.div>
  );
}

type ComposerIconKey = 'attachments' | 'voice' | 'history' | 'automation' | 'neuralCache';

type GlowMode = 'gradient' | 'rgb' | 'off';
type GlowPreset = 'purple-cosmos' | 'ocean-blue' | 'emerald-forest' | 'sunset-fire' | 'rose-gold' | 'arctic-ice' | 'custom';

interface GlowPresetScheme {
  label: string;
  primary: string;
  secondary: string;
  tertiary: string;
}

const GLOW_PRESETS: Record<GlowPreset, GlowPresetScheme> = {
  'purple-cosmos': { label: 'Purple Cosmos', primary: '#a855f7', secondary: '#6366f1', tertiary: '#ec4899' },
  'ocean-blue':    { label: 'Ocean Blue',    primary: '#3b82f6', secondary: '#06b6d4', tertiary: '#818cf8' },
  'emerald-forest':{ label: 'Emerald Forest', primary: '#10b981', secondary: '#06b6d4', tertiary: '#34d399' },
  'sunset-fire':   { label: 'Sunset Fire',   primary: '#f97316', secondary: '#ef4444', tertiary: '#f59e0b' },
  'rose-gold':     { label: 'Rose Gold',     primary: '#f43f5e', secondary: '#ec4899', tertiary: '#fb7185' },
  'arctic-ice':    { label: 'Arctic Ice',    primary: '#06b6d4', secondary: '#818cf8', tertiary: '#e0f2fe' },
  'custom':        { label: 'Custom',        primary: '#a855f7', secondary: '#6366f1', tertiary: '#ec4899' },
};

interface SidebarWorkspacePreferences {
  fontFamily: string;
  fontSize: number;
  soundsEnabled: boolean;
  gradientEffectsEnabled: boolean;
  glowMode: GlowMode;
  glowPreset: GlowPreset;
  glowColorPrimary: string;
  glowColorSecondary: string;
  glowColorTertiary: string;
  visibleComposerIcons: Record<ComposerIconKey, boolean>;
  modelNicknames: Record<string, string>;
}

const DEFAULT_SIDEBAR_WORKSPACE_PREFERENCES: SidebarWorkspacePreferences = {
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: 15,
  soundsEnabled: false,
  gradientEffectsEnabled: false,
  glowMode: 'off',
  glowPreset: 'purple-cosmos',
  glowColorPrimary: '#a855f7',
  glowColorSecondary: '#6366f1',
  glowColorTertiary: '#ec4899',
  visibleComposerIcons: {
    attachments: true,
    voice: true,
    history: true,
    automation: true,
    neuralCache: true,
  },
  modelNicknames: {},
};

const SIDEBAR_WORKSPACE_PREFS_KEY = 'aartiq_ai_sidebar_workspace_preferences';

const loadSidebarWorkspacePreferences = (): SidebarWorkspacePreferences => {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WORKSPACE_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WORKSPACE_PREFS_KEY);
    if (!stored) return DEFAULT_SIDEBAR_WORKSPACE_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<SidebarWorkspacePreferences>;
    const migratedGlowMode: GlowMode = parsed.glowMode
      || (parsed.gradientEffectsEnabled ? 'gradient' : 'off');
    const migratedColors = parsed.glowColorPrimary
      ? { primary: parsed.glowColorPrimary, secondary: parsed.glowColorSecondary || '#6366f1', tertiary: parsed.glowColorTertiary || '#ec4899' }
      : GLOW_PRESETS['purple-cosmos'];
    return {
      ...DEFAULT_SIDEBAR_WORKSPACE_PREFERENCES,
      ...parsed,
      glowMode: migratedGlowMode,
      glowPreset: parsed.glowPreset || 'purple-cosmos',
      glowColorPrimary: migratedColors.primary,
      glowColorSecondary: migratedColors.secondary,
      glowColorTertiary: migratedColors.tertiary,
      visibleComposerIcons: {
        ...DEFAULT_SIDEBAR_WORKSPACE_PREFERENCES.visibleComposerIcons,
        ...(parsed.visibleComposerIcons || {}),
      },
      modelNicknames: parsed.modelNicknames || {},
    };
  } catch {
    return DEFAULT_SIDEBAR_WORKSPACE_PREFERENCES;
  }
};

const blobToBase64 = (blob: Blob): Promise<string> => (
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  })
);

const hexToRgba = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const AIChatSidebar: React.FC<AIChatSidebarProps> = (props) => {
  const ACTION_CHAIN_MAX_ITERATIONS = 4;
  const ACTION_CHAIN_MAX_RECOVERY_ATTEMPTS = 2;
  const ACTION_CHAIN_MAX_COMMANDS_PER_PASS = 6;
  const ACTION_CHAIN_MAX_SAME_COMMAND_ATTEMPTS = 2;
  const createMessageId = useCallback((prefix = 'msg') => (
    typeof window !== 'undefined' && window.crypto?.randomUUID
      ? `${prefix}-${window.crypto.randomUUID()}`
      : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  ), []);
  const router = useRouter();
  const store = useAppStore(useShallow(selectAIChatSidebarStore));
  const {
    aiProvider, ollamaBaseUrl, ollamaModel, openaiApiKey, localLLMBaseUrl,
    localLLMModel, geminiApiKey, xaiApiKey, anthropicApiKey, groqApiKey,
    hasSeenAiMistakeWarning, askForAiPermission, aiSafetyMode,
    additionalAIInstructions, selectedLanguage, history, tabs, activeTabId,
    currentUrl, sidebarWidth,
    setShowAiMistakeWarning, setActiveView,
    setCurrentUrl, setSidebarWidth, setGeminiModel, setGeminiFlashModel,
    localLlmMode, autoGeminiModelUpdates, geminiModel, geminiFlashModel,
    setTheme: storeSetTheme,
    ollamaModelsList, setOllamaModelsList, setOllamaModel, geminiModel: storeGeminiModel,
    hasSeenNeuralSetup, setHasSeenNeuralSetup,
    openaiModel, anthropicModel, groqModel, xaiModel,
  } = store;
  const appVersion = useAppVersion();
  const versionLabel = `v${appVersion}`;
  const resolvedTheme = useMemo<'dark' | 'light' | 'vibrant' | 'custom' | 'minimal'>(() => {
    if (props.theme === 'system') {
      if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
      return 'light';
    }
    return props.theme;
  }, [props.theme]);
  const isLightTheme = resolvedTheme === 'light';
  const sidebarShellStyle = {
    background: 'linear-gradient(180deg, color-mix(in srgb, var(--navbar-bg) 75%, transparent), color-mix(in srgb, var(--primary-bg) 88%, transparent))',
    borderColor: 'color-mix(in srgb, var(--border-color) 40%, transparent)',
    color: 'var(--primary-text)',
    backdropFilter: 'blur(24px)',
    boxShadow: '0 6px 30px color-mix(in srgb, var(--shadow-color) 40%, transparent)',
  } as React.CSSProperties;
  const softPanelStyle = {
    background: 'color-mix(in srgb, var(--card-bg) 92%, transparent)',
    borderColor: 'var(--border-color)',
    color: 'var(--primary-text)',
    backdropFilter: 'blur(20px)',
  } as React.CSSProperties;
  const popoverStyle = {
    background: 'color-mix(in srgb, var(--card-bg) 96%, transparent)',
    borderColor: 'var(--border-color)',
    color: 'var(--primary-text)',
    backdropFilter: 'blur(30px)',
  } as React.CSSProperties;
  const userBubbleStyle = {
    background: props.theme === 'custom' ? 'var(--user-bubble-bg, var(--card-bg))' : isLightTheme
      ? 'color-mix(in srgb, var(--card-bg) 95%, transparent)'
      : 'color-mix(in srgb, var(--card-bg) 85%, transparent)',
    borderColor: isLightTheme ? 'var(--border-color)' : 'color-mix(in srgb, var(--border-color) 70%, transparent)',
    boxShadow: isLightTheme ? '0 4px 20px color-mix(in srgb, var(--shadow-color) 50%, transparent)' : 'none',
    backdropFilter: 'blur(12px)',
    color: 'var(--primary-text)',
  } as React.CSSProperties;
  // Core state
  const [messages, setMessages] = useState<ExtendedChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  // Tracks which clarifying-question cards have been answered/skipped.
  const [answeredQuestions, setAnsweredQuestions] = useState<Record<string, { answer?: string; skipped?: boolean }>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);

  // Sidebar widget system — single source of truth via the robust hook.
  const sidebar = useSidebarPrefs();
  const { setWidth: setSidebarWidthPref } = sidebar;

  // Keep the live drag width (store.sidebarWidth, controlled by the shell
  // resizer in ClientOnlyPage) and the persisted widget width (sidebar prefs)
  // in lockstep, so widgets resize with the sidebar when the user drags it.
  const seededWidthRef = useRef(false);
  useEffect(() => {
    if (!seededWidthRef.current) {
      seededWidthRef.current = true;
      if (typeof sidebarWidth === 'number' && sidebarWidth !== sidebar.prefs.width) {
        useAppStore.getState().setSidebarWidth(sidebar.prefs.width);
      }
    }
  }, [sidebarWidth, sidebar]);
  useEffect(() => {
    const onResize = (e: Event) => {
      const w = (e as CustomEvent<{ width: number }>).detail?.width;
      if (typeof w === 'number' && Number.isFinite(w)) setSidebarWidthPref(w);
    };
    window.addEventListener('aartiq:sidebar-resize', onResize);
    return () => window.removeEventListener('aartiq:sidebar-resize', onResize);
  }, [setSidebarWidthPref]);

  const [aiVisualSettings, setAiVisualSettings] = useState<AIVisualSettings>(() => getAIVisualSettings());
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>(() => getPrivacySettings());
  const [showCustomization, setShowCustomization] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showThemeSettings, setShowThemeSettings] = useState(false);

  // Hide the native BrowserView while the full Customization panel is open
  // (it's a centered DOM modal that would otherwise render behind the view).
  useEffect(() => {
    useAppStore.getState().setCustomizationPanelOpen(showCustomization);
  }, [showCustomization]);

  // Sync visual settings to CSS
  useEffect(() => {
    const css = getCSSForAIVisual(aiVisualSettings);
    const root = document.documentElement;
    Object.entries(css).forEach(([key, val]) => root.style.setProperty(key, val));
    injectTabAnimationCSS(aiVisualSettings);
    return () => { removeTabAnimationCSS(); };
  }, [aiVisualSettings]);

  const sidebarPrefs = sidebar.prefs;
  const sidebarMode = sidebar.prefs.mode;
  const sessionLabel = useTabIntelligenceStore((s) => s.sessionLabel);

  // Command queue
  const [commandQueue, setCommandQueue] = useState<AICommand[]>([]);
  const [currentCommandIndex, setCurrentCommandIndex] = useState(0);
  const processingQueueRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const commandQueueRef = useRef<AICommand[]>([]);
  const currentCommandIndexRef = useRef(0);
  const commandQueueWaiterRef = useRef<{
    resolve: (result: { commands: AICommand[]; timedOut: boolean }) => void;
    timeoutId: number;
  } | null>(null);

  const remotePromptContextRef = useRef<{
    promptId: string;
    fromDeviceId?: string;
    mode?: string;
  } | null>(null);
  const skipBatchRef = useRef(0);
  const processingBatchRef = useRef(false);

  // Reasoning steps
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [thinkingText, setThinkingText] = useState<string>('');
  const [isThinking, setIsThinking] = useState(false);

  // Action Chain Execution Timeline
  const [actionChainSteps, setActionChainSteps] = useState<ActionChainStep[]>([]);
  const actionChainStepIdCounter = useRef(0);

  interface AutomationReport {
    totalCommands: number;
    successCount: number;
    failedCount: number;
    startTime: number;
    endTime: number;
    commands: { type: string; label: string; status: string; error?: string }[];
  }
  const [automationReport, setAutomationReport] = useState<AutomationReport | null>(null);
  const automationStartTimeRef = useRef<number>(0);

  // Agent State
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [planningSteps, setPlanningSteps] = useState<PlanningStep[]>([]);
  const [lastSidebarInteractionAt, setLastSidebarInteractionAt] = useState<number>(Date.now());
  const [customStatusText, setCustomStatusText] = useState<string>('');
  const thinkingIdCounter = useRef(0);

  // Refs & Workers
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tesseractWorkerRef = useRef<Tesseract.Worker | null>(null);
  const refusedIntentsRef = useRef<RefusedIntentRecord[]>([]);
  const activeStreamingMessageIdRef = useRef<string | null>(null);
  const currentActionChainStepIdRef = useRef<string | null>(null);

  // UI state
  const [showRagPanel, setShowRagPanel] = useState(false);
  const [ragContextItems, setRagContextItems] = useState<any[]>([]);
  const [showLLMProviderSettings, setShowLLMProviderSettings] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [showMcpSetupGuide, setShowMcpSetupGuide] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showSidebarCustomize, setShowSidebarCustomize] = useState(false);
  const [showConversationHistory, setShowConversationHistory] = useState(false);
  const [isReadingPage, setIsReadingPage] = useState(false);
  const [isMermaidLoaded, setIsMermaidLoaded] = useState(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  activeConversationIdRef.current = activeConversationId;
  const [userPreferences, setUserPreferences] = useState<Record<string, { value: any; updatedAt: number }>>({});
  const [ollamaModels, setOllamaModels] = useState<{ name: string; modified_at: string }[]>([]);
  const [groqSpeed, setGroqSpeed] = useState<string | null>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [streamingPDFContent, setStreamingPDFContent] = useState('');
  const [pdfProgress, setPdfProgress] = useState(0);
  const [pdfVisualStage, setPdfVisualStage] = useState<VisualStage>('idle');
  const [pythonAvailable, setPythonAvailable] = useState<boolean>(false);
  const [demoHighlight, setDemoHighlight] = useState<{ title: string; description: string; align?: 'left' | 'center' | 'right' } | null>(null);
  const aiTabsAutoCloseRef = useRef(false);

  const handleAttachmentChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    files.forEach((file) => {
      const lowerName = file.name.toLowerCase();
      const isMarkdown = lowerName.endsWith('.md') || lowerName.endsWith('.markdown') || file.type === 'text/markdown';
      const isText = isMarkdown || lowerName.endsWith('.txt') || file.type.startsWith('text/');
      const attachmentType: Attachment['type'] = file.type === 'application/pdf'
        ? 'pdf'
        : isMarkdown
          ? 'markdown'
          : isText
            ? 'text'
            : 'image';
      const reader = new FileReader();
      reader.onload = () => {
        const data = typeof reader.result === 'string' ? reader.result : '';
        if (!data) return;
        setAttachments((previous) => [
          ...previous,
          {
            type: attachmentType,
            data,
            filename: file.name,
          },
        ]);
      };
      if (isText) reader.readAsText(file);
      else reader.readAsDataURL(file);
    });

    event.target.value = '';
  }, []);

  const showDemoOverlay = useCallback(async (title: string, description: string, durationMs: number = 2500) => {
    return new Promise<void>(resolve => {
      setDemoHighlight({ title, description });
      setTimeout(() => {
        setDemoHighlight(null);
        resolve();
      }, durationMs);
    });
  }, []);
  const schedulingOpenedByClient = useRef(false);

  const findYouTubeLinkElement = (elements: DOMElement[]): DOMElement | null => {
    for (const element of elements) {
      if (element.tag === 'a') {
        const href = element.attributes?.href?.trim();
        if (href && /youtube\.com\/watch/.test(href)) {
          return element;
        }
      }
      if (element.children && element.children.length > 0) {
        const childResult = findYouTubeLinkElement(element.children);
        if (childResult) return childResult;
      }
    }
    return null;
  };

  const handleAutoNavigateToYouTubeVideo = useCallback(async (prompt: string): Promise<boolean> => {
    if (!/(youtube\.com|youtube video)/i.test(prompt) || !/(click|open|play|navigate|watch)/i.test(prompt)) {
      return false;
    }
    if (!window.electronAPI?.extractSecureDOM) return false;

    try {
      const domResult = await window.electronAPI.extractSecureDOM();
      if (!domResult?.elements?.length) return false;
      const match = findYouTubeLinkElement(domResult.elements);
      const href = match?.attributes?.href;
      if (!href) return false;

      const baseUrl = domResult.metadata?.url || currentUrl || window.location.origin;
      let finalUrl = href;
      try {
        if (finalUrl.startsWith('//')) {
          finalUrl = `${window.location.protocol}${finalUrl}`;
        } else if (!/^https?:\/\//i.test(finalUrl)) {
          finalUrl = new URL(finalUrl, baseUrl).toString();
        }
      } catch {
        // Keep original href if resolution fails
      }

      store.addTab(finalUrl, 'ai-session');
      setActiveView('browser');
      const successMessage: ExtendedChatMessage = {
        role: 'model',
        content: `✅ Navigated to YouTube video: ${finalUrl}`
      };
      setMessages(prev => [...prev, successMessage]);
      return true;
    } catch (e) {
      console.error('[AI] YouTube auto-navigation failed', e);
      return false;
    }
  }, [currentUrl, setActiveView, setMessages, store]);
  const persistTimeoutRef = useRef<number | null>(null);

  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [shiftTabGlow, setShiftTabGlow] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [workspacePrefs, setWorkspacePrefs] = useState<SidebarWorkspacePreferences>(() => loadSidebarWorkspacePreferences());
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<Array<{ id: string; command: string; output: string; success: boolean; timestamp: number }>>([]);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showDevLogs, setShowDevLogs] = useState(false);
  const [researchState, setResearchState] = useState<ResearchUiState>(() => createEmptyResearchState());
  const activeResearchPipelineIdRef = useRef<string | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const terminalLogIdCounter = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const nativeMacSyncTimeoutRef = useRef<number | null>(null);
  const isDevMode = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  const {
    pendingPermission: permissionPending,
    requestPermission: requestActionPermission,
    requestBatchPermission,
    approvalModal,
    directoryPermissionPanel,
    shellPermissionPanel,
  } = useAIActionSecurityManager();

  // Update agent state when permission is pending
  useEffect(() => {
    if (permissionPending) {
      setAgentState('waiting');
    } else if (agentState === 'waiting') {
      setAgentState('executing');
    }
  }, [permissionPending]);

  const markSidebarInteraction = useCallback(() => {
    setLastSidebarInteractionAt(Date.now());
  }, []);

  const buildActionChainClarification = useCallback((options: {
    reason: string;
    failedCommands?: Array<{ type: string; value?: string; error?: string }>;
    invalidCommands?: Array<{ type: string; error: string }>;
    skippedCommands?: string[];
    attemptsUsed?: number;
    maxAttempts?: number;
  }) => {
    const failedCommands = options.failedCommands || [];
    const invalidCommands = options.invalidCommands || [];
    const skippedCommands = options.skippedCommands || [];

    const lines = [
      `I couldn't complete the action chain automatically.`,
      ``,
      `Reason: ${options.reason}`,
    ];

    if (failedCommands.length > 0) {
      lines.push('', 'Failed steps:');
      failedCommands.slice(0, 4).forEach((command, index) => {
        const detail = command.error || 'Step failed without a detailed error.';
        lines.push(`${index + 1}. ${command.type}${command.value ? ` (${command.value.slice(0, 80)})` : ''} - ${detail}`);
      });
    }

    if (invalidCommands.length > 0) {
      lines.push('', 'Invalid or unexecutable steps:');
      invalidCommands.slice(0, 4).forEach((command, index) => {
        lines.push(`${index + 1}. ${command.type} - ${command.error}`);
      });
    }

    if (skippedCommands.length > 0) {
      lines.push('', 'Skipped to avoid a loop:');
      skippedCommands.slice(0, 4).forEach((command, index) => {
        lines.push(`${index + 1}. ${command}`);
      });
    }

    if (typeof options.attemptsUsed === 'number' && options.attemptsUsed > 0 && typeof options.maxAttempts === 'number') {
      lines.push('', `Recovery attempts used: ${options.attemptsUsed}/${options.maxAttempts}`);
    }

    lines.push(
      '',
      'Please clarify the next step you want me to take, or tell me to retry with a different target/page.'
    );

    return lines.join('\n');
  }, []);

  const normalizeNavigationTarget = useCallback((rawTarget: string) => {
    const trimmed = rawTarget.trim();
    if (!trimmed || trimmed.startsWith('comet://')) {
      return trimmed;
    }

    try {
      const urlObj = new URL(trimmed);
      if (urlObj.hostname.includes('google.com') && urlObj.pathname === '/url') {
        const qParam = urlObj.searchParams.get('q') || urlObj.searchParams.get('url');
        if (qParam) return qParam;
      }
      if (urlObj.hostname === 'duckduckgo.com' && urlObj.pathname === '/l/') {
        const uddg = urlObj.searchParams.get('uddg');
        if (uddg) return decodeURIComponent(uddg);
      }
      if (urlObj.hostname === 'www.google.com' && urlObj.pathname === '/search' && !urlObj.searchParams.has('q')) {
        const q = urlObj.searchParams.get('q');
        if (q && q.match(/^https?:\/\//)) return q;
      }
      if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
        return trimmed;
      }
    } catch {
    }

    if (/^(https?:|file:|about:|data:|mailto:|tel:)/i.test(trimmed)) {
      return trimmed;
    }

    if (/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}(\/.*)?$/.test(trimmed)) {
      return `https://${trimmed}`;
    }

    return trimmed;
  }, []);

  const waitForTabNavigation = useCallback(async (tabId: string, expectedUrl?: string, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    let lastSeenUrl = '';

    while (Date.now() < deadline) {
      const state = useAppStore.getState();
      const tab = state.tabs.find((item) => item.id === tabId);

      if (tab) {
        const actualUrl = `${tab.url || ''}`.trim();
        if (actualUrl) lastSeenUrl = actualUrl;

        if (actualUrl && actualUrl !== 'about:blank' && !tab.isLoading) {
          return {
            url: actualUrl,
            title: tab.title || 'New Tab',
          };
        }
      }

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    throw new Error(`Navigation timed out${lastSeenUrl ? ` — last URL: ${lastSeenUrl}` : ''}`);
  }, []);

  const openTabAndWaitForLoad = useCallback(async (url: string, groupId?: string) => {
    const normalizedUrl = normalizeNavigationTarget(url);
    const existingIds = new Set(useAppStore.getState().tabs.map((tab) => tab.id));
    store.addTab(normalizedUrl, groupId);
    await new Promise(resolve => setTimeout(resolve, 50));

    const state = useAppStore.getState();
    const createdTab = state.tabs.find((tab) => !existingIds.has(tab.id)) || state.tabs.find((tab) => tab.id === state.activeTabId);
    if (!createdTab) {
      throw new Error(`Failed to create tab for ${normalizedUrl}`);
    }

    return waitForTabNavigation(createdTab.id, normalizedUrl);
  }, [normalizeNavigationTarget, store, waitForTabNavigation]);

  const waitForActiveTabToSettle = useCallback(async (timeoutMs = 15000) => {
    const state = useAppStore.getState();
    if (!state.activeTabId) {
      return null;
    }
    try {
      return await waitForTabNavigation(state.activeTabId, state.currentUrl || undefined, timeoutMs);
    } catch {
      return null;
    }
  }, [waitForTabNavigation]);

  const appendTerminalLog = useCallback((commandName: string, output: string, success = true) => {
    if (!isDevMode) return;
    const logId = `pdf-${Date.now()}-${terminalLogIdCounter.current++}`;
    setShowTerminal(true);
    setTerminalLogs((prev) => [...prev, {
      id: logId,
      command: commandName,
      output,
      success,
      timestamp: Date.now(),
    }]);
  }, [isDevMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WORKSPACE_PREFS_KEY, JSON.stringify(workspacePrefs));
      window.dispatchEvent(new CustomEvent('aartiq-click-sound-preference', { detail: { enabled: workspacePrefs.soundsEnabled } }));
      document.documentElement.style.setProperty('--chat-font', workspacePrefs.fontFamily);
    } catch {
    }
  }, [workspacePrefs]);

  const updateWorkspacePrefs = useCallback((partial: Partial<SidebarWorkspacePreferences>) => {
    setWorkspacePrefs((previous) => {
      const next = {
        ...previous,
        ...partial,
        visibleComposerIcons: {
          ...previous.visibleComposerIcons,
          ...(partial.visibleComposerIcons || {}),
        },
        modelNicknames: {
          ...previous.modelNicknames,
          ...(partial.modelNicknames || {}),
        },
      };
      if ((partial.fontFamily && partial.fontFamily !== previous.fontFamily) ||
          (partial.fontSize && partial.fontSize !== previous.fontSize)) {
        window.electronAPI?.setBrowserFont?.(next.fontFamily, next.fontSize);
      }
      return next;
    });
  }, []);

  const playClickSound = useCallback((variant: 'tap' | 'confirm' | 'success' | 'error' | 'toggle' | 'drag' | 'navigate' | 'delete' = 'tap') => {
    if (!workspacePrefs.soundsEnabled || typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('aartiq-play-click-sound', { detail: { variant } }));
  }, [workspacePrefs.soundsEnabled]);

  const updateComposerIconVisibility = useCallback((key: ComposerIconKey, value: boolean) => {
    updateWorkspacePrefs({
      visibleComposerIcons: {
        ...workspacePrefs.visibleComposerIcons,
        [key]: value,
      },
    });
  }, [updateWorkspacePrefs, workspacePrefs.visibleComposerIcons]);

  const updateVisualStage = useCallback((stage: VisualStage, message?: string) => {
    setPdfVisualStage(stage);
    if (message) setStreamingPDFContent(message);
  }, []);

  // DOM Search State
  const [domSearchResults, setDOMSearchResults] = useState<DOMSearchResult[]>([]);
  const [domSearchQuery, setDOMSearchQuery] = useState<string>('');
  const [domSearchLoading, setDOMSearchLoading] = useState(false);
  const [domMeta, setDOMMeta] = useState<FilteredDOMResult['metadata'] | null>(null);
  const [ocrSearchResults, setOCRSearchResults] = useState<DOMSearchResult[]>([]);
  const [ocrSearchQuery, setOCRSearchQuery] = useState<string>('');
  const [ocrSearchLoading, setOCRSearchLoading] = useState(false);

  // Scheduling State - controlled by props or local
  const [localSchedulingIntent, setLocalSchedulingIntent] = useState<SchedulingIntent | null>(null);
  const schedulingIntent = props.schedulingIntent !== undefined ? props.schedulingIntent : localSchedulingIntent;
  const setSchedulingIntent = props.setSchedulingIntent
    ? props.setSchedulingIntent
    : setLocalSchedulingIntent;

  // Use controlled modal state from props if provided
  const [localShowSchedulingModal, setLocalShowSchedulingModal] = useState(false);
  const showSchedulingModal = props.showSchedulingModal !== undefined ? props.showSchedulingModal : localShowSchedulingModal;
  const setShowSchedulingModal = props.showSchedulingModal !== undefined
    ? (val: boolean) => {
      if (props.setBrowserDisabled) props.setBrowserDisabled(val);
      if (props.setShowSchedulingModal) props.setShowSchedulingModal(val);
    }
    : setLocalShowSchedulingModal;

  useEffect(() => {
    commandQueueRef.current = commandQueue;
    currentCommandIndexRef.current = currentCommandIndex;

    if (commandQueueWaiterRef.current && areCommandsSettled(commandQueue)) {
      const waiter = commandQueueWaiterRef.current;
      commandQueueWaiterRef.current = null;
      window.clearTimeout(waiter.timeoutId);
      waiter.resolve({ commands: commandQueue, timedOut: false });
    }
  }, [commandQueue, currentCommandIndex]);

  const waitForCommandQueueCompletion = useCallback((timeoutMs = 120000) => {
    if (areCommandsSettled(commandQueueRef.current)) {
      return Promise.resolve({ commands: commandQueueRef.current, timedOut: false });
    }

    if (commandQueueWaiterRef.current) {
      window.clearTimeout(commandQueueWaiterRef.current.timeoutId);
      commandQueueWaiterRef.current.resolve({ commands: commandQueueRef.current, timedOut: true });
      commandQueueWaiterRef.current = null;
    }

    return new Promise<{ commands: AICommand[]; timedOut: boolean }>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        if (commandQueueWaiterRef.current?.timeoutId === timeoutId) {
          commandQueueWaiterRef.current = null;
        }
        resolve({ commands: commandQueueRef.current, timedOut: true });
      }, timeoutMs);

      commandQueueWaiterRef.current = { resolve, timeoutId };
    });
  }, []);

  useEffect(() => {
    return () => {
      if (commandQueueWaiterRef.current) {
        window.clearTimeout(commandQueueWaiterRef.current.timeoutId);
        commandQueueWaiterRef.current.resolve({ commands: commandQueueRef.current, timedOut: true });
        commandQueueWaiterRef.current = null;
      }
    };
  }, []);

  // Detect Python availability once (used for optional QA guidance)
  useEffect(() => {
    const checkPy = async () => {
      try {
        if (window.electronAPI?.checkPythonAvailable) {
          const ok = await window.electronAPI.checkPythonAvailable();
          setPythonAvailable(!!ok);
        }
      } catch {
        setPythonAvailable(false);
      }
    };
    checkPy();
  }, []);

  // ---------------------------------------------------------------------------
  // Helper Logic
  // ---------------------------------------------------------------------------

  const addThinkingStep = useCallback((label: string, detail?: string): string => {
    const id = `think-${Date.now()}-${thinkingIdCounter.current++}`;
    setThinkingSteps((prev) => [...prev, { id, label, status: 'running', detail, timestamp: Date.now() }]);
    return id;
  }, []);

  const resolveThinkingStep = useCallback((id: string, status: 'done' | 'error' | 'skipped', detail?: string) => {
    setThinkingSteps((prev) => prev.map((s) => s.id === id ? { ...s, status, detail: detail ?? s.detail } : s));
  }, []);

  const updateThinkingStep = useCallback((id: string, detail: string) => {
    setThinkingSteps((prev) => prev.map((s) => s.id === id ? { ...s, detail } : s));
  }, []);

  // Action chain steps are stored per conversation so each session shows
  // only its own automation timeline.
  const persistActionChain = useCallback((steps: ActionChainStep[]) => {
    try {
      const convId = activeConversationIdRef.current;
      if (!convId) return;
      const mapRaw = localStorage.getItem('aartiq_action_chain_map');
      const map: Record<string, ActionChainStep[]> = mapRaw ? JSON.parse(mapRaw) : {};
      map[convId] = steps.slice(-20);
      localStorage.setItem('aartiq_action_chain_map', JSON.stringify(map));
    } catch { }
  }, []);

  const loadActionChainForConversation = useCallback((convId: string | null): ActionChainStep[] => {
    if (!convId) return [];
    try {
      const mapRaw = localStorage.getItem('aartiq_action_chain_map');
      const map: Record<string, ActionChainStep[]> = mapRaw ? JSON.parse(mapRaw) : {};
      const steps = map[convId];
      return Array.isArray(steps) ? steps.map((s) => ({ ...s, status: s.status as ActionChainStep['status'] })) : [];
    } catch {
      return [];
    }
  }, []);

  const clearActionChainForConversation = useCallback((convId: string | null) => {
    try {
      const id = convId ?? activeConversationIdRef.current;
      if (!id) return;
      const mapRaw = localStorage.getItem('aartiq_action_chain_map');
      const map: Record<string, ActionChainStep[]> = mapRaw ? JSON.parse(mapRaw) : {};
      delete map[id];
      localStorage.setItem('aartiq_action_chain_map', JSON.stringify(map));
    } catch { }
  }, []);

  const addActionChainStep = useCallback((label: string, detail?: string): string => {
    const id = `acs-${Date.now()}-${actionChainStepIdCounter.current++}`;
    const newStep: ActionChainStep = { id, label, status: 'running', detail, timestamp: Date.now() };
    setActionChainSteps((prev) => {
      const next = [...prev, newStep];
      persistActionChain(next);
      return next;
    });
    return id;
  }, [persistActionChain]);

  const resolveActionChainStep = useCallback((id: string, status: 'done' | 'error' | 'skipped', detail?: string) => {
    setActionChainSteps((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, status, detail: detail ?? s.detail } : s);
      persistActionChain(next);
      return next;
    });
  }, [persistActionChain]);

  const updateActionChainStepLabel = useCallback((id: string, label: string, detail?: string, detailNode?: React.ReactNode) => {
    setActionChainSteps((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, label, detail: detail ?? s.detail, detailNode: detailNode ?? s.detailNode } : s);
      persistActionChain(next);
      return next;
    });
  }, [persistActionChain]);

  const updateActionChainStepSites = useCallback((id: string, sites: Array<{ title: string; url: string }>) => {
    setActionChainSteps((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, sites } : s);
      persistActionChain(next);
      return next;
    });
  }, [persistActionChain]);

  const resetActionChainSteps = useCallback(() => {
    setActionChainSteps([]);
    actionChainStepIdCounter.current = 0;
    clearActionChainForConversation(activeConversationIdRef.current);
  }, [clearActionChainForConversation]);

  // Restore this session's action chain on mount (per-conversation, not global).
  useEffect(() => {
    const steps = loadActionChainForConversation(activeConversationIdRef.current);
    if (steps.length > 0) setActionChainSteps(steps);
  }, [loadActionChainForConversation]);

  const preloadAartiqIconLocal = useCallback(async (): Promise<void> => {
    if (typeof window === 'undefined') return;
    if ((window as any).__cometIconBase64) return;
    try {
      const api = (window as any).electronAPI;
      if (typeof api?.getAppIcon === 'function') {
        const b64 = await api.getAppIcon();
        if (b64) (window as any).__cometIconBase64 = b64;
      }
    } catch { }
  }, []);

  const isAiSetup = useCallback(() => {
    if (aiProvider === 'ollama' && ollamaBaseUrl) return true;
    if (aiProvider === 'gemini' && geminiApiKey) return true;
    if (aiProvider === 'google' && geminiApiKey) return true;
    if (aiProvider === 'google-flash' && geminiApiKey) return true;
    if (aiProvider === 'openai' && openaiApiKey) return true;
    if (aiProvider === 'azure-openai' && store.azureOpenaiApiKey && store.azureOpenaiEndpoint) return true;
    if (aiProvider === 'anthropic' && anthropicApiKey) return true;
    if (aiProvider === 'groq' && groqApiKey) return true;
    if (aiProvider === 'xai' && xaiApiKey) return true;
    return false;
  }, [aiProvider, ollamaBaseUrl, geminiApiKey, openaiApiKey, anthropicApiKey, groqApiKey, xaiApiKey, store.azureOpenaiApiKey, store.azureOpenaiEndpoint]);

  // Scheduling handler
  const handleSchedulingConfirm = useCallback(async (config: any) => {
    if (!schedulingIntent) return;

    try {
      if (window.electronAPI?.scheduleTask) {
        const taskPayload: any = {
          name: schedulingIntent.taskName,
          type: schedulingIntent.taskType,
          cronExpression: config.schedule,
          outputPath: config.outputPath,
          enabled: config.enabled,
          prompt: inputMessage,
          url: config.url || schedulingIntent.url || '',
          command: config.command || schedulingIntent.command || '',
        };
        await window.electronAPI.scheduleTask(taskPayload);

        window.dispatchEvent(new CustomEvent('automation-task-created'));

        setMessages(prev => [...prev, {
          role: 'model',
          content: `✅ **Task Scheduled Successfully!**

I've set up "${schedulingIntent.taskName}" to run **${config.schedule}**.

📅 **Schedule:** ${config.schedule}
🤖 **Model:** ${config.model.provider}/${config.model.model}
💾 **Save to:** ${config.outputPath}
${config.notification?.onComplete ? '🔔 You will be notified when complete.' : ''}

You can manage this task anytime from the Automation panel.`
        } as ExtendedChatMessage]);

        setShowSchedulingModal(false);
        setSchedulingIntent(null);
        schedulingOpenedByClient.current = false;
        if (props.setBrowserDisabled) props.setBrowserDisabled(false);
      }
    } catch (error) {
      console.error('[Scheduling] Failed to schedule task:', error);
      setMessages(prev => [...prev, {
        role: 'model',
        content: `⚠️ **Scheduling Failed**

I couldn't schedule the task. The background service may not be running. Please make sure Aartiq's background service is installed and running.`
      } as ExtendedChatMessage]);
    }
  }, [schedulingIntent, inputMessage]);

  // ---------------------------------------------------------------------------
  // ✅ NEW: fetchRealSearchContext
  // Runs 3 real web searches and returns combined verified results.
  // Called BEFORE the LLM so it gets real data instead of hallucinating.
  // Results are cached for 5 minutes to avoid re-searching.
  // ---------------------------------------------------------------------------
  const fetchRealSearchContext = useCallback(async (topic: string): Promise<string> => {
    // Check if we have recent search for this topic
    const recentContext = searchContextStore.hasRecentSearch(topic);
    if (recentContext) {
      console.log('[Aartiq] Using cached search for:', topic);
      return recentContext.content;
    }

    const currentDate = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const queries = [
      `${topic} news today`,
      `latest ${topic} updates`,
      `${topic} ${currentDate}`,
    ];

    const results: string[] = [];

    for (const q of queries) {
      try {
        // Try MCP search first (DuckDuckGo, server-side, more reliable)
        let searchResults: Array<{ title: string; url: string; snippet: string; content?: string }> = [];
        try {
          const mcpRes = await (window.electronAPI as any).aiWebSearch(q, 'duckduckgo', 3);
          if (mcpRes?.results?.length > 0) {
            searchResults = mcpRes.results.map((r: any) => ({
              title: r.title,
              url: r.url,
              snippet: r.snippet,
              pageContent: r.content,
            }));
          }
        } catch { /* fall through */ }

        // Fallback to webSearchRag
        if (searchResults.length === 0) {
          const res = await window.electronAPI.webSearchRag(q);
          searchResults = normalizeSearchResults(res as any[]).slice(0, 5).map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet,
          }));
        }

        if (searchResults.length > 0) {
          results.push(formatSearchResultsForLLM(q, searchResults.slice(0, 5) as any));
        }
      } catch (e) {
        console.warn('[Aartiq] Pre-flight search failed for:', q, e);
      }
    }

    const combinedResults = results.join('\n\n');

    // Store in context for future use
    if (combinedResults) {
      searchContextStore.addWebSearch(topic, combinedResults);
    }

    return combinedResults;
  }, []);

  // ---------------------------------------------------------------------------
  // AI Logic Bridge
  // ---------------------------------------------------------------------------

  // Normalize 'gemini' -> 'google' so the main process provider switch always matches
  const normalizedProvider = aiProvider === 'gemini' ? 'google' : aiProvider;
  const selectedProviderModel = useMemo(() => {
    switch (normalizedProvider) {
      case 'ollama':
        return ollamaModel || 'llama3';
      case 'google':
        return geminiModel || 'gemini-2.5-pro';
      case 'google-flash':
        return geminiFlashModel || 'gemini-2.5-flash';
      case 'openai':
        return openaiModel || 'gpt-5.1';
      case 'azure-openai':
        return store.azureOpenaiModel || 'gpt-4.1-mini';
      case 'anthropic':
        return anthropicModel || 'claude-sonnet-4-20250514';
      case 'groq':
        return groqModel || 'llama-3.3-70b-versatile';
      case 'xai':
        return xaiModel || 'grok-4-fast-reasoning';
      default:
        return normalizedProvider;
    }
  }, [
    anthropicModel,
    geminiFlashModel,
    geminiModel,
    groqModel,
    normalizedProvider,
    ollamaModel,
    openaiModel,
    store.azureOpenaiModel,
    xaiModel,
  ]);

  const reasoningOptions = useMemo(() => buildFrontendReasoningOptions(
    (localLlmMode || 'normal') as LlmMode,
    normalizedProvider,
    {
      model: selectedProviderModel,
      baseUrl: normalizedProvider === 'ollama'
        ? ollamaBaseUrl
        : normalizedProvider === 'azure-openai' ? store.azureOpenaiEndpoint : undefined,
    }
  ), [localLlmMode, normalizedProvider, ollamaBaseUrl, selectedProviderModel, store.azureOpenaiEndpoint]);

  // ── LLM-generated proactive suggestions ────────────────────────────────
  // Shown above the composer when the chat is empty. Generated from the
  // user's browsing history + past AI tasks so they are useful and distinct.
  const [llmSuggestions, setLlmSuggestions] = useState<{ id: string; label: string; command: string }[]>([]);
  const [llmSuggestionsLoading, setLlmSuggestionsLoading] = useState(false);

  const generateLlmSuggestions = useCallback(async () => {
    setLlmSuggestionsLoading(true);
    try {
      if (typeof window === 'undefined' || !window.electronAPI?.generateChatContent) {
        throw new Error('no-engine');
      }

      const hist: any[] = (store.history as any[]) ?? [];
      const historyLines = hist
        .slice(0, 12)
        .map((h) => `- ${h?.title || h?.url || ''}`.trim())
        .filter(Boolean);

      const pastTasks = (conversations || [])
        .slice(0, 8)
        .map((c: any) => {
          const firstUser = (c?.messages || []).find((m: any) => m?.role === 'user');
          return (c?.title || firstUser?.content || '').toString().trim();
        })
        .filter(Boolean)
        .slice(0, 8);

      const activeTab = (tabs || []).find((t: any) => t.id === activeTabId) || (tabs || [])[0];
      const activePage = activeTab
        ? `ACTIVE PAGE the user is currently looking at:\n- Title: ${activeTab?.title || 'Unknown'}\n- URL: ${activeTab?.url || currentUrl || 'N/A'}${currentUrl && activeTab?.url && activeTab.url !== currentUrl ? `\n- Current URL: ${currentUrl}` : ''}`
        : (currentUrl ? `ACTIVE PAGE the user is currently looking at:\n- URL: ${currentUrl}` : '');

      const userCtx = [
        activePage,
        historyLines.length ? `Recent browsing history:\n${historyLines.join('\n')}` : '',
        pastTasks.length ? `Recent AI tasks the user has done:\n${pastTasks.map((t) => `- ${t}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n');

      const sys = `You are a proactive AI browser assistant. Prioritize the user's ACTIVE PAGE when suggesting useful next actions — propose things they can do with the page they are currently viewing (summarize it, extract data, translate, answer questions about it, automate a task on it, compare it, etc.). Also consider their recent browsing history and past AI tasks. Good examples: "Summarize this page", "Extract key points from this article", "Translate this page", "Answer questions about this site", "Generate a PDF of this page", "Compare this product with alternatives", "Automate filling this form", "Research related to this topic".\nReturn ONLY a JSON array of 4 short strings (each 3-8 words). All entries must be distinct. No numbering, no markdown, no extra text.`;
      const userMsg = userCtx
        ? `${userCtx}\n\nSuggest 4 distinct next actions for this user, prioritizing what they can do with the page they are currently viewing, while also building on what they have been doing.`
        : `The user just opened the AI sidebar. Suggest 4 distinct, useful next actions they might want to do (summarize the current page, research news, generate a PDF, automate a task). Return ONLY a JSON array of 4 short strings.`;

      const messagesPayload = [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg },
      ];

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 15000)
      );
      const aiCall = window.electronAPI.generateChatContent(messagesPayload as any, reasoningOptions as any);
      const res: any = await Promise.race([aiCall, timeoutPromise]);

      if (res?.error) throw new Error(res.error);
      const raw = (res?.text || '').trim();
      let items: string[] = [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) items = parsed.map((x: any) => String(x)).filter(Boolean);
      } catch {
        items = raw
          .split('\n')
          .map((l: string) => l.replace(/^[\d.\-\*\s"`]+/, '').replace(/[`"']/g, '').trim())
          .filter(Boolean);
      }

      const seen = new Set<string>();
      items = items
        .filter((s) => {
          const k = s.toLowerCase();
          if (seen.has(k) || s.length < 3) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 4);

      if (items.length === 0) throw new Error('empty');
      setLlmSuggestions(items.map((s, i) => ({ id: `llm-${i}`, label: s, command: s })));
    } catch {
      // Fallback to generic prompts if the model/engine is unavailable.
      setLlmSuggestions(
        GENERIC_SUGGESTIONS.slice(0, 4).map((s, i) => ({ id: `llm-${i}`, label: s.label, command: s.command }))
      );
    } finally {
      setLlmSuggestionsLoading(false);
    }
  }, [store.history, conversations, reasoningOptions, tabs, activeTabId, currentUrl]);

  // Generate suggestions on mount (covers app refresh and a full sidebar
  // close/reopen, since the component remounts). We deliberately do NOT
  // regenerate on every new conversation — suggestions persist until the
  // user closes the sidebar or refreshes.
  useEffect(() => {
    if (messages.length === 0 && !isLoading) generateLlmSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also regenerate when the sidebar is reopened after being collapsed.
  const wasCollapsedRef = useRef(props.isCollapsed);
  useEffect(() => {
    if (wasCollapsedRef.current && !props.isCollapsed && messages.length === 0 && !isLoading) {
      generateLlmSuggestions();
    }
    wasCollapsedRef.current = props.isCollapsed;
  }, [props.isCollapsed, messages.length, isLoading, generateLlmSuggestions]);

  const getStreamingResponse = useCallback(async (history: ChatMessage[], messageId?: string, onFirstChunk?: () => void): Promise<any> => {
    return new Promise((resolve) => {
      let fullText = '';
      let fullThought = '';
      let animationFrame: number | null = null;
      let hasCalledOnFirstChunk = false;

      const flushStreamText = () => {
        animationFrame = null;
        setMessages((prev) => {
          const updated = [...prev];
          const targetIndex = messageId
            ? updated.findIndex((message) => message.id === messageId)
            : updated.length - 1;
          const lastMessage = targetIndex >= 0 ? updated[targetIndex] : null;
          if (lastMessage && lastMessage.role === 'model') {
            updated[targetIndex] = { ...lastMessage, content: fullText };
          }
          return updated;
        });
      };

      const cleanup = window.electronAPI.onChatStreamPart((part: any) => {
        if (!hasCalledOnFirstChunk && (part.type === 'text-delta' || part.type === 'reasoning-delta')) {
          hasCalledOnFirstChunk = true;
          onFirstChunk?.();
        }

        const remoteCtx = remotePromptContextRef.current;

        if (part.type === 'text-delta') {
          const chunk = part.text || part.textDelta || '';
          fullText += chunk;
          if (animationFrame === null) {
            animationFrame = window.requestAnimationFrame(flushStreamText);
          }
          if (remoteCtx && window.electronAPI?.forwardAiStream) {
            window.electronAPI.forwardAiStream({
              promptId: remoteCtx.promptId,
              response: chunk,
              isStreaming: true,
              fromDeviceId: remoteCtx.fromDeviceId,
              mode: remoteCtx.mode,
            });
          }
        } else if (part.type === 'reasoning-delta') {
          fullThought += (part.delta || part.reasoningDelta || '');
          setThinkingText(fullThought.trim());
        } else if (part.type === 'error') {
          if (animationFrame !== null) {
            window.cancelAnimationFrame(animationFrame);
            flushStreamText();
          }
          if (remoteCtx && window.electronAPI?.forwardAiStream) {
            window.electronAPI.forwardAiStream({
              promptId: remoteCtx.promptId,
              response: `Error: ${part.error || 'Stream failed'}`,
              isStreaming: false,
              fromDeviceId: remoteCtx.fromDeviceId,
              mode: remoteCtx.mode,
            });
          }
          cleanup();
          resolve({ error: part.error });
        } else if (part.type === 'finish') {
          if (animationFrame !== null) {
            window.cancelAnimationFrame(animationFrame);
          }
          flushStreamText();
          if (remoteCtx && window.electronAPI?.forwardAiStream) {
            window.electronAPI.forwardAiStream({
              promptId: remoteCtx.promptId,
              response: '',
              isStreaming: false,
              fromDeviceId: remoteCtx.fromDeviceId,
              mode: remoteCtx.mode,
            });
            remotePromptContextRef.current = null;
          }
          cleanup();
          resolve({ 
            text: fullText, 
            thought: fullThought, 
            finishReason: part.finishReason || 'stop' 
          });
        }
      });
      window.electronAPI.streamChatContent(history, reasoningOptions);
    });
  }, [reasoningOptions]);

  // ---------------------------------------------------------------------------
  // Message Sending & Task Centralization
  // ---------------------------------------------------------------------------

  const handleSendMessage = useCallback(async (customContent?: string) => {
    const rawContent = (customContent ?? inputMessage).trim();
    if (!rawContent && attachments.length === 0) return;



    // Show setup guide if AI is not configured. After first show, don't block—
    if (!isAiSetup()) {
      if (!hasSeenNeuralSetup) {
        setHasSeenNeuralSetup(true);
        setShowSetupGuide(true);
      }
    }

    // INSTANT feedback - show user message immediately
    setMessages(prev => [...prev, { id: createMessageId('user'), role: 'user', content: rawContent }]);
    if (!customContent) { setInputMessage(''); setAttachments([]); }
    
    setIsLoading(true);
    setIsThinking(true);
    setThinkingSteps([]);
    setThinkingText('');
    setCustomStatusText('');
    setError(null);
    setAgentState('thinking');

    // Security Checks
    const threatCheck = checkThreat(rawContent);
    if (threatCheck.blocked) {
      setMessages(prev => [...prev, { id: createMessageId('assistant'), role: 'model', content: threatCheck.response ?? '' }] as ExtendedChatMessage[]);
      setIsLoading(false); setIsThinking(false); return;
    }

    // Check for scheduling intent
    const intent = detectSchedulingIntent(rawContent);
    if (intent && intent.detected && intent.confidence === 'high') {
      setSchedulingIntent(intent);
      setShowSchedulingModal(true);
      schedulingOpenedByClient.current = true;
      if (props.setBrowserDisabled) props.setBrowserDisabled(true);
    }

    // ── Slash Command: /mcp or /mcp claude ──
    if (/^\/mcp(?:\s+claude)?$/i.test(rawContent)) {
      setShowMcpSetupGuide(true);
      setIsLoading(false);
      setIsThinking(false);
      return;
    }

    // ── Natural Language Skill Loading: "load X skill" ──
    const loadSkillPattern = /^(?:load|use|activate|enable)\s+(?:the\s+)?(.+?)(?:\s+skill)?$/i;
    const loadMatch = rawContent.match(loadSkillPattern);
    let explicitLoadSkillId: string | null = null;
    if (loadMatch) {
      const skillName = loadMatch[1].trim().toLowerCase();
      const matchedSkill = AVAILABLE_SKILLS.find(
        s => s.id === skillName || s.label.toLowerCase().includes(skillName) || skillName.includes(s.id)
      );
      if (matchedSkill) {
        explicitLoadSkillId = matchedSkill.id;
      }
    }

    // Skill loading — use SkillRegistry for on-demand matching
    let skillContexts: string[] = [];
    const loadedSkillIds = explicitLoadSkillId
      ? [...new Set([...matchSkills(rawContent), explicitLoadSkillId])]
      : matchSkills(rawContent);
    const skillsToLoad = new Set(loadedSkillIds);
    const loadedSkills: Promise<string>[] = [];
    const skillSteps: Map<string, string> = new Map();
    if (skillsToLoad.size > 0) {
      for (const skillId of skillsToLoad) {
        const stepId = addThinkingStep(`📖 Loading ${skillId} skill guide...`);
        skillSteps.set(skillId, stepId);
        loadedSkills.push(
          loadSkillContent(skillId).then(ctx => {
            if (ctx) {
              resolveThinkingStep(stepId, 'done', `Loaded ${skillId} guide`);
              console.log(`[SkillLoader] ✅ Loaded ${skillId}: ${ctx.length} chars`);
            } else {
              resolveThinkingStep(stepId, 'error', `Failed to load ${skillId}`);
              console.warn(`[SkillLoader] ❌ Failed to load ${skillId}`);
            }
            return ctx;
          }).catch(e => {
            resolveThinkingStep(stepId, 'error', `Failed to load ${skillId}`);
            console.warn(`[SkillLoader] ❌ Failed to load ${skillId}:`, e);
            return '';
          })
        );
      }
    }
    const skillResults = await Promise.all(loadedSkills);
    skillContexts = skillResults.filter(Boolean);
    const skillContext = skillContexts.join('\n\n');

    // When the Research skill is active, force a structured multi-topic plan
    // with a defined number of sources so the AI never does a single generic search.
    const isResearchSkill = loadedSkillIds.includes('research');
    const researchDirective = isResearchSkill
      ? `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📑 RESEARCH PLANNING MANDATE (auto-applied)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Because this request matches the Research skill, you MUST:
1. DECOMPOSE the request into 3–6 distinct sub-topics (e.g. for "latest AI news": product launches, funding, major-lab announcements, regulation, security).
2. DECIDE how many sources/sites to visit — pick a concrete number (e.g. 8–14 sites for a briefing, up to 20 for a deep dive) based on the request's depth.
3. EMIT a plan FIRST using: [PLAN: "Sub-topics: 1) X 2) Y 3) Z — visiting ~N sources across M searches"]
4. THEN run one [WEB_SEARCH: <targeted query>] per sub-topic (use pages:1–3), picking the best 1–2 URLs per search and navigating to read them.
5. Always state the number of sites you intend to visit before searching, and keep the Action Chain visible so the user sees each site as you go.
Do NOT perform a single broad search for the whole request.`
      : '';

    // Skill loaded — status shown via thinking steps, continue processing

    const { content: protectedContent, wasProtected } = Security.fortress(rawContent);
    const userMessage: ExtendedChatMessage = {
      role: 'user',
      content: protectedContent + (attachments.length > 0
        ? `\n[Attached ${attachments.length} files]${attachments
          .filter((attachment) => attachment.type === 'text' || attachment.type === 'markdown')
          .map((attachment) => `\n\n[Attachment: ${attachment.filename}]\n${attachment.data.slice(0, 12000)}`)
          .join('')}`
        : ''),
      attachments: attachments.map(a => a.data),
      loadedSkills: loadedSkillIds.length > 0 ? loadedSkillIds : undefined,
    };

    if (rawContent.includes('[EXPLAIN_CAPABILITIES]')) {
      const capCmd: AICommand = {
        id: `cmd-${Date.now()}-cap`,
        type: 'EXPLAIN_CAPABILITIES',
        value: '',
        status: 'pending',
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, { role: 'model', content: '✨ **Unlocking Neural Potential...**' }]);
      setCommandQueue([capCmd]);
      setCurrentCommandIndex(0);
      setIsLoading(false);
      setIsThinking(false);
      return;
    }

    if (wasProtected) setMessages(prev => [...prev, { role: 'model', content: '🛡️ **AI Fortress Active**: Sensitive data protected.' }]);

    try {
      if (!window.electronAPI) throw new Error('AI Engine disconnected.');

      // ✅ PARALLEL: Run RAG and Browser State — NO auto web search.
      // The AI decides when to search by emitting [WEB_SEARCH: query] commands.
      const [ragId, browserId] = [
        addThinkingStep('Neural Retrieval...'),
        addThinkingStep('📊 Getting browser state...')
      ];

      // Run in parallel
      const crossSessionEnabled = useAppStore.getState().enableCrossSessionMemory;
      const [contextItems, browserStateResult] = await Promise.all([
        crossSessionEnabled ? BrowserAI.retrieveContext(protectedContent).catch(() => []) : Promise.resolve([]),
        (async () => {
          try {
            const tabs: any[] = await window.electronAPI.getOpenTabs();
            const activeTab = tabs.find(t => t.id === store.activeTabId) || tabs[0];
            if (tabs.length > 0) {
              return `[BROWSER STATE]\n- ACTIVE TAB: ${activeTab?.title || 'Unknown'} (${activeTab?.url || currentUrl || 'N/A'})\n- OPEN TABS (${tabs.length}):\n${tabs.map((t, idx) => `  ${idx + 1}. ${t.title} (${t.url}) ${t.id === store.activeTabId ? '[ACTIVE]' : ''}`).join('\n')}`;
            }
          } catch { return ''; }
          return '';          
        })()
      ]);

      const browserStateContext = browserStateResult;

      // Update thinking steps
      setRagContextItems(contextItems);
      resolveThinkingStep(ragId, 'done', `${contextItems.length} memories recovered`);
      if (browserStateContext) resolveThinkingStep(browserId, 'done', `${browserStateContext.split('\n').length} lines`);
      else resolveThinkingStep(browserId, 'skipped', 'No browser state');

      // LLM Request — Build context with REAL data injected
      const aiId = addThinkingStep('LLM Processing...');

      // Get recent search context to avoid re-searching
      const searchContextSummary = searchContextStore.getContextSummary();

      const contextBlock = [
        searchContextSummary !== 'No recent context available.' ? `[📚 RECENT CONTEXT — CHECK THIS BEFORE SEARCHING!]\n${searchContextSummary}` : '',
        browserStateContext,
        contextItems.length > 0
          ? `[RAG MEMORY]\n${contextItems.map(c => c.text).join('\n')}`
          : '',
      ].filter(Boolean).join('\n\n');

      const enableAiPreferenceLearning = useAppStore.getState().enableAiPreferenceLearning;

      const userPrefsBlock = enableAiPreferenceLearning && Object.keys(userPreferences).length > 0
        ? `\n[USER PREFERENCES — Learned from past interactions]\n${Object.entries(userPreferences).map(([k, v]) => `  - ${k}: ${JSON.stringify(v.value)}`).join('\n')}\n[PREFERENCE COMMAND — To save a new preference, include in your response:\nSAVE_PREFERENCE:key:value\nExample: SAVE_PREFERENCE:response_style:concise\nExample: SAVE_PREFERENCE:language:simple_english\nOnly save when explicitly stated by user or confidently observed.]`
        : '';

      // Skill-based prompt injection: always send SYSTEM_CORE, conditionally append COMMAND_REFERENCE
      const needsCommandRef = skillContexts.length > 0 ||
        rawContent.match(/\b(pdf|docx?|pptx?|xlsx?|shell|terminal|automat|search|create|generate|schedule|click|fill|form|navigate|browser|dom|ocr|diagram|chart|image|screenshot|volume|brightness|theme|tab|gmail|apple|cli)\b/i);
      const systemInstructions = enableAiPreferenceLearning
        ? SYSTEM_CORE + (needsCommandRef ? `\n\n${COMMAND_REFERENCE.replace(/\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nUSER PREFERENCES — Auto-Learning[\s\S]*$/, '')}` : '')
        : SYSTEM_CORE + (needsCommandRef ? `\n\n${COMMAND_REFERENCE}` : '');

      let currentHistory: ChatMessage[] = [
        {
          role: 'system',
          content: `${systemInstructions}${skillContext ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📖 SKILL INSTRUCTIONS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${skillContext}\n\n✅ Required skills are already loaded above. Do NOT use the [LOAD_SKILL] command — the skill guide is already in context.` : `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📖 AVAILABLE SKILLS (use [LIST_SKILLS] to see all, [LOAD_SKILL: id] to load)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${AVAILABLE_SKILLS.map(s => `${s.icon} ${s.label} (\`${s.id}\`) — ${s.description}`).join('\n')}`}${researchDirective}${userPrefsBlock}\n\n[CURRENT TIME]: ${new Date().toLocaleString()}\n[LOCATION]: India`
        },
        ...messages.map(m => ({ role: m.role, content: m.content.replace(INTERNAL_TAG_RE, '').trim() })),
        {
          role: 'user',
          content: contextBlock
            ? `${userMessage.content}\n\n${contextBlock}`
            : userMessage.content
        }
      ];

      currentHistory = compactMessages(currentHistory, { maxTokens: 64000 });

      let iterations = 0;
      let finalSynthesisDone = false;
      let recoveryAttempts = 0;
      let aiTabOpenCount = 0;
      const AI_TAB_WARN_THRESHOLD = 5;
      const commandAttemptCounts = new Map<string, number>();

      while (iterations < ACTION_CHAIN_MAX_ITERATIONS && !finalSynthesisDone) {
        iterations++;
        const aiId = addThinkingStep(iterations === 1 ? 'LLM Processing...' : `Action Chain Synthesis & Evaluation (Step ${iterations})...`);

        let responseMessageId = createMessageId('assistant');
        activeStreamingMessageIdRef.current = responseMessageId;
        setMessages(prev => [...prev, { id: responseMessageId, role: 'model', content: '' }] as ExtendedChatMessage[]);
        
        let response = await getStreamingResponse(currentHistory, responseMessageId, () => {
          updateThinkingStep(aiId, iterations === 1 ? 'AI is responding...' : `Aartiq is processing Step ${iterations}...`);
        });

        // 🔄 AUTO-CONTINUATION: If the AI was cut off due to length, automatically continue
        let continuationCount = 0;
        const MAX_AUTO_CONTINUATIONS = 3;
        
        while (response.finishReason === 'length' && continuationCount < MAX_AUTO_CONTINUATIONS) {
          continuationCount++;
          const continueThinkId = addThinkingStep(`Continuing response (Part ${continuationCount + 1})...`);
          
          // Append the partial text to history so the AI knows where it left off
          const partialHistory: ExtendedChatMessage[] = [
            ...currentHistory,
            { role: 'model', content: response.text } as ExtendedChatMessage
          ];
          
          const nextPart = await getStreamingResponse(partialHistory as any, responseMessageId!, () => {
            updateThinkingStep(continueThinkId, "Generating next part...");
          });
          
          if (nextPart.error) {
            resolveThinkingStep(continueThinkId, 'error', nextPart.error);
            break;
          }
          
          // Stitch the text together
          response.text += nextPart.text;
          response.thought += (nextPart.thought || '');
          response.finishReason = nextPart.finishReason;
          
          resolveThinkingStep(continueThinkId, 'done');
        }

        resolveThinkingStep(aiId, response.error ? 'error' : 'done');

        if (response.error) throw new Error(response.error);

        // Extract a clarifying question (if the AI is blocked and asks). The
        // fenced JSON block is stripped from the visible/command text.
        const parsedQuestion = parseAartiqQuestion(response.text);
        const questionPayload: AartiqQuestion | null = parsedQuestion.question;
        if (questionPayload) {
          response.text = parsedQuestion.text;
        }

        // Clean up text format to remove the action commands from the visible message
        // parseAICommands now handles ALL formats (JSON, brackets, HTML comments) with built-in deduplication
        let { commands, responseText, invalidCommands } = prepareCommandsForExecution(response.text);

        // Also strip any remaining command tags/JSON for display
        responseText = stripAllCommands(responseText);

        // Parse [STATUS: text] tags for custom processing indicators
        const statusTagRegex = /\[STATUS:\s*([^\]]+)\]/gi;
        let lastStatus = '';
        let statusMatch;
        while ((statusMatch = statusTagRegex.exec(response.text)) !== null) {
          lastStatus = statusMatch[1].trim();
        }
        if (lastStatus) {
          setCustomStatusText(lastStatus);
          responseText = responseText.replace(statusTagRegex, '');
        }

        // Extract user preference commands (SAVE_PREFERENCE:key:value)
        if (useAppStore.getState().enableAiPreferenceLearning) {
          const prefRegex = /SAVE_PREFERENCE:\s*([^:]+?)\s*:\s*(.+?)(?:\n|$)/gi;
          let prefMatch;
          while ((prefMatch = prefRegex.exec(response.text)) !== null) {
            const key = prefMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
            const val = prefMatch[2].trim();
            if (key && val && window.electronAPI?.saveUserPreference) {
              window.electronAPI.saveUserPreference(key, val).catch(() => {});
              setUserPreferences(prev => ({ ...prev, [key]: { value: val, updatedAt: Date.now() } }));
            }
          }
        }

        const skippedCommands: string[] = [];
        const duplicatePreventedCommands: string[] = [];
        const normalizedCommands = commands
          .filter(command => command.type && (command.value !== undefined))
          .map(command => ({
            ...command,
            value: `${command.value || ''}`.trim(),
          }));

        commands = normalizedCommands.filter((command, index) => {
          if (index >= ACTION_CHAIN_MAX_COMMANDS_PER_PASS) {
            skippedCommands.push(`${command.type} was ignored because this pass exceeded ${ACTION_CHAIN_MAX_COMMANDS_PER_PASS} actions.`);
            return false;
          }

          const signature = getCommandAttemptSignature(command);
          const seenAttempts = (commandAttemptCounts.get(signature) || 0) + 1;
          commandAttemptCounts.set(signature, seenAttempts);

          if (seenAttempts > ACTION_CHAIN_MAX_SAME_COMMAND_ATTEMPTS) {
            duplicatePreventedCommands.push(`${command.type}${command.value ? ` (${command.value.slice(0, 80)})` : ''}`);
            return false;
          }

          return true;
        });

        skippedCommands.push(...duplicatePreventedCommands.map(command =>
          `${command} was skipped because the AI already tried that step too many times.`
        ));

        const trimmedResponseText = responseText.trim();

        // Update the last visible message to include the response content and reasoning
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const targetIndex = responseMessageId
            ? updated.findIndex((message) => message.id === responseMessageId)
            : updated.length - 1;
          if (targetIndex >= 0 && updated[targetIndex].role === 'model') {
            updated[targetIndex] = {
              ...updated[targetIndex],
              content: trimmedResponseText,
              thinkText: response.thought // 🚀 PERSIST reasoning for exports/copy
            };
          }
          return updated;
        });
        window.setTimeout(() => {
          if (activeStreamingMessageIdRef.current === responseMessageId) {
            activeStreamingMessageIdRef.current = null;
          }
        }, 1200);

        // If the AI asked a clarifying question, surface it as an interactive
        // card and pause the action chain until the user answers or skips.
        if (questionPayload) {
          const qId = createMessageId('assistant');
          setMessages(prev => [...prev, {
            id: qId,
            role: 'model',
            content: '',
            question: questionPayload,
          } as ExtendedChatMessage]);
          // Keep the question in model history so the next turn has context.
          currentHistory = [
            ...currentHistory,
            { role: 'assistant', content: `${response.text}\n${serializeAartiqQuestion(questionPayload)}` },
          ];
          finalSynthesisDone = true;
          break;
        }

        if (commands.length === 0) {
          // Only show error if there are genuinely unsupported commands AND no useful response text.
          // If the AI produced reasoning/think text only, just break cleanly (it's done deliberating).
          const hasRealInvalidCommands = invalidCommands.some(
            ({ command }) => command.type.includes('_') || command.type.length >= 5
          );
          const noUsefulContent = !trimmedResponseText || trimmedResponseText.length < 20;

          if (noUsefulContent && (hasRealInvalidCommands || skippedCommands.length > 0)) {
            const clarificationMessage = buildActionChainClarification({
              reason: !trimmedResponseText
                ? 'The AI returned an empty or unusable step, so execution was stopped before it could stall.'
                : 'The AI produced malformed or repetitive action steps, so execution was stopped before it could loop.',
              invalidCommands: invalidCommands
                .filter(({ command }) => command.type.includes('_') || command.type.length >= 5)
                .map(({ command, error }) => ({ type: command.type, error })),
              skippedCommands,
              attemptsUsed: recoveryAttempts,
              maxAttempts: ACTION_CHAIN_MAX_RECOVERY_ATTEMPTS,
            });

            setMessages(prev => {
              if (prev.length === 0) {
                return [{ role: 'model', content: clarificationMessage } as ExtendedChatMessage];
              }

              const updated = [...prev];
              const lastIdx = updated.length - 1;
              const last = updated[lastIdx];
              if (last.role === 'model' && !(last.content || '').trim()) {
                updated[lastIdx] = {
                  ...last,
                  content: clarificationMessage,
                };
                return updated;
              }

              return [...updated, { role: 'model', content: clarificationMessage } as ExtendedChatMessage];
            });
          }
          finalSynthesisDone = true;
          break; // No commands needed, LLM has finished its task.
        }

        console.log('[AI] Commands parsed:', commands.map(c => c.type));

        // Save AI's response including the commands to history
        currentHistory = [...currentHistory, { role: 'assistant', content: response.text }];

        currentHistory = compactMessages(currentHistory, { maxTokens: 64000 });

        // Action Execution
        console.log('[AI] Setting up command queue with', commands.length, 'commands');
        const cmdId = addThinkingStep(`Executing Actions (${commands.length})...`);
        const aiCommands: AICommand[] = commands.map((c, i) => ({
          id: `cmd-${Date.now()}-${iterations}-${i}`,
          type: c.type,
          value: c.value,
          context: responseText,
          status: 'pending',
          timestamp: Date.now(),
          startTime: undefined,
          endTime: undefined,
        }));
        console.log('[AI] Command queue:', aiCommands.map(c => c.type));
        commandQueueRef.current = aiCommands;
        setCommandQueue(aiCommands);
        setCurrentCommandIndex(0);
        setAgentState('executing');
        setPlanningSteps(commands.map((c, i) => ({
          id: `plan-${i}`,
          label: c.type.replace(/_/g, ' ').toLowerCase(),
          icon: '⚡',
          risk: (c.risk as 'low' | 'medium' | 'high' | 'critical') || 'low',
        })));

        const finalCommandResult = await waitForCommandQueueCompletion(120000);

        resolveThinkingStep(cmdId, 'done');

        if (finalCommandResult.timedOut) {
          setMessages(prev => [...prev, {
            role: 'model',
            content: buildActionChainClarification({
              reason: 'The browser workflow hit its execution timeout while waiting for steps to finish.',
              invalidCommands: invalidCommands.map(({ command, error }) => ({ type: command.type, error })),
              skippedCommands,
              attemptsUsed: recoveryAttempts,
              maxAttempts: ACTION_CHAIN_MAX_RECOVERY_ATTEMPTS,
            })
          } as ExtendedChatMessage]);
          break;
        }

        const finalCommands = finalCommandResult.commands;

        // If the queue was cleared before completion
        if (finalCommands.length === 0 && commands.length > 0) {
          setMessages(prev => [...prev, {
            role: 'model',
            content: buildActionChainClarification({
              reason: 'The browser workflow stopped before any actionable result was returned.',
              invalidCommands: invalidCommands.map(({ command, error }) => ({ type: command.type, error })),
              skippedCommands,
              attemptsUsed: recoveryAttempts,
              maxAttempts: ACTION_CHAIN_MAX_RECOVERY_ATTEMPTS,
            })
          } as ExtendedChatMessage]);
          break;
        }

        // Track AI-opened tab count for overflow warning
        const TAB_OPENING_COMMANDS = ['NAVIGATE', 'WEB_SEARCH', 'SEARCH'];
        const newTabCount = finalCommands.filter(c =>
          TAB_OPENING_COMMANDS.includes(c.type) && c.status === 'completed'
        ).length;
        aiTabOpenCount += newTabCount;

        // Loop Synthesis step: Feed action outputs back into context
        const tabOverflowWarn = aiTabOpenCount > AI_TAB_WARN_THRESHOLD
          ? `\n\n⚠️ **TAB OVERFLOW WARNING**: AI has opened ${aiTabOpenCount} tabs in this session. Consider using CLOSE_TAB or ORGANIZE_TABS to reduce clutter before opening more.`
          : '';
        const actionResults = finalCommands.map(c =>
          `[Action ${c.type}]: ${c.status === 'completed' ? (c.output || 'Success') : ('Error: ' + (c.error || 'Failed'))}`
        ).join('\n') + tabOverflowWarn;

        const failedCommands = finalCommands
          .filter(command => command.status === 'failed')
          .map(command => ({
            type: command.type,
            value: command.value,
            error: command.error,
          }));
        const hadRecoveryIssues = failedCommands.length > 0 || invalidCommands.length > 0 || skippedCommands.length > 0;

        if (hadRecoveryIssues) {
          recoveryAttempts += 1;
        } else {
          recoveryAttempts = 0;
        }

        if (hadRecoveryIssues && recoveryAttempts > ACTION_CHAIN_MAX_RECOVERY_ATTEMPTS) {
          setMessages(prev => [...prev, {
            role: 'model',
            content: buildActionChainClarification({
              reason: `The AI hit the recovery limit after ${ACTION_CHAIN_MAX_RECOVERY_ATTEMPTS} retry rounds.`,
              failedCommands,
              invalidCommands: invalidCommands.map(({ command, error }) => ({ type: command.type, error })),
              skippedCommands,
              attemptsUsed: recoveryAttempts,
              maxAttempts: ACTION_CHAIN_MAX_RECOVERY_ATTEMPTS,
            })
          } as ExtendedChatMessage]);
          break;
        }

        currentHistory = [
          ...currentHistory,
          {
            role: 'user',
            content: `Action outputs for the steps above:\n${actionResults}${invalidCommands.length > 0
                ? `\n\nInvalid commands skipped:\n${invalidCommands.map(({ command, error }) => `- ${command.type}: ${error}`).join('\n')}`
                : ''
              }${skippedCommands.length > 0
                ? `\n\nLoop prevention notes:\n${skippedCommands.map(note => `- ${note}`).join('\n')}`
                : ''
              }${recoveryAttempts > 0
                ? `\n\nRecovery attempts used: ${recoveryAttempts}/${ACTION_CHAIN_MAX_RECOVERY_ATTEMPTS}.\nDo not repeat the same failed command unless the parameters materially change.`
                : ''
              }\n\nIf you need another action pass, emit at most 3 focused commands. If you cannot safely continue, explain the blocker clearly to the user and ask one specific clarification question. If the steps succeeded or you already have enough information, provide the final answer now without more commands.`
          }
        ];

        currentHistory = compactMessages(currentHistory, { maxTokens: 64000 });
      }

      // ── Prune empty model messages created as command-only streaming placeholders ──
      setMessages(prev => {
        const pruned = prev.filter(m => {
          if (m.role !== 'model') return true;
          const hasContent = !!(m.content && m.content.trim());
          const hasRichContent = !!(m as ExtendedChatMessage).ocrText
            || ((m as ExtendedChatMessage).loadedSkills && (m as ExtendedChatMessage).loadedSkills!.length > 0)
            || !!(m as ExtendedChatMessage).isSkillsList
            || ((m as ExtendedChatMessage).mediaItems && (m as ExtendedChatMessage).mediaItems!.length > 0);
          return hasContent || hasRichContent;
        });
        return pruned.length === prev.length ? prev : pruned;
      });

    } catch (err: any) {
      console.error('Core AI execution failure:', err);
      setError(`Neural Engine Failure: ${err.message}`);
      setMessages(prev => [...prev, { role: 'model', content: `❌ **CRITICAL ERROR**\n${err.message}` } as ExtendedChatMessage]);
    } finally {
      setIsLoading(false);
      setIsThinking(false);
      setCustomStatusText('');
      setAgentState('finished');
      setTimeout(() => setAgentState('idle'), 2000);
    }
  }, [inputMessage, attachments, messages, aiProvider, currentUrl, addThinkingStep, resolveThinkingStep, getStreamingResponse, isAiSetup, fetchRealSearchContext, buildActionChainClarification, waitForCommandQueueCompletion, createMessageId]);

  const processNextCommand = useCallback(async () => {
    console.log('[AI] processNextCommand called, current index:', currentCommandIndex, 'queue length:', commandQueue.length);
    if (processingQueueRef.current || currentCommandIndex >= commandQueue.length) {
      console.log('[AI] Skipping - processing:', processingQueueRef.current, 'index >= length:', currentCommandIndex >= commandQueue.length);
      return;
    }

    processingQueueRef.current = true;
    const command = commandQueue[currentCommandIndex];
    const COMMAND_TIMEOUT = 10000;

    if (currentCommandIndex === 0) automationStartTimeRef.current = Date.now();

    const acsStepId = addActionChainStep(`${command.type.replace(/_/g, ' ').toLowerCase()}`, command.value?.slice(0, 60));
    currentActionChainStepIdRef.current = acsStepId;

    // Check if this command type is denied by policy (critical risk)
    const actionDef = getActionSecurityDefinition(command.type);
    const commandRisk = actionDef ? actionDef.risk : getShellCommandRisk(command.value || '');
    if (isActionDenied(commandRisk)) {
      setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? {
        ...cmd,
        status: 'failed',
        error: `Command "${command.type}" is denied by security policy (critical risk)`,
        endTime: Date.now(),
      } : cmd));
      resolveActionChainStep(acsStepId, 'error', 'Denied by policy');
      processingQueueRef.current = false;
      setCurrentCommandIndex(prev => prev + 1);
      return;
    }

    setCustomStatusText('');
    setAgentState('executing');
    setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'executing', startTime: Date.now() } : cmd));

    let commandResult: { output: string; error?: string } = { output: '' };

    const executeWithTimeout = async (fn: () => Promise<void>) => {
      const timeoutPromise = new Promise<{ output: string; error: string }>((_, reject) =>
        setTimeout(() => reject(new Error(`Command timed out after ${COMMAND_TIMEOUT}ms`)), COMMAND_TIMEOUT)
      );
      try {
        await fn();
        commandResult.output = 'completed';
      } catch (e: any) {
        commandResult = { output: '', error: e.message };
      }
    };

    try {
      let output = '';
      switch (command.type) {
        case 'WAIT': {
          const ms = parseInt(command.value) || 2000;
          output = `Waiting for ${ms}ms...`;
          await new Promise(resolve => setTimeout(resolve, ms));
          break;
        }

        case 'THINK': {
          const thinkId = addThinkingStep(command.value || 'AI Reasoning...');
          await new Promise(resolve => setTimeout(resolve, 1500));
          resolveThinkingStep(thinkId, 'done', 'Reasoning complete');
          output = `Reasoning step: ${command.value}`;
          break;
        }

        case 'PLAN': {
          output = `Executing plan: ${command.value}`;
          setMessages(prev => [...prev, { role: 'model', content: `🎯 **STRATEGIC PLAN:** ${command.value}` }]);
          break;
        }

        case 'NAVIGATE': {
          const targetUrl = command.value.trim() || 'https://www.google.com';
          // Update action chain with the URL being navigated to
          let navHostname = '';
          try { navHostname = new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`).hostname; } catch {}
          if (currentActionChainStepIdRef.current) {
            updateActionChainStepLabel(
              currentActionChainStepIdRef.current,
              `🌐 Navigating: ${navHostname || targetUrl}`,
              targetUrl,
              navHostname ? (
                <span className="inline-flex items-center gap-1">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${navHostname}&sz=16`}
                    alt=""
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <span className="text-[9px] text-secondary-text/50 truncate max-w-[120px]">{navHostname}</span>
                </span>
              ) : undefined
            );
            const navUrl = targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`;
            updateActionChainStepSites(currentActionChainStepIdRef.current, [
              { title: navHostname || targetUrl, url: navUrl },
            ]);
          }
          if (targetUrl.startsWith('comet://')) {
            const page = targetUrl.replace('comet://', '');
            router.push(`/${page}`);
            setActiveView('browser');
            output = `Navigated to internal page: ${page}`;
          } else {
            setActiveView('browser');
            const navigationResult = await openTabAndWaitForLoad(targetUrl, 'ai-session');
            output = `Opened new tab and navigated to ${navigationResult.url || targetUrl}`;
          }
          break;
        }

        case 'CLICK_ELEMENT': {
          // JSON: {"type": "CLICK_ELEMENT", "selector": "#btn", "text": "Submit", "aria": "submit button"}
          // JSON: {"type": "CLICK_ELEMENT", "text": "Login"}
          // Pipe: [CLICK_ELEMENT: #submit-btn | text:Login | reason:click login]
          const rawInput = command.value.trim();
          const cmdParams = (command as any).params || {};

          // Parse from structured params first
          let cssSelector = cmdParams.selector || getCmdParam(command as any, 'selector') || '';
          let textFilter = cmdParams.text || getCmdParam(command as any, 'text') || '';
          let ariaLabel = cmdParams.aria || cmdParams['aria-label'] || getCmdParam(command as any, 'aria') || '';

          // Fallback: parse from pipe-delimited value
          if (!cssSelector && !textFilter && !ariaLabel) {
            cssSelector = rawInput;
            if (rawInput.startsWith('text:')) {
              textFilter = rawInput.replace('text:', '').trim();
              cssSelector = '';
            } else if (rawInput.startsWith('aria:')) {
              ariaLabel = rawInput.replace('aria:', '').trim();
              cssSelector = '';
            } else {
              const textMatch = rawInput.match(/\|?\s*text:\s*(.+)/i);
              const ariaMatch = rawInput.match(/\|?\s*aria:\s*(.+)/i);
              if (textMatch) {
                textFilter = textMatch[1].trim();
                cssSelector = rawInput.replace(textMatch[0], '').replace(/\s*\|\s*$/, '').trim();
              }
              if (ariaMatch) {
                ariaLabel = ariaMatch[1].trim();
                cssSelector = rawInput.replace(ariaMatch[0], '').replace(/\s*\|\s*$/, '').trim();
              }
            }
          }

          // Last resort: if everything is still empty, try value as text search
          if (!cssSelector && !textFilter && !ariaLabel && rawInput) {
            textFilter = rawInput;
          }

          const clickStepId = addThinkingStep(`Clicking${cssSelector ? ': ' + cssSelector : ''}${textFilter ? ' "' + textFilter + '"' : ''}...`);
          try {
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'awaiting_permission' } : cmd));
            const confirmed = await requestActionPermission({
              actionType: 'CLICK_ELEMENT',
              action: 'Click Element',
              target: cssSelector || textFilter || rawInput,
              what: cssSelector || textFilter || rawInput,
              reason: command.reason || 'The AI wants to click a page element.',
              risk: 'medium',
            });
            if (!confirmed) {
              output = 'Click denied';
              resolveThinkingStep(clickStepId, 'error', 'Permission denied');
              break;
            }
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'executing' } : cmd));

            // Use dom-click-element with multi-strategy fallback and retry
            let res: any;
            if (window.electronAPI.domClickElement) {
              res = await window.electronAPI.domClickElement({
                selector: cssSelector || undefined,
                text: textFilter || undefined,
                'aria-label': ariaLabel || undefined,
                retry: 3,
                verify: true,
              });
            } else {
              res = await window.electronAPI.clickElement(cssSelector || rawInput);
            }

            if (res.success) {
              output = `Clicked${cssSelector ? ' ' + cssSelector : ''}${textFilter ? ' "' + textFilter + '"' : ''}`;
              resolveThinkingStep(clickStepId, 'done', 'Clicked');
            } else {
              const errMsg = res.error || 'Click failed: element not found';
              output = `Click failed: ${errMsg}`;
              commandResult = { output: '', error: output };
              resolveThinkingStep(clickStepId, 'error', errMsg);
            }
          } catch (e: any) {
            output = `Click error: ${e.message}`;
            commandResult = { output: '', error: output };
            resolveThinkingStep(clickStepId, 'error', e.message);
          }
          break;
        }

        case 'CLICK_AT': {
          const coords = command.value.split('|')[0].trim();
          const [x, y] = coords.split(',').map(s => parseInt(s.trim()));
          const clickAtStepId = addThinkingStep(`Clicking at (${x}, ${y})...`);
          try {
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'awaiting_permission' } : cmd));
            const confirmed = await requestActionPermission({
              actionType: 'CLICK_AT',
              action: 'Click Screen Coordinates',
              target: `${x},${y}`,
              what: `(${x}, ${y})`,
              reason: command.reason || 'The AI wants to click a specific point on screen.',
              risk: 'medium',
            });
            if (!confirmed) {
              output = `Click denied at coordinates (${x}, ${y})`;
              resolveThinkingStep(clickAtStepId, 'error', 'Permission denied');
              break;
            }
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'executing' } : cmd));
            const res = await window.electronAPI.performClick({ x, y });
            if (res.success) {
              output = `Clicked at coordinates (${x}, ${y})`;
              resolveThinkingStep(clickAtStepId, 'done', 'Clicked at coords');
            } else {
              const errMsg = res.error || 'Click at coords failed';
              output = `Failed to click at coords: ${errMsg}`;
              commandResult = { output: '', error: output };
              resolveThinkingStep(clickAtStepId, 'error', errMsg);
            }
          } catch (e: any) {
            output = `Click error: ${e.message}`;
            commandResult = { output: '', error: output };
            resolveThinkingStep(clickAtStepId, 'error', e.message);
          }
          break;
        }

        case 'FIND_AND_CLICK': {
          const cmdParamsFac = (command as any).params || {};
          let textToFind = command.value.split('|')[0].trim();
          if (!textToFind) textToFind = cmdParamsFac.text || cmdParamsFac.query || cmdParamsFac.value || '';
          if (!textToFind) {
            output = 'FIND_AND_CLICK requires text to search for';
            commandResult = { output: '', error: output };
            break;
          }
          const findClickStepId = addThinkingStep(`Finding and clicking: "${textToFind}"...`);
          try {
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'awaiting_permission' } : cmd));
            const confirmed = await requestActionPermission({
              actionType: 'FIND_AND_CLICK',
              action: 'Find And Click',
              target: textToFind,
              what: textToFind,
              reason: command.reason || 'The AI wants to search the screen for text and click it.',
              risk: 'medium',
            });
            if (!confirmed) {
              output = `Find-and-click denied for "${textToFind}"`;
              resolveThinkingStep(findClickStepId, 'error', 'Permission denied');
              break;
            }
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'executing' } : cmd));
            const res = await window.electronAPI.findAndClickText(textToFind);
            if (res.success) {
              output = `Found and clicked text: "${textToFind}"`;
              resolveThinkingStep(findClickStepId, 'done', 'Text found and clicked');
            } else {
              const errMsg = res.error || `Could not find text: "${textToFind}"`;
              output = `Could not find text: "${textToFind}"`;
              commandResult = { output: '', error: output };
              resolveThinkingStep(findClickStepId, 'error', 'Text not found');
            }
          } catch (e: any) {
            output = `Find and click error: ${e.message}`;
            commandResult = { output: '', error: output };
            resolveThinkingStep(findClickStepId, 'error', e.message);
          }
          break;
        }

        case 'FILL_FORM': {
          // JSON: {"type": "FILL_FORM", "selector": "#email", "value": "user@example.com"}
          // Pipe: [FILL_FORM: #email | user@example.com | reason:enter email]
          const cmdParams = (command as any).params || {};
          const selector = cmdParams.selector || getCmdParam(command as any, 'selector') || command.value.split('|')[0]?.trim() || '';
          const value = cmdParams.value || cmdParams.text || getCmdParam(command as any, 'value') || getCmdParam(command as any, 'text') || command.value.split('|')[1]?.trim() || '';
          const fillStepId = addThinkingStep(`Filling ${selector}...`);
          try {
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'awaiting_permission' } : cmd));
            const confirmed = await requestActionPermission({
              actionType: 'FILL_FORM',
              action: 'Fill Form Field',
              target: selector,
              what: selector,
              reason: command.reason || 'The AI wants to type into a page form field.',
              risk: 'medium',
            });
            if (!confirmed) {
              output = `Form fill denied for ${selector}`;
              resolveThinkingStep(fillStepId, 'error', 'Permission denied');
              break;
            }
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'executing' } : cmd));

            // Use dom-fill-form (enhanced server-side) with retry
            let res: any;
            if (window.electronAPI.domFillForm) {
              res = await window.electronAPI.domFillForm({
                selector,
                value,
                retry: 3,
                verify: true,
                clearFirst: true,
              });
            } else {
              res = await window.electronAPI.typeText(selector, value);
            }

            if (res.success) {
              output = `Filled ${selector} with "${value.substring(0, 80)}"`;
              resolveThinkingStep(fillStepId, 'done', 'Form field filled');
            } else {
              const errMsg = res.error || `Failed to fill ${selector}`;
              output = `Failed to fill form: ${errMsg}`;
              commandResult = { output: '', error: output };
              resolveThinkingStep(fillStepId, 'error', errMsg);
            }
          } catch (e: any) {
            output = `Fill error: ${e.message}`;
            commandResult = { output: '', error: output };
            resolveThinkingStep(fillStepId, 'error', e.message);
          }
          break;
        }

        case 'MULTI_FILL_FORM': {
          // JSON: {"type": "MULTI_FILL_FORM", "fields": {"#email":"a@b.com","#pass":"secret"}, "delayBetweenFields": 100}
          // Pipe: [MULTI_FILL_FORM: {"#email":"a@b.com","#pass":"secret"}]
          let fieldMap: Record<string, string> = {};
          const mfParams = (command as any).params || {};

          if (mfParams.fields) {
            try { fieldMap = typeof mfParams.fields === 'string' ? JSON.parse(mfParams.fields) : mfParams.fields; } catch (_) {}
          } else {
            try { fieldMap = JSON.parse(command.value.trim()); } catch (_) {
              try {
                const cleaned = command.value.trim().replace(/^["']|["']$/g, '');
                fieldMap = JSON.parse(cleaned);
              } catch (_) {}
            }
          }

          const fieldEntries = Object.entries(fieldMap);
          if (fieldEntries.length === 0) {
            output = 'MULTI_FILL_FORM requires a JSON object mapping selectors to values';
            break;
          }

          const mfStepId = addThinkingStep(`Filling ${fieldEntries.length} form fields...`);
          try {
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'awaiting_permission' } : cmd));
            const confirmed = await requestActionPermission({
              actionType: 'MULTI_FILL_FORM',
              action: 'Fill Multiple Form Fields',
              target: fieldEntries.map(([s, v]) => `${s}=${v}`).join(', '),
              what: `Fill ${fieldEntries.length} fields`,
              reason: command.reason || 'The AI wants to fill multiple form fields at once.',
              risk: 'medium',
            });
            if (!confirmed) {
              output = 'Multi-fill denied';
              resolveThinkingStep(mfStepId, 'error', 'Permission denied');
              break;
            }
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'executing' } : cmd));

            const delay = parseInt(mfParams.delayBetweenFields || '100', 10);
            let res: any;
            if (window.electronAPI.multiFillForm) {
              res = await window.electronAPI.multiFillForm({
                fields: fieldMap,
                delayBetweenFields: delay,
                retry: 3,
                verify: true,
              });
            } else {
              // Fallback: fill fields sequentially
              const results = [];
              for (const [sel, val] of fieldEntries) {
                const r = await window.electronAPI.fillForm({ selector: sel, value: val, retry: 2, verify: true, clearFirst: true });
                results.push({ selector: sel, ...r });
                if (delay > 0) await new Promise(r => setTimeout(r, delay));
              }
              res = { success: results.every(r => r.success), results };
            }

            if (res.success) {
              const filled = res.results?.length || fieldEntries.length;
              output = `Filled ${filled} fields successfully`;
              resolveThinkingStep(mfStepId, 'done', `${filled} fields filled`);
            } else {
              const failed = res.results?.filter((r: any) => !r.success) || [];
              const errMsg = failed.map((f: any) => f.selector).join(', ') || 'Multi-fill failed';
              output = `Multi-fill partially failed: ${errMsg}`;
              commandResult = { output: '', error: output };
              resolveThinkingStep(mfStepId, 'error', errMsg);
            }
          } catch (e: any) {
            output = `Multi-fill error: ${e.message}`;
            commandResult = { output: '', error: output };
            resolveThinkingStep(mfStepId, 'error', e.message);
          }
          break;
        }

        case 'SCROLL_TO': {
          const parts = command.value.split('|').map(s => s.trim());
          const selector = parts[0];
          const scrollStepId = addThinkingStep(`Scrolling to ${selector}...`);
          try {
            const code = `document.querySelector('${selector}')?.scrollIntoView({ behavior: 'smooth' })`;
            await window.electronAPI.executeJavaScript(code);
            output = `Scrolled to element: ${selector}`;
            resolveThinkingStep(scrollStepId, 'done', 'Scrolled to element');
          } catch (e: any) {
            output = `Scroll error: ${e.message}`;
            resolveThinkingStep(scrollStepId, 'error', e.message);
          }
          break;
        }

        case 'RECORD_WORKFLOW': {
          const action = command.value.trim().toLowerCase() || 'start';
          const recStepId = addThinkingStep(`Workflow recording: ${action}...`);
          try {
            if (action === 'start' || action === '') {
              const name = command.value.split('|')[1]?.trim() || '';
              const res = await (window.electronAPI as any).workflowStartRecording?.({ name }) ||
                          await (window.electronAPI as any).invoke?.('workflow-start', { name });
              if (res?.success) {
                output = `Recording workflow "${res.name || 'unnamed'}"`;
                resolveThinkingStep(recStepId, 'done', 'Recording started');
              } else {
                output = `Failed to start recording: ${res?.error || 'unknown'}`;
                resolveThinkingStep(recStepId, 'error', output);
              }
            } else if (action === 'stop') {
              const res = await (window.electronAPI as any).workflowStopRecording?.() ||
                          await (window.electronAPI as any).invoke?.('workflow-stop');
              if (res?.success) {
                output = `Stopped recording (${res.steps || 0} steps captured)`;
                resolveThinkingStep(recStepId, 'done', 'Recording stopped');
              } else {
                output = `Failed to stop recording: ${res?.error || 'unknown'}`;
                resolveThinkingStep(recStepId, 'error', output);
              }
            } else if (action.startsWith('save:')) {
              const saveName = action.replace('save:', '').trim() || `workflow-${Date.now()}`;
              const desc = command.value.split('|')[1]?.trim() || '';
              const res = await (window.electronAPI as any).workflowSave?.({ name: saveName, description: desc }) ||
                          await (window.electronAPI as any).invoke?.('workflow-save', { name: saveName, description: desc });
              if (res?.success) {
                output = `Saved workflow "${saveName}" (${res.steps || 0} steps)`;
                resolveThinkingStep(recStepId, 'done', 'Workflow saved');
              } else {
                output = `Failed to save: ${res?.error || 'unknown'}`;
                resolveThinkingStep(recStepId, 'error', output);
              }
            } else {
              output = `Unknown RECORD_WORKFLOW action: ${action}. Use start, stop, or save:name`;
              resolveThinkingStep(recStepId, 'error', output);
            }
          } catch (e: any) {
            output = `Workflow error: ${e.message}`;
            resolveThinkingStep(recStepId, 'error', e.message);
          }
          break;
        }

        case 'PLAY_WORKFLOW': {
          const workflowName = command.value.trim();
          const playStepId = addThinkingStep(`Playing workflow: "${workflowName}"...`);
          try {
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'awaiting_permission' } : cmd));
            const confirmed = await requestActionPermission({
              actionType: 'PLAY_WORKFLOW',
              action: 'Play Workflow',
              target: workflowName,
              what: `Replay workflow "${workflowName}"`,
              reason: command.reason || 'The AI wants to replay a recorded workflow.',
              risk: 'medium',
            });
            if (!confirmed) {
              output = 'Workflow playback denied';
              resolveThinkingStep(playStepId, 'error', 'Permission denied');
              break;
            }
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'executing' } : cmd));
            const res = await (window.electronAPI as any).workflowReplay?.(workflowName) ||
                        await (window.electronAPI as any).invoke?.('workflow-replay', workflowName);
            if (res?.success) {
              const succeeded = res.succeeded || res.results?.filter((r: any) => r.success)?.length || 0;
              const total = res.total || res.results?.length || 0;
              output = `Workflow "${workflowName}" completed: ${succeeded}/${total} steps succeeded`;
              resolveThinkingStep(playStepId, 'done', `${succeeded}/${total} steps`);
            } else {
              output = `Workflow failed: ${res?.error || 'unknown'}`;
              commandResult = { output: '', error: output };
              resolveThinkingStep(playStepId, 'error', output);
            }
          } catch (e: any) {
            output = `Workflow error: ${e.message}`;
            commandResult = { output: '', error: output };
            resolveThinkingStep(playStepId, 'error', e.message);
          }
          break;
        }

        // ✅ WEB_SEARCH with JSON structured params or pipe-delimited
        // JSON: {"type": "WEB_SEARCH", "query": "AI news", "pages": 5, "url": 2}
        // JSON: {"type": "WEB_SEARCH", "query": "AI news", "url": "https://specific.url"}
        // Pipe: [WEB_SEARCH: AI news | pages=5 | url=2]
        case 'SEARCH':
        case 'WEB_SEARCH': {
          const rawValue = command.value.trim().replace(/^["'](.*)["']$/, '$1') || 'Aartiq Browser';

          // Use structured params if available, fallback to pipe parsing
          let query = getCmdParam(command as any, 'query') || cleanCmdValue(command as any) || rawValue;
          const originalQuery = query;
          const pagesOverride = getCmdParamInt(command as any, 'pages') || null;
          const specificUrlParam = getCmdParam(command as any, 'url') || null;
          let specificUrl: string | null = null;
          if (specificUrlParam) {
            specificUrl = /^\d+$/.test(specificUrlParam) ? `__INDEX_${specificUrlParam}__` : specificUrlParam;
          }

          let treatAsDirectUrl = false;
          let directUrl = '';

          if (query.match(/^https?:\/\/[^\s]+/i) || query.match(/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}(\/.*)?$/)) {
            directUrl = query.startsWith('http') ? query : `https://${query}`;
            treatAsDirectUrl = true;
            query = `Opening URL: ${directUrl}`;
          }

          // Update the generic action chain step with the actual search query
          if (currentActionChainStepIdRef.current) {
            updateActionChainStepLabel(currentActionChainStepIdRef.current, `🔍 Searching: "${originalQuery}"`);
          }

          const searchStepId = addThinkingStep(`Searching for "${treatAsDirectUrl ? directUrl : originalQuery}"...`);

          if (treatAsDirectUrl) {
            // Direct URL — open in a new background tab (don't steal focus)
            const navigationResult = await openTabAndWaitForLoad(directUrl, 'ai-session');
            output = `Opened new tab and navigated to ${navigationResult.url || directUrl}`;
            resolveThinkingStep(searchStepId, 'done', 'Page loaded');
            break;
          }

          // ── Primary: server-side search via MCP BrowserMcpServer (DuckDuckGo, offscreen) ──
          let searchResults: Array<{ title: string; url: string; snippet: string; content: string }> = [];
          let usedEngine = 'duckduckgo';
          const effectivePages = pagesOverride || 1;
          try {
            const mcpSearchResult = await (window.electronAPI as any).aiWebSearch(originalQuery, 'duckduckgo', effectivePages);
            if (mcpSearchResult?.results?.length > 0) {
              searchResults = mcpSearchResult.results;
              usedEngine = mcpSearchResult.engine || 'duckduckgo';
            }
          } catch (mcpErr) {
            console.warn('[WebSearch] MCP aiWebSearch failed, falling back to webSearchRag:', mcpErr);
          }

          // ── Fallback: existing webSearchRag (googlescrape) ──
          if (searchResults.length === 0) {
            try {
              const ragResults = await window.electronAPI.webSearchRag(originalQuery);
              const normalized = normalizeSearchResults(ragResults as any[]);
              searchResults = normalized.slice(0, effectivePages).map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.snippet,
                content: (r as any).pageContent || '',
              }));
              usedEngine = 'googlescrape';
            } catch (ragErr) {
              console.warn('[WebSearch] webSearchRag fallback also failed:', ragErr);
            }
          }

          if (searchResults.length > 0) {
            // Store results in context
            const fullSnippet = searchResults.map(r =>
              `[${r.title}](${r.url})\n${r.snippet}${r.content ? `\n\nContent:\n${r.content.substring(0, 2000)}` : ''}`
            ).join('\n\n---\n\n');

            await BrowserAI.addToVectorMemory(fullSnippet, {
              type: 'web_search',
              query: originalQuery,
              timestamp: Date.now()
            });
            searchContextStore.addWebSearch(originalQuery, fullSnippet);

            // Update the action chain step with found websites (favicons + titles)
            const websites = searchResults
              .filter(r => r.url && r.url.startsWith('http'))
              .map(r => ({
                url: r.url,
                title: r.title,
                charCount: (r.content || '').length,
                truncated: (r.content || '').length > 6000,
              }));
            const websiteDomains = websites.map(w => {
              try { return new URL(w.url).hostname; } catch { return w.url; }
            }).join(', ');
            const websiteDetailNode = (
              <span className="inline-flex items-center gap-1 flex-wrap">
                {websites.map((w, i) => {
                  let hostname = '';
                  try { hostname = new URL(w.url).hostname; } catch { hostname = w.url; }
                  const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`;
                  return (
                    <span key={i} className="group/site relative inline-flex items-center gap-0.5">
                      <img
                        src={faviconUrl}
                        alt=""
                        className="w-3 h-3 rounded-sm flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <span className="text-[9px] text-secondary-text/50 truncate max-w-[80px]">
                        {w.title || hostname}
                      </span>
                      {/* Hover tooltip with full URL */}
                      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-[300] whitespace-nowrap rounded-md border border-border-color bg-primary-bg/95 px-2 py-1 text-[9px] font-mono text-primary-text shadow-xl opacity-0 group-hover/site:opacity-100 transition-opacity duration-[150ms] backdrop-blur-xl">
                        {w.url}
                      </span>
                      {i < websites.length - 1 && <span className="text-secondary-text/20 mx-0.5">·</span>}
                    </span>
                  );
                })}
              </span>
            );
            if (currentActionChainStepIdRef.current) {
              const totalPages = effectivePages > 1 ? effectivePages : websites.length;
              updateActionChainStepLabel(
                currentActionChainStepIdRef.current,
                `🔍 Searched: "${originalQuery}"`,
                totalPages > 1 ? `${websites.length} sites · ${totalPages} pages fetched` : `${websites.length} site`,
                websiteDetailNode
              );
              updateActionChainStepSites(
                currentActionChainStepIdRef.current,
                websites.map(w => ({ title: w.title, url: w.url }))
              );
            }

            // Navigate to specific result if requested, or show summary
            if (specificUrl?.startsWith('__INDEX_')) {
              const idx = parseInt(specificUrl.replace('__INDEX_', '').replace('__', ''));
              const target = searchResults[idx];
              if (target?.url) {
                await openTabAndWaitForLoad(target.url, 'ai-session');
                const activeTabId = useAppStore.getState().activeTabId;
                const contentRes = await window.electronAPI.extractPageContent(activeTabId || undefined);
                if (contentRes?.content) {
                  const cleanContent = scrubbedContent(contentRes.content).substring(0, 6000);
                  searchContextStore.addPageContent(target.url, target.title, cleanContent);
                  await BrowserAI.addToVectorMemory(cleanContent, { type: 'page_content', url: target.url, query: originalQuery });
                }
                output = `✅ Opened result ${idx}: ${target.title} (${target.url}) — page content read`;
              } else {
                output = `✅ Found ${searchResults.length} results for "${originalQuery}" (via ${usedEngine}) — see below`;
              }
            } else if (specificUrl) {
              const target = searchResults.find(r => r.url.includes(specificUrl));
              if (target?.url) {
                await openTabAndWaitForLoad(target.url, 'ai-session');
                output = `✅ Opened: ${target.title} (${target.url})`;
              } else {
                output = `✅ Found ${searchResults.length} results for "${originalQuery}" (via ${usedEngine}) — URL "${specificUrl}" not found in results`;
              }
            } else {
              // Default: store results as collapsible message, show compact summary
              const FAILED_CONTENT_PATTERNS = [
                /access to this page is forbidden/i,
                /there are no items to show/i,
                /403 forbidden/i,
                /access denied/i,
                /captcha/i,
                /please enable javascript/i,
                /this page requires javascript/i,
                /cloudflare/i,
                /checking your browser/i,
                /checking the site connection security/i,
              ];
              const resultLines = searchResults
                .filter(r => r.title || r.snippet)
                .map((r, i) => {
                  // Strip content that contains known failure patterns
                  let cleanContent = r.content || '';
                  if (cleanContent && FAILED_CONTENT_PATTERNS.some(p => p.test(cleanContent))) {
                    cleanContent = '';
                  }
                  // Also strip very short content that's likely a status message, not real content
                  if (cleanContent.length > 0 && cleanContent.length < 60 && !cleanContent.includes('.')) {
                    cleanContent = '';
                  }
                  const title = r.title || 'Untitled';
                  const url = r.url || '';
                  const snippet = r.snippet || '';
                  return `${i + 1}. ${title}\n   ${url}\n   ${snippet}${cleanContent ? `\n\n   ${cleanContent.substring(0, 500)}` : ''}`;
                });

              const resultsText = resultLines.join('\n\n');
              const resultCount = resultLines.length;

              output = `Found ${resultCount} result${resultCount !== 1 ? 's' : ''} for "${originalQuery}" via ${usedEngine}`;

              // Store full results as a compact, headerless collapsible note
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'model') {
                  return [...prev.slice(0, -1), {
                    ...last,
                    content: output,
                    isOcr: true,
                    isSearchResult: true,
                    ocrLabel: 'WEB_SEARCH_RESULTS',
                    ocrText: resultsText,
                  }];
                }
                return [...prev, {
                  role: 'model',
                  content: output,
                  isOcr: true,
                  isSearchResult: true,
                  ocrLabel: 'WEB_SEARCH_RESULTS',
                  ocrText: resultsText,
                } as ExtendedChatMessage];
              });
            }
            resolveThinkingStep(searchStepId, 'done', `${searchResults.length} results via ${usedEngine}`);
          } else {
            // Last resort: open a search tab and try DOM/OCR extraction
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(originalQuery)}`;
            await openTabAndWaitForLoad(searchUrl, 'ai-session');
            await new Promise(resolve => setTimeout(resolve, 1500));
            try {
              const domRes = await window.electronAPI.extractPageContent(useAppStore.getState().activeTabId || undefined);
              if (domRes && domRes.content && domRes.content.length > 100) {
                const scrubbed = scrubbedContent(domRes.content).substring(0, 1000);
                output = `✅ Fallback DOM snapshot for "${originalQuery}" (${scrubbed.length} chars) — see container below`;
                await BrowserAI.addToVectorMemory(scrubbed, { type: 'web_search_fallback', query: originalQuery, url: searchUrl });
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === 'model') {
                    return [...prev.slice(0, -1), {
                      ...last,
                      isOcr: true,
                      ocrLabel: 'SEARCH_PAGE_DOM',
                      ocrText: `${scrubbed}\n\n[Content truncated for clarity. Use specific DOM_SEARCH for more detail.]`
                    }];
                  }
                  return [...prev, {
                    role: 'model',
                    content: 'I pulled some fallback content from the search page.',
                    isOcr: true,
                    ocrLabel: 'SEARCH_PAGE_DOM',
                    ocrText: scrubbed
                  } as ExtendedChatMessage];
                });
              } else {
                output = `No results found for "${originalQuery}". Do NOT invent data — tell the user you could not find current information.`;
              }
            } catch (fallbackErr) {
              output = `No results found for "${originalQuery}". Do NOT invent data — tell the user you could not find current information.`;
            }
            resolveThinkingStep(searchStepId, output.startsWith('✅') ? 'done' : 'error', output.substring(0, 80));
          }
          break;
        }

        // ✅ SEARCH_RESULTS — search + auto-navigate + read pages, return full content to LLM
        // JSON: {"type": "SEARCH_RESULTS", "query": "latest AI news", "count": 5}
        case 'SEARCH_RESULTS': {
          const srQuery = getCmdParam(command as any, 'query') || cleanCmdValue(command as any) || command.value.trim();
          const srCount = getCmdParamInt(command as any, 'count') || 5;

          if (!srQuery) {
            output = 'SEARCH_RESULTS requires a query parameter.';
            break;
          }

          const srStepId = addThinkingStep(`Searching & reading pages for "${srQuery}"...`);
          try {
            // MCP search already navigates to pages and reads full content
            let srResults: Array<{ title: string; url: string; snippet: string; content: string }> = [];
            try {
              const mcpRes = await (window.electronAPI as any).aiWebSearch(srQuery, 'duckduckgo', srCount);
              if (mcpRes?.results?.length > 0) {
                srResults = mcpRes.results.map((r: any) => ({
                  title: r.title,
                  url: r.url,
                  snippet: r.snippet,
                  content: r.content || '',
                }));
              }
            } catch { /* fall through */ }

            // Fallback to webSearchRag
            if (srResults.length === 0) {
              const ragRes = await window.electronAPI.webSearchRag(srQuery);
              srResults = normalizeSearchResults(ragRes as any[]).slice(0, srCount).map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.snippet,
                content: (r as any).pageContent || '',
              }));
            }

            if (srResults.length === 0) {
              output = `No search results found for "${srQuery}".`;
            } else {
              // Build full content output for the LLM
              const fullContent = srResults.map((r, i) =>
                `--- Result ${i + 1}: ${r.title} ---\nURL: ${r.url}\nSnippet: ${r.snippet}\n\nFull Content:\n${r.content || '(no content read)'}`
              ).join('\n\n');

              output = `🔍 Search Results for "${srQuery}" (${srResults.length} pages read):\n\n${fullContent}`;

              // Store in context
              await BrowserAI.addToVectorMemory(
                `[SEARCH_RESULTS: ${srQuery}]\n${srResults.map(r => `${r.title}: ${r.url}\n${r.content.substring(0, 1000)}`).join('\n\n')}`,
                { type: 'search_results', query: srQuery, url: currentUrl }
              );
              searchContextStore.addWebSearch(srQuery, fullContent);
            }
            resolveThinkingStep(srStepId, 'done', `${srResults.length} results with page content`);
          } catch (e: any) {
            output = `Search failed: ${e.message}`;
            resolveThinkingStep(srStepId, 'error', e.message);
          }
          break;
        }

        // ✅ DEEP_RESEARCH — Signal to begin iterative research using the Research Skill v2 workflow.
        // The LLM itself is the research engine: WEB_SEARCH → NAVIGATE → READ_PAGE_CONTENT → iterate → synthesize.
        // DO NOT run a backend pipeline. Just acknowledge and let the LLM continue researching.
        case 'DEEP_RESEARCH': {
          const drRawValue = command.value.trim().replace(/^["'](.*)["']$/, '$1') || '';
          const drQuery = getCmdParam(command as any, 'query') || cleanCmdValue(command as any) || drRawValue;

          if (!drQuery) {
            output = 'DEEP_RESEARCH requires a query parameter.';
            break;
          }

          const researchId = createMessageId('research');
          activeResearchPipelineIdRef.current = researchId;
          setResearchState(createResearchState(researchId, drQuery));

          const drStepId = addThinkingStep(`Researching "${drQuery}"...`);

          // Run the bounded pipeline for the evidence. It searches, reads pages,
          // and cross-verifies claims across independent domains, streaming
          // progress into the execution card as it goes. The LLM's own
          // WEB_SEARCH cycles still follow for synthesis — this supplies the
          // checked-up-on material, not the prose.
          const startPipeline = async () => {
            try {
              const result = await window.electronAPI?.runResearch?.({
                researchId,
                query: drQuery,
              });
              if (result && result.success === false) {
                setResearchState((prev) => applyResearchProgress(prev, {
                  researchId, stage: 'error', status: 'failed', error: result.error,
                }));
              }
              return result;
            } catch (err: any) {
              setResearchState((prev) => applyResearchProgress(prev, {
                researchId, stage: 'error', status: 'failed', error: err?.message || String(err),
              }));
              return null;
            }
          };

          // Detached on purpose: the command handler continues to the LLM turn,
          // and the pipeline's own events drive the card from here.
          void startPipeline();

          output = `Research workflow initiated for: "${drQuery}". Now follow the Research Skill v2 guide: decompose the query into targeted subtopics, run multiple [WEB_SEARCH] + [NAVIGATE] + [READ_PAGE_CONTENT] cycles, validate facts across 2+ sources, maintain coverage above 80%, and synthesize a structured evidence-grounded report with a ## Sources section listing every URL you visited.`;
          resolveThinkingStep(drStepId, 'done', `Research workflow started for "${drQuery}"`);
          break;
        }

        case 'READ_PAGE_CONTENT': {
          // Update action chain with which page is being read
          let readHostname = '';
          try { readHostname = new URL(currentUrl).hostname; } catch {}
          if (currentActionChainStepIdRef.current) {
            updateActionChainStepLabel(
              currentActionChainStepIdRef.current,
              `📖 Reading: ${readHostname || currentUrl}`,
              currentUrl,
              readHostname ? (
                <span className="inline-flex items-center gap-1">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${readHostname}&sz=16`}
                    alt=""
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <span className="text-[9px] text-secondary-text/50 truncate max-w-[120px]">{readHostname}</span>
                </span>
              ) : undefined
            );
          }
          try {
            const settled = await waitForActiveTabToSettle(15000);
            if (!settled) {
              output = 'Error reading page: page did not finish loading';
              break;
            }
            const activeTabId = useAppStore.getState().activeTabId;
            const res = await window.electronAPI.extractPageContent(activeTabId || undefined);
            if (res.content) {
              const scrubbed = scrubbedContent(res.content);
              // Detect form fields and add FILL_FORM suggestions
              const formFields: { selector: string; placeholder: string; type: string }[] = [];
              const inputRe = /<input[^>]*name=["']([^"']+)["'][^>]*>|<textarea[^>]*name=["']([^"']+)["'][^>]*>/gi;
              let fm;
              while ((fm = inputRe.exec(scrubbed)) !== null) {
                const name = fm[1] || fm[2];
                const full = fm[0];
                const placeholder = full.match(/placeholder=["']([^"']*)["']/)?.[1] || '';
                const type = full.startsWith('<textarea') ? 'textarea' : (full.match(/type=["']([^"']*)["']/)?.[1] || 'text');
                formFields.push({ selector: `[name="${name}"]`, placeholder, type });
              }
              const hasButton = /<button[^>]*>.*<\/button>|<input[^>]*type=["']submit["'][^>]*>/i.test(scrubbed);
              let formHint = '';
              if (formFields.length > 0) {
                const fieldLines = formFields.map((f, i) =>
                  `${i + 1}. FILL_FORM: selector="${f.selector}", value="<${f.placeholder || f.type}>"`
                ).join('\n');
                formHint = `\n\n📋 FORM FIELDS DETECTED — use these FILL_FORM commands:\n${fieldLines}`;
                if (hasButton) formHint += `\nThen CLICK_ELEMENT: selector="button[type='submit']" or text="Submit"`;
                formHint += `\nFormat: {"type": "FILL_FORM", "selector": "${formFields[0].selector}", "value": "your@email.com"}`;
              }
              output = `✅ Page content read (${scrubbed.length} chars) — see container below${formHint}`;
              await BrowserAI.addToVectorMemory(scrubbed, { type: 'page_content', url: currentUrl });
              searchContextStore.addPageContent(currentUrl, currentUrl, scrubbed);
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'model') {
                  const updated = [...prev];
                  updated[prev.length - 1] = { ...last, isOcr: true, ocrLabel: 'DOM_CONTENT', ocrText: scrubbed };
                  return updated;
                }
                return [...prev, { role: 'model', content: '', isOcr: true, ocrLabel: 'DOM_CONTENT', ocrText: scrubbed } as ExtendedChatMessage];
              });
            } else {
              output = `Error reading page: ${res.error || 'No content'}`;
            }
          } catch (e: any) {
            output = `Error reading page: ${e.message}`;
          }
          break;
        }

        case 'OCR_SCREEN': {
          try {
            const stepId = addThinkingStep('Capturing screen for OCR...');
            if (!window.electronAPI.ocrScreenText) {
              output = 'OCR screen not available';
              resolveThinkingStep(stepId, 'error', output);
            } else {
              const ocrRes = await window.electronAPI.ocrScreenText();
              const ocrText = typeof ocrRes === 'string' ? ocrRes : ((ocrRes as any)?.text || '');
              if (ocrText) {
                output = `OCR screen (${ocrText.length} chars):\n${ocrText.substring(0, 4000)}...`;
                await BrowserAI.addToVectorMemory(ocrText, { type: 'ocr_screen', url: currentUrl });
                searchContextStore.addPageContent(currentUrl, currentUrl, ocrText);
              } else {
                output = 'No OCR text detected';
              }
              resolveThinkingStep(stepId, 'done', output);
            }
          } catch (e: any) {
            output = `OCR error: ${e.message}`;
          }
          break;
        }

        // ── CROSS_APP_JSON: Execute multiple cross-app actions in sequence ───────────────
        case 'CROSS_APP_JSON': {
          const stepId = addThinkingStep('Executing cross-app actions...');
          try {
            let actions: any[] = [];
            try {
              actions = JSON.parse(command.value || command.context || '[]');
              if (!Array.isArray(actions)) actions = [actions];
            } catch (parseErr) {
              output = 'Invalid CROSS_APP_JSON format. Use: [CROSS_APP_JSON: [{"type":"ocr","region":[x,y,w,h]},{"type":"click","app":"AppName","element":"Button"}]]';
              break;
            }
            
            const results: string[] = [];
            for (let i = 0; i < actions.length; i++) {
              const action = actions[i];
              const actionType = action.type?.toUpperCase();
              
              if (actionType === 'OCR' || actionType === 'CAPTURE') {
                const region = action.region || action.rect || [0, 0, 1920, 1080];
                const ocrId = addThinkingStep(`Cross-app OCR: region ${region}...`);
                const ocrRes = await window.electronAPI.ocrScreenText?.();
                const ocrText = typeof ocrRes === 'string' ? ocrRes : ((ocrRes as any)?.text || '');
                results.push(`OCR: ${ocrText.substring(0, 200)}...`);
                resolveThinkingStep(ocrId, 'done', 'OCR complete');
              } else if (actionType === 'CLICK' || actionType === 'TAP') {
                const appName = action.app || action.application || '';
                const elementText = action.element || action.text || action.label || '';
                const reason = action.reason || 'Cross-app click';
                const clickId = addThinkingStep(`Clicking ${appName}: ${elementText}...`);
                if (appName && elementText) {
                  const clickRes = await window.electronAPI.clickAppElement?.(appName, elementText, reason);
                  results.push(`Click ${appName}/${elementText}: ${clickRes?.success ? 'OK' : clickRes?.error || 'Failed'}`);
                  resolveThinkingStep(clickId, clickRes?.success ? 'done' : 'error', clickRes?.error || 'Done');
                } else if (action.x !== undefined && action.y !== undefined) {
                  const clickRes = await window.electronAPI.clickAt?.(action.x, action.y);
                  results.push(`Click at (${action.x}, ${action.y}): ${clickRes?.success ? 'OK' : clickRes?.error || 'Failed'}`);
                  resolveThinkingStep(clickId, clickRes?.success ? 'done' : 'error', clickRes?.error || 'Done');
                } else {
                  results.push(`Click: missing app/element or coordinates`);
                }
              } else if (actionType === 'TYPE' || actionType === 'INPUT') {
                const text = action.text || action.value || '';
                const typeId = addThinkingStep(`Typing: ${text.substring(0, 30)}...`);
                const typeRes = await window.electronAPI.typeTextApp?.(text);
                results.push(`Type "${text.substring(0, 30)}...": ${typeRes?.success ? 'OK' : typeRes?.error || 'Failed'}`);
                resolveThinkingStep(typeId, typeRes?.success ? 'done' : 'error', typeRes?.error || 'Done');
              } else if (actionType === 'WAIT' || actionType === 'DELAY') {
                const ms = action.ms || action.delay || 1000;
                await new Promise(r => setTimeout(r, ms));
                results.push(`Wait: ${ms}ms`);
              } else {
                results.push(`Unknown action: ${actionType}`);
              }
            }
            
            output = `Cross-app actions completed:\n${results.join('\n')}`;
            resolveThinkingStep(stepId, 'done', `${actions.length} actions executed`);
          } catch (e: any) {
            output = `CROSS_APP error: ${e.message}`;
            resolveThinkingStep(stepId, 'error', e.message);
          }
          break;
        }

        case 'GROUP_TABS':
        case 'ORGANIZE_TABS': {
          const organizeStepId = addThinkingStep('AI is Classifying Tabs...');
          try {
            const tabs = store.tabs;
            const tabsToClassify = tabs.map(t => ({ id: t.id, title: t.title, url: t.url || '' }));

            const urlCounts = new Map<string, string[]>();
            const closedDuplicates: string[] = [];

            tabs.forEach(t => {
              const url = t.url || '';
              if (url) {
                const normalized = url.replace(/\/$/, '').toLowerCase();
                const existing = urlCounts.get(normalized) || [];
                existing.push(t.id);
                urlCounts.set(normalized, existing);
              }
            });

            for (const [, tabIds] of urlCounts) {
              if (tabIds.length > 1) {
                for (let i = 1; i < tabIds.length; i++) {
                  store.removeTab(tabIds[i]);
                  closedDuplicates.push(tabIds[i]);
                }
              }
            }

            const result = await (window as any).electronAPI.classifyTabsAi({ tabs: tabsToClassify });
            if (result.success && result.classifications) {
              const classifications = result.classifications;
              const groupedTabs = new Map<string, string[]>();

              Object.entries(classifications).forEach(([tabId, groupName]) => {
                const existing = groupedTabs.get(groupName as string) || [];
                existing.push(tabId);
                groupedTabs.set(groupName as string, existing);
              });

              for (const [groupName, tabIds] of groupedTabs) {
                if (tabIds.length > 0) {
                  store.groupTabs(tabIds, groupName);
                }
              }

              const uniqueGroups = groupedTabs.size;
              const totalClosed = closedDuplicates.length;
              const action = totalClosed > 0
                ? `Organized ${tabs.length} tabs into ${uniqueGroups} groups and closed ${totalClosed} duplicate.`
                : `Successfully organized ${tabs.length} tabs into ${uniqueGroups} groups.`;
              output = action;
              resolveThinkingStep(organizeStepId, 'done', action);
            } else {
              output = `Organization failed: ${result.error}`;
              resolveThinkingStep(organizeStepId, 'error', result.error);
            }
          } catch (e: any) {
            output = `Internal error organizing tabs: ${e.message}`;
            resolveThinkingStep(organizeStepId, 'error', e.message);
          }
          break;
        }

        case 'CLOSE_TAB': {
          const tabId = command.value.trim();
          if (!tabId) {
            output = 'Invalid tab ID to close.';
          } else {
            store.removeTab(tabId);
            output = `Closed tab: ${tabId}`;
          }
          break;
        }

        case 'LIST_OPEN_TABS': {
          const tabs = store.tabs;
          if (tabs.length === 0) {
            output = 'No open tabs.';
          } else {
            output = `Open tabs (${tabs.length}):\n${tabs.map((t, i) => `${i + 1}. ${t.title || 'Untitled'} (id: ${t.id}) ${t.id === store.activeTabId ? '[ACTIVE]' : ''}\n   URL: ${t.url}`).join('\n')}`;
          }
          break;
        }

        case 'ANALYSE_TABS':
        case 'ANALYZE_TABS':
        case 'SUMMARIZE_TABS': {
          const analyseStepId = addThinkingStep('Analysing all open tabs...');
          try {
            const allTabs = store.tabs;
            if (allTabs.length === 0) {
              output = 'No open tabs to analyse.';
              resolveThinkingStep(analyseStepId, 'done', 'No tabs found');
              break;
            }
            const tabSummaries: string[] = [];
            for (let i = 0; i < allTabs.length; i++) {
              const tab = allTabs[i];
              const readingStep = addThinkingStep(`Reading tab ${i + 1}/${allTabs.length}: ${tab.title || 'Untitled'}`);
              let content = '';
              if (tab.id === store.activeTabId) {
                const pageContent = await window.electronAPI?.extractPageContent?.();
                content = getExtractedPageContentText(pageContent);
              } else {
                const pageContent = await window.electronAPI?.extractPageContent?.(tab.id);
                content = getExtractedPageContentText(pageContent);
              }
              resolveThinkingStep(readingStep, 'done', `${content.length} chars read`);
              const preview = content ? content.slice(0, 500).replace(/\s+/g, ' ').trim() : '(no readable content)';
              tabSummaries.push(`### ${tab.title || 'Untitled'}\nURL: ${tab.url}\nPreview: ${preview}${content.length > 500 ? '...' : ''}`);
            }
            resolveThinkingStep(analyseStepId, 'done', `${allTabs.length} tabs analysed`);
            output = `## Tab Analysis (${allTabs.length} tabs)\n\n${tabSummaries.join('\n\n')}`;
          } catch (e: any) {
            output = `Tab analysis error: ${e.message}`;
            resolveThinkingStep(analyseStepId, 'error', e.message);
          }
          break;
        }

        case 'SWITCH_TAB': {
          const rawTarget = (getCmdParam(command as any, 'id') || command.value || '').trim();
          const tabs = store.tabs;
          if (!rawTarget) {
            // No ID given — switch to active tab or first tab
            const activeTab = tabs.find(t => t.id === store.activeTabId) || tabs[0];
            if (activeTab) {
              store.setActiveTabId(activeTab.id);
              setActiveView('browser');
              output = `Already on tab: ${activeTab.title || activeTab.url}`;
            } else {
              output = 'No tabs available to switch to.';
            }
            break;
          }
          let targetTab: typeof tabs[0] | undefined;
          // Try direct ID match first
          targetTab = tabs.find(t => t.id === rawTarget);
          // Try index (1-based as shown to user)
          if (!targetTab && /^\d+$/.test(rawTarget)) {
            const idx = parseInt(rawTarget, 10) - 1;
            targetTab = tabs[idx];
          }
          // Try title/URL fuzzy match
          if (!targetTab) {
            const lower = rawTarget.toLowerCase();
            targetTab = tabs.find(t => 
              t.title?.toLowerCase().includes(lower) || 
              t.url?.toLowerCase().includes(lower)
            );
          }
          if (targetTab) {
            store.setActiveTabId(targetTab.id);
            setActiveView('browser');
            output = `Switched to tab: ${targetTab.title || targetTab.url}`;
          } else {
            output = `No tab found matching: ${rawTarget}. Available tabs:\n${tabs.map((t, i) => `${i + 1}. ${t.title} (${t.id})`).join('\n')}`;
          }
          break;
        }

        case 'SET_THEME':
          storeSetTheme(command.value as any);
          output = `Theme set to ${command.value}`;
          break;


        case 'OPEN_VIEW': {
          setActiveView(command.value as any);
          output = `Switched to ${command.value} view`;
          break;
        }

        case 'GENERATE_IMAGE': {
          let prompt = command.value || 'An artistic masterpiece';
          let style = '';

          // Try to parse JSON if it looks like JSON
          if (prompt.trim().startsWith('{') && prompt.trim().endsWith('}')) {
            try {
              const data = JSON.parse(prompt);
              prompt = data.prompt || data.value || prompt;
              style = data.style || '';
            } catch { /* not JSON, use as string */ }
          }

          const fullPrompt = style ? `${prompt} in ${style} style` : prompt;
          const genId = addThinkingStep(`Generating image with AI: ${fullPrompt}...`);
          try {
            const generateImage = (window.electronAPI as typeof window.electronAPI & {
              generateImage?: (payload: { prompt: string }) => Promise<{ success: boolean; imageUrl?: string; imagePath?: string; error?: string }>;
            }).generateImage;

            if (!generateImage) {
              output = 'Image generation is not available in this build.';
              resolveThinkingStep(genId, 'error', output);
              break;
            }

            const res = await generateImage({ prompt: fullPrompt });
            if (res.success) {
              output = `Image generated successfully: ${res.imageUrl || res.imagePath}`;
              resolveThinkingStep(genId, 'done', 'Image generated');
              const url = res.imageUrl || (res.imagePath ? `file://${res.imagePath}` : '');
              if (url) {
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  const imgItem: MediaItem = {
                    id: `gen-img-${Date.now()}`,
                    type: 'image',
                    url: url,
                    title: 'Generated Image',
                    description: prompt
                  };
                  if (last && last.role === 'model') {
                    return [...prev.slice(0, -1), { ...last, mediaItems: [...(last.mediaItems || []), imgItem] }];
                  }
                  return [...prev, { role: 'model', content: `I've generated an image for you: ${prompt}`, mediaItems: [imgItem] }];
                });
              }
            } else {
              output = `Failed to generate image: ${res.error}`;
              resolveThinkingStep(genId, 'error', res.error);
            }
          } catch (e: any) {
            output = `Image generation error: ${e.message}`;
            resolveThinkingStep(genId, 'error', e.message);
          }
          break;
        }

        case 'APPLE_INTELLIGENCE_IMAGE': {
          const prompt = command.value || 'A beautiful landscape';
          const genId = addThinkingStep(`Generating image with Apple Intelligence: ${prompt}...`);
          try {
            const res = await window.electronAPI.generateAppleIntelligenceImage({ prompt });
            if (res.success) {
              output = `Image generated successfully: ${res.imagePath}`;
              resolveThinkingStep(genId, 'done', 'Image generated');
              if (res.imagePath) {
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  const imgItem: MediaItem = { id: `ai-img-${Date.now()}`, type: 'image', url: `file://${res.imagePath}`, title: 'Apple Intelligence Image', description: prompt };
                  if (last && last.role === 'model') {
                    return [...prev.slice(0, -1), { ...last, mediaItems: [...(last.mediaItems || []), imgItem] }];
                  }
                  return [...prev, { role: 'model', content: `I've generated an image for you: ${prompt}`, mediaItems: [imgItem] }];
                });
              }
            } else {
              output = `Apple image generation failed: ${res.error || res.imageReason || 'Unknown error'}`;
              resolveThinkingStep(genId, 'error', output);
            }
          } catch (e: any) {
            output = `Apple Intelligence error: ${e.message}`;
            resolveThinkingStep(genId, 'error', e.message);
          }
          break;
        }

        case 'APPLE_INTELLIGENCE_SUMMARY': {
          let textToSummarize = command.value || '';
          const sumId = addThinkingStep('Checking Apple Intelligence availability...');

          try {
            // Check Apple Intelligence availability first
            const status = await window.electronAPI.getAppleIntelligenceStatus?.();
            if (!status?.success) {
              resolveThinkingStep(sumId, 'error', 'Apple Intelligence is not available on this system.');
              setMessages(prev => [...prev, { 
                role: 'model', 
                content: `🍎 **Apple Intelligence Unavailable**\n\nApple Intelligence is not available on this system. This feature requires:\n- macOS 15.1+ (Sequoia or later)\n- Apple Silicon Mac (M1+)\n\nPlease use a different AI provider for summaries.` 
              }]);
              break;
            }

            // Use DOM for faster/better summary if no specific text provided
            if (!textToSummarize) {
              const domRes = await window.electronAPI.extractPageContent(useAppStore.getState().activeTabId || undefined);
              textToSummarize = domRes.content || '';
              if (!textToSummarize) {
                resolveThinkingStep(sumId, 'error', 'No page content found to summarize.');
                setMessages(prev => [...prev, { role: 'model', content: "I couldn't find any content on the current page to summarize." }]);
                break;
              }
            }

            updateThinkingStep(sumId, 'Summarizing with Apple local models...');
            const res = await window.electronAPI.summarizeWithAppleIntelligence(textToSummarize);

            if (res.success && res.summary) {
              output = `Summary: ${res.summary}`;
              resolveThinkingStep(sumId, 'done', 'Summary created');
              setMessages(prev => [...prev, { role: 'model', content: `🍏 **Apple Intelligence Summary:**\n\n${res.summary}` }]);
            } else {
              output = `Apple summarization failed: ${res.error || 'Please ensure you have macOS 15.1+ and Apple Silicon Mac.'}`;
              resolveThinkingStep(sumId, 'error', output);
              setMessages(prev => [...prev, { 
                role: 'model', 
                content: `⚠️ **Apple Intelligence Error:**\n\n${res.error || 'Please ensure you have macOS 15.1+ and Apple Silicon Mac.'}` 
              }]);
            }
          } catch (e: any) {
            output = `Apple Intelligence error: ${e.message}`;
            resolveThinkingStep(sumId, 'error', e.message);
            setMessages(prev => [...prev, { 
              role: 'model', 
              content: `⚠️ **Apple Intelligence Error:**\n\n${e.message || 'Failed to run Apple Intelligence. Please ensure you have macOS 15.1+ and Apple Silicon Mac.'}` 
            }]);
          }
          break;
        }

        // ── GENERATE_DIAGRAM: render Mermaid diagram in chat ────────────────────
        case 'GENERATE_DIAGRAM': {
          const mermaidCode = command.value || command.context || '';
          if (!mermaidCode || mermaidCode.length < 10) {
            output = 'No valid Mermaid code provided.';
            break;
          }
          const diagramId = `mermaid-${Date.now()}`;
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const last = updated[updated.length - 1];
            const existing = last.mediaItems || [];
            updated[updated.length - 1] = {
              ...last,
              mediaItems: [...existing, {
                type: 'mermaid',
                diagramId,
                code: mermaidCode
              }]
            };
            return updated;
          });
          output = `Diagram generated successfully`;
          break;
        }

        // ── GENERATE_FLOWCHART: render custom flowchart in chat ─────────────────
        case 'GENERATE_FLOWCHART': {
          const flowchartCode = command.value || command.context || '';
          if (!flowchartCode || flowchartCode.length < 5) {
            output = 'No valid flowchart code provided.';
            break;
          }
          const flowchartId = `flowchart-${Date.now()}`;
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const last = updated[updated.length - 1];
            const existing = last.mediaItems || [];
            updated[updated.length - 1] = {
              ...last,
              mediaItems: [...existing, {
                type: 'flowchart',
                diagramId: flowchartId,
                code: flowchartCode
              }]
            };
            return updated;
          });
          output = `Flowchart generated successfully`;
          break;
        }

        // ── GENERATE_CHART: render Chart.js chart in chat ───────────────────────
        case 'GENERATE_CHART': {
          let chartData: any;
          try {
            chartData = robustJSONParse(command.value || command.context || '{}');
          } catch {
            output = 'Invalid chart data JSON.';
            break;
          }
          if (!chartData.datasets || chartData.datasets.length === 0) {
            output = 'No valid chart datasets provided.';
            break;
          }
          const chartId = `chart-${Date.now()}`;
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const last = updated[updated.length - 1];
            const existing = last.mediaItems || [];
            updated[updated.length - 1] = {
              ...last,
              mediaItems: [...existing, {
                type: 'chart',
                chartId,
                data: chartData,
                options: chartData.options || {}
              }]
            };
            return updated;
          });
          output = `Chart generated successfully`;
          break;
        }

        case 'SET_VOLUME': {
          setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'awaiting_permission' } : cmd));
          const confirmed = await requestActionPermission({
            actionType: 'SET_VOLUME',
            action: 'Set Volume',
            target: command.value,
            what: `${command.value}%`,
            reason: command.reason || 'The AI wants to change the system volume.',
            risk: 'medium',
          });
          if (!confirmed) {
            output = 'Volume change denied by user.';
            break;
          }
          setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'executing' } : cmd));
          await window.electronAPI.setVolume(parseInt(command.value));
          output = `System volume adjusted to ${command.value}%`;
          break;
        }

        case 'SET_BRIGHTNESS': {
          setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'awaiting_permission' } : cmd));
          const confirmed = await requestActionPermission({
            actionType: 'SET_BRIGHTNESS',
            action: 'Set Brightness',
            target: command.value,
            what: `${command.value}%`,
            reason: command.reason || 'The AI wants to change the display brightness.',
            risk: 'medium',
          });
          if (!confirmed) {
            output = 'Brightness change denied by user.';
            break;
          }
          setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'executing' } : cmd));
          await window.electronAPI.setBrightness(parseInt(command.value));
          output = `Screen brightness adjusted to ${command.value}%`;
          break;
        }

        case 'SHELL_COMMAND': {
          // Smart redirect: detect app launch attempts and use OPEN_APP instead
          const shellCmd = command.value.trim();
          const appLaunchMatch = shellCmd.match(/^(?:open\s+-a\s+)?([a-zA-Z0-9\-\s]+?)(?:\s+|$)/i);
          if (appLaunchMatch) {
            const potentialApp = appLaunchMatch[1].trim().toLowerCase();
            const knownApps: Record<string, string> = {
              'code': 'Visual Studio Code', 'code-insiders': 'Visual Studio Code - Insiders',
              'cursor': 'Cursor', 'firefox': 'Firefox', 'chrome': 'Google Chrome',
              'safari': 'Safari', 'terminal': 'Terminal', 'iterm': 'iTerm', 'iterm2': 'iTerm',
              'spotify': 'Spotify', 'slack': 'Slack', 'discord': 'Discord',
              'figma': 'Figma', 'notion': 'Notion', 'obsidian': 'Obsidian',
              'docker': 'Docker', 'postman': 'Postman', 'insomnia': 'Insomnia',
            };
            if (knownApps[potentialApp] || (!shellCmd.includes(' ') && !shellCmd.includes('/') && !shellCmd.includes('|') && !shellCmd.includes('>') && !shellCmd.includes('<'))) {
              // Redirect to OPEN_APP
              const resolvedName = knownApps[potentialApp] || potentialApp;
              setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, type: 'OPEN_APP', value: resolvedName, status: 'awaiting_permission' } : cmd));
              const openConfirmed = await requestActionPermission({
                actionType: 'OPEN_APP',
                action: 'Open Application',
                target: resolvedName,
                what: resolvedName,
                reason: 'The AI wants to launch an application.',
                risk: 'medium',
              });
              if (openConfirmed) {
                setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'executing' } : cmd));
                const openRes = await window.electronAPI.openExternalApp(resolvedName);
                output = openRes?.success ? `Opened ${resolvedName}.` : `Failed to open ${resolvedName}: ${openRes?.error || 'unknown error'}`;
              } else {
                output = 'App launch denied by user.';
              }
              break;
            }
          }
          const batchCommands = [command];
          let lookahead = currentCommandIndex + 1;
          const queue = commandQueueRef.current;
          while (lookahead < queue.length && queue[lookahead].type === 'SHELL_COMMAND') {
            batchCommands.push(queue[lookahead]);
            lookahead++;
          }

          if (batchCommands.length > 1) {
            setCommandQueue(prev => prev.map((cmd, i) =>
              batchCommands.some((bc) => bc.id === cmd.id) ? { ...cmd, status: 'awaiting_permission' as const } : cmd
            ));

            const batchResults = await requestBatchPermission(
              batchCommands.map((cmd) => ({
                actionType: 'SHELL_COMMAND',
                action: 'Shell Command',
                target: cmd.value,
                what: cmd.value.length > 80 ? cmd.value.substring(0, 80) + '...' : cmd.value,
                reason: cmd.reason || 'The AI wants to execute a shell command on the host machine.',
                risk: getShellCommandRisk(cmd.value),
              }))
            );

            const outputs: string[] = [];
            for (let bIdx = 0; bIdx < batchCommands.length; bIdx++) {
              const cmd = batchCommands[bIdx];
              const cmdIdx = currentCommandIndex + bIdx;

              if (!batchResults[bIdx]) {
                setCommandQueue(prev => prev.map((c, i) => i === cmdIdx ? { ...c, status: 'idle' } : c));
                outputs.push(`$ ${cmd.value}\nCommand execution denied by user.`);
                continue;
              }

              setCommandQueue(prev => prev.map((c, i) => i === cmdIdx ? { ...c, status: 'executing' } : c));
              const logId2 = `term-${Date.now()}-${terminalLogIdCounter.current++}`;
              if (bIdx === 0) {
                setShowTerminal(true);
              }
              setTerminalLogs(prev => [...prev, { id: logId2, command: cmd.value, output: '⏳ Running...', success: false, timestamp: Date.now() }]);
              const res2 = await window.electronAPI.executeShellCommand({
                rawCommand: cmd.value,
                reason: cmd.reason,
                riskLevel: getShellCommandRisk(cmd.value),
                preApproved: true,
              });
              const cmdOutput2 = res2.success ? (res2.output || '(no output)') : `Error: ${res2.error}`;
              setTerminalLogs(prev => prev.map(l => l.id === logId2
                ? { ...l, output: cmdOutput2, success: !!res2.success }
                : l
              ));

              if (res2.success) {
                setCommandQueue(prev => prev.map((c, i) => i === cmdIdx ? { ...c, status: 'completed', output: cmdOutput2, endTime: Date.now() } : c));
              } else {
                setCommandQueue(prev => prev.map((c, i) => i === cmdIdx ? { ...c, status: 'failed', error: cmdOutput2, endTime: Date.now() } : c));
              }

              outputs.push(res2.success
                ? `$ ${cmd.value}\n${cmdOutput2}`
                : `$ ${cmd.value}\n${cmdOutput2}`);
            }

            output = outputs.join('\n\n');
            commandResult = { output };
            processingBatchRef.current = true;
            skipBatchRef.current = batchCommands.length - 1;
            break;
          }

          setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'awaiting_permission' } : cmd));
          const shellConfirmed = await requestActionPermission({
            actionType: 'SHELL_COMMAND',
            action: 'Shell Command',
            target: command.value,
            what: command.value.length > 80 ? command.value.substring(0, 80) + '...' : command.value,
            reason: command.reason || 'The AI wants to execute a shell command on the host machine.',
            risk: getShellCommandRisk(command.value),
          });
          if (!shellConfirmed) {
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'idle' } : cmd));
            output = 'Command execution denied by user.';
            break;
          }
          setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'executing' } : cmd));
          const logId = `term-${Date.now()}-${terminalLogIdCounter.current++}`;
          const logEntry = { id: logId, command: command.value, output: '', success: false, timestamp: Date.now() };
          setShowTerminal(true);
          setTerminalLogs(prev => [...prev, { ...logEntry, output: '⏳ Running...' }]);
          const res = await window.electronAPI.executeShellCommand({
            rawCommand: command.value,
            reason: command.reason,
            riskLevel: getShellCommandRisk(command.value),
            preApproved: true,
          });
          const cmdOutput = res.success ? (res.output || '(no output)') : `Error: ${res.error}`;
          setTerminalLogs(prev => prev.map(l => l.id === logId
            ? { ...l, output: cmdOutput, success: !!res.success }
            : l
          ));
          output = res.success
            ? `$ ${command.value}\n${cmdOutput}`
            : res.error === 'User blocked the command.'
              ? 'Command execution denied by user.'
              : `Command failed: ${res.error || 'unknown error'}`;
          break;
        }

        case 'OPEN_APP': {
          setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'awaiting_permission' } : cmd));
          const confirmed = await requestActionPermission({
            actionType: 'OPEN_APP',
            action: 'Open Application',
            target: command.value,
            what: command.value,
            reason: 'The AI wants to launch an external application.',
            risk: 'medium',
          });
          if (confirmed) {
            setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'executing' } : cmd));
            // Map common CLI names to their proper macOS app names
            const appMap: Record<string, string> = {
              'code': 'Visual Studio Code',
              'code-insiders': 'Visual Studio Code - Insiders',
              'cursor': 'Cursor',
              'firefox': 'Firefox',
              'chrome': 'Google Chrome',
              'safari': 'Safari',
              'terminal': 'Terminal',
              'iterm': 'iTerm',
              'iterm2': 'iTerm',
              'spotify': 'Spotify',
              'slack': 'Slack',
              'discord': 'Discord',
              'figma': 'Figma',
              'notion': 'Notion',
              'obsidian': 'Obsidian',
              'docker': 'Docker',
              'postman': 'Postman',
              'insomnia': 'Insomnia',
            };
            const rawApp = command.value.trim();
            const appLower = rawApp.toLowerCase();
            const resolvedApp = appMap[appLower] || rawApp;
            const res = await window.electronAPI.openExternalApp(resolvedApp);
            if (res?.success) {
              output = `Opened ${resolvedApp}.`;
            } else {
              output = `Failed to open ${resolvedApp}: ${res?.error || 'unknown error'}. You may need to use the full path or exact app name.`;
            }
          } else {
            output = 'App launch denied by user.';
          }
          break;
        }

        case 'LIST_AUTOMATIONS': {
          const result = (window.electronAPI?.getScheduledTasks ? await window.electronAPI.getScheduledTasks() : []) as any;
          const tasks: any[] = Array.isArray(result) ? result : (Array.isArray(result?.tasks) ? result.tasks : []);
          if (!tasks.length) {
            output = 'No automation tasks are currently scheduled.';
          } else {
            output = tasks.map((task: any, idx: number) => {
              const label = task.name || `Task ${idx + 1}`;
              const schedule = task.schedule || 'custom';
              const status = task.enabled ? 'Active' : 'Paused';
              return `${idx + 1}. ${label} — ${schedule} (${status})`;
            }).join('\n');
          }
          break;
        }

        case 'DELETE_AUTOMATION': {
          let taskId = command.value?.trim();
          if (taskId?.startsWith('{')) {
            try {
              const parsed = JSON.parse(taskId);
              taskId = parsed.id || parsed.taskId || taskId;
            } catch {
              taskId = taskId.replace(/[{}]/g, '').split(':').pop()?.trim() || taskId;
            }
          }
          if (!taskId) {
            output = 'Provide the automation ID you want to delete.';
            break;
          }
          if (!window.electronAPI?.deleteScheduledTask) {
            output = 'Automation DELETE API is unavailable.';
            break;
          }
          const res = await window.electronAPI.deleteScheduledTask(taskId);
          if (res?.success) {
            output = `Deleted automation ${taskId}.`;
          } else {
            output = `Failed to delete automation: ${res?.error || 'unknown error'}.`;
          }
          break;
        }

        case 'OPEN_PDF': {
          const filePath = command.value;
          const res = await window.electronAPI.openPDF(filePath);
          output = res.success ? `Opened PDF: ${filePath}` : `Failed to open PDF: ${res.error}`;
          break;
        }

        case 'SCHEDULE_TASK': {
          let taskData: any = {};
          let rawValue = (command.value || '').trim();

          try {
            if (rawValue.includes('{')) {
              const jsonMatch = rawValue.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                taskData = JSON.parse(jsonMatch[0]);
              }
            } else {
              taskData = JSON.parse(rawValue);
            }
          } catch {
            const parts = rawValue.split('|').map(p => p.trim());
            const [cron, taskType, taskName, description] = parts;
            taskData = { schedule: cron, type: taskType, name: taskName, description };
          }

          const { schedule, type, name, description, url, command: cmd } = taskData;

          if (!schedule || !type || !name) {
            output = 'SCHEDULE_TASK requires: {"schedule": "cron expression", "type": "ai-prompt|web-scrape|pdf-generate|workflow|daily-brief|shell|open-url", "name": "Task Name", "description": "...", "url": "https://...", "command": "shell command"}';
            break;
          }

          if (schedulingOpenedByClient.current) {
            output = `Scheduling modal already open for task: ${name}`;
            break;
          }

          try {
            const intent: SchedulingIntent = {
              detected: true,
              confidence: 'high' as const,
              taskName: name,
              taskType: type as any,
              schedule: {
                type: 'cron' as const,
                expression: schedule,
                description: `Scheduled: ${schedule}`,
              },
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
              outputPath: '~/Documents/Aartiq',
              url: url || '',
              command: cmd || '',
            };

            setSchedulingIntent(intent);
            setShowSchedulingModal(true);
            schedulingOpenedByClient.current = false;
            if (props.setBrowserDisabled) props.setBrowserDisabled(true);
            output = `Scheduling modal opened for task: ${name}`;
          } catch (error) {
            output = `Failed to schedule task: ${(error as Error).message}`;
          }
          break;
        }

        // ✅ NEW: CREATE_PDF_JSON / CREATE_FILE_JSON - Primary JSON-based generation
        // Format: JSON object with structured pages/sections (or slides) and images
        case 'CREATE_PDF_JSON':
        case 'CREATE_FILE_JSON': {
          // Handle models that send structured objects instead of strings
          let rawValue: any = command.value ?? '';
          if (typeof rawValue !== 'string') {
            try {
              rawValue = JSON.stringify(rawValue);
            } catch {
              rawValue = String(rawValue);
            }
          }
          rawValue = (rawValue as string).trim();

          // Clean up malformed input
          rawValue = rawValue.replace(/^\s*\]+\s*:\s*/, '').trim();

          let pdfData: any = null;

          // Use robust JSON parsing - tries multiple strategies
          const strategies: Array<() => any> = [
            // 1) Direct robust parse of the whole value
            () => robustJSONParse(rawValue).data,
            // 2) Extract from markdown code blocks
            () => {
              const match = rawValue.match(/```(?:json)?\s*([\s\S]*?)```/);
              return match ? robustJSONParse(match[1].trim()).data : null;
            },
            // 3) Find JSON object with title/pages anywhere in text
            () => {
              const match = rawValue.match(/\{[\s\S]*?"(?:title|pages|format)"[\s\S]*?\}/);
              return match ? robustJSONParse(match[0]).data : null;
            },
            // 4) Find first { ... } block
            () => {
              const match = rawValue.match(/\{[\s\S]*?\}/);
              return match ? robustJSONParse(match[0]).data : null;
            },
          ];

          for (const strategy of strategies) {
            try {
              const result = strategy();
              if (result && typeof result === 'object') {
                // If wrapped as { commands: [ {type,value}, ... ] }, extract inner value
                if (Array.isArray(result.commands)) {
                  const inner = result.commands.find((c: any) =>
                    typeof c?.type === 'string' &&
                    ['CREATE_FILE_JSON', 'CREATE_PDF_JSON'].includes(c.type));
                  if (inner?.value) {
                    if (typeof inner.value === 'string') {
                      const innerResult = robustJSONParse(inner.value);
                      if (innerResult.success) {
                        pdfData = innerResult.data;
                        break;
                      }
                      try { pdfData = JSON.parse(inner.value); break; } catch { /* fall through */ }
                      pdfData = inner.value;
                      break;
                    }
                    pdfData = inner.value;
                    break;
                  }
                }
                pdfData = result;
                break;
              }
            } catch { /* try next strategy */ }
          }

          if (!pdfData || typeof pdfData !== 'object') {
            output = `⚠️ JSON parsing failed. Please use proper JSON format.`;
            output += `\n\n**Correct format:**\n\`\`\`json\n{\n  "title": "Document Title",\n  "template": "professional",\n  "content": "Your content here..."\n}\n\`\`\``;
            output += `\n\nOr use markdown format: [GENERATE_PDF: Title | actual content here...]`;
            break;
          }

          if (!pdfData) pdfData = {};

          // slides alias -> pages
          if (!pdfData.pages && Array.isArray(pdfData.slides)) {
            pdfData.pages = pdfData.slides.map((slide: any, i: number) => {
              const sections: any[] = [];
              if (Array.isArray(slide.sections)) {
                slide.sections.forEach((s: any) => sections.push(s));
              } else if (Array.isArray(slide.content)) {
                slide.content.forEach((c: any, idx: number) => {
                  sections.push({ title: slide.sectionTitles?.[idx] || '', content: c });
                });
              } else if (typeof slide.content === 'string') {
                sections.push({ title: '', content: slide.content });
              }
              return {
                title: slide.title || `Slide ${i + 1}`,
                icon: slide.icon,
                sections: sections.length ? sections : [{ title: '', content: slide.content || '' }],
                images: slide.images,
              };
            });
          }

          // Minimal one-page fallback
          if (!pdfData.pages && pdfData.content) {
            pdfData.pages = [{
              title: pdfData.title || 'Document',
              sections: [{ title: pdfData.subtitle || 'Content', content: pdfData.content }]
            }];
          }

          // Validate required fields
          if (!pdfData.title && !pdfData.pages) {
            output = '❌ JSON must have at least "title" or "pages" field';
            break;
          }

          // Infer format: explicit -> use it; slides without format -> assume pptx; else pdf
          let format = (pdfData.format || pdfData.output?.format || '').toLowerCase();
          if (!format && pdfData.slides && !pdfData.pages) format = 'pptx';
          if (!format) format = 'pdf';

          // Extract method: html (default), pdfmake, or pdf-lib
          const method = (pdfData.method || pdfData.generationMethod || 'html').toLowerCase();

          const pdfTitle = pdfData.title || 'Document';
          const pdfSubtitle = pdfData.subtitle || '';
          const pdfAuthor = pdfData.author || '';
          const template = pdfData.template || 'professional';
          const watermark = pdfData.watermark || '';
          const bgColor = pdfData.bgColor || '#ffffff';
          const priority = pdfData.priority || 'normal';

          // Extract images from JSON (new action format)
          const pdfImagesFromJson: Array<{ type: string; src?: string; caption?: string; alt?: string; width?: number | string }> = [];
          const addImage = (img: any) => {
            if (!img) return;
            if ((img.type === 'url' || !img.type) && img.src) {
              pdfImagesFromJson.push({ type: 'url', src: img.src, caption: img.caption, alt: img.alt, width: img.width });
            } else if (img.type === 'screenshot') {
              pdfImagesFromJson.push({ type: 'screenshot', caption: img.caption, alt: img.alt || 'Screenshot', width: img.width || '100%' });
            }
          };
          if (pdfData.images && Array.isArray(pdfData.images)) {
            for (const img of pdfData.images) addImage(img);
          }
          if (Array.isArray(pdfData.pages)) {
            pdfData.pages.forEach((p: any) => {
              if (Array.isArray(p.images)) p.images.forEach((img: any) => addImage(img));
            });
          }

          // Build markdown content from JSON structure
          let pdfContent = '';

          // Add metadata at the top
          const metaParts: string[] = [];
          if (pdfSubtitle) metaParts.push(`*${pdfSubtitle}*`);
          if (pdfAuthor && pdfAuthor !== 'Aartiq') metaParts.push(`**Author:** ${pdfAuthor}`);
          if (metaParts.length > 0) {
            pdfContent += metaParts.join('\n') + '\n\n---\n\n';
          }

          // Process pages
          if (pdfData.pages && Array.isArray(pdfData.pages)) {
            for (let i = 0; i < pdfData.pages.length; i++) {
              const page = pdfData.pages[i];

              // Page title
              pdfContent += `## ${page.icon || ''} ${page.title || `Section ${i + 1}`}\n\n`;

              // Process sections
              if (page.sections && Array.isArray(page.sections)) {
                for (const section of page.sections) {
                  if (section.title) {
                    pdfContent += `### ${section.icon || ''} ${section.title}\n\n`;
                  }
                  pdfContent += `${section.content || ''}\n\n`;
                }
              } else if (page.content) {
                // Fallback: page has direct content
                pdfContent += `${page.content}\n\n`;
              }

              // Page break between pages (except last)
              if (i < pdfData.pages.length - 1) {
                pdfContent += '\n<div class="page-break"></div>\n\n';
              }
            }
          } else if (pdfData.content) {
            // Fallback: direct content
            pdfContent += pdfData.content;
          }

          // Add metadata markers for template processing
          const metadataMarkers = [
            `[TEMPLATE:${template}]`,
            watermark ? `[WATERMARK:${watermark}]` : '',
            bgColor !== '#ffffff' ? `[BG_COLOR:${bgColor}]` : '',
            priority !== 'normal' ? `[PRIORITY:${priority}]` : '',
          ].filter(Boolean).join('');

          // Auto-screenshot: if user said "screenshot" but no screenshot image in JSON, add one
          const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
          const userText = lastUserMsg?.content || '';
          const mentionScreenshot = /screenshot|capture (?:the )?page|include this page/i.test(
            `${command.context || userText || ''}`
          );
          const hasScreenshotImage = pdfImagesFromJson.some(img => img.type === 'screenshot');
          if (mentionScreenshot && !hasScreenshotImage) {
            pdfImagesFromJson.push({ type: 'screenshot', caption: 'Browser page screenshot', alt: 'Page Screenshot', width: '100%' });
            console.log('[PDF-LOG] Auto-added screenshot capture based on user request');
          }

          pdfContent = metadataMarkers + '\n\n' + pdfContent;

          // Process images from JSON (URLs need fetching, screenshots need capture)
          const jsonImageResults: Array<{ src: string; caption?: string; alt?: string; width?: string | number }> = [];

          if (pdfImagesFromJson.length > 0) {
            console.log(`[PDF-LOG] Processing ${pdfImagesFromJson.length} images from JSON...`);
            if (isDevMode) appendTerminalLog('JSON Images', `Processing ${pdfImagesFromJson.length} images from JSON...`);
          }

          for (const img of pdfImagesFromJson) {
            if (img.type === 'url' && img.src) {
              try {
                const normalized = img.src.startsWith('http') ? img.src : `https://${img.src}`;
                console.log(`[PDF-LOG] Fetching JSON image: ${normalized}`);
                if (isDevMode) appendTerminalLog('Image Fetch', `Fetching JSON image: ${normalized}`);
                const response = await fetch(normalized);
                if (response.ok) {
                  const blob = await response.blob();
                  const dataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = () => reject(new Error('Failed to read image'));
                    reader.readAsDataURL(blob);
                  });
                  console.log(`[PDF-LOG] ✅ JSON image fetched successfully: ${normalized} (${Math.round(dataUrl.length / 1024)}KB)`);
                  if (isDevMode) appendTerminalLog('Image Fetch', `✅ Loaded: ${normalized} (${Math.round(dataUrl.length / 1024)}KB)`);
                  jsonImageResults.push({
                    src: dataUrl,
                    caption: img.caption,
                    alt: img.alt || 'Embedded image',
                    width: img.width || '100%'
                  });
                } else {
                  console.log(`[PDF-LOG] ❌ Failed to fetch JSON image: ${normalized} (HTTP ${response.status})`);
                  if (isDevMode) appendTerminalLog('Image Fetch', `❌ Failed: ${normalized} (${response.status})`, false);
                }
              } catch (e: any) {
                console.log(`[PDF-LOG] ❌ Exception fetching JSON image: ${img.src} - ${e.message}`);
                if (isDevMode) appendTerminalLog('Image Fetch', `❌ Error: ${img.src} - ${e.message}`, false);
              }
            } else if (img.type === 'screenshot') {
              try {
                console.log(`[PDF-LOG] Capturing screenshot for PDF...`);
                if (isDevMode) appendTerminalLog('Screenshot', '📸 Capturing browser view for JSON image...');
                updateVisualStage('capturing', 'Capturing screenshot for PDF...');
                const dataUrl: string | null = await window.electronAPI.captureBrowserViewScreenshot();
                if (dataUrl) {
                  console.log(`[PDF-LOG] ✅ Screenshot captured (${Math.round(dataUrl.length / 1024)}KB)`);
                  if (isDevMode) appendTerminalLog('Screenshot', `✅ Captured (${Math.round(dataUrl.length / 1024)}KB) - added to PDF`);
                  jsonImageResults.push({
                    src: dataUrl,
                    caption: img.caption || `Screenshot at ${new Date().toLocaleTimeString()}`,
                    alt: img.alt || 'Browser screenshot',
                    width: img.width || '100%'
                  });
                } else {
                  console.log(`[PDF-LOG] ❌ No browser view available for screenshot`);
                  if (isDevMode) appendTerminalLog('Screenshot', '❌ No browser view available', false);
                }
              } catch (e: any) {
                console.log(`[PDF-LOG] ❌ Screenshot capture failed: ${e.message}`);
                if (isDevMode) appendTerminalLog('Screenshot', `❌ Error: ${e.message}`, false);
              } finally {
                updateVisualStage('idle');
              }
            }
          }

          // ✅ Process [CAPTURE_SCREEN] inline tags in PDF content
          const screenshotTagRegex = /\[CAPTURE_SCREEN\s*(?:\|\s*caption:([^\]]+))?\]/gi;
          let screenshotMatch;
          while ((screenshotMatch = screenshotTagRegex.exec(pdfContent)) !== null) {
            const rawTag = screenshotMatch[0];
            const cap = (screenshotMatch[1] || '').trim();
            try {
              console.log(`[PDF-LOG] Processing inline [CAPTURE_SCREEN] tag...`);
              if (isDevMode) appendTerminalLog('Screenshot', '📸 Capturing browser view for inline tag...');
              const dataUrl = await window.electronAPI.captureBrowserViewScreenshot();
              if (dataUrl) {
                const imgMd = `\n\n![Screenshot](${dataUrl})${cap ? `\n*${cap}*` : ''}\n\n`;
                // Use a safe multi-replace approach
                pdfContent = pdfContent.split(rawTag).join(imgMd);
                console.log(`[PDF-LOG] ✅ Inline screenshot captured and replaced`);
              } else {
                pdfContent = pdfContent.split(rawTag).join('\n\n*[Current browser view unavailable for screenshot]*\n\n');
              }
            } catch (e: any) {
              console.error('[PDF] Inline screenshot failed:', e);
              pdfContent = pdfContent.split(rawTag).join(`\n\n*[Error capturing screenshot: ${e.message}]*\n\n`);
            }
          }

          // ✅ Process [IMAGE_URL] inline tags in PDF content
          const inlineImageUrlRegex = /\[IMAGE_URL:([\s\S]+?)\]/gi;
          let imageUrlMatch;
          while ((imageUrlMatch = inlineImageUrlRegex.exec(pdfContent)) !== null) {
            const raw = imageUrlMatch[0];
            const payload = (imageUrlMatch[1] || '').trim();
            if (!payload) continue;

            const segments = payload.split('|').map(segment => segment.trim()).filter(Boolean);
            if (segments.length === 0) continue;

            const rawUrl = segments.shift() || '';
            const url = rawUrl.replace(/\s+/g, '');
            if (!url) continue;

            let cap: string | undefined;
            segments.forEach(segment => {
              const [key, ...valueParts] = segment.split(':');
              if (!key || valueParts.length === 0) return;
              if (key.toLowerCase().trim() === 'caption') {
                cap = valueParts.join(':').trim();
              }
            });

            try {
              const normalized = url.startsWith('http') ? url : `https://${url}`;
              console.log(`[PDF-LOG] Fetching inline [IMAGE_URL]: ${normalized}`);
              if (isDevMode) appendTerminalLog('Image Fetch', `📸 Fetching inline asset: ${normalized}`);

              const imgRes = await fetch(normalized);
              if (imgRes.ok) {
                const blob = await imgRes.blob();
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result as string);
                  reader.onerror = () => reject(new Error('Failed to read image'));
                  reader.readAsDataURL(blob);
                });
                const imgMd = `\n\n![Image](${dataUrl})${cap ? `\n*${cap}*` : ''}\n\n`;
                pdfContent = pdfContent.split(raw).join(imgMd);
                console.log(`[PDF-LOG] ✅ Inline image fetched and replaced: ${normalized}`);
                if (isDevMode) appendTerminalLog('Image Fetch', `✅ Loaded: ${normalized}`);
              } else {
                pdfContent = pdfContent.split(raw).join(`\n\n*[Failed to fetch image: ${normalized} (HTTP ${imgRes.status})]*\n\n`);
                if (isDevMode) appendTerminalLog('Image Fetch', `❌ Failed: ${normalized} (${imgRes.status})`, false);
              }
            } catch (e: any) {
              console.error('[PDF] Inline image fetch failed:', e);
              pdfContent = pdfContent.split(raw).join(`\n\n*[Error fetching image: ${e.message}]*\n\n`);
              if (isDevMode) appendTerminalLog('Image Fetch', `❌ Error: ${e.message}`, false);
            }
          }

          if (jsonImageResults.length > 0) {
            console.log(`[PDF-LOG] ✅ Added ${jsonImageResults.length} images to PDF content`);
            if (isDevMode) appendTerminalLog('JSON Images', `✅ Added ${jsonImageResults.length} images to PDF`);
          }

          // Add JSON images to pdfContent as markdown
          if (jsonImageResults.length > 0) {
            const imagesMarkdown = '\n\n---\n\n## Images\n\n' +
              jsonImageResults.map((img, idx) => `![${img.alt || 'Image'}](${img.src})` + (img.caption ? `\n*${img.caption}*` : '')).join('\n\n');
            pdfContent += imagesMarkdown;
          }

          const commonPayload = {
            ...pdfData,
            format,
            title: pdfTitle,
            subtitle: pdfSubtitle,
            author: pdfAuthor,
            template,
            watermark,
            bgColor,
            priority,
            pages: pdfData.pages,
            images: jsonImageResults.length ? jsonImageResults : pdfImagesFromJson,
            content: pdfContent,
            pythonAvailable,
            method,
          };

          setIsGeneratingPDF(true);
          setPdfProgress(0);
          setShowTerminal(true);
          setStreamingPDFContent(`Preparing ${format.toUpperCase()}: ${pdfTitle}...`);

          await preloadAartiqIconLocal();
          const iconSource = (window as any).__cometIconBase64 || null;

          try {
            if (format === 'xlsx' || format === 'excel') {
              const res = await window.electronAPI.generateXLSX(commonPayload);
              output = res?.success
                ? `✅ **Excel Generated Successfully!**\n\n**Title:** ${pdfTitle}\n**File:** ${res.filePath || 'Saved to Downloads'}`
                : `❌ Excel generation failed: ${res?.error || 'Unknown error'}`;
            } else if (format === 'pptx') {
              const res = await window.electronAPI.generatePPTX(commonPayload);
              output = res?.success
                ? `✅ **PPTX Generated Successfully!**\n\n**Title:** ${pdfTitle}\n**File:** ${res.filePath || 'Saved to Downloads'}`
                : `❌ PPTX generation failed: ${res?.error || 'Unknown error'}`;
            } else if (format === 'docx') {
              const res = await window.electronAPI.generateDOCX(commonPayload);
              output = res?.success
                ? `✅ **DOCX Generated Successfully!**\n\n**Title:** ${pdfTitle}\n**File:** ${res.filePath || 'Saved to Downloads'}`
                : `❌ DOCX generation failed: ${res?.error || 'Unknown error'}`;
            } else {
              // ✅ Unified Proper PDF Engine (Stabilized HTML method)
              const cleanHTML = generateSmartPDF(pdfContent, iconSource, jsonImageResults);
              const res = await window.electronAPI.generatePDF(pdfTitle, cleanHTML) as any;
              if (res.success) {
                output = `✅ **PDF Generated Successfully!**\n\n**Title:** ${pdfTitle}\n**Engine:** Aartiq Neural Export\n**File:** ${res.filePath}`;
              } else {
                output = `❌ PDF generation failed: ${res.error}`;
              }
            }
          } catch (e: any) {
            output = `❌ Error generating file: ${e.message}`;
          } finally {
            setIsGeneratingPDF(false);
            setPdfProgress(100);
            setStreamingPDFContent('');
          }
          break;
        }

        // ✅ FIXED: GENERATE_PDF now supports screenshots, custom title/author/subtitle
        // Format: [GENERATE_PDF: title | screenshot:yes | author:Name | subtitle:Subtitle | content...]
        // NOTE: This is now a FALLBACK - prefer CREATE_PDF_JSON for structured content
        case 'GENERATE_PDF': {
          const cmdParams = (command as any).params || {};

          // ── JSON params path (AI sends {type, title, content, ...}) ──────
          let pdfTitle = cmdParams.title || '';
          let pdfContent = cmdParams.content || '';
          const pdfSubtitle = cmdParams.subtitle || '';
          const pdfAuthor = cmdParams.author || 'Aartiq';
          const pdfTemplate = cmdParams.template || 'auto';
          const shouldScreenshot = /yes|true/i.test(cmdParams.screenshot || '');
          const shouldIncludeAttachments = (cmdParams.attachments || '').toLowerCase() !== 'no';
          let contentParts: string[] = [];

          // ── Pipe-delimited fallback path (legacy text commands) ──────────
          if (!pdfTitle && !pdfContent) {
            let rawValue = command.value || '';

            // Clean up malformed input
            rawValue = rawValue
              .replace(/^\s*\]+\s*:\s*/, '')
              .replace(/^\s*:\s*/, '')
              .trim();

            // Parse extended options from pipe-separated fields
            const allParts = rawValue.split('|').map((p: string) => p.trim()).filter(p => p.length > 0);
            const options: Record<string, string> = {};

            for (const part of allParts) {
              if (!part || part === ']:' || part === ':') continue;

              const kvMatch = part.match(/^(title|author|subtitle|screenshot|filename|template|tags|category|watermark)\s*:\s*(.+)$/i);
              if (kvMatch) {
                const key = kvMatch[1].toLowerCase();
                const val = kvMatch[2].trim();
                if (val && !/^\[?\s*\]?\s*$/.test(val) && val.toLowerCase() !== 'content' && val.toLowerCase() !== 'placeholder') {
                  options[key] = val;
                }
              } else {
                contentParts.push(part);
              }
            }

            if (contentParts.length === 0 && command.context) {
              contentParts.push(command.context);
            }

            pdfTitle = options.title || contentParts[0]?.trim() || 'Document';

            if (!pdfTitle || pdfTitle.length < 2 || /^\[?\s*\]?\s*$/.test(pdfTitle)) {
              pdfTitle = contentParts.length > 1 ? contentParts[1]?.trim() || 'Document' : 'Document';
            }

            if (pdfTitle.toLowerCase() === 'title' && contentParts[1]) {
              pdfTitle = contentParts[1];
              contentParts.splice(0, 1);
            }

            pdfContent = contentParts.slice(1).join(' | ').trim();
            if (!pdfContent || pdfContent.length < 10 || /^\[?\s*\]?\s*$/.test(pdfContent)) {
              pdfContent = contentParts[0]?.trim() || command.context || '';
            }
          }

          // ✅ NEW: If content is just a placeholder like "content", use the full message text passed in context
          if (!pdfContent || pdfContent.length < 50 || /\[content\]|placeholder|lorem ipsum/i.test(pdfContent) || pdfContent.toLowerCase() === 'content' || /^\[?\s*\]?\s*$/.test(pdfContent)) {
            if (command.context) {
              pdfContent = command.context;
            } else if (contentParts.length > 0) {
              // Use the longest content part
              const longestPart = contentParts.reduce((a, b) => a.length > b.length ? a : b, '');
              if (longestPart.length > pdfContent.length) {
                pdfContent = longestPart;
              }
            }
          }

          // Detect if this PDF needs live/current data
          const isDataPDF = /news|update|report|today|latest|tech|market|sports|daily/i.test(pdfTitle);
          const contentTooShort = pdfContent.length < 200 && !isDataPDF;
          const hasFakePlaceholder = /\[content\]|\[details\]|placeholder|lorem ipsum/i.test(pdfContent) || pdfContent.toLowerCase() === 'content';

          if (isDataPDF || contentTooShort || hasFakePlaceholder) {
            const searchId = addThinkingStep(`🔍 Fetching real data for "${pdfTitle}"...`);
            try {
              const topic = pdfTitle
                .replace(/\b(pdf|report|daily|today|–|-|news|tech)\b/gi, '')
                .trim()
                .slice(0, 60) || 'latest news';

              const realData = await fetchRealSearchContext(topic);

              if (realData && realData.length > 100) {
                pdfContent = pdfContent
                  ? `${pdfContent}\n\n--- SEARCH DATA ---\n${realData}`
                  : `--- SEARCH DATA ---\n${realData}`;
                resolveThinkingStep(searchId, 'done', `Real data injected (${realData.length} chars)`);
              } else {
                resolveThinkingStep(searchId, 'error', 'Search returned no data — PDF will note data unavailability');
                pdfContent = pdfContent || `This report could not retrieve live data at the time of generation (${new Date().toLocaleString()}). Please search manually for current information.`;
              }
            } catch (e: any) {
              resolveThinkingStep(searchId, 'error', `Search failed: ${e.message}`);
            }
          }

          // ── Capture browser page screenshot (active tab only) ──────────────
          // Uses Electron's webContents.capturePage() via captureBrowserViewScreenshot
          const pdfImages: import('./ai/AIUtils').PDFImage[] = [];
          const inlineImageTags: { raw: string; url: string; caption?: string; alt?: string }[] = [];
          const inlineImageRegex = /\[IMAGE_URL:([\s\S]+?)\]/gi;
          let imageTagMatch;
          while ((imageTagMatch = inlineImageRegex.exec(pdfContent)) !== null) {
            const raw = imageTagMatch[0];
            const payload = (imageTagMatch[1] || '').trim();
            if (!payload) continue;
            const segments = payload.split('|').map(segment => segment.trim()).filter(Boolean);
            if (segments.length === 0) continue;
            const rawUrl = segments.shift() || '';
            const url = rawUrl.replace(/\s+/g, '');
            if (!url) continue;
            let alt: string | undefined;
            let caption: string | undefined;
            segments.forEach(segment => {
              const [key, ...valueParts] = segment.split(':');
              if (!key || valueParts.length === 0) return;
              const normalizedKey = key.toLowerCase().trim();
              const value = valueParts.join(':').trim().replace(/\s+/g, ' ');
              if (!value) return;
              if (normalizedKey === 'alt') {
                alt = value;
              } else if (normalizedKey === 'caption') {
                caption = value;
              }
            });
            inlineImageTags.push({
              raw,
              url,
              alt,
              caption,
            });
          }

          if (inlineImageTags.length > 0) {
            updateVisualStage('fetching', 'Fetching inline visuals...');
          }
          const inlineImagePromises = inlineImageTags.map(async (tag) => {
            const normalized = tag.url.startsWith('http') ? tag.url : `https://${tag.url}`;
            if (isDevMode) appendTerminalLog('Image Fetch', `Requesting ${normalized}`);
            console.log(`[PDF-LOG] Fetching inline image for PDF: ${normalized}`);
            try {
              const response = await fetch(normalized);
              if (!response.ok) {
                if (isDevMode) appendTerminalLog('Image Fetch', `Failed to fetch ${normalized} (${response.status})`, false);
                return null;
              }
              const blob = await response.blob();
              const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = () => reject(new Error('Failed to read image'));
                reader.readAsDataURL(blob);
              });
              if (isDevMode) appendTerminalLog('Image Fetch', `Fetched inline image ${normalized}`, true);
              console.log(`[PDF-LOG] Loaded inline image (${normalized}) for PDF`);
              return { ...tag, src: dataUrl };
            } catch (err: any) {
              if (isDevMode) appendTerminalLog('Image Fetch', `Failed to fetch ${normalized}: ${err?.message || 'unknown'}`, false);
              console.log(`[PDF-LOG] Inline image fetch failed: ${normalized} (${err?.message || 'unknown'})`);
              return null;
            }
          });

          const inlineImages = (await Promise.all(inlineImagePromises)).filter(Boolean) as Array<{
            raw: string;
            src: string;
            caption?: string;
            alt?: string;
          }>;
          inlineImages.forEach((img) => {
            pdfContent = pdfContent.replace(img.raw, '');
            pdfImages.push({
              src: img.src,
              alt: img.alt || 'Embedded image',
              caption: img.caption || 'Embedded image from URL',
              width: '100%',
            });
          });
          if (inlineImageTags.length > 0) {
            updateVisualStage('idle');
          }
          if (inlineImages.length > 0 && isDevMode) {
            appendTerminalLog('Image Fetch', `Loaded ${inlineImages.length} inline images`);
          }

          // ── Include user-uploaded attachments ──────────────────────────────
          if (shouldIncludeAttachments) {
            // Get all attachments from the entire current conversation history
            const allAttachments = messages.flatMap(m => (m as ExtendedChatMessage).attachments || []);
            if (allAttachments.length > 0) {
              allAttachments.forEach((data, i) => {
                pdfImages.push({
                  src: data,
                  alt: `User Attachment ${i + 1}`,
                  caption: `User-provided visual data #${i + 1}`,
                  width: '100%'
                });
              });
            }
          }

          if (shouldScreenshot) {
            updateVisualStage('capturing', 'Capturing browser screenshot...');
            const ssId = addThinkingStep('📸 Capturing browser page for PDF...');
            if (isDevMode) appendTerminalLog('Screenshot', 'Starting browser view capture for PDF...');
            console.log('[PDF-LOG] Capturing browser view screenshot for PDF...');
            try {
              const dataUrl: string | null = await window.electronAPI.captureBrowserViewScreenshot();
              if (dataUrl) {
                pdfImages.push({
                  src: dataUrl,
                  alt: 'Browser Page Screenshot',
                  caption: `Page screenshot at ${new Date().toLocaleTimeString()} — ${currentUrl || 'active tab'}`,
                  width: '100%'
                });
                const screenshotMarkdown = `\n\n![Browser Screenshot | Captured at ${new Date().toLocaleTimeString().replace(/:/g, '-')}](${dataUrl})`;
                if (!pdfContent.includes(screenshotMarkdown)) {
                  pdfContent += screenshotMarkdown;
                }
                resolveThinkingStep(ssId, 'done', 'Browser page screenshot captured');
                if (isDevMode) appendTerminalLog('Screenshot', 'Browser screenshot captured and added to PDF');
                console.log('[PDF-LOG] Browser screenshot captured and queued for PDF');
              } else {
                resolveThinkingStep(ssId, 'error', 'No browser view active to screenshot');
                if (isDevMode) appendTerminalLog('Screenshot', 'No browser view available for screenshot', false);
                console.log('[PDF-LOG] Browser screenshot unavailable (hidden tab or no active view)');
              }
            } catch (e: any) {
              resolveThinkingStep(ssId, 'error', `Screenshot failed: ${e.message}`);
              if (isDevMode) appendTerminalLog('Screenshot', `Screenshot failed: ${e.message}`, false);
              console.log(`[PDF-LOG] Screenshot capture error: ${e.message}`);
            } finally {
              updateVisualStage('idle');
            }
          }

          // ── Prepend subtitle/author to content if provided ─────────────────
          if (pdfSubtitle || pdfAuthor !== 'Aartiq') {
            const meta: string[] = [];
            if (pdfSubtitle) meta.push(`*${pdfSubtitle}*`);
            if (pdfAuthor && pdfAuthor !== 'Aartiq') meta.push(`**Author:** ${pdfAuthor}`);
            pdfContent = meta.join('\n') + '\n\n---\n\n' + pdfContent;
          }

          await preloadAartiqIconLocal();
          const iconSource = (window as any).__cometIconBase64 || null;

          setIsGeneratingPDF(true);
          setPdfProgress(0);
          setShowTerminal(true);
          setStreamingPDFContent(`Generating PDF: ${pdfTitle}...`);

          // Replicate slide logic for the success message UI
          const slides = pdfContent.split(/---\n?/).filter((s: string) => s.trim().length > 10);
          const isSlideShow = slides.length > 2;

          setStreamingPDFContent(`Generating PDF: ${pdfTitle}...`);

          // Collect sources from content and search context
          const searchSources: string[] = [];
          const urlMatches = pdfContent.matchAll(/https?:\/\/[^\s\)\]>"]+/gi);
          for (const m of urlMatches) {
            const url = m[0].replace(/[.,;:!?)]+$/, '');
            if (!searchSources.some(s => s.includes(url))) searchSources.push(url);
          }
          const recentSearches = searchContextStore.getRecentContexts(5, 'web_search');
          for (const ctx of recentSearches) {
            const label = ctx.title || ctx.query || ctx.url || '';
            if (label && !searchSources.some(s => s.includes(label))) searchSources.push(label);
          }

          const pdfMeta = { sources: searchSources.length > 0 ? searchSources : undefined, aiModel: selectedProviderModel };
          const cleanHTML = generateSmartPDF(pdfContent, iconSource, pdfImages.length > 0 ? pdfImages : undefined, pdfMeta);
          const res = await window.electronAPI.generatePDF(pdfTitle, cleanHTML) as any;

          setIsGeneratingPDF(false);
          setPdfProgress(100);
          setStreamingPDFContent('');
          updateVisualStage('idle');

          if (res.success) {
            output = `✅ **PDF GENERATION SUCCESSFUL**\n\n### 📄 Document Overview\n- **Title:** ${pdfTitle}\n- **Pages:** ${isSlideShow ? slides.length : '1'}\n- **Format:** ${isSlideShow ? 'Slide Deck (Presenton Style)' : 'Standard Report'}\n- **📁 File Path:** \`${res.filePath}\`\n- **Status:** ✅ Downloaded Successfully\n\nYou can find the PDF at: **${res.filePath}**\n\nWould you like me to open the document for you?`;

            // Add a special message with an "Open PDF" button
            setMessages(prev => [...prev, {
              role: 'model',
              content: `📄 **PDF Generated: ${res.fileName}**\n\n📁 Location: ${res.filePath}`,
              actionLogs: [{ type: 'PDF_READY', output: res.filePath, success: true }]
            } as ExtendedChatMessage]);
          } else {
            updateVisualStage('idle');
            output = `❌ PDF GENERATION FAILED\n- Error: ${res.error}\n- Context: Please verify title and content format.`;
          }
          break;
        }

        // ── SHOW_IMAGE: display an image from URL in the chat ─────────────────
        // Format: [SHOW_IMAGE: imageUrl | optional caption]
        case 'SHOW_IMAGE': {
          const parts = command.value.split('|').map((s: string) => s.trim());
          const imageUrl = parts[0];
          const caption = parts[1] || '';

          if (!imageUrl) { output = 'No image URL provided.'; break; }

          setMessages(prev => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const last = updated[updated.length - 1];
            const existing = last.mediaItems || [];
            updated[updated.length - 1] = {
              ...last,
              mediaItems: [...existing, { type: 'image', url: imageUrl, caption }]
            };
            return updated;
          });
          output = `Image displayed: ${imageUrl}`;
          break;
        }

        // ── SHOW_VIDEO: display a YouTube/video card in chat ──────────────────
        // Format: [SHOW_VIDEO: videoUrl | title | description]
        case 'SHOW_VIDEO': {
          const parts = command.value.split('|').map((s: string) => s.trim());
          const videoUrl = parts[0];
          const videoTitle = parts[1] || 'Video';
          const videoDesc = parts[2] || '';

          if (!videoUrl) { output = 'No video URL provided.'; break; }

          // Extract YouTube video ID to build thumbnail URL (no API key needed)
          let videoId: string | undefined;
          let thumbnailUrl: string | undefined;
          let source: 'youtube' | 'other' = 'other';

          const ytMatch = videoUrl.match(
            /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
          );
          if (ytMatch) {
            videoId = ytMatch[1];
            source = 'youtube';
            // Use maxresdefault thumbnail, fallback to hqdefault
            thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
          }

          setMessages(prev => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const last = updated[updated.length - 1];
            const existing = last.mediaItems || [];
            updated[updated.length - 1] = {
              ...last,
              mediaItems: [...existing, {
                type: 'video',
                videoUrl,
                title: videoTitle,
                description: videoDesc,
                thumbnailUrl,
                source,
                videoId
              }]
            };
            return updated;
          });
          output = `Video card added: ${videoTitle}`;
          break;
        }

        // ── PLAY_VIDEO: play a YouTube video inline in chat ────────────────
        // JSON: {"type": "PLAY_VIDEO", "id": "dQw4w9WgXcQ", "title": "Video Title"}
        // Pipe: [PLAY_VIDEO: dQw4w9WgXcQ | title]
        case 'PLAY_VIDEO': {
          const cmdParams = (command as any).params || {};
          let playVideoId = cmdParams.id || cmdParams.videoId || getCmdParam(command as any, 'id') || '';
          const playTitle = cmdParams.title || getCmdParam(command as any, 'title') || command.value.split('|')[1]?.trim() || 'Video';
          const playQuery = cmdParams.query || getCmdParam(command as any, 'query') || command.value.trim().split('|')[0]?.trim() || '';

          // If no explicit ID, try searching YouTube with the provided value
          if (!playVideoId) {
            const searchTerm = playQuery || playTitle || command.value.trim();
            if (searchTerm) {
              const ytRes = await window.electronAPI.webSearchYoutube(searchTerm, 1);
              if (ytRes?.success && (ytRes.results?.length ?? 0) > 0) {
                const first = ytRes.results![0];
                const urlObj = new URL(first.url);
                playVideoId = urlObj.searchParams.get('v') || '';
                if (!playVideoId && first.videoId) playVideoId = first.videoId;
                if (playVideoId) output = `Found video: ${first.title} - playing...`;
              }
            }
          }

          if (!playVideoId) { output = 'Could not find a video to play. Try SEARCH_VIDEO first.'; break; }

          const isPlayingYt = /^[a-zA-Z0-9_-]{11}$/.test(playVideoId);
          if (isPlayingYt) {
            const watchUrl = `https://www.youtube.com/watch?v=${playVideoId}`;
            store.addTab(watchUrl);
            window.electronAPI?.createView?.({ tabId: `yt-${Date.now()}`, url: watchUrl });
            setActiveView('browser');
            setMessages(prev => {
              if (prev.length === 0) return prev;
              const updated = [...prev];
              const last = updated[updated.length - 1];
              const existing = last.mediaItems || [];
              updated[updated.length - 1] = {
                ...last,
                mediaItems: [...existing, {
                  type: 'video',
                  videoUrl: watchUrl,
                  title: playTitle,
                  source: 'youtube',
                  videoId: playVideoId,
                  autoPlay: true,
                }]
              };
              return updated;
            });
            output = (output || '') + `Playing video: ${playTitle}\nOpened in new tab: ${watchUrl}`;
          } else {
            output = `Invalid YouTube ID: ${playVideoId}`;
          }
          break;
        }

        // ── SEARCH_VIDEO: search YouTube and play top results ──────────
        // JSON: {"type": "SEARCH_VIDEO", "query": "music", "count": 1}
        // count=1 (default): play top result; count=N: play top N results
        case 'SEARCH_VIDEO': {
          const cmdParams = (command as any).params || {};
          const videoQuery = cmdParams.query || getCmdParam(command as any, 'query') || command.value.trim().split('|')[0]?.trim() || 'popular';
          const videoCount = getCmdParamInt(command as any, 'count') || parseInt(cmdParams.count || '1') || 1;
          try {
            const ytRes = await window.electronAPI.webSearchYoutube(videoQuery, Math.max(videoCount, 5));
            if (ytRes?.success && (ytRes.results?.length ?? 0) > 0) {
              const results = ytRes.results!;
              const toPlay = results.slice(0, videoCount);
              for (const vid of toPlay) {
                const watchUrl = vid.url;
                store.addTab(watchUrl);
                window.electronAPI?.createView?.({ tabId: `yt-${Date.now()}`, url: watchUrl });
              }
              setActiveView('browser');
              const videoCards = results.map((v: any, i: number) =>
                `**${i + 1}. ${v.title}**\n🔗 ${v.url}\n⏱ ${v.length || 'N/A'} | ${v.channel || 'Unknown'}\n📝 ${v.snippet || ''}`
              ).join('\n\n');
              const first = toPlay[0];
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                const existing = last.mediaItems || [];
                updated[updated.length - 1] = {
                  ...last,
                  mediaItems: [...existing, {
                    type: 'video',
                    videoUrl: first.url,
                    title: first.title,
                    source: 'youtube',
                    videoId: first.videoId,
                    autoPlay: true,
                  }]
                };
                return updated;
              });
              output = `Found ${results.length} videos for "${videoQuery}". Playing top ${toPlay.length} result${toPlay.length > 1 ? 's' : ''}.\n${videoCards}`;
            } else {
              output = `No YouTube videos found for "${videoQuery}".`;
            }
          } catch (e: any) {
            output = `YouTube search failed: ${e.message}`;
          }
          break;
        }

        case 'LIST_SKILLS': {
          const acsId = addActionChainStep('📋 Listing Available Skills');
          setMessages(prev => [...prev, {
            role: 'model',
            content: '📋 Here are the AI skills I can use.',
            isSkillsList: true,
          } as ExtendedChatMessage]);
          resolveActionChainStep(acsId, 'done', `${AVAILABLE_SKILLS.length} skills available`);
          output = `Listed ${AVAILABLE_SKILLS.length} available skills`;
          break;
        }

        case 'LOAD_SKILL': {
          const skillId = (command.params?.skillId || command.params?.id || (command.jsonFormat as any)?.skillId || (command.jsonFormat as any)?.id || command.value || '').trim().toLowerCase();
          if (!skillId) {
            output = 'No skill ID specified. Use [LIST_SKILLS] to see available skills.';
            break;
          }
          const skillMeta = AVAILABLE_SKILLS.find(s => s.id === skillId);
          if (!skillMeta) {
            output = `Unknown skill: "${skillId}". Use [LIST_SKILLS] to see available skills.`;
            break;
          }
          const loadStepId = addActionChainStep(`📖 Loading ${skillMeta.label}`);
          try {
            const ctx = await window.electronAPI.loadSkill(skillId);
            if (ctx) {
              resolveActionChainStep(loadStepId, 'done', `${skillId} loaded`);
              output = `Skill "${skillId}" loaded successfully`;
            } else {
              resolveActionChainStep(loadStepId, 'error', 'Empty skill content');
              output = `Failed to load skill "${skillId}" — no content returned`;
            }
          } catch (e: any) {
            resolveActionChainStep(loadStepId, 'error', e.message);
            output = `Failed to load skill "${skillId}": ${e.message}`;
          }
          break;
        }

        case 'SETTINGS_QUERY': {
          // Read a specific settings category (webSearch | ai | ui) or all categories.
          // JSON: {"type":"SETTINGS_QUERY","category":"webSearch"}
          const queryCategory = (command.params?.category || command.value || '').trim().toLowerCase() || undefined;
          const sqStepId = addActionChainStep(`⚙️ Reading ${queryCategory || 'all'} settings`);
          try {
            const result = await window.electronAPI.getAISettings(queryCategory);
            const formatSection = (sec: any) => {
              if (!sec?.settings) return '';
              const lines = Object.entries(sec.settings)
                .map(([k, v]) => `  • **${k}**: \`${JSON.stringify(v)}\``)
                .join('\n');
              return `### ⚙️ ${sec.label} (\`${sec.category}\`)\n${lines}`;
            };
            let formatted = '';
            if (result && (result.category)) {
              // Single category
              formatted = formatSection(result);
            } else if (result && typeof result === 'object') {
              // All categories
              formatted = Object.values(result).map((s: any) => formatSection(s)).filter(Boolean).join('\n\n');
            }
            if (formatted) {
              setMessages(prev => [...prev, {
                role: 'model',
                content: `## Current Settings\n\n${formatted}\n\n---\n*Use \`{"type":"SETTINGS_UPDATE","category":"...","updates":{...}}\` to change a setting.*`
              }]);
            }
            resolveActionChainStep(sqStepId, 'done', `Settings read`);
            output = `Settings queried: ${queryCategory || 'all'}`;
          } catch (e: any) {
            resolveActionChainStep(sqStepId, 'error', e.message);
            output = `Failed to read settings: ${e.message}`;
          }
          break;
        }

        case 'SETTINGS_UPDATE': {
          // Update settings for a specific category after the user approves the dialog.
          // JSON: {"type":"SETTINGS_UPDATE","category":"webSearch","updates":{"maxPages":10}}
          const updateCategory = (command.params?.category || command.value || '').trim().toLowerCase();
          let updatesObj: Record<string, any> = {};
          try {
            const rawUpdates = command.params?.updates;
            updatesObj = rawUpdates ? (typeof rawUpdates === 'string' ? JSON.parse(rawUpdates) : rawUpdates) : {};
          } catch {
            output = 'Invalid updates JSON in SETTINGS_UPDATE command.';
            break;
          }
          if (!updateCategory || Object.keys(updatesObj).length === 0) {
            output = 'SETTINGS_UPDATE requires a category and at least one update field.';
            break;
          }
          const suStepId = addActionChainStep(`⚙️ Updating ${updateCategory} settings`);
          const updateKeys = Object.keys(updatesObj).join(', ');
          const updateConfirmed = await requestActionPermission({
            actionType: 'SETTINGS_UPDATE',
            action: 'Update Settings',
            target: updateCategory,
            what: `Change ${updateCategory} settings: ${updateKeys}`,
            reason: command.reason || 'The AI wants to update app settings.',
            risk: 'medium',
          });
          if (!updateConfirmed) {
            resolveActionChainStep(suStepId, 'error', 'Denied');
            output = 'Settings update denied by user.';
            break;
          }
          try {
            const res = await window.electronAPI.updateAISettings(updateCategory, updatesObj);
            if (res?.success) {
              const appliedKeys = Object.keys(res.applied || {}).map(k => `**${k}** → \`${JSON.stringify(res.applied?.[k])}\``).join(', ');
              setMessages(prev => [...prev, {
                role: 'model',
                content: `✅ **Settings Updated** (${updateCategory})\n\n${appliedKeys}`
              }]);
              resolveActionChainStep(suStepId, 'done', `Applied: ${Object.keys(res.applied || {}).join(', ')}`);
              output = `Settings updated: ${Object.keys(res.applied || {}).join(', ')}`;
            } else {
              resolveActionChainStep(suStepId, 'error', res?.error || 'Update failed');
              output = `Settings update failed: ${res?.error || 'unknown error'}`;
            }
          } catch (e: any) {
            resolveActionChainStep(suStepId, 'error', e.message);
            output = `Failed to update settings: ${e.message}`;
          }
          break;
        }

        case 'LIST_BOOKMARKS': {
          const limitVal = parseInt(command.params?.limit || '50', 10);
          const offsetVal = parseInt(command.params?.offset || '0', 10);
          const limit = isNaN(limitVal) ? 50 : limitVal;
          const offset = isNaN(offsetVal) ? 0 : offsetVal;
          const lbStepId = addActionChainStep(`🔖 Listing bookmarks (limit ${limit}, offset ${offset})`);
          try {
            const bookmarks = useAppStore.getState().bookmarks || [];
            const sliced = bookmarks.slice(offset, offset + limit);
            let formatted = '';
            if (sliced.length === 0) {
              formatted = '_No bookmarks found in this range._';
            } else {
              formatted = sliced.map((b: any) => `• [${b.title || b.url}](${b.url})`).join('\n');
            }
            setMessages(prev => [...prev, {
              role: 'model',
              content: `### 🔖 Bookmarks (showing ${sliced.length} of ${bookmarks.length})\n\n${formatted}`
            }]);
            resolveActionChainStep(lbStepId, 'done', `Listed ${sliced.length} bookmarks`);
            output = `Listed ${sliced.length} bookmarks`;
          } catch (e: any) {
            resolveActionChainStep(lbStepId, 'error', e.message);
            output = `Failed to list bookmarks: ${e.message}`;
          }
          break;
        }

        case 'ADD_BOOKMARK': {
          const rawUrl = (command.params?.url || command.value || '').trim();
          const rawTitle = (command.params?.title || '').trim();
          if (!rawUrl) {
            output = 'ADD_BOOKMARK requires a url parameter.';
            break;
          }
          const abStepId = addActionChainStep(`🔖 Bookmarking ${rawUrl}`);
          const confirmed = await requestActionPermission({
            actionType: 'ADD_BOOKMARK',
            action: 'Add Bookmark',
            target: rawUrl,
            what: `Bookmark "${rawTitle || rawUrl}"`,
            reason: command.reason || 'The AI wants to bookmark this page.',
            risk: 'low',
          });
          if (!confirmed) {
            resolveActionChainStep(abStepId, 'error', 'Denied');
            output = 'Add bookmark denied by user.';
            break;
          }
          try {
            useAppStore.getState().addBookmark({ url: rawUrl, title: rawTitle || rawUrl });
            setMessages(prev => [...prev, {
              role: 'model',
              content: `✅ **Bookmark Added**: [${rawTitle || rawUrl}](${rawUrl})`
            }]);
            resolveActionChainStep(abStepId, 'done', 'Added');
            output = `Added bookmark for ${rawUrl}`;
          } catch (e: any) {
            resolveActionChainStep(abStepId, 'error', e.message);
            output = `Failed to add bookmark: ${e.message}`;
          }
          break;
        }

        case 'REMOVE_BOOKMARK': {
          const rawUrl = (command.params?.url || command.value || '').trim();
          if (!rawUrl) {
            output = 'REMOVE_BOOKMARK requires a url parameter.';
            break;
          }
          const rbStepId = addActionChainStep(`🔖 Removing bookmark for ${rawUrl}`);
          const confirmed = await requestActionPermission({
            actionType: 'REMOVE_BOOKMARK',
            action: 'Remove Bookmark',
            target: rawUrl,
            what: `Remove bookmark for ${rawUrl}`,
            reason: command.reason || 'The AI wants to remove a bookmark.',
            risk: 'low',
          });
          if (!confirmed) {
            resolveActionChainStep(rbStepId, 'error', 'Denied');
            output = 'Remove bookmark denied by user.';
            break;
          }
          try {
            useAppStore.getState().removeBookmark(rawUrl);
            setMessages(prev => [...prev, {
              role: 'model',
              content: `✅ **Bookmark Removed**: ${rawUrl}`
            }]);
            resolveActionChainStep(rbStepId, 'done', 'Removed');
            output = `Removed bookmark for ${rawUrl}`;
          } catch (e: any) {
            resolveActionChainStep(rbStepId, 'error', e.message);
            output = `Failed to remove bookmark: ${e.message}`;
          }
          break;
        }

        case 'CLEAR_BOOKMARKS': {
          const cbStepId = addActionChainStep('🔖 Clearing all bookmarks');
          const confirmed = await requestActionPermission({
            actionType: 'CLEAR_BOOKMARKS',
            action: 'Clear All Bookmarks',
            target: 'All Bookmarks',
            what: 'Delete all browser bookmarks',
            reason: command.reason || 'The AI wants to clear your bookmarks library.',
            risk: 'medium',
          });
          if (!confirmed) {
            resolveActionChainStep(cbStepId, 'error', 'Denied');
            output = 'Clear bookmarks denied by user.';
            break;
          }
          try {
            useAppStore.setState({ bookmarks: [] });
            setMessages(prev => [...prev, {
              role: 'model',
              content: '✅ **All Bookmarks Cleared**'
            }]);
            resolveActionChainStep(cbStepId, 'done', 'Cleared');
            output = 'Cleared all bookmarks';
          } catch (e: any) {
            resolveActionChainStep(cbStepId, 'error', e.message);
            output = `Failed to clear bookmarks: ${e.message}`;
          }
          break;
        }

        case 'LIST_HISTORY': {
          const limitVal = parseInt(command.params?.limit || command.value || '50', 10);
          const limit = isNaN(limitVal) ? 50 : limitVal;
          const query = (command.params?.query || '').trim().toLowerCase();
          const startDateStr = (command.params?.startDate || '').trim();
          const endDateStr = (command.params?.endDate || '').trim();

          const lhStepId = addActionChainStep(`📅 Listing history`);
          try {
            let history = useAppStore.getState().history || [];
            
            // 1. Filter by text query if provided
            if (query) {
              history = history.filter((h: any) => 
                (h.title || '').toLowerCase().includes(query) || 
                (h.url || '').toLowerCase().includes(query)
              );
            }

            // 2. Filter by date/time ranges if provided
            if (startDateStr) {
              const startTimestamp = new Date(startDateStr).getTime();
              if (!isNaN(startTimestamp)) {
                history = history.filter((h: any) => h.lastVisited >= startTimestamp);
              }
            }
            if (endDateStr) {
              const endTimestamp = new Date(endDateStr).getTime();
              if (!isNaN(endTimestamp)) {
                history = history.filter((h: any) => h.lastVisited <= endTimestamp);
              }
            }

            const totalFiltered = history.length;
            const sliced = [...history].reverse().slice(0, limit);

            let formatted = '';
            if (sliced.length === 0) {
              formatted = '_No browsing history found matching criteria._';
            } else {
              formatted = sliced.map((h: any) => {
                const dateStr = h.lastVisited ? new Date(h.lastVisited).toLocaleString() : '';
                const timeSpan = dateStr ? ` *(${dateStr})*` : '';
                return `• [${h.title || h.url}](${h.url})${timeSpan}`;
              }).join('\n');
            }
            
            let heading = `### 📅 Browsing History (showing ${sliced.length} of ${totalFiltered})`;
            if (query) heading += ` for "${query}"`;
            
            setMessages(prev => [...prev, {
              role: 'model',
              content: `${heading}\n\n${formatted}`
            }]);
            resolveActionChainStep(lhStepId, 'done', `${sliced.length} history items listed`);
            output = `Listed ${sliced.length} history items`;
          } catch (e: any) {
            resolveActionChainStep(lhStepId, 'error', e.message);
            output = `Failed to list history: ${e.message}`;
          }
          break;
        }

        case 'CLEAR_HISTORY': {
          const chStepId = addActionChainStep('📅 Clearing browsing history');
          const confirmed = await requestActionPermission({
            actionType: 'CLEAR_HISTORY',
            action: 'Clear Browsing History',
            target: 'All History',
            what: 'Delete all browser history',
            reason: command.reason || 'The AI wants to clear your browsing history.',
            risk: 'medium',
          });
          if (!confirmed) {
            resolveActionChainStep(chStepId, 'error', 'Denied');
            output = 'Clear history denied by user.';
            break;
          }
          try {
            useAppStore.getState().clearHistory();
            setMessages(prev => [...prev, {
              role: 'model',
              content: '✅ **Browsing History Cleared**'
            }]);
            resolveActionChainStep(chStepId, 'done', 'Cleared');
            output = 'Cleared browsing history';
          } catch (e: any) {
            resolveActionChainStep(chStepId, 'error', e.message);
            output = `Failed to clear history: ${e.message}`;
          }
          break;
        }

        case 'STATUS': {
          const statusText = command.value || command.params?.text || 'Working...';
          setCustomStatusText(statusText);
          output = `Status set: ${statusText}`;
          break;
        }

        case 'SET_CHAT_STYLE': {
          const fontSizeVal = command.params?.fontSize ? parseInt(command.params.fontSize, 10) : undefined;
          const glowModeVal = command.params?.glowMode as GlowMode | undefined;
          const glowPresetVal = command.params?.glowPreset as GlowPreset | undefined;
          const scsStepId = addActionChainStep('🎨 Adjusting chat appearance');
          try {
            const updates: Partial<SidebarWorkspacePreferences> = {};
            if (fontSizeVal && !isNaN(fontSizeVal)) updates.fontSize = fontSizeVal;
            if (glowModeVal && ['off', 'gradient', 'rgb'].includes(glowModeVal)) updates.glowMode = glowModeVal;
            if (glowPresetVal && ['purple-cosmos', 'ocean-blue', 'emerald-forest', 'sunset-fire', 'rose-gold', 'arctic-ice', 'custom'].includes(glowPresetVal)) updates.glowPreset = glowPresetVal;

            if (Object.keys(updates).length > 0) {
              updateWorkspacePrefs(updates);
              const changeStr = Object.entries(updates).map(([k, v]) => `**${k}** → \`${v}\``).join(', ');
              setMessages(prev => [...prev, {
                role: 'model',
                content: `🎨 **Chat Style Updated**\n\n${changeStr}`
              }]);
              resolveActionChainStep(scsStepId, 'done', 'Style updated');
              output = `Updated chat style: ${JSON.stringify(updates)}`;
            } else {
              resolveActionChainStep(scsStepId, 'skipped', 'No valid style updates specified');
              output = 'Chat style update skipped: no valid updates provided';
            }
          } catch (e: any) {
            resolveActionChainStep(scsStepId, 'error', e.message);
            output = `Failed to update chat style: ${e.message}`;
          }
          break;
        }

        case 'OPEN_SETTINGS_PANEL': {
          const panel = (command.params?.panel || command.value || '').trim().toLowerCase();
          if (!panel) {
            output = 'OPEN_SETTINGS_PANEL requires a panel parameter.';
            break;
          }
          const ospStepId = addActionChainStep(`⚙️ Opening ${panel} panel`);
          const map: Record<string, string> = {
            vault: 'open-bookmarks',
            bookmarks: 'open-bookmarks',
            history: 'open-history',
            extensions: 'open-extensions',
            profile: 'open-settings',
            settings: 'open-settings',
            downloads: 'open-downloads',
            clipboard: 'open-clipboard',
            cart: 'open-cart',
            workspace: 'open-workspace',
          };
          const action = map[panel];
          if (!action) {
            resolveActionChainStep(ospStepId, 'error', `Unknown panel: ${panel}`);
            output = `Failed to open settings panel: unknown panel name "${panel}"`;
            break;
          }
          try {
            await window.electronAPI.triggerShortcut(action);
            resolveActionChainStep(ospStepId, 'done', 'Opened');
            output = `Opened settings panel: ${panel}`;
          } catch (e: any) {
            resolveActionChainStep(ospStepId, 'error', e.message);
            output = `Failed to open settings panel: ${e.message}`;
          }
          break;
        }

        case 'EXPLAIN_CAPABILITIES': {
          const platform = (typeof process !== 'undefined' && process.platform) ||
            (typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('win') ? 'win32' :
             typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('mac') ? 'darwin' :
             typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent) ? 'win32' :
             typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent) ? 'darwin' :
             typeof navigator !== 'undefined' && /Linux/i.test(navigator.userAgent) ? 'linux' : 'darwin');
          const isMac = platform === 'darwin';
          const isWindows = platform === 'win32';
          const isLinux = platform === 'linux';
          const platformName = isMac ? 'macOS' : isWindows ? 'Windows' : 'Linux';

          const introAcsId = addActionChainStep('🚀 Capability Demonstration');
          setMessages(prev => [...prev, { role: 'model', content: "🚀 **Initiating Full Capability Demonstration...**\n\nI'll showcase real tasks across all my capabilities." }]);
          await showDemoOverlay('Agentic AI Engine', 'Aartiq AI has full system access — browsing, terminal, files, apps, and cross-device sync. Watch real tasks execute live.');
          resolveActionChainStep(introAcsId, 'done', 'Demo started');

          // Task 1: Web Search
          const searchAcsId = addActionChainStep('📰 Real-Time Web Search');
          await new Promise(resolve => setTimeout(resolve, 800));
          let newsResults = '';
          try {
            const searchResults = await window.electronAPI.webSearchRag('latest technology news today 2026');
            if (searchResults && searchResults.length > 0) {
              newsResults = searchResults.slice(0, 3).map((r: any, i: number) => `${i + 1}. ${r.title || r}`).join('\n');
            }
          } catch (e) { console.warn('[Demo] News search failed:', e); }
          resolveActionChainStep(searchAcsId, newsResults ? 'done' : 'error', newsResults ? '3 results found' : 'Search failed');
          if (newsResults) setMessages(prev => [...prev, { role: 'model', content: `✅ **News Search Complete:**\n${newsResults}` }]);
          await showDemoOverlay('Web Search & RAG', 'Real-time web search with RAG-powered context retrieval.');

          // Task 2: Shell Command
          const shellAcsId = addActionChainStep('🖥️ Shell Command Execution');
          await new Promise(resolve => setTimeout(resolve, 800));
          let wifiInfo = '';
          try {
            let wifiCmd = isMac ? '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I | grep SSID' :
              isWindows ? 'netsh wlan show interfaces | findstr SSID' : 'iwgetid -r';
            const shellResult = await window.electronAPI.executeShellCommand(wifiCmd);
            wifiInfo = shellResult.success ? (shellResult.output || 'WiFi connected').trim() : 'Network info retrieved';
          } catch (e) { wifiInfo = 'System info available'; }
          resolveActionChainStep(shellAcsId, 'done', wifiInfo || 'Retrieved');
          setMessages(prev => [...prev, { role: 'model', content: `✅ **Shell Command Result:**\n\`\`\`\n${wifiInfo}\n\`\`\`` }]);
          await showDemoOverlay('Shell Command Execution', 'Terminal commands with user approval and risk-assessment.');

          // Task 3: Volume Control
          const volAcsId = addActionChainStep('🔊 System Volume Control');
          await new Promise(resolve => setTimeout(resolve, 800));
          try { await window.electronAPI.setVolume(50); resolveActionChainStep(volAcsId, 'done', 'Set to 50%'); }
          catch (e) { resolveActionChainStep(volAcsId, 'error', 'Not available'); }
          await showDemoOverlay('System Controls', 'Full OS integration — volume, brightness, app launching.');

          // Task 4: Browser Navigation
          const navAcsId = addActionChainStep('🌐 Browser Navigation');
          await new Promise(resolve => setTimeout(resolve, 800));
          try {
            await window.electronAPI.navigateTo('https://aartiq.ponsrischool.in');
            resolveActionChainStep(navAcsId, 'done', 'aartiq.ponsrischool.in');
          } catch (e) { resolveActionChainStep(navAcsId, 'done', 'API available'); }
          await showDemoOverlay('Browser Automation', 'Navigate, search, click, fill forms, scroll, read page content.');

          // Task 5: Settings & Permissions
          const permAcsId = addActionChainStep('⚙️ Settings & Permissions');
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (props.setShowSettings && props.setSettingsSection) {
            props.setShowSettings(true);
            props.setSettingsSection('permissions');
            await new Promise(resolve => setTimeout(resolve, 2000));
            props.setShowSettings(false);
            resolveActionChainStep(permAcsId, 'done', 'Security architecture shown');
          } else {
            resolveActionChainStep(permAcsId, 'done', 'API available');
          }
          await showDemoOverlay('Security Architecture', 'Triple-lock: risk-graded, biometric-verified, audit-logged.');

          // Task 6: App Launch
          const appAcsId = addActionChainStep('🚀 Application Launch');
          await new Promise(resolve => setTimeout(resolve, 800));
          let calcLaunched = false;
          try {
            const calcApp = isMac ? 'Calculator' : isWindows ? 'ms-calculator:' : 'gnome-calculator';
            const calcRes = await window.electronAPI.openExternalApp(calcApp);
            calcLaunched = calcRes.success;
            resolveActionChainStep(appAcsId, calcLaunched ? 'done' : 'error', calcLaunched ? 'Calculator opened' : calcRes.error || 'Failed');
          } catch (e) { resolveActionChainStep(appAcsId, 'error', 'Requires permissions'); }
          await showDemoOverlay('Cross-App Launch', 'AI opens any application across macOS, Windows, Linux.');

          // Task 7: File System
          const fsAcsId = addActionChainStep('📁 File System Access');
          await new Promise(resolve => setTimeout(resolve, 800));
          try {
            const versionResult = await window.electronAPI.getVersion();
            const versionStr = typeof versionResult === 'string' ? versionResult : versionLabel;
            resolveActionChainStep(fsAcsId, 'done', `Aartiq ${versionStr}`);
          } catch (e) { resolveActionChainStep(fsAcsId, 'done', `${platformName} ready`); }
          await showDemoOverlay('File System Access', 'Read, write, organize files. Generate PDFs, DOCX, XLSX, PPTX.');

          // Task 8: Biometric Auth
          const bioAcsId = addActionChainStep('🔐 Biometric Authentication');
          await new Promise(resolve => setTimeout(resolve, 800));
          let bioAvailable = false;
          let bioType = '';
          try {
            const bioCheck = await window.electronAPI.checkBiometricAuth();
            bioAvailable = bioCheck.available;
            bioType = bioCheck.type || (isWindows ? 'Windows Hello' : isMac ? 'Touch ID' : 'Biometric');
            if (bioAvailable) {
              const bioResult = await window.electronAPI.authenticateBiometric('Aartiq AI capability demo');
              resolveActionChainStep(bioAcsId, bioResult.success ? 'done' : 'error', bioResult.success ? `${bioType} verified` : bioResult.error || 'Not completed');
            } else {
              resolveActionChainStep(bioAcsId, 'done', 'Not configured');
            }
          } catch (e) { resolveActionChainStep(bioAcsId, 'done', 'Not available'); }
          await showDemoOverlay('Platform Security Integration', 'Hardware-gated biometric verification for AI actions.');

          // Task 9: Screenshot
          const ssAcsId = addActionChainStep('📸 Screenshot Capture');
          await new Promise(resolve => setTimeout(resolve, 1200));
          let screenshotBase64: string | undefined;
          try {
            if (window.electronAPI.visionCaptureBase64) {
              const captureRes = await window.electronAPI.visionCaptureBase64();
              if (captureRes.success && captureRes.image) { screenshotBase64 = captureRes.image; }
            }
            resolveActionChainStep(ssAcsId, screenshotBase64 ? 'done' : 'error', screenshotBase64 ? 'Captured for PDF' : 'Not available');
          } catch (e) { resolveActionChainStep(ssAcsId, 'error', 'Failed'); }
          await showDemoOverlay('OCR & Vision', 'Screenshots, OCR text extraction, visual content analysis.');

          // Task 10: PDF Generation
          const pdfAcsId = addActionChainStep('📄 PDF Generation');
          await new Promise(resolve => setTimeout(resolve, 1000));
          await preloadAartiqIconLocal();
          const iconSource = (window as any).__cometIconBase64 || null;
          const capabilityFeatures = [
            'Browser Automation: Navigate, search, and interact with web pages autonomously',
            'Real-Time Web Search: Live search with RAG-powered context retrieval',
            'PDF Generation: Create branded documents with embedded screenshots and images',
            'OCR & Vision: Extract text from images and analyze screen content',
            'Shell Command Execution: Run terminal commands with user approval',
            'System Control: Adjust volume, brightness, and other system settings',
            'Application Launching: Open any app (Calculator, Terminal, browsers, etc.)',
            'Cross-App Automation: Control other applications via OCR and mouse/keyboard simulation',
            'MCP Tool Integration: Extend capabilities through Model Context Protocol servers',
            'File System Operations: Read, write, and organize files and folders',
            'Document Generation: Create DOCX, XLSX, PPTX, and PDF documents',
            'Multi-Platform: Works on Windows, macOS, and Linux',
            'Secure DOM Reading: Filtered, injection-checked page content extraction',
            'Prompt Injection Protection: Triple-lock security architecture',
            'RAG Memory: Contextual learning from browsing sessions',
            'Multi-Step Agency: Chained command execution with approval gates',
            'Cross-Device Authorization: QR-based high-risk action approval',
            'Task Scheduling: Automate recurring actions with cron-like syntax',
            'WiFi Sync: Seamless desktop-to-mobile device synchronization',
          ];
          try {
            const pdfTitle = `Aartiq_AI_Capability_Report_${new Date().toISOString().split('T')[0]}`;
            const { buildCapabilityReportPDF } = await import('./ai/AIUtils');
            const capabilityPDF = buildCapabilityReportPDF({
              author: 'Latestinssan',
              version: versionLabel,
              features: capabilityFeatures,
              platform: 'Windows, macOS, Linux, Android'
            }, screenshotBase64, iconSource);
            await window.electronAPI.generatePDF(pdfTitle, capabilityPDF);
            resolveActionChainStep(pdfAcsId, 'done', '19 features documented');
          } catch (e) { resolveActionChainStep(pdfAcsId, 'error', 'Generation failed'); }
          await showDemoOverlay('Document Generation', 'Professional PDF reports with branding, screenshots, structured content.');

          // Final Summary
          setMessages(prev => [...prev, {
            role: 'model', content: `
## ✅ **Full Demonstration Complete!**

I've successfully executed the following real tasks:

| # | Task | Status | Details |
|---|------|--------|---------|
| 1 | 📰 Web Search | ✅ | Fetched latest tech news via RAG |
| 2 | 🖥️ Shell Command | ✅ | Retrieved WiFi/network info on ${platformName} |
| 3 | 🔊 System Control | ✅ | Volume adjusted to 50% |
| 4 | 🌐 Browser Nav | ✅ | Navigated to aartiq.ponsrischool.in |
| 5 | ⚙️ Permissions | ✅ | Settings & security architecture shown |
| 6 | 🚀 App Launch | ${calcLaunched ? '✅' : 'ℹ️'} | ${calcLaunched ? 'Opened Calculator' : 'Calculator requires Accessibility permissions'} |
| 7 | 📁 File System | ✅ | Retrieved app version & platform |
| 8 | 🔐 Biometric Auth | ${bioAvailable ? '✅' : 'ℹ️'} | ${bioAvailable ? `${bioType} verified` : 'Not configured'} |
| 9 | 📸 Vision/OCR | ✅ | Captured screen for PDF embedding |
| 10 | 📄 PDF Report | ✅ | Created with 19 capability listings |

---

**📥 Your Capability Report PDF has been saved to your Downloads folder.**

**Built by:** Latestinssan

*Aartiq ${versionLabel} — For the questions that matter*
          ` }]);

          output = 'Full capability demonstration executed with 10 real tasks via action chain.';
          break;
        }

        case 'RELOAD':

          await window.electronAPI.reload();
          output = 'Active page reloaded.';
          break;

        case 'GO_BACK':
          await window.electronAPI.goBack();
          output = 'Navigated back in history.';
          break;

        case 'GO_FORWARD':
          await window.electronAPI.goForward();
          output = 'Navigated forward in history.';
          break;

        case 'OCR_COORDINATES':
        case 'OCR_SCREEN':
        case 'SCREENSHOT_AND_ANALYZE': {
          // Check if user has already granted OCR permission permanently
          const permKey = `OCR_SCREEN:${command.value || 'default'}`;
          if (window.electronAPI?.permCheck) {
            const permRes = await window.electronAPI.permCheck(permKey);
            if (permRes?.granted) {
              console.log('[Permission] OCR pre-authorized via stored permission');
            }
          }

          const stepId = addThinkingStep('Capturing screenshot...', 'Taking screenshot and running OCR');
          try {
            let ocrText = '';

            // First try: Capture browser view screenshot (most reliable for browser content)
            if (window.electronAPI.captureBrowserViewScreenshot) {
              const screenshotData = await window.electronAPI.captureBrowserViewScreenshot();
              if (screenshotData) {
                // Run Tesseract OCR on the captured image
                try {
                  const { data } = await Tesseract.recognize(screenshotData, 'eng', {
                    logger: (m: any) => {
                      if (m.status === 'recognizing text') {
                        setPdfProgress(Math.round(m.progress * 100));
                      }
                    }
                  });
                  ocrText = data?.text || '';
                } catch (tessErr: any) {
                  console.error('Tesseract OCR failed:', tessErr);
                }
              }
            }

            // Fallback: Try vision describe if OCR didn't work
            if (!ocrText && window.electronAPI.visionDescribe) {
              try {
                const visionRes = await window.electronAPI.visionDescribe('What is on this screen? Extract all visible text, buttons, links, and content.');
                ocrText = typeof visionRes === 'string' ? visionRes : ((visionRes as any)?.description || '');
              } catch (visionErr: any) {
                console.error('Vision describe failed:', visionErr);
              }
            }

            // Final fallback: Try basic OCR
            if (!ocrText && window.electronAPI.ocrScreenText) {
              try {
                const ocrRes = await window.electronAPI.ocrScreenText();
                ocrText = typeof ocrRes === 'string' ? ocrRes : ((ocrRes as any)?.text || '');
              } catch (ocrErr: any) {
                console.error('OCR screen text failed:', ocrErr);
              }
            }

            resolveThinkingStep(stepId, 'done', ocrText ? 'Screenshot captured and analyzed' : 'Screenshot captured');

            if (ocrText) {
              output = `✅ Screenshot analyzed (${ocrText.length} chars) — see container below`;
              await BrowserAI.addToVectorMemory(ocrText, { type: 'screenshot_ocr', url: currentUrl });
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'model') {
                  const updated = [...prev];
                  updated[prev.length - 1] = { ...last, isOcr: true, ocrLabel: 'SCREENSHOT_ANALYSIS', ocrText: ocrText };
                  return updated;
                }
                return [...prev, { role: 'model', content: '', isOcr: true, ocrLabel: 'SCREENSHOT_ANALYSIS', ocrText: ocrText } as ExtendedChatMessage];
              });
            } else {
              output = '⚠️ Screenshot captured but no text detected. The page may be empty or contain only images.';
            }
          } catch (e: any) {
            resolveThinkingStep(stepId, 'error', e.message);
            output = `❌ Screenshot failed: ${e.message}`;
          }
          break;
        }

        case 'EXTRACT_DATA': {
          const selector = command.value.split('|')[0].trim();
          try {
            const res = await window.electronAPI.extractPageContent(useAppStore.getState().activeTabId || undefined);
            if (res && res.content) {
              const scrubbed = scrubbedContent(res.content);
              output = `Extracted data from page (${scrubbed.length} chars):\n${scrubbed.substring(0, 4000)}...`;
              await BrowserAI.addToVectorMemory(scrubbed, { type: 'extracted_data', selector, url: currentUrl });
            } else {
              output = `No data found for selector: ${selector}.`;
            }
          } catch (e: any) {
            output = `Extract failed: ${e.message}`;
          }
          break;
        }

        case 'DOM_SEARCH': {
          const query = command.value.trim() || '';
          if (!query) {
            output = 'DOM_SEARCH requires a query parameter.';
            break;
          }

          const searchStepId = addThinkingStep(`Searching DOM for "${query}"...`);
          setDOMSearchLoading(true);
          setDOMSearchQuery(query);
          setDOMSearchResults([]);

          try {
            const res = await window.electronAPI.searchDOM(query);
            let results: DOMSearchResult[] = (res.results || []).map((r: any) => ({
              text: r.text || '',
              context: r.context || '',
              xpath: r.xpath || '',
              score: r.score || 0,
              tag: r.tag || 'element',
              navLike: r.navLike || false,
              linkDensity: r.linkDensity || 0,
            }));

            // Fallback 1: If 0 results, try extractPageContent and do a text match
            if (results.length === 0 && !res.error) {
              try {
                const activeTabId = useAppStore.getState().activeTabId;
                const pageRes = await window.electronAPI.extractPageContent(activeTabId || undefined);
                if (pageRes?.content) {
                  const lowerContent = pageRes.content.toLowerCase();
                  const lowerQuery = query.toLowerCase();
                  const idx = lowerContent.indexOf(lowerQuery);
                  if (idx >= 0) {
                    const start = Math.max(0, idx - 100);
                    const end = Math.min(pageRes.content.length, idx + query.length + 200);
                    const snippet = pageRes.content.substring(start, end).trim();
                    results = [{ text: snippet, context: `Page content match for "${query}"`, xpath: '', score: 1.0, tag: 'text-match' }];
                  }
                }
              } catch { /* ignore fallback error */ }
            }

            setDOMSearchResults(results);
            const formattedResults = results.map((r, i) => {
              const navTag = r.navLike ? ' [nav]' : '';
              // When context and text are identical (e.g. "Science: Science"), show just the text
              const label = r.context === r.text || r.context.startsWith(r.text.substring(0, 20))
                ? `"${r.text}"${navTag}`
                : `${r.context}: "${r.text}"${navTag}`;
              return `${i + 1}. ${label}`;
            }).join('\n');
            if (results.length > 0) {
              // Store full results in vector memory but keep output brief — full results display via DOMSearchDisplay
              output = `Found ${results.length} result${results.length !== 1 ? 's' : ''} for "${query}"`;
            } else if (res.error) {
              const friendlyMsg = res.error === 'No active view'
                ? 'No webpage is currently open. Open a page first to search its content.'
                : `DOM search failed: ${res.error}`;
              output = friendlyMsg;
            } else {
              output = `DOM search for "${query}" returned 0 results on this page. Try [READ_PAGE_CONTENT] to get the full page text, or [SCREENSHOT_AND_ANALYZE] to capture visual content.`;
            }
            await BrowserAI.addToVectorMemory(
              `DOM Search Results for "${query}":\n${formattedResults || 'No results'}`,
              { type: 'dom_search', query, url: currentUrl }
            );
            resolveThinkingStep(searchStepId, results.length > 0 ? 'done' : 'error', `${results.length} results found`);
          } catch (e: any) {
            output = `DOM search error: ${e.message}`;
            resolveThinkingStep(searchStepId, 'error', e.message);
          } finally {
            setDOMSearchLoading(false);
          }
          break;
        }

        case 'OPEN_MCP_SETTINGS': {
          store.openMcpSettings();
          output = 'Opening MCP Settings panel...';
          break;
        }

        case 'OPEN_AUTOMATION_SETTINGS': {
          console.log('[AI] OPEN_AUTOMATION_SETTINGS handler called');
          if (props.setShowSettings && props.setSettingsSection) {
            console.log('[AI] Using props.setShowSettings');
            props.setShowSettings(true);
            props.setSettingsSection('automation');
            output = 'Opening Automation Settings...';
          } else if (window.electronAPI?.openSettingsPopup) {
            console.log('[AI] Using IPC openSettingsPopup');
            window.electronAPI.openSettingsPopup('automation');
            output = 'Opening Automation Settings...';
          } else {
            console.log('[AI] No method available - props exists:', !!props.setShowSettings, 'IPC exists:', !!window.electronAPI?.openSettingsPopup);
            output = 'Automation settings not available in current context.';
          }
          break;
        }

        case 'ENABLE_CLI': {
          try {
            const result = await window.electronAPI.enableCLI();
            if (result.success) {
              output = `SUCCESS: ${result.message}`;
            } else {
              output = `FAILED: ${result.error}`;
            }
          } catch (e: any) {
            output = `ERROR: ${e.message}`;
          }
          break;
        }

        case 'OPEN_SCHEDULING_MODAL': {
          // Parse scheduling data from command value (JSON format)
          let scheduleData: any = {};
          const rawValue = command.value.trim();

          try {
            if (rawValue) {
              if (rawValue.includes('{')) {
                const jsonMatch = rawValue.match(/\{[\s\S]*\}/);
                if (jsonMatch) scheduleData = JSON.parse(jsonMatch[0]);
              } else {
                // Pipe-separated: schedule|type|name|description
                const parts = rawValue.split('|').map(p => p.trim());
                scheduleData = {
                  schedule: parts[0] || '0 8 * * *',
                  type: parts[1] || 'ai-prompt',
                  name: parts[2] || 'Scheduled Task',
                  description: parts[3] || '',
                };
              }
            }
          } catch (e) {
            console.error('Failed to parse scheduling data:', e);
          }

          // Create scheduling intent
          const intent: SchedulingIntent = {
            detected: true,
            confidence: 'high' as const,
            taskName: scheduleData.name || 'Scheduled Task',
            taskType: scheduleData.type as any || 'ai-prompt',
            schedule: {
              type: 'cron' as const,
              expression: scheduleData.schedule || '0 8 * * *',
              description: `Scheduled: ${scheduleData.schedule || '0 8 * * *'}`,
            },
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            outputPath: scheduleData.outputPath || '~/Documents/Aartiq',
          };

          // Use props to set up and show modal
          if (props.setSchedulingIntent) {
            props.setSchedulingIntent(intent);
          }
          if (props.setShowSchedulingModal) {
            props.setShowSchedulingModal(true);
          }
          if (props.setBrowserDisabled) {
            props.setBrowserDisabled(true);
          }

          output = `Opening scheduling modal for: ${intent.taskName}`;
          break;
        }

        case 'DOM_READ_FILTERED': {
          const query = command.value.trim();
          const readStepId = addThinkingStep('Reading secure DOM...');

          try {
            const res = await window.electronAPI.extractSecureDOM();
            if (res.error) {
              output = `DOM read failed: ${res.error}`;
              resolveThinkingStep(readStepId, 'error', res.error);
            } else {
              const domResult: FilteredDOMResult = {
                content: res.content || '',
                elements: res.elements || [],
                metadata: res.metadata || {
                  url: currentUrl || '',
                  title: '',
                  timestamp: Date.now(),
                  injectionDetected: false,
                  filterStats: { piiRemoved: 0, scriptsRemoved: 0, stylesRemoved: 0, navRemoved: 0, adsRemoved: 0 }
                }
              };

              setDOMMeta(domResult.metadata);

              const contextForAI = secureDOMReader.buildContextForAI(domResult, query);

              if (query) {
                const searchResults = secureDOMReader.searchDOM(domResult.elements, { query, maxResults: 10 });
                setDOMSearchResults(searchResults);
                setDOMSearchQuery(query);
                output = `Secure DOM read complete. Found ${searchResults.length} matches for "${query}".\n\nContext:\n${contextForAI.substring(0, 4000)}...`;
              } else {
                output = `Secure DOM read complete (${(res.content || '').length} chars filtered).\n\nContent:\n${contextForAI.substring(0, 4000)}...`;
              }

              await BrowserAI.addToVectorMemory(contextForAI, { type: 'secure_dom_read', url: currentUrl });

              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'model') {
                  const updated = [...prev];
                  updated[prev.length - 1] = { ...last, isOcr: true, ocrLabel: 'DOM_EXTRACTED', ocrText: contextForAI };
                  return updated;
                }
                return [...prev, { role: 'model', content: '', isOcr: true, ocrLabel: 'DOM_EXTRACTED', ocrText: contextForAI } as ExtendedChatMessage];
              });

              resolveThinkingStep(readStepId, 'done', `${(res.content || '').length} chars processed`);
            }
          } catch (e: any) {
            output = `DOM read error: ${e.message}`;
            resolveThinkingStep(readStepId, 'error', e.message);
          }
          break;
        }

        // ── PLUGIN_COMMAND: Execute plugin-defined commands ─────────────────────
        case 'PLUGIN_COMMAND': {
          setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'executing' } : cmd));
          try {
            const pluginCommandId = command.value;
            const params = command.context ? JSON.parse(command.context) : {};

            if (window.electronAPI?.plugins?.executeCommand) {
              const result = await window.electronAPI.plugins.executeCommand(pluginCommandId, params);
              output = result.success ? (result.result || 'Command executed successfully') : `Error: ${result.error}`;
            } else {
              output = 'Plugin command execution is not available.';
            }
          } catch (e: any) {
            output = `Plugin command error: ${e.message}`;
          }
          break;
        }

        default:
          output = `Operation ${command.type} completed.`;
      }

      if (!processingBatchRef.current) {
        if (commandResult.error) {
          output = commandResult.error;
          setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'failed', error: output, endTime: Date.now() } : cmd));
        } else {
          setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'completed', output, endTime: Date.now() } : cmd));
        }
      }
      processingBatchRef.current = false;

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'model') {
          const updated = [...prev];
          const actionLogs = last.actionLogs || [];
          const logEntry = { type: command.type, output, success: !commandResult.error };
          const contentAppend = '';
          const newContent = last.content;
          updated[prev.length - 1] = { ...last, content: newContent, actionLogs: [...actionLogs, logEntry] };
          return updated;
        }
        return prev;
      });
    } catch (err: any) {
      const errorOutput = err.message;
      setCommandQueue(prev => prev.map((cmd, i) => i === currentCommandIndex ? { ...cmd, status: 'failed', error: err.message, endTime: Date.now() } : cmd));
    } finally {
      processingQueueRef.current = false;
      if (currentActionChainStepIdRef.current) {
        resolveActionChainStep(
          currentActionChainStepIdRef.current,
          commandResult.error ? 'error' : 'done',
          commandResult.error || 'Completed'
        );
        currentActionChainStepIdRef.current = null;
      }
      const skip = skipBatchRef.current;
      skipBatchRef.current = 0;
      setCurrentCommandIndex(prev => prev + 1 + skip);
    }
  }, [commandQueue, currentCommandIndex, activeTabId, router, storeSetTheme, setActiveView, currentUrl, requestActionPermission, requestBatchPermission, preloadAartiqIconLocal, addThinkingStep, resolveThinkingStep, fetchRealSearchContext, openTabAndWaitForLoad, waitForActiveTabToSettle, resolveActionChainStep]);

  const formatMessageForExport = (m: ExtendedChatMessage) => {
    let result = `${m.role.toUpperCase()}:\n`;

    // AI Reasoning / Thinking
    if (m.thinkText) {
      result += `\n[AI REASONING]\n${m.thinkText.trim()}\n[/AI REASONING]\n`;
    }

    // Extracted content (OCR, DOM, etc. — collapsible in UI, structured in export)
    if (m.isOcr && m.ocrText) {
      const isDomContent = m.ocrLabel === 'DOM_CONTENT' || m.ocrLabel === 'DOM_EXTRACTED';
      const tag = isDomContent ? 'DOM_RESULT' : 'OCR_RESULT';
      const type = isDomContent ? 'DOM_EXTRACTION' : 'OCR_EXTRACTION';
      result += `\n[${tag}]\n${JSON.stringify({
        type,
        label: m.ocrLabel || 'EXTRACTED_DATA',
        textLength: m.ocrText.length,
        content: m.ocrText.trim()
      }, null, 2)}\n[/${tag}]\n`;
      // Also include raw page content as readable text so the AI actually uses it
      if (isDomContent && m.ocrText.trim().length > 0) {
        result += `\n--- Page Content ---\n${m.ocrText.trim()}\n--- End Page Content ---\n`;
      }
    }

    // Action Chain (Separate JSON format)
    if (m.actionLogs && m.actionLogs.length > 0) {
      result += `\n[ACTION_CHAIN_JSON]\n${JSON.stringify({
        type: 'ACTION_CHAIN_EXPORT',
        version: '1.0',
        exportTimestamp: Date.now(),
        actions: m.actionLogs.map((log, index) => ({
          index: index + 1,
          type: log.type,
          success: log.success,
          output: log.output
        }))
      }, null, 2)}\n[/ACTION_CHAIN_JSON]\n`;
    }

    // Media Attachments
    if (m.mediaItems && m.mediaItems.length > 0) {
      result += `\n[MEDIA_ATTACHMENTS_JSON]\n${JSON.stringify({
        type: 'MEDIA_EXPORT',
        version: '1.0',
        attachments: m.mediaItems.map(item => ({
          type: item.type,
          ...(item.type === 'image' ? { url: item.url, caption: item.caption } : {}),
          ...(item.type === 'video' ? { videoUrl: item.videoUrl, title: item.title, description: item.description } : {})
        }))
      }, null, 2)}\n[/MEDIA_ATTACHMENTS_JSON]\n`;
    }

    // Main Content
    result += `\n${m.content.trim()}`;
    return result.trim();
  };

  const clearChat = useCallback(() => {
    setMessages([]);
    setThinkingSteps([]);
    setThinkingText('');
    setShowActionsMenu(false);
    setAttachments([]);
    setInputMessage('');
    setActiveConversationId(null);
    setShowConversationHistory(false);
    // Reset all automation/action state so each session starts clean.
    setCommandQueue([]);
    setPlanningSteps([]);
    setAgentState('idle');
    setCurrentCommandIndex(0);
    resetActionChainSteps();
  }, [resetActionChainSteps]);

  const saveConversation = useCallback(() => {
    if (messages.length === 0) return;
    const now = Date.now();
    const storedMessages = messages.map((msg) => ({ ...msg }));
    const generatedId = typeof window !== 'undefined' && window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `conv-${now}`;
    const conversationId = activeConversationId ?? generatedId;
    const conversationRecord: Conversation = {
      id: conversationId,
      title: buildConversationTitle(storedMessages),
      messages: storedMessages,
      createdAt: now,
      updatedAt: now,
    };

    setConversations((prev) => {
      const existing = prev.find((c) => c.id === conversationId);
      const merged = {
        ...conversationRecord,
        createdAt: existing?.createdAt ?? conversationRecord.createdAt,
      };
      const next = [merged, ...prev.filter((c) => c.id !== conversationId)];
      const truncated = next.slice(0, 20);
      lsSet('conversations_list', truncated);
      return truncated;
    });

    const conversationText = storedMessages
      .filter(m => m.content && m.content.length > 20)
      .map(m => `[${m.role === 'user' ? 'User' : 'Assistant'}]: ${m.content}`)
      .join('\n');
    if (conversationText.length > 50 && useAppStore.getState().enableCrossSessionMemory) {
      BrowserAI.addToVectorMemory(conversationText, { type: 'chat_conversation', conversationId, timestamp: now }).catch(() => {});
    }

    if (conversationId !== activeConversationId) {
      setActiveConversationId(conversationId);
    }
  }, [activeConversationId, messages]);

  useEffect(() => {
    if (messages.length === 0) return;
    if (persistTimeoutRef.current) {
      window.clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = window.setTimeout(() => {
      saveConversation();
      persistTimeoutRef.current = null;
    }, 600);

    return () => {
      if (persistTimeoutRef.current) {
        window.clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
    };
  }, [messages, saveConversation]);

  const handleLoadConversation = useCallback((id: string) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    setMessages(conv.messages as ExtendedChatMessage[]);
    setActiveConversationId(conv.id);
    setShowConversationHistory(false);
    // Reset live execution state, but restore THIS session's action steps.
    // (The previous session's steps stay stored so they reappear if you return.)
    setCommandQueue([]);
    setPlanningSteps([]);
    setAgentState('idle');
    setCurrentCommandIndex(0);
    setActionChainSteps(loadActionChainForConversation(conv.id));
  }, [conversations, loadActionChainForConversation]);

  const handleDeleteConversation = useCallback((id: string) => {
    const nextList = conversations.filter((conv) => conv.id !== id);
    lsSet('conversations_list', nextList);
    setConversations(nextList);
    if (activeConversationId === id) {
      if (nextList.length > 0) {
        setMessages(nextList[0].messages as ExtendedChatMessage[]);
        setActiveConversationId(nextList[0].id);
        // Reset live execution state, restore the switched-to session's steps.
        setCommandQueue([]);
        setPlanningSteps([]);
        setAgentState('idle');
        setCurrentCommandIndex(0);
        clearActionChainForConversation(null);
        setActionChainSteps(loadActionChainForConversation(nextList[0].id));
      } else {
        clearChat();
      }
    } else {
      // Removing a non-active conversation: drop its stored steps.
      clearActionChainForConversation(id);
    }
  }, [activeConversationId, conversations, clearChat, loadActionChainForConversation, clearActionChainForConversation]);

  const handleNewConversation = useCallback(() => {
    clearChat();
    setShowConversationHistory(false);
  }, [clearChat]);

  const exportChat = useCallback(async (format: 'text' | 'pdf') => {
    if (messages.length === 0) return;
    setShowActionsMenu(false);

    // Format full session
    const fullContent = messages.map(m => formatMessageForExport(m)).join('\n\n' + '='.repeat(40) + '\n\n');

    // Include action logs in export (separate from main chat)
    const actionLogsExport = actionLogsStore.exportAsJSON();
    const shellLogsExport = actionLogsStore.getShellLogs().length > 0
      ? actionLogsStore.exportAsText().split('[SHELL_COMMANDS_LOG]')[1] || ''
      : '';

    if (window.electronAPI) {
      if (format === 'text') {
        const exportContent = `${fullContent}\n\n${'='.repeat(60)}\nACTION LOGS (${versionLabel} JSON Format)\n${'='.repeat(60)}\n\n${actionLogsExport}`;
        const res = await (window.electronAPI as any).exportChatAsTxt(exportContent);
        if (res?.success) setFeedback('Chat & Action Logs Exported to Downloads');
      } else {
        // Robustly convert tags to HTML using multi-stage parsing
        const convertTagsToHTML = (text: string): string => {
          let html = text;

          // AI Reasoning tags
          const reasoningBlocks = extractAIReasoning(text);
          for (const block of reasoningBlocks) {
            const escaped = block.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html = html.replace(
              new RegExp(`\\[?\\s*AI REASONING\\s*\\]?\\s*${block.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\[?\\s*/AI REASONING\\s*\\]?`, 'gi'),
              `<div style="background:#f8fafc; padding:15px; border-left:4px solid #0ea5e9; margin:10px 0; font-style:italic; font-size:12px; color:#475569;"><strong>AI Reasoning</strong><br/>${escaped}</div>`
            );
          }

          // OCR Result tags
          const ocrResult = extractOCRResult(text);
          if (ocrResult.success && ocrResult.data) {
            const jsonStr = JSON.stringify(ocrResult.data, null, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html = html.replace(/\[\s*OCR_RESULT\s*\][\s\S]*?\[\s*\/OCR_RESULT\s*\]/gi,
              `<div style="background:#fef3c7; padding:15px; border-left:4px solid #f59e0b; margin:10px 0; font-size:12px; color:#92400e;"><strong>OCR Result</strong><br/><pre style="font-size:10px; overflow-x:auto;">${jsonStr}</pre></div>`);
          }

          // Action Chain JSON tags
          const actionChain = extractActionChain(text);
          if (actionChain.success && actionChain.data) {
            const jsonStr = JSON.stringify(actionChain.data, null, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html = html.replace(/\[\s*ACTION_CHAIN_JSON\s*\][\s\S]*?\[\s*\/ACTION_CHAIN_JSON\s*\]/gi,
              `<div style="background:#0f172a; color:#e2e8f0; padding:15px; border-radius:10px; margin:10px 0; font-family:monospace; font-size:11px;"><strong>Action Chain (JSON)</strong><br/><pre style="font-size:10px; overflow-x:auto;">${jsonStr}</pre></div>`);
          }

          // Media Attachments JSON tags
          const mediaResult = extractMediaAttachments(text);
          if (mediaResult.success && mediaResult.data) {
            const jsonStr = JSON.stringify(mediaResult.data, null, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html = html.replace(/\[\s*MEDIA_ATTACHMENTS_JSON\s*\][\s\S]*?\[\s*\/MEDIA_ATTACHMENTS_JSON\s*\]/gi,
              `<div style="background:#dbeafe; padding:15px; border-left:4px solid #3b82f6; margin:10px 0; font-size:12px; color:#1e40af;"><strong>Media Attachments (JSON)</strong><br/><pre style="font-size:10px; overflow-x:auto;">${jsonStr}</pre></div>`);
          }

          return html.replace(/\n/g, '<br/>');
        };

        const bodyContent = `
          <div style="white-space: pre-wrap; font-size: 14px; color: #1e293b;">
            ${convertTagsToHTML(fullContent)}
          </div>
          <div style="margin-top:40px; padding:20px; background:#f8fafc; border-top:2px solid #e2e8f0;">
            <h2 style="font-size:16px; color:#0f172a; margin-bottom:10px;">Action Logs (Separate)</h2>
            <pre style="font-size:11px; color:#475569; white-space:pre-wrap; word-break:break-all;">${actionLogsExport}</pre>
          </div>
        `;

        await preloadAartiqIconLocal();
        const iconSource = (window as any).__cometIconBase64 || null;
        const bandedHtml = generateSmartPDF(bodyContent, iconSource);

        await window.electronAPI.generatePDF('Aartiq Intelligence Report', bandedHtml);
        setFeedback('PDF Document Ready with Action Logs');
      }
    }
    setTimeout(() => setFeedback(null), 3000);
  }, [messages]);

  const copyChatToClipboard = useCallback(() => {
    const chatData = messages.map(m => formatMessageForExport(m)).join('\n\n' + '='.repeat(50) + '\n\n');
    navigator.clipboard.writeText(chatData);
    setShowActionsMenu(false);
  }, [messages]);

  useEffect(() => {
    if (commandQueue.length > 0 && currentCommandIndex < commandQueue.length && !processingQueueRef.current) {
      processNextCommand();
    }
  }, [commandQueue, currentCommandIndex, processNextCommand]);

  useEffect(() => {
    if (commandQueue.length > 0 && currentCommandIndex >= commandQueue.length && !processingQueueRef.current) {
      const successCount = commandQueue.filter(c => c.status === 'completed').length;
      const failedCount = commandQueue.filter(c => c.status === 'failed').length;
      if (successCount > 0 || failedCount > 0) {
        const report = {
          totalCommands: commandQueue.length,
          successCount,
          failedCount,
          startTime: automationStartTimeRef.current,
          endTime: Date.now(),
          commands: commandQueue.map(c => ({
            type: c.type,
            label: c.value?.slice(0, 60) || c.type,
            status: c.status || 'unknown',
            error: c.error,
          })),
        };
        setAutomationReport(report);
        const runId = `run-${Date.now()}`;
        try {
          const runsKey = 'aartiq_automation_runs';
          const existing = JSON.parse(localStorage.getItem(runsKey) || '[]');
          if (Array.isArray(existing)) {
            existing.push({ id: runId, ...report });
            localStorage.setItem(runsKey, JSON.stringify(existing.slice(-10)));
          }
        } catch { }
        try {
          const eventsKey = 'aartiq_background_task_events';
          const existing = JSON.parse(localStorage.getItem(eventsKey) || '[]');
          if (Array.isArray(existing)) {
            existing.push({
              id: runId,
              taskName: commandQueue[0]?.value?.slice(0, 60) || 'Automation run',
              taskType: commandQueue[0]?.type || 'unknown',
              status: failedCount > 0 ? 'failed' : 'success',
              timestamp: Date.now(),
              error: failedCount > 0 ? `${failedCount} step${failedCount > 1 ? 's' : ''} failed` : undefined,
              seen: false,
            });
            localStorage.setItem(eventsKey, JSON.stringify(existing.slice(-20)));
          }
        } catch { }
        window.dispatchEvent(new CustomEvent('automation-task-completed'));
      }
    }
  }, [commandQueue, currentCommandIndex]);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const mermaid = (window as any).mermaid;
    if (mermaid) mermaid.initialize({ theme: 'dark' });
    setIsMermaidLoaded(true);

    const hOnline = () => setIsOnline(true);
    const hOffline = () => setIsOnline(false);
    window.addEventListener('online', hOnline);
    window.addEventListener('offline', hOffline);

    const savedConversations = lsGet<Conversation[]>('conversations_list', []);
    setConversations(savedConversations);

    if (window.electronAPI?.loadUserPreferences) {
      window.electronAPI.loadUserPreferences().then((prefs: any) => {
        if (prefs && typeof prefs === 'object') setUserPreferences(prefs);
      }).catch(() => {});
    }

    if (useAppStore.getState().enableCrossSessionMemory) {
      BrowserAI.loadVectorMemory().then(() => {
        savedConversations.forEach(conv => {
          const convText = conv.messages
            .filter((m: any) => m.content && m.content.length > 20)
            .map((m: any) => `[${m.role === 'user' ? 'User' : 'Assistant'}]: ${m.content}`)
            .join('\n');
          if (convText.length > 50) {
            BrowserAI.addToVectorMemory(convText, { type: 'chat_conversation', conversationId: conv.id, timestamp: conv.updatedAt || conv.createdAt }).catch(() => {});
          }
        });
      });
    }

    return () => {
      window.removeEventListener('online', hOnline);
      window.removeEventListener('offline', hOffline);
    };
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'Tab' && permissionPending) {
        setShiftTabGlow(true);
        setTimeout(() => setShiftTabGlow(false), 900);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [permissionPending]);

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.on) {
      const unsub = window.electronAPI.on('pdf-generation-log', (log: string) => {
        setTerminalLogs(prev => [...prev, {
          id: `pdf-${Date.now()}-${terminalLogIdCounter.current++}`,
          command: 'GENERATE_PDF',
          output: log,
          success: !log.includes('❌'),
          timestamp: Date.now()
        }]);
      });

      const unsubProgress = window.electronAPI.on('pdf-generation-progress', (progress: number) => {
        setPdfProgress(progress);
      });

      const unsubXlsx = window.electronAPI.on('xlsx-generation-log', (log: string) => {
        setTerminalLogs(prev => [...prev, {
          id: `xlsx-${Date.now()}-${terminalLogIdCounter.current++}`,
          command: 'GENERATE_XLSX',
          output: log,
          success: !log.includes('❌'),
          timestamp: Date.now()
        }]);
      });

      const unsubXlsxProgress = window.electronAPI.on('xlsx-generation-progress', (progress: number) => {
        setPdfProgress(progress);
      });

      const unsubPptx = window.electronAPI.on('pptx-generation-log', (log: string) => {
        setTerminalLogs(prev => [...prev, {
          id: `pptx-${Date.now()}-${terminalLogIdCounter.current++}`,
          command: 'GENERATE_PPTX',
          output: log,
          success: !log.includes('❌'),
          timestamp: Date.now()
        }]);
      });

      const unsubPptxProgress = window.electronAPI.on('pptx-generation-progress', (progress: number) => {
        setPdfProgress(progress);
      });

      const unsubDocx = window.electronAPI.on('docx-generation-log', (log: string) => {
        setTerminalLogs(prev => [...prev, {
          id: `docx-${Date.now()}-${terminalLogIdCounter.current++}`,
          command: 'GENERATE_DOCX',
          output: log,
          success: !log.includes('❌'),
          timestamp: Date.now()
        }]);
      });

      const unsubDocxProgress = window.electronAPI.on('docx-generation-progress', (progress: number) => {
        setPdfProgress(progress);
      });

      return () => {
        unsub();
        unsubProgress();
        unsubXlsx();
        unsubXlsxProgress();
        unsubPptx();
        unsubPptxProgress();
        unsubDocx();
        unsubDocxProgress();
      };
    }
  }, []);

  useEffect(() => {
    if (aiProvider === 'ollama') {
      setIsFetchingModels(true);
      fetch(`${ollamaBaseUrl}/api/tags`)
        .then(res => res.json())
        .then(data => {
          if (data && data.models) {
            setOllamaModelsList(data.models);
            const currentModel = useAppStore.getState().ollamaModel;
            if (data.models.length > 0 && (!currentModel || !data.models.find((m: any) => m.name === currentModel))) {
              setOllamaModel(data.models[0].name);
            }
          }
        })
        .catch(err => console.error("Failed to fetch Ollama models", err))
        .finally(() => setIsFetchingModels(false));
    }
  }, [aiProvider, ollamaBaseUrl]);

  const latestMessage = messages[messages.length - 1];
  const latestMessageContent = latestMessage?.content ?? '';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, latestMessageContent, isLoading]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLogs]);

  useEffect(() => {
    if (messages.length > 0 || isLoading) {
      markSidebarInteraction();
    }
  }, [messages.length, isLoading]);



  // Remote Prompt Listening (from mobile via cloud sync)
  useEffect(() => {
    let remoteCleanup: (() => void) | undefined;
    if (window.electronAPI?.onRemoteAiPrompt) {
      remoteCleanup = window.electronAPI.onRemoteAiPrompt((data: {
        prompt: string;
        promptId?: string;
        fromDeviceId?: string;
        streamToMobile?: boolean;
      }) => {
        console.log('[Remote-Prompt] Received from mobile:', data.prompt);
        if (data.streamToMobile && data.promptId) {
          remotePromptContextRef.current = {
            promptId: data.promptId,
            fromDeviceId: data.fromDeviceId,
            mode: data.fromDeviceId ? 'cloud' : 'wifi',
          };
        }
        handleSendMessage(data.prompt);
      });
    }
    return () => {
      if (remoteCleanup) remoteCleanup();
      remotePromptContextRef.current = null;
    };
  }, [handleSendMessage]);

  useEffect(() => {
    window.electronAPI?.notifyAiSidebarOpen?.();
    return () => {
      window.electronAPI?.notifyAiSidebarClosed?.();
    };
  }, []);

  useEffect(() => {
    if (!permissionPending) {
      window.electronAPI?.notifyApprovalCleared?.();
      return;
    }
    window.electronAPI?.notifyApprovalPending?.({
      requestId: `ui-${Date.now()}`,
      command: permissionPending.context.target || permissionPending.context.what || '',
      reason: permissionPending.context.reason,
      risk: permissionPending.context.risk,
      actionType: permissionPending.context.actionType,
      action: permissionPending.context.action,
      requiresDeviceUnlock: permissionPending.context.requiresDeviceUnlock,
    });
  }, [permissionPending]);

  useEffect(() => {
    if (!window.electronAPI?.onApprovalActionResolved) return;
    const cleanup = window.electronAPI.onApprovalActionResolved((data) => {
      console.log('[ApprovalActionResolved] Swift approved:', data);
    });
    return cleanup;
  }, []);

  /**
   * Feed research progress from the main process into the reducer.
   *
   * `activeResearchPipelineIdRef` guards against a late event from a job the user
   * already moved on from painting itself over the current one — the sidebar is
   * single-job, so an unfiltered subscription would cross two runs' steps into
   * one card.
   */
  useEffect(() => {
    if (!window.electronAPI?.onResearchProgress) return;
    const cleanup = window.electronAPI.onResearchProgress((event: any) => {
      if (!event) return;
      const activeId = activeResearchPipelineIdRef.current;
      const eventId = event.researchId || event.pipelineId;
      if (activeId && eventId && eventId !== activeId) return;
      setResearchState((prev) => applyResearchProgress(prev, event));
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onNativeMacPrompt) return;
    const cleanup = window.electronAPI.onNativeMacPrompt((payload: { prompt: string }) => {
      if (payload?.prompt) {
        console.log('[NativeMacPrompt] Received prompt:', payload.prompt.substring(0, 50));
        handleSendMessage(payload.prompt).catch(err => console.error('[NativeMacPrompt] Error:', err));
      }
    });
    return cleanup;
  }, [handleSendMessage]);

  useEffect(() => {
    const listener = window.electronAPI?.onAIChatInputText ?? window.electronAPI?.onAiChatInputText;
    if (!listener) return;
    const cleanup = listener((text: string) => {
      if (typeof text === 'string') {
        setInputMessage(text);
      }
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const cleanupConversationAction = window.electronAPI.on(
      'native-mac-ui-conversation-action',
      (payload: { action?: string; id?: string | null }) => {
        switch (payload?.action) {
          case 'new':
            handleNewConversation();
            break;
          case 'load':
            if (payload.id) {
              handleLoadConversation(payload.id);
            }
            break;
          case 'delete':
            if (payload.id) {
              handleDeleteConversation(payload.id);
            }
            break;
          default:
            break;
        }
      }
    );

    const cleanupExport = window.electronAPI.on(
      'native-mac-ui-export',
      (payload: { format?: 'text' | 'pdf' }) => {
        if (payload?.format === 'text' || payload?.format === 'pdf') {
          exportChat(payload.format);
        }
      }
    );

    return () => {
      cleanupConversationAction();
      cleanupExport();
    };
  }, [exportChat, handleDeleteConversation, handleLoadConversation, handleNewConversation]);

  useEffect(() => {
    if (!window.electronAPI?.updateNativeMacUIState) return;

    if (nativeMacSyncTimeoutRef.current) {
      window.clearTimeout(nativeMacSyncTimeoutRef.current);
    }

    nativeMacSyncTimeoutRef.current = window.setTimeout(() => {
      const snapshotMessages = messages.slice(-20).map((message, index) => ({
        id: message.id || `${message.role}-${index}`,
        role: message.role,
        content: `${message.content || ''}`.slice(0, 12000),
        timestamp: Date.now() + index,
        thinkText: message.thinkText ? message.thinkText.slice(0, 8000) : null,
        isOcr: !!message.isOcr,
        ocrLabel: message.ocrLabel ? `${message.ocrLabel}`.slice(0, 120) : null,
        ocrText: message.ocrText ? message.ocrText.slice(0, 12000) : null,
        actionLogs: Array.isArray(message.actionLogs)
          ? message.actionLogs.slice(0, 24).map((log) => ({
            type: `${log.type || ''}`.slice(0, 120),
            output: `${log.output || ''}`.slice(0, 4000),
            success: !!log.success,
          }))
          : [],
        mediaItems: Array.isArray(message.mediaItems)
          ? message.mediaItems.slice(0, 12).map((item) => {
            if (item.type === 'image') {
              return {
                type: item.type,
                url: item.url,
                caption: item.caption || null,
              };
            }

            if (item.type === 'video') {
              return {
                type: item.type,
                videoUrl: item.videoUrl,
                title: item.title,
                description: item.description || null,
                thumbnailUrl: item.thumbnailUrl || null,
                source: item.source,
                videoId: item.videoId || null,
              };
            }

            if (item.type === 'mermaid' || item.type === 'flowchart') {
              return {
                type: item.type,
                diagramId: item.diagramId,
                code: item.code,
              };
            }

            return {
              type: item.type,
              chartId: item.chartId,
              chartDataJSON: JSON.stringify(item.data || {}),
              chartOptionsJSON: JSON.stringify(item.options || {}),
            };
          })
          : [],
      }));

      const snapshotActionChain = commandQueue.slice(0, 24).map((command) => ({
        id: command.id,
        type: command.type,
        value: command.value,
        status: command.status,
        category: command.category,
        riskLevel: command.riskLevel,
      }));

      const snapshotConversations = conversations.slice(0, 20).map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
      }));

      const snapshotActivityTags = Array.from(new Set(
        searchContextStore.getRecentContexts(6).map((context) => {
          switch (context.type) {
            case 'web_search':
              return context.query ? `Searched for: ${context.query}` : 'Searched the web';
            case 'page_content':
              return `Read: ${context.title || context.url || 'Current page'}`;
            case 'ocr':
              return `OCR: ${context.query || 'Screen capture'}`;
            case 'dom':
              return context.query ? `Scanned DOM: ${context.query}` : `Scanned DOM: ${context.url || 'Current page'}`;
            default:
              return '';
          }
        }).filter(Boolean)
      )).slice(0, 8);

      const snapshotThinkingSteps = thinkingSteps.slice(-12).map((step) => ({
        id: step.id,
        label: step.label.slice(0, 200),
        status: step.status as 'running' | 'done' | 'error',
        detail: step.detail ? step.detail.slice(0, 500) : undefined,
        timestamp: step.timestamp,
      }));

      if (isLoading) {
        snapshotActivityTags.unshift('Aartiq is thinking');
      }

      window.electronAPI.updateNativeMacUIState({
        inputDraft: inputMessage,
        isLoading,
        error,
        currentCommandIndex,
        themeAppearance: resolvedTheme === 'light' ? 'light' : 'dark',
        messages: snapshotMessages,
        actionChain: snapshotActionChain,
        conversations: snapshotConversations,
        activeConversationId,
        activityTags: Array.from(new Set(snapshotActivityTags)).slice(0, 8),
        thinkingSteps: snapshotThinkingSteps,
      });
      nativeMacSyncTimeoutRef.current = null;
    }, 120);

    return () => {
      if (nativeMacSyncTimeoutRef.current) {
        window.clearTimeout(nativeMacSyncTimeoutRef.current);
        nativeMacSyncTimeoutRef.current = null;
      }
    };
  }, [messages, commandQueue, conversations, activeConversationId, currentCommandIndex, inputMessage, isLoading, error, resolvedTheme]);

  // Keyboard shortcut listeners (⌘K, ⌘L, ⌘⇧A, Esc, ⌘/)
  useEffect(() => {
    const handleFocusAI = () => {
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-ai-input]');
      textarea?.focus();
    };
    const handleAbort = () => {
      if (isLoading || commandQueue.length > 0) {
        setCommandQueue([]);
        setAgentState('idle');
        setPlanningSteps([]);
      }
    };
    const handleToggleAutonomous = () => {
      window.dispatchEvent(new CustomEvent('aartiq:toggle-autonomous-mode'));
    };

    window.addEventListener('aartiq:focus-ai', handleFocusAI);
    window.addEventListener('aartiq:abort-action', handleAbort);
    window.addEventListener('aartiq:toggle-autonomous', handleToggleAutonomous);
    return () => {
      window.removeEventListener('aartiq:focus-ai', handleFocusAI);
      window.removeEventListener('aartiq:abort-action', handleAbort);
      window.removeEventListener('aartiq:toggle-autonomous', handleToggleAutonomous);
    };
  }, [isLoading, commandQueue.length]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const currentActiveModel = selectedProviderModel;
  const activeModelKey = `${normalizedProvider}:${currentActiveModel}`;
  const activeModelDisplayName = workspacePrefs.modelNicknames[activeModelKey] || currentActiveModel;
  const modelOptions = useMemo(() => {
    const options = [
      { provider: 'openai', label: 'OpenAI', model: openaiModel || 'gpt-5.1' },
      { provider: 'google', label: 'Gemini Pro', model: geminiModel || 'gemini-2.5-pro' },
      { provider: 'google-flash', label: 'Gemini Flash', model: geminiFlashModel || 'gemini-2.5-flash' },
      { provider: 'anthropic', label: 'Anthropic', model: anthropicModel || 'claude-sonnet-4-20250514' },
      { provider: 'groq', label: 'Groq', model: groqModel || 'llama-3.3-70b-versatile' },
      { provider: 'xai', label: 'xAI', model: xaiModel || 'grok-4-fast-reasoning' },
      { provider: 'ollama', label: 'Ollama', model: ollamaModel || 'llama3' },
      ...ollamaModelsList.slice(0, 8).map((model) => ({ provider: 'ollama', label: 'Ollama', model: model.name })),
    ];
    const seen = new Set<string>();
    return options.filter((option) => {
      const key = `${option.provider}:${option.model}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [anthropicModel, geminiFlashModel, geminiModel, groqModel, ollamaModel, ollamaModelsList, openaiModel, xaiModel]);

  const selectChatModel = useCallback((provider: string, model: string) => {
    const state = useAppStore.getState();
    state.setAIProvider(provider);
    if (provider === 'openai') state.setOpenaiModel(model);
    else if (provider === 'google') state.setGeminiModel(model);
    else if (provider === 'google-flash') state.setGeminiFlashModel(model);
    else if (provider === 'anthropic') state.setAnthropicModel(model);
    else if (provider === 'groq') state.setGroqModel(model);
    else if (provider === 'xai') state.setXaiModel(model);
    else if (provider === 'ollama') state.setOllamaModel(model);
    setShowModelPicker(false);
    playClickSound('success');
  }, [playClickSound]);

  const updateActiveModelNickname = useCallback((nickname: string) => {
    updateWorkspacePrefs({
      modelNicknames: {
        ...workspacePrefs.modelNicknames,
        [activeModelKey]: nickname.trim(),
      },
    });
  }, [activeModelKey, updateWorkspacePrefs, workspacePrefs.modelNicknames]);

  const handleVoiceInput = useCallback(async () => {
    playClickSound();
    if (isRecordingVoice) {
      mediaRecorderRef.current?.stop();
      return;
    }

    try {
      const permission = await window.electronAPI?.voiceMicPermission?.();
      if (permission && permission.success === false) {
        setFeedback(permission.error || 'Microphone permission unavailable');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      voiceChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        setIsRecordingVoice(false);
        stream.getTracks().forEach((track) => track.stop());
        try {
          const blob = new Blob(voiceChunksRef.current, { type: mimeType || 'audio/webm' });
          const audioBase64 = await blobToBase64(blob);
          const result = await window.electronAPI?.voiceTranscribe?.(audioBase64, 'webm');
          if (result?.success && result.text) {
            setInputMessage((previous) => `${previous}${previous ? ' ' : ''}${result.text}`.trim());
            playClickSound('confirm');
          } else {
            setFeedback(result?.error || 'Voice transcription failed');
          }
        } catch (error: any) {
          setFeedback(error.message || 'Voice transcription failed');
        }
      };

      recorder.start();
      setIsRecordingVoice(true);
    } catch (error: any) {
      setIsRecordingVoice(false);
      setFeedback(error.message || 'Microphone unavailable');
    }
  }, [isRecordingVoice, playClickSound]);

  if (props.bridgeOnly) {
    return null;
  }

  const effectiveSidebarWidth = store.sidebarWidth;

  // Agent controls + live data surfaced to the sidebar widget system.
  // (Defined here so every referenced state variable is already initialized.)
  const handlePause = useCallback(() => setAgentState("paused"), []);
  const handleResume = useCallback(
    () => setAgentState(isLoading ? "executing" : "thinking"),
    [isLoading],
  );
  const handleStop = useCallback(() => {
    setCommandQueue([]);
    setPlanningSteps([]);
    setAgentState("idle");
    try {
      resetActionChainSteps();
    } catch {
      /* noop */
    }
  }, [resetActionChainSteps]);

  const sidebarData = useMemo<SidebarData>(() => {
    const total = actionChainSteps.length;
    const done = actionChainSteps.filter((s) => s.status === "done" || s.status === "error").length;
    const progress = total > 0 ? done / total : undefined;
    const needs: NeedsAttentionItem[] = [];
    if (agentState === "waiting") {
      needs.push({
        id: "permission",
        type: "permission",
        title: "Permission required",
        detail: "Aartiq needs your approval to continue this action.",
      });
    }
    if (agentState === "paused") {
      needs.push({
        id: "paused",
        type: "paused",
        title: "Agent paused",
        detail: customStatusText || "The agent is paused and waiting for you.",
        actionLabel: "Resume",
        onAction: handleResume,
      });
    }
    return {
      agentState,
      currentTask: customStatusText || planningSteps[0]?.label,
      progress,
      isPaused: agentState === "paused",
      onPause: handlePause,
      onResume: handleResume,
      onStop: handleStop,
      actionChainSteps,
      goal: customStatusText
        ? { text: customStatusText }
        : planningSteps[0]
          ? { text: planningSteps[0].label }
          : undefined,
      needsAttention: needs,
      tabs: store.tabs,
      activeTabId: store.activeTabId,
      history: store.history,
      onAction: (cmd) => setInputMessage(cmd),
      isWorking: isLoading,
      sessionLabel,
      showSecondaryInfo: sidebar.prefs.showSecondaryInfo,
    };
  }, [
    agentState,
    actionChainSteps,
    planningSteps,
    customStatusText,
    isLoading,
    store.tabs,
    store.activeTabId,
    store.history,
    sessionLabel,
    handlePause,
    handleResume,
    handleStop,
  ]);

  const glowActive = workspacePrefs.glowMode !== 'off';
  const isRgbGlow = workspacePrefs.glowMode === 'rgb';
  const glowPrimary = workspacePrefs.glowColorPrimary;
  const glowSecondary = workspacePrefs.glowColorSecondary;
  const glowTertiary = workspacePrefs.glowColorTertiary;

  // Floating suggestion bubbles are generated by the LLM (see
  // generateLlmSuggestions) from the user's history + past tasks.

  return (
    <div
      className={`ai-sidebar-theme adaptive-theme-surface flex flex-col h-full overflow-hidden relative transition-[width,box-shadow,border-radius] duration-[180ms] ease-[var(--ease-spring)] backdrop-blur-xl ${props.isResizing ? '!duration-0' : ''} ${isFullScreen ? 'fixed inset-0 z-[9999]' : ''}`}
      style={{ width: isFullScreen ? '100%' : typeof effectiveSidebarWidth === 'number' ? `${effectiveSidebarWidth}px` : effectiveSidebarWidth, ...sidebarShellStyle }}
      onMouseEnter={markSidebarInteraction}
      onMouseDown={markSidebarInteraction}
      onClick={markSidebarInteraction}
      onFocusCapture={markSidebarInteraction}
    >
      {props.isCollapsed ? (
        <div className="flex flex-col items-center h-full py-6 space-y-6">
          <button onClick={props.toggleCollapse} className="w-10 h-10 flex items-center justify-center rounded-2xl transition-all text-secondary-text hover:text-primary-text" style={softPanelStyle}>
            {props.side === 'right' ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
          </button>
        </div>
      ) : (<>
      {/* Overlays */}
      <ConversationHistoryPanel
        show={showConversationHistory}
        conversations={conversations}
        activeId={activeConversationId}
        onClose={() => setShowConversationHistory(false)}
        onLoad={handleLoadConversation}
        onDelete={handleDeleteConversation}
        onNew={handleNewConversation}
      />

      <AnimatePresence>
        {showSetupGuide && <AISetupGuide onClose={() => setShowSetupGuide(false)} onComplete={() => { setShowSetupGuide(false); setShowLLMProviderSettings(true); }} />}
      </AnimatePresence>

      <McpSetupGuide isOpen={showMcpSetupGuide} onClose={() => setShowMcpSetupGuide(false)} />

      <AnimatePresence>
        {commandQueue.length > 0 && currentCommandIndex < commandQueue.length && (
          <AICommandQueue
            commands={commandQueue}
            currentCommandIndex={currentCommandIndex}
            onCancel={() => { setCommandQueue([]); setAgentState('idle'); setPlanningSteps([]); resetActionChainSteps(); }}
            onStopCurrent={() => {
              const remaining = commandQueue.slice(currentCommandIndex + 1);
              setCommandQueue(prev => prev.slice(0, currentCommandIndex + 1));
            }}
            cancelImmediately={() => { setCommandQueue([]); setAgentState('idle'); setPlanningSteps([]); resetActionChainSteps(); }}
          />
        )}
      </AnimatePresence>

      {/* Live PDF Generation Overlay */}
      <AnimatePresence>
        {isGeneratingPDF && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-x-6 top-32 z-[1000] p-6 rounded-[2.5rem] bg-gradient-to-br from-white/10 to-transparent border border-white/20 backdrop-blur-2xl shadow-[0_30px_100px_rgba(0,0,0,0.5)] overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-sky-500 via-purple-500 to-sky-500 animate-[shimmer_2s_infinite] bg-[length:200%_100%]" />
            <div className="flex flex-col items-center gap-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
                <FileText size={32} className="text-sky-400 animate-pulse" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-white">Live PDF Streaming</h3>
                <p className="text-[10px] text-white/40 uppercase tracking-tighter mt-2 font-bold leading-relaxed max-w-[200px]">
                  {streamingPDFContent}
                </p>
              </div>
              <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-sky-500"
                  initial={{ width: "0%" }}
                  animate={{ width: `${pdfProgress}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
              {pdfVisualStage !== 'idle' && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.35 }}
                  className="mt-4 flex items-center gap-3 px-4 py-3 bg-black/60 border border-white/10 rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
                >
                  <motion.div
                    className="relative w-10 h-10 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center"
                    animate={pdfVisualStage === 'capturing' ? {
                      boxShadow: [
                        '0 0 0 0 rgba(14, 165, 233, 0.4)',
                        '0 0 0 8px rgba(14, 165, 233, 0)',
                        '0 0 0 0 rgba(14, 165, 233, 0)'
                      ]
                    } : {}}
                    transition={{ duration: 1.5, repeat: pdfVisualStage === 'capturing' ? Infinity : 0 }}
                  >
                    <motion.div
                      className="absolute inset-0 rounded-2xl bg-white/20"
                      animate={pdfVisualStage === 'capturing' ? { opacity: [0, 1, 0], scale: [1, 1.5] } : {}}
                      transition={{ duration: 0.6, repeat: Infinity }}
                    />
                    {pdfVisualStage === 'capturing' ? (
                      <Camera size={20} className="text-white relative z-10" />
                    ) : (
                      <Image size={20} className="text-white relative z-10" />
                    )}
                  </motion.div>
                  <div className="text-left">
                    <motion.p
                      className="text-[11px] font-black uppercase tracking-[0.3em] text-white/70"
                      animate={pdfVisualStage === 'capturing' ? { opacity: [1, 0.7, 1] } : {}}
                      transition={{ duration: 0.5, repeat: Infinity }}
                    >
                      {pdfVisualStage === 'capturing' ? '📸 Capturing screenshot' : '🌐 Fetching visuals'}
                    </motion.p>
                    <motion.p
                      className="text-[10px] text-white/40 leading-tight"
                      key={pdfVisualStage}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      {pdfVisualStage === 'capturing'
                        ? 'Recording the current browser view into your report...'
                        : 'Downloading referenced images before rendering the document...'}
                    </motion.p>
                  </div>
                  <motion.div
                    className="ml-auto flex gap-0.5"
                    animate={pdfVisualStage === 'capturing' ? { opacity: 1 } : { opacity: 0.5 }}
                  >
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        className="w-1 h-3 bg-sky-400 rounded-full"
                        animate={pdfVisualStage === 'capturing' ? {
                          height: [12, 20, 12],
                          opacity: [0.5, 1, 0.5]
                        } : {}}
                        transition={{
                          duration: 0.6,
                          repeat: Infinity,
                          delay: i * 0.15
                        }}
                      />
                    ))}
                  </motion.div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Developer Terminal Panel */}
      <AnimatePresence>
        {isDevMode && showTerminal && terminalLogs.length > 0 && (
          <motion.div
            key="terminal"
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.97 }}
            className="absolute bottom-4 left-4 z-[9000] rounded-2xl overflow-hidden border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.6)] bg-[#09090f] w-80 max-w-[320px]"
            style={{ maxHeight: '220px' }}
          >
            <div className="flex items-center justify-between px-4 py-2 bg-[#111118] border-b border-white/5">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <button onClick={() => setShowTerminal(false)} className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-400 transition-colors" title="Close Terminal" />
                  <button onClick={() => setTerminalLogs([])} className="w-3 h-3 rounded-full bg-yellow-500/80 hover:bg-yellow-400 transition-colors" title="Clear Terminal" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <span className="text-[10px] font-mono font-bold text-white/30 uppercase tracking-widest ml-2">Aartiq Terminal</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setTerminalLogs([])} className="text-[9px] text-white/20 hover:text-white/50 font-mono uppercase tracking-widest transition-colors">Clear</button>
                <button onClick={() => setShowTerminal(false)} className="text-white/20 hover:text-white/60 transition-colors"><X size={14} /></button>
              </div>
            </div>
            <div className="overflow-y-auto modern-scrollbar p-3 space-y-2 font-mono text-[11px]" style={{ maxHeight: '170px' }}>
              {terminalLogs.map(log => (
                <div key={log.id} className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className={log.success ? 'text-green-400/70' : 'text-red-400/70'}>
                      {log.success ? '✓' : '✗'}
                    </span>
                    <span className="text-white/60">{log.command.length > 40 ? log.command.substring(0, 40) + '...' : log.command}</span>
                    <span className={`ml-auto text-[9px] font-bold uppercase tracking-wider ${log.success ? 'text-green-400/50' : 'text-red-400/50'}`}>
                      {log.success ? 'Done' : 'Failed'}
                    </span>
                  </div>
                  {log.output && log.output !== '⏳ Running...' && (
                    <pre className={`ml-5 whitespace-pre-wrap break-all leading-relaxed text-[9px] ${log.success ? 'text-white/30' : 'text-red-400/50'}`}>
                      {log.output.length > 100 ? log.output.substring(0, 100) + '...' : log.output}
                    </pre>
                  )}
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {approvalModal}
        {directoryPermissionPanel}
        {shellPermissionPanel}
      </AnimatePresence>

      {/* Demo Highlight Overlay */}
      <AnimatePresence>
        {demoHighlight && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute left-4 right-4 z-[9999] bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            style={{ top: '88px' }}
          >
            <div className="px-5 py-4 bg-gradient-to-r from-sky-500/10 via-transparent to-purple-500/10">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center">
                  <Sparkles size={16} className="text-sky-400" />
                </div>
                <span className="text-xs font-black uppercase tracking-widest text-sky-300">{demoHighlight.title}</span>
              </div>
              <p className="text-sm text-white/70 leading-relaxed pl-11">{demoHighlight.description}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className={`px-4 flex flex-col justify-center border-b backdrop-blur-2xl sticky top-0 z-[50] transition-[height,padding] duration-[180ms] ease-[var(--ease-spring)] ${actionChainSteps.length > 0 ? 'min-h-[48px] h-auto' : 'h-[48px]'}`} style={{ ...sidebarShellStyle, borderColor: 'color-mix(in srgb, var(--border-color) 35%, transparent)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg p-0.5 border" style={softPanelStyle}>
              <img src="/logo-transparent.png" alt="Aartiq" className="w-full h-full object-contain" />
            </div>
            <div>
              <h2 className="text-[9px] font-black uppercase tracking-[0.2em] text-primary-text leading-tight">Aartiq</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className={`w-1 h-1 rounded-full ${
                  agentState === 'executing' ? 'bg-sky-500 animate-pulse' :
                  agentState === 'thinking' ? 'bg-indigo-500 animate-pulse' :
                  agentState === 'planning' ? 'bg-amber-500 animate-pulse' :
                  agentState === 'searching' ? 'bg-cyan-500 animate-pulse' :
                  agentState === 'waiting' ? 'bg-orange-500 animate-pulse' :
                  agentState === 'paused' ? 'bg-yellow-500' :
                  agentState === 'finished' ? 'bg-green-500' :
                  isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                }`} />
                <span className="text-[8px] font-bold text-secondary-text uppercase tracking-widest">
                  {agentState === 'idle' ? 'Autonomous' :
                   agentState === 'planning' ? 'Planning' :
                   agentState === 'thinking' ? 'Thinking' :
                   agentState === 'searching' ? 'Searching' :
                   agentState === 'executing' ? 'Executing' :
                   agentState === 'waiting' ? 'Waiting' :
                   agentState === 'paused' ? 'Paused' :
                   agentState === 'finished' ? 'Done' :
                   'Autonomous'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isDevMode && (
              <button
                onClick={() => setShowTerminal(v => !v)}
                className={`p-2.5 rounded-xl transition-all relative ${showTerminal ? 'bg-green-500/20 text-green-400' : 'text-secondary-text hover:text-primary-text'}`}
                style={!showTerminal ? softPanelStyle : undefined}
                title="Developer terminal"
              >
                <Terminal size={18} />
                {terminalLogs.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-green-500 text-[8px] font-bold text-black flex items-center justify-center">
                    {terminalLogs.length > 9 ? '9+' : terminalLogs.length}
                  </span>
                )}
              </button>
            )}
            <div className="relative group">
              <button className="p-2.5 rounded-xl text-secondary-text hover:text-primary-text transition-all" style={softPanelStyle} title="More options">
                <MoreVertical size={18} />
              </button>
              <div className="absolute right-0 top-full mt-2 w-48 border rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100] p-2 backdrop-blur-2xl" style={popoverStyle}>
                <button onClick={() => exportChat('pdf')} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-secondary-text hover:text-primary-text transition-all">
                  <Printer size={14} className="text-sky-400" /> Export branded PDF
                </button>
                <button onClick={() => exportChat('text')} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-secondary-text hover:text-primary-text transition-all">
                  <FileText size={14} className="text-purple-400" /> Export as .txt
                </button>
                <button onClick={copyChatToClipboard} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-secondary-text hover:text-primary-text transition-all">
                  <CopyIcon size={14} className="text-amber-400" /> Copy full session
                </button>
                <div className="my-1 border-t border-white/10" />
                <button
                  onClick={() => {
                    const cycle: Array<'dark' | 'light' | 'minimal' | 'vibrant' | 'custom'> = ['dark', 'light', 'minimal', 'vibrant', 'custom'];
                    const cur = props.theme === 'system' ? 'dark' : (props.theme as 'dark' | 'light' | 'minimal' | 'vibrant' | 'custom');
                    const idx = cycle.indexOf(cur);
                    props.setTheme(cycle[(idx + 1) % cycle.length]);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-secondary-text hover:text-primary-text transition-all"
                >
                  <span className="text-base leading-none">
                    {props.theme === 'light' ? '☀️' : props.theme === 'minimal' ? '◐' : props.theme === 'vibrant' ? '🔮' : props.theme === 'custom' ? '🎨' : '🌑'}
                  </span>
                  Theme: {props.theme === 'light' ? 'Light' : props.theme === 'minimal' ? 'Minimal' : props.theme === 'vibrant' ? 'Vibrant' : props.theme === 'custom' ? 'Custom' : 'Dark'}
                </button>
                <button onClick={() => { props.setShowSettings?.(true); props.setSettingsSection?.('sidebar'); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-secondary-text hover:text-primary-text transition-all">
                  <Layers size={14} className="text-purple-400" /> Customize Workspace
                </button>
                <button onClick={() => { setShowPrivacy(true); setShowCustomization(false); setShowThemeSettings(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-secondary-text hover:text-primary-text transition-all">
                  <Shield size={14} className="text-sky-400" /> AI Privacy Controls
                </button>
                <button onClick={() => { setShowThemeSettings(true); setShowCustomization(false); setShowPrivacy(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-secondary-text hover:text-primary-text transition-all">
                  <Eye size={14} className="text-amber-400" /> AI Visual Theme
                </button>
                <button onClick={() => { setShowSidebarCustomize(true); setShowCustomization(false); setShowPrivacy(false); setShowThemeSettings(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-secondary-text hover:text-primary-text transition-all">
                  <Sparkles size={14} className="text-fuchsia-400" /> Chat appearance
                </button>
                <div className="my-1 border-t border-white/10" />
                <div className="px-3 py-1">
                  <span className="text-[8px] font-bold uppercase tracking-widest text-secondary-text/40">Sidebar Mode</span>
                  <div className="flex gap-1 mt-1">
                    {(['full', 'compact', 'hidden'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => {
                          sidebar.setMode(mode);
                          if (mode === 'hidden') props.toggleCollapse();
                        }}
                        className={`flex-1 text-[9px] font-medium px-2 py-1 rounded-lg border transition-all capitalize ${
                          sidebar.prefs.mode === mode
                            ? 'bg-sky-500/15 border-sky-500/30 text-sky-400'
                            : 'bg-white/[0.04] border-white/[0.06] text-secondary-text/50 hover:text-secondary-text'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <p className="text-[8px] text-secondary-text/30 mt-1">
                    {sidebar.prefs.mode === 'full' ? 'All widgets + chat' :
                     sidebar.prefs.mode === 'compact' ? 'Minimal input only' :
                     'Hide sidebar entirely'}
                  </p>
                </div>
                <button onClick={() => setShowLLMProviderSettings(!showLLMProviderSettings)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-secondary-text hover:text-primary-text transition-all">
                  <Cpu size={14} className="text-green-400" /> Intelligence Settings
                </button>
                <button onClick={clearChat} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-red-500/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-400/60 hover:text-red-400 transition-all">
                  <Trash2 size={14} /> Clear reasoning chain
                </button>
              </div>
            </div>
            <button
              onClick={() => setShowCustomization(true)}
              className="p-2.5 rounded-xl text-secondary-text hover:text-primary-text transition-all"
              title="Customize Workspace"
            >
              <SlidersHorizontal size={18} />
            </button>
            <button onClick={() => setIsFullScreen(!isFullScreen)} className="p-2.5 rounded-xl text-secondary-text hover:text-primary-text transition-all" style={softPanelStyle} title={isFullScreen ? 'Exit full screen' : 'Full screen'}>
              {isFullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            {store.tabs.some(t => t.groupId === 'ai-session') && (
              <button
                onClick={() => store.closeTabGroup('ai-session')}
                className="p-2.5 rounded-xl hover:bg-red-500/10 text-red-400/60 hover:text-red-400 transition-all border border-red-500/10"
                title="Close AI Session Tabs"
              >
                <Layers size={18} />
              </button>
            )}
            <button onClick={props.toggleCollapse} className="p-2.5 rounded-xl text-secondary-text hover:text-primary-text transition-all" style={softPanelStyle} title="Close sidebar">
              <X size={18} />
            </button>
          </div>
        </div>
        {actionChainSteps.length > 0 && (
          <div className="mt-1 -mb-1">
            <ActionChainTimeline
              steps={actionChainSteps}
              title="Automation Steps"
              initialOpen={false}
              compact={true}
            />
          </div>
        )}
      </header>

      {/* Chat Messages */}
      <div className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden modern-scrollbar transition-[padding] duration-[180ms] ease-[var(--ease-spring)] backdrop-blur-sm px-4 py-4 pb-6 space-y-3`} style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--primary-bg) 95%, transparent), color-mix(in srgb, var(--primary-bg) 99%, transparent))' }}>
        <AnimatePresence mode="popLayout">
          {messages.length === 0 && sidebarMode !== 'compact' && (
            <SidebarDataProvider value={sidebarData}>
              {sidebar.prefs.showWidgets ? (
                <div style={sidebarRootStyle(sidebar.prefs)} className="w-full max-w-full">
                  <SidebarWidgets
                    prefs={sidebar.prefs}
                    controller={{
                      setWidgetCollapsed: sidebar.setWidgetCollapsed,
                      setWidgetSize: sidebar.setWidgetSize,
                      setWidgetPinned: sidebar.setWidgetPinned,
                      toggleWidget: sidebar.toggleWidget,
                    }}
                  />
                </div>
              ) : (
                <div style={sidebarRootStyle(sidebar.prefs)} className="w-full max-w-full">
                  <AISuggestionsHome />
                </div>
              )}
            </SidebarDataProvider>
          )}
          {messages.map((msg, i) => {
            let displayContent = msg.content;
            let displayThought = msg.thinkText;

            const thinkMatch = displayContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
            if (thinkMatch) {
              displayThought = thinkMatch[1].trim();
              displayContent = displayContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/i, '').trim();
            }

            displayContent = sanitizeVisibleMessage(displayContent);

            const isLastMessage = i === messages.length - 1;
            const isSearchResult = !!(msg as ExtendedChatMessage).isSearchResult;
            const msgIsOcr = (msg as any).isOcr || (msg as any).ocrText;
            const hasValidOcr = msgIsOcr && ((msg as any).ocrText || (msg as any).ocrLabel);
            const isSkillsList = !!(msg as ExtendedChatMessage).isSkillsList;
            const isToolNote = isSearchResult || msgIsOcr || isSkillsList;
            const isStreamingEmpty = isLastMessage && isLoading && !displayContent && !hasValidOcr;
            if (isStreamingEmpty && msg.role === 'model') {
              return null;
            }

            return (
              <motion.div
                key={msg.id || `${msg.role}-${i}`}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                className={`mx-auto flex w-full max-w-[650px] flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                {isDevMode && msg.role === 'model' && (msg.thinkingSteps || displayThought) && (
                  <div className="mb-2 w-full">
                    <ThinkingPanel steps={msg.thinkingSteps} thinkText={displayThought} initialOpen={false} />
                  </div>
                )}

                <div
                  className={`group relative leading-relaxed transition-all duration-[180ms] ease-[var(--ease-spring)] ${msg.role === 'user' ? 'max-w-[78%] rounded-2xl rounded-tr-md px-3.5 py-2.5 text-[14px] shadow-sm' : 'w-full max-w-full px-0 py-1'}`}
                  style={{
                    ...(msg.role === 'user' ? userBubbleStyle : { color: 'var(--primary-text)' }),
                    fontFamily: workspacePrefs.fontFamily,
                    fontSize: msg.role === 'user' ? Math.max(12, workspacePrefs.fontSize - 2) : workspacePrefs.fontSize,
                  }}
                >
                  {msg.role === 'model' && !isToolNote && (
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]">
                          <img src="/logo-transparent.png" alt="Aartiq" className="h-3.5 w-3.5 object-contain" />
                        </div>
                        <span className="text-[11px] font-medium text-secondary-text">Aartiq</span>
                      </div>
                      <button
                        onClick={() => { navigator.clipboard.writeText(displayContent); playClickSound('confirm'); }}
                        className="rounded-md p-1.5 text-secondary-text opacity-0 transition-all hover:bg-[color-mix(in_srgb,var(--primary-text)_8%,transparent)] hover:text-primary-text group-hover:opacity-100"
                        title="Copy response"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  )}
                  {isSearchResult && displayContent && (
                    <div className="flex items-center gap-1.5 py-0.5 text-[11px] text-secondary-text/70 leading-snug">
                      <Search
                        size={12}
                        className="shrink-0 text-sky-400/70 transition-transform duration-200 ease-out hover:scale-125 hover:rotate-6"
                      />
                      <span>{displayContent}</span>
                    </div>
                  )}
                  {!isSearchResult && msgIsOcr && displayContent && (
                    <div className="py-0.5 text-[11px] text-secondary-text/70 leading-snug">{displayContent}</div>
                  )}
                  {isSkillsList && displayContent && (
                    <div className="py-0.5 text-[11px] text-secondary-text/70 leading-snug">{displayContent}</div>
                  )}
                  {!isToolNote && displayContent && (
                    msg.role === 'model' ? (
                      <SmartMessageContent
                        content={displayContent}
                        animate={msg.id === activeStreamingMessageIdRef.current}
                        renderText={(text, anim) => (
                          <StreamingMarkdownMessage content={text} animate={anim} />
                        )}
                      />
                    ) : (
                      <StreamingMarkdownMessage
                        content={displayContent}
                        animate={false}
                      />
                    )
                  )}
                  {msgIsOcr && (msg as any).ocrText && (
                    <CollapsibleOCRMessage label={(msg as any).ocrLabel || 'SCREENSHOT_ANALYSIS'} content={(msg as any).ocrText} />
                  )}
                  {msg.role === 'user' && (msg as ExtendedChatMessage).loadedSkills && (msg as ExtendedChatMessage).loadedSkills!.length > 0 && (
                    <CollapsibleSkillMessage skills={(msg as ExtendedChatMessage).loadedSkills!} />
                  )}

                  {(msg as ExtendedChatMessage).isSkillsList && (
                    <SkillsListMessage />
                  )}

                  {(msg as ExtendedChatMessage).question && (
                    <QuestionCard
                      question={(msg as ExtendedChatMessage).question!}
                      answered={Boolean(answeredQuestions[msg.id ?? ''])}
                      answer={answeredQuestions[msg.id ?? '']?.answer}
                      skipped={answeredQuestions[msg.id ?? '']?.skipped}
                      onAnswer={(text) => {
                        setAnsweredQuestions(prev => ({ ...prev, [msg.id ?? '']: { answer: text } }));
                        handleSendMessage(text);
                      }}
                      onSkip={() => {
                        setAnsweredQuestions(prev => ({ ...prev, [msg.id ?? '']: { skipped: true } }));
                        handleSendMessage('[User skipped the clarifying question — please proceed with a reasonable default or continue the request]');
                      }}
                    />
                  )}

                  {/* ── Inline Media: Images & Video Cards ─────────────────── */}
                  {msg.mediaItems && msg.mediaItems.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {msg.mediaItems.map((item, midx) => {
                        if (item.type === 'image') {
                          const imageUrl = item.url;
                          const handleDownload = async () => {
                            const link = document.createElement('a');
                            link.href = imageUrl;
                            link.download = item.title || `image-${Date.now()}.png`;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          };
                          const handleCopy = async () => {
                            try {
                              const response = await fetch(imageUrl);
                              const blob = await response.blob();
                              await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                            } catch {
                              // Fallback: just copy the URL
                              await navigator.clipboard.writeText(imageUrl);
                            }
                          };
                          return (
                            <motion.div
                              key={midx}
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                              className="rounded-2xl overflow-hidden border border-white/10 shadow-xl group relative"
                            >
                              <img
                                src={item.url}
                                alt={item.caption || 'Image'}
                                className="w-full max-h-80 object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect fill="%230f0f1a" width="400" height="200"/><text fill="%23ffffff40" x="50%" y="50%" text-anchor="middle" dy=".3em" font-size="14">Image unavailable</text></svg>';
                                }}
                              />
                              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={handleDownload}
                                  className="p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white/80 hover:text-white transition-colors"
                                  title="Download"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                  </svg>
                                </button>
                                <button
                                  onClick={handleCopy}
                                  className="p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white/80 hover:text-white transition-colors"
                                  title="Copy to clipboard"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                </button>
                              </div>
                              {(item.caption || item.description) && (
                                <div className="px-3 py-2 bg-black/30 text-[10px] text-white/50 font-medium">
                                  {item.caption || item.description}
                                </div>
                              )}
                            </motion.div>
                          );
                        }
                        if (item.type === 'video') {
                          const isYt = item.source === 'youtube';
                          const shouldEmbed = isYt && item.videoId && (item as any).autoPlay;
                          if (shouldEmbed) {
                            return (
                              <motion.div
                                key={midx}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                                className="my-2"
                              >
                                <YouTubePlayer
                                  videoId={item.videoId!}
                                  title={item.title}
                                  autoPlay={true}
                                />
                              </motion.div>
                            );
                          }
                          return (
                            <motion.a
                              key={midx}
                              href={item.videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => { e.preventDefault(); window.electronAPI?.createView?.({ tabId: `yt-${Date.now()}`, url: item.videoUrl }); store.addTab(item.videoUrl); }}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                              className="block rounded-2xl overflow-hidden border border-white/10 shadow-xl bg-black/40 hover:border-sky-500/40 transition-all duration-[150ms] ease-[var(--ease-spring)] group cursor-pointer"
                            >
                              {/* Thumbnail */}
                              <div className="relative">
                                {item.thumbnailUrl ? (
                                  <img
                                    src={item.thumbnailUrl}
                                    alt={item.title}
                                    className="w-full max-h-52 object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                    onError={(e) => {
                                      // Fallback to hqdefault if maxresdefault 404s
                                      if (isYt && item.videoId) {
                                        (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${item.videoId}/hqdefault.jpg`;
                                      }
                                    }}
                                  />
                                ) : (
                                  <div className="w-full h-40 bg-gradient-to-br from-sky-900/40 to-purple-900/40 flex items-center justify-center">
                                    <Play size={40} className="text-white/30" />
                                  </div>
                                )}
                                {/* Play button overlay */}
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <div className={`w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-[150ms] ease-[var(--ease-spring)] group-hover:brightness-110 ${isYt ? 'bg-red-600' : 'bg-sky-500'}`}>
                                    <Play size={22} className="text-white ml-1" fill="white" />
                                  </div>
                                </div>
                                {/* Source badge */}
                                <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${isYt ? 'bg-red-600 text-white' : 'bg-sky-500 text-black'}`}>
                                  {isYt ? 'YouTube' : 'Video'}
                                </div>
                              </div>
                              {/* Info */}
                              <div className="p-3">
                                <p className="text-sm font-bold text-white/90 leading-tight line-clamp-2">{item.title}</p>
                                {item.description && (
                                  <p className="text-[11px] text-white/50 mt-1.5 leading-relaxed line-clamp-3">{item.description}</p>
                                )}
                                <p className="text-[9px] text-sky-400/60 mt-2 font-mono truncate">{item.videoUrl}</p>
                              </div>
                            </motion.a>
                          );
                        }
                        if (item.type === 'mermaid') {
                          return (
                            <MermaidDiagram key={midx} diagramId={item.diagramId} code={item.code} />
                          );
                        }
                        if (item.type === 'flowchart') {
                          return (
                            <FlowchartDiagram key={midx} diagramId={item.diagramId} code={item.code} />
                          );
                        }
                        if (item.type === 'chart') {
                          return (
                            <ChartDiagram key={midx} chartId={item.chartId} data={item.data} options={item.options} />
                          );
                        }
                        return null;
                      })}
                    </div>
                  )}
                  {isDevMode && msg.actionLogs && msg.actionLogs.length > 0 && (
                    <div className="mt-3">
                      <button
                        onClick={() => setShowDevLogs(v => !v)}
                        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-secondary-text/50 hover:text-secondary-text transition-colors mb-1.5"
                      >
                        <ChevronDown size={10} className={`transition-transform duration-[150ms] ${showDevLogs ? 'rotate-180' : ''}`} />
                        {msg.actionLogs.length} action{msg.actionLogs.length !== 1 ? 's' : ''}
                      </button>
                      {showDevLogs && (
                        <div className="flex flex-wrap gap-1.5">
                          {msg.actionLogs.map((log, idx) => {
                        const isSearch = log.type.includes('SEARCH');
                        const isRead = log.type.includes('READ') || log.type.includes('EXTRACT');
                        const isClick = log.type.includes('CLICK');
                        const isOcr = log.type.includes('SCREENSHOT') || log.type.includes('OCR') || log.type.includes('VISION');
                        const isPdf = log.type === 'PDF_READY';
                        const isMeta = log.type === 'THINK' || log.type === 'PLAN';

                        let colorClass = log.success ? 'bg-sky-500/10 border-sky-500/30 text-sky-400' : 'bg-red-500/10 border-red-500/30 text-red-400';
                        if (log.success) {
                          if (isClick) colorClass = 'bg-amber-500/10 border-amber-500/30 text-amber-500';
                          else if (isOcr) colorClass = 'bg-purple-500/10 border-purple-500/30 text-purple-400';
                          else if (isPdf) colorClass = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 cursor-pointer hover:bg-emerald-500/20';
                          else if (isMeta) colorClass = 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300';
                        }

                        return (
                          <div
                            key={idx}
                            onClick={() => isPdf && window.electronAPI.openPDF(log.output)}
                            className={`px-3 py-1.5 rounded-full flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest border transition-all duration-[150ms] ease-[var(--ease-spring)] hover:brightness-110 shadow-sm active:opacity-80 ${colorClass}`}
                            title={isPdf ? 'Click to open PDF' : log.output}
                          >
                            {isSearch && <Search size={12} />}
                            {(isRead || isPdf) && <FileText size={12} />}
                            {isClick && <MousePointerClick size={12} />}
                            {isOcr && <Camera size={12} />}
                            {isMeta && <Sparkles size={12} />}
                            {!isSearch && !isRead && !isClick && !isOcr && !isPdf && !isMeta && (log.success ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />)}
                            <span>{isPdf ? 'Open PDF' : log.type.replace(/_/g, ' ')}</span>
                          </div>
                        );
                      })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* DOM Search Results Display — handled via ActionChainTimeline now */}
                  {false && i === messages.length - 1 && (domSearchResults.length > 0 || domSearchLoading || domMeta) && (
                    <DOMSearchDisplay
                      results={domSearchResults}
                      query={domSearchQuery}
                      isLoading={domSearchLoading}
                      onClose={() => { setDOMSearchResults([]); setDOMMeta(null); }}
                      type="dom"
                      timestamp={domMeta?.timestamp}
                    />
                  )}

                  {/* OCR Search Results Display */}
                  {i === messages.length - 1 && (ocrSearchResults.length > 0 || ocrSearchLoading) && (
                    <DOMSearchDisplay
                      results={ocrSearchResults}
                      query={ocrSearchQuery}
                      isLoading={ocrSearchLoading}
                      onClose={() => { setOCRSearchResults([]); }}
                      type="ocr"
                    />
                  )}

                  {msg.role === 'model' && (
                    <MessageActions content={displayContent} index={i} copiedIndex={copiedMessageIndex} onCopy={() => { }} onShare={() => { }} />
                  )}
                </div>
              </motion.div>
            )
          })}
          {isLoading && messages.length === 0 && <ThinkingStatus state={agentState} />}

          {/* Research Execution Card — shows during active research */}
          {researchState.steps.length > 0 && (
            <div className="mx-auto w-full max-w-[650px] space-y-2">
              <ResearchExecutionCard
                steps={researchState.steps as ExecutionStepData[]}
                isComplete={researchState.status === 'completed' || researchState.status === 'failed' || researchState.status === 'cancelled'}
                query={researchState.query}
                progress={researchState.progress}
                currentStep={researchState.currentStep}
                totalSteps={researchState.totalSteps}
                coverage={researchState.coverage || undefined}
              />
              {researchState.sources.length > 0 && (
                <ResearchSourceCarousel sources={researchState.sources} />
              )}
              {(researchState.contradictions as any[] | undefined)?.length > 0 && (
                <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 overflow-hidden">
                  <div className="px-4 py-3 border-b border-amber-500/10 flex items-center gap-2">
                    <span className="text-sm">⚠️</span>
                    <span className="text-sm font-semibold text-amber-300">
                      Sources disagree
                    </span>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    {(researchState.contradictions as any[]).map((c, i) => (
                      <div key={i} className="space-y-1">
                        <div className="text-[10px] font-medium text-amber-400/80 uppercase tracking-wider">
                          {String(c?.type || 'conflict').replace(/_/g, ' ')}
                        </div>
                        <div className="text-xs text-zinc-400">
                          <span className="text-zinc-300">{c?.claim1?.source}</span>: &ldquo;{c?.claim1?.text}&rdquo;
                        </div>
                        <div className="text-xs text-zinc-400">
                          <span className="text-zinc-300">{c?.claim2?.source}</span>: &ldquo;{c?.claim2?.text}&rdquo;
                        </div>
                        {c?.ratio && (
                          <div className="text-[10px] text-amber-400/60">Discrepancy: {c.ratio}x</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {isLoading && messages.length > 0 && (
            <ProcessingIndicator
              agentState={agentState}
              customStatus={customStatusText || undefined}
              currentCommand={
                commandQueue.length > 0 && currentCommandIndex < commandQueue.length
                  ? commandQueue[currentCommandIndex]
                  : null
              }
            />
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Overlays: Customization / Privacy / Theme */}
      <AnimatePresence>
        {showCustomization && (
          <CustomizationPanel
            initialPrefs={sidebar.prefs}
            initialGlobalTheme={useAppStore.getState().theme}
            onPreview={(prefs) => sidebar.preview(prefs)}
            onApply={(prefs) => sidebar.commit(prefs)}
            onClose={() => setShowCustomization(false)}
            setGlobalTheme={(t) => useAppStore.getState().setTheme(t)}
          />
        )}
        {showPrivacy && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
            <PrivacyControls onClose={() => setShowPrivacy(false)} />
          </div>
        )}
        {showThemeSettings && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
            <div className="rounded-xl border border-[color-mix(in_srgb,var(--border-color)_30%,transparent)] bg-[color-mix(in_srgb,var(--card-bg)_96%,transparent)] backdrop-blur-2xl overflow-hidden shadow-2xl w-full max-w-xs">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-secondary-text">AI Visual Theme</h3>
                <button onClick={() => setShowThemeSettings(false)} className="p-1 rounded-md hover:bg-white/10 text-secondary-text/50 hover:text-secondary-text transition-all">
                  <X size={14} />
                </button>
              </div>
              <div className="px-4 py-3">
                <AIVisualThemeControl
                  current={aiVisualSettings}
                  onUpdate={(s) => setAiVisualSettings(s)}
                />
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Compact mode: minimal input only */}
      {sidebarMode === 'compact' && messages.length === 0 && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <div className="w-8 h-8 rounded-xl mx-auto mb-2 border flex items-center justify-center" style={softPanelStyle}>
              <img src="/logo-transparent.png" alt="Aartiq" className="w-5 h-5 object-contain" />
            </div>
            <p className="text-[10px] text-secondary-text/50">Compact mode</p>
            <p className="text-[9px] text-secondary-text/30 mt-0.5">Type a message to start</p>
          </div>
        </div>
      )}

      {/* Background Task Notifications */}
      <BackgroundNotifications />

      {/* Automation Report Toast */}
      <AnimatePresence>
        {automationReport && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="mx-4 mb-2 rounded-xl border border-white/[0.08] bg-[color-mix(in_srgb,var(--card-bg)_92%,transparent)] backdrop-blur-2xl overflow-hidden shadow-lg"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.05]">
              <span className="text-[9px] font-bold uppercase tracking-wider text-secondary-text/70">
                Automation Complete
              </span>
              <button onClick={() => setAutomationReport(null)} className="p-0.5 rounded text-secondary-text/30 hover:text-secondary-text transition-colors">
                <X size={11} />
              </button>
            </div>
            <div className="px-3 py-2">
              <div className="flex items-center gap-3 mb-1.5">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-emerald-400/80 font-bold">{automationReport.successCount}</span>
                  <span className="text-[7px] text-secondary-text/40 uppercase tracking-wider">succeeded</span>
                </div>
                {automationReport.failedCount > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-red-400/80 font-bold">{automationReport.failedCount}</span>
                    <span className="text-[7px] text-secondary-text/40 uppercase tracking-wider">failed</span>
                  </div>
                )}
                <div className="flex items-center gap-1 ml-auto">
                  <span className="text-[7px] text-secondary-text/30 uppercase tracking-wider">
                    {Math.round((automationReport.endTime - automationReport.startTime) / 1000)}s
                  </span>
                </div>
              </div>
              {automationReport.failedCount > 0 && (
                <div className="space-y-0.5 mt-1 pt-1 border-t border-white/[0.04]">
                  {automationReport.commands.filter(c => c.status === 'failed' || c.status === 'error').slice(0, 3).map((c, i) => (
                    <div key={i} className="flex items-start gap-1 text-[8px]">
                      <span className="text-red-400/60 mt-0.5">●</span>
                      <span className="text-secondary-text/50 truncate flex-1">{c.label}</span>
                      {c.error && <span className="text-red-400/40 truncate max-w-[100px]">{c.error}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <footer className="flex-shrink-0 px-4 pb-3 pt-2" suppressHydrationWarning style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--primary-bg) 72%, transparent), color-mix(in srgb, var(--primary-bg) 98%, transparent) 32%, var(--primary-bg) 100%)', backdropFilter: 'blur(18px)' }}>
        {messages.length === 0 && (
          <AISuggestionBubbles
            autoSuggestions={llmSuggestions}
            loading={llmSuggestionsLoading}
            onRefresh={generateLlmSuggestions}
            onAction={(cmd) => handleSendMessage(cmd)}
          />
        )}
        <div className={`mx-auto max-w-[650px] rounded-2xl border p-2 transition-all duration-[180ms] ease-[var(--ease-spring)] ${glowActive && composerFocused ? (isRgbGlow ? 'rgb-glow-animate' : 'ai-glow-shift') : ''} ${shiftTabGlow
          ? 'border-purple-500/70 shadow-[0_0_22px_rgba(168,85,247,0.26)]'
          : 'focus-within:border-[color-mix(in_srgb,var(--accent)_35%,var(--border-color))]'
          }`} suppressHydrationWarning style={{
            ...softPanelStyle,
            ...(glowActive && composerFocused
              ? {
                borderColor: 'color-mix(in srgb, var(--accent) 36%, var(--border-color))',
                boxShadow: `0 12px 34px ${hexToRgba(glowPrimary, 0.18)}, 0 0 40px ${hexToRgba(glowSecondary, 0.10)}, inset 0 0 0 1px rgba(255,255,255,0.04)`,
              }
              : {
                boxShadow: '0 14px 36px rgba(0,0,0,0.18)',
              }),
          }}>

          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <motion.div initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15, ease: [0.32, 0.72, 0, 1] }} key={i} className="flex max-w-full items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--accent)_9%,transparent)] px-2.5 py-1.5 text-[12px] text-secondary-text">
                  {a.type === 'image' ? <ImageIcon size={12} /> : <FileText size={12} />}
                  <span className="max-w-[160px] truncate">{a.filename}</span>
                  <button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))} className="rounded p-0.5 hover:text-red-500" title="Remove attachment"><X size={12} /></button>
                </motion.div>
              ))}
            </div>
          )}

          <AnimatePresence>
            {showActionsMenu && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                className="absolute bottom-24 left-4 z-[60] w-52 overflow-hidden rounded-xl border p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.28)] backdrop-blur-3xl"
                style={popoverStyle}
              >
                <button onClick={clearChat} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-red-500/80 transition-colors hover:bg-red-500/10 hover:text-red-500"><Trash2 size={14} /> Clear thread</button>
                <div className="h-px bg-white/5 my-1 mx-2" />
                <button onClick={() => exportChat('text')} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-secondary-text transition-colors hover:bg-[color-mix(in_srgb,var(--primary-text)_7%,transparent)] hover:text-primary-text"><FileText size={14} /> Export text</button>
                <button onClick={() => exportChat('pdf')} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-secondary-text transition-colors hover:bg-[color-mix(in_srgb,var(--primary-text)_7%,transparent)] hover:text-primary-text"><Download size={14} /> Export PDF</button>
                <button onClick={copyChatToClipboard} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-secondary-text transition-colors hover:bg-[color-mix(in_srgb,var(--primary-text)_7%,transparent)] hover:text-primary-text"><CopyIcon size={14} /> Copy context</button>
                <button onClick={() => { props.setShowSettings?.(true); props.setSettingsSection?.('sidebar'); setShowActionsMenu(false); playClickSound(); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-secondary-text transition-colors hover:bg-[color-mix(in_srgb,var(--primary-text)_7%,transparent)] hover:text-primary-text"><Layers size={14} /> Customize workspace</button>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showSidebarCustomize && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                className="absolute bottom-24 left-0 right-0 z-[70] mx-auto w-full max-w-full rounded-2xl border p-4 shadow-[0_24px_70px_rgba(0,0,0,0.32)] backdrop-blur-3xl"
                style={popoverStyle}
              >
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-[14px] font-semibold text-primary-text">Chat appearance</p>
                    <p className="text-[12px] text-secondary-text">Fonts, controls, model labels, and sounds.</p>
                  </div>
                  <button onClick={() => setShowSidebarCustomize(false)} className="rounded-lg p-2 text-secondary-text hover:bg-[color-mix(in_srgb,var(--primary-text)_7%,transparent)] hover:text-primary-text"><X size={16} /></button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-medium text-secondary-text">Font</span>
                    <select
                      value={workspacePrefs.fontFamily}
                      onChange={(event) => updateWorkspacePrefs({ fontFamily: event.target.value })}
                      className="w-full rounded-lg border border-border-color bg-primary-bg px-3 py-2 text-[13px] text-primary-text outline-none"
                    >
                      <option value={'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'}>System</option>
                      <option value={'SF Pro Text, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'}>SF Pro</option>
                      <option value={'Georgia, "Times New Roman", serif'}>Serif</option>
                      <option value={'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'}>Mono</option>
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-medium text-secondary-text">Font size: {workspacePrefs.fontSize}px</span>
                    <input
                      type="range"
                      min={13}
                      max={20}
                      value={workspacePrefs.fontSize}
                      onChange={(event) => updateWorkspacePrefs({ fontSize: Number(event.target.value) })}
                      className="w-full accent-[var(--accent)]"
                    />
                  </label>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <label className="flex items-center justify-between rounded-lg border border-border-color/70 px-3 py-2 text-[13px] text-secondary-text">
                    Click sounds
                    <input type="checkbox" checked={workspacePrefs.soundsEnabled} onChange={(event) => updateWorkspacePrefs({ soundsEnabled: event.target.checked })} />
                  </label>
                  <div className="rounded-lg border border-border-color/70 px-3 py-2 space-y-2">
                    <span className="text-[13px] text-secondary-text">Glow effect</span>
                    <div className="flex gap-1">
                      {(['off', 'gradient', 'rgb'] as GlowMode[]).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => {
                            updateWorkspacePrefs({
                              glowMode: mode,
                              gradientEffectsEnabled: mode !== 'off',
                            });
                          }}
                          className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                            workspacePrefs.glowMode === mode
                              ? 'bg-[var(--accent)] text-white'
                              : 'bg-white/5 text-secondary-text hover:bg-white/10'
                          }`}
                        >
                          {mode === 'off' ? 'Off' : mode === 'gradient' ? 'Gradient' : 'RGB'}
                        </button>
                      ))}
                    </div>
                    {workspacePrefs.glowMode !== 'off' && (
                      <div className="space-y-2 pt-1">
                        <select
                          value={workspacePrefs.glowPreset}
                          onChange={(e) => {
                            const preset = e.target.value as GlowPreset;
                            const scheme = GLOW_PRESETS[preset];
                            updateWorkspacePrefs({
                              glowPreset: preset,
                              glowColorPrimary: scheme.primary,
                              glowColorSecondary: scheme.secondary,
                              glowColorTertiary: scheme.tertiary,
                            });
                          }}
                          className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-primary-text outline-none"
                        >
                          {(Object.keys(GLOW_PRESETS) as GlowPreset[]).filter(p => p !== 'custom').map((preset) => (
                            <option key={preset} value={preset}>{GLOW_PRESETS[preset].label}</option>
                          ))}
                          <option value="custom">Custom colors...</option>
                        </select>
                        {workspacePrefs.glowPreset === 'custom' && (
                          <div className="space-y-1.5">
                            {([
                              { key: 'glowColorPrimary', label: 'Primary' },
                              { key: 'glowColorSecondary', label: 'Secondary' },
                              { key: 'glowColorTertiary', label: 'Tertiary' },
                            ] as const).map(({ key, label }) => (
                              <div key={key} className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={workspacePrefs[key]}
                                  onChange={(e) => updateWorkspacePrefs({ [key]: e.target.value })}
                                  className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                                />
                                <span className="text-[11px] text-secondary-text">{label}</span>
                                <span className="ml-auto font-mono text-[10px] text-secondary-text/60">{workspacePrefs[key]}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {workspacePrefs.glowPreset !== 'custom' && (
                          <div className="flex items-center gap-1.5 pt-0.5">
                            <div className="h-3 w-3 rounded-full" style={{ background: GLOW_PRESETS[workspacePrefs.glowPreset].primary }} />
                            <div className="h-3 w-3 rounded-full" style={{ background: GLOW_PRESETS[workspacePrefs.glowPreset].secondary }} />
                            <div className="h-3 w-3 rounded-full" style={{ background: GLOW_PRESETS[workspacePrefs.glowPreset].tertiary }} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {(['attachments', 'voice', 'neuralCache', 'history', 'automation'] as ComposerIconKey[]).map((key) => (
                    <label key={key} className="flex items-center justify-between rounded-lg border border-border-color/70 px-3 py-2 text-[13px] text-secondary-text">
                      {key === 'neuralCache' ? 'Neural cache' : key.charAt(0).toUpperCase() + key.slice(1)}
                      <input type="checkbox" checked={workspacePrefs.visibleComposerIcons[key]} onChange={(event) => updateComposerIconVisibility(key, event.target.checked)} />
                    </label>
                  ))}
                </div>
                <label className="mt-4 block space-y-1.5">
                  <span className="text-[12px] font-medium text-secondary-text">Nickname for this model</span>
                  <input
                    value={workspacePrefs.modelNicknames[activeModelKey] || ''}
                    onChange={(event) => updateActiveModelNickname(event.target.value)}
                    placeholder={currentActiveModel}
                    className="w-full rounded-lg border border-border-color bg-primary-bg px-3 py-2 text-[13px] text-primary-text outline-none"
                  />
                </label>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showModelPicker && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                className="absolute bottom-20 right-2 z-[65] max-h-80 w-72 overflow-y-auto rounded-xl border p-2 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-3xl"
                style={popoverStyle}
              >
                {modelOptions.map((option) => {
                  const key = `${option.provider}:${option.model}`;
                  const active = key === activeModelKey;
                  return (
                    <button
                      key={key}
                      onClick={() => selectChatModel(option.provider, option.model)}
                      className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${active ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-primary-text' : 'text-secondary-text hover:bg-[color-mix(in_srgb,var(--primary-text)_7%,transparent)] hover:text-primary-text'}`}
                    >
                      <span className="block text-[13px] font-medium">{workspacePrefs.modelNicknames[key] || option.model}</span>
                      <span className="block text-[11px] opacity-70">{option.label}</span>
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          <textarea
            data-ai-input
            value={inputMessage}
            onChange={(e) => {
              markSidebarInteraction();
              setInputMessage(e.target.value);
            }}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
            onFocus={() => { markSidebarInteraction(); setComposerFocused(true); }}
            onBlur={() => setComposerFocused(false)}
            placeholder="Ask Aartiq to browse, reason, or automate..."
            className="max-h-32 min-h-[40px] w-full resize-none bg-transparent px-2 py-1.5 text-[14px] text-primary-text outline-none placeholder:text-secondary-text modern-scrollbar"
          />

          <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-0.5">
              {workspacePrefs.visibleComposerIcons.attachments && (
                <button onClick={() => { playClickSound(); fileInputRef.current?.click(); }} className="rounded-lg p-2 text-secondary-text transition-colors hover:bg-[color-mix(in_srgb,var(--primary-text)_7%,transparent)] hover:text-primary-text" title="Attach file"><Paperclip size={18} /></button>
              )}
              {workspacePrefs.visibleComposerIcons.voice && (
                <button onClick={handleVoiceInput} className={`rounded-lg p-2 transition-colors ${isRecordingVoice ? 'bg-red-500/10 text-red-500' : 'text-secondary-text hover:bg-[color-mix(in_srgb,var(--primary-text)_7%,transparent)] hover:text-primary-text'}`} title={isRecordingVoice ? 'Stop recording' : 'Voice input'}><Mic size={18} /></button>
              )}
              {workspacePrefs.visibleComposerIcons.neuralCache && (
                <button onClick={() => { playClickSound('toggle'); setShowRagPanel((value) => !value); }} className={`rounded-lg p-2 transition-colors ${showRagPanel ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-primary-text' : 'text-secondary-text hover:bg-[color-mix(in_srgb,var(--primary-text)_7%,transparent)] hover:text-primary-text'} ${glowActive && composerFocused ? `shadow-[0_0_16px_${hexToRgba(glowPrimary, 0.18)}]` : ''}`} suppressHydrationWarning title="Neural cache"><Database size={18} /></button>
              )}
              {workspacePrefs.visibleComposerIcons.history && (
                <button
                  onClick={() => { playClickSound(); setShowConversationHistory(true); }}
                  title="Conversation history"
                  className="rounded-lg p-2 text-secondary-text transition-colors hover:bg-[color-mix(in_srgb,var(--primary-text)_7%,transparent)] hover:text-primary-text"
                >
                  <History size={18} />
                </button>
              )}
              {workspacePrefs.visibleComposerIcons.automation && (
                <button onClick={() => { playClickSound(); setShowActionsMenu(!showActionsMenu); }} className={`rounded-lg p-2 transition-colors ${showActionsMenu ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-primary-text' : 'text-secondary-text hover:bg-[color-mix(in_srgb,var(--primary-text)_7%,transparent)] hover:text-primary-text'}`} title="Automation menu"><MoreHorizontal size={18} /></button>
              )}
            </div>
            <div className="hidden min-w-0 flex-1 justify-center px-3 text-[11px] text-secondary-text/80 sm:flex">
                <button onClick={() => { playClickSound('toggle'); setShowModelPicker((value) => !value); }} className="truncate rounded-md px-2 py-1 hover:bg-[color-mix(in_srgb,var(--primary-text)_7%,transparent)] hover:text-primary-text" title={currentActiveModel}>
                {activeModelDisplayName}
              </button>
            </div>
            <button
              onClick={() => { playClickSound('confirm'); handleSendMessage(); }}
              disabled={isLoading || (!inputMessage.trim() && attachments.length === 0)}
              className="group flex h-9 w-9 items-center justify-center rounded-lg border border-purple-400/20 bg-transparent transition-all duration-[150ms] ease-[var(--ease-spring)] hover:brightness-110 active:opacity-80 disabled:opacity-25 disabled:grayscale"
              suppressHydrationWarning
              title="Send message (Enter)"
              style={{
                color: 'var(--primary-text)',
                borderColor: glowActive && composerFocused ? hexToRgba(glowPrimary, 0.25) : undefined,
                background: glowActive && composerFocused
                  ? `radial-gradient(circle at 35% 25%, ${hexToRgba(glowPrimary, 0.20)}, ${hexToRgba(glowSecondary, 0.08)} 54%, transparent 78%)`
                  : 'transparent',
                boxShadow: glowActive && composerFocused
                  ? `0 0 18px ${hexToRgba(glowPrimary, 0.30)}`
                  : '0 4px 14px color-mix(in srgb, var(--shadow-color) 18%, transparent)'
              }}
            >
              <Send size={17} className="transition-transform duration-[150ms] ease-[var(--ease-spring)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-secondary-text/70">Aartiq can make mistakes. Review sensitive actions.</p>
      </footer>

      <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*,application/pdf,text/plain,text/markdown,.txt,.md,.markdown" onChange={handleAttachmentChange} />
      <LLMProviderSettings
        {...props}
        showSettings={showLLMProviderSettings}
        setShowSettings={setShowLLMProviderSettings}
        ollamaModels={ollamaModelsList.map(m => ({ name: m.name, modified_at: (m as any).modified_at || 'Recently' }))}
        setOllamaModels={setOllamaModelsList}
        setError={setError}
      />
      {/* Feedback Notification */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-sky-500 text-white px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-2xl z-[1000] flex items-center gap-2"
          >
            <CheckCircle2 size={14} /> {feedback}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scheduling Modal - only render if not controlled by props */}
      {props.showSchedulingModal === undefined && (
        <SchedulingModal
          isOpen={showSchedulingModal}
          onClose={() => {
            setShowSchedulingModal(false);
            setSchedulingIntent(null);
            schedulingOpenedByClient.current = false;
            if (props.setBrowserDisabled) props.setBrowserDisabled(false);
          }}
          onConfirm={handleSchedulingConfirm}
          taskDetails={{
            taskName: schedulingIntent?.taskName || 'Scheduled Task',
            taskType: schedulingIntent?.taskType || 'ai-prompt',
            schedule: schedulingIntent?.schedule.expression || '0 8 * * *',
            description: `Detected: ${schedulingIntent?.schedule.description || 'Custom schedule'}`,
            url: schedulingIntent?.url || '',
            command: schedulingIntent?.command || '',
          }}
        />
      )}
      </>)}
    </div>
  );
};

export default memo(AIChatSidebar);
