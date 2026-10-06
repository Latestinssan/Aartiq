"use client";
import React, { useState, useEffect } from 'react';
import { Server, Plus, Trash2, Globe, Activity, Shield, Link as LinkIcon, Terminal, Key, Zap, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/useAppStore';
import { buildMcpRemoteServerConfig } from '@/lib/mcp-bridge-url';

interface ServerPreset {
    name: string;
    desc: string;
    type: 'stdio' | 'sse';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    requiresToken?: boolean;
    tokenEnvVar?: string;
    tokenPlaceholder?: string;
    authUrl?: string;
    authGuide?: string;
}

const SERVER_PRESETS: ServerPreset[] = [
    {
        name: 'Filesystem',
        desc: 'Read, write, and browse local files securely',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    },
    {
        name: 'GitHub',
        desc: 'Manage repositories, issues, PRs, and code',
        type: 'stdio',
        command: 'docker',
        args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'],
        env: { 'GITHUB_PERSONAL_ACCESS_TOKEN': '' },
        requiresToken: true,
        tokenEnvVar: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        tokenPlaceholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
        authUrl: 'https://github.com/settings/tokens/new?scopes=repo,read:org,read:user,user:email',
        authGuide: 'Create a classic token with repo and user scopes.',
    },
    {
        name: 'Slack',
        desc: 'Send messages, manage channels, and more',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@zencoderai/slack-mcp-server'],
        env: { 'SLACK_BOT_TOKEN': '', 'SLACK_TEAM_ID': '' },
        requiresToken: true,
        tokenEnvVar: 'SLACK_BOT_TOKEN',
        tokenPlaceholder: 'xoxb-xxxxxxxxxxxxxxxxxxxx',
        authUrl: 'https://api.slack.com/apps',
        authGuide: 'Create an app, add OAuth scope (chat:write, channels:read) and install.',
    },
    {
        name: 'Gmail',
        desc: 'Read, send, and manage emails',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@pouyanafisi/gmail-mcp'],
        env: { 'GMAIL_CREDENTIALS_PATH': '' },
        requiresToken: true,
        tokenEnvVar: 'GMAIL_CREDENTIALS_PATH',
        tokenPlaceholder: '/path/to/credentials.json',
        authUrl: 'https://console.cloud.google.com/apis/credentials',
        authGuide: 'Create OAuth Client ID (Desktop) and download JSON.',
    },
    {
        name: 'n8n Workflows',
        desc: 'Trigger and automate n8n workflows',
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'n8n-mcp'],
        env: { 'N8N_URL': '', 'N8N_API_KEY': '' },
        requiresToken: true,
        tokenEnvVar: 'N8N_URL',
        tokenPlaceholder: 'https://your-n8n-instance.com',
        authUrl: 'https://docs.n8n.io/integrations/builtin/credentials/n8n/',
        authGuide: 'Go to your n8n settings > API to generate a key.',
    },
    {
        name: 'Notion',
        desc: 'Connect your workspace to search, create, and update pages',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-notion'],
        env: { 'NOTION_API_KEY': '' },
        requiresToken: true,
        tokenEnvVar: 'NOTION_API_KEY',
        tokenPlaceholder: 'secret_xxxxxxxxxxxxxxxxxxxx',
        authUrl: 'https://www.notion.so/my-integrations',
        authGuide: 'Create an internal integration and copy the secret token.',
    },
    {
        name: 'Git',
        desc: 'Read, search, and manipulate Git repositories',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-git'],
    },
];

