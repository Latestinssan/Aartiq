"use strict";
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
exports.AgentApiServer = void 0;
const http = __importStar(require("http"));
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const registry_1 = require("./registry");
const tools_1 = require("./tools");
const providers_1 = require("./providers");
// Host / Origin / token checks shared with the MCP browser bridge and the native
// macOS bridge. require() of a CJS module from TS is fine here because the file
// is plain data and pure functions with no Node-only dependencies.
const local_server_auth_1 = require("../local-server-auth");
const client_credentials_1 = require("../client-credentials");
const session_token_1 = require("../session-token");
class AgentApiServer {
    constructor(deps) {
        this.deps = deps;
        this.registry = new registry_1.ToolRegistry();
        this.config = (0, providers_1.defaultConfig)(deps.config);
        (0, tools_1.registerAllTools)(this.registry);
    }
    makeContext(agentId) {
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
    resolveAgent(agentId) {
        const id = agentId || `agent-${Math.random().toString(36).slice(2, 8)}`;
        if (!this.deps.agents.trust.get(id)) {
            this.deps.agents.connect({ id, name: id, trust: this.config.defaultTrust });
        }
        return id;
    }
    async callTool(name, args, agentId) {
        const id = this.resolveAgent(agentId);
        const outcome = await this.registry.call(name, args, this.makeContext(id));
        if (outcome.error) {
            return { isError: true, content: [{ type: 'text', text: outcome.error }] };
        }
        return { isError: false, content: (outcome.result?.content ?? []).map((c) => ({ type: c.type === 'json' ? 'text' : c.type, text: c.text })) };
    }
    async startHttp() {
        const host = (0, providers_1.bindHost)(this.config);
        // A token is required even in the default loopback configuration: any page
        // open in any browser on this machine can reach 127.0.0.1. In remote mode it
        // is required too — there is no configuration in which this listener is open.
        // config.token wins when an operator set one; otherwise the persisted
        // ~/.aartiq-agent-token (mode 0600) keeps a configured client working across
        // restarts — see session-token.js.
        this.sessionToken = this.config.token || (0, session_token_1.loadOrCreateSessionToken)('agent');
        this.httpServer = http.createServer((req, res) => {
            const verdict = (0, local_server_auth_1.checkLocalRequest)(req, {
                port: this.config.port,
                token: this.sessionToken,
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
            if ((0, client_credentials_1.maybeHandleClientAdminRoute)(req, res, { verdict }))
                return;
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
                    try {
                        args = body ? JSON.parse(body) : {};
                    }
                    catch { /* ignore */ }
                    // x-agent-id stays an identifier only. Authentication is the token
                    // above; an unrecognised id is auto-registered, so it cannot be the
                    // thing that decides whether a request is trusted.
                    const agentId = req.headers['x-agent-id'];
                    const out = await this.callTool(method, args, agentId);
                    res.writeHead(out.isError ? 400 : 200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify(out));
                });
                return;
            }
            res.writeHead(404);
            res.end();
        });
        await new Promise((resolve) => this.httpServer.listen(this.config.port, host, resolve));
        console.error(`[agent-api] HTTP on ${host}:${this.config.port} (remote=${this.config.remote}, token required)`);
    }
    async startMcp() {
        const server = new index_js_1.Server({ name: 'aartiq-agent-api', title: 'Aartiq Browser Agent API', version: '1.0.0' }, { capabilities: { tools: {} } });
        server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({ tools: this.registry.list().map((tl) => ({
                name: tl.name, description: tl.description, inputSchema: tl.inputSchema, annotations: tl.annotations,
            })) }));
        server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            const agentId = request.params._meta?.agentId;
            return (await this.callTool(request.params.name, request.params.arguments || {}, agentId));
        });
        const transport = new stdio_js_1.StdioServerTransport();
        await server.connect(transport);
        console.error(`[agent-api] MCP server started with ${this.registry.list().length} tools.`);
    }
    async start() {
        if (this.config.enableHttp)
            await this.startHttp();
        if (this.config.enableMcp)
            await this.startMcp();
    }
    stop() {
        this.httpServer?.close();
    }
}
exports.AgentApiServer = AgentApiServer;
