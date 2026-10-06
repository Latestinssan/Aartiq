/**
 * session-token.test.js — the persisted listener credentials.
 *
 * README known limits: "The session token is per-process, so it changes on
 * every restart. A client configured once — a phone, another machine, a
 * scheduled job — has to be reconfigured." These tests pin the fix: a token
 * read-or-created in $HOME survives a process restart, each listener has its
 * own file, rotation is an explicit operator action, and a corrupt file is
 * replaced rather than used.
 */

const fs = require('fs');
const path = require('path');

// A writable fake $HOME. Held in a `mock`-prefixed binding so the os mock
// factory can close over it: jest.resetModules() (our stand-in for an Aartiq
// restart) re-runs the factory, and only this variable survives that.
const mockHome = { dir: null };
mockHome.dir = fs.mkdtempSync(path.join(jest.requireActual('os').tmpdir(), 'aartiq-session-token-'));

jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return { ...actual, homedir: () => mockHome.dir };
});

afterAll(() => {
  fs.rmSync(mockHome.dir, { recursive: true, force: true });
});

/** Require a fresh module instance — stands in for an Aartiq restart. */
function freshModule() {
  jest.resetModules();
  return require('../src/lib/session-token');
}

const HEX64 = /^[0-9a-f]{64}$/;

describe('loadOrCreateSessionToken', () => {
  test('creates the listener-specific file, mode 0600, with a 64-hex token', () => {
    const { loadOrCreateSessionToken, sessionTokenPath } = freshModule();

    const token = loadOrCreateSessionToken('mcp');
    expect(token).toMatch(HEX64);

    const filePath = sessionTokenPath('mcp');
    expect(filePath).toBe(path.join(mockHome.dir, '.aartiq-mcp-token'));
    expect(fs.existsSync(filePath)).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    }
  });

  test('survives a restart — a new process reads the same token', () => {
    const first = freshModule().loadOrCreateSessionToken('mcp');
    const second = freshModule().loadOrCreateSessionToken('mcp');
    expect(second).toBe(first);
  });

  test('mcp and agent listeners keep separate credentials', () => {
    const mod = freshModule();
    const mcp = mod.loadOrCreateSessionToken('mcp');
    const agent = mod.loadOrCreateSessionToken('agent');
    expect(agent).not.toBe(mcp);
    expect(fs.existsSync(path.join(mockHome.dir, '.aartiq-agent-token'))).toBe(true);
  });

  test('an unreadable/corrupt token file is replaced, not used', () => {
    const mod = freshModule();
    const filePath = mod.sessionTokenPath('mcp');
    fs.writeFileSync(filePath, 'not-a-token\0junk');
    const token = mod.loadOrCreateSessionToken('mcp');
    expect(token).toMatch(HEX64);
    expect(fs.readFileSync(filePath, 'utf8').trim()).toBe(token);
  });

  test('a $HOME that cannot be written still yields a usable token (never throws)', () => {
    const home = mockHome.dir;
    const readOnlyHome = fs.mkdtempSync(path.join(jest.requireActual('os').tmpdir(), 'aartiq-ro-'));
    mockHome.dir = readOnlyHome;
    try {
      fs.chmodSync(readOnlyHome, 0o500);
      const token = freshModule().loadOrCreateSessionToken('agent');
      expect(token).toMatch(HEX64);
    } finally {
      fs.chmodSync(readOnlyHome, 0o700);
      fs.rmSync(readOnlyHome, { recursive: true, force: true });
      mockHome.dir = home;
    }
  });

  test('the legacy cli file (48-hex, written by main.js and regenerate-cli-token) is kept, not replaced', () => {
    const mod = freshModule();
    const filePath = mod.sessionTokenPath('cli');
    expect(filePath).toBe(path.join(mockHome.dir, '.aartiq-token'));
    const legacy = 'a'.repeat(48);
    fs.writeFileSync(filePath, legacy, { mode: 0o600 });
    expect(mod.loadOrCreateSessionToken('cli')).toBe(legacy);
  });

  test('an unknown listener kind is a programming error, not a silent fallback', () => {
    expect(() => freshModule().loadOrCreateSessionToken('nope')).toThrow(/unknown session token kind/);
  });
});

describe('rotateSessionToken', () => {
  test('issues a new value that persists; the old one stops working', () => {
    const mod = freshModule();
    const before = mod.loadOrCreateSessionToken('mcp');
    const rotated = mod.rotateSessionToken('mcp');

    expect(rotated).toMatch(HEX64);
    expect(rotated).not.toBe(before);
    // The next process reads the rotated value, not the original.
    expect(freshModule().loadOrCreateSessionToken('mcp')).toBe(rotated);
  });
});
