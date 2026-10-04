/**
 * directory-permission-bridge.js
 *
 * Singleton bridge that connects the main-process directory-allowlist block logic
 * with the renderer's permission UI panel.
 *
 * Flow:
 *   1. utils.js detects a blocked path → calls requestDirectoryPermission(path, command)
 *   2. This module emits 'directory-permission-request' to the renderer via mainWindow IPC
 *   3. Renderer shows a warning panel; user approves or denies
 *   4. Renderer calls respondDirectoryPermission (preload → 'directory-permission-response' IPC)
 *   5. This module resolves the pending promise → utils.js retries or returns error
 */

const { EventEmitter } = require('events');
const crypto = require('crypto');

class DirectoryPermissionBridge extends EventEmitter {
  constructor() {
    super();
    this._mainWindow = null;
    /** @type {Map<string, { resolve: (granted: boolean) => void, path: string, command: string }>} */
    this._pending = new Map();
  }

  /** Called once from main.js after the BrowserWindow is created */
  setMainWindow(win) {
    this._mainWindow = win;
  }

  /**
   * Request permission from the user for blocked path(s).
   * Accepts a single path string or an array of path strings.
   * Returns a promise that resolves to true (granted) or false (denied).
   *
   * @param {string|string[]} blockedPathOrPaths - The path(s) that were blocked
   * @param {string} command - The shell command that triggered the block
   * @returns {Promise<boolean>}
   */
  requestDirectoryPermission(blockedPathOrPaths, command) {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const blockedPaths = Array.isArray(blockedPathOrPaths)
        ? blockedPathOrPaths
        : [blockedPathOrPaths];
      const primaryPath = blockedPaths[0] || '';

      // Auto-deny after 60 s to avoid hanging the shell executor
      const timer = setTimeout(() => {
        if (this._pending.has(requestId)) {
          this._pending.delete(requestId);
          resolve(false);
        }
      }, 60_000);

      this._pending.set(requestId, {
        resolve: (granted) => {
          clearTimeout(timer);
          this._pending.delete(requestId);
          resolve(granted);
        },
        path: primaryPath,
        paths: blockedPaths,
        command,
      });

      const { canonicalizePath } = require('./directory-allowlist');
      const canonicalPaths = blockedPaths.map(p => {
        const { canonical } = canonicalizePath(p);
        return canonical || require('path').resolve(p);
      });
      const resolvedPrimary = canonicalPaths[0] || primaryPath;

      if (this._mainWindow && !this._mainWindow.isDestroyed()) {
        this._mainWindow.webContents.send('directory-permission-request', {
          requestId,
          blockedPath: resolvedPrimary,
          blockedPaths: canonicalPaths,
          resolvedPath: resolvedPrimary,
          defaultAccess: 'read',
          command,
        });
      } else {
        // No renderer available — deny immediately
        clearTimeout(timer);
        this._pending.delete(requestId);
        resolve(false);
      }
    });
  }

  /**
   * Called from the IPC handler when the renderer responds.
   * @param {string} requestId
   * @param {boolean} granted
   */
  resolvePermission(requestId, granted) {
    const entry = this._pending.get(requestId);
    if (entry) {
      entry.resolve(granted);
    }
  }

  /** How many requests are still waiting */
  get pendingCount() {
    return this._pending.size;
  }
}

// Singleton — shared across all require() calls in the same Node.js process
const bridge = new DirectoryPermissionBridge();
module.exports = bridge;
