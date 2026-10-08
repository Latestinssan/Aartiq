/**
 * crx-id-binding.js — bind a Web Store download URL to the crx_id of the
 * bytes that URL serves.
 *
 * The CRX3 verifier proves a package is self-consistent: the crx_id must be
 * derived from the key whose signature verifies over the signed header and the
 * zip archive (see crx-verifier). It cannot prove the package is the extension
 * the *caller asked for* — anyone can mint a key, sign a package, and watch it
 * verify as that key's own id. The Web Store update URL declares the id it
 * serves (`x=id%3D<32 chars>`), so installFromWebStore parses that declaration
 * and requires it to equal the verified package's id: a URL promising
 * extension X can only ever install X; substitution by any other package —
 * even a validly signed one — fails closed.
 *
 * Encoding: a Chrome extension id is the first 128 bits of
 * SHA-256(SPKI public key) with each nibble rendered as 'a' + nibble (the
 * 32-char a-p alphabet). verifyCrx reports the same 16 bytes hex-encoded, so
 * comparing the two sides means rendering both as the store form.
 */

const STORE_ID_RE = /^[a-p]{32}$/;
const HEX_ID_RE = /^[0-9a-f]{32}$/;

/**
 * The extension id a download URL declares (lowercased), or null when the URL
 * declares none or declares a malformed one. Accepts the Web Store update form
 * (`x=id%3D<id>%26uc` — already percent-decoded by URLSearchParams) and a
 * plain `id=<id>` query parameter; trailing `&…` segments of `x` are ignored.
 */
function parseDeclaredExtensionId(crxUrl) {
  let parsed;
  try {
    parsed = new URL(String(crxUrl));
  } catch (_) {
    return null;
  }
  const candidates = [];
  // `x` carries `id=<id>` (optionally with trailing &… segments);
  // a plain `id` parameter's value is the bare id.
  const x = parsed.searchParams.get('x');
  if (x) candidates.push(x.split('&')[0]);
  const id = parsed.searchParams.get('id');
  if (id) candidates.push(id);
  for (const candidate of candidates) {
    const value = candidate.startsWith('id=') ? candidate.slice(3) : candidate;
    const normalized = value.toLowerCase();
    if (STORE_ID_RE.test(normalized)) return normalized;
  }
  return null;
}

/**
 * The 32-char store form (a-p) of a verified hex crx_id (0-9a-f). Anything
 * that is not a well-formed 16-byte hex id throws: a verified result we cannot
 * encode cannot be compared, and refusing to compare is fail-closed.
 */
function storeIdFromHexCrxId(hexCrxId) {
  if (typeof hexCrxId !== 'string' || !HEX_ID_RE.test(hexCrxId)) {
    throw new Error(`verified crx_id is not a 16-byte hex id: ${JSON.stringify(hexCrxId)}`);
  }
  let storeId = '';
  for (const nibble of hexCrxId) {
    storeId += String.fromCharCode(97 + parseInt(nibble, 16));
  }
  return storeId;
}

/**
 * Assert the URL names an extension at all. Returns the declared id; throws
 * when there is nothing to bind against. Called before the download starts so
 * an unbindable request is refused without spending it.
 */
function assertUrlDeclaresExtensionId(crxUrl) {
  const declared = parseDeclaredExtensionId(crxUrl);
  if (!declared) {
    throw new Error(
      `CRX download URL declares no extension id — a Web Store install must name the extension it asks for (expected ?x=id%3D<32-char id>): ${crxUrl}`
    );
  }
  return declared;
}

/**
 * Assert that the package verifyCrx blessed is the extension crxUrl declares.
 * Returns the bound store id; throws on a URL with no usable declaration, a
 * malformed verified id, or any mismatch between the two.
 */
function assertCrxIdMatchesUrl(crxUrl, verifiedHexCrxId) {
  const declared = assertUrlDeclaresExtensionId(crxUrl);
  const packaged = storeIdFromHexCrxId(verifiedHexCrxId);
  if (packaged !== declared) {
    throw new Error(
      `CRX id mismatch — URL declares ${declared} but the package verifies as ${packaged}. Refusing to install a different extension than the one requested.`
    );
  }
  return packaged;
}

module.exports = {
  parseDeclaredExtensionId,
  storeIdFromHexCrxId,
  assertUrlDeclaresExtensionId,
  assertCrxIdMatchesUrl,
};
