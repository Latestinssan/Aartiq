/**
 * Bridge + tool wiring.
 *
 * These tests pin the behaviour an agent cannot see: that a ref is resolved to a
 * real element handle before a script runs, that a missing tab fails instead of
 * landing on another window, and — most importantly — that filling a form and
 * submitting it are separate decisions that cannot be reached through one tool.
 */

const { SnapshotManager, AX_MARKER_ATTR } = require('../src/lib/snapshot/manager.js');
const { InProcessBridge } = require('../src/lib/agent-api/bridge.js');
const { ALL_TOOLS } = require('../src/lib/agent-api/tools.js');

const PAGE = `<!doctype html><html><body>
  <form id="signup" method="post" action="/join">
    <input id="email" name="email" />
    <input id="locked" readonly />
    <button type="submit" id="go">Join</button>
  </form>
</body></html>`;

/** A fake page adapter that records the scripts it is asked to run. */
function fakeAdapter() {
  const calls = [];
  return {
    calls,
    raw: [],
    async getAxTree() { return this.raw.length ? this.raw : TREE; },
    async executeInTab(_tabId, script) {
      calls.push(script);
      return calls.length === 0 ? null : calls[calls.length - 1];
    },
    async navigate() { calls.push('NAVIGATE'); },
    async listTabs() { return [{ id: '1', url: 'https://example.com/', title: 'Example' }]; },
    async clearMarkers() { calls.push('CLEAR_MARKERS'); },
  };
}

function setup(overrides = {}) {
  const snapshots = new SnapshotManager();
  const pageAdapter = fakeAdapter();
  const bridge = new InProcessBridge({ snapshots, pageAdapter, ...overrides });
  return { snapshots, pageAdapter, bridge };
}

/** Build a tree the manager can mint refs from, using refs we control. */
/** Ref the manager minted for the node stamped with a given axId. */
function refFor(snapshots, axId) {
  return Object.values(snapshots.getLastResult().refs).find((n) => n.axId === axId).ref;
}

const TREE = [{
  role: 'body', name: '', attributes: { tag: 'body' }, children: [
    {
      role: 'textbox', name: 'Email', axId: 'ax-email', selector: '#email',
      attributes: { tag: 'input', type: 'email' }, children: [],
    },
    {
      role: 'generic', name: 'Wrapper', children: [
        { role: 'link', name: 'Pricing', axId: 'ax-pricing', href: '/pricing', selector: '#p', children: [] },
      ],
    },
  ],
}];

