/**
 * Models (and some providers) wrap source links in full-width brackets:
 * 【https://example.com/page】. Markdown renders those literally, and a bare URL
 * glued to 】 either is not linkified at all or is linkified with the bracket
 * character appended to the href. Convert them to a normal markdown link with
 * the domain as the label before rendering.
 */

const CITATION_LINK_RE = /【\s*(https?:\/\/[^\s【】]+)\s*】/g;

function labelFor(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    if (hostname) return hostname;
  } catch {
    // Fall through: an unparseable URL still deserves its own text as label.
  }
  return url;
}

export function normalizeCitationLinks(text: string): string {
  if (!text || text.indexOf('【') === -1) return text;
  // Replace only the bracket pair; the URL itself is copied verbatim, so no
  // spaces or other characters are ever inserted into it.
  return text.replace(CITATION_LINK_RE, (_match, url: string) => `[${labelFor(url)}](${url})`);
}
