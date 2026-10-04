/**
 * Chat markdown rendering (BUG 1: dollar signs shown as LaTeX math).
 *
 * The model writes plain prose that contains currency — "a proposed $5,000
 * stimulus ... a $111 billion merger". The chat pipeline still runs remark-math,
 * so if single-dollar inline math is enabled the text between the two dollar
 * signs is swallowed by KaTeX and rendered as italic math with collapsed
 * spaces. The shared plugin config must keep $…$ as literal text while still
 * rendering $$…$$ block math.
 */

import React from 'react';
import ReactDOMServer from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import {
  markdownRemarkPlugins,
  markdownRehypePlugins,
} from '../src/components/ai/markdownPlugins';

function render(content) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(ReactMarkdown, {
      remarkPlugins: markdownRemarkPlugins,
      rehypePlugins: markdownRehypePlugins,
    }, content)
  );
}

describe('currency in chat markdown', () => {
  it('renders "$5,000 and $111 billion" as plain text', () => {
    const html = render('Congress proposed a $5,000 stimulus and a $111 billion media merger today.');

    expect(html).toContain('$5,000');
    expect(html).toContain('$111');
    // No KaTeX output: the span would mean the dollars were parsed as math.
    expect(html).not.toContain('katex');
    expect(html).not.toContain('<em>');
    // The words between the dollars survive with their spaces.
    expect(html).toContain('stimulus and a');
  });

  it('keeps both dollar amounts when they span a whole sentence', () => {
    const html = render('a proposed $5,000 stimulus ... a $111 billion media merger');

    expect(html).toContain('a proposed $5,000 stimulus ... a $111 billion media merger');
    expect(html).not.toContain('katex');
  });

  it('still renders $$…$$ as math', () => {
    const html = render('Euler: $$e^{i\\pi} + 1 = 0$$');

    expect(html).toContain('katex');
  });
});
