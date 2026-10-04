/**
 * Network listener hardening — the contract the docs now publish
 * (docs-audit/mismatch-inventory.md, M1 / M3 / M4).
 *
 * Three defects found by the docs/source audit, pinned so they cannot come back:
 *
 *   M1  The MCP browser bridge must bind loopback. It already does —
 *       resolveBindHost() is passed into listen() — but nothing asserted the
 *       call site, so a regression to a bare listen(port) would be silent.
 *
 *   M3  The background task service (3999, service-main.js) and the PDF sync
 *       server (pdf-sync.js) bound '0.0.0.0' with Access-Control-Allow-Origin:
 *       '*', with no switch to stop them. They now bind 127.0.0.1 unless
 *       AARTIQ_SERVICE_HOST says otherwise, and send no wildcard CORS header.
 *
 *   M4  The agent API (providers.ts) and the native macOS bridge (main.js)
 *       both defaulted to 46203. The agent API takes 46204; the native bridge
 *       keeps 46203 because Swift, the CLI, and the compiled panel binaries
 *       hard-code it. aartiq-mcp's BridgeClient calls only /native-mac-ui/*
 *       routes, which the native bridge serves, so its default stays 46203.
 *
 * Source is the truth here: every assertion reads the shipped files. The
 * mutation record for these assertions is
 * docs-audit/mutation-check-network-hardening.txt.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const BROWSER = path.join(__dirname, '..');
const REPO = path.join(BROWSER, '..');
const read = (p) => fs.readFileSync(p, 'utf8');

const MCP_SERVER_SRC = read(path.join(BROWSER, 'src/lib/mcp-browser-server.js'));
const SERVICE_MAIN_SRC = read(path.join(BROWSER, 'src/service/service-main.js'));
const PDF_SYNC_SRC = read(path.join(BROWSER, 'src/service/pdf-sync.js'));
const MAIN_JS_SRC = read(path.join(BROWSER, 'main.js'));
const MCP_INDEX_SRC = read(path.join(REPO, 'aartiq-mcp/server/index.js'));
const BRIDGE_CLIENT_SRC = read(path.join(REPO, 'aartiq-mcp/server/bridge-client.js'));

/** The wildcard CORS header, as written: setHeader('Access-Control-Allow-Origin', '*') */
const WILDCARD_CORS = /Access-Control-Allow-Origin['"]\s*,\s*['"]\*/;

// ─── M1 ───────────────────────────────────────────────────────────────────────

describe('M1 — the MCP browser bridge binds loopback', () => {
  test('the call site passes a resolved host into listen(), never a bare listen(port)', () => {
    expect(MCP_SERVER_SRC).toMatch(/listen\(\s*port\s*,\s*host\b/);
    const host = MCP_SERVER_SRC.match(/const host = ([^;]+);/);
    expect(host).toBeTruthy();
    expect(host[1]).toMatch(/resolveBindHost/);
  });

  test('a socket bound the way the bridge binds is 127.0.0.1, not a wildcard', async () => {
    const { resolveBindHost } = require('../src/lib/local-server-auth');
    const server = http.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, resolveBindHost({}), resolve);
    });
    expect(server.address().address).toBe('127.0.0.1');
    await new Promise((resolve) => server.close(resolve));
  });
});

// ─── M3 ───────────────────────────────────────────────────────────────────────

describe('M3 — background service and PDF sync bind loopback by default', () => {
  test('resolveServiceHost defaults to 127.0.0.1 and honours AARTIQ_SERVICE_HOST', () => {
    const { resolveServiceHost } = require('../src/service/service-bind');
    expect(resolveServiceHost({})).toBe('127.0.0.1');
    expect(resolveServiceHost({ AARTIQ_SERVICE_HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveServiceHost({ AARTIQ_SERVICE_HOST: '192.168.1.10' })).toBe('192.168.1.10');
  });

  test('service-main listens on the resolved host with no wildcard literal left', () => {
    expect(SERVICE_MAIN_SRC).toMatch(/require\(['"]\.\/service-bind['"]\)/);
    expect(SERVICE_MAIN_SRC).toContain('resolveServiceHost(');
    expect(SERVICE_MAIN_SRC).not.toMatch(/listen\([^)]*['"]0\.0\.0\.0['"]/);
    expect(SERVICE_MAIN_SRC).not.toMatch(WILDCARD_CORS);
  });

  test('pdf-sync listens on the resolved host with no wildcard CORS header', () => {
    expect(PDF_SYNC_SRC).toMatch(/require\(['"]\.\/service-bind['"]\)/);
    expect(PDF_SYNC_SRC).toContain('resolveServiceHost(');
    expect(PDF_SYNC_SRC).not.toMatch(/listen\([^)]*['"]0\.0\.0\.0['"]/);
    expect(PDF_SYNC_SRC).not.toMatch(WILDCARD_CORS);
  });
});

// ─── M4 ───────────────────────────────────────────────────────────────────────

describe('M4 — the agent API and the native bridge no longer share a port', () => {
  test('the agent API default is 46204', () => {
    const { defaultConfig } = require('../src/lib/agent-api/providers');
    expect(defaultConfig().port).toBe(46204);
  });

  test('both the TS source and the committed JS copy say 46204', () => {
    // Electron's main process requires the .js; jest may resolve either.
    expect(read(path.join(BROWSER, 'src/lib/agent-api/providers.ts'))).toMatch(/port:\s*46204\b/);
    expect(read(path.join(BROWSER, 'src/lib/agent-api/providers.js'))).toMatch(/port:\s*46204\b/);
  });

  test('the native bridge keeps 46203 (Swift, the CLI and the panel binaries hard-code it)', () => {
    expect(MAIN_JS_SRC).toMatch(/AARTIQ_NATIVE_MAC_UI_PORT \|\| ['"]46203['"]/);
    expect(read(path.join(BROWSER, 'scripts/aartiq-cli.js'))).toMatch(
      /AARTIQ_NATIVE_MAC_UI_PORT \|\| ['"]46203['"]/
    );
  });

  test('the two defaults are distinct, so neither can lose the bind race', () => {
    const { defaultConfig } = require('../src/lib/agent-api/providers');
    const nativePort = MAIN_JS_SRC.match(/AARTIQ_NATIVE_MAC_UI_PORT \|\| ['"](\d+)['"]/);
    expect(nativePort).toBeTruthy();
    expect(defaultConfig().port).not.toBe(Number(nativePort[1]));
  });

  test('aartiq-mcp targets the native bridge: /native-mac-ui/* routes on 46203', () => {
    // index.js passes AARTIQ_BRIDGE_PORT || '46203' into BridgeClient, and
    // bridge-client's own default agrees with it.
    expect(MCP_INDEX_SRC).toMatch(/AARTIQ_BRIDGE_PORT \|\| ['"]46203['"]/);
    expect(BRIDGE_CLIENT_SRC).toMatch(/DEFAULT_PORT = 46203/);
    // Every path it calls is a native-bridge route (main.js bridgeApp), which
    // the agent API does not serve — so this default must not follow the
    // agent API to 46204.
    expect(BRIDGE_CLIENT_SRC).toMatch(/\/native-mac-ui\//);
    expect(BRIDGE_CLIENT_SRC).not.toMatch(/\/(api|v1|tools)\//);
  });
});
