/**
 * Search provider behaviour.
 *
 * The point of these tests is the honesty of the response. A caller that cannot
 * tell an API answer from a scraped one cannot weigh it, and a caller that sees a
 * date it cannot trust will report it as fact. So: API keys are aliased, scraping
 * is always labelled, news dates are only claimed when a real news index produced
 * them, and a deprecated provider is not used when a working one exists.
 *
 * `cross-fetch` is mocked at the module boundary, so nothing here touches the
 * network and every test states exactly what was requested.
 */

const calls = [];
let current = null;

jest.mock('cross-fetch', () => (...args) => {
  calls.push({ url: String(args[0]), opts: args[1] });
  return current(...args);
});

const { WebSearchProvider } = require('../src/lib/web-search-service.js');

const json = (body, ok = true, status = 200) => async () => ({
  ok, status, json: async () => body, text: async () => JSON.stringify(body),
});
const html = (body, ok = true, status = 200) => async () => ({
  ok, status, json: async () => ({}), text: async () => body,
});

/** Install a response handler and reset the recorded requests. */
function withFetch(handler) {
  current = handler;
  calls.length = 0;
  return { WebSearchProvider };
}

/** A handler that dispatches on a substring of the URL. */
function router(routes) {
  return async (url, opts) => {
    for (const [fragment, responder] of routes) {
      if (url.includes(fragment)) return responder(url, opts);
    }
    throw new Error(`unrouted request: ${url}`);
  };
}

function requested(fragment) {
  return calls.filter((c) => c.url.includes(fragment));
}

beforeEach(() => {
  calls.length = 0;
  current = json({});
  for (const k of Object.keys(process.env)) {
    if (/(TAVILY|BRAVE|SERP|GOOGLE).*KEY|GOOGLE_SEARCH_ENGINE_ID/.test(k)) delete process.env[k];
  }
});

describe('key resolution', () => {
  it('reads the documented SerpAPI name as well as the internal one', () => {
    // .env.example documented SERPAPI_API_KEY while the code read SERP_API_KEY,
    // so a correct setup silently ran on scraping.
    withFetch(json({}));
    process.env.SERPAPI_API_KEY = 'from-alias';
    expect(new WebSearchProvider()._getKey('SERP_API_KEY')).toBe('from-alias');
    expect(new WebSearchProvider()._detectBestProvider()).toBe('serp');

    delete process.env.SERPAPI_API_KEY;
    process.env.SERP_API_KEY = 'from-canonical';
    expect(new WebSearchProvider()._getKey('SERP_API_KEY')).toBe('from-canonical');
  });

  it('accepts the alternate spellings for the other providers', () => {
    withFetch(json({}));
    process.env.TAVILY_KEY = 't-alias';
    expect(new WebSearchProvider()._getKey('TAVILY_API_KEY')).toBe('t-alias');
    process.env.BRAVE_SEARCH_API_KEY = 'b-alias';
    expect(new WebSearchProvider()._getKey('BRAVE_API_KEY')).toBe('b-alias');
    process.env.GOOGLE_SEARCH_API_KEY = 'g-alias';
    expect(new WebSearchProvider()._getKey('GOOGLE_API_KEY')).toBe('g-alias');
  });

  it('prefers configure() over the environment', () => {
    withFetch(json({}));
    process.env.TAVILY_API_KEY = 'from-env';
    const p = new WebSearchProvider();
    p.configure({ TAVILY_API_KEY: 'from-configure' });
    expect(p._getKey('TAVILY_API_KEY')).toBe('from-configure');
  });

  it('returns an empty string rather than undefined for a missing key', () => {
    withFetch(json({}));
    expect(new WebSearchProvider()._getKey('NOT_SET_ANYWHERE')).toBe('');
  });
});

describe('result counts are bounded', () => {
  it('clamps to the cap and defaults sensibly', () => {
    withFetch(json({}));
    const p = new WebSearchProvider();
    expect(p._clampCount(1000)).toBe(20);
    expect(p._clampCount(5)).toBe(5);
    expect(p._clampCount(0)).toBe(8);
    expect(p._clampCount(undefined)).toBe(8);
    expect(p._clampCount('abc')).toBe(8);
    expect(p._clampCount(-3)).toBe(8);
  });
});

