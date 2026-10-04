/**
 * Bootstrap — wires the feature managers + agent-api server into the Electron
 * main process. Kept defensive: any failure is logged, never fatal to the app.
 *
 * Page operations go through a PageAdapter built from Electron's BrowserWindow /
 * webContents, so the same tools work against the real browser tabs at runtime.
 */

import * as electron from 'electron';
import { SecurityPipeline } from '../guardrails';
import { AgentRegistry } from '../agent/agent-registry';
import { SnapshotManager } from '../snapshot/manager';
import { InProcessBridge, type PageAdapter, type SearchProviderLike } from './bridge';
import { AgentApiServer } from './server';
import { defaultConfig } from './providers';
import type { AgentApiConfig } from './types';

export interface BootstrapDeps {
  extensions?: any;
  vault?: any;
  search?: SearchProviderLike;
  config?: Partial<AgentApiConfig>;
}

/** Page webContents only — devtools/background windows are not agent targets. */
function pageWindows(): Electron.WebContents[] {
  const out: Electron.WebContents[] = [];
  for (const w of electron.BrowserWindow.getAllWindows()) {
    if (w.webContents.getType() !== 'window') continue;
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
function requireTab(tabId?: string): Electron.WebContents {
  const pages = pageWindows();
  if (!pages.length) throw new Error('No browser window is open.');

  if (tabId != null && tabId !== '') {
    const wanted = String(tabId);
    for (const wc of pages) {
      if (String(wc.id) === wanted) return wc;
    }
    throw new Error(`Unknown tabId "${tabId}". Call list_tabs to get current ids.`);
  }

  // No id at all: the focused window's active tab is the only safe assumption.
  const win = electron.BrowserWindow.getFocusedWindow();
  const focused = win && pages.includes(win.webContents) ? win.webContents : undefined;
  return focused ?? pages[0];
}

function buildPageAdapter(): PageAdapter {
  return {
    async getAxTree(tabId) {
      const code = SnapshotManager.collectorScript();
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
      await requireTab(tabId).executeJavaScript(SnapshotManager.clearMarkersScript());
    },
  };
}

export async function startAgentApi(deps: BootstrapDeps = {}): Promise<AgentApiServer | null> {
  try {
    const agents = new AgentRegistry();
    const security = new SecurityPipeline({ agents: agents.trust });
    const snapshots = new SnapshotManager();
    const bridge = new InProcessBridge({
      snapshots,
      vault: deps.vault,
      extensions: deps.extensions,
      pageAdapter: buildPageAdapter(),
      search: deps.search,
    });
    const server = new AgentApiServer({
      bridge,
      security,
      agents,
      snapshots,
      vault: deps.vault,
      extensions: deps.extensions,
      search: deps.search,
      config: deps.config ?? defaultConfig(),
    });
    await server.start();
    console.log('[agent-api] started');
    return server;
  } catch (e) {
    console.error('[agent-api] failed to start:', (e as Error).message);
    return null;
  }
}
