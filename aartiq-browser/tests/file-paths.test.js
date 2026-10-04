/**
 * Link vs. file-path parsing in chat messages (and OCR dumps).
 *
 * Two bugs are pinned here:
 *  1. Links were parsed as files: the pre-processor backticked the path tail
 *     of `https://example.com/page.html`, which then rendered as a file chip
 *     pointing at `//example.com/page.html`; the OCR line renderer carved
 *     `/page.html` out of `www.example.com/page.html` and chipified it too.
 *  2. File-path parsing was too weak: `~/…` lost its `~`, quoted paths with
 *     spaces were half-wrapped, relative paths like `src/lib/app.ts` were
 *     never detected, and fenced code blocks could be mutated.
 */

import React from 'react';
import ReactDOMServer from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import {
  looksLikeUrl,
  looksLikeFilePath,
  isClickableFilePath,
  preprocessFilePaths,
  tokenizeUrlsAndPaths,
} from '../src/components/ai/filePaths';
import {
  markdownRemarkPlugins,
  markdownRehypePlugins,
} from '../src/components/ai/markdownPlugins';

const render = (content) =>
  ReactDOMServer.renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      {
        remarkPlugins: markdownRemarkPlugins,
        rehypePlugins: markdownRehypePlugins,
      },
      content
    )
  );

describe('looksLikeUrl', () => {
  it('recognises scheme, file, protocol-relative and www links', () => {
    expect(looksLikeUrl('https://example.com/page.html')).toBe(true);
    expect(looksLikeUrl('file:///Users/me/report.pdf')).toBe(true);
    expect(looksLikeUrl('//cdn.example.com/app.js')).toBe(true);
    expect(looksLikeUrl('www.example.com/page.html')).toBe(true);
  });

  it('does not read Windows paths as URL schemes', () => {
    expect(looksLikeUrl('C:\\Users\\me\\report.pdf')).toBe(false);
    expect(looksLikeUrl('/etc/hosts')).toBe(false);
    expect(looksLikeUrl('')).toBe(false);
  });
});

describe('looksLikeFilePath / isClickableFilePath', () => {
  it('accepts absolute paths, including home-relative and drive paths', () => {
    [
      '/etc/hosts',
      '/Users/me/Documents/report.pdf',
      '~/Documents/notes.md',
      'C:\\Users\\me\\My Docs\\report.pdf',
    ].forEach((value) => {
      expect(looksLikeFilePath(value)).toBe(true);
      expect(isClickableFilePath(value)).toBe(true);
    });
  });

  it('accepts relative paths only when they name a file', () => {
    expect(looksLikeFilePath('src/components/App.tsx')).toBe(true);
    expect(looksLikeFilePath('./scripts/build.sh')).toBe(true);
    expect(looksLikeFilePath('../assets/logo.png')).toBe(true);
    // …and those stay non-clickable: an OS reveal needs an absolute path.
    expect(isClickableFilePath('src/components/App.tsx')).toBe(false);
  });

  it('rejects prose, branch names and bare links', () => {
    [
      'and/or',
      '5/8',
      'true/false',
      'origin/main',
      'example.com/page.html',
      'yes/no',
      '/etc',
      'file.txt',
      'git push --set-upstream origin main',
    ].forEach((value) => {
      expect(looksLikeFilePath(value)).toBe(false);
    });
  });

  it('rejects URLs so they can never become file chips', () => {
    [
      'https://example.com/page.html',
      'file:///Users/me/report.pdf',
      '//example.com/page.html',
      'www.example.com/page.html',
      'mailto:someone@example.com',
    ].forEach((value) => {
      expect(looksLikeFilePath(value)).toBe(false);
      expect(isClickableFilePath(value)).toBe(false);
    });
  });
});