const McpSettings = () => {
    const store = useAppStore();
    const [isAdding, setIsAdding] = useState(false);
    const [selectedPreset, setSelectedPreset] = useState<ServerPreset | null>(null);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    /**
     * Per-process bridge token, returned over IPC by autoConfigureClaudeMcp.
     *
     * The manual-config snippets below have to carry it, because the bridge now
     * requires it on every route including /sse. A config without it still names
     * the right port but is answered with 401, which the client reports as a
     * bare connection failure.
     */
    const [mcpBridgeToken, setMcpBridgeToken] = useState<string | null>(null);
    const [newServer, setNewServer] = useState({
        name: '',
        type: 'sse' as 'sse' | 'stdio',
        url: '',
        command: '',
        args: '',
        envVars: [] as { key: string; value: string }[],
    } as { name: string; type: 'sse' | 'stdio'; url?: string; command: string; args: string; envVars: { key: string; value: string }[] });

    const handleAddPreset = (preset: ServerPreset) => {
        if (preset.requiresToken) {
            setSelectedPreset(preset);
            const envVars = preset.env ? Object.entries(preset.env).map(([key, value]) => ({ key, value })) : [];
            setNewServer({
                name: preset.name,
                type: preset.type,
                command: preset.command || '',
                args: preset.args?.join(' ') || '',
                envVars,
            });
            setIsAdding(true);
        } else {
            store.addMcpServer({
                name: preset.name,
                type: preset.type,
                command: preset.command,
                args: preset.args,
            });
        }
    };

    const handleAdd = () => {
        if (!newServer.name) return;
        
        if (newServer.type === 'stdio') {
            const env = newServer.envVars.reduce((acc, { key, value }) => {
                if (key && value) acc[key] = value;
                return acc;
            }, {} as Record<string, string>);
            
            store.addMcpServer({
                name: newServer.name,
                type: 'stdio',
                command: newServer.command,
                args: newServer.args.split(' ').filter(Boolean),
                env: Object.keys(env).length > 0 ? env : undefined,
            });
        } else {
            store.addMcpServer({
                name: newServer.name,
                type: 'sse',
                url: newServer.url,
            });
        }
        
        resetForm();
    };

    const resetForm = () => {
        setNewServer({ name: '', type: 'sse', url: '', command: '', args: '', envVars: [] });
        setSelectedPreset(null);
        setIsAdding(false);
    };

    // Single builder: the rendered snippet and the copy button cannot diverge,
    // and the token rides the env block, never the argument list.
    const mcpConfigSnippet = JSON.stringify({
        mcpServers: {
            "aartiq-browser": buildMcpRemoteServerConfig(3001, mcpBridgeToken)
        }
    }, null, 2);

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-bold text-white mb-1">MCP Servers</h3>
                    <p className="text-xs text-white/30">Connect to Model Context Protocol servers to provide the AI with extra tools and resources.</p>
                </div>
            </div>

            {/* ── Host MCP Server (for Claude Desktop) ─────── */}
            <div className="p-6 rounded-[2.5rem] bg-gradient-to-br from-sky-500/5 to-indigo-500/5 border border-sky-500/20 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-sky-500/15 flex items-center justify-center">
                            <Server size={20} className="text-sky-400" />
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-white">Aartiq MCP Host</h4>
                            <p className="text-[10px] text-white/40">Built-in browser server for Claude Desktop</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-green-400">Running</span>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-white/30">Endpoint</span>
                        <p className="text-xs font-mono text-sky-300 mt-1">http://localhost:3001/sse</p>
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-white/30">Port</span>
                        <p className="text-xs font-mono text-white mt-1">3001</p>
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-white/30">Available Tools</span>
                        <p className="text-xs font-mono text-white mt-1">12</p>
                    </div>
                </div>
                <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 space-y-2">
                    <div className="flex items-center gap-2 text-indigo-300">
                        <Terminal size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Claude Desktop Setup</span>
                    </div>
                    <p className="text-[11px] text-white/40 leading-relaxed">
                        Add this to your Claude Desktop config to control Aartiq from Claude.
                    </p>
                    {!mcpBridgeToken && (
                        <p className="text-[10px] leading-relaxed text-amber-300/80">
                            The config needs the session token. Click
                            Auto-Configure first — it fills the env block from
                            ~/.aartiq-mcp-token, so the snippet stays valid across
                            restarts. A config without it is answered with 401.
                        </p>
                    )}
                    <pre className="p-3 rounded-xl bg-black/40 border border-white/5 text-[10px] font-mono text-white/60 leading-relaxed overflow-x-auto">
{mcpConfigSnippet}
                    </pre>
                    {mcpBridgeToken && (
                        <p className="text-[10px] leading-relaxed text-white/40">
                            The token is stored in ~/.aartiq-mcp-token (mode 0600)
                            and survives restarts. Delete that file and restart
                            Aartiq to rotate it, then re-run Auto-Configure.
                        </p>
                    )}
                    <div className="flex gap-2">
                        <button
                            onClick={async () => {
                                if (window.electronAPI) {
                                    const res = await window.electronAPI.autoConfigureClaudeMcp();
                                    if (res.success) {
                                        setMcpBridgeToken((res as any).token || null);
                                        setStatusMsg('Claude Desktop config updated successfully');
                                    } else {
                                        setStatusMsg('Failed: ' + (res.error || 'unknown error'));
                                    }
                                    setTimeout(() => setStatusMsg(null), 4000);
                                }
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest text-indigo-300 transition-all"
                        >
                            <Zap size={14} /> Auto-Configure
                        </button>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(mcpConfigSnippet);
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest text-indigo-300 transition-all"
                        >
                            <ExternalLink size={14} /> Copy Config
                        </button>
                    </div>
                    {statusMsg && (
                        <div className="text-[10px] font-mono text-indigo-300/80 pt-1">
                            {statusMsg}
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {SERVER_PRESETS.map((preset) => (
                    <button
                        key={preset.name}
                        onClick={() => handleAddPreset(preset)}
                        className="p-5 rounded-[2rem] bg-white/[0.02] border border-white/5 hover:border-deep-space-accent-neon/30 hover:bg-deep-space-accent-neon/5 transition-all text-left flex flex-col gap-2 group relative overflow-hidden"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Terminal size={14} className="text-deep-space-accent-neon" />
                                <span className="text-white font-bold text-sm tracking-tight">{preset.name}</span>
                            </div>
                            <div className="p-1 px-2 rounded-lg bg-deep-space-accent-neon/10 text-deep-space-accent-neon text-[8px] font-black uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                                {preset.requiresToken ? 'Configure' : 'Add'}
                            </div>
                        </div>
                        <p className="text-white/30 text-[11px] leading-relaxed line-clamp-2">{preset.desc}</p>
                        {preset.requiresToken && (
                            <div className="flex items-center gap-1 text-amber-400/50 text-[9px] mt-1">
                                <Key size={10} />
                                <span>Requires token</span>
                            </div>
                        )}
                    </button>
                ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-white/5">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-white/40">Connected Servers</h4>
                <div className="flex gap-2">
                    <button
                        onClick={async () => {
                            if (window.electronAPI) {
                                for (const server of store.mcpServers) {
                                    const res = await window.electronAPI.mcpGetTools(server.id);
                                    if (res.success) {
                                        store.updateMcpServerTools(server.id, res.tools);
                                    }
                                }
                            }
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-white/60 transition-all"
                    >
                        <Activity size={14} /> Refresh All
                    </button>
                    <button
                        onClick={() => {
                            setSelectedPreset(null);
                            setNewServer({ name: '', type: 'stdio', url: '', command: '', args: '', envVars: [] });
                            setIsAdding(true);
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-deep-space-accent-neon/20 hover:bg-deep-space-accent-neon/30 border border-deep-space-accent-neon/30 rounded-xl text-[10px] font-black uppercase tracking-widest text-deep-space-accent-neon transition-all"
                    >
                        <Plus size={14} /> Custom Server
                    </button>
                </div>
            </div>

            <AnimatePresence>
                {isAdding && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/10 space-y-4 mb-6">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {selectedPreset ? (
                                        <>
                                            <Terminal size={16} className="text-deep-space-accent-neon" />
                                            <span className="text-white font-bold text-sm">{selectedPreset.name}</span>
                                            {selectedPreset.requiresToken && <Key size={12} className="text-amber-400" />}
                                        </>
                                    ) : (
                                        <>
                                            <Zap size={16} className="text-deep-space-accent-neon" />
                                            <span className="text-white font-bold text-sm">Custom Server</span>
                                        </>
                                    )}
                                </div>
                                <button
                                    onClick={resetForm}
                                    className="text-white/30 hover:text-white/60 text-[10px] font-bold uppercase tracking-widest"
                                >
                                    Cancel
                                </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-white/40 ml-1">Server Name</label>
                                    <input
                                        type="text"
                                        value={newServer.name}
                                        onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                                        placeholder="e.g. Local Database"
                                        className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-deep-space-accent-neon/50 transition-all placeholder:text-white/10"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-white/40 ml-1">Connection Type</label>
                                    <select
                                        value={newServer.type}
                                        onChange={(e) => setNewServer({ ...newServer, type: e.target.value as 'sse' | 'stdio' })}
                                        className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-deep-space-accent-neon/50 transition-all"
                                    >
                                        <option value="stdio">Stdio (Local Command)</option>
                                        <option value="sse">SSE (Remote Server)</option>
                                    </select>
                                </div>
                            </div>

                            {newServer.type === 'stdio' ? (
                                <>
                                    <div className="grid grid-cols-1 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-white/40 ml-1">Command</label>
                                            <input
                                                type="text"
                                                value={newServer.command}
                                                onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
                                                placeholder="e.g. npx, docker, node"
                                                className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-deep-space-accent-neon/50 transition-all placeholder:text-white/10"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-white/40 ml-1">Arguments (space-separated)</label>
                                            <input
                                                type="text"
                                                value={newServer.args}
                                                onChange={(e) => setNewServer({ ...newServer, args: e.target.value })}
                                                placeholder="e.g. -y @modelcontextprotocol/server-filesystem ."
                                                className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-deep-space-accent-neon/50 transition-all placeholder:text-white/10"
                                            />
                                        </div>
                                    </div>

                                    {newServer.envVars.length > 0 && (
                                        <div className="space-y-3 pt-4 border-t border-white/5">
                                            {selectedPreset?.authUrl && (
                                                <div className="flex items-start gap-3 p-3 rounded-xl bg-deep-space-accent-neon/5 border border-deep-space-accent-neon/10 mb-2">
                                                    <div className="flex-1 space-y-1">
                                                        <h5 className="text-[11px] font-bold text-white">Need a token?</h5>
                                                        <p className="text-[10px] text-white/50">{selectedPreset.authGuide}</p>
                                                    </div>
                                                    <button
                                                        onClick={() => window.electronAPI?.openExternalUrl(selectedPreset.authUrl!)}
                                                        className="px-3 py-1.5 bg-deep-space-accent-neon text-black text-[10px] font-bold rounded-lg hover:bg-white transition-all whitespace-nowrap flex items-center gap-1"
                                                    >
                                                        <Globe size={12} /> Get Token
                                                    </button>
                                                </div>
                                            )}
                                            
                                            <div className="flex items-center justify-between">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Environment Variables</label>
                                                <button
                                                    onClick={() => setNewServer({ ...newServer, envVars: [...newServer.envVars, { key: '', value: '' }] })}
                                                    className="text-[9px] font-bold text-deep-space-accent-neon hover:text-white transition-all"
                                                >
                                                    + Add Variable
                                                </button>
                                            </div>
                                            {newServer.envVars.map((envVar, index) => (
                                                <div key={index} className="grid grid-cols-2 gap-2">
                                                    <input
                                                        type="text"
                                                        value={envVar.key}
                                                        onChange={(e) => {
                                                            const newEnvVars = [...newServer.envVars];
                                                            newEnvVars[index].key = e.target.value;
                                                            setNewServer({ ...newServer, envVars: newEnvVars });
                                                        }}
                                                        placeholder="VARIABLE_NAME"
                                                        className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-deep-space-accent-neon/50 transition-all placeholder:text-white/10 font-mono"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={envVar.value}
                                                        onChange={(e) => {
                                                            const newEnvVars = [...newServer.envVars];
                                                            newEnvVars[index].value = e.target.value;
                                                            setNewServer({ ...newServer, envVars: newEnvVars });
                                                        }}
                                                        placeholder={selectedPreset?.tokenPlaceholder || 'value'}
                                                        className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-deep-space-accent-neon/50 transition-all placeholder:text-white/10 font-mono"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-white/40 ml-1">Server URL</label>
                                    <input
                                        type="text"
                                        value={newServer.url}
                                        onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                                        placeholder="http://localhost:3000/mcp"
                                        className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-deep-space-accent-neon/50 transition-all placeholder:text-white/10"
                                    />
                                </div>
                            )}

                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    onClick={resetForm}
                                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAdd}
                                    className="px-6 py-2 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-deep-space-accent-neon hover:text-black transition-all shadow-xl"
                                >
                                    Connect Server
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="grid grid-cols-1 gap-4">
                {store.mcpServers.length === 0 ? (
                    <div className="py-20 text-center bg-white/[0.01] border border-dashed border-white/5 rounded-[3rem]">
                        <Server size={48} className="mx-auto mb-4 text-white/10" />
                        <p className="text-xs text-white/20">No MCP servers connected.</p>
                        <p className="text-[10px] text-white/10 uppercase font-black mt-2 tracking-widest">Connect your first server to expand AI capabilities</p>
                    </div>
                ) : (
                    <AnimatePresence>
                        {store.mcpServers.map((server) => (
                            <motion.div
                                key={server.id}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="p-6 rounded-[2.5rem] bg-white/[0.02] border border-white/5 flex flex-col gap-4 group hover:bg-white/[0.04] transition-all relative overflow-hidden"
                            >
                                <div className="flex items-center gap-6">
                                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl transition-all ${server.status === 'online' ? 'bg-green-500/10 text-green-500' :
                                        server.status === 'connecting' ? 'bg-sky-500/10 text-sky-500 animate-pulse' :
                                            'bg-red-500/10 text-red-500'
                                        }`}>
                                        <Server size={24} />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-3 mb-1">
                                            <h4 className="font-bold text-white text-base truncate">{server.name}</h4>
                                            <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${server.status === 'online' ? 'bg-green-500/10 text-green-500' :
                                                server.status === 'connecting' ? 'bg-sky-500/10 text-sky-500' :
                                                    'bg-red-500/10 text-red-500'
                                                }`}>
                                                {server.status}
                                            </div>
                                        </div>
                                        {server.type === 'stdio' ? (
                                            <div className="flex items-center gap-2 text-white/30 truncate">
                                                <Terminal size={12} />
                                                <span className="text-[11px] font-medium truncate font-mono">
                                                    {server.command} {server.args?.join(' ')}
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 text-white/30 truncate">
                                                <LinkIcon size={12} />
                                                <span className="text-[11px] font-medium truncate">{server.url}</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={async () => {
                                                if (window.electronAPI) {
                                                    const res = await window.electronAPI.mcpGetTools(server.id);
                                                    if (res.success) {
                                                        store.updateMcpServerTools(server.id, res.tools);
                                                    }
                                                }
                                            }}
                                            className="p-3 rounded-2xl bg-white/5 text-white/40 hover:bg-white/10 hover:text-white transition-all border border-white/5"
                                            title="Refresh Tools"
                                        >
                                            <Activity size={18} />
                                        </button>
                                        <button
                                            onClick={() => store.removeMcpServer(server.id)}
                                            className="p-3 rounded-2xl bg-red-500/5 text-red-500/40 hover:bg-red-500/20 hover:text-red-400 transition-all border border-red-500/10"
                                            title="Disconnect Server"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>

                                {server.tools && server.tools.length > 0 && (
                                    <div className="pt-4 border-t border-white/5">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-white/20 mb-3 ml-1">Available Tools ({server.tools.length})</p>
                                        <div className="flex flex-wrap gap-2">
                                            {server.tools.map((tool: any) => (
                                                <div key={tool.name} className="px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/5 text-[10px] text-white/50 hover:bg-white/5 hover:text-white transition-all cursor-help" title={tool.description}>
                                                    <span className="font-bold">{tool.name}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        ))}
                    </AnimatePresence>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                <div className="p-6 rounded-3xl bg-sky-500/5 border border-sky-500/10 space-y-3">
                    <div className="flex items-center gap-3 text-sky-400">
                        <Activity size={20} />
                        <span className="text-xs font-bold uppercase tracking-tight">Real-time Context</span>
                    </div>
                    <p className="text-[11px] text-white/40 leading-relaxed">
                        MCP allows the AI to query your local environment, databases, and third-party APIs in real-time without leaving the browser.
                    </p>
                </div>
                <div className="p-6 rounded-3xl bg-purple-500/5 border border-purple-500/10 space-y-3">
                    <div className="flex items-center gap-3 text-purple-400">
                        <Shield size={20} />
                        <span className="text-xs font-bold uppercase tracking-tight">Granular Consent</span>
                    </div>
                    <p className="text-[11px] text-white/40 leading-relaxed">
                        Every tool provided by an MCP server requires manual authorization when the AI attempts to use it for the first time.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default McpSettings;
