const fetch = require('cross-fetch');
const { JSDOM } = require('jsdom');
const { fetchPageContent: sharedFetchPageContent, DEFAULT_UA } = require('./web-extractor');

/** Hard ceiling on results per query. Free tiers are metered per call. */
const MAX_RESULTS = 20;

/**
 * Providers that fetch a search engine's raw HTML and parse it with CSS
 * selectors and regexes. They work with no API key and no account, and they break
 * without warning the moment the engine changes its markup. Anything that falls
 * back to one of these must say so in its response.
 */
const SCRAPE_PROVIDERS = new Set(['googlescrape', 'duckduckgo', 'youtubescrape']);

/** Providers with a real news index, best first. */
const NEWS_PROVIDERS = ['tavily', 'brave', 'serp'];

/**
 * Alternate env var names for the same key. The documented name in .env.example
 * and the name the code read had drifted apart, so a correctly configured setup
 * silently ran on scraping. Both spellings now resolve to one key.
 */
const KEY_ALIASES = {
  SERP_API_KEY: ['SERPAPI_API_KEY'],
  GOOGLE_API_KEY: ['GOOGLE_SEARCH_API_KEY', 'GOOGLE_CSE_API_KEY'],
  TAVILY_API_KEY: ['TAVILY_KEY'],
  BRAVE_API_KEY: ['BRAVE_SEARCH_API_KEY'],
};

class WebSearchProvider {
  constructor() {
    this.keys = {};
  }

  configure(keys) {
    this.keys = { ...this.keys, ...keys };
  }

  _getKey(name) {
    const names = [name, ...(KEY_ALIASES[name] || [])];
    for (const n of names) {
      const v = this.keys[n] ?? process.env[n];
      if (v) return String(v).trim();
    }
    return '';
  }

  /** Clamp a caller-supplied result count into a sane, metered range. */
  _clampCount(count) {
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return 8;
    return Math.min(Math.round(n), MAX_RESULTS);
  }

  async search(query, provider, count) {
    provider = provider || this._detectBestProvider();
    count = this._clampCount(count);

    switch (provider) {
      case 'google': return this._searchGoogle(query, count);
      case 'googlescrape': return this._searchGoogleScrape(query, count);
      case 'brave': return this._searchBrave(query, count);
      case 'tavily': return this._searchTavily(query, count);
      case 'serp': return this._searchSerp(query, count);
      case 'duckduckgo': return this._searchDuckDuckGo(query, count);
      case 'youtube': return this._searchYouTube(query, count);
      default: return this._searchGoogle(query, count);
    }
  }

  /**
   * Search and report *how* the answer was obtained.
   *
   * The plain `search()` return value looks identical whether it came from a
   * paid API or from parsing raw engine HTML, which makes it impossible for a
   * caller to weight the result honestly. This wraps it with `scraped` and
   * `reason` so that distinction survives the trip to the model.
   */
  async searchDetailed(query, provider, count) {
    let chosen = provider || this._detectBestProvider();
    let usedFallback = false;

    if (this._isDeprecated(chosen)) {
      // Google Custom Search JSON API is closed to new customers and existing
      // keys end 2027-01-01. Fail over to something that still works rather than
      // surfacing an error the user cannot act on.
      usedFallback = true;
      chosen = this._firstLiveApiProvider() || this._fallbackProvider();
    }

    try {
      const results = await this.search(query, chosen, count);
      return {
        provider: chosen,
        scraped: SCRAPE_PROVIDERS.has(chosen),
        ...(usedFallback ? { fallbackFrom: provider, reason: `${provider} is deprecated for new signups; used ${chosen} instead.` } : {}),
        results: Array.isArray(results) ? results : [],
      };
    } catch (e) {
      // An API key that is present but rejected (expired quota, wrong plan) must
      // not be the end of the search: fall back once and label the degradation.
      const fb = this._fallbackProvider(chosen);
      if (!fb) {
        return { provider: chosen, scraped: SCRAPE_PROVIDERS.has(chosen), results: [], reason: e.message };
      }
      try {
        const results = await this.search(query, fb, count);
        return {
          provider: fb,
          scraped: SCRAPE_PROVIDERS.has(fb),
          fallbackFrom: chosen,
          reason: `${chosen} failed (${e.message}); fell back to ${fb}.`,
          results: Array.isArray(results) ? results : [],
        };
      } catch (e2) {
        return { provider: chosen, scraped: SCRAPE_PROVIDERS.has(chosen), results: [], reason: e2.message };
      }
    }
  }

