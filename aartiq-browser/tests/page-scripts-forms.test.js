/**
 * Injected page scripts — value writing, form filling, submission.
 *
 * Every test runs the generated script inside a real JSDOM document rather than
 * asserting on the script string. These scripts are the only place where Aartiq
 * touches a page's DOM, so the properties worth proving are behavioural: does the
 * value actually reach a framework-controlled input, does a failed field stop the
 * submit, and does a stale ref fail loudly instead of hitting the wrong element.
 */

const { JSDOM } = require('jsdom');
const {
  fillScript, typeScript, fillFormScript, formSubmitScript,
  clickScript, elementActionScript, domQueryScript, pageTextSearchScript,
} = require('../src/lib/snapshot/page-scripts.js');
const { SnapshotManager } = require('../src/lib/snapshot/manager.js');

function run(html, script) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  return { dom, doc: dom.window.document, result: dom.window.eval(script) };
}

/** Collect the raw tree, then index axId -> selector so tests can address fields. */
function stamped(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const raw = JSON.parse(dom.window.eval(SnapshotManager.collectorScript()));
  const bySelector = new Map();
  const walk = (n) => {
    if (n.selector) bySelector.set(n.selector, n.axId);
    (n.children || []).forEach(walk);
  };
  raw.forEach(walk);
  return { dom, ax: (selector) => bySelector.get(selector) };
}

const FORM = `<!doctype html><html><body>
  <form id="signup" method="post" action="/join">
    <input id="email" name="email" type="email" />
    <input id="age" name="age" type="number" />
    <input id="terms" name="terms" type="checkbox" />
    <select id="plan" name="plan"><option value="free">Free</option><option value="pro">Pro</option></select>
    <textarea id="bio" name="bio"></textarea>
    <div id="rich" contenteditable="true"></div>
    <input id="locked" name="locked" readonly />
    <input id="off" name="off" disabled />
    <button type="submit" id="go">Create account</button>
  </form>
</body></html>`;

describe('resolveEl: stale refs fail loudly', () => {
  it('reports a stale ref rather than silently matching nothing', () => {
    const { result } = run(FORM, fillScript('gone-42', 'x'));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/stale ref/);
    expect(result.reason).toMatch(/gone-42/);
  });

  it('fails on a missing axId instead of defaulting to the first element', () => {
    const { doc, result } = run(FORM, fillScript('', 'x'));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing axId/);
    // Nothing was touched, which is the whole point.
    expect(doc.querySelector('#email').value).toBe('');
  });

  it('does not match a prefix of a real id', () => {
    const { ax } = stamped(FORM);
    const real = ax('#email');
    // A truncated id must not resolve to the full one.
    const { result } = run(FORM, fillScript(real.slice(0, real.length - 1), 'x'));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/stale ref/);
  });
});