describe('bridge: ref resolution', () => {
  it('resolves a ref to the axId the collector stamped', async () => {
    const { snapshots, pageAdapter, bridge } = setup();
    const built = await bridge.call('snapshot', { tabId: '1' });
    await bridge.call('clickRef', { tabId: '1', ref: refFor(snapshots, 'ax-email') });

    const script = pageAdapter.calls[0];
    expect(script).toContain('ax-email');
    // The attribute it looks up is the one the collector actually writes.
    expect(script).toContain(AX_MARKER_ATTR);
    expect(Object.keys(built.refs).length).toBeGreaterThan(1);
  });

  it('never puts a bare ref into a script', async () => {
    const { snapshots, pageAdapter, bridge } = setup();
    const built = snapshots.build(TREE, {});
    const ref = Object.values(built.refs).find((n) => n.axId === 'ax-pricing').ref;

    await bridge.call('clickRef', { tabId: '1', ref });
    // A ref is an index into the manager, not something the page can resolve.
    expect(pageAdapter.calls[0]).not.toContain(`"${ref}"`);
    expect(pageAdapter.calls[0]).toContain('ax-pricing');
  });

  it('fails on a stale ref rather than scripting something arbitrary', async () => {
    const { snapshots, pageAdapter, bridge } = setup();
    snapshots.build(TREE, {});
    await expect(bridge.call('clickRef', { tabId: '1', ref: 'e999' }))
      .rejects.toThrow(/Stale ref "e999"/);
    // No script was injected, so nothing could have been clicked.
    expect(pageAdapter.calls).toHaveLength(0);
  });

  it('refuses a structural node instead of clicking a neighbour', async () => {
    const { snapshots, pageAdapter, bridge } = setup();
    const built = snapshots.build(TREE, {});
    const structural = Object.values(built.refs).find((n) => !n.actionable);
    await expect(bridge.call('clickRef', { tabId: '1', ref: structural.ref }))
      .rejects.toThrow(/structural node/);
    expect(pageAdapter.calls).toHaveLength(0);
  });

  it('says so when a ref resolves to a CDP id this adapter cannot address', async () => {
    const { pageAdapter, bridge } = setup({
      pageAdapter: {
        ...fakeAdapter(),
        async getAxTree() { return [{ role: 'button', name: 'Go', backendNodeId: 42, children: [] }]; },
      },
    });
    const built = await bridge.call('snapshot', { tabId: '1' });
    await expect(bridge.call('clickRef', { tabId: '1', ref: Object.keys(built.refs)[0] }))
      .rejects.toThrow(/cannot address it/);
    expect(pageAdapter.calls).toHaveLength(0);
  });

  it('resolves every field of a form batch before running any script', async () => {
    const { snapshots, pageAdapter, bridge } = setup();
    const built = await bridge.call('snapshot', { tabId: '1' });
    const good = refFor(snapshots, 'ax-email');

    await expect(bridge.call('fillForm', { tabId: '1', fields: [{ ref: good, value: 'a@b.co' }, { ref: 'e999', value: 'x' }] }))
      .rejects.toThrow(/Stale ref "e999"/);
    // Resolve everything first: a batch that fills one field and then discovers
    // the second is stale would leave the page half-written.
    expect(pageAdapter.calls).toHaveLength(0);
  });
});

describe('bridge: snapshot options', () => {
  it('accepts flat options, matching what the tool schema advertises', async () => {
    const { bridge } = setup();
    const wide = await bridge.call('snapshot', { tabId: '1' });
    expect(wide.nodes.length).toBe(1);

    const { snapshots, bridge: b2 } = setup();
    const deep = await b2.call('snapshot', { tabId: '1', depth: 0 });
    expect(deep.nodes[0].children).toEqual([]);
    expect(snapshots).toBeDefined();
  });

  it('accepts the nested form too', async () => {
    const { bridge } = setup();
    const r = await bridge.call('snapshot', { tabId: '1', options: { depth: 0 } });
    expect(r.nodes[0].children).toEqual([]);
  });

  it('passes maxNodes through to the manager', async () => {
    const { bridge } = setup();
    const r = await bridge.call('snapshot', { tabId: '1', maxNodes: 1 });
    expect(Object.keys(r.refs).length).toBe(1);
  });
});

describe('bridge: page reading tools', () => {
  it('pageFind searches the in-memory snapshot without touching the page', async () => {
    const { snapshots, pageAdapter, bridge } = setup();
    snapshots.build(TREE, {});
    const r = await bridge.call('pageFind', { tabId: '1', query: 'Pricing' });
    expect(r.mode).toBe('tree');
    expect(r.matches[0].href).toBe('/pricing');
    // A single-page search must not inject a script or make any request.
    expect(pageAdapter.calls).toHaveLength(0);
  });

  it('pageFind defaults to actionable-only so hits can be acted on', async () => {
    const { snapshots, bridge } = setup();
    snapshots.build(TREE, {});
    const on = await bridge.call('pageFind', { tabId: '1', query: 'e' });
    const off = await bridge.call('pageFind', { tabId: '1', query: 'e', actionableOnly: false });
    expect(off.matches.length).toBeGreaterThanOrEqual(on.matches.length);
  });

  it('pageSearchText runs a live-DOM script because text mode can see prose', async () => {
    const { pageAdapter, bridge } = setup();
    await bridge.call('pageSearchText', { tabId: '1', query: 'anything' });
    expect(pageAdapter.calls).toHaveLength(1);
  });

  it('domQuery passes the selector and options into the script', async () => {
    const { pageAdapter, bridge } = setup();
    await bridge.call('domQuery', { tabId: '1', selector: 'input[type=hidden]', includeAttrs: ['name'], limit: 5 });
    expect(pageAdapter.calls[0]).toContain('input[type=hidden]');
    expect(pageAdapter.calls[0]).toContain('name');
  });

  it('reports a failing page script instead of returning null', async () => {
    const { snapshots, bridge } = setup({
      pageAdapter: {
        ...fakeAdapter(),
        executeInTab: async () => { throw new Error('execution context destroyed'); },
      },
    });
    const built = await bridge.call('snapshot', { tabId: '1' });
    await expect(bridge.call('clickRef', { tabId: '1', ref: refFor(snapshots, 'ax-email') }))
      .rejects.toThrow(/Page script failed: execution context destroyed/);
    expect(built).toBeDefined();
  });

  it('fails clearly when no page adapter is configured', async () => {
    const bridge = new InProcessBridge({ snapshots: new SnapshotManager() });
    // Blaming the caller's ref would send them looking in the wrong place.
    await expect(bridge.call('clickRef', { tabId: '1', ref: 'e1' }))
      .rejects.toThrow(/No page adapter configured/);
    await expect(bridge.call('snapshot', { tabId: '1' }))
      .rejects.toThrow(/No page adapter configured/);
  });
});

