"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
