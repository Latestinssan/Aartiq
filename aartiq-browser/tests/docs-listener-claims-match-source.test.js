/**
 * docs-listener-claims-match-source.test.js
 *
 * The 2026-10 documentation-honesty audit (docs-audit/mismatch-inventory.md,
 * M1/M2/M7/M8/M9/M11/M12/M17/M20/M21) found pages that were internally
 * plausible and wrong relative to the source: an MCP bridge described as bound
 * to every interface after the code had resolved its host, "every local
 * listener requires a per-process token" while two listeners have no token,
 * a critical-tier card describing a ticket flow that only MCP tools reach, a
 * stat card counting enforcement layers the README itself says are two, and
 * tool counts typed from a feature branch rather than read from the registry.
 *
 * Each of those claims has now been corrected on the landing page. This test
 * pins the corrected claims to the source that made them correct, so the
 * regression is caught here rather than in a bug report:
 *
 *   - the bind claims are checked against resolveBindHost / the absence of a
 *     token check in WiFiSyncService, not against prose;
 *   - the tool counts are computed from tools.ts and server/index.js at test
 *     time and compared with the published strings, so a tool added to the
 *     registry fails the gate until the page is regenerated;
 *   - the approval-flow claims are checked for the phrases the audit retired.
 *
 * Nothing is mocked and nothing is snapshotted: counts are derived, claims are
 * compared. A page edit that reintroduces a retired claim, or a source edit
 * that invalidates a corrected one, fails here.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');           // aartiq-browser/
const AROOT = path.join(REPO, '..');               // repo root
const LANDING = process.env.AARTIQ_LANDING_DIR ||
  path.join(AROOT, '..', 'Aartiq-Landing-Page');   // sibling checkout

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const MCP_PAGE = read(LANDING, 'src/app/mcp-settings/page.tsx');
const SEARCH_IDX = read(LANDING, 'src/lib/search-index.ts');
const SECURITY = read(LANDING, 'src/app/docs/security/page.tsx');
const SKILLS = read(LANDING, 'src/app/docs/skills/page.tsx');
const FEATURES = read(LANDING, 'src/app/features/page.tsx');
const OVERVIEW = read(LANDING, 'src/app/docs/overview/page.tsx');
const README = read(AROOT, 'README.md');
const CHANGELOG = read(REPO, 'CHANGELOG.md');
const MCP_SERVER_SRC = read(REPO, 'src/lib/mcp-browser-server.js');
const WIFI_SRC = read(REPO, 'src/lib/WiFiSyncService.ts');
const TOOLS_TS = read(REPO, 'src/lib/agent-api/tools.ts');
const MCP_INDEX = read(AROOT, 'aartiq-mcp', 'server', 'index.js');

// --- counts derived from source, never typed --------------------------------
const agentTools = [...TOOLS_TS.matchAll(/^\s+name: '([a-z_0-9]+)'/gm)].length;
const agentCats = new Set(
  [...TOOLS_TS.matchAll(/category: '([A-Za-z]+)'/g)].map((m) => m[1]),
).size;
const toolsTsLines = TOOLS_TS.split('\n').length;

const mcpToolsStart = MCP_INDEX.indexOf('const TOOLS = [');
const mcpToolsEnd = MCP_INDEX.indexOf('];', mcpToolsStart);
const mcpTools = mcpToolsStart >= 0
  ? [...MCP_INDEX.slice(mcpToolsStart, mcpToolsEnd).matchAll(/^\s*name: '([a-z_0-9]+)'/gm)].length
  : -1;
const mcpCats = [...MCP_INDEX.matchAll(/\/\/ CATEGORY \d+:/g)].length;

describe('docs listener / count claims match source', () => {
  test('M1: the MCP bridge page describes the loopback default the code implements', () => {
    expect(MCP_SERVER_SRC).toMatch(/listen\(port, host/); // resolveBindHost is passed through
    expect(MCP_PAGE).toMatch(/security_mcpBridgeRemote/);
    expect(MCP_PAGE).toMatch(/resolveBindHost|1678-1681/);
    expect(MCP_PAGE).not.toMatch(/no host argument/);
    expect(MCP_PAGE).not.toMatch(/LAN-reachable until that changes/);
    expect(MCP_PAGE).not.toMatch(/accepts connections from any interface/);
  });

  test('M1: search-index no longer says the MCP bridge listens on every interface', () => {
    expect(SEARCH_IDX).not.toMatch(/listens on every interface/);
    expect(SEARCH_IDX).toMatch(/bind loopback by default/);
  });

  test('M2: the security page enumerates tokened listeners instead of claiming every listener has a token', () => {
    expect(SECURITY).not.toMatch(/Every local listener requires/);
    expect(SECURITY).toMatch(/carry no token/);
    // Tie the claim to the source: while WiFiSyncService has no token check,
    // the page must keep stating that 3004/3999 are unauthenticated.
    const wifiHasAuth = /local-server-auth|requireToken|per-process token/i.test(WIFI_SRC);
    if (!wifiHasAuth) {
      expect(SECURITY).toMatch(/WiFi sync and PDF sync listeners carry no token/);
    }
  });

  test('M7: the QR section no longer claims the flow is used for two things only', () => {
    expect(SECURITY).not.toMatch(/used for two things only/);
    expect(SECURITY).not.toMatch(/A high-risk command typed at the desktop does not go through it/);
    expect(SECURITY).toMatch(/ClickPermissionModal/);
  });

  test('M8: the page presents two labeled approval tables', () => {
    expect(SECURITY).toMatch(/Approval — AI browser actions/);
    expect(SECURITY).toMatch(/Shell commands are classified into one of four risk tiers/);
    expect(SECURITY).toMatch(/shell-tiers\.generated\.json/);
  });

  test('M9: the critical tier does not claim a ticket-based flow, and no tier badge claims auto-approval', () => {
    expect(SECURITY).not.toMatch(/Routed through the capability controller's ticket-based flow/);
    expect(SECURITY).toMatch(/plain Allow \/ Deny/);
    expect(SECURITY).toMatch(/not a ticket/);
    expect(SECURITY.match(/badge: "Auto-approved"/g) || []).toHaveLength(0);
  });

  test('M11: the enforcement-layer count matches the README security model', () => {
    expect(SECURITY).not.toMatch(/Enforcement Layers Beyond The Firewall/);
    expect(SECURITY).not.toMatch(/six independent security layers/);
    expect(SECURITY).toMatch(/Enforcement Boundaries \(OS-applied\)/);
    expect(SECURITY).toMatch(/only two of them are enforcement boundaries/);
  });

  test('M12: the permission-defaults bullet describes the live default and labels the test-only one', () => {
    expect(SECURITY).toMatch(/permission-store\.js:13-21/);
    expect(SECURITY).toMatch(/only by unit tests, not at runtime/);
    expect(SECURITY).not.toMatch(/newer directory-allowlist\.js default ships/);
  });

  test('M20: the perception layer describes DOM extraction and OCR per command, not screenshots as primary', () => {
    expect(SECURITY).not.toMatch(/Primary input is the rendered page/);
    expect(SECURITY).toMatch(/OCR_SCREEN/);
    expect(SECURITY).toMatch(/accessibility snapshot and the DOM-extraction pipeline/);
  });

  test('M17: published tool counts equal the counts in the registries', () => {
    expect(mcpTools).toBeGreaterThan(0);
    expect(agentTools).toBeGreaterThan(0);

    const mcpClaim = `${mcpTools} tools across ${mcpCats} categories`;
    const agentClaim = `${agentTools} tools across ${agentCats} categories`;

    expect(MCP_PAGE).toContain(mcpClaim);
    expect(SEARCH_IDX).toContain(mcpClaim);
    expect(SKILLS).toContain(agentClaim);
    expect(FEATURES).toContain(agentClaim);

    expect(MCP_PAGE).not.toMatch(/60\+ tools/);
    expect(SEARCH_IDX).not.toMatch(/60\+ tools/);
    expect(SKILLS).not.toMatch(/36 tools/);
    expect(FEATURES).not.toMatch(/36 tools/);

    // Refs into tools.ts must point at lines that exist on this checkout.
    for (const [name, text] of [['mcp-settings', MCP_PAGE], ['skills', SKILLS]]) {
      for (const m of text.matchAll(/agent-api\/tools\.ts:(\d+)(?:-(\d+))?/g)) {
        expect(Number(m[1])).toBeLessThanOrEqual(toolsTsLines);
        if (m[2]) expect(Number(m[2])).toBeLessThanOrEqual(toolsTsLines);
      }
    }
    // Tools that only exist on an unpushed branch must not be documented as implemented.
    for (const absent of ['page_find', 'news_search', 'search_providers', 'fill_form', 'form_submit']) {
      expect(SKILLS).not.toContain(absent);
    }
    expect(SKILLS).not.toMatch(/research-pipeline\.ts/);
  });

  test('M15: README and the overview page carry the same status paragraph', () => {
    const marker = 'feature work pauses and resumes in bursts';
    expect(README).toContain(marker);
    expect(OVERVIEW).toContain(marker);
    expect(README).not.toMatch(/Project Status: AI-Assisted Maintenance/);
    expect(OVERVIEW).not.toMatch(/taking a temporary pause/);
  });

  test('M21: the README does not claim signature verification while its suite is skipped', () => {
    expect(README).not.toMatch(/signature is verified with the embedded public key/);
    expect(README).toMatch(/`verifyCrx` hangs on Node 24/);
    expect(README).toMatch(/not covered by CI/);
  });

  test('X3: the changelog scopes the token claim to the three tokened listeners', () => {
    expect(CHANGELOG).not.toMatch(/Every route on the local listeners — including/);
    expect(CHANGELOG).toMatch(/three tokened local listeners/);
  });
});