  _isDeprecated(provider) {
    return provider === 'google';
  }

  /** First provider with a live API key, in cost-of-adoption order. */
  _firstLiveApiProvider() {
    if (this._getKey('TAVILY_API_KEY')) return 'tavily';
    if (this._getKey('BRAVE_API_KEY')) return 'brave';
    if (this._getKey('SERP_API_KEY')) return 'serp';
    return null;
  }

  /** Last resort when every configured API is unusable. */
  _fallbackProvider(exclude) {
    const order = ['duckduckgo', 'googlescrape'];
    for (const p of order) {
      if (p !== exclude) return p;
    }
    return exclude ?? null;
  }

  /**
   * What each provider can and cannot do, so a caller can pick deliberately.
   * Contains no key material — only whether a key is present.
   */
  getProviderInfo() {
    const info = [
      {
        id: 'tavily', name: 'Tavily', keyConfigured: !!this._getKey('TAVILY_API_KEY'),
        keyEnv: 'TAVILY_API_KEY', scrapes: false, newsIndex: true, deprecated: false,
        note: 'Recommended default: 1,000 free credits/month, no card required.',
      },
      {
        id: 'brave', name: 'Brave Search', keyConfigured: !!this._getKey('BRAVE_API_KEY'),
        keyEnv: 'BRAVE_API_KEY', scrapes: false, newsIndex: true, deprecated: false,
        note: 'Free tier needs a card on file and requires attribution on the built-in search UI.',
      },
      {
        id: 'serp', name: 'SerpAPI', keyConfigured: !!this._getKey('SERP_API_KEY'),
        keyEnv: 'SERP_API_KEY or SERPAPI_API_KEY', scrapes: false, newsIndex: true, deprecated: false,
        note: '250 free searches/month.',
      },
      {
        id: 'google', name: 'Google Custom Search JSON', keyConfigured: !!(this._getKey('GOOGLE_API_KEY') && this._getKey('GOOGLE_SEARCH_ENGINE_ID')),
        keyEnv: 'GOOGLE_API_KEY + GOOGLE_SEARCH_ENGINE_ID', scrapes: false, newsIndex: false, deprecated: true,
        note: 'DEPRECATED — closed to new customers; existing keys end 2027-01-01. Requests fall back automatically.',
      },
      {
        id: 'duckduckgo', name: 'DuckDuckGo (scraped)', keyConfigured: true,
        keyEnv: null, scrapes: true, newsIndex: false, deprecated: false,
        note: 'No key needed. Parses HTML, so it rate-limits and breaks when the markup changes.',
      },
      {
        id: 'googlescrape', name: 'Google (scraped)', keyConfigured: true,
        keyEnv: null, scrapes: true, newsIndex: false, deprecated: false,
        note: 'No key needed. Blocks automated traffic aggressively; expect 429s.',
      },
    ];
    return info;
  }

  /**
   * API providers first, scraping only as a last resort. Google CSE is demoted
   * below the others because it no longer accepts new signups.
   */
  _detectBestProvider() {
    if (this._getKey('TAVILY_API_KEY')) return 'tavily';
    if (this._getKey('BRAVE_API_KEY')) return 'brave';
    if (this._getKey('SERP_API_KEY')) return 'serp';
    if (this._getKey('GOOGLE_API_KEY') && this._getKey('GOOGLE_SEARCH_ENGINE_ID')) return 'google';
    return 'googlescrape';
  }

  getAvailableProviders() {
    const providers = ['googlescrape', 'duckduckgo'];
    if (this._getKey('GOOGLE_API_KEY') && this._getKey('GOOGLE_SEARCH_ENGINE_ID')) providers.push('google');
    if (this._getKey('BRAVE_API_KEY')) providers.push('brave');
    if (this._getKey('TAVILY_API_KEY')) providers.push('tavily');
    if (this._getKey('SERP_API_KEY')) providers.push('serp');
    return providers;
  }

