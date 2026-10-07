/**
 * The native macOS bridge's permission routes.
 *
 * These endpoints used to read and write `comet-permissions.json` directly,
 * which bypassed the loaded PermissionStore — and the bypass made them no-ops
 * in both directions at once:
 *
 *   - the store's in-memory Map never learned about a bridge grant, so the
 *     approval gate (isGranted / checkShellPermission) ignored it until a
 *     restart, and
 *   - the store's next `_save()` from any other path (a dialog answer, a
 *     settings toggle, another bridge call) wrote the Map back over the raw
 *     file and silently dropped the grant it did not contain.
 *
 * Every route now goes through the store: one place validates the level,
 * stamps granted_at/expires_at, saves and audits, and the GET returns the
 * same live state the gate reads instead of a file snapshot.
 *
 * Route contracts (status codes and response bodies) are unchanged; an
 * invalid level now fails closed with 500 where the raw write used to
 * store whatever string it was handed.
 */
function registerPermissionRoutes(bridgeApp, permissionStore) {
  bridgeApp.get('/native-mac-ui/permissions', (_req, res) => {
    try {
      res.json({
        permissions: Object.fromEntries(permissionStore.permissions),
        securitySettings: permissionStore.getSettings(),
      });
    } catch (e) {
      res.json({ permissions: {}, securitySettings: {}, error: e.message });
    }
  });

  bridgeApp.post('/native-mac-ui/permissions/grant', (req, res) => {
    const { key, level, description } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Missing key' });
    try {
      // sessionOnly = false: this endpoint has always meant "granted until
      // revoked". The store's default is an 8-hour session grant, and
      // silently putting the bridge's grants on that clock would change the
      // contract the MCP bridge-client already relies on.
      permissionStore.grant(key, level || 'read', description || '', false);
      res.json({ granted: key });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  bridgeApp.post('/native-mac-ui/permissions/revoke', (req, res) => {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Missing key' });
    try {
      permissionStore.revoke(key);
      res.json({ revoked: key });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerPermissionRoutes };
