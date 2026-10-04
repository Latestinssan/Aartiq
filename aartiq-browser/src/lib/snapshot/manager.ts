/**
 * SnapshotManager — builds a compact, ref-indexed accessibility tree.
 *
 * Refs are identity-bound to a `backendNodeId` when present, otherwise to the
 * `axId` stamp the collector wrote onto the element. On each snapshot the
 * previous generation is retired; surviving nodes reclaim their original ref,
 * new nodes get fresh numbers, and numbers are never reused within a page. A ref
 * whose node left the DOM fails loudly ("stale ref") instead of silently
 * actuating a neighbour. Navigation / full reload clears the map entirely.
 *
 * Actionability is explicit. `actionable` means "this node carries a handle we
 * can re-address from a later script execution" — a backendNodeId or an axId
 * stamp. The action tools refuse anything else rather than guessing.
 */

import type {
  RawAxNode, SnapshotNode, SnapshotOptions, SnapshotResult,
  PageSearchMatch, PageSearchOptions,
} from './types';

/**
 * Attribute the collector stamps onto elements so a later `executeJavaScript`
 * can find them again. Namespaced to avoid colliding with page code.
 */
export const AX_MARKER_ATTR = 'data-aartiq-ax';

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'slider',
  'menuitem', 'tab', 'switch', 'spinbutton', 'listbox', 'option', 'treeitem',
]);

function isInteractive(node: RawAxNode): boolean {
  if (INTERACTIVE_ROLES.has(node.role?.toLowerCase?.() ?? '')) return true;
  const tag = node.attributes?.tag;
  const type = node.attributes?.type;
  if (tag === 'a' && node.href) return true;
  if (tag === 'input' && type && !['hidden', 'submit', 'button', 'file', 'image'].includes(type)) return true;
  if (tag === 'textarea' || tag === 'select') return true;
  if (node.attributes?.contenteditable === 'true') return true;
  return false;
}

export class SnapshotManager {
  private refByNode = new Map<string, string>();
  private nextNum = 1;
  private usedRefs = new Set<string>();
  private lastResult: SnapshotResult | null = null;

  /** Stable identity for a node. Returns null when the node carries no handle. */
  private identityOf(node: RawAxNode): string | null {
    if (node.backendNodeId != null) return `bn:${node.backendNodeId}`;
    if (node.axId) return `ax:${node.axId}`;
    return null;
  }

  /** Map a node to a stable ref, minting a new one if needed. */
  private refFor(node: RawAxNode, identity: string | null): string {
    // Without a handle we cannot key on identity, so fall back to a structural
    // description. Such refs are minted but never actionable, so a collision can
    // never cause a wrong element to be actuated.
    const key = identity ?? `sel:${node.selector ?? ''}:${node.role}:${node.name ?? ''}`;
    const existing = this.refByNode.get(key);
    if (existing) return existing;
    let ref: string;
    do {
      ref = `e${this.nextNum++}`;
    } while (this.usedRefs.has(ref));
    this.usedRefs.add(ref);
    this.refByNode.set(key, ref);
    return ref;
  }

  /** Drop all refs (call on navigation / reload). */
  reset(): void {
    this.refByNode.clear();
    this.usedRefs.clear();
    this.lastResult = null;
    this.nextNum = 1;
  }

  build(rawRoots: RawAxNode[], options: SnapshotOptions = {}): SnapshotResult {
    const refs: Record<string, SnapshotNode> = {};
    const nodes: SnapshotNode[] = [];
    let budget = options.maxNodes ?? Infinity;

    const scopeMatch = (node: RawAxNode): boolean => {
      if (!options.scopeSelector) return true;
      return node.selector === options.scopeSelector || !!node.attributes?.scopeMatched;
    };

    const visit = (raw: RawAxNode, depth: number): SnapshotNode | null => {
      if (budget <= 0) return null;
      budget--;

      const interactive = isInteractive(raw);
      const identity = this.identityOf(raw);
      const node: SnapshotNode = {
        ref: this.refFor(raw, identity),
        role: raw.role,
        name: raw.name ?? '',
        value: raw.value,
        description: raw.description,
        href: raw.href,
        interactive,
        actionable: identity !== null,
        depth,
        backendNodeId: raw.backendNodeId,
        axId: raw.axId,
        selector: raw.selector,
        children: [],
      };

      // Depth is checked *before* recursing, so `depth: n` yields levels 0..n and
      // nothing deeper. Pruning afterwards would still walk the whole subtree —
      // paying the node budget and minting refs the caller never receives, which
      // is exactly the cost `depth` exists to avoid.
      const atLimit = options.depth != null && depth >= options.depth;
      const children = atLimit
        ? []
        : (raw.children ?? [])
          .map((c) => visit(c, depth + 1))
          .filter((c): c is SnapshotNode => c !== null);

      // Compact: drop empty structural nodes (no name, no interactive children).
      const hasContent = node.name || interactive || children.some((c) => c.interactive || c.name);
      if (options.compact && !hasContent && !interactive) {
        // Promote children to this position.
        for (const c of children) node.children.push(c);
      } else {
        node.children = children;
      }

      if (options.interactiveOnly && !interactive && node.children.length === 0) {
        return null;
      }
      if (!scopeMatch(raw) && node.children.length === 0) {
        return null;
      }

      refs[node.ref] = node;
      return node;
    };

    for (const root of rawRoots) {
      const n = visit(root, 0);
      if (n) nodes.push(n);
    }

    const result: SnapshotResult = { nodes, refs, text: '' };
    result.text = this.render(nodes, options);
    this.lastResult = result;
    return result;
  }

