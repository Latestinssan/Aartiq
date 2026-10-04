"use strict";
/**
 * Prompt-injection guard — defense-in-depth.
 *
 * Three independent layers, modeled after the Cognitive Firewall (arXiv 2603.23791),
 * BrowseSafe (arXiv 2511.20597), OWASP LLM guidance and Microsoft Zero-Trust:
 *
 *   Layer 1  Sentinel   — deterministic, sub-millisecond DOM/visual/text heuristics.
 *                         Hidden text, invisible Unicode, encoded payloads, override
 *                         phrases, exfiltration URLs.
 *   Layer 2  Semantic   — intent analysis (role override, goal hijack, fabricated
 *                         urgency, data exfiltration, multi-turn drift). A pluggable
 *                         critic (LLM) may raise or lower confidence; a deterministic
 *                         heuristic fallback is always applied so the layer never
 *                         degenerates into "allow".
 *   Layer 3  Execution  — handled by OriginGuard (separate module). This module emits
 *                         the verdict; the caller enforces it.
 *
 * Design rules:
 *   - Deterministic layers must never depend on an external service to *block*.
 *   - Fail closed: on uncertainty we quarantine, not allow.
 *   - Untrusted tool outputs get their own trust-boundary scan (see scanToolOutput).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultPromptInjectionGuard = exports.PromptInjectionGuard = void 0;
const SENTINEL_THRESHOLD = 0.62;
const SEMANTIC_THRESHOLD = 0.55;
// Invisible / zero-width code points that are never legitimate in normal prose.
const INVISIBLE_RE = /[​-‍﻿⁠　⠀-⠿﻿]/g;
// Encoded payloads: base64-looking blobs, hex escapes, JS/unicode escapes.
const ENCODED_RE = [
    /(?:[A-Za-z0-9+/]{24,}={0,2})/g, // long base64
    /(?:\\x[0-9a-fA-F]{2}){4,}/g, // \x.. sequences
    /(?:\\u[0-9a-fA-F]{4}){3,}/g, // \u.... sequences
    /%[0-9a-fA-F]{2}(?:%[0-9a-fA-F]{2}){3,}/g, // url-encoded runs
];
// Direct instruction-override patterns (the classic "ignore previous instructions").
const OVERRIDE_PATTERNS = [
    { re: /\bignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|messages?|context)\b/gi, weight: 0.9, label: 'instruction-override' },
    { re: /\bdisregard\s+(everything|all|the|your)\s+(above|prior|previous|instructions?)\b/gi, weight: 0.9, label: 'instruction-override' },
    { re: /\byou\s+are\s+now\s+([a-z0-9 ]{2,30}?)\b(?!\s*[\.(])/gi, weight: 0.7, label: 'role-switch' },
    { re: /\bnew\s+instructions?\b.{0,40}?\b(follow|obey|must)\b/gi, weight: 0.6, label: 'role-switch' },
    { re: /\bsystem\s+prompt\b.{0,30}?\b(reveal|print|show|leak|dump)\b/gi, weight: 0.85, label: 'system-prompt-leak' },
    { re: /\b(repeat|print|output|echo|show)\b.{0,20}?\b(system\s+prompt|your\s+instructions?|developer\s+message)\b/gi, weight: 0.8, label: 'system-prompt-leak' },
];
// Data exfiltration signals: send/forward/POST to an external destination.
const EXFIL_PATTERNS = [
    { re: /\b(send|forward|post|upload|exfil|transmit|email|slack|telegram|discord)\b.{0,40}?\b(to|at)\b.{0,40}?\b([a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/[^\s"'<>]+|tg:\/\/|discord\.[a-z]+)\b/gi, weight: 0.9, label: 'data-exfiltration' },
    { re: /\b(curl|wget|fetch)\b.{0,40}?https?:\/\/[^\s"'<>]+/gi, weight: 0.7, label: 'data-exfiltration' },
    { re: /\b(api[_-]?key|password|token|secret|credential)\b.{0,30}?\b(send|forward|post|upload|to)\b/gi, weight: 0.85, label: 'secret-exfiltration' },
];
// Fabricated urgency / authority used to bypass caution.
const URGENCY_PATTERNS = [
    { re: /\b(urgent|immediately|right now|asap|critical|emergency|override|do not tell|don'?t tell|without asking|skip (the|any) (confirmation|approval|warning))\b/gi, weight: 0.45, label: 'fabricated-urgency' },
    { re: /\b(admin|administrator|developer|maintainer|creator|the (system|owner))\b.{0,30}?\b(requires|commands|says|told you|has authorized|authorized)\b/gi, weight: 0.5, label: 'authority-impersonation' },
];
// Hidden-content markers that would only appear in raw HTML/DOM, not rendered text.
const HIDDEN_MARKUP_RE = [
    /<[^>]*\bstyle\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|z-index\s*:\s*-?\d+|position\s*:\s*absolute[^>]*top\s*:\s*-?\d+|height\s*:\s*0|width\s*:\s*0)[^"']*["']/gi,
    /<!--[\s\S]{0,500}?(ignore|instruction|system|prompt|admin|password|send|exfil)[\s\S]{0,500}?-->/gi,
    /\b(hidden|aria-hidden)\b[^>]*>/gi,
];
// Tools whose output is, by definition, attacker-influenced web content.
const UNTRUSTED_TOOL_RE = /^(getPageContent|readPage|snapshot|getHTML|getNetworkLog|getConsoleLogs|fetch|webRequest|extractContent|getLinks|screenshot|domQuery|search|navigate)$/i;
function clamp01(n) {
    return Math.max(0, Math.min(1, n));
}
class PromptInjectionGuard {
    constructor() {
        this.critic = null;
        this.sentinelThreshold = SENTINEL_THRESHOLD;
        this.semanticThreshold = SEMANTIC_THRESHOLD;
    }
    /** Register an optional LLM critic. Deterministic fallback still runs. */
    setCritic(critic) {
        this.critic = critic;
    }
    setThresholds(sentinel, semantic) {
        if (typeof sentinel === 'number')
            this.sentinelThreshold = clamp01(sentinel);
        if (typeof semantic === 'number')
            this.semanticThreshold = clamp01(semantic);
    }
    /**
     * Layer 1: deterministic sentinel. Returns threats + a normalized,
     * zero-width-stripped copy of the input.
     */
    sentinelScan(input) {
        const threats = [];
        let normalized = input;
        // Invisible Unicode — strip and flag.
        const invisibles = input.match(INVISIBLE_RE);
        if (invisibles) {
            threats.push({
                layer: 'sentinel',
                kind: 'invisible-unicode',
                detail: `Found ${invisibles.length} invisible/zero-width character(s).`,
                severity: clamp01(0.2 + invisibles.length * 0.05),
            });
            normalized = normalized.replace(INVISIBLE_RE, '');
        }
        // Encoded payloads.
        for (const re of ENCODED_RE) {
            const m = input.match(re);
            if (m) {
                threats.push({
                    layer: 'sentinel',
                    kind: 'encoded-payload',
                    detail: `Encoded payload detected (${m.length} match(es)).`,
                    severity: 0.6,
                });
                break;
            }
        }
        // Hidden markup / comments (only relevant for raw HTML/DOM input).
        for (const re of HIDDEN_MARKUP_RE) {
            const m = input.match(re);
            if (m) {
                threats.push({
                    layer: 'sentinel',
                    kind: 'hidden-content',
                    detail: 'Hidden or comment-embedded content detected.',
                    severity: 0.55,
                });
                break;
            }
        }
        for (const p of OVERRIDE_PATTERNS) {
            const m = p.re.exec(input);
            if (m) {
                threats.push({ layer: 'sentinel', kind: p.label, detail: `Matched: "${m[0].slice(0, 80)}"`, severity: p.weight, start: m.index, end: m.index + m[0].length });
            }
        }
        for (const p of EXFIL_PATTERNS) {
            const m = p.re.exec(input);
            if (m) {
                threats.push({ layer: 'sentinel', kind: p.label, detail: `Matched: "${m[0].slice(0, 80)}"`, severity: p.weight, start: m.index, end: m.index + m[0].length });
            }
        }
        for (const p of URGENCY_PATTERNS) {
            const m = p.re.exec(input);
            if (m) {
                threats.push({ layer: 'sentinel', kind: p.label, detail: `Matched: "${m[0].slice(0, 80)}"`, severity: p.weight, start: m.index, end: m.index + m[0].length });
            }
        }
        return { threats, normalized };
    }
    /**
     * Layer 2: semantic intent analysis. Combines deterministic heuristics with an
     * optional critic score. Never returns "allow" purely because the critic said so.
     */
    async semanticScan(input, normalized, sentinelThreats, context) {
        const threats = [];
        let score = 0;
        const hasOverride = sentinelThreats.some((t) => t.kind === 'instruction-override' || t.kind === 'role-switch');
        const hasExfil = sentinelThreats.some((t) => t.kind.includes('exfil'));
        const hasUrgency = sentinelThreats.some((t) => t.kind === 'fabricated-urgency' || t.kind === 'authority-impersonation');
        const hasLeak = sentinelThreats.some((t) => t.kind === 'system-prompt-leak');
        // Combined-intent escalation: override + (exfil | leak) is the dangerous shape.
        if (hasOverride && (hasExfil || hasLeak)) {
            score = Math.max(score, 0.95);
            threats.push({ layer: 'semantic', kind: 'goal-hijack-with-exfil', detail: 'Instruction override combined with exfiltration/leak intent.', severity: 0.95 });
        }
        else if (hasOverride && hasUrgency) {
            score = Math.max(score, 0.8);
            threats.push({ layer: 'semantic', kind: 'override-with-urgency', detail: 'Instruction override pushed with fabricated urgency.', severity: 0.8 });
        }
        else if (hasLeak) {
            score = Math.max(score, 0.85);
        }
        else if (hasOverride) {
            score = Math.max(score, 0.7);
        }
        else if (hasExfil) {
            score = Math.max(score, 0.75);
        }
        // Goal-hijack / drift vs. the user's stated goal.
        if (context?.userGoal && (hasOverride || hasExfil)) {
            const goal = context.userGoal.toLowerCase();
            const body = normalized.toLowerCase();
            const goalWords = goal.split(/\s+/).filter((w) => w.length > 4);
            const overlap = goalWords.filter((w) => body.includes(w)).length;
            if (goalWords.length > 0 && overlap / goalWords.length < 0.34) {
                score = Math.max(score, 0.7);
                threats.push({ layer: 'semantic', kind: 'goal-drift', detail: 'Content intent diverges from the user goal.', severity: 0.7 });
            }
        }
        // Optional critic (LLM). Used only to *raise* confidence of a real threat.
        if (this.critic) {
            try {
                const c = await this.critic(normalized, context);
                if (c > score) {
                    score = clamp01(c);
                    threats.push({ layer: 'semantic', kind: 'critic-flag', detail: `External critic scored ${c.toFixed(2)}.`, severity: clamp01(c) });
                }
            }
            catch {
                // Critic failure must not weaken the deterministic verdict.
            }
        }
        return { threats, score: clamp01(score) };
    }
    /**
     * Full scan. Always runs sentinel + semantic. Returns a verdict the caller must
     * enforce. `quarantine` produces a token so the caller can substitute a safe
     * placeholder (per BrowseSafe's type-safe substitution) instead of the raw text.
     */
    async scan(input, context) {
        const { threats: sentinelThreats, normalized } = this.sentinelScan(input);
        const sentinelScore = sentinelThreats.reduce((m, t) => Math.max(m, t.severity), 0);
        const { threats: semanticThreats, score: semanticScore } = await this.semanticScan(input, normalized, sentinelThreats, context);
        const threats = [...sentinelThreats, ...semanticThreats];
        const overall = clamp01(Math.max(sentinelScore, semanticScore));
        let action = 'allow';
        let triggeredLayer = 'none';
        if (sentinelScore >= this.sentinelThreshold || semanticScore >= this.semanticThreshold) {
            triggeredLayer = semanticScore >= sentinelScore ? 'semantic' : 'sentinel';
            // Override + exfil, or any near-certain threat → hard block.
            if (overall >= 0.9) {
                action = 'block';
            }
            else if (overall >= this.semanticThreshold) {
                // Ambiguous: quarantine so the model can continue safely without the payload.
                action = 'quarantine';
            }
            else {
                action = 'sanitize';
            }
        }
        const safe = action === 'allow';
        const verdict = {
            safe,
            action,
            score: overall,
            threats,
            sanitized: normalized,
            triggeredLayer,
        };
        if (action === 'quarantine' || action === 'block') {
            verdict.quarantineToken = `<<CONTENT_WITHHELD: prompt-injection-risk score=${overall.toFixed(2)}>>`;
        }
        return verdict;
    }
    /**
     * Trust-boundary scan for tool outputs. Tools that return web-influenced content
     * are flagged; their output is scanned and, on detection, replaced with a safe
     * placeholder so poisoned data never reaches the planning model.
     */
    async scanToolOutput(toolName, output, context) {
        const isUntrustedSource = UNTRUSTED_TOOL_RE.test(toolName) || context?.untrusted === true;
        if (!isUntrustedSource) {
            return { safe: true, action: 'allow', score: 0, threats: [], sanitized: output, triggeredLayer: 'none' };
        }
        return this.scan(output, { ...context, untrusted: true });
    }
}
exports.PromptInjectionGuard = PromptInjectionGuard;
exports.defaultPromptInjectionGuard = new PromptInjectionGuard();
