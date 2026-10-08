/**
 * crx-url-binding.test.js — a Web Store install may only install the
 * extension its URL names.
 *
 * verifyCrx proves a CRX3 package is self-consistent: the crx_id must be
 * derived from the key whose signature verifies over the signed header and the
 * zip archive. It does NOT prove the package is the extension the caller asked
 * for — anyone can mint a key, sign a package, and watch it verify as that
 * key's own id. installFromWebStore therefore binds the download URL's
 * declared id (the store's 32-char a-p form) to the verified package's
 * crx_id (the same 16 bytes, hex in the verifier result) before extraction:
 *
 *   - a URL with no usable id is refused before the download starts;
 *   - a package whose id differs from the URL's is refused after
 *     verification, using the REAL verifier (buildCrx3 + the fixture key);
 *   - the two encodings are two renderings of the same 16 bytes, so a
 *     package's own store id binds to its own URL and nothing else does.
 *
 * Rejection never reaches extraction, fs, or network — the manager is a bare
 * prototype with _downloadBuffer stubbed.
 */

jest.mock('electron', () => ({
  app: { getPath: () => '/tmp/aartiq-crx-binding-test' },
  session: {},
}));
jest.mock('electron-store', () => class {
  get() { return undefined; }
  set() {}
  delete() {}
});
// Extraction is stubbed to a deterministic throw: no test here cares what a
// fake zip does, and "reached extraction" is exactly the signal that the
// binding passed.
jest.mock('../src/lib/extensions/crx-extractor', () => ({
  extractCRX: jest.fn(),
  extractZip: jest.fn(() => { throw new Error('extraction-stubbed'); }),
  isCRXFile: jest.fn(() => false),
  isExtensionDirectory: jest.fn(() => false),
}));

const crypto = require('crypto');
const {
  parseDeclaredExtensionId,
  storeIdFromHexCrxId,
  assertUrlDeclaresExtensionId,
  assertCrxIdMatchesUrl,
} = require('../src/lib/extensions/crx-id-binding');
const { verifyCrx, buildCrx3 } = require('../src/lib/extensions/crx-verifier');
const { CRX_TEST_PRIVATE_PEM } = require('../src/tests/crx-fixtures');
const { ChromeExtensionManager } = require('../src/lib/extensions/ChromeExtensionManager');

const STORE_ID_RE = /^[a-p]{32}$/;
const HEX_ID_RE = /^[0-9a-f]{32}$/;
/** A valid-shaped id guaranteed to differ from any given one. */
function otherId(storeId) {
  return (storeId[0] === 'a' ? 'b' : 'a') + storeId.slice(1);
}
function cwsUrl(storeId) {
  return `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=120.0.0.0&acceptformat=crx2,crx3&x=id%3D${storeId}%26uc`;
}
function fixtureKey() {
  const privateKey = crypto.createPrivateKey(CRX_TEST_PRIVATE_PEM);
  const publicKeyDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return { privateKey, publicKeyDer };
}
/** The store id the fixture key's packages verify as. */
function fixtureStoreId(publicKeyDer) {
  return storeIdFromHexCrxId(crypto.createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32));
}
/** A bare manager: rejection paths touch only _downloadBuffer. */
function bareManager(download) {
  const mgr = Object.create(ChromeExtensionManager.prototype);
  mgr._downloadBuffer = download;
  return mgr;
}

describe('parseDeclaredExtensionId', () => {
  const id = 'abcdefghijklmnopabcdefghijklmnop';

  test('Web Store update URL — percent-encoded x=id%3D…%26uc', () => {
    expect(parseDeclaredExtensionId(cwsUrl(id))).toBe(id);
  });

  test('plain id= query parameter', () => {
    expect(parseDeclaredExtensionId(`https://example.test/download.crx?id=${id}`)).toBe(id);
  });

  test('un-encoded x=id=… form', () => {
    expect(parseDeclaredExtensionId(`https://example.test/crx?x=id=${id}&uc`)).toBe(id);
  });

  test('uppercase declarations normalise to lowercase', () => {
    expect(parseDeclaredExtensionId(`https://example.test/crx?id=${id.toUpperCase()}`)).toBe(id);
  });

  test('no id declared → null', () => {
    expect(parseDeclaredExtensionId('https://clients2.google.com/service/update2/crx?response=redirect')).toBeNull();
    expect(parseDeclaredExtensionId('https://example.test/file.crx')).toBeNull();
  });

  test('malformed ids (bad length, alphabet outside a-p) → null', () => {
    expect(parseDeclaredExtensionId(`https://example.test/crx?id=${'a'.repeat(31)}`)).toBeNull();
    expect(parseDeclaredExtensionId(`https://example.test/crx?id=${'az'.repeat(16)}`)).toBeNull();
    expect(parseDeclaredExtensionId('https://example.test/crx?id=0123456789abcdef0123456789abcdef')).toBeNull();
  });

  test('not a URL → null', () => {
    expect(parseDeclaredExtensionId('not a url')).toBeNull();
    expect(parseDeclaredExtensionId(undefined)).toBeNull();
  });
});

