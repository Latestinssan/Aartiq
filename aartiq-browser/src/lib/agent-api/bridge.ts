/**
 * InProcessBridge — implements tool methods directly against the feature managers
 * inside the browser main process. Page-dependent operations are delegated to a
 * PageAdapter (supplied by main.js at runtime; mocked in tests). A RemoteBridge
 * (HTTP) can expose the same surface to external MCP/HTTP agents.
 *
 * Every ref-addressed method resolves through SnapshotManager.resolveRef first.
 * That is what turns `e12` into a real element: the snapshot manager holds the
 * ref→axId binding, and the axId is the attribute the collector stamped onto the
 * element. Without that step a ref is just a string and the injected selector
 * silently matches nothing.
 */

import type { Bridge } from './types';
import type { RawAxNode } from '../snapshot/types';
import type { SnapshotManager } from '../snapshot/manager';
import type { AutofillVault } from '../autofill/vault';
import {
  clickScript, fillScript, typeScript, fillFormScript, formSubmitScript,
  elementActionScript, domQueryScript, pageTextSearchScript,
} from '../snapshot/page-scripts';

/** Structural view of web-search-service, so the bridge stays decoupled from it. */
export interface SearchProviderLike {
  searchDetailed(query: string, provider?: string | null, count?: number): Promise<any>;
  searchNewsDetailed(query: string, count?: number, opts?: any): Promise<any>;
  getProviderInfo?(): Array<Record<string, unknown>>;
}

export interface PageAdapter {
  getAxTree(tabId: string): Promise<RawAxNode[]>;
  executeInTab(tabId: string, script: string): Promise<any>;
  navigate(tabId: string, url: string): Promise<void>;
  listTabs(): Promise<Array<{ id: string; url: string; title: string }>>;
  /** Clear the collector's DOM stamps. Optional; called before navigating. */
  clearMarkers?(tabId: string): Promise<void>;
}

export interface BridgeDeps {
  snapshots: SnapshotManager;
  vault?: AutofillVault;
  extensions?: any; // ChromeExtensionManager instance
  agents?: any; // AgentRegistry
  pageAdapter?: PageAdapter;
  search?: SearchProviderLike;
  themeState?: { current: { mode: string; prefs: any } };
}

export class InProcessBridge implements Bridge {
  constructor(private deps: BridgeDeps) {}

  listMethods(): string[] {
    return [
      'snapshot', 'clickRef', 'fillRef', 'typeRef', 'elementAction', 'fillForm', 'formSubmit',
      'navigate', 'getPageText', 'listTabs',
      'pageFind', 'pageSearchText', 'domQuery',
      'webSearch', 'newsSearch', 'searchProviders',
      'autofillMatch', 'vaultList', 'vaultUnlock',
      'extensionList', 'extensionInstallWebStore', 'extensionImportChrome', 'extensionAnalyze',
      'themeResolve', 'agentRegister', 'agentList', 'agentRevoke',
    ];
  }

  /** Resolve a ref to its stamped element id, failing loudly when impossible. */
  private axIdFor(ref: unknown): string {
    const resolved = this.deps.snapshots.resolveRef(String(ref));
    if (resolved.axId) return resolved.axId;
    throw new Error(
      `Ref "${ref}" resolved to a CDP backendNodeId but this adapter cannot address it. `
      + 'Use an axId-backed snapshot (the default collector) for ref actions.'
    );
  }

  private async run(tabId: unknown, script: string): Promise<any> {
    const pa = this.deps.pageAdapter;
    if (!pa) throw new Error('No page adapter configured.');
    try {
      return await pa.executeInTab(String(tabId), script);
    } catch (e) {
      throw new Error(`Page script failed: ${(e as Error).message}`);
    }
  }

