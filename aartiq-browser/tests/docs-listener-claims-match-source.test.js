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

  test('M2: the security page states how the non-HTTP listeners authenticate, tied to source', () => {
    expect(SECURITY).not.toMatch(/Every local listener requires/);
    expect(SECURITY).not.toMatch(/carry no token/);

    // WiFi sync (3004): the upgrade gate refuses foreign Origins and non-local
    // Host headers, and every sync action carries the device's access token.
    // The page must describe exactly what the source does.
    expect(WIFI_SRC).toMatch(/isOriginAllowed/);
    expect(WIFI_SRC).toMatch(/_isUpgradeAllowed/);
    expect(WIFI_SRC).toMatch(/Authentication required for sync actions/);
    expect(SECURITY).toMatch(/WiFi sync WebSocket upgrade refuses foreign Origins/);
    expect(SECURITY).toMatch(
      /every sync action — handshake, unpair, clipboard, remote control — requires the trusted device's short-lived access token/
    );

    // PDF sync (3999): its token is compared in constant time on every file endpoint.
    expect(read(REPO, 'src/service/pdf-sync.js')).toMatch(/timingSafeEqual/);
    expect(SECURITY).toMatch(/PDF sync listener requires its token on every file endpoint/);
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

  test('M12: the permission-defaults bullet describes the single live default', () => {
    // The defaults were unified while this gate was in flight: one definition,
    // in directory-allowlist.js, imported by permission-store. The four-path
    // default and the tests-only split the original M12 wording was written
    // for no longer exist, so the page must describe the narrowed default and
    // must not resurrect either retired claim.
    const allowlist = read(REPO, 'src/core/directory-allowlist.js');
    const store = read(REPO, 'src/lib/permission-store.js');

    expect(allowlist).toMatch(/const DEFAULT_ALLOWED_DIRECTORIES = _getDefaultDirectories\(\)/);
    expect(store).toMatch(/DEFAULT_ALLOWED_DIRECTORIES,\s+isSensitivePath/);
    expect(store).not.toMatch(/DEFAULT_ALLOWED_DIRECTORIES\s*=/);

    expect(SECURITY).toMatch(/narrowed to a single dedicated app workspace directory/);
    expect(SECURITY).toMatch(/No personal profile folders/);
    expect(SECURITY).not.toMatch(/Four default paths/);
    expect(SECURITY).not.toMatch(/permission-store\.js:13-21/);
    expect(SECURITY).not.toMatch(/exercised only by unit tests/);
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

    // No contradictory count may sit on a page. This used to be four hardcoded
    // negative guards ("60+ tools" on the MCP pages, "36 tools" on the agent
    // pages) and they were wrong twice: a guard naming a count pins that count
    // forever, so every registry change had to come back here to edit it, and
    // the "36 tools" guard forbade a number that the registry then made true.
    // Both counts are derived above, so any published count that is neither of
    // them is stale and fails. The four toContain assertions above catch a
    // wrong count replacing a right one; this catches a wrong count left
    // *beside* a right one, which is the case they cannot see.
    const derived = new Set([
      mcpClaim,
      agentClaim,
      `${mcpTools} tools`,
      `${agentTools} tools`,
    ]);
    const stale = [];
    for (const [label, text] of [
      ['mcp-settings', MCP_PAGE],
      ['search-index', SEARCH_IDX],
      ['skills', SKILLS],
      ['features', FEATURES],
    ]) {
      // m[0] is the text as published, so the failure quotes the page back
      // accurately — "60+ tools" stays "60+ tools" in the message.
      for (const m of text.matchAll(/(\d+)\+? tools(?: across (\d+)\+? categories)?/g)) {
        const pair = m[2]
          ? `${m[1]} tools across ${m[2]} categories`
          : `${m[1]} tools`;
        if (!derived.has(pair)) stale.push(`${label}: ${JSON.stringify(m[0])}`);
      }
    }
    expect(stale).toEqual([]);

    // Refs into tools.ts must point at lines that exist on this checkout.
    for (const [name, text] of [['mcp-settings', MCP_PAGE], ['skills', SKILLS]]) {
      for (const m of text.matchAll(/agent-api\/tools\.ts:(\d+)(?:-(\d+))?/g)) {
        expect(Number(m[1])).toBeLessThanOrEqual(toolsTsLines);
        if (m[2]) expect(Number(m[2])).toBeLessThanOrEqual(toolsTsLines);
      }
    }
    // These five tools and the research pipeline used to exist only on an
    // unpushed branch, and this gate forbade the pages from naming them. The
    // code has landed, so the names are now required rather than forbidden —
    // a tool in the registry with no published description is the same defect
    // in the other direction.
    for (const present of [
      'page_find',
      'news_search',
      'search_providers',
      'fill_form',
      'form_submit',
    ]) {
      expect(SKILLS).toContain(present);
    }
    expect(SKILLS).toMatch(/research-pipeline\.ts/);
  });

  test('M15: README and the overview page carry the same status paragraph', () => {
    const marker = 'AI agents handle day-to-day issue triage, analysis, and fix preparation';
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