describe('fill: value actually lands', () => {
  it('sets a text input and reports it back', () => {
    const { ax, dom } = stamped(FORM);
    const r = dom.window.eval(fillScript(ax('#email'), 'a@b.co'));
    expect(r.ok).toBe(true);
    expect(dom.window.document.querySelector('#email').value).toBe('a@b.co');
    expect(r.fields[0].value).toBe('a@b.co');
  });

  it('reaches a framework-controlled input via the native prototype setter', () => {
    // React and friends replace the instance `value` property with a getter/setter
    // bound to their own state. A plain assignment writes into that shadow and the
    // component never re-renders; the native descriptor is the only write that
    // reaches the underlying control.
    const html = `<!doctype html><html><body><form><input id="reacty" /></form></body></html>`;
    const { ax, dom } = stamped(html);
    const el = dom.window.document.querySelector('#reacty');

    let frameworkState = '';
    Object.defineProperty(el, 'value', {
      configurable: true,
      get() { return frameworkState; },
      set(v) { frameworkState = String(v); },
    });

    dom.window.eval(fillScript(ax('#reacty'), 'hello'));
    // The shadow is bypassed, so the framework tracker is untouched...
    expect(frameworkState).toBe('');
    // ...and the value really is in the DOM, which is what the next input event
    // will read. That is the property that matters: a component reading the
    // element on change sees 'hello'.
    const native = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value');
    expect(native.get.call(el)).toBe('hello');
  });

  it('fires input and change so listeners see the write', () => {
    const html = `<!doctype html><html><body><form><input id="x" /></form></body></html>`;
    const { ax, dom } = stamped(html);
    const seen = [];
    const el = dom.window.document.querySelector('#x');
    for (const type of ['input', 'change']) {
      el.addEventListener(type, (e) => seen.push(`${e.type}:${el.value}`));
    }
    dom.window.eval(fillScript(ax('#x'), 'v1'));
    expect(seen).toEqual(['input:v1', 'change:v1']);
  });

  it('treats checkbox values as booleans', () => {
    const { ax, dom } = stamped(FORM);
    for (const [value, expected] of [['true', true], ['1', true], ['yes', true], ['on', true], ['false', false], ['0', false], ['', false]]) {
      const r = dom.window.eval(fillScript(ax('#terms'), value));
      expect(r.ok).toBe(true);
      expect(dom.window.document.querySelector('#terms').checked).toBe(expected);
    }
  });

  it('fires change when toggling a checkbox by click', () => {
    const { ax, dom } = stamped(FORM);
    const el = dom.window.document.querySelector('#terms');
    const seen = [];
    el.addEventListener('change', () => seen.push(el.checked));
    dom.window.eval(fillScript(ax('#terms'), 'true'));
    expect(seen).toEqual([true]);
  });

  it('matches a select option by value and by visible label', () => {
    const { ax, dom } = stamped(FORM);
    const sel = dom.window.document.querySelector('#plan');

    expect(dom.window.eval(fillScript(ax('#plan'), 'pro')).ok).toBe(true);
    expect(sel.value).toBe('pro');

    // Visible label, not the option value.
    expect(dom.window.eval(fillScript(ax('#plan'), 'Free')).ok).toBe(true);
    expect(sel.value).toBe('free');
  });

  it('reports a select mismatch instead of claiming success', () => {
    const { ax, dom } = stamped(FORM);
    const r = dom.window.eval(fillScript(ax('#plan'), 'enterprise'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no option matched/);
  });

  it('fills a contenteditable region through its text', () => {
    const { ax, dom } = stamped(FORM);
    const r = dom.window.eval(fillScript(ax('#rich'), 'edited text'));
    expect(r.ok).toBe(true);
    expect(dom.window.document.querySelector('#rich').textContent).toBe('edited text');
  });

  it('refuses a readOnly field and says why', () => {
    const { ax, dom } = stamped(FORM);
    const r = dom.window.eval(fillScript(ax('#locked'), 'nope'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/readOnly/);
    expect(dom.window.document.querySelector('#locked').value).toBe('');
  });

  it('refuses a disabled field and says why', () => {
    const { ax, dom } = stamped(FORM);
    const r = dom.window.eval(fillScript(ax('#off'), 'nope'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/disabled/);
  });

  it('reports a normalising control rather than claiming the exact value', () => {
    const html = `<!doctype html><html><body><form><input id="mask" /></form></body></html>`;
    const { ax, dom } = stamped(html);
    // A control that rewrites what it is given (masking, trimming, date parsing).
    const el = dom.window.document.querySelector('#mask');
    Object.defineProperty(el, 'value', {
      configurable: true,
      get() { return 'NORMALISED'; },
      set() { /* swallow */ },
    });
    const r = dom.window.eval(fillScript(ax('#mask'), '123-45'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/normalised to "NORMALISED"/);
  });

  it('fills a textarea', () => {
    const { ax, dom } = stamped(FORM);
    expect(dom.window.eval(fillScript(ax('#bio'), 'about me')).ok).toBe(true);
    expect(dom.window.document.querySelector('#bio').value).toBe('about me');
  });
});

describe('type: appends instead of replacing', () => {
  it('appends to the existing value', () => {
    const { ax, dom } = stamped(FORM);
    dom.window.eval(fillScript(ax('#email'), 'first'));
    dom.window.eval(typeScript(ax('#email'), '-second'));
    expect(dom.window.document.querySelector('#email').value).toBe('first-second');
  });

  it('replaces when clearFirst is set', () => {
    const { ax, dom } = stamped(FORM);
    dom.window.eval(fillScript(ax('#email'), 'first'));
    dom.window.eval(typeScript(ax('#email'), 'only', true));
    expect(dom.window.document.querySelector('#email').value).toBe('only');
  });

  it('appends to a contenteditable region', () => {
    const { ax, dom } = stamped(FORM);
    dom.window.eval(fillScript(ax('#rich'), 'a'));
    dom.window.eval(typeScript(ax('#rich'), 'b'));
    expect(dom.window.document.querySelector('#rich').textContent).toBe('ab');
  });
});

describe('fillForm: per-field results', () => {
  it('fills every field and reports each one', () => {
    const { ax, dom } = stamped(FORM);
    const r = dom.window.eval(fillFormScript([
      { axId: ax('#email'), value: 'a@b.co' },
      { axId: ax('#plan'), value: 'pro' },
      { axId: ax('#terms'), value: 'true' },
    ], false));

    expect(r.ok).toBe(true);
    expect(r.failed).toBe(0);
    expect(r.requested).toBe(3);
    expect(r.fields.map((f) => f.ok)).toEqual([true, true, true]);
    expect(dom.window.document.querySelector('#email').value).toBe('a@b.co');
    expect(dom.window.document.querySelector('#plan').value).toBe('pro');
    expect(dom.window.document.querySelector('#terms').checked).toBe(true);
  });

  it('keeps going after a failure and reports the good fields', () => {
    const { ax, dom } = stamped(FORM);
    const r = dom.window.eval(fillFormScript([
      { axId: ax('#locked'), value: 'nope' },
      { axId: ax('#email'), value: 'a@b.co' },
    ], false));

    // A batch that fails wholesale tells the caller nothing about what landed.
    expect(r.ok).toBe(false);
    expect(r.failed).toBe(1);
    expect(r.fields[0]).toMatchObject({ ok: false });
    expect(r.fields[0].reason).toMatch(/readOnly/);
    expect(r.fields[1]).toMatchObject({ ok: true, value: 'a@b.co' });
    expect(dom.window.document.querySelector('#email').value).toBe('a@b.co');
  });

  it('does not submit when submit is false', () => {
    const { ax, dom } = stamped(FORM);
    let submitted = 0;
    dom.window.document.querySelector('#signup')
      .addEventListener('submit', (e) => { e.preventDefault(); submitted++; });

    const r = dom.window.eval(fillFormScript([{ axId: ax('#email'), value: 'a@b.co' }], false));
    expect(submitted).toBe(0);
    expect(r.submitted).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('submits when asked and every field landed', () => {
    const { ax, dom } = stamped(FORM);
    let submitted = 0;
    dom.window.document.querySelector('#signup')
      .addEventListener('submit', (e) => { e.preventDefault(); submitted++; });

    const r = dom.window.eval(fillFormScript([
      { axId: ax('#email'), value: 'a@b.co' },
      { axId: ax('#plan'), value: 'pro' },
    ], true));

    expect(submitted).toBe(1);
    expect(r.submitted).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('refuses to submit a partially filled form', () => {
    // The dangerous outcome is a half-submitted signup: the user sees a success
    // page and the missing field only surfaces server-side.
    const { ax, dom } = stamped(FORM);
    let submitted = 0;
    dom.window.document.querySelector('#signup')
      .addEventListener('submit', (e) => { e.preventDefault(); submitted++; });

    const r = dom.window.eval(fillFormScript([
      { axId: ax('#email'), value: 'a@b.co' },
      { axId: ax('#locked'), value: 'nope' },
    ], true));

    expect(submitted).toBe(0);
    expect(r.submitted).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.submitReason).toMatch(/1 of 2 fields failed/);
  });

  it('reports a stale field without abandoning the rest', () => {
    const { ax, dom } = stamped(FORM);
    const r = dom.window.eval(fillFormScript([
      { axId: 'no-such-thing', value: 'x' },
      { axId: ax('#email'), value: 'a@b.co' },
    ], false));
    expect(r.failed).toBe(1);
    expect(r.fields[0].reason).toMatch(/stale ref/);
    expect(r.fields[1].ok).toBe(true);
  });

  it('handles an empty field list without submitting', () => {
    const { dom } = stamped(FORM);
    let submitted = 0;
    dom.window.document.querySelector('#signup')
      .addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    // Nothing was filled, so "which form?" has no answer. Guessing at the first
    // form on the page is how a submit lands somewhere the caller never named.
    const r = dom.window.eval(fillFormScript([], true));
    expect(submitted).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.submitted).toBe(false);
    expect(r.submitReason).toMatch(/no fields were filled/);
  });

  it('submits the form owning the filled fields, not the first form on the page', () => {
    const twoForms = `<!doctype html><html><body>
      <form id="search"><input id="q" name="q" /></form>
      <form id="pay" method="post" action="/pay"><input id="acct" name="acct" /></form>
    </body></html>`;
    const { ax, dom } = stamped(twoForms);
    let paid = 0;
    let searched = 0;
    dom.window.document.querySelector('#pay').addEventListener('submit', (e) => { e.preventDefault(); paid++; });
    dom.window.document.querySelector('#search').addEventListener('submit', (e) => { e.preventDefault(); searched++; });

    dom.window.eval(fillFormScript([{ axId: ax('#acct'), value: '123' }], true));
    expect(paid).toBe(1);
    expect(searched).toBe(0);
  });
});

describe('formSubmit: an explicit, gated action', () => {
  it('submits the form that owns the element', () => {
    const { ax, dom } = stamped(FORM);
    let submitted = 0;
    dom.window.document.querySelector('#signup')
      .addEventListener('submit', (e) => { e.preventDefault(); submitted++; });

    const r = dom.window.eval(formSubmitScript(ax('#email')));
    expect(submitted).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.action).toBe('/join');
    expect(r.method).toBe('post');
  });

  it('refuses an element that is not inside a form', () => {
    const html = `<!doctype html><html><body><input id="loose" /></body></html>`;
    const { ax, dom } = stamped(html);
    const r = dom.window.eval(formSubmitScript(ax('#loose')));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no <form> ancestor/);
  });

  it('enforces a confirmation label when the page declares one', () => {
    const html = `<!doctype html><html><body>
      <form id="pay" data-aartiq-confirm="Transfer 500 USD"><input id="acct" /></form>
    </body></html>`;
    const { ax, dom } = stamped(html);
    let submitted = 0;
    dom.window.document.querySelector('#pay')
      .addEventListener('submit', (e) => { e.preventDefault(); submitted++; });

    const wrong = dom.window.eval(formSubmitScript(ax('#acct'), 'Transfer 5 USD'));
    expect(wrong.ok).toBe(false);
    expect(wrong.reason).toMatch(/confirmation label mismatch/);
    expect(submitted).toBe(0);

    const right = dom.window.eval(formSubmitScript(ax('#acct'), 'Transfer 500 USD'));
    expect(right.ok).toBe(true);
    expect(submitted).toBe(1);
  });

  it('allows submission when the page declares no label and no text is given', () => {
    const { ax, dom } = stamped(FORM);
    dom.window.document.querySelector('#signup')
      .addEventListener('submit', (e) => e.preventDefault());
    expect(dom.window.eval(formSubmitScript(ax('#email'))).ok).toBe(true);
  });

  it('reports a stale ref rather than submitting some other form', () => {
    const { dom } = stamped(FORM);
    let submitted = 0;
    dom.window.document.querySelector('#signup')
      .addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    const r = dom.window.eval(formSubmitScript('gone'));
    expect(r.ok).toBe(false);
    expect(submitted).toBe(0);
  });
});

describe('click and element actions', () => {
  it('clicks the stamped element', () => {
    const html = `<!doctype html><html><body><button id="b">Go</button></body></html>`;
    const { ax, dom } = stamped(html);
    let clicks = 0;
    dom.window.document.querySelector('#b').addEventListener('click', () => clicks++);
    const r = dom.window.eval(clickScript(ax('#b')));
    expect(r.ok).toBe(true);
    expect(clicks).toBe(1);
  });

  it('checks and unchecks through element_action', () => {
    const { ax, dom } = stamped(FORM);
    const el = dom.window.document.querySelector('#terms');
    expect(dom.window.eval(elementActionScript('check', ax('#terms'))).ok).toBe(true);
    expect(el.checked).toBe(true);
    expect(dom.window.eval(elementActionScript('uncheck', ax('#terms'))).ok).toBe(true);
    expect(el.checked).toBe(false);
  });

  it('refuses check on a non-checkable element', () => {
    const { ax, dom } = stamped(FORM);
    const r = dom.window.eval(elementActionScript('check', ax('#email')));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not a checkbox or radio/);
  });

  it('rejects an unknown action instead of doing nothing quietly', () => {
    const { ax, dom } = stamped(FORM);
    const r = dom.window.eval(elementActionScript('detonate', ax('#email')));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown action "detonate"/);
  });

  it('focus reports when the element refuses focus', () => {
    const { ax, dom } = stamped(FORM);
    const r = dom.window.eval(elementActionScript('focus', ax('#off')));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/refused focus/);
  });
});

describe('domQuery: read-only CSS access', () => {
  const html = `<!doctype html><html><body>
    <a id="a1" href="/one" class="nav" data-role="primary">One</a>
    <a id="a2" href="/two" class="nav">Two</a>
    <a id="hidden-anchor" href="/secret" style="display:none">Secret</a>
    <input type="hidden" id="csrf" name="csrf" value="tok-123" />
  </body></html>`;

  it('returns matches with the fields the caller needs', () => {
    const r = run(html, domQueryScript('a.nav', { includeAttrs: ['data-role'] })).result;
    expect(r.ok).toBe(true);
    expect(r.total).toBe(2);
    expect(r.matches[0]).toMatchObject({ id: 'a1', tag: 'a', href: '/one', text: 'One' });
    // Requested attributes are spread onto the row, so a caller reads
    // `row['data-role']` rather than digging through a nested object.
    expect(r.matches[0]['data-role']).toBe('primary');
    expect(r.matches[1]['data-role']).toBeUndefined();
  });

  it('finds hidden inputs and hidden anchors the accessibility tree omits', () => {
    const hidden = run(html, domQueryScript('input[type="hidden"]')).result;
    expect(hidden.total).toBe(1);
    expect(hidden.matches[0].value).toBe('tok-123');

    const anchors = run(html, domQueryScript('#hidden-anchor')).result;
    expect(anchors.matches[0].visible).toBe(false);
  });

  it('returns nothing for an unmatched selector rather than throwing', () => {
    const r = run(html, domQueryScript('.does-not-exist')).result;
    expect(r.ok).toBe(true);
    expect(r.total).toBe(0);
    expect(r.matches).toEqual([]);
  });

  it('reports an invalid selector instead of throwing', () => {
    const r = run(html, domQueryScript('[[[')).result;
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/invalid CSS selector/);
    expect(r.matches).toEqual([]);
  });

  it('caps the returned rows but reports the true total', () => {
    const r = run(html, domQueryScript('a', { limit: 1 })).result;
    expect(r.matches.length).toBe(1);
    expect(r.total).toBe(3);
    expect(r.truncated).toBe(true);
  });
});

