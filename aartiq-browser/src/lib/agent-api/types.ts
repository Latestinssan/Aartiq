/**
 * Agent API — shared types for the tool registry and bridge.
 *
 * Feature managers (snapshot, autofill, extensions, agents, guardrails) live in
 * the browser main process. This registry exposes them as tools to MCP clients
 * and the HTTP API, routing every call through the SecurityPipeline.
 */

import type { Verb } from '../guardrails/origin-guard';
import type { SecurityPipeline } from '../guardrails';
import type { AgentRegistry } from '../agent/agent-registry';
import type { SnapshotManager } from '../snapshot/manager';
import type { AutofillVault } from '../autofill/vault';
import type { ChromeExtensionManager } from '../extensions/ChromeExtensionManager';
import type { SearchProviderLike } from './bridge';

export interface Bridge {
  call<T = any>(method: string, args?: any): Promise<T>;
  listMethods(): string[];
}

export interface AgentApiConfig {
  port: number;
  host: string;
  enableHttp: boolean;
  enableMcp: boolean;
  /** Bind to 0.0.0.0 to expose over Tailscale / LAN. Off by default. */
  remote: boolean;
  /**
   * Token required on every HTTP route. Generated per process when absent.
   *
   * Supply one only to give a caller outside this process a stable credential;
   * an unset token still means every request is authenticated, not that requests
   * are open.
   */
  token?: string;
  /** Hostnames accepted in the Host header when `remote` is on. */
  remoteHosts?: string[];
  lmStudio: { enabled: boolean; baseUrl: string; model: string };
  ollama: { enabled: boolean; baseUrl: string; model: string };
  openclaw: { enabled: boolean; baseUrl: string };
  defaultTrust: 'untrusted' | 'limited' | 'standard' | 'privileged';
}

export interface ToolContext {
  agentId: string;
  bridge: Bridge;
  security: SecurityPipeline;
  agents: AgentRegistry;
  snapshots: SnapshotManager;
  vault?: AutofillVault;
  extensions?: ChromeExtensionManager;
  /**
   * Web/news search. Optional on purpose: an absent provider must not be a crash
   * but a plain-text "not configured" answer, so the model can report it instead
   * of silently losing the capability.
   */
  search?: SearchProviderLike;
  config: AgentApiConfig;
}

export interface ToolResult {
  content: Array<{ type: 'text' | 'json'; text: string }>;
  isError?: boolean;
}

export interface Tool {
  name: string;
  category: string;
  description: string;
  inputSchema: Record<string, any>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  /** Output may hold attacker-controlled web content → scan it. */
  untrustedOutput?: boolean;
  /** Side-effecting verb → origin-guard + agent trust + tab lock. */
  verb?: Verb;
  /** Acquire a tab lock for the target tab before acting. */
  requiresTabLock?: boolean;
  handler: (args: any, ctx: ToolContext) => Promise<ToolResult> | ToolResult;
}

export interface CallOutcome {
  result?: ToolResult;
  error?: string;
  injection?: import('../guardrails/prompt-injection').IpiVerdict;
  gate?: { allowed: boolean; requiresApproval: boolean; reason: string };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: 'json', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}
