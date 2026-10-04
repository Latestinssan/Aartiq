"use client";

import React, { memo, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, ChevronRight, Search, Globe, FileText, Terminal,
  ExternalLink, Copy, Check, Folder, Eye, EyeOff
} from 'lucide-react';
import MoleculeRenderer from './MoleculeRenderer';

// ─── URL Detection & Favicon Card ─────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s\])>"'`,]+/g;

interface URLCardProps {
  url: string;
  title?: string;
  compact?: boolean;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function getFaviconUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return '';
  }
}

const URLCard = memo(function URLCard({ url, title, compact = true }: URLCardProps) {
  const [hovered, setHovered] = useState(false);
  const domain = useMemo(() => extractDomain(url), [url]);
  const favicon = useMemo(() => getFaviconUrl(url), [url]);

  const openURL = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      // addTab creates the store entry *and* its BrowserView under one id —
      // a separate createView here would leak an orphan view for a tab id
      // that never exists in the store.
      const { addTab } = require('@/store/useAppStore').useAppStore.getState();
      addTab(url, 'ai-session');
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [url]);

  if (compact) {
    return (
      <span
        className="group/url inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[0.9em] cursor-pointer hover:bg-sky-500/15 transition-all align-bottom max-w-[300px]"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={openURL}
      >
        {favicon && (
          <img
            src={favicon}
            alt=""
            className="h-3.5 w-3.5 shrink-0 rounded-sm"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <span className="text-sky-300 underline decoration-sky-400/30 underline-offset-2 truncate">
          {title || domain}
        </span>
        <ExternalLink size={10} className="text-white/20 shrink-0 opacity-0 group-hover/url:opacity-100 transition-opacity" />
        {/* Hover tooltip showing full URL */}
        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 max-w-[400px] rounded-lg border border-white/10 bg-[#1a1a2e]/95 px-3 py-2 text-[11px] opacity-0 shadow-2xl backdrop-blur-xl transition-all duration-200 group-hover/url:translate-y-0 group-hover/url:opacity-100 translate-y-1">
          <span className="block font-medium text-white/90">{domain}</span>
          <span className="block text-white/40 break-all mt-0.5">{url}</span>
        </span>
      </span>
    );
  }

  return (
    <a
      href={url}
      onClick={openURL}
      className="group/card flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 hover:bg-white/[0.05] hover:border-sky-500/20 transition-all cursor-pointer"
    >
      {favicon && (
        <img
          src={favicon}
          alt=""
          className="h-5 w-5 shrink-0 rounded"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <div className="flex-1 min-w-0">
        <span className="text-[13px] text-white/80 block truncate">{title || domain}</span>
        <span className="text-[10px] text-white/30 block truncate">{url}</span>
      </div>
      <ExternalLink size={12} className="text-white/20 shrink-0 group-hover/card:text-sky-400 transition-colors" />
    </a>
  );
});

// ─── File Path Chip ────────────────────────────────────────────────────────────

interface FilePathChipProps {
  filePath: string;
}

const FilePathChip = memo(function FilePathChip({ filePath }: FilePathChipProps) {
  const [hovered, setHovered] = useState(false);

  const displayName = useMemo(() => {
    const parts = filePath.split(/[/\\]/);
    if (parts.length <= 1) return filePath;
    return parts[parts.length - 1];
  }, [filePath]);

  const parentDir = useMemo(() => {
    const parts = filePath.split(/[/\\]/);
    if (parts.length <= 2) return '';
    return parts[parts.length - 2];
  }, [filePath]);

  const isDirectory = useMemo(() => {
    return !/\.[a-zA-Z0-9]{1,10}$/.test(filePath);
  }, [filePath]);

  const openPath = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.electronAPI?.showItemInFolder?.(filePath);
  }, [filePath]);

  return (
    <span
      className="group/filepath inline-flex items-center gap-1 rounded-lg bg-white/[0.07] px-2 py-0.5 text-[12px] font-mono cursor-pointer hover:bg-sky-500/15 transition-all align-bottom max-w-[280px] relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={openPath}
    >
      {isDirectory ? (
        <Folder size={12} className="text-sky-400/70 shrink-0" />
      ) : (
        <FileText size={12} className="text-emerald-400/70 shrink-0" />
      )}
      {parentDir && (
        <span className="text-white/30 text-[10px]">{parentDir}/</span>
      )}
      <span className="text-sky-300 truncate">{displayName}</span>
      {/* Hover tooltip showing full path */}
      <AnimatePresence>
        {hovered && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="pointer-events-none absolute left-0 top-full z-50 mt-1 max-w-[500px] rounded-lg border border-white/10 bg-[#1a1a2e]/95 px-3 py-2 text-[11px] shadow-2xl backdrop-blur-xl whitespace-nowrap"
          >
            <span className="text-white/80 break-all font-mono">{filePath}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
});

// ─── Search Result Card ────────────────────────────────────────────────────────

interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  index: number;
}

const SearchResultCard = memo(function SearchResultCard({ item }: { item: SearchResultItem }) {
  const [expanded, setExpanded] = useState(false);
  const favicon = useMemo(() => getFaviconUrl(item.url), [item.url]);
  const domain = useMemo(() => extractDomain(item.url), [item.url]);

  const openURL = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      window.electronAPI?.createView?.({ tabId: `search-${Date.now()}`, url: item.url });
      const { addTab } = require('@/store/useAppStore').useAppStore.getState();
      addTab(item.url, 'ai-session');
    } catch {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    }
  }, [item.url]);

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: item.index * 0.04 }}
      className="group/search rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1] transition-all overflow-hidden"
    >
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left"
      >
        <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-sky-500/15 text-sky-400 text-[10px] font-bold flex items-center justify-center">
          {item.index}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {favicon && (
              <img
                src={favicon}
                alt=""
                className="h-3.5 w-3.5 shrink-0 rounded-sm"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <span className="text-[13px] text-white/85 font-medium truncate block">
              {item.title || domain}
            </span>
          </div>
          <span className="text-[10px] text-white/30 block truncate">{domain}</span>
          {!expanded && item.snippet && (
            <p className="text-[11px] text-white/40 mt-1 line-clamp-2 leading-relaxed">
              {item.snippet.substring(0, 120)}
              {item.snippet.length > 120 ? '...' : ''}
            </p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1 mt-1">
          <ChevronDown
            size={12}
            className={`text-white/20 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-white/[0.04]">
              {item.snippet && (
                <p className="text-[12px] text-white/50 leading-relaxed mb-2">{item.snippet}</p>
              )}
              <URLCard url={item.url} title={item.title || domain} compact={false} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

// ─── Search Results Block ──────────────────────────────────────────────────────

interface SearchResultsBlockProps {
  query: string;
  results: SearchResultItem[];
  engine?: string;
}

const SearchResultsBlock = memo(function SearchResultsBlock({ query, results, engine }: SearchResultsBlockProps) {
  const [collapsed, setCollapsed] = useState(true);

  const topDomains = useMemo(() => {
    const seen = new Set<string>();
    return results
      .map(r => extractDomain(r.url))
      .filter(d => { if (seen.has(d)) return false; seen.add(d); return true; })
      .slice(0, 3);
  }, [results]);

  return (
    <div className="my-2 rounded-2xl border border-sky-500/10 bg-sky-500/[0.03] overflow-hidden">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center gap-2 px-3.5 py-2 hover:bg-sky-500/[0.05] transition-colors"
      >
        <Search size={13} className="text-sky-400 shrink-0" />
        <span className="text-[12px] font-medium text-sky-300">
          {results.length} results
        </span>
        {query && (
          <span className="text-[11px] text-white/30 truncate flex-1 text-left">for &ldquo;{query}&rdquo;</span>
        )}
        {topDomains.length > 0 && (
          <span className="text-[9px] text-white/20 truncate max-w-[160px]">{topDomains.join(', ')}</span>
        )}
        {engine && (
          <span className="text-[9px] text-white/20 uppercase tracking-wider shrink-0">{engine}</span>
        )}
        <ChevronDown
          size={12}
          className={`text-white/25 transition-transform duration-200 shrink-0 ${collapsed ? '' : 'rotate-180'}`}
        />
      </button>
      <AnimatePresence>
        {collapsed === false && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1.5 max-h-[350px] overflow-y-auto modern-scrollbar">
              {results.map((item) => (
                <SearchResultCard key={item.index} item={item} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ─── Shell Output Card ─────────────────────────────────────────────────────────

interface ShellOutputItem {
  command: string;
  output: string;
  success: boolean;
}

const ShellOutputCard = memo(function ShellOutputCard({ item }: { item: ShellOutputItem }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const truncatedOutput = useMemo(() => {
    if (!item.output) return '';
    return item.output.length > 200 ? item.output.substring(0, 200) + '...' : item.output;
  }, [item.output]);

  const copyCommand = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(item.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [item.command]);

  return (
    <div className={`my-1.5 rounded-xl border overflow-hidden transition-all ${
      item.success
        ? 'border-emerald-500/10 bg-emerald-500/[0.02]'
        : 'border-red-500/10 bg-red-500/[0.02]'
    }`}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02] transition-colors"
      >
        <Terminal size={12} className={`shrink-0 ${item.success ? 'text-emerald-400/70' : 'text-red-400/70'}`} />
        <code className="text-[11px] font-mono text-white/60 truncate flex-1">
          {item.command.length > 50 ? item.command.substring(0, 50) + '...' : item.command}
        </code>
        <span className={`text-[9px] font-bold uppercase tracking-wider shrink-0 ${
          item.success ? 'text-emerald-400/50' : 'text-red-400/50'
        }`}>
          {item.success ? 'OK' : 'ERR'}
        </span>
        <ChevronDown
          size={12}
          className={`text-white/20 transition-transform duration-200 shrink-0 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2.5 border-t border-white/[0.04] pt-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-white/30 uppercase tracking-wider font-bold">Command</span>
                <button
                  onClick={copyCommand}
                  className="text-[10px] text-white/30 hover:text-white/60 transition-colors flex items-center gap-1"
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="text-[11px] font-mono text-emerald-400/60 bg-black/20 rounded-lg p-2 mb-2 whitespace-pre-wrap break-all">
                $ {item.command}
              </pre>
              {item.output && (
                <>
                  <span className="text-[10px] text-white/30 uppercase tracking-wider font-bold">Output</span>
                  <pre className={`text-[10px] font-mono leading-relaxed mt-1 whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto modern-scrollbar ${
                    item.success ? 'text-white/40' : 'text-red-400/50'
                  }`}>
                    {item.output}
                  </pre>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ─── Shell Output Block ────────────────────────────────────────────────────────

const ShellOutputBlock = memo(function ShellOutputBlock({ items }: { items: ShellOutputItem[] }) {
  const [collapsed, setCollapsed] = useState(true);
  const successCount = items.filter(i => i.success).length;

  return (
    <div className="my-2 rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.03] overflow-hidden">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-emerald-500/[0.05] transition-colors"
      >
        <Terminal size={13} className="text-emerald-400 shrink-0" />
        <span className="text-[12px] font-medium text-emerald-300">
          {items.length} {items.length === 1 ? 'command' : 'commands'}
        </span>
        <span className="text-[10px] text-white/25">
          {successCount}/{items.length} succeeded
        </span>
        <ChevronDown
          size={12}
          className={`text-white/25 transition-transform duration-200 shrink-0 ${collapsed ? '' : 'rotate-180'}`}
        />
      </button>
      <AnimatePresence>
        {collapsed === false && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1 max-h-[350px] overflow-y-auto modern-scrollbar">
              {items.map((item, idx) => (
                <ShellOutputCard key={idx} item={item} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ─── Content Parsers ──────────────────────────────────────────────────────────

interface ParsedSegment {
  type: 'text' | 'search-results' | 'shell-output';
  content?: string;
  searchQuery?: string;
  searchResults?: SearchResultItem[];
  searchEngine?: string;
  shellItems?: ShellOutputItem[];
}

function parseSearchResultsBlock(text: string): { query: string; results: SearchResultItem[]; engine?: string } | null {
  // Pattern 1: ✅ Found N results for "query" via engine:\n\n1. [Title](url)\n   Snippet
  const headerMatch = text.match(/✅\s*Found\s+(\d+)\s+results?\s+for\s+"([^"]*)"\s+via\s+(\w+)/);
  if (headerMatch) {
    const query = headerMatch[2];
    const engine = headerMatch[3];
    const resultsBlock = text.substring(headerMatch.index! + headerMatch[0].length);
    const results = parseNumberedListResults(resultsBlock);
    if (results.length > 0) return { query, results, engine };
  }

  // Pattern 2: ✅ Found N results for "query" (via engine)
  const headerMatch2 = text.match(/✅\s*Found\s+(\d+)\s+results?\s+for\s+"([^"]*)"/);
  if (headerMatch2) {
    const query = headerMatch2[2];
    const resultsBlock = text.substring(headerMatch2.index! + headerMatch2[0].length);
    const results = parseNumberedListResults(resultsBlock);
    if (results.length > 0) return { query, results };
  }

  // Pattern 3: 🔍 LIVE WEB SEARCH: "query"
  const liveMatch = text.match(/🔍\s*LIVE\s+WEB\s+SEARCH:\s*"([^"]*)"/);
  if (liveMatch) {
    const query = liveMatch[1];
    const resultsBlock = text.substring(liveMatch.index! + liveMatch[0].length);
    const results = parseMarkdownFormattedResults(resultsBlock);
    if (results.length > 0) return { query, results };
  }

  // Pattern 4: DOM search for "query" returned N results:
  const domMatch = text.match(/DOM\s+search\s+for\s+"([^"]*)"\s+returned\s+(\d+)\s+results?:/);
  if (domMatch) {
    const query = domMatch[1];
    const resultsBlock = text.substring(domMatch.index! + domMatch[0].length);
    const results = parseContextResults(resultsBlock);
    if (results.length > 0) return { query, results };
  }

  return null;
}

function parseNumberedListResults(text: string): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  // Match: 1. [Title](url)\n   Snippet
  const regex = /(?:^|\n)\s*(\d+)\.\s*\[([^\]]*)\]\(([^)]+)\)\s*\n?\s*(.*?)(?=(?:\n\s*\d+\.|\n\s*$|\Z))/gs;
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({
      index: parseInt(match[1]),
      title: match[2].trim(),
      url: match[3].trim(),
      snippet: match[4].replace(/^\s+/gm, '').trim(),
    });
  }
  return results;
}

function parseMarkdownFormattedResults(text: string): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const blocks = text.split(/\*\*(\d+)\.\s*/);
  for (let i = 1; i < blocks.length; i += 2) {
    const index = parseInt(blocks[i]);
    const block = blocks[i + 1] || '';
    const titleMatch = block.match(/^(.+?)\*\*/);
    const urlMatch = block.match(/🔗\s*(https?:\/\/[^\s\n]+)/);
    const snippetMatch = block.match(/📝\s*(.*?)(?=\n|$)/s);
    if (titleMatch && urlMatch) {
      results.push({
        index,
        title: titleMatch[1].trim(),
        url: urlMatch[1].trim(),
        snippet: snippetMatch ? snippetMatch[1].trim() : '',
      });
    }
  }
  return results;
}

function parseContextResults(text: string): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const regex = /(?:^|\n)\s*(\d+)\.\s*(.*?):\s*["\u201c](.*?)["\u201d]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({
      index: parseInt(match[1]),
      title: match[2].trim(),
      url: '',
      snippet: match[3].trim(),
    });
  }
  return results;
}

function parseShellOutput(text: string): ShellOutputItem[] {
  const items: ShellOutputItem[] = [];
  const regex = /\$\s+(.+?)(?:\n(.*?)(?=\n\$|\n✅|\n❌|\n\n\n|\Z))/gs;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const output = match[2]?.trim() || '';
    items.push({
      command: match[1].trim(),
      output,
      success: !output.toLowerCase().startsWith('error'),
    });
  }
  return items;
}

// ─── Main Content Parser ──────────────────────────────────────────────────────

function parseContent(content: string): ParsedSegment[] {
  if (!content) return [];

  // Strip raw RAG source tags ([SOURCE N: ...] """ ... """) before parsing
  let cleaned = content.replace(/\[SOURCE\s+\d+:.*?\]/gi, '');
  cleaned = cleaned.replace(/""".*?"""/gs, '');

  const segments: ParsedSegment[] = [];
  let remaining = cleaned;

  // Try to extract search result blocks
  const searchMarkers = [
    /(?:^|\n)(✅\s*Found\s+\d+\s+results?\s+for\s+"[^"]*"(?:\s*via\s+\w+)?[\s\S]*?)(?=\n\n✅|\n\n\[|\n\nDOM\s+search|\n\n\$|\n\n$|\Z)/gm,
    /(?:^|\n)(🔍\s*LIVE\s+WEB\s+SEARCH[\s\S]*?)(?=\n\n🔍|\n\n✅|\n\n\[|\n\nDOM\s+search|\n\n\$|\Z)/gm,
    /(?:^|\n)(DOM\s+search\s+for\s+"[^"]*"\s+returned\s+\d+\s+results?:[\s\S]*?)(?=\n\n✅|\n\n\[|\n\nDOM\s+search|\n\n\$|\n\n$|\Z)/gm,
  ];

  const foundSearchBlocks: Array<{ start: number; end: number; text: string }> = [];

  for (const marker of searchMarkers) {
    let searchMatch;
    while ((searchMatch = marker.exec(content)) !== null) {
      const blockText = searchMatch[1].trim();
      const parsed = parseSearchResultsBlock(blockText);
      if (parsed && parsed.results.length > 0) {
        foundSearchBlocks.push({
          start: searchMatch.index + (searchMatch[0].indexOf(blockText) - (searchMatch[0].length - blockText.length)),
          end: searchMatch.index + searchMatch[0].length,
          text: blockText,
        });
      }
    }
  }

  // Try to extract shell output blocks
  const shellMarkers = /(?:^|\n)(?:\[(?:SHELL_COMMAND|OPEN_APP|CLICK_ELEMENT|CLICK_AT|FIND_AND_CLICK|FILL_FORM|DOM_SEARCH|OCR_SCREEN|SCREENSHOT_AND_ANALYZE|WEB_SEARCH|READ_PAGE_CONTENT)[^\]]*\]\n)?(\$\s+.+?)(?=\n\n\[|\n\n✅|\n\nDOM\s+search|\n\n\$\n|\Z)/gs;

  const foundShellBlocks: Array<{ start: number; end: number; text: string }> = [];
  let shellMatch;
  while ((shellMatch = shellMarkers.exec(content)) !== null) {
    const blockText = shellMatch[0].trim();
    const shellItems = parseShellOutput(blockText);
    if (shellItems.length > 0) {
      foundShellBlocks.push({
        start: shellMatch.index,
        end: shellMatch.index + shellMatch[0].length,
        text: blockText,
      });
    }
  }

  // Combine all found blocks and sort by position
  const allBlocks = [
    ...foundSearchBlocks.map(b => ({ ...b, type: 'search' as const })),
    ...foundShellBlocks.map(b => ({ ...b, type: 'shell' as const })),
  ].sort((a, b) => a.start - b.start);

  // Build segments from content
  let lastEnd = 0;
  for (const block of allBlocks) {
    if (block.start > lastEnd) {
      const textBetween = content.substring(lastEnd, block.start).trim();
      if (textBetween) {
        segments.push({ type: 'text', content: textBetween });
      }
    }

    if (block.type === 'search') {
      const parsed = parseSearchResultsBlock(block.text);
      if (parsed) {
        segments.push({
          type: 'search-results',
          searchQuery: parsed.query,
          searchResults: parsed.results,
          searchEngine: parsed.engine,
        });
      }
    } else if (block.type === 'shell') {
      const shellItems = parseShellOutput(block.text);
      if (shellItems.length > 0) {
        segments.push({ type: 'shell-output', shellItems });
      }
    }

    lastEnd = block.end;
  }

  // Remaining content
  if (lastEnd < content.length) {
    const remainingText = content.substring(lastEnd).trim();
    if (remainingText) {
      segments.push({ type: 'text', content: remainingText });
    }
  }

  // If no segments were found, treat entire content as text
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'text', content: content.trim() });
  }

  return segments;
}

// ─── Smart Markdown Renderer (enhanced with file path and URL awareness) ──────

// Re-exports for external use
export { URLCard, FilePathChip, SearchResultCard, SearchResultsBlock, ShellOutputCard, ShellOutputBlock };

// ─── Main Component ───────────────────────────────────────────────────────────

interface SmartMessageContentProps {
  content: string;
  animate?: boolean;
  renderText?: (text: string, animate: boolean) => React.ReactNode;
}

const SmartMessageContent = memo(function SmartMessageContent({
  content,
  animate = false,
  renderText,
}: SmartMessageContentProps) {
  const segments = useMemo(() => parseContent(content), [content]);

  if (segments.length === 0) return null;

  return (
    <div className="space-y-2">
      {segments.map((segment, idx) => {
        if (segment.type === 'search-results' && segment.searchResults) {
          return (
            <SearchResultsBlock
              key={`search-${idx}`}
              query={segment.searchQuery || ''}
              results={segment.searchResults}
              engine={segment.searchEngine}
            />
          );
        }

        if (segment.type === 'shell-output' && segment.shellItems) {
          return (
            <ShellOutputBlock
              key={`shell-${idx}`}
              items={segment.shellItems}
            />
          );
        }

        // Text segment - render via the provided renderer, with molecule support
        if (segment.content) {
          const MOLECULE_RE = /\[MOLECULE:([A-Za-z0-9@+\-\[\]\(\)\\\/=#$%.:]+)\]/g;
          const parts: React.ReactNode[] = [];
          let lastIdx = 0;
          let match;
          const content = segment.content;

          while ((match = MOLECULE_RE.exec(content)) !== null) {
            if (match.index > lastIdx) {
              const textBefore = content.substring(lastIdx, match.index);
              parts.push(
                <span key={`t-${lastIdx}`}>
                  {renderText
                    ? renderText(textBefore, false)
                    : textBefore}
                </span>
              );
            }
            parts.push(
              <MoleculeRenderer key={`m-${match.index}`} smiles={match[1]} />
            );
            lastIdx = match.index + match[0].length;
          }

          if (parts.length === 0) {
            return (
              <div key={`text-${idx}`}>
                {renderText
                  ? renderText(content, animate && idx === segments.length - 1)
                  : <span>{content}</span>}
              </div>
            );
          }

          if (lastIdx < content.length) {
            const textAfter = content.substring(lastIdx);
            parts.push(
              <span key={`t-${lastIdx}`}>
                {renderText
                  ? renderText(textAfter, animate && idx === segments.length - 1)
                  : textAfter}
              </span>
            );
          }

          return <div key={`text-${idx}`}>{parts}</div>;
        }

        return null;
      })}
    </div>
  );
});

export default memo(SmartMessageContent);
