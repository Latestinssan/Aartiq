import React, { useState, memo, useMemo, useCallback } from 'react';
import { ChevronDown, Search, FileText, Globe, Camera, Terminal, ExternalLink, Folder } from 'lucide-react';
import { tokenizeUrlsAndPaths } from './filePaths';
import { useAppStore } from '@/store/useAppStore';

interface CollapsibleOCRMessageProps {
  label: string;
  content: string;
}

const LABEL_CONFIG: Record<string, { icon: React.ReactNode; color: string; bgColor: string; text: string }> = {
  SEARCH_PAGE_DOM:       { icon: <Search size={11} />,   color: 'text-sky-400',    bgColor: 'border-sky-500/10 bg-sky-500/[0.03]', text: 'Search Results' },
  WEB_SEARCH_FALLBACK_OCR: { icon: <Search size={11} />, color: 'text-sky-400',    bgColor: 'border-sky-500/10 bg-sky-500/[0.03]', text: 'Search (OCR)' },
  PAGE_CONTENT:          { icon: <FileText size={11} />,  color: 'text-emerald-400', bgColor: 'border-emerald-500/10 bg-emerald-500/[0.03]', text: 'Page Content' },
  SCREENSHOT_ANALYSIS:   { icon: <Camera size={11} />,    color: 'text-purple-400', bgColor: 'border-purple-500/10 bg-purple-500/[0.03]', text: 'Screenshot' },
  DOM_CONTENT:           { icon: <Terminal size={11} />,  color: 'text-amber-400',  bgColor: 'border-amber-500/10 bg-amber-500/[0.03]', text: 'DOM Content' },
  DOM_EXTRACTED:         { icon: <Terminal size={11} />,  color: 'text-amber-400',  bgColor: 'border-amber-500/10 bg-amber-500/[0.03]', text: 'DOM Content' },
  DOM_SEARCH:            { icon: <Search size={11} />,    color: 'text-sky-400',    bgColor: 'border-sky-500/10 bg-sky-500/[0.03]', text: 'DOM Search' },
  WEB_SEARCH_RESULTS:    { icon: <Search size={11} />,    color: 'text-sky-400',    bgColor: 'border-sky-500/10 bg-sky-500/[0.03]', text: 'Search Results' },
};

/** Normalise the shapes a link can arrive in (scheme, `//host`, `www.`) to an absolute URL. */
function absoluteUrl(raw: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  return `https://${raw}`;
}

function renderContentLine(line: string, key: number): React.ReactNode {
  // Shared tokenizer: URLs are never mis-read as file paths (a link ending in
  // `.html` used to be split at `/page.html` and rendered as a file chip).
  const tokens = tokenizeUrlsAndPaths(line);
  if (tokens.length === 0) return line;

  return tokens.map((token, i) => {
    if (token.kind === 'url') {
      const url = absoluteUrl(token.value);
      let hostname = '';
      let favicon = '';
      try {
        const parsed = new URL(url);
        hostname = parsed.hostname.replace(/^www\./, '');
        favicon = `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`;
      } catch { /* ignore */ }

      const openURL = (e: React.MouseEvent) => {
        e.preventDefault();
        try {
          // addTab creates the store entry *and* its BrowserView under one id.
          // A bare createView would spawn an orphan view no tab ever closes.
          useAppStore.getState().addTab(url, 'ai-session');
        } catch {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      };

      return (
        <span key={`u-${key}-${i}`} className="group/ocr-url relative inline-flex items-center gap-1 rounded bg-sky-500/10 px-1 cursor-pointer hover:bg-sky-500/20 transition-colors align-bottom">
          {favicon && (
            <img src={favicon} alt="" className="h-3 w-3 shrink-0 rounded-sm"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <span className="text-sky-300 text-[11px] underline decoration-sky-400/30 underline-offset-2" onClick={openURL}>
            {hostname || token.value}
          </span>
          <ExternalLink size={9} className="text-white/20 shrink-0" />
          <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 max-w-[400px] rounded-lg border border-white/10 bg-[#1a1a2e]/95 px-3 py-2 text-[10px] opacity-0 shadow-2xl backdrop-blur-xl transition-all duration-200 group-hover/ocr-url:opacity-100">
            <span className="block text-white/80 break-all">{url}</span>
          </span>
        </span>
      );
    }

    if (token.kind === 'path') {
      const value = token.value;
      const segments = value.split(/[/\\]/);
      const fileName = segments[segments.length - 1] || value;
      const isDir = !/\.[a-zA-Z0-9]{1,10}$/.test(value);

      const openPath = (e: React.MouseEvent) => {
        e.preventDefault();
        window.electronAPI?.showItemInFolder?.(value);
      };

      return (
        <span key={`f-${key}-${i}`} className="group/ocr-path relative inline-flex items-center gap-1 rounded bg-white/[0.06] px-1 cursor-pointer hover:bg-sky-500/10 transition-colors align-bottom">
          {isDir ? <Folder size={10} className="text-sky-400/70 shrink-0" /> : <FileText size={10} className="text-emerald-400/70 shrink-0" />}
          <span className="text-sky-300 text-[11px] font-mono" onClick={openPath}>{fileName}</span>
          <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 max-w-[500px] rounded-lg border border-white/10 bg-[#1a1a2e]/95 px-3 py-2 text-[10px] text-white/80 shadow-2xl backdrop-blur-xl whitespace-nowrap font-mono opacity-0 group-hover/ocr-path:opacity-100 transition-opacity">
            {value}
          </span>
        </span>
      );
    }

    return token.value ? <span key={`t-${key}-${i}`}>{token.value}</span> : null;
  });
}

const CollapsibleOCRMessage = memo(function CollapsibleOCRMessage({
  label,
  content,
}: CollapsibleOCRMessageProps) {
  const [open, setOpen] = useState(false);
  const config = LABEL_CONFIG[label] || { icon: <Globe size={11} />, color: 'text-white/50', bgColor: 'border-white/10 bg-white/[0.02]', text: label };

  const lines = useMemo(() => content.split('\n'), [content]);
  const preview = useMemo(() => {
    const text = content.substring(0, 140).replace(/\n/g, ' ').trim();
    return text.length > 100 ? text.substring(0, 100) + '...' : text;
  }, [content]);

  const lineCount = lines.length;

  return (
    <div className={`w-full mt-1.5 rounded-xl border overflow-hidden ${config.bgColor}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-[11px] hover:bg-white/[0.03] transition-colors"
      >
        <ChevronDown
          size={12}
          className={`text-white/30 transition-transform duration-200 ease-out shrink-0 ${open ? 'rotate-180' : ''}`}
        />
        <span className={config.color}>{config.icon}</span>
        <span className="text-white/50 font-medium shrink-0">{config.text}</span>
        {!open && (
          <span className="text-white/20 truncate ml-1 flex-1 text-left">{preview}</span>
        )}
        <span className="text-white/15 ml-auto shrink-0 text-[9px]">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 max-h-[400px] overflow-y-auto modern-scrollbar border-t border-white/[0.04]">
          <div className="pt-2 space-y-0">
            {lines.map((line, i) => (
              <div key={i} className="text-[11px] text-white/45 leading-relaxed font-mono whitespace-pre-wrap break-words">
                {line.trim() ? renderContentLine(line, i) : '\u00A0'}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export default CollapsibleOCRMessage;
