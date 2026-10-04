"use strict";
/**
 * Model providers + remote access.
 *
 * Aartiq is model-agnostic. We expose OpenAI-compatible local endpoints so the
 * same agent layer works with LM Studio, Ollama, or any OpenAI-compatible server,
 * plus an OpenClaw local-agent bridge. Remote multi-agent access (e.g. over
 * Tailscale) is a bind-address decision, not a code fork.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenClawClient = void 0;
exports.defaultConfig = defaultConfig;
exports.resolveModelEndpoint = resolveModelEndpoint;
exports.bindHost = bindHost;
function defaultConfig(overrides = {}) {
    return {
        // 46204 since the port split: the native macOS bridge keeps 46203, so the
        // two defaults no longer collide and one silently loses the bind.
        port: 46204,
        host: '127.0.0.1',
        enableHttp: true,
        enableMcp: true,
        remote: false,
        lmStudio: { enabled: true, baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model' },
        ollama: { enabled: true, baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1' },
        openclaw: { enabled: false, baseUrl: 'http://127.0.0.1:18789' },
        defaultTrust: 'limited',
        ...overrides,
    };
}
function resolveModelEndpoint(config, preferred) {
    if (preferred === 'ollama' && config.ollama.enabled) {
        return { provider: 'ollama', baseURL: config.ollama.baseUrl, apiKey: 'ollama', model: config.ollama.model };
    }
    if (config.lmStudio.enabled) {
        return { provider: 'lmstudio', baseURL: config.lmStudio.baseUrl, apiKey: 'lmstudio', model: config.lmStudio.model };
    }
    return { provider: 'ollama', baseURL: config.ollama.baseUrl, apiKey: 'ollama', model: config.ollama.model };
}
/**
 * OpenClaw local-agent bridge. OpenClaw is a local model/agent runner; this client
 * forwards tasks to it and reads results. Network calls are isolated so a failure
 * never blocks the browser. All outputs from OpenClaw are treated as untrusted.
 */
class OpenClawClient {
    constructor(baseUrl, fetchImpl = fetch) {
        this.baseUrl = baseUrl;
        this.fetchImpl = fetchImpl;
    }
    async ping() {
        try {
            const res = await this.fetchImpl(`${this.baseUrl}/health`);
            return res.ok;
        }
        catch {
            return false;
        }
    }
    async runTask(task) {
        try {
            const res = await this.fetchImpl(`${this.baseUrl}/v1/tasks`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(task),
            });
            if (!res.ok)
                return { ok: false, error: `HTTP ${res.status}` };
            const data = (await res.json());
            return { ok: true, output: data?.output ?? data?.text ?? '' };
        }
        catch (e) {
            return { ok: false, error: e.message };
        }
    }
}
exports.OpenClawClient = OpenClawClient;
/**
 * Resolve the bind host: remote exposes on all interfaces (use Tailscale/LAN).
 *
 * `remote` must be exactly `true`. A truthy check here would let a hand-edited
 * settings file containing `"remote": "false"` open the listener to the network,
 * which is the opposite of what the operator wrote.
 */
function bindHost(config) {
    return config.remote === true ? '0.0.0.0' : config.host;
}