describe('searchDetailed: reporting how the answer was obtained', () => {
  it('labels a keyed API result as not scraped', async () => {
    withFetch(json({ results: [{ title: 'T', url: 'https://x', content: 'c' }] }));
    const p = new WebSearchProvider();
    p.configure({ TAVILY_API_KEY: 'k' });

    const r = await p.searchDetailed('q');
    expect(r.provider).toBe('tavily');
    expect(r.scraped).toBe(false);
    expect(r.results).toHaveLength(1);
    expect(r.reason).toBeUndefined();
  });

  it('labels a keyless search as scraped', async () => {
    withFetch(html('<html><body>no results here</body></html>'));
    const r = await new WebSearchProvider().searchDetailed('q');
    // Without this flag a caller cannot tell an authoritative answer from parsed
    // HTML, and will treat both as equally trustworthy.
    expect(r.scraped).toBe(true);
    expect(r.provider).toBe('googlescrape');
    expect(Array.isArray(r.results)).toBe(true);
  });

  it('prefers a configured API over scraping', async () => {
    withFetch(json({ results: [{ title: 'T', url: 'https://api', content: '' }] }));
    const p = new WebSearchProvider();
    p.configure({ TAVILY_API_KEY: 'k' });

    const r = await p.searchDetailed('q');
    expect(r.scraped).toBe(false);
    // No scrape host is contacted at all when a key is present.
    expect(requested('google.com').length + requested('duckduckgo').length).toBe(0);
    expect(requested('api.tavily.com')).toHaveLength(1);
  });

  it('falls back to scraping and says so when the keyed API fails', async () => {
    withFetch(router([
      ['api.tavily.com', async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'Unauthorized' })],
      ['duckduckgo', html('<html><body><div class="result__a">x</div></body></html>')],
    ]));
    const p = new WebSearchProvider();
    p.configure({ TAVILY_API_KEY: 'k' });

    const r = await p.searchDetailed('q');
    // A key that is present but rejected must not be the end of the search.
    expect(r.scraped).toBe(true);
    expect(r.fallbackFrom).toBe('tavily');
    expect(r.reason).toMatch(/401/);
  });

  it('routes away from deprecated Google CSE rather than failing', async () => {
    // Closed to new customers; existing keys end 2027-01-01. A request to it must
    // not be the reason a search returns nothing.
    withFetch(json({ results: [{ title: 'T', url: 'https://t', content: '' }] }));
    const p = new WebSearchProvider();
    p.configure({ GOOGLE_API_KEY: 'g', GOOGLE_SEARCH_ENGINE_ID: 'cx', TAVILY_API_KEY: 't' });

    const r = await p.searchDetailed('q', 'google');
    expect(r.provider).not.toBe('google');
    expect(r.reason).toMatch(/deprecated/i);
    expect(r.results).toHaveLength(1);
    expect(requested('googleapis.com')).toHaveLength(0);
  });

  it('does not scrape for Google CSE when nothing else is keyed', async () => {
    // Scraping Google is both the most aggressively blocked and the least
    // useful thing to do here.
    withFetch(html('<html><body></body></html>'));
    const p = new WebSearchProvider();
    p.configure({ GOOGLE_API_KEY: 'g', GOOGLE_SEARCH_ENGINE_ID: 'cx' });

    const r = await p.searchDetailed('q', 'google');
    expect(r.provider).not.toBe('google');
    expect(requested('google.com')).toHaveLength(0);
  });

  it('ranks Google CSE last when choosing a provider on its own', () => {
    withFetch(json({}));
    const all = new WebSearchProvider();
    all.configure({ GOOGLE_API_KEY: 'g', GOOGLE_SEARCH_ENGINE_ID: 'cx', TAVILY_API_KEY: 't' });
    expect(all._detectBestProvider()).toBe('tavily');

    const onlyGoogle = new WebSearchProvider();
    onlyGoogle.configure({ GOOGLE_API_KEY: 'g', GOOGLE_SEARCH_ENGINE_ID: 'cx' });
    expect(onlyGoogle._detectBestProvider()).toBe('google');
  });

  it('reports an empty result with a reason rather than throwing', async () => {
    withFetch(async () => { throw new Error('every provider failed'); });
    const r = await new WebSearchProvider().searchDetailed('q');
    expect(r.results).toEqual([]);
    expect(typeof r.reason).toBe('string');
  });

  it('never returns a non-array in the results slot', async () => {
    withFetch(json({ nothing_useful: true }));
    const p = new WebSearchProvider();
    p.configure({ TAVILY_API_KEY: 'k' });
    expect(Array.isArray((await p.searchDetailed('q')).results)).toBe(true);
  });
});

