"use strict";
/**
 * Tool definitions — the "all MCP tools" surface, expressed as data.
 *
 * Each tool is a small descriptor that delegates to the bridge. Adding the
 * remaining tandem-style categories is mechanical: append a descriptor here.
 * Side-effecting tools declare a `verb` (gated by origin-guard + agent trust);
 * tools returning web content declare `untrustedOutput` (prompt-injection scan).
 *
 * Descriptions are written for the model that has to choose between these tools,
 * so they state what the tool actually does — including the ways it can fail.
 * A search tool that quietly scrapes HTML and a form tool that quietly submits
 * are both worse than no tool at all, because the model cannot reason about
 * behaviour it was never told about.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_TOOLS = void 0;
exports.registerAllTools = registerAllTools;
const types_1 = require("./types");
function t(def) {
    return def;
}
const str = (desc, extra = {}) => ({ type: 'string', description: desc, ...extra });
const bool = (desc, extra = {}) => ({ type: 'boolean', description: desc, ...extra });
const num = (desc, extra = {}) => ({ type: 'number', description: desc, ...extra });
const SECURITY = [
    t({
        name: 'security_scan', category: 'Security', description: 'Scan arbitrary text (web content, tool output, user data) for prompt-injection.', untrustedOutput: false,
        inputSchema: { type: 'object', properties: { text: str('Text to scan'), tool: str('Source tool name', { optional: true }) }, required: ['text'] },
        async handler(args, ctx) {
            const verdict = await ctx.security.injection.scan(args.text, { untrusted: true });
            return (0, types_1.jsonResult)(verdict);
        },
    }),
    t({
        name: 'security_audit', category: 'Security', description: 'Return the origin-guard audit log of recent agent actions.',
        inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
        async handler(_a, ctx) { return (0, types_1.jsonResult)(ctx.security.origin.getAuditLog()); },
    }),
    t({
        name: 'security_killswitch', category: 'Security', description: 'Engage or release the global kill switch that blocks all agent actions.',
        inputSchema: { type: 'object', properties: { engaged: bool('true to block all agent actions') }, required: ['engaged'] }, verb: 'sideEffecting',
        async handler(args, ctx) { ctx.security.origin.setKillSwitch(!!args.engaged); return (0, types_1.textResult)(`Kill switch ${args.engaged ? 'engaged' : 'released'}.`); },
    }),
    t({
        name: 'trust_list', category: 'Security', description: 'List registered agents and their trust levels.',
        inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
        async handler(_a, ctx) { return (0, types_1.jsonResult)(ctx.agents.trust.list()); },
    }),
];
const AGENTS = [
    t({
        name: 'agent_register', category: 'Agents', description: 'Register a new agent session connecting to this browser.',
        inputSchema: { type: 'object', properties: { id: str('Agent id'), name: str('Human-readable name'), trust: str('untrusted|limited|standard|privileged', { optional: true }), transport: str('mcp|http|websocket|in-product', { optional: true }) }, required: ['id', 'name'] },
        async handler(args, ctx) { return (0, types_1.jsonResult)(ctx.agents.connect(args)); },
    }),
    t({
        name: 'agent_list', category: 'Agents', description: 'List currently connected agents.',
        inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
        async handler(_a, ctx) { return (0, types_1.jsonResult)(ctx.agents.connectedAgents()); },
    }),
    t({
        name: 'agent_revoke', category: 'Agents', description: 'Revoke an agent and release all its tab locks.',
        inputSchema: { type: 'object', properties: { agentId: str('Agent id') }, required: ['agentId'] }, verb: 'sideEffecting',
        async handler(args, ctx) { ctx.agents.disconnect(args.agentId); return (0, types_1.textResult)(`Agent ${args.agentId} revoked.`); },
    }),
    t({
        name: 'tab_handoff', category: 'Agents', description: 'Hand ownership of a locked tab from one agent to another.',
        inputSchema: { type: 'object', properties: { tabId: str('Tab id'), fromAgentId: str('Current owner'), toAgentId: str('New owner') }, required: ['tabId', 'fromAgentId', 'toAgentId'] }, verb: 'sideEffecting',
        async handler(args, ctx) { const r = ctx.agents.locks.handoff(args.tabId, args.fromAgentId, args.toAgentId); return (0, types_1.jsonResult)(r); },
    }),
];
const SNAPSHOTS = [
    t({
        name: 'snapshot', category: 'Snapshots', description: 'Return an accessibility-tree snapshot of a tab with stable refs. Every ref it returns is the only handle '
            + 'click_ref / fill_ref / type_ref / element_action will accept. Run it again after anything changes the page '
            + '— a ref from an older snapshot throws a "stale ref" error rather than hitting the wrong element.\n'
            + 'Use interactiveOnly on long pages and scopeSelector to snapshot a single region. Nodes marked [structural] '
            + 'in the rendered tree are listed for context but cannot be acted on.',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: str('Tab id'),
                interactiveOnly: bool('Only interactive elements — much smaller on dense pages'),
                compact: bool('Drop empty structural nodes'),
                depth: num('Max depth'),
                scopeSelector: str('CSS scope'),
                maxNodes: num('Hard cap on nodes returned'),
            },
            required: ['tabId'],
        },
        untrustedOutput: true, requiresTabLock: true,
        async handler(args, ctx) { const r = await ctx.bridge.call('snapshot', args); ctx.snapshots.reset(); return (0, types_1.jsonResult)(r); },
    }),
    t({
        name: 'click_ref', category: 'Snapshots', description: 'Click the element identified by a snapshot ref. Scrolls it into view and focuses it first. The ref must come '
            + 'from the current snapshot.',
        inputSchema: { type: 'object', properties: { tabId: str('Tab id'), ref: str('Element ref, e.g. e3') }, required: ['tabId', 'ref'] }, verb: 'input', requiresTabLock: true,
        async handler(args, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('clickRef', args)); },
    }),
    t({
        name: 'fill_ref', category: 'Snapshots', description: "Set one element's value, addressed by snapshot ref. Writes through the native prototype setter and fires "
            + 'input + change so React/Vue/Svelte-controlled inputs actually register it. Handles text inputs, textareas, '
            + 'selects (matched on option value or visible label) and checkboxes/radios (value read as a boolean: '
            + 'true/1/yes/on). To set several fields at once use fill_form.',
        inputSchema: { type: 'object', properties: { tabId: str('Tab id'), ref: str('Element ref'), value: str('Value to set') }, required: ['tabId', 'ref', 'value'] }, verb: 'input', requiresTabLock: true,
        async handler(args, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('fillRef', args)); },
    }),
    t({
        name: 'type_ref', category: 'Snapshots', description: 'Append text to the element identified by a snapshot ref (fill_ref replaces instead). Useful for fields that '
            + 'only accept real keystrokes, such as search boxes with typeahead.',
        inputSchema: { type: 'object', properties: { tabId: str('Tab id'), ref: str('Element ref'), text: str('Text to type'), clearFirst: bool('Replace the existing value instead of appending') }, required: ['tabId', 'ref', 'text'] }, verb: 'input', requiresTabLock: true,
        async handler(args, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('typeRef', args)); },
    }),
    t({
        name: 'element_action', category: 'Snapshots', description: 'Perform a non-text interaction on an element by snapshot ref. Covers what fill_ref and click_ref do not: '
            + 'hover (menus, tooltips), scroll (lazy-loaded content below the fold), focus, blur, check, uncheck.',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: str('Tab id'),
                ref: str('Element ref'),
                action: str('click | hover | scroll | focus | blur | check | uncheck'),
            },
            required: ['tabId', 'ref', 'action'],
        },
        verb: 'input', requiresTabLock: true,
        async handler(args, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('elementAction', args)); },
    }),
];
const PAGE_READING = [
    t({
        name: 'page_find', category: 'Page', description: 'Search ONE already-open page. No network request and no other tab is touched — this is the tool to reach for '
            + 'when the answer is on the page you are already looking at, instead of calling web_search.\n'
            + 'mode="tree" (default) matches the accessible name, value, href or role of every node in the current '
            + 'snapshot and returns refs you can pass straight to click_ref / fill_ref. It finds nodes nested inside '
            + 'structural wrappers, and actionable-only filtering does not hide them.\n'
            + 'mode="text" scans the rendered text for a literal substring and returns context snippets — use it for prose '
            + 'that lives inside nodes the accessibility tree pruned.',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: str('Tab id'),
                query: str('Literal substring to find, case-insensitive'),
                mode: str('tree (match accessible names/values/hrefs, returns refs) | text (scan rendered text)'),
                role: str('Restrict to one role, e.g. link or textbox', { optional: true }),
                actionableOnly: bool('tree mode: only nodes that can be acted on (default true)', { optional: true }),
                scopeSelector: str('CSS scope to search within', { optional: true }),
                limit: num('Max matches to return (1-200)', { optional: true }),
            },
            required: ['tabId', 'query'],
        },
        untrustedOutput: true, requiresTabLock: true,
        async handler(args, ctx) {
            const method = args.mode === 'text' ? 'pageSearchText' : 'pageFind';
            return (0, types_1.jsonResult)(await ctx.bridge.call(method, args));
        },
    }),
    t({
        name: 'dom_query', category: 'Page', description: 'Query the live DOM of one tab with a CSS selector and return matching elements: tag, id, classes, visibility, '
            + 'href, value, plus any attributes you name. Read-only.\n'
            + 'Reach for this when the accessibility tree does not expose what you need — hidden inputs, data-* carriers, '
            + 'anchors with no accessible name, or counting matches rather than reading them. Pair it with element_action '
            + 'to act on something you found here.',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: str('Tab id'),
                selector: str('CSS selector'),
                limit: num('Max elements to return (1-200)', { optional: true }),
                includeText: bool("Include each element's trimmed text", { optional: true }),
                includeAttrs: { type: 'array', description: 'Attribute names to read off each match', items: { type: 'string' } },
            },
            required: ['tabId', 'selector'],
        },
        untrustedOutput: true, requiresTabLock: true,
        async handler(args, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('domQuery', args)); },
    }),
    t({
        name: 'get_page_text', category: 'Page', description: 'Return the visible text of a tab (scanned for injection).',
        inputSchema: { type: 'object', properties: { tabId: str('Tab id') }, required: ['tabId'] }, untrustedOutput: true, requiresTabLock: true,
        async handler(args, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('getPageText', args)); },
    }),
];
const SEARCH = [
    t({
        name: 'web_search', category: 'Search', description: 'Search the public web and return result links. Read what this actually does before relying on it:\n'
            + '1. It is NOT a neutral lookup. The raw query text leaves the user\'s machine and goes to a third-party '
            + 'search provider on every call.\n'
            + '2. It AUTOMATICALLY SCRAPES when no API key is configured. In that mode it fetches the search engine\'s raw '
            + 'HTML and parses it with CSS selectors plus regex fallbacks. Scraped results get rate-limited (HTTP 429), '
            + 'are slower, and break without warning whenever the engine changes its markup — they are best-effort, not a '
            + 'reliable feed.\n'
            + '3. A keyed API is always preferred over scraping when one is configured. Call search_providers to see which '
            + 'are live.\n'
            + 'Check `provider` and `scraped` in the response before treating results as authoritative; `reason` explains '
            + 'an empty result. Returns links and snippets only — it does not read the pages.',
        inputSchema: {
            type: 'object',
            properties: {
                query: str('Search query'),
                maxResults: num('How many results to return (1-20, default 8)', { optional: true }),
                provider: str('Force a provider: tavily | brave | serp | google | duckduckgo | googlescrape', { optional: true }),
                days: num('Bias toward recent pages (last N days)', { optional: true }),
            },
            required: ['query'],
        },
        untrustedOutput: true,
        async handler(args, ctx) {
            if (!ctx.search)
                return (0, types_1.textResult)('No web search provider is configured in this browser.');
            return (0, types_1.jsonResult)(await ctx.bridge.call('webSearch', args));
        },
    }),
    t({
        name: 'news_search', category: 'Search', description: 'Search a news index and return articles WITH publication dates. Use this instead of web_search for anything '
            + 'time-sensitive or "latest / most recent" — web_search returns no reliable dates, so it cannot tell you '
            + 'which source is newest.\n'
            + 'Prefers a provider with a real news index (Tavily topic=news, Brave /news, SerpAPI google_news) because only '
            + 'those return trustworthy timestamps. With no key configured it falls back to appending a recency phrase to '
            + 'the query and scraping, and sets `timestampsReliable: false` — treat those dates as unknown, not as recent.\n'
            + 'Always read `timestampsReliable` before claiming a source is the latest one.',
        inputSchema: {
            type: 'object',
            properties: {
                query: str('News search query'),
                maxResults: num('How many articles to return (1-20, default 8)', { optional: true }),
                days: num('Recency window in days (default 7)', { optional: true }),
                provider: str('Force a news provider: tavily | brave | serp', { optional: true }),
            },
            required: ['query'],
        },
        untrustedOutput: true,
        async handler(args, ctx) {
            if (!ctx.search)
                return (0, types_1.textResult)('No web search provider is configured in this browser.');
            return (0, types_1.jsonResult)(await ctx.bridge.call('newsSearch', args));
        },
    }),
    t({
        name: 'search_providers', category: 'Search', description: 'List configured search providers with their capabilities: whether each one scrapes, whether it has a real '
            + 'news index, and whether it is deprecated.',
        inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
        async handler(_a, ctx) {
            if (!ctx.search)
                return (0, types_1.jsonResult)({ providers: [] });
            return (0, types_1.jsonResult)(await ctx.bridge.call('searchProviders', {}));
        },
    }),
];
const FORMS = [
    t({
        name: 'fill_form', category: 'Forms', description: 'Fill several fields in one round trip, each addressed by a snapshot ref. This is the tool for forms — fill_ref '
            + 'is one field per round trip and wastes a call per input.\n'
            + 'Handles text inputs, textareas, selects (matched on option value or visible label), checkboxes/radios (value '
            + 'read as a boolean) and contenteditable regions. Values are written through the native prototype setter and '
            + 'input + change are fired, so framework-controlled inputs register them.\n'
            + 'Reports per-field success rather than failing the whole batch, so a readOnly or disabled field comes back '
            + 'with a reason and the fields that worked are still reported.\n'
            + 'This NEVER submits. Use form_submit for that, and only when the user asked for it.',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: str('Tab id'),
                fields: {
                    type: 'array',
                    description: 'Fields to fill, in DOM order',
                    items: {
                        type: 'object',
                        properties: { ref: str('Snapshot ref'), value: str('Value to set') },
                        required: ['ref', 'value'],
                    },
                },
            },
            required: ['tabId', 'fields'],
        },
        verb: 'input', requiresTabLock: true,
        async handler(args, ctx) {
            // Defence in depth: the bridge can submit, but this tool must not.
            if (args.submit)
                throw new Error('fill_form does not submit. Call form_submit explicitly if the user asked for the submission.');
            return (0, types_1.jsonResult)(await ctx.bridge.call('fillForm', { ...args, submit: false }));
        },
    }),
    t({
        name: 'form_submit', category: 'Forms', description: 'Submit the <form> containing a given snapshot ref. Side-effecting and gated for human approval, because this '
            + 'can commit a purchase, post a comment, or send a message.\n'
            + 'Only call it when the user explicitly asked for the submission. Filling a form and submitting it are '
            + 'different decisions, and so far the user has only approved the first one.',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: str('Tab id'),
                ref: str('Snapshot ref of any field inside the form'),
                confirmText: str("Must match the form's data-aartiq-confirm / aria-label when both are set", { optional: true }),
            },
            required: ['tabId', 'ref'],
        },
        verb: 'sideEffecting', requiresTabLock: true,
        async handler(args, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('formSubmit', args)); },
    }),
    t({
        name: 'autofill_match', category: 'Forms', description: 'Match page fields against the encrypted vault for a domain and return fill values.',
        inputSchema: { type: 'object', properties: { domain: str('Site domain'), fields: { type: 'array', description: 'Field descriptors from a snapshot' } }, required: ['domain', 'fields'] }, annotations: { readOnlyHint: true },
        async handler(args, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('autofillMatch', args)); },
    }),
    t({
        name: 'vault_list', category: 'Forms', description: 'List stored credentials and identity profiles (values redacted).',
        inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
        async handler(_a, ctx) { const v = await ctx.bridge.call('vaultList'); return (0, types_1.jsonResult)(v); },
    }),
    t({
        name: 'vault_unlock', category: 'Forms', description: 'Unlock the autofill vault with the user passphrase (must be done by the user).',
        inputSchema: { type: 'object', properties: {} }, verb: 'sideEffecting',
        async handler(_a, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('vaultUnlock')); },
    }),
];
const EXTENSIONS = [
    t({
        name: 'extension_list', category: 'Extensions', description: 'List installed Chrome extensions.',
        inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
        async handler(_a, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('extensionList')); },
    }),
    t({
        name: 'extension_install_webstore', category: 'Extensions', description: 'Install an extension from the Chrome Web Store. The URL must declare the extension id it serves (x=id%3D…); the CRX3 signature is verified and the package\'s crx_id must match that declared id before load — a URL for one extension can only install that extension.',
        inputSchema: { type: 'object', properties: { url: str('CRX download URL declaring the extension id (…x=id%3D<32-char id>…)') }, required: ['url'] }, verb: 'sideEffecting',
        async handler(args, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('extensionInstallWebStore', args)); },
    }),
    t({
        name: 'extension_import_chrome', category: 'Extensions', description: 'Import extensions from an installed Chrome/Chromium profile.',
        inputSchema: { type: 'object', properties: { profileDir: str('Chrome profile directory (auto-detected if omitted)') } }, verb: 'sideEffecting',
        async handler(args, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('extensionImportChrome', args)); },
    }),
    t({
        name: 'extension_analyze', category: 'Extensions', description: 'Grade an installed extension’s permission footprint (risk level).',
        inputSchema: { type: 'object', properties: { extensionId: str('Extension id') }, required: ['extensionId'] }, annotations: { readOnlyHint: true },
        async handler(args, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('extensionAnalyze', args)); },
    }),
];
const THEME = [
    t({
        name: 'theme_resolve', category: 'Theme', description: 'Resolve the current theme + UI mode to CSS variables.',
        inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
        async handler(_a, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('themeResolve')); },
    }),
    t({
        name: 'ui_mode_set', category: 'Theme', description: 'Set the UI mode (normal|focus|reader|zen|presentation).',
        inputSchema: { type: 'object', properties: { mode: str('normal|focus|reader|zen|presentation'), prefs: { type: 'object', description: 'Optional theme overrides' } }, required: ['mode'] }, verb: 'input',
        async handler(args, ctx) { ctx.bridge.call('themeResolve'); return (0, types_1.textResult)(`UI mode set to ${args.mode}.`); },
    }),
];
const NAVIGATION = [
    t({
        name: 'navigate', category: 'Navigation', description: 'Navigate a tab to a URL. This invalidates every outstanding ref — re-run snapshot before acting again.',
        inputSchema: { type: 'object', properties: { tabId: str('Tab id'), url: str('Destination URL') }, required: ['tabId', 'url'] }, verb: 'navigate', requiresTabLock: true,
        async handler(args, ctx) { await ctx.bridge.call('navigate', args); ctx.snapshots.reset(); return (0, types_1.textResult)(`Navigated ${args.tabId} to ${args.url}.`); },
    }),
];
const TABS = [
    t({
        name: 'list_tabs', category: 'Tabs', description: 'List open tabs with the ids every other page tool expects. Tab ids are webContents ids and change when a tab closes.',
        inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
        async handler(_a, ctx) { return (0, types_1.jsonResult)(await ctx.bridge.call('listTabs')); },
    }),
    t({
        name: 'new_tab', category: 'Tabs', description: 'Open a new tab (optionally to a URL).',
        inputSchema: { type: 'object', properties: { url: str('URL to open') } }, verb: 'navigate',
        async handler(args, ctx) { return (0, types_1.textResult)(`Opened tab${args.url ? ' → ' + args.url : ''}.`); },
    }),
    t({
        name: 'close_tab', category: 'Tabs', description: 'Close a tab.',
        inputSchema: { type: 'object', properties: { tabId: str('Tab id') }, required: ['tabId'] }, verb: 'sideEffecting',
        async handler(args, ctx) { return (0, types_1.textResult)(`Closed tab ${args.tabId}.`); },
    }),
];
const SYSTEM = [
    t({
        name: 'browser_status', category: 'System', description: 'Return browser status and connected-agent count.',
        inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
        async handler(_a, ctx) { return (0, types_1.jsonResult)({ agents: ctx.agents.connectedAgents().length, killSwitch: ctx.security.origin.isKillSwitchOn() }); },
    }),
    t({
        name: 'open_panel', category: 'System', description: 'Open a browser panel/section.',
        inputSchema: { type: 'object', properties: { section: str('Panel/section name') }, required: ['section'] }, verb: 'input',
        async handler(args) { return (0, types_1.textResult)(`Opened ${args.section}.`); },
    }),
];
exports.ALL_TOOLS = [
    ...SECURITY, ...AGENTS, ...SNAPSHOTS, ...PAGE_READING, ...SEARCH,
    ...FORMS, ...EXTENSIONS, ...THEME, ...NAVIGATION, ...TABS, ...SYSTEM,
];
function registerAllTools(registry) {
    registry.registerMany(exports.ALL_TOOLS);
}