  /** The most recently built snapshot, if any. */
  getLastResult(): SnapshotResult | null {
    return this.lastResult;
  }

  /**
   * Turn a ref back into a live handle. Throws rather than guessing:
   *  - unknown ref           → the caller never snapshotted, or reset happened
   *  - ref gone from the map → the node left the DOM (stale ref)
   *  - node not actionable   → structural node, nothing to address
   */
  resolveRef(ref: string): {
    ref: string; axId?: string; backendNodeId?: string | number;
    selector?: string; role: string; name: string;
  } {
    const node = this.lastResult?.refs[ref];
    if (!node) {
      throw new Error(
        `Stale ref "${ref}": not present in the current snapshot. Re-run snapshot to get fresh refs.`
      );
    }
    if (node.axId == null && node.backendNodeId == null) {
      throw new Error(
        `Ref "${ref}" is a structural node (role=${node.role}) with no element handle. `
        + 'Target an interactive or named element instead — try snapshot with interactiveOnly=true.'
      );
    }
    return {
      ref: node.ref,
      axId: node.axId,
      backendNodeId: node.backendNodeId,
      selector: node.selector,
      role: node.role,
      name: node.name,
    };
  }

  /**
   * Single-page search: match against the snapshot already in memory. Makes no
   * network request and touches no other tab, which is what makes it safe to
   * call in a tight loop while reading one long document.
   */
  searchPage(options: PageSearchOptions): PageSearchMatch[] {
    const result = this.lastResult;
    if (!result) {
      throw new Error('No snapshot to search. Run snapshot first so the page has refs.');
    }
    const q = (options.query ?? '').toLowerCase();
    const limit = Math.max(1, Math.min(options.limit ?? 20, 200));
    const fields = options.in ?? (['name', 'value', 'href', 'role'] as const);
    const out: PageSearchMatch[] = [];

    if (!q) return out;

    // Filters decide what gets *recorded*, never what gets *traversed*. Returning
    // early on a non-matching ancestor would prune the whole subtree below it —
    // the <body> would filter out and the actionable link nested inside it would
    // never be reached.
    const walk = (node: SnapshotNode): void => {
      if (out.length >= limit) return;

      const recordable = (!options.actionableOnly || node.actionable)
        && (!options.role || node.role.toLowerCase() === options.role.toLowerCase());

      if (recordable) {
        for (const field of fields) {
          const haystack = field === 'name' ? node.name
            : field === 'value' ? (node.value ?? '')
              : field === 'href' ? (node.href ?? '')
                : node.role;
          if (haystack && haystack.toLowerCase().includes(q)) {
            out.push({
              ref: node.ref,
              role: node.role,
              name: node.name,
              value: node.value,
              href: node.href,
              field,
              context: excerpt(haystack, q),
            });
            break;
          }
        }
      }

      for (const child of node.children) walk(child);
    };

    for (const root of result.nodes) walk(root);
    return out;
  }

  /** Render a human/LLM-readable tree with refs. */
  render(nodes: SnapshotNode[], _options: SnapshotOptions = {}): string {
    const lines: string[] = [];
    const walk = (n: SnapshotNode, indent: string) => {
      let line = indent;
      if (n.role) line += n.role;
      if (n.name) line += `" ${truncate(n.name, 80)}"`;
      line += ` [ref=${n.ref}]`;
      if (!n.actionable) line += ' [structural]';
      if (n.href) line += ` [url=${n.href}]`;
      if (n.value != null && n.value !== '') line += ` [value=${truncate(n.value, 40)}]`;
      lines.push(line);
      for (const c of n.children) walk(c, indent + '  ');
    };
    for (const n of nodes) walk(n, '');
    return lines.join('\n');
  }

  findByRef(ref: string, result: SnapshotResult): SnapshotNode | undefined {
    return result.refs[ref];
  }

  /** Semantic search: match by role and/or name (case-insensitive, substring). */
  findByText(result: SnapshotResult, text: string, role?: string): SnapshotNode[] {
    const q = text.toLowerCase();
    return Object.values(result.refs).filter((n) => {
      const roleOk = !role || n.role.toLowerCase() === role.toLowerCase();
      const textOk = !text || n.name.toLowerCase().includes(q) || (n.value ?? '').toLowerCase().includes(q);
      return roleOk && textOk;
    });
  }

