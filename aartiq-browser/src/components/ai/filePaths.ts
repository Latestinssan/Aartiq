/**
 * Shared parsing for the two token types model output constantly mixes up:
 * web links and filesystem paths.
 *
 * Two rules drive everything here:
 *
 *  1. A URL is never a file path. `https://example.com/page.html` used to have
 *     its `/page.html` tail backticked by the message pre-processor, which then
 *     rendered it as a "file" chip pointing at `//example.com/page.html`.
 *     Scheme URLs, protocol-relative `//host/...` and `www.` links are all
 *     protected before any path scanning happens.
 *
 *  2. A path only becomes a chip when it is unambiguous: absolute (`/`,
 *     `~/`), drive-letter (`C:\`), or relative *with a file extension*.
 *     Prose like "and/or", "5/8", "origin/main" or "e.g. see below" must stay
 *     plain text.
 */

export interface LinkToken {
  kind: 'url' | 'path' | 'text';
  value: string;
}

interface Span {
  start: number;
  end: number;
}

/** `scheme://…`, protocol-relative `//host/…`, and `www.…` links. */
const URL_RE =
  /(?<![\w/])[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s<>"'`)\]},]+|(?<![\w/])\/\/(?=[a-z0-9-]+(?:\.[a-z0-9-]+)+)[^\s<>"'`)\]},]+|(?<![\w@.])www\.[^\s<>"'`)\]},]+/g;

/**
 * Regions the path scanner must never touch: fenced code blocks, inline code,
 * markdown link/image destinations (`](…)`), and URLs.
 */
const PROTECTED_RE = new RegExp(
  [
    '```[\\s\\S]*?(?:```|$)',
    '~~~[\\s\\S]*?(?:~~~|$)',
    '``[\\s\\S]*?``',
    '`[^`\\n]*`',
    '\\]\\([^)\\n]*\\)',
    URL_RE.source,
  ].join('|'),
  'g'
);

/**
 * Bare (unquoted) path candidates. Trailing sentence punctuation is trimmed by
 * the caller before validation.
 */
