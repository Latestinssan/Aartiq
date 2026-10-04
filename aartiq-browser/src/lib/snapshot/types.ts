/**
 * Snapshot types — a compact, ref-indexed accessibility tree for AI agents.
 * Inspired by agent-browser / Playwright MCP: refs are identity-bound (stable
 * per backend node, never reused within a page) so a remembered ref keeps
 * meaning the same element across re-snapshots.
 *
 * Refs are only useful if they can be turned back into a live element. Two
 * identity channels are supported, in priority order:
 *   1. `backendNodeId` — a real CDP node id. Present when the host resolves the
 *      tree through the debugger.
 *   2. `axId` — an `AX_MARKER_ATTR` stamp the collector writes onto the element
 *      itself, so a pure-JS traversal can still hand an element back to a later
 *      `executeJavaScript` call. This is what the default in-process page
 *      adapter uses, because `webContents.executeJavaScript` alone cannot
 *      address a DOM node it visited in an earlier call.
 *
 * A node with neither is structural: it appears in the tree but is refused by
 * the action tools, loudly, rather than silently actuating a neighbour.
 */

export type AxRole = string;

export interface RawAxNode {
  role: AxRole;
  name?: string;
  value?: string;
  description?: string;
  states?: string[];
  attributes?: Record<string, string>;
  backendNodeId?: string | number;
  /** Stamp written by the collector so the node can be re-addressed later. */
  axId?: string;
  selector?: string;
  href?: string;
  children?: RawAxNode[];
}

export interface SnapshotNode {
  ref: string;
  role: AxRole;
  name: string;
  value?: string;
  description?: string;
  href?: string;
  interactive: boolean;
  /** True when this node can actually be actuated (has a live handle). */
  actionable: boolean;
  depth: number;
  backendNodeId?: string | number;
  axId?: string;
  selector?: string;
  children: SnapshotNode[];
}

export interface SnapshotOptions {
  interactiveOnly?: boolean;
  compact?: boolean;
  depth?: number;
  scopeSelector?: string;
  /** Cap the number of nodes returned. Excess siblings are dropped. */
  maxNodes?: number;
}

export interface SnapshotResult {
  nodes: SnapshotNode[];
  refs: Record<string, SnapshotNode>;
  text: string;
}

/** A single hit from a single-page (no network) search. */
export interface PageSearchMatch {
  ref: string;
  role: string;
  name: string;
  value?: string;
  href?: string;
  /** Which field produced the hit. */
  field: 'name' | 'value' | 'href' | 'role';
  /** Text around the hit, for the caller to disambiguate. */
  context?: string;
}

export interface PageSearchOptions {
  /** Case-insensitive literal substring. */
  query: string;
  /** Restrict to nodes with this role (case-insensitive). */
  role?: string;
  /** Only nodes that can be actuated. */
  actionableOnly?: boolean;
  /** Restrict to a CSS subtree before matching. */
  scopeSelector?: string;
  limit?: number;
  /** Field to search. Defaults to name+value+href+role. */
  in?: ('name' | 'value' | 'href' | 'role')[];
}