describe('storeIdFromHexCrxId', () => {
  test('maps each nibble onto the a-p alphabet', () => {
    expect(storeIdFromHexCrxId('0123456789abcdef0123456789abcdef')).toBe('abcdefghijklmnopabcdefghijklmnop');
    expect(storeIdFromHexCrxId('ffffffffffffffffffffffffffffffff')).toBe('p'.repeat(32));
  });

  test('throws on anything that is not a 16-byte hex id', () => {
    for (const bad of ['', 'abc', 'g'.repeat(32), '0'.repeat(31), '0'.repeat(33), null, undefined, 123]) {
      expect(() => storeIdFromHexCrxId(bad)).toThrow(/not a 16-byte hex id/);
    }
  });
});

describe('the binding assertions', () => {
  const storeId = 'abcdefghijklmnopabcdefghijklmnop';
  const hex = '0123456789abcdef0123456789abcdef';

  test('matching URL and package bind and return the store id', () => {
    expect(assertCrxIdMatchesUrl(cwsUrl(storeId), hex)).toBe(storeId);
  });

  test('a URL declaring nothing throws before anything can be trusted', () => {
    expect(() => assertUrlDeclaresExtensionId('https://example.test/file.crx')).toThrow(/declares no extension id/);
    expect(() => assertCrxIdMatchesUrl('https://example.test/file.crx', hex)).toThrow(/declares no extension id/);
  });

  test('a package for a different extension throws with both ids named', () => {
    expect(() => assertCrxIdMatchesUrl(cwsUrl(otherId(storeId)), hex)).toThrow(/id mismatch/);
    expect(() => assertCrxIdMatchesUrl(cwsUrl(otherId(storeId)), hex)).toThrow(new RegExp(storeId));
    expect(() => assertCrxIdMatchesUrl(cwsUrl(otherId(storeId)), hex)).toThrow(new RegExp(otherId(storeId)));
  });

  test('a malformed verified id throws instead of comparing', () => {
    expect(() => assertCrxIdMatchesUrl(cwsUrl(storeId), 'zz')).toThrow(/not a 16-byte hex id/);
  });
});

describe('binding against the real verifier (buildCrx3 + the fixture key)', () => {
  test('the fixture package binds to its own store id and to nothing else', () => {
    const { privateKey, publicKeyDer } = fixtureKey();
    const crx = buildCrx3(Buffer.from('arbitrary archive bytes — the binding runs before extraction'), privateKey, publicKeyDer);

    const verified = verifyCrx(crx);
    expect(verified.valid).toBe(true);
    expect(verified.extensionId).toMatch(HEX_ID_RE);

    const storeId = fixtureStoreId(publicKeyDer);
    expect(storeId).toMatch(STORE_ID_RE);
    // The encoding chain: verifyCrx's hex id and the store id derived from
    // the same key are two renderings of the same 16 bytes.
    expect(storeIdFromHexCrxId(verified.extensionId)).toBe(storeId);
    expect(assertCrxIdMatchesUrl(cwsUrl(storeId), verified.extensionId)).toBe(storeId);

    // Any other declared id must be refused.
    expect(() => assertCrxIdMatchesUrl(cwsUrl(otherId(storeId)), verified.extensionId)).toThrow(/id mismatch/);
  });
});

describe('installFromWebStore — fail-closed wiring', () => {
  test('a URL that declares no extension id is refused before the download starts', async () => {
    const download = jest.fn();
    const mgr = bareManager(download);
    await expect(mgr.installFromWebStore('https://clients2.google.com/service/update2/crx?response=redirect'))
      .rejects.toThrow(/declares no extension id/);
    expect(download).not.toHaveBeenCalled();
  });

  test('a validly signed package for a different extension than the URL names is refused', async () => {
    const { privateKey, publicKeyDer } = fixtureKey();
    const crx = buildCrx3(Buffer.from('arbitrary archive bytes'), privateKey, publicKeyDer);
    expect(verifyCrx(crx).valid).toBe(true);

    const declared = otherId(fixtureStoreId(publicKeyDer));
    const mgr = bareManager(jest.fn().mockResolvedValue(crx));
    await expect(mgr.installFromWebStore(cwsUrl(declared))).rejects.toThrow(/id mismatch/);
    // …and the error names both sides so the refusal is diagnosable.
    await expect(mgr.installFromWebStore(cwsUrl(declared))).rejects.toThrow(new RegExp(declared));
  });

  test('the right URL for that package passes the binding and reaches extraction', async () => {
    const { privateKey, publicKeyDer } = fixtureKey();
    const crx = buildCrx3(Buffer.from('arbitrary archive bytes'), privateKey, publicKeyDer);
    const mgr = bareManager(jest.fn().mockResolvedValue(crx));

    await expect(mgr.installFromWebStore(cwsUrl(fixtureStoreId(publicKeyDer))))
      .rejects.toThrow(/extraction-stubbed/);
    // Reached extraction ⇒ past verification AND past the id binding; the
    // refusal is the stub's, not a false-positive mismatch.
    expect(mgr._downloadBuffer).toHaveBeenCalledTimes(1);
  });
});