describe('pageTextSearchScript: prose the tree pruned', () => {
  const html = `<!doctype html><html><body>
    <p>The quarterly revenue fell by 12 percent, according to the filing.</p>
    <p>Revenue was flat in the prior quarter.</p>
  </body></html>`;

  it('finds text and returns surrounding context', () => {
    const r = run(html, pageTextSearchScript('revenue')).result;
    expect(r.ok).toBe(true);
    expect(r.matches.length).toBe(2);
    expect(r.matches[0].context).toMatch(/revenue/i);
  });

  it('is case-insensitive by default and case-sensitive on request', () => {
    // The page has "revenue" lower case and "Revenue" capitalised, and never
    // "REVENUE", so the two modes must give different answers.
    expect(run(html, pageTextSearchScript('REVENUE')).result.matches.length).toBe(2);
    expect(run(html, pageTextSearchScript('REVENUE', { caseSensitive: true })).result.matches.length).toBe(0);
    expect(run(html, pageTextSearchScript('Revenue', { caseSensitive: true })).result.matches.length).toBe(1);
  });

  it('reports the context around a hit so the caller can place it', () => {
    const r = run(html, pageTextSearchScript('12 percent')).result;
    expect(r.matches[0].context).toMatch(/quarterly revenue fell by 12 percent/);
  });

  it('scopes to a selector when given one', () => {
    const scoped = run(html, pageTextSearchScript('revenue', { scopeSelector: 'body > p:last-child' })).result;
    expect(scoped.matches.length).toBe(1);
    expect(scoped.matches[0].context).toMatch(/prior quarter/);
  });

  it('reports an empty scope match rather than searching the whole page', () => {
    // Silently widening the scope would answer a question nobody asked.
    const r = run(html, pageTextSearchScript('revenue', { scopeSelector: '#nothing-here' })).result;
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/matched nothing/);
  });

  it('returns nothing for an empty query instead of matching everything', () => {
    const r = run(html, pageTextSearchScript('')).result;
    expect(r.ok).toBe(true);
    expect(r.matches).toEqual([]);
  });

  it('returns nothing for a miss', () => {
    expect(run(html, pageTextSearchScript('zzz-not-here')).result.matches).toEqual([]);
  });
});
