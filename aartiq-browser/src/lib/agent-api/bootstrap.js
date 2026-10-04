"use strict";
/**
 * Bootstrap — wires the feature managers + agent-api server into the Electron
 * main process. Kept defensive: any failure is logged, never fatal to the app.
 *
 * Page operations go through a PageAdapter built from Electron's BrowserWindow /
 * webContents, so the same tools work against the real browser tabs at runtime.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAgentApi = startAgentApi;
const electron = __importStar(require("electron"));
const guardrails_1 = require("../guardrails");
const agent_registry_1 = require("../agent/agent-registry");
const manager_1 = require("../snapshot/manager");
const bridge_1 = require("./bridge");
const server_1 = require("./server");
const providers_1 = require("./providers");
/** Page webContents only — devtools/background windows are not agent targets. */
function pageWindows() {
    const out = [];
    for (const w of electron.BrowserWindow.getAllWindows()) {
        if (w.webContents.getType() !== 'window')
            continue;
        out.push(w.webContents);
    }
    return out;
}
/**
 * Resolve a tab id to its webContents.
 *
 * Fails closed. The previous version returned `wins[0]` whenever a tabId was
 * missing or unknown, so a request naming a closed or misspelt tab silently ran
 * against whichever window happened to be first — an agent asking to fill a form
 * in tab 7 could fill the form in a window it was never given. An unknown id is
 * now an error the caller has to deal with, not a redirect to the wrong page.
 */
function requireTab(tabId) {
    const pages = pageWindows();
    if (!pages.length)
        throw new Error('No browser window is open.');
    if (tabId != null && tabId !== '') {
        const wanted = String(tabId);
        for (const wc of pages) {
            if (String(wc.id) === wanted)
                return wc;
        }
        throw new Error(`Unknown tabId "${tabId}". Call list_tabs to get current ids.`);
    }
    // No id at all: the focused window's active tab is the only safe assumption.
    const win = electron.BrowserWindow.getFocusedWindow();
    const focused = win && pages.includes(win.webContents) ? win.webContents : undefined;
    return focused ?? pages[0];
}
function buildPageAdapter() {
    return {
        async getAxTree(tabId) {
            const code = manager_1.SnapshotManager.collectorScript();
            const json = await requireTab(tabId).executeJavaScript(code);
            return typeof json === 'string' ? JSON.parse(json) : json;
        },
        async executeInTab(tabId, script) {
            return requireTab(tabId).executeJavaScript(script);
        },
        async navigate(tabId, url) {
            await requireTab(tabId).loadURL(url);
        },
        async listTabs() {
            return pageWindows().map((wc) => ({ id: String(wc.id), url: wc.getURL(), title: wc.getTitle() }));
        },
        async clearMarkers(tabId) {
            // Best effort: the document may already be gone mid-navigation, and a
            // failed cleanup must not abort the navigation itself.
            await requireTab(tabId).executeJavaScript(manager_1.SnapshotManager.clearMarkersScript());
        },
    };
}
async function startAgentApi(deps = {}) {
    try {
        const agents = new agent_registry_1.AgentRegistry();
        const security = new guardrails_1.SecurityPipeline({ agents: agents.trust });
        const snapshots = new manager_1.SnapshotManager();
        const bridge = new bridge_1.InProcessBridge({
            snapshots,
            vault: deps.vault,
            extensions: deps.extensions,
            pageAdapter: buildPageAdapter(),
            search: deps.search,
        });
        const server = new server_1.AgentApiServer({
            bridge,
            security,
            agents,
            snapshots,
            vault: deps.vault,
            extensions: deps.extensions,
            search: deps.search,
            config: deps.config ?? (0, providers_1.defaultConfig)(),
        });
        await server.start();
        console.log('[agent-api] started');
        return server;
    }
    catch (e) {
        console.error('[agent-api] failed to start:', e.message);
        return null;
    }
}