  async call(method: string, args: any = {}): Promise<any> {
    const pa = this.deps.pageAdapter;
    switch (method) {
      case 'snapshot': {
        if (!pa) throw new Error('No page adapter configured.');
        const raw = await pa.getAxTree(String(args.tabId));
        // Accept both the nested form (`options: {...}`) and the flat form the
        // tool schema advertises. The flat form used to be dropped, so
        // interactiveOnly / compact / depth silently did nothing.
        const options = args.options ?? {
          interactiveOnly: args.interactiveOnly,
          compact: args.compact,
          depth: args.depth,
          scopeSelector: args.scopeSelector,
          maxNodes: args.maxNodes,
        };
        return this.deps.snapshots.build(raw, options);
      }
      case 'clickRef':
        return this.run(args.tabId, clickScript(this.axIdFor(args.ref)));
      case 'fillRef':
        return this.run(args.tabId, fillScript(this.axIdFor(args.ref), args.value));
      case 'typeRef':
        return this.run(args.tabId, typeScript(this.axIdFor(args.ref), args.text, !!args.clearFirst));
      case 'elementAction':
        return this.run(args.tabId, elementActionScript(String(args.action), this.axIdFor(args.ref)));
      case 'fillForm': {
        const fields = (args.fields || []).map((f: any) => ({
          axId: this.axIdFor(f.ref),
          value: f.value,
        }));
        return this.run(args.tabId, fillFormScript(fields, !!args.submit));
      }
      case 'formSubmit':
        return this.run(args.tabId, formSubmitScript(this.axIdFor(args.ref), args.confirmText));
      case 'navigate': {
        // Drop the old stamps before the document goes away, so a later snapshot
        // cannot bind a ref to a recycled axId.
        await pa?.clearMarkers?.(String(args.tabId)).catch(() => {});
        this.deps.snapshots.reset();
        await pa!.navigate(String(args.tabId), String(args.url));
        return { ok: true };
      }
      case 'getPageText':
        return pa!.executeInTab(String(args.tabId), 'document.body ? document.body.innerText : ""');
      case 'listTabs':
        return pa!.listTabs();
      case 'pageFind':
        // Snapshot-backed search: one page, no network, returns actable refs.
        return {
          mode: 'tree',
          matches: this.deps.snapshots.searchPage({
            query: args.query,
            role: args.role,
            actionableOnly: args.actionableOnly !== false,
            scopeSelector: args.scopeSelector,
            limit: args.limit,
            in: args.in,
          }),
        };
      case 'pageSearchText':
        // Live-DOM text search: catches matches in nodes the tree pruned.
        return this.run(args.tabId, pageTextSearchScript(String(args.query), {
          limit: args.limit,
          scopeSelector: args.scopeSelector,
          caseSensitive: !!args.caseSensitive,
        }));
      case 'domQuery':
        return this.run(args.tabId, domQueryScript(String(args.selector), {
          limit: args.limit,
          includeText: args.includeText,
          includeAttrs: args.includeAttrs,
        }));
      case 'webSearch': {
        if (!this.deps.search) throw new Error('No search provider configured.');
        return this.deps.search.searchDetailed(String(args.query), args.provider ?? null, args.maxResults);
      }
      case 'newsSearch': {
        if (!this.deps.search) throw new Error('No search provider configured.');
        return this.deps.search.searchNewsDetailed(String(args.query), args.maxResults, {
          provider: args.provider ?? null,
          days: args.days,
          depth: args.depth,
        });
      }
      case 'searchProviders':
        return { providers: this.deps.search?.getProviderInfo?.() ?? [] };
      case 'autofillMatch': {
        if (!this.deps.vault) throw new Error('Vault not available.');
        return this.deps.vault.matchForm(String(args.domain), args.fields || []);
      }
      case 'vaultList':
        return { credentials: this.deps.vault?.listCredentials?.() ?? [], profiles: this.deps.vault?.listProfiles?.() ?? [] };
      case 'vaultUnlock':
        this.deps.vault?.unlock();
        return { unlocked: true };
      case 'extensionList':
        return this.deps.extensions?.getInstalledExtensions?.() ?? [];
      case 'extensionInstallWebStore':
        return this.deps.extensions?.installFromWebStore?.(args.url);
      case 'extensionImportChrome':
        return this.deps.extensions?.importFromChrome?.(args.profileDir);
      case 'extensionAnalyze':
        return this.deps.extensions?.analyzePermissions?.(args.extensionId);
      case 'themeResolve':
        return this.deps.themeState?.current ?? { mode: 'normal', prefs: {} };
      case 'agentRegister':
        return this.deps.agents?.connect?.(args);
      case 'agentList':
        return this.deps.agents?.connectedAgents?.() ?? [];
      case 'agentRevoke':
        this.deps.agents?.disconnect?.(args.agentId);
        return { revoked: true };
      default:
        throw new Error(`Unknown bridge method: ${method}`);
    }
  }
}

/** Build a Bridge from a plain HTTP client (remote agent over Tailscale/LAN). */
export function createRemoteBridge(baseUrl: string, fetchImpl: typeof fetch): Bridge {
  return {
    listMethods: () => [],
    async call<T = any>(method: string, args: any = {}): Promise<T> {
      const res = await fetchImpl(`${baseUrl}/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args ?? {}),
      });
      if (!res.ok) throw new Error(`Bridge ${method} failed: ${res.status}`);
      return (await res.json()) as T;
    },
  };
}
