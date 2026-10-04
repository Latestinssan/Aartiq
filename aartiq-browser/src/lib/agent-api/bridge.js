"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.InProcessBridge = void 0;
exports.createRemoteBridge = createRemoteBridge;
const page_scripts_1 = require("../snapshot/page-scripts");
class InProcessBridge {
    constructor(deps) {
        this.deps = deps;
    }
    listMethods() {
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
    axIdFor(ref) {
        const resolved = this.deps.snapshots.resolveRef(String(ref));
        if (resolved.axId)
            return resolved.axId;
        throw new Error(`Ref "${ref}" resolved to a CDP backendNodeId but this adapter cannot address it. `
            + 'Use an axId-backed snapshot (the default collector) for ref actions.');
    }
    async run(tabId, script) {
        const pa = this.deps.pageAdapter;
        if (!pa)
            throw new Error('No page adapter configured.');
        try {
            return await pa.executeInTab(String(tabId), script);
        }
        catch (e) {
            throw new Error(`Page script failed: ${e.message}`);
        }
    }
    async call(method, args = {}) {
        const pa = this.deps.pageAdapter;
        // Check the adapter before touching refs, so a misconfigured build reports
        // the real problem instead of blaming the caller's ref.
        if (InProcessBridge.NEEDS_PAGE.has(method) && !pa) {
            throw new Error('No page adapter configured.');
        }
        switch (method) {
            case 'snapshot': {
                if (!pa)
                    throw new Error('No page adapter configured.');
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
                return this.run(args.tabId, (0, page_scripts_1.clickScript)(this.axIdFor(args.ref)));
            case 'fillRef':
                return this.run(args.tabId, (0, page_scripts_1.fillScript)(this.axIdFor(args.ref), args.value));
            case 'typeRef':
                return this.run(args.tabId, (0, page_scripts_1.typeScript)(this.axIdFor(args.ref), args.text, !!args.clearFirst));
            case 'elementAction':
                return this.run(args.tabId, (0, page_scripts_1.elementActionScript)(String(args.action), this.axIdFor(args.ref)));
            case 'fillForm': {
                const fields = (args.fields || []).map((f) => ({
                    axId: this.axIdFor(f.ref),
                    value: f.value,
                }));
                return this.run(args.tabId, (0, page_scripts_1.fillFormScript)(fields, !!args.submit));
            }
            case 'formSubmit':
                return this.run(args.tabId, (0, page_scripts_1.formSubmitScript)(this.axIdFor(args.ref), args.confirmText));
            case 'navigate': {
                // Drop the old stamps before the document goes away, so a later snapshot
                // cannot bind a ref to a recycled axId.
                await pa?.clearMarkers?.(String(args.tabId)).catch(() => { });
                this.deps.snapshots.reset();
                await pa.navigate(String(args.tabId), String(args.url));
                return { ok: true };
            }
            case 'getPageText':
                return pa.executeInTab(String(args.tabId), 'document.body ? document.body.innerText : ""');
            case 'listTabs':
                return pa.listTabs();
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
                return this.run(args.tabId, (0, page_scripts_1.pageTextSearchScript)(String(args.query), {
                    limit: args.limit,
                    scopeSelector: args.scopeSelector,
                    caseSensitive: !!args.caseSensitive,
                }));
            case 'domQuery':
                return this.run(args.tabId, (0, page_scripts_1.domQueryScript)(String(args.selector), {
                    limit: args.limit,
                    includeText: args.includeText,
                    includeAttrs: args.includeAttrs,
                }));
            case 'webSearch': {
                if (!this.deps.search)
                    throw new Error('No search provider configured.');
                return this.deps.search.searchDetailed(String(args.query), args.provider ?? null, args.maxResults);
            }
            case 'newsSearch': {
                if (!this.deps.search)
                    throw new Error('No search provider configured.');
                return this.deps.search.searchNewsDetailed(String(args.query), args.maxResults, {
                    provider: args.provider ?? null,
                    days: args.days,
                    depth: args.depth,
                });
            }
            case 'searchProviders':
                return { providers: this.deps.search?.getProviderInfo?.() ?? [] };
            case 'autofillMatch': {
                if (!this.deps.vault)
                    throw new Error('Vault not available.');
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
exports.InProcessBridge = InProcessBridge;
/** Methods that cannot do anything useful without a live page. */
InProcessBridge.NEEDS_PAGE = new Set([
    'snapshot', 'clickRef', 'fillRef', 'typeRef', 'elementAction', 'fillForm', 'formSubmit',
    'navigate', 'getPageText', 'listTabs', 'pageSearchText', 'domQuery',
]);
/** Build a Bridge from a plain HTTP client (remote agent over Tailscale/LAN). */
function createRemoteBridge(baseUrl, fetchImpl) {
    return {
        listMethods: () => [],
        async call(method, args = {}) {
            const res = await fetchImpl(`${baseUrl}/api/${method}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(args ?? {}),
            });
            if (!res.ok)
                throw new Error(`Bridge ${method} failed: ${res.status}`);
            return (await res.json());
        },
    };
}
