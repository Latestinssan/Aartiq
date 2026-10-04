/**
 * Snapshot ref binding — the layer that turns a ref back into a live element.
 *
 * The bug this file exists to prevent: refs were minted inside the manager while
 * the action scripts looked for a `data-ref` attribute that nothing ever wrote.
 * Every click_ref / fill_ref silently matched zero elements and returned success.
 */

const { JSDOM } = require('jsdom');
const { SnapshotManager, AX_MARKER_ATTR } = require('../src/lib/snapshot/manager.js');

/** A page whose window can actually eval injected scripts. */
function makePage(html = PAGE) {
  return new JSDOM(html, { runScripts: 'outside-only' });
}

/** Run a collector/action script inside a real DOM and return its JSON result. */
function runInDom(html, script) {
  const dom = makePage(html);
  const result = dom.window.eval(script);
  return { dom, result: typeof result === 'string' ? JSON.parse(result) : result };
}

const PAGE = `<!doctype html><html><body>
  <nav><a href="/home">Home</a><a href="/pricing">Pricing</a></nav>
  <div><span>plain structural text</span></div>
  <form id="signup">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" />
    <input id="terms" name="terms" type="checkbox" />
    <select id="plan"><option value="free">Free</option><option value="pro">Pro</option></select>
    <textarea id="bio"></textarea>
    <button type="submit" id="go">Create account</button>
  </form>
</body></html>`;

function buildSnapshot(manager, dom) {
  const raw = JSON.parse(dom.window.eval(SnapshotManager.collectorScript()));
  return manager.build(raw, {});
}

describe('collector: axId stamping', () => {
  it('stamps actionable elements so they can be re-addressed later', () => {
    const { dom } = runInDom(PAGE, SnapshotManager.collectorScript());
    const doc = dom.window.document;

    // Every control must carry a marker, or no ref action can ever find it.
    for (const sel of ['#email', '#terms', '#plan', '#bio', '#go', 'a[href="/home"]']) {
      const el = doc.querySelector(sel);
      expect(el.getAttribute(AX_MARKER_ATTR)).toBeTruthy();
    }
  });

  it('does not stamp purely structural elements', () => {
    const { dom } = runInDom(PAGE, SnapshotManager.collectorScript());
    // Blanket-stamping every element would perturb page code that counts nodes
    // or walks attributes, so only actionable candidates get marked.
    const structural = dom.window.document.querySelector('div > span');
    expect(structural.getAttribute(AX_MARKER_ATTR)).toBeNull();
  });

  it('reuses existing stamps so ids survive repeated snapshots', () => {
    const dom = new JSDOM(PAGE, { runScripts: 'outside-only' });
    const script = SnapshotManager.collectorScript();
    const first = JSON.parse(dom.window.eval(script));
    const second = JSON.parse(dom.window.eval(script));

    const idsOf = (roots) => {
      const out = [];
      const walk = (n) => { if (n.axId) out.push(n.axId); (n.children || []).forEach(walk); };
      roots.forEach(walk);
      return out;
    };
    // Same ids on the second pass — this is what keeps refs stable.
    expect(idsOf(second)).toEqual(idsOf(first));
  });

  it('stamps freshly inserted elements without colliding with old ones', () => {
    const dom = new JSDOM(PAGE, { runScripts: 'outside-only' });
    const script = SnapshotManager.collectorScript();
    const before = JSON.parse(dom.window.eval(script));
    const beforeIds = new Set();
    const walk = (n) => { if (n.axId) beforeIds.add(n.axId); (n.children || []).forEach(walk); };
    before.forEach(walk);

    dom.window.document.body.insertAdjacentHTML('beforeend', '<button id="late">Later</button>');
    const after = JSON.parse(dom.window.eval(script));
    const afterIds = new Set();
    const walk2 = (n) => { if (n.axId) afterIds.add(n.axId); (n.children || []).forEach(walk2); };
    after.forEach(walk2);

    expect(afterIds.size).toBe(beforeIds.size + 1);
    for (const id of afterIds) expect(typeof id).toBe('string');
  });

  it('skips non-actionable input types instead of reporting them as fields', () => {
    const { result } = runInDom(
      '<form><input type="hidden" name="csrf" value="x"><input type="submit" value="Go"></form>',
      SnapshotManager.collectorScript()
    );
    const flat = [];
    const walk = (n) => { flat.push(n); (n.children || []).forEach(walk); };
    result.forEach(walk);
    expect(flat.some((n) => n.attributes?.type === 'hidden')).toBe(false);
    expect(flat.some((n) => n.attributes?.type === 'submit')).toBe(false);
  });

  it('clearMarkersScript removes every stamp it wrote', () => {
    const dom = new JSDOM(PAGE, { runScripts: 'outside-only' });
    dom.window.eval(SnapshotManager.collectorScript());
    expect(dom.window.document.querySelectorAll(`[${AX_MARKER_ATTR}]`).length).toBeGreaterThan(0);
    const removed = dom.window.eval(SnapshotManager.clearMarkersScript());
    expect(removed).toBeGreaterThan(0);
    expect(dom.window.document.querySelectorAll(`[${AX_MARKER_ATTR}]`).length).toBe(0);
  });
});

