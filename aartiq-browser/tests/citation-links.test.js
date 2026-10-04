/**
 * Source links in chat (BUG 3: links wrapped in 【】 are not clickable).
 *
 * The model emits citations like 【https://example.com/page】. Rendered raw,
 * markdown shows the brackets literally and either refuses to linkify the URL
 * or links it together with the 】 character. The pre-render normalizer must
 * turn them into a standard markdown link whose href is byte-identical to the
 * original URL.
 */

import React from 'react';
import ReactDOMServer from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { normalizeCitationLinks } from '../src/components/ai/normalizeCitationLinks';
import {
  markdownRemarkPlugins,
  markdownRehypePlugins,
} from '../src/components/ai/markdownPlugins';

function render(content) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(ReactMarkdown, {
      remarkPlugins: markdownRemarkPlugins,
      rehypePlugins: markdownRehypePlugins,
    }, normalizeCitationLinks(content))
  );
}

describe('normalizeCitationLinks', () => {
  it('converts 【url】 into a markdown link labelled with the domain', () => {
    const out = normalizeCitationLinks('See 【https://example.com/page】 for details.');
    expect(out).toBe('See [example.com](https://example.com/page) for details.');
  });

  it('copies the URL verbatim — no spaces or other edits', () => {
    const url = 'https://example.com/a/b?x=1&y=2#frag';
    const out = normalizeCitationLinks(`【${url}】`);
    expect(out).toBe(`[example.com](${url})`);
    expect(out).not.toMatch(/\s/);
  });

  it('handles several citations in one message', () => {
    const out = normalizeCitationLinks(
      'Sources: 【https://www.wsj.com/live-news】 and 【https://apnews.com/hub/latest-news】.'
    );
    expect(out).toContain('[wsj.com](https://www.wsj.com/live-news)');
    expect(out).toContain('[apnews.com](https://apnews.com/hub/latest-news)');
    expect(out).not.toContain('【');
  });

  it('leaves non-URL brackets and plain text untouched', () => {
    expect(normalizeCitationLinks('【IMPORTANT】 note')).toBe('【IMPORTANT】 note');
    expect(normalizeCitationLinks('no citations here')).toBe('no citations here');
    expect(normalizeCitationLinks('')).toBe('');
  });

  it('is idempotent for already-normalized links', () => {
    const once = normalizeCitationLinks('【https://example.com/x】');
    expect(normalizeCitationLinks(once)).toBe(once);
  });
});

describe('rendered citation links', () => {
  it('produces a real <a> whose href is exactly the model URL', () => {
    const url = 'https://example.com/page?ref=1&n=2';
    // React escapes & as &amp; in attributes; undo that before comparing.
    const html = render(`Full text: 【${url}】 done`).replace(/&amp;/g, '&');

    expect(html).not.toContain('【');
    expect(html).not.toContain('】');
    expect(html).toContain(`<a href="${url}"`);
    expect(html).toContain('>example.com<');
  });

  it('does not glue the closing bracket into the href', () => {
    const html = render('Read 【https://example.com/story】 now');

    expect(html).not.toContain('%E3%80%91'); // 】 percent-encoded in href
    expect(html).not.toMatch(/href="[^"]*】/);
  });
});
