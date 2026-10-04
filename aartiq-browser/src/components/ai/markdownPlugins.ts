import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import type { Options as ReactMarkdownOptions } from 'react-markdown';

type PluginList = NonNullable<ReactMarkdownOptions['remarkPlugins']>;

/**
 * Shared markdown pipeline for chat messages.
 *
 * `singleDollarTextMath` is deliberately off. Model prose routinely contains
 * currency — "a proposed $5,000 stimulus ... a $111 billion merger" — and with
 * single-dollar math enabled the text between the two `$` signs was parsed as
 * inline KaTeX: rendered italic, spaces collapsed. Block math (`$$…$$`) still
 * works; only the ambiguous single-`$` form is disabled.
 */
export const markdownRemarkPlugins: PluginList = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
  remarkBreaks,
];

export const markdownRehypePlugins: PluginList = [rehypeKatex];