  /**
   * Return the injected-script body that collects a RawAxNode tree in-page.
   *
   * The traversal stamps AX_MARKER_ATTR onto elements it can act on, reusing an
   * existing stamp when present so ids stay stable across repeated snapshots.
   * Only actionable candidates are stamped: blanket-stamping every element would
   * perturb page code that walks attributes or counts nodes.
   */
  static collectorScript(): string {
    return `(function(){
  var ATTR = ${JSON.stringify(AX_MARKER_ATTR)};
  // Fresh prefix per collection so newly minted ids cannot collide with stamps
  // written by an earlier run on the same document.
  var prefix = Math.random().toString(36).slice(2, 8);
  var counter = 0;
  var INTERACTIVE_ROLES = {button:1,link:1,textbox:1,searchbox:1,combobox:1,checkbox:1,radio:1,slider:1,menuitem:1,tab:1,switch:1,spinbutton:1,listbox:1,option:1,treeitem:1};
  var SKIP_TAGS = {script:1,style:1,noscript:1,template:1,head:1,meta:1,link:1,title:1};
  var INERT_INPUT = ['hidden','submit','button','file','image'];
  var MAX_DEPTH = 40;

  function textOf(el){
    if(!el) return '';
    var labelled = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
    if(labelled) return labelled.trim();
    var direct = (el.textContent || '').trim();
    return direct.length > 160 ? direct.slice(0,160) : direct;
  }

  function collect(el, depth){
    if(depth > MAX_DEPTH) return null;
    if(!el || el.nodeType !== 1) return null;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if(SKIP_TAGS[tag]) return null;

    var type = el.getAttribute && el.getAttribute('type');
    if(tag === 'input' && type && INERT_INPUT.indexOf(type) >= 0) return null;

    var href = (tag === 'a' && el.getAttribute('href')) || null;
    var explicitRole = el.getAttribute && el.getAttribute('role');
    var role = explicitRole;
    if(!role){
      if(type === 'checkbox' || type === 'radio') role = type;
      else if(tag === 'a') role = 'link';
      else if(tag === 'button') role = 'button';
      else if(tag === 'select') role = 'combobox';
      else if(tag === 'textarea') role = 'textbox';
      else if(tag === 'input') role = 'textbox';
      else role = tag || 'generic';
    }

    var name = textOf(el);
    var actionable = !!INTERACTIVE_ROLES[role] || (tag === 'a' && !!href)
      || (tag === 'input' && type && INERT_INPUT.indexOf(type) < 0)
      || tag === 'textarea' || tag === 'select'
      || (el.getAttribute && el.getAttribute('contenteditable') === 'true');

    var node = { role: role, name: name, attributes: { tag: tag } };

    if(actionable){
      var existing = el.getAttribute(ATTR);
      var axId = existing || (prefix + '-' + (++counter));
      if(!existing){ try { el.setAttribute(ATTR, axId); } catch(_) {} }
      node.axId = axId;
    }
    if(el.id) node.selector = '#' + el.id;
    if(type) node.attributes.type = type;
    if(href) node.href = href;
    var ce = el.getAttribute && el.getAttribute('contenteditable');
    if(ce) node.attributes.contenteditable = ce;
    if(tag === 'input' || tag === 'textarea'){
      var v = el.value;
      if(v != null && v !== '') node.value = String(v).slice(0,200);
    }
    if(tag === 'input' && type === 'checkbox') node.states = [el.checked ? 'checked' : 'unchecked'];

    node.children = [];
    var kids = el.children || [];
    for(var i=0;i<kids.length;i++){
      var c = collect(kids[i], depth+1);
      if(c) node.children.push(c);
    }
    return node;
  }

  var root = collect(document.body || document.documentElement, 0);
  return JSON.stringify(root ? [root] : []);
})();`;
  }

  /** Script that strips every stamp this collector wrote. Run on navigation. */
  static clearMarkersScript(): string {
    return `(function(){
  var ATTR = ${JSON.stringify(AX_MARKER_ATTR)};
  var stale = document.querySelectorAll('[' + ATTR + ']');
  for(var i=0;i<stale.length;i++){
    try { stale[i].removeAttribute(ATTR); } catch(_) {}
  }
  return stale.length;
})();`;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Text around the first hit, so a caller can tell two same-named nodes apart. */
function excerpt(haystack: string, loweredQuery: string): string {
  const at = haystack.toLowerCase().indexOf(loweredQuery);
  if (at < 0) return truncate(haystack, 120);
  const start = Math.max(0, at - 40);
  const end = Math.min(haystack.length, at + loweredQuery.length + 60);
  return (start > 0 ? '…' : '') + haystack.slice(start, end) + (end < haystack.length ? '…' : '');
}