describe('bridge: navigate', () => {
  it('clears DOM stamps and resets refs so ids cannot be recycled', async () => {
    const { snapshots, pageAdapter, bridge } = setup();
    const built = snapshots.build(TREE, {});
    const ref = Object.keys(built.refs)[0];

    await bridge.call('navigate', { tabId: '1', url: 'https://example.com/next' });

    expect(pageAdapter.calls[0]).toBe('CLEAR_MARKERS');
    expect(pageAdapter.calls[1]).toBe('NAVIGATE');
    expect(() => snapshots.resolveRef(ref)).toThrow(/Stale ref/);
  });

  it('still navigates when stamp cleanup fails', async () => {
    const bridge = setup({
      pageAdapter: {
        ...fakeAdapter(),
        clearMarkers: async () => { throw new Error('document gone'); },
        async navigate() {},
      },
    }).bridge;
    await expect(bridge.call('navigate', { tabId: '1', url: 'https://example.com/' }))
      .resolves.toEqual({ ok: true });
  });
});

describe('bridge: search delegation', () => {
  it('delegates webSearch and newsSearch to the provider', async () => {
    const search = {
      searchDetailed: jest.fn(async () => ({ provider: 'tavily', scraped: false, results: [] })),
      searchNewsDetailed: jest.fn(async () => ({ provider: 'tavily', scraped: false, timestampsReliable: true, results: [] })),
      getProviderInfo: jest.fn(() => [{ id: 'tavily', newsIndex: true }]),
    };
    const { bridge } = setup({ search });

    await bridge.call('webSearch', { query: 'q', maxResults: 3 });
    expect(search.searchDetailed).toHaveBeenCalledWith('q', null, 3);

    await bridge.call('newsSearch', { query: 'q', maxResults: 5, days: 3 });
    expect(search.searchNewsDetailed).toHaveBeenCalledWith('q', 5, expect.objectContaining({ days: 3 }));

    expect((await bridge.call('searchProviders', {})).providers).toHaveLength(1);
  });

  it('throws rather than pretending to search when no provider is wired', async () => {
    const { bridge } = setup();
    await expect(bridge.call('webSearch', { query: 'q' })).rejects.toThrow(/No search provider configured/);
    // ...but listing providers is still safe.
    expect(await bridge.call('searchProviders', {})).toEqual({ providers: [] });
  });

  it('rejects an unknown bridge method', async () => {
    const { bridge } = setup();
    await expect(bridge.call('teleport', {})).rejects.toThrow(/Unknown bridge method: teleport/);
  });
});

