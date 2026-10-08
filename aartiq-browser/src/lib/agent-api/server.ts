/**
 * Agent API server — exposes the tool registry over MCP (stdio) and HTTP.
 *
 * One codebase, two transports:
 *   - MCP  : for Claude Desktop / Cursor / any MCP client (local or remote via Tailscale).
 *   - HTTP : generic POST /api/<method> for custom agents and the 300+ endpoint surface.
 *
 * Every call flows through ToolRegistry → SecurityPipeline. Each MCP connection
 * is registered as its own agent so multiple agents can share the browser.
 */

import * as http from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { ToolRegistry } from './registry';
import { registerAllTools } from './tools';
import { defaultConfig, bindHost } from './providers';
// Host / Origin / token checks shared with the MCP browser bridge and the native
// macOS bridge. require() of a CJS module from TS is fine here because the file
// is plain data and pure functions with no Node-only dependencies.
import { checkLocalRequest } from '../local-server-auth';
import { maybeHandleClientAdminRoute } from '../client-credentials';
import { loadOrCreateSessionToken } from '../session-token';
import type { AgentApiConfig, ToolContext, Bridge } from './types';
import type { SecurityPipeline } from '../guardrails';
import type { AgentRegistry } from '../agent/agent-registry';
import type { SnapshotManager } from '../snapshot/manager';
import type { AutofillVault } from '../autofill/vault';
import type { SearchProviderLike } from './bridge';

export interface AgentApiDeps {
  bridge: Bridge;
  security: SecurityPipeline;
  agents: AgentRegistry;
  snapshots: SnapshotManager;
  vault?: AutofillVault;
  extensions?: any;
  search?: SearchProviderLike;
  config?: Partial<AgentApiConfig>;
  pageAdapter?: any;
}

export class AgentApiServer {
  readonly registry = new ToolRegistry();
  readonly config: AgentApiConfig;
  private httpServer?: http.Server;
  /**
   * Per-process token required on every HTTP route. Generated at start unless
   * one was supplied in config, which is how a caller outside this process (a
   * custom agent) can be given a credential it must present.
   */
  sessionToken?: string;

  constructor(private deps: AgentApiDeps) {
    this.config = defaultConfig(deps.config);
    registerAllTools(this.registry);
  }

  private makeContext(agentId: string): ToolContext {
    return {
      agentId,
      bridge: this.deps.bridge,
      security: this.deps.security,
      agents: this.deps.agents,
      snapshots: this.deps.snapshots,
      vault: this.deps.vault,
      extensions: this.deps.extensions,
      search: this.deps.search,
      config: this.config,
    };
  }

  /** Resolve (and lazily register) the agent for a request. */
  private resolveAgent(agentId?: string): string {
    const id = agentId || `agent-${Math.random().toString(36).slice(2, 8)}`;
    if (!this.deps.agents.trust.get(id)) {
      this.deps.agents.connect({ id, name: id, trust: this.config.defaultTrust });
    }
    return id;
  }

  async callTool(name: string, args: any, agentId?: string) {
    const id = this.resolveAgent(agentId);
    const outcome = await this.registry.call(name, args, this.makeContext(id));
    if (outcome.error) {
      return { isError: true, content: [{ type: 'text', text: outcome.error }] };
    }
    return { isError: false, content: (outcome.result?.content ?? []).map((c) => ({ type: c.type === 'json' ? 'text' : c.type, text: c.text })) };
  }

  async startHttp(): Promise<void> {
    const host = bindHost(this.config);
    // A token is required even in the default loopback configuration: any page
    // open in any browser on this machine can reach 127.0.0.1. In remote mode it
    // is required too — there is no configuration in which this listener is open.
    // config.token wins when an operator set one; otherwise the persisted
    // ~/.aartiq-agent-token (mode 0600) keeps a configured client working across
    // restarts — see session-token.js.
    this.sessionToken = this.config.token || loadOrCreateSessionToken('agent');
    this.httpServer = http.createServer((req, res) => {
      const verdict = checkLocalRequest(req, {
        port: this.config.port,
        token: this.sessionToken as string,
        requireToken: true,
        allowRemote: this.config.remote === true,
        remoteHosts: this.config.remoteHosts,
        service: 'agent-api',
      });
      if (!verdict.ok) {
        // verdict.log contains the reason, method and path only — never a token.
        console.warn(`[agent-api] ${verdict.log}`);
        res.writeHead(verdict.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: verdict.code }));
        return;
      }
      // Per-client credentials: GET /clients, POST /clients, POST
      // /clients/revoke. Shared implementation; administration requires the
      // PRIMARY token (verdict.auth), so a client credential minted here can
      // never mint or revoke another.
      if (maybeHandleClientAdminRoute(req, res, { verdict })) return;
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, tools: this.registry.list().length, remote: this.config.remote }));
        return;
      }
      if (req.method === 'POST' && req.url?.startsWith('/api/')) {
        const method = req.url.slice(5).split('?')[0];
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          let args = {};
          try { args = body ? JSON.parse(body) : {}; } catch { /* ignore */ }
          // x-agent-id stays an identifier only. Authentication is the token
          // above; an unrecognised id is auto-registered, so it cannot be the
          // thing that decides whether a request is trusted.
          const agentId = req.headers['x-agent-id'] as string | undefined;
          const out = await this.callTool(method, args, agentId);
          res.writeHead(out.isError ? 400 : 200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(out));
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((resolve) => this.httpServer!.listen(this.config.port, host, resolve));
    console.error(`[agent-api] HTTP on ${host}:${this.config.port} (remote=${this.config.remote}, token required)`);
  }

  async startMcp(): Promise<void> {
    const server = new Server(
      { name: 'aartiq-agent-api', title: 'Aartiq Browser Agent API', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.registry.list().map((tl) => ({
      name: tl.name, description: tl.description, inputSchema: tl.inputSchema, annotations: tl.annotations,
    })) }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const agentId = (request.params as any)._meta?.agentId;
      return (await this.callTool(request.params.name, request.params.arguments || {}, agentId)) as any;
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[agent-api] MCP server started with ${this.registry.list().length} tools.`);
  }

  async start(): Promise<void> {
    if (this.config.enableHttp) await this.startHttp();
    if (this.config.enableMcp) await this.startMcp();
  }

  stop(): void {
    this.httpServer?.close();
  }
}