const BARE_PATH_RE =
  /(?<![\w./\\~=`'"<:{@])(?:~?\/[^\s*"`<>']+|[A-Za-z]:\\[^\s*"`<>']+(?:\s+[^\s*"`<>]*\\[^\s*"`<>']+)*|[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+)(?=[\s.,;:!?)\]}*'`]|$)/g;

/** Quoted paths, which may contain spaces: `"/Users/Me/My Docs/a.txt"`. */
const QUOTED_PATH_RE =
  /(?<![\w=~])(["'])(~?\/[^"'`\n]+?|[A-Za-z]:\\[^"'`\n]+?)(?<!\\)\1/g;

/** Trailing sentence punctuation that never belongs to the path itself. */
function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?*)\]}]+$/, '');
}

function hasExtension(value: string): boolean {
  return /\.[A-Za-z0-9]{1,15}$/.test(value);
}

function overlapsAny(spans: Span[], start: number, end: number): boolean {
  return spans.some((s) => start < s.end && end > s.start);
}

function findSpans(pattern: RegExp, text: string): Span[] {
  const scanner = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const spans: Span[] = [];
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(text)) !== null) {
    if (match[0].length === 0) {
      scanner.lastIndex += 1;
      continue;
    }
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/** Run `pattern` over `text`, replacing only matches outside `spans`. */
function replaceOutsideSpans(
  text: string,
  spans: Span[],
  pattern: RegExp,
  replacer: (match: RegExpExecArray) => string
): string {
  const scanner = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(text)) !== null) {
    if (match[0].length === 0) {
      scanner.lastIndex += 1;
      continue;
    }
    const start = match.index;
    const end = start + match[0].length;
    if (overlapsAny(spans, start, end)) continue;
    out += text.slice(last, start) + replacer(match);
    last = end;
  }
  return out + text.slice(last);
}

/** True for web links — including scheme-less ones — that are never paths. */
export function looksLikeUrl(value: string): boolean {
  const v = (value || '').trim();
  if (!v) return false;
  // The `//` requirement keeps `C:\Users` from being read as a scheme.
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || v.startsWith('//') || /^www\./i.test(v);
}

/**
 * True for values that name a filesystem location rather than prose or a URL.
 * Relative paths count (they render as inline code); use
 * `isClickableFilePath` when the value will be handed to the OS.
 */
export function looksLikeFilePath(value: string): boolean {
  const v = (value || '').trim();
  if (!v || v.length > 512 || /[\n\r]/.test(v) || looksLikeUrl(v)) return false;

  // Absolute POSIX: `/etc/hosts` (multi-segment) or `/report.pdf` (one
  // segment, but a real file name). `/etc` alone stays plain text.
  if (v.startsWith('/')) {
    const segments = v.split('/').filter(Boolean);
    return segments.length >= 2 || (segments.length === 1 && hasExtension(v));
  }

  // Home-relative: evaluate the part after `~/` with the same rules.
  if (v.startsWith('~/')) {
    const segments = v.slice(2).split('/').filter(Boolean);
    return segments.length >= 2 || (segments.length === 1 && hasExtension(v));
  }

  // Windows drive path. Spaces are allowed here (`C:\My Docs\a.txt`) because
  // the drive prefix is unambiguous, but shell metacharacters are not.
  if (/^[A-Za-z]:[\\/]/.test(v)) {
    if (v.length <= 3) return false; // "C:\" alone is not a location
    const body = v.slice(3);
    if (/[<>:"|?*]/.test(body)) return false;
    return body.includes('\\') || body.includes('/') || hasExtension(body);
  }

  // Relative path: needs a separator, no whitespace/colon, and a file
  // extension — so "and/or", "5/8" and "origin/main" are all rejected.
  if (/[\s:]/.test(v) || !/[/\\]/.test(v) || !hasExtension(v)) return false;
  const segments = v.split(/[/\\]/).filter(Boolean);
  if (segments.length < 2) return false;
  const first = segments[0];
  // "example.com/page.html" is a bare link, not a path.
  if (first.includes('.') && first !== '.' && first !== '..') return false;
  return true;
}

/**
 * True only for paths an OS call can actually open (absolute location), so
 * relative paths render as inline code instead of a chip with a dead click.
 */
export function isClickableFilePath(value: string): boolean {
  const v = (value || '').trim();
  if (!looksLikeFilePath(v)) return false;
  return v.startsWith('/') || v.startsWith('~/') || /^[A-Za-z]:[\\/]/.test(v);
}

/**
 * Wrap bare file paths in backticks so the markdown renderer can detect them.
 * Code blocks, inline code, markdown link destinations and URLs are left
 * byte-for-byte untouched.
 */
export function preprocessFilePaths(text: string): string {
  if (!text || (!text.includes('/') && !text.includes('\\'))) return text;

  const protectedSpans = findSpans(PROTECTED_RE, text);
  const afterBare = replaceOutsideSpans(text, protectedSpans, BARE_PATH_RE, (match) => {
    const candidate = stripTrailingPunctuation(match[0]);
    if (!candidate || !looksLikeFilePath(candidate)) return match[0];
    return `\`${candidate}\`${match[0].slice(candidate.length)}`;
  });

  const protectedAgain = findSpans(PROTECTED_RE, afterBare);
  return replaceOutsideSpans(afterBare, protectedAgain, QUOTED_PATH_RE, (match) => {
    const [quote, inner] = [match[1], match[2]];
    if (!looksLikeFilePath(inner)) return match[0];
    return `${quote}\`${inner}\`${quote}`;
  });
}

/**
 * Split a single line into url / path / text tokens. Concatenating the token
 * values reproduces the input exactly, so renderers can linkify the url and
 * path tokens without losing a character of the original text.
 */
export function tokenizeUrlsAndPaths(line: string): LinkToken[] {
  if (!line) return [];

  const urlSpans: Span[] = findSpans(URL_RE, line)
    .map((span) => {
      const trimmed = stripTrailingPunctuation(line.slice(span.start, span.end));
      return { start: span.start, end: span.start + trimmed.length };
    })
    .filter((span) => span.end > span.start);

  const pathSpans: Span[] = [];
  const scanner = new RegExp(BARE_PATH_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(line)) !== null) {
    if (match[0].length === 0) {
      scanner.lastIndex += 1;
      continue;
    }
    const start = match.index;
    if (overlapsAny(urlSpans, start, start + match[0].length)) continue;
    const candidate = stripTrailingPunctuation(match[0]);
    if (!candidate || !isClickableFilePath(candidate)) continue;
    pathSpans.push({ start, end: start + candidate.length });
  }

  const spans = [
    ...urlSpans.map((span) => ({ ...span, kind: 'url' as const })),
    ...pathSpans.map((span) => ({ ...span, kind: 'path' as const })),
  ].sort((a, b) => a.start - b.start || b.end - a.end);

  const tokens: LinkToken[] = [];
  let last = 0;
  for (const span of spans) {
    if (span.start < last) continue;
    if (span.start > last) tokens.push({ kind: 'text', value: line.slice(last, span.start) });
    if (span.end > span.start) tokens.push({ kind: span.kind, value: line.slice(span.start, span.end) });
    last = span.end;
  }
  if (last < line.length) tokens.push({ kind: 'text', value: line.slice(last) });
  return tokens;
}
