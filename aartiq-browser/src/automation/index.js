const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const PLATFORM = process.platform;

class AutomationLayer {
  constructor() {
    this.automation = null;
    this.fallback = null;
    this.source = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return true;

    const native = this._loadNative();
    if (native) {
      try {
        // A backend reports unavailability (e.g. Linux without xdotool/xte) by
        // returning false; only adopt it when it really works so isAvailable
        // stays honest and uninvokable actions fail closed instead of throwing.
        if (await native.initialize()) {
          this.automation = native;
          this.source = 'native';
          console.log(`[Automation] Initialized with native (${PLATFORM})`);
          this.initialized = true;
          return true;
        }
      } catch (err) {
        console.warn('[Automation] Native failed:', err.message);
      }
    }

    const fallback = require('./fallback');
    try {
      const available = await fallback.initialize();
      if (available) {
        this.automation = fallback;
        this.fallback = fallback;
        this.source = 'fallback';
        console.log('[Automation] Initialized with fallback automation');
        this.initialized = true;
        return true;
      }
    } catch (err) {
      console.warn('[Automation] fallback failed:', err.message);
    }

    console.error('[Automation] No automation backend available!');
    this.initialized = true;
    return false;
  }

  _loadNative() {
    try {
      if (PLATFORM === 'darwin') {
        return require('./mac');
      } else if (PLATFORM === 'win32') {
        return require('./win');
      } else if (PLATFORM === 'linux') {
        return require('./linux');
      }
    } catch (err) {
      console.warn('[Automation] Native load error:', err.message);
    }
    return null;
  }

  get isAvailable() {
    return this.automation !== null;
  }

  get backend() {
    return this.source || 'none';
  }

  moveMouse(x, y) {
    if (!this.automation) throw new Error('Automation not available');
    this.automation.moveMouse(x, y);
  }

  click(x, y, button = 'left', double = false) {
    if (!this.automation) throw new Error('Automation not available');
    this.automation.click(x, y, button, double);
  }

  typeText(text) {
    if (!this.automation) throw new Error('Automation not available');
    this.automation.typeText(text);
  }

  keyTap(key, modifiers = []) {
    if (!this.automation) throw new Error('Automation not available');
    this.automation.keyTap(key, modifiers);
  }

  scroll(x, y, direction, amount = 3) {
    if (!this.automation) throw new Error('Automation not available');
    this.automation.scroll(x, y, direction, amount);
  }

  getMousePos() {
    if (!this.automation) return { x: 0, y: 0 };
    return this.automation.getMousePos();
  }

  async executeClickSequence(actions, opts = {}) {
    const results = [];
    let shouldStop = false;
    for (const action of actions) {
      if (shouldStop) break;
      try {
        switch (action.type) {
          case 'click':
            this.click(action.x, action.y, action.button || 'left', action.double || false);
            results.push({ success: true, type: 'click', x: action.x, y: action.y });
            break;
          case 'type':
            this.typeText(action.text);
            results.push({ success: true, type: 'type', length: action.text.length });
            break;
          case 'key':
            this.keyTap(action.key, action.modifiers || []);
            results.push({ success: true, type: 'key', key: action.key });
            break;
          case 'scroll':
            this.scroll(action.x, action.y, action.direction, action.amount || 3);
            results.push({ success: true, type: 'scroll', direction: action.direction });
            break;
          case 'move':
            this.moveMouse(action.x, action.y);
            results.push({ success: true, type: 'move', x: action.x, y: action.y });
            break;
          default:
            results.push({ success: false, error: `Unknown action type: ${action.type}` });
            if (opts.stopOnError !== false) shouldStop = true;
            break;
        }
      } catch (err) {
        results.push({ success: false, error: err.message });
        if (opts.stopOnError !== false) shouldStop = true;
      }
    }
    return results;
  }
}

/**
 * Synchronous, side-effect-free availability probe.
 *
 * `isAvailable` only becomes true once `initialize()` has run, and the test
 * suite has to decide which tests to register before any beforeAll hook fires
 * — reading `isAvailable` at module scope therefore always said false and the
 * whole OS-automation suite registered as skipped on every platform, whatever
 * tooling was installed. This answers the same question at module scope.
 */
function probeNativeTooling() {
  if (PLATFORM === 'linux') {
    // linux.js adopts the backend only when xdotool or xte exists, and every
    // action shells out to the X server: without DISPLAY the child exits
    // non-zero and the call fails closed. Tooling and a display are both
    // required, so a headless box reports unavailable and the tests skip.
    try {
      execSync('which xdotool', { stdio: 'ignore' });
      return Boolean(process.env.DISPLAY);
    } catch {}
    try {
      execSync('which xte', { stdio: 'ignore' });
      return Boolean(process.env.DISPLAY);
    } catch {}
    return false;
  }
  // macOS always adopts a backend — native binary, steve CLI, or the
  // AppleScript fallback, whose actions catch their own errors — and win.js
  // returns true from initialize() on every path.
  return PLATFORM === 'darwin' || PLATFORM === 'win32';
}

const automationLayer = new AutomationLayer();

module.exports = { 
  AutomationLayer, 
  automationLayer, 
  PLATFORM,
  probeNativeTooling
};
