const assert = require('assert');
const path = require('path');

const { automationLayer, PLATFORM, probeNativeTooling } = require('../src/automation');

// jest-circus has no `this.skip()` (Jasmine-only), so registration is static
// and has to happen before any beforeAll hook runs. automationLayer.isAvailable
// only turns true inside initialize(), which beforeAll calls — reading it here
// always yielded false, so every test below registered as it.skip on every
// platform even with the tooling installed. probeNativeTooling() answers the
// same question synchronously: on Linux the suite needs xdotool or xte *and* a
// display (xdotool exits non-zero without one); the macOS AppleScript fallback
// and the Windows backend are always available.
const automationAvailable = probeNativeTooling();
const itWhenAvailable = (title, fn) => (automationAvailable ? it(title, fn) : it.skip(title, fn));

describe('Automation Layer', () => {
  beforeAll(async () => {
    await automationLayer.initialize();
  }, 10000);

  describe('Platform Detection', () => {
    it('should detect the current platform', () => {
      assert.ok(['darwin', 'win32', 'linux'].includes(PLATFORM));
    });

    it('should report correct platform', () => {
      if (process.platform === 'darwin') {
        assert.strictEqual(PLATFORM, 'darwin');
      } else if (process.platform === 'win32') {
        assert.strictEqual(PLATFORM, 'win32');
      } else {
        assert.strictEqual(PLATFORM, 'linux');
      }
    });
  });

  describe('Backend Detection', () => {
    it('should report the automation backend', () => {
      assert.ok(['native', 'robotjs', 'none'].includes(automationLayer.backend));
    });

    it('should indicate availability', () => {
      const isAvailable = automationLayer.isAvailable;
      assert.strictEqual(typeof isAvailable, 'boolean');
    });
  });

  describe('getMousePos', () => {
    it('should return valid coordinates', () => {
      const pos = automationLayer.getMousePos();
      assert.ok(typeof pos.x === 'number');
      assert.ok(typeof pos.y === 'number');
      assert.ok(pos.x >= 0);
      assert.ok(pos.y >= 0);
    });
  });

  describe('moveMouse', () => {
    itWhenAvailable('should not throw for valid coordinates', () => {
      assert.doesNotThrow(() => {
        automationLayer.moveMouse(100, 100);
      });
    });
  });

  describe('click', () => {
    itWhenAvailable('should not throw for valid click', () => {
      assert.doesNotThrow(() => {
        automationLayer.click(100, 100, 'left', false);
      });
    });

    itWhenAvailable('should handle different buttons', () => {
      assert.doesNotThrow(() => {
        automationLayer.click(100, 100, 'right', false);
      });
    });

    itWhenAvailable('should handle double click', () => {
      assert.doesNotThrow(() => {
        automationLayer.click(100, 100, 'left', true);
      });
    });
  });

  describe('typeText', () => {
    itWhenAvailable('should handle empty string', () => {
      assert.doesNotThrow(() => {
        automationLayer.typeText('');
      });
    });

    itWhenAvailable('should handle regular text', () => {
      assert.doesNotThrow(() => {
        automationLayer.typeText('Hello World');
      });
    });
  });

  describe('keyTap', () => {
    itWhenAvailable('should handle basic keys', () => {
      assert.doesNotThrow(() => {
        automationLayer.keyTap('return', []);
      });
    });

    itWhenAvailable('should handle keys with modifiers', () => {
      assert.doesNotThrow(() => {
        automationLayer.keyTap('a', ['command']);
      });
    });
  });

  describe('scroll', () => {
    itWhenAvailable('should handle scroll directions', () => {
      assert.doesNotThrow(() => {
        automationLayer.scroll(100, 100, 'up', 1);
        automationLayer.scroll(100, 100, 'down', 1);
      });
    });
  });

  describe('executeClickSequence', () => {
    itWhenAvailable('should execute a sequence of actions', async () => {
      const actions = [
        { type: 'move', x: 100, y: 100 },
        { type: 'click', x: 100, y: 100, button: 'left', double: false },
      ];

      const results = await automationLayer.executeClickSequence(actions);
      assert.ok(Array.isArray(results));
      assert.strictEqual(results.length, 2);
    });

    itWhenAvailable('should stop on error when configured', async () => {
      const actions = [
        { type: 'click', x: 100, y: 100 },
        { type: 'invalid', x: 100, y: 100 },
        { type: 'click', x: 200, y: 200 },
      ];

      const results = await automationLayer.executeClickSequence(actions, { stopOnError: true });
      assert.strictEqual(results.length, 2);
    });
  });
});

if (require.main === module) {
  const Mocha = require('mocha');
  const mocha = new Mocha({ timeout: 10000 });
  mocha.addFile(__filename);
  mocha.run(failures => process.exit(failures ? 1 : 0));
}