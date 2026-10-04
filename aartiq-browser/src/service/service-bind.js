/**
 * Bind address for the file-sync HTTP listeners: the background task service
 * (service-main.js, port 3999) and the PDF sync server (pdf-sync.js).
 *
 * Both used to hard-code '0.0.0.0' with a wildcard CORS header and no switch
 * to stop them (docs-audit/mismatch-inventory.md M3) — the README said so
 * plainly. Loopback is the default now; exposing the listener to the network
 * is an explicit, operator-supplied decision via AARTIQ_SERVICE_HOST, not the
 * absence of one.
 *
 * The value is taken verbatim: what you set is what it binds. Nothing
 * interprets or validates it beyond node's own listen(), so an unusable value
 * surfaces as an EADDRNOTAVAIL error rather than a silent fallback.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {string} host to pass to server.listen()
 */
function resolveServiceHost(env = process.env) {
    return env.AARTIQ_SERVICE_HOST || '127.0.0.1';
}

module.exports = { resolveServiceHost };