describe('getProviderInfo', () => {
  it('reports capabilities and never leaks key material', () => {
    withFetch(json({}));
    const p = new WebSearchProvider();
    p.configure({ TAVILY_API_KEY: 'super-secret-value' });

    const info = p.getProviderInfo();
    expect(JSON.stringify(info)).not.toContain('super-secret-value');

    const tavily = info.find((x) => x.id === 'tavily');
    expect(tavily.keyConfigured).toBe(true);
    expect(tavily.scrapes).toBe(false);
    expect(tavily.newsIndex).toBe(true);
    expect(tavily.deprecated).toBe(false);

    expect(info.find((x) => x.id === 'google').deprecated).toBe(true);
    for (const id of ['duckduckgo', 'googlescrape']) {
      expect(info.find((x) => x.id === id).scrapes).toBe(true);
    }
  });

  it('distinguishes keyed from keyless providers', () => {
    withFetch(json({}));
    const info = new WebSearchProvider().getProviderInfo();
    expect(info.find((x) => x.id === 'brave').keyConfigured).toBe(false);
    // Scrapers need no key, which is exactly why they are the fallback.
    expect(info.find((x) => x.id === 'duckduckgo').keyConfigured).toBe(true);
  });
});

describe('searchNewsDetailed: dates only when they are real', () => {
  it('uses a real news index and marks timestamps reliable', async () => {
    withFetch(json({ results: [{ title: 'A', url: 'https://n', content: '', published_date: '2026-01-02' }] }));
    const p = new WebSearchProvider();
    p.configure({ TAVILY_API_KEY: 'k' });

    const r = await p.searchNewsDetailed('q', 5, { days: 3 });
    expect(r.provider).toBe('tavily');
    expect(r.scraped).toBe(false);
    expect(r.timestampsReliable).toBe(true);
    expect(r.results[0].publishedAt).toBe('2026-01-02');
    expect(JSON.parse(calls[0].opts.body).topic).toBe('news');
    expect(JSON.parse(calls[0].opts.body).days).toBe(3);
  });

  it('marks timestamps unreliable when it has to fall back to scraping', async () => {
    withFetch(html('<html><body>nothing</body></html>'));
    const r = await new WebSearchProvider().searchNewsDetailed('q', 5, { days: 2 });

    expect(r.timestampsReliable).toBe(false);
    expect(r.scraped).toBe(true);
    // Stating the consequence is the point: a model that reads this will not
    // claim a scraped result is the latest report.
    expect(r.reason).toMatch(/NOT reliable|do not use these/i);
    for (const item of r.results) expect(item.publishedAt).toBeNull();
  });

  it('leaves the query alone on the keyed path and appends recency on the fallback', async () => {
    withFetch(json({ results: [{ title: 'A', url: 'u', content: '', published_date: 'd' }] }));
    const keyed = new WebSearchProvider();
    keyed.configure({ TAVILY_API_KEY: 'k' });
    await keyed.searchNewsDetailed('acme merger', 5, { days: 1 });
    expect(JSON.parse(calls[0].opts.body).query).toBe('acme merger');

    calls.length = 0;
    withFetch(html('<html><body></body></html>'));
    await new WebSearchProvider().searchNewsDetailed('acme merger', 5, { days: 3 });
    expect(calls[0].url).toMatch(/acme\+merger|acme%20merger/);
  });

  it('uses the Brave news endpoint and surfaces its age field', async () => {
    withFetch(json({ results: [{ title: 'A', url: 'u', description: 'd', age: '2 days ago' }] }));
    const p = new WebSearchProvider();
    p.configure({ BRAVE_API_KEY: 'k' });

    const r = await p.searchNewsDetailed('q');
    expect(requested('/res/v1/news/search')).toHaveLength(1);
    expect(r.timestampsReliable).toBe(true);
    expect(r.results[0].publishedAt).toBe('2 days ago');
  });

  it('uses SerpAPI google_news and passes the recency window', async () => {
    withFetch(json({ news_results: [{ title: 'A', link: 'u', date: 'Jan 2, 2026' }] }));
    const p = new WebSearchProvider();
    p.configure({ SERP_API_KEY: 'k' });

    const r = await p.searchNewsDetailed('q', 5, { days: 3 });
    expect(calls[0].url).toContain('engine=google_news');
    expect(decodeURIComponent(calls[0].url)).toContain('tbs=qdr:d3');
    expect(r.results[0].publishedAt).toBe('Jan 2, 2026');
  });

  it('prefers Tavily over the others when several are keyed', async () => {
    withFetch(json({ results: [{ title: 'A', url: 'u', content: '', published_date: 'd' }] }));
    const p = new WebSearchProvider();
    p.configure({ TAVILY_API_KEY: 't', BRAVE_API_KEY: 'b', SERP_API_KEY: 's' });
    expect((await p.searchNewsDetailed('q')).provider).toBe('tavily');
  });

  it('moves to the next news provider when the first one errors', async () => {
    withFetch(router([
      ['api.tavily.com', async () => { throw new Error('Tavily quota exceeded'); }],
      ['/news/search', json({ results: [{ title: 'A', url: 'u', description: 'd', age: 'now' }] })],
    ]));
    const p = new WebSearchProvider();
    p.configure({ TAVILY_API_KEY: 't', BRAVE_API_KEY: 'b' });

    const r = await p.searchNewsDetailed('q');
    expect(r.provider).toBe('brave');
    // Still reliable: a different news index produced these dates.
    expect(r.timestampsReliable).toBe(true);
    expect(r.reason).toMatch(/quota exceeded/);
  });

  it('returns an empty result with a reason when every news provider fails', async () => {
    withFetch(async () => { throw new Error('all down'); });
    const p = new WebSearchProvider();
    p.configure({ TAVILY_API_KEY: 't' });

    const r = await p.searchNewsDetailed('q');
    expect(r.results).toEqual([]);
    expect(r.reason).toMatch(/all down/);
  });

  it('honours a caller-forced provider', async () => {
    withFetch(json({ news_results: [{ title: 'A', link: 'u', date: 'd' }] }));
    const p = new WebSearchProvider();
    p.configure({ TAVILY_API_KEY: 't', SERP_API_KEY: 's' });

    expect((await p.searchNewsDetailed('q', 5, { provider: 'serp' })).provider).toBe('serp');
  });

  it('translates a day window into Brave freshness vocabulary', () => {
    withFetch(json({}));
    const p = new WebSearchProvider();
    expect(p._freshness(1)).toBe('pd');
    expect(p._freshness(7)).toBe('pw');
    expect(p._freshness(30)).toBe('pm');
    expect(p._freshness(365)).toBe('py');
    expect(p._freshness(0)).toBeNull();
    expect(p._freshness('x')).toBeNull();
  });

  it('clamps the count on the news path too', async () => {
    withFetch(json({ results: [] }));
    const p = new WebSearchProvider();
    p.configure({ TAVILY_API_KEY: 'k' });
    await p.searchNewsDetailed('q', 500);
    expect(JSON.parse(calls[0].opts.body).max_results).toBe(20);
  });
});