describe('preprocessFilePaths', () => {
  it('leaves every flavour of link byte-for-byte untouched', () => {
    [
      'Read https://example.com/page.html for details.',
      'See [WSJ live news](https://www.wsj.com/news/live-news) for coverage.',
      'Local copy: file:///Users/me/report.pdf',
      'Bare link www.example.com/page.html works too.',
      'Asset //cdn.example.com/app.js loaded.',
      'Dated: https://example.com/2024/05/08/story.html.',
    ].forEach((text) => {
      expect(preprocessFilePaths(text)).toBe(text);
    });
  });

  it('wraps absolute, home-relative and drive paths', () => {
    expect(preprocessFilePaths('see /Users/me/Documents/report.pdf please')).toBe(
      'see `/Users/me/Documents/report.pdf` please'
    );
    expect(preprocessFilePaths('read ~/Documents/notes.md now')).toBe(
      'read `~/Documents/notes.md` now'
    );
    expect(preprocessFilePaths('open C:\\Users\\me\\report.pdf today')).toBe(
      'open `C:\\Users\\me\\report.pdf` today'
    );
    expect(preprocessFilePaths('C:\\Users\\me\\My Docs\\report.pdf')).toBe(
      '`C:\\Users\\me\\My Docs\\report.pdf`'
    );
  });

  it('keeps a quoted path with spaces whole, quotes outside the backticks', () => {
    expect(preprocessFilePaths('saved "/Users/me/My Documents/Quarterly Report.pdf" ok')).toBe(
      'saved "`/Users/me/My Documents/Quarterly Report.pdf`" ok'
    );
  });

  it('wraps relative paths that name a file', () => {
    expect(preprocessFilePaths('edit src/components/App.tsx')).toBe(
      'edit `src/components/App.tsx`'
    );
    expect(preprocessFilePaths('run ./scripts/build.sh')).toBe('run `./scripts/build.sh`');
  });

  it('leaves prose that merely contains a slash alone', () => {
    ['yes/no', 'and/or', '5/8', 'origin/main', 'true/false'].forEach((fragment) => {
      expect(preprocessFilePaths(`decide ${fragment} today`)).toBe(`decide ${fragment} today`);
    });
  });

  it('never edits code blocks, inline code or link destinations', () => {
    const fenced = 'Run this:\n```\nimport x from "./src/App.tsx";\nconst p = "/Users/me/file.txt";\n```';
    expect(preprocessFilePaths(fenced)).toBe(fenced);

    const inline = 'use `./scripts/build.sh` to build';
    expect(preprocessFilePaths(inline)).toBe(inline);

    const image = '![diagram](/docs/architecture.png)';
    expect(preprocessFilePaths(image)).toBe(image);
  });

  it('trims trailing sentence punctuation out of the chip', () => {
    expect(preprocessFilePaths('see /etc/hosts.')).toBe('see `/etc/hosts`.');
    expect(preprocessFilePaths('see (/etc/hosts)')).toBe('see (`/etc/hosts`)');
  });

  it('is idempotent', () => {
    const text = 'a /Users/me/x.txt and "~/My Docs/y.txt" at https://a.com/b.html.';
    const once = preprocessFilePaths(text);
    expect(once).not.toBe(text);
    expect(preprocessFilePaths(once)).toBe(once);
  });

  it('handles a realistic search-result message end to end', () => {
    const text = [
      '**Sources:**',
      '1. [WSJ Archive: Latest News](https://www.wsj.com/news/live-news)',
      '2. https://example.com/2024/05/08/story.html',
      '',
      'Saved to "/Users/sandip/My Documents/news digest.pdf".',
    ].join('\n');
    const out = preprocessFilePaths(text);

    expect(out).toContain('[WSJ Archive: Latest News](https://www.wsj.com/news/live-news)');
    expect(out).toContain('https://example.com/2024/05/08/story.html');
    expect(out).toContain('"`/Users/sandip/My Documents/news digest.pdf`"');
  });
});

describe('tokenizeUrlsAndPaths', () => {
  const valuesOf = (line) =>
    tokenizeUrlsAndPaths(line).map((token) => token.value).join('');

  it('round-trips the input exactly', () => {
    [
      '1. WSJ Archive - https://www.wsj.com/news/live-news',
      'see /Users/me/report.pdf and www.example.com/page.html',
      'file:///Users/me/report.pdf, //cdn.example.com/app.js',
      'plain prose with no links or paths at all',
      'C:\\Users\\me\\My Docs\\report.pdf next to 5/8',
      '',
    ].forEach((line) => {
      expect(valuesOf(line)).toBe(line);
    });
  });

  it('classifies urls, paths and text', () => {
    const tokens = tokenizeUrlsAndPaths('read /Users/me/a.pdf at https://x.com/b.html');
    expect(tokens.filter((t) => t.kind === 'url').map((t) => t.value)).toEqual([
      'https://x.com/b.html',
    ]);
    expect(tokens.filter((t) => t.kind === 'path').map((t) => t.value)).toEqual([
      '/Users/me/a.pdf',
    ]);
  });

  it('never emits a path carved out of a link', () => {
    const tokens = tokenizeUrlsAndPaths(
      'https://example.com/page.html www.example.com/page.html //cdn.example.com/a.js'
    );
    expect(tokens.filter((t) => t.kind === 'path')).toEqual([]);
    expect(tokens.filter((t) => t.kind === 'url').map((t) => t.value)).toEqual([
      'https://example.com/page.html',
      'www.example.com/page.html',
      '//cdn.example.com/a.js',
    ]);
  });

  it('recognises file:// links as urls, not paths', () => {
    const tokens = tokenizeUrlsAndPaths('file:///Users/me/report.pdf');
    expect(tokens.map((t) => t.kind)).toEqual(['url']);
    expect(tokens[0].value).toBe('file:///Users/me/report.pdf');
  });

  it('keeps relative paths and prose slashes as plain text', () => {
    const tokens = tokenizeUrlsAndPaths('origin/main and 5/8 are not paths');
    expect(tokens.filter((t) => t.kind !== 'text')).toEqual([]);
  });
});

describe('rendered messages', () => {
  it('keeps links as links, never as file chips', () => {
    const html = render(preprocessFilePaths('Full text: https://example.com/page.html done'));
    expect(html).toContain('<a href="https://example.com/page.html"');
    // A file chip is keyed off inline code — the URL must never reach one.
    expect(html).not.toContain('<code');
  });

  it('renders file paths as inline code, which the chat sidebar turns into a chip', () => {
    const html = render(preprocessFilePaths('saved to /Users/me/Documents/report.pdf'));
    expect(html).toContain('<code>/Users/me/Documents/report.pdf</code>');
    expect(html).not.toContain('<a ');
  });
});