describe('tool descriptors', () => {
  const byName = Object.fromEntries(ALL_TOOLS.map((t) => [t.name, t]));

  it('exposes the new tools', () => {
    for (const n of ['page_find', 'dom_query', 'get_page_text', 'web_search', 'news_search', 'search_providers', 'fill_form', 'form_submit']) {
      expect(byName[n]).toBeDefined();
    }
  });

  it('describes every required parameter', () => {
    for (const tool of ALL_TOOLS) {
      for (const key of tool.inputSchema.required || []) {
        expect(tool.inputSchema.properties[key]).toBeDefined();
      }
    }
  });

  it('marks web_search output untrusted, because it returns web content', () => {
    expect(byName.web_search.untrustedOutput).toBe(true);
    expect(byName.news_search.untrustedOutput).toBe(true);
    expect(byName.page_find.untrustedOutput).toBe(true);
  });

  it('tells the model that web_search scrapes when no key is configured', () => {
    const d = byName.web_search.description;
    // A model that does not know this cannot reason about result quality.
    expect(d).toMatch(/SCRAPES|scrapes/i);
    expect(d).toMatch(/429|rate-limit/i);
    expect(d).toMatch(/third-party|leaves the user/i);
  });

  it('warns that news_search timestamps can be unreliable', () => {
    expect(byName.news_search.description).toMatch(/timestampsReliable/);
    expect(byName.news_search.description).toMatch(/date|recent|newest/i);
  });

  it('tells the model to use page_find instead of web_search for one page', () => {
    expect(byName.page_find.description).toMatch(/ONE already-open page|one page/i);
    expect(byName.page_find.description).toMatch(/No network request/i);
  });
});

describe('fill and submit are separate decisions', () => {
  const fill = ALL_TOOLS.find((t) => t.name === 'fill_form');
  const submit = ALL_TOOLS.find((t) => t.name === 'form_submit');

  function ctx(bridge) {
    return { bridge, search: null };
  }

  it('fill_form is an input verb, not a side-effecting one', () => {
    expect(fill.verb).toBe('input');
  });

  it('form_submit is side-effecting so approval gating applies', () => {
    expect(submit.verb).toBe('sideEffecting');
  });

  it('fill_form refuses a submit flag even if one is smuggled in', async () => {
    // Without this, a caller could reach the submit path through the tool that
    // the approval gate rates as merely "input".
    const bridge = { call: jest.fn(async () => ({ ok: true })) };
    await expect(fill.handler({ tabId: '1', fields: [], submit: true }, ctx(bridge)))
      .rejects.toThrow(/fill_form does not submit/);
    expect(bridge.call).not.toHaveBeenCalled();
  });

  it('fill_form forces submit:false on the bridge call', async () => {
    const bridge = { call: jest.fn(async () => ({ ok: true })) };
    await fill.handler({ tabId: '1', fields: [{ ref: 'e1', value: 'x' }] }, ctx(bridge));
    expect(bridge.call).toHaveBeenCalledWith('fillForm', expect.objectContaining({ submit: false }));
  });

  it('states in both descriptions that filling is not submitting', () => {
    expect(fill.description).toMatch(/NEVER submits/);
    expect(submit.description).toMatch(/explicitly asked/);
  });

  it('form_submit requires a ref so the target form is unambiguous', () => {
    expect(submit.inputSchema.required).toContain('ref');
  });
});

describe('tools degrade without a search provider', () => {
  it('web_search returns a plain explanation rather than an error', async () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'web_search');
    const out = await tool.handler({ query: 'q' }, { bridge: {}, search: undefined });
    // An error here reads as "search is broken"; a sentence reads as "search is
    // not set up", which is the truth and is fixable by the user.
    expect(out.content[0].text).toMatch(/No web search provider is configured/);
  });

  it('news_search says the same', async () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'news_search');
    const out = await tool.handler({ query: 'q' }, { bridge: {}, search: undefined });
    expect(out.content[0].text).toMatch(/No web search provider is configured/);
  });

  it('search_providers returns an empty list instead of failing', async () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'search_providers');
    const out = await tool.handler({}, { bridge: {}, search: undefined });
    expect(JSON.parse(out.content[0].text)).toEqual({ providers: [] });
  });
});