  async _searchGoogle(query, count) {
    const apiKey = this._getKey('GOOGLE_API_KEY');
    const searchEngineId = this._getKey('GOOGLE_SEARCH_ENGINE_ID');
    if (!apiKey || !searchEngineId) throw new Error('Google API Key and Search Engine ID not configured');

    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${searchEngineId}&num=${Math.min(count, 10)}`
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Search error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return (data.items || []).map(r => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
    }));
  }

  async _searchGoogleScrape(query, count) {
    try {
      const res = await fetch(
        `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(count, 20)}&hl=en`,
        {
          headers: {
            'User-Agent': DEFAULT_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'max-age=0',
          },
        }
      );

      if (!res.ok) {
        if (res.status === 429) {
          console.warn('[WebSearch] Google returned 429 (rate limited), falling back to DuckDuckGo');
          return this._searchDuckDuckGo(query, count);
        }
        throw new Error(`Google Search scrape error ${res.status}`);
      }

      const html = await res.text();
      const dom = new JSDOM(html);
      const doc = dom.window.document;
      const results = [];

      // Multiple selector strategies to handle Google DOM changes
      const selectors = [
        // Primary: modern div.g containers
        'div.g',
        // Fallback: newer container class
        'div.MjjYud',
        // Fallback: search result with role
        'div[jscontroller][role="heading"] ~ div',
        // Fallback: any div containing h3 within a search result
        'div.sr-only ~ div.g',
      ];

      let blocks = [];
      for (const sel of selectors) {
        blocks = [...doc.querySelectorAll(sel)];
        if (blocks.length > 0) break;
      }

      for (const block of blocks) {
        if (results.length >= count) break;

        // Try multiple anchor selectors
        let anchor = block.querySelector('a[href^="http"]:not([href*="google.com"])');
        if (!anchor) anchor = block.querySelector('a[jsname="UWckNb"]');
        if (!anchor) anchor = block.querySelector('a[href^="/url?q="]');
        if (!anchor) continue;

        // Extract title from h3
        const titleEl = block.querySelector('h3');
        if (!titleEl) continue;
        const title = titleEl.textContent.trim();
        if (!title) continue;

        // Extract URL
        let url = anchor.getAttribute('href') || '';
        if (url.startsWith('/url?q=')) {
          url = decodeURIComponent(url.replace('/url?q=', '').split('&')[0]);
        }
        if (!url.startsWith('http')) continue;

        // Try multiple snippet selectors
        const snippetSelectors = [
          'div.VwiC3b',
          'div[data-sncf]',
          'span.st',
          'div.lEBKkf',
          'div[role="heading"] + div',
        ];
        let snippet = '';
        for (const ss of snippetSelectors) {
          const el = block.querySelector(ss);
          if (el) {
            snippet = el.textContent.trim();
            break;
          }
        }

        // Deduplicate by URL
        if (!results.some(r => r.url === url)) {
          results.push({ title, url, snippet });
        }
      }

      // If no results with CSS selectors, try regex fallback
      if (results.length === 0) {
        return this._searchGoogleScrapeFallback(html, count);
      }

      return results;
    } catch (e) {
      console.warn(`[WebSearch] Google scrape failed: ${e.message}`);
      try {
        return await this._searchDuckDuckGo(query, count);
      } catch {
        return [];
      }
    }
  }

  _searchGoogleScrapeFallback(html, count) {
    const results = [];
    const patterns = [
      // Pattern: <a href="/url?q=URL"> with <h3> title
      /<a[^>]+href="\/url\?q=([^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi,
      // Pattern: Direct links with h3
      /<a[^>]+href="(https?:\/\/(?!www\.google\.)[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null && results.length < count) {
        let url = match[1].trim();
        const title = match[2].replace(/<[^>]*>/g, '').trim();
        if (!title || !url.startsWith('http')) continue;

        // Extract snippet near this result
        const beforeText = html.substring(Math.max(0, match.index - 500), match.index);
        const afterText = html.substring(match.index, match.index + 1000);
        const context = beforeText + afterText;

        let snippet = '';
        const snippetMatch = context.match(/<div[^>]*class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (snippetMatch) {
          snippet = snippetMatch[1].replace(/<[^>]*>/g, '').trim();
        }

        if (!results.some(r => r.url === url)) {
          results.push({ title, url, snippet });
        }
      }
      if (results.length > 0) break;
    }

    return results;
  }

  async _searchBrave(query, count, opts = {}) {
    const apiKey = this._getKey('BRAVE_API_KEY');
    if (!apiKey) throw new Error('BRAVE_API_KEY not configured');

    const params = new URLSearchParams({ q: query, count: String(count) });
    const days = this._freshness(opts.days);
    if (days) params.set('freshness', days);
    if (opts.country) params.set('country', String(opts.country));

    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
      { headers: { 'X-Subscription-Token': apiKey } }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Brave Search error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return (data.web?.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || '',
      publishedAt: r.page_age || r.age || null,
    }));
  }

  async _searchTavily(query, count, opts = {}) {
    const apiKey = this._getKey('TAVILY_API_KEY');
    if (!apiKey) throw new Error('TAVILY_API_KEY not configured');

    const body = {
      api_key: apiKey,
      query,
      search_depth: opts.depth === 'advanced' ? 'advanced' : 'basic',
      max_results: count,
      include_answer: false,
    };
    if (opts.days) {
      body.days = Math.max(1, Math.min(Number(opts.days) || 7, 365));
    }
    if (opts.topic) body.topic = String(opts.topic);

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Tavily Search error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return (data.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
      publishedAt: r.published_date || null,
      score: typeof r.score === 'number' ? r.score : null,
    }));
  }

  async _searchSerp(query, count, opts = {}) {
    const apiKey = this._getKey('SERP_API_KEY');
    if (!apiKey) throw new Error('SERP_API_KEY not configured');

    const params = new URLSearchParams({ q: query, api_key: apiKey, num: String(count) });
    params.set('engine', opts.engine || 'google');

    const res = await fetch(`https://serpapi.com/search?${params.toString()}`);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`SerpAPI error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return (data.organic_results || []).map(r => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
      publishedAt: r.date || null,
    }));
  }

  /** Translate a day window into Brave's freshness vocabulary. */
  _freshness(days) {
    const d = Number(days);
    if (!Number.isFinite(d) || d <= 0) return null;
    if (d <= 1) return 'pd';
    if (d <= 7) return 'pw';
    if (d <= 31) return 'pm';
    return 'py';
  }

  /**
   * News search, with dates.
   *
   * The whole point of the separate entry point is that `web_search` results
   * carry no trustworthy timestamps, so they cannot answer "which report is
   * newest". When no provider with a real news index is keyed, this falls back to
   * web search and marks the timestamps unreliable rather than pretending the
   * recency phrase in the query produced real dates.
   */
  async searchNewsDetailed(query, count, opts = {}) {
    const n = this._clampCount(count ?? 8);
    const days = Number(opts.days) > 0 ? Number(opts.days) : 7;

    const requested = opts.provider || this._firstNewsProvider();
    if (requested) {
      try {
        const results = await this._searchNews(query, n, requested, days, opts);
        return {
          provider: requested,
          scraped: false,
          timestampsReliable: true,
          results: Array.isArray(results) ? results : [],
        };
      } catch (e) {
        const other = this._firstNewsProvider(requested);
        if (other) {
          try {
            const results = await this._searchNews(query, n, other, days, opts);
            return {
              provider: other,
              scraped: false,
              timestampsReliable: true,
              fallbackFrom: requested,
              reason: `${requested} failed (${e.message}); used ${other} instead.`,
              results: Array.isArray(results) ? results : [],
            };
          } catch { /* fall through to the scrape path */ }
        }
        return { provider: requested, scraped: false, timestampsReliable: true, results: [], reason: e.message };
      }
    }

    // No news index available. Recency is expressed in the query only, so any
    // date we surface is a guess and is labelled as such.
    const datedQuery = `${query} ${days <= 1 ? 'today' : `past ${days} days`}`;
    const fb = this._fallbackProvider();
    try {
      const results = await this.search(datedQuery, fb, n);
      return {
        provider: fb,
        scraped: true,
        timestampsReliable: false,
        reason:
          'No news-capable search API key is configured, so this fell back to scraping a general '
          + 'web search with a recency phrase. Publication dates are NOT reliable — do not use these '
          + 'results to decide which source is the most recent.',
        results: (Array.isArray(results) ? results : []).map(r => ({ ...r, publishedAt: null })),
      };
    } catch (e) {
      return { provider: fb, scraped: true, timestampsReliable: false, results: [], reason: e.message };
    }
  }

  _firstNewsProvider(exclude) {
    for (const p of NEWS_PROVIDERS) {
      if (p === exclude) continue;
      if (this._getKey(p === 'tavily' ? 'TAVILY_API_KEY' : p === 'brave' ? 'BRAVE_API_KEY' : 'SERP_API_KEY')) return p;
    }
    return null;
  }

  async _searchNews(query, count, provider, days, opts) {
    switch (provider) {
      case 'tavily': return this._searchNewsTavily(query, count, days, opts);
      case 'brave': return this._searchNewsBrave(query, count, days, opts);
      case 'serp': return this._searchNewsSerp(query, count, days, opts);
      default: throw new Error(`No news support for provider ${provider}`);
    }
  }

  /** Tavily news topic — dated results from a real news crawl. */
  async _searchNewsTavily(query, count, days, opts) {
    return this._searchTavily(query, count, { ...opts, topic: 'news', days });
  }

  /** Brave's dedicated news endpoint, which returns age fields. */
  async _searchNewsBrave(query, count, days) {
    const apiKey = this._getKey('BRAVE_API_KEY');
    if (!apiKey) throw new Error('BRAVE_API_KEY not configured');

    const params = new URLSearchParams({ q: query, count: String(count) });
    const fresh = this._freshness(days);
    if (fresh) params.set('freshness', fresh);

    const res = await fetch(
      `https://api.search.brave.com/res/v1/news/search?${params.toString()}`,
      { headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' } }
    );
    if (!res.ok) throw new Error(`Brave News error ${res.status}: ${await res.text()}`);

    const data = await res.json();
    return (data.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || '',
      publishedAt: r.age || r.page_age || null,
      source: r.meta_url || null,
    }));
  }

  /** SerpAPI's google_news engine, which carries date strings. */
  async _searchNewsSerp(query, count, days) {
    const apiKey = this._getKey('SERP_API_KEY');
    if (!apiKey) throw new Error('SERP_API_KEY not configured');

    const params = new URLSearchParams({
      q: query,
      api_key: apiKey,
      num: String(count),
      engine: 'google_news',
      tbs: `qdr:d${Math.max(1, Math.min(days, 30))}`,
    });

    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    if (!res.ok) throw new Error(`SerpAPI news error ${res.status}: ${await res.text()}`);

    const data = await res.json();
    return (data.news_results || []).map(r => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
      publishedAt: r.date || null,
      source: r.source || null,
    }));
  }

  async _searchDuckDuckGo(query, count) {
    try {
      const htmlRes = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        {
          headers: {
            'User-Agent': DEFAULT_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        }
      );

      if (!htmlRes.ok) {
        throw new Error(`DuckDuckGo HTML search error ${htmlRes.status}`);
      }

      const html = await htmlRes.text();
      const results = [];
      const snippets = [];

      // Try multiple HTML patterns (DDG changes their markup frequently)
      const patterns = [
        // Pattern 1: Modern DDG result links (class="result__a")
        { link: /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
          snippet: /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi },
        // Pattern 2: Article result items with heading links
        { link: /<article[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
          snippet: /<article[^>]*>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi },
      ];

      for (const pattern of patterns) {
        if (results.length >= count) break;
        snippets.length = 0;

        // Collect snippets
        let sMatch;
        while ((sMatch = pattern.snippet.exec(html)) !== null) {
          snippets.push(sMatch[1].replace(/<[^>]*>/g, '').trim());
        }

        // Collect links
        let linkMatch;
        while ((linkMatch = pattern.link.exec(html)) !== null && results.length < count) {
          let rawUrl = linkMatch[1].trim();
          const title = linkMatch[2].replace(/<[^>]*>/g, '').trim();
          if (!title) continue;
          const cleanUrl = this._cleanDdgUrl(rawUrl);
          if (!cleanUrl || results.some(r => r.url === cleanUrl)) continue;
          const snippet = snippets[results.length] || '';
          results.push({ title, url: cleanUrl, snippet });
        }
      }

      return results;
    } catch (e) {
      console.warn(`[WebSearch] DuckDuckGo HTML search failed: ${e.message}`);
      try {
        const res = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&t=aartiq`
        );
        if (!res.ok) return [];
        const data = await res.json();
        const fallback = [];
        if (data.RelatedTopics) {
          for (const topic of data.RelatedTopics.slice(0, count)) {
            if (topic.Text && topic.FirstURL) {
              fallback.push({
                title: topic.Text.split(' - ')[0] || 'Related Topic',
                url: topic.FirstURL,
                snippet: topic.Text,
              });
            }
          }
        }
        if (data.Abstract) {
          fallback.unshift({
            title: data.Headline || data.Heading || 'Summary',
            url: data.AbstractURL || '',
            snippet: data.Abstract,
          });
        }
        return fallback;
      } catch (e2) {
        console.warn(`[WebSearch] DuckDuckGo API fallback also failed: ${e2.message}`);
        return [];
      }
    }
  }

  _cleanDdgUrl(rawUrl) {
    try {
      const decoded = rawUrl.replace(/&amp;/g, '&');
      const urlObj = new URL(decoded, 'https://duckduckgo.com');
      if (urlObj.hostname === 'duckduckgo.com' && urlObj.pathname === '/l/') {
        const uddg = urlObj.searchParams.get('uddg');
        if (uddg) return decodeURIComponent(uddg);
      }
      if (urlObj.hostname === 'duckduckgo.com' && decoded.includes('uddg=')) {
        const match = decoded.match(/uddg=([^&]+)/);
        if (match) return decodeURIComponent(match[1]);
      }
      return decoded;
    } catch {
      return rawUrl;
    }
  }

  async fetchPageContent(url, maxChars = 8000) {
    return sharedFetchPageContent(url, { maxChars });
  }

  async _searchYouTube(query, count) {
    try {
      const res = await fetch(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`,
        {
          headers: {
            'User-Agent': DEFAULT_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        }
      );
      if (!res.ok) throw new Error(`YouTube search error ${res.status}`);

      const html = await res.text();
      const results = [];

      // YouTube embeds initial data in ytInitialData JSON
      const dataMatch = html.match(/var ytInitialData\s*=\s*({[\s\S]*?});\s*<\/script>/);
      if (dataMatch) {
        try {
          const data = JSON.parse(dataMatch[1]);
          const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
          for (const section of contents) {
            const items = section?.itemSectionRenderer?.contents || [];
            for (const item of items) {
              if (results.length >= count) break;
              const vid = item?.videoRenderer;
              if (!vid) continue;
              const videoId = vid.videoId;
              const title = vid.title?.runs?.[0]?.text || '';
              const url = `https://www.youtube.com/watch?v=${videoId}`;
              const snippet = vid.detailedMetadataSnippets?.[0]?.snippetText?.runs?.map((r) => r.text).join('') ||
                vid.descriptionSnippet?.runs?.map((r) => r.text).join('') || '';
              const channel = vid.ownerText?.runs?.[0]?.text || '';
              const length = vid.lengthText?.simpleText || '';
              const thumbnail = vid.thumbnail?.thumbnails?.[vid.thumbnail.thumbnails.length - 1]?.url || '';

              results.push({
                title,
                url,
                snippet: snippet || channel,
                videoId,
                channel,
                length,
                thumbnail,
              });
            }
          }
        } catch (e) {
          console.warn('[WebSearch] YouTube JSON parse failed:', e.message);
        }
      }

      // Fallback: regex extraction from raw HTML
      if (results.length === 0) {
        const urlPattern = /\/watch\?v=([a-zA-Z0-9_-]{11})/g;
        const seen = new Set();
        let match;
        while ((match = urlPattern.exec(html)) !== null && results.length < count) {
          const videoId = match[1];
          if (seen.has(videoId)) continue;
          seen.add(videoId);
          results.push({
            title: `YouTube Video ${videoId}`,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            snippet: '',
            videoId,
            channel: '',
            length: '',
            thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          });
        }
      }

      return results;
    } catch (e) {
      console.warn(`[WebSearch] YouTube search failed: ${e.message}`);
      return [];
    }
  }

  async searchForContext(query, provider) {
    try {
      const results = await this.search(query, provider, this._clampCount(1));
      return results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
        .join('\n\n');
    } catch (e) {
      console.warn(`[WebSearch] ${e.message}`);
      return '';
    }
  }
}

module.exports = { WebSearchProvider };