describe('SnapshotManager: ref lifecycle', () => {
  it('marks stamped nodes actionable and structural nodes not', () => {
    const manager = new SnapshotManager();
    const result = buildSnapshot(manager, makePage());
    const all = Object.values(result.refs);
    // Select on the selector, not the name: `<label for="email">Email</label>`
    // has the same accessible name but no element handle.
    const email = all.find((n) => n.selector === '#email');
    expect(email).toBeDefined();
    expect(email.actionable).toBe(true);
    expect(email.axId).toBeTruthy();

    const label = all.find((n) => n.name === 'Email');
    expect(label).toBeDefined();
    expect(label.actionable).toBe(false);
  });

  it('resolveRef returns the axId an action script can address', () => {
    const manager = new SnapshotManager();
    const result = buildSnapshot(manager, makePage());
    const target = Object.values(result.refs).find((n) => n.selector === '#email');
    const resolved = manager.resolveRef(target.ref);
    expect(resolved.axId).toBe(target.axId);
    expect(resolved.selector).toBe('#email');
  });

  it('throws a stale-ref error for a ref that was never issued', () => {
    const manager = new SnapshotManager();
    buildSnapshot(manager, makePage());
    expect(() => manager.resolveRef('e9999')).toThrow(/Stale ref "e9999"/);
    expect(() => manager.resolveRef('e9999')).toThrow(/Re-run snapshot/);
  });

  it('throws a stale-ref error after reset rather than reusing the number', () => {
    const manager = new SnapshotManager();
    const result = buildSnapshot(manager, makePage());
    const ref = Object.keys(result.refs)[0];
    manager.reset();
    expect(() => manager.resolveRef(ref)).toThrow(/Stale ref/);
  });

  it('refuses structural nodes instead of actuating a neighbour', () => {
    const manager = new SnapshotManager();
    const result = buildSnapshot(manager, makePage());
    const structural = Object.values(result.refs).find((n) => !n.actionable);
    expect(structural).toBeDefined();
    expect(() => manager.resolveRef(structural.ref)).toThrow(/structural node/);
  });

  it('keeps a ref stable across re-snapshots of an unchanged page', () => {
    const manager = new SnapshotManager();
    const dom = makePage();
    const first = buildSnapshot(manager, dom);
    const emailRef = Object.values(first.refs).find((n) => n.selector === '#email').ref;
    const second = buildSnapshot(manager, dom);
    expect(Object.values(second.refs).find((n) => n.selector === '#email').ref).toBe(emailRef);
  });

  it('numbers refs monotonically and never reuses one within a page', () => {
    const manager = new SnapshotManager();
    const dom = makePage();
    const seen = new Set();
    for (let i = 0; i < 4; i++) {
      for (const ref of Object.keys(buildSnapshot(manager, dom).refs)) seen.add(ref);
    }
    const nums = [...seen].map((r) => Number(r.slice(1)));
    expect(new Set(nums).size).toBe(nums.length);
  });

  it('labels structural nodes in the rendered tree', () => {
    const manager = new SnapshotManager();
    const result = buildSnapshot(manager, makePage());
    expect(result.text).toContain('[structural]');
  });
});

describe('SnapshotManager: single-page search', () => {
  function searched(overrides) {
    const manager = new SnapshotManager();
    const result = buildSnapshot(manager, makePage());
    return manager.searchPage({ query: 'Pricing', ...overrides });
  }

  it('finds a match and returns a usable ref', () => {
    // actionableOnly, because the <nav> ancestor also matches "Pricing" in its
    // text content — a hit is only useful if it can be acted on.
    const hits = searched({ actionableOnly: true });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].ref).toMatch(/^e\d+$/);
    expect(hits[0].href).toBe('/pricing');
    expect(hits[0].field).toBe('name');
    expect(hits[0].context).toContain('Pricing');

    // The hit must be one the caller can actually act on: the ref resolves.
    const manager = new SnapshotManager();
    buildSnapshot(manager, makePage());
    const resolved = manager.resolveRef(hits[0].ref);
    expect(resolved.axId).toBeTruthy();
  });

  it('still reaches matches nested inside a non-actionable ancestor', () => {
    // The traversal must not be pruned by filters: the actionable link lives
    // below <nav>, which matches the query but has no element handle.
    const hits = searched({ actionableOnly: true, role: 'link' });
    expect(hits.map((h) => h.href)).toEqual(['/pricing']);
  });

  it('records an actionable descendant even when its ancestor matches first', () => {
    // The recording order is document order, so an unfiltered search sees <nav>
    // before the link inside it. Both are hits; only one can be actuated.
    const hits = searched({ actionableOnly: false });
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.some((h) => h.role === 'nav')).toBe(true);
    expect(hits.some((h) => h.href === '/pricing')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(searched({ query: 'pricing' }).length).toBe(searched({ query: 'PRICING' }).length);
  });

  it('honours the limit', () => {
    expect(searched({ limit: 1 }).length).toBeLessThanOrEqual(1);
  });

  it('filters by role', () => {
    const hits = searched({ role: 'link' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.role === 'link')).toBe(true);
  });

  it('excludes non-actionable nodes when actionableOnly is set', () => {
    const hits = searched({ actionableOnly: true });
    expect(hits.every((h) => h.role !== 'span' && h.role !== 'nav')).toBe(true);
    // ...and includes them when it is not, so the flag is what does the work.
    const all = searched({ actionableOnly: false });
    expect(all.length).toBeGreaterThanOrEqual(hits.length);
  });

  it('returns nothing for a miss rather than inventing results', () => {
    expect(searched({ query: 'zzzz-not-present' })).toEqual([]);
  });

  it('refuses to search before a snapshot exists', () => {
    const manager = new SnapshotManager();
    expect(() => manager.searchPage({ query: 'anything' })).toThrow(/Run snapshot first/);
  });

  it('returns an empty list for an empty query instead of matching everything', () => {
    expect(searched({ query: '' })).toEqual([]);
  });
});
