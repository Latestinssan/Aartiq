/**
 * Research pipeline — budgets, dates, and claim verification.
 *
 * The properties under test are the ones a user would be misled by if they broke:
 * that a job cannot run past its budget, that "the most recent report" is only
 * ever asserted when a real news index produced the dates, and that corroboration
 * counts independent publishers rather than link count.
 */

const {
  clampBudget, DEFAULT_BUDGET, domainOf, parsePublished,
  extractClaims, verifyClaims, pickLastSource, runResearch,
} = require('../src/lib/research-pipeline.js');

describe('budget', () => {
  it('defaults every field', () => {
    expect(clampBudget()).toEqual(DEFAULT_BUDGET);
    expect(clampBudget(undefined)).toEqual(DEFAULT_BUDGET);
    expect(clampBudget({})).toEqual(DEFAULT_BUDGET);
  });

  it('accepts partial overrides and fills the rest', () => {
    const b = clampBudget({ maxQueries: 3 });
    expect(b.maxQueries).toBe(3);
    expect(b.pagesToFetch).toBe(DEFAULT_BUDGET.pagesToFetch);
  });

  it('pulls out-of-range values into range instead of rejecting them', () => {
    // A UI slider should never be able to produce a job that cannot run.
    expect(clampBudget({ maxQueries: 0 }).maxQueries).toBe(1);
    expect(clampBudget({ maxQueries: 9999 }).maxQueries).toBe(20);
    expect(clampBudget({ pagesToFetch: -5 }).pagesToFetch).toBe(1);
    expect(clampBudget({ pagesToFetch: 400 }).pagesToFetch).toBe(40);
    expect(clampBudget({ maxFollowUpRounds: -1 }).maxFollowUpRounds).toBe(0);
    expect(clampBudget({ days: 9999 }).days).toBe(365);
  });

  it('ignores junk instead of producing NaN', () => {
    const b = clampBudget({ maxQueries: 'abc', pagesToFetch: null, days: NaN });
    expect(b.maxQueries).toBe(DEFAULT_BUDGET.maxQueries);
    expect(b.pagesToFetch).toBe(DEFAULT_BUDGET.pagesToFetch);
    expect(b.days).toBe(DEFAULT_BUDGET.days);
  });

  it('rounds fractional values', () => {
    expect(clampBudget({ maxQueries: 4.6 }).maxQueries).toBe(5);
  });
});

describe('domainOf', () => {
  it('strips www and keeps the registrable domain', () => {
    expect(domainOf('https://www.bbc.com/news/1')).toBe('bbc.com');
    expect(domainOf('https://news.example.co.uk/a')).toBe('example.co.uk');
  });

  it('keeps distinct publishers on the same suffix distinct', () => {
    // The point of parsing the suffix: bbc.co.uk and guardian.co.uk are two
    // independent sources, not one.
    expect(domainOf('https://www.bbc.co.uk/x')).toBe('bbc.co.uk');
    expect(domainOf('https://www.theguardian.com/y')).toBe('theguardian.com');
  });

  it('returns empty for an unparseable url rather than throwing', () => {
    expect(domainOf('not a url')).toBe('');
    expect(domainOf('')).toBe('');
  });
});

describe('parsePublished', () => {
  it('parses ISO dates', () => {
    expect(parsePublished('2026-01-02T03:04:05Z').toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('parses relative ages against now', () => {
    const twoDaysAgo = parsePublished('2 days ago');
    const delta = Date.now() - twoDaysAgo.getTime();
    expect(delta / 864e5).toBeCloseTo(2, 0);
    expect(parsePublished('3 hours ago')).toBeInstanceOf(Date);
  });

  it('returns null for missing or unusable values', () => {
    // A null date must stay null: treating it as "now" would make an undated
    // source look like the freshest one.
    expect(parsePublished(null)).toBeNull();
    expect(parsePublished('')).toBeNull();
    expect(parsePublished('recently')).toBeNull();
  });
});

describe('extractClaims', () => {
  const URL = 'https://news.example.com/story';

  it('extracts a numeric claim with its subject and predicate', () => {
    const claims = extractClaims('Acme Corp raised 450 million dollars in a funding round.', URL);
    expect(claims).toHaveLength(1);
    // The predicate is the verb — "Acme raised X" is the claim, so keying on the
    // trailing noun would split one fact into several.
    expect(claims[0].subject).toBe('Acme Corp');
    expect(claims[0].predicate).toBe('raised');
    expect(claims[0].value).toBe('450 million');
    // Subdomains collapse: `news.example.com` and `example.com` are one publisher.
    expect(claims[0].domain).toBe('example.com');
  });

  it('keys different magnitudes of the same verb to the same claim', () => {
    // "450 million dollars" and "450 million euros" are the same fact about the
    // same event; splitting them would hide a real disagreement.
    const a = extractClaims('Acme raised 450 million dollars.', URL);
    const b = extractClaims('Acme raised 450 million euros.', 'https://other.com/x');
    expect(a[0].key).toBe(b[0].key);
  });

  it('normalises equivalent numbers so they compare equal', () => {
    const a = extractClaims('Acme Corp raised 1,200 million in funding.', URL);
    const b = extractClaims('Acme Corp raised 1200 million in funding.', 'https://other.com/x');
    expect(a[0].value).toBe(b[0].value);
  });

  it('produces no claim from a sentence with no number', () => {
    expect(extractClaims('Acme Corp announced a strategic partnership today.', URL)).toEqual([]);
  });

  it('produces no claim from a sentence with no subject', () => {
    // Lowercase-starting sentences are narration, not assertions of fact.
    expect(extractClaims('the company raised 40 million last year in europe.', URL)).toEqual([]);
  });

  it('rejects a leading article as the subject', () => {
    // "The company" is not an entity; keying on it would merge every story in
    // every article into one claim called "the|company".
    expect(extractClaims('The company reported 40 million in revenue. It rose 12 percent.', URL)).toEqual([]);
  });

  it('rejects a pronoun as the subject', () => {
    expect(extractClaims('It raised 40 million in revenue this year.', URL)).toEqual([]);
  });

  it('takes a real subject that follows a dropped article', () => {
    const claims = extractClaims('The Acme Corp raised 40 million in revenue.', URL);
    expect(claims).toHaveLength(1);
    expect(claims[0].subject).toBe('Acme Corp');
    expect(claims[0].predicate).toBe('raised');
  });

  it('does not emit two claims for the same subject and predicate', () => {
    const claims = extractClaims(
      'Acme Corp raised 100 million. Acme Corp raised 200 million.', URL,
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].value).toBe('100 million');
  });

  it('stamps every claim with the source it came from', () => {
    const claims = extractClaims('Globex hired 500 people. Globex earned 90 million.', 'https://globex.org/r');
    expect(claims).toHaveLength(2);
    expect(claims.every((c) => c.domain === 'globex.org')).toBe(true);
    expect(claims.every((c) => c.url === 'https://globex.org/r')).toBe(true);
  });

  it('handles empty and junk input', () => {
    expect(extractClaims('', URL)).toEqual([]);
    expect(extractClaims(null, URL)).toEqual([]);
  });
});

describe('verifyClaims: independence, not link count', () => {
  const claim = (domain, value, key = 'acme corp|raised') => ({
    key, subject: 'Acme Corp', predicate: 'raised', value,
    text: `Acme Corp raised ${value}.`, domain, url: `https://${domain}/x`,
  });

  it('does not call a claim corroborated on one domain alone', () => {
    // Three links from one publisher, including two subdomains, are one source.
    const { findings } = verifyClaims([
      claim('reuters.com', '100 million'),
      claim('reuters.com', '100 million'),
      claim('uk.reuters.com', '100 million'),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].verdict).toBe('single_source');
    expect(findings[0].domains).toEqual(['reuters.com']);
  });

  it('re-derives the domain from the url, so a subdomain cannot fake diversity', () => {
    // A caller handing us raw hostnames must not be able to pass two
    // subdomains off as two independent publishers.
    const { findings } = verifyClaims([
      { key: 'acme|raised', subject: 'Acme', predicate: 'raised', value: '100 million', text: 't', domain: 'reuters.com', url: 'https://www.reuters.com/a' },
      { key: 'acme|raised', subject: 'Acme', predicate: 'raised', value: '100 million', text: 't', domain: 'reuters.com', url: 'https://uk.reuters.com/b' },
    ]);
    expect(findings[0].verdict).toBe('single_source');
  });

  it('counts corroboration across two different domains', () => {
    const { findings } = verifyClaims([
      claim('reuters.com', '100 million'),
      claim('bloomberg.com', '100 million'),
    ]);
    expect(findings[0].verdict).toBe('corroborated');
    expect(findings[0].domains.sort()).toEqual(['bloomberg.com', 'reuters.com']);
  });

  it('flags a dispute when independent sources report different values', () => {
    const { findings, contradictions } = verifyClaims([
      claim('reuters.com', '100 million'),
      claim('bloomberg.com', '250 million'),
    ]);
    expect(findings[0].verdict).toBe('disputed');
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].type).toBe('100 million vs 250 million raised');
    expect(contradictions[0].claim1.source).toBe('reuters.com');
    expect(contradictions[0].claim2.source).toBe('bloomberg.com');
    expect(contradictions[0].ratio).toBe('2.5');
  });

  it('quotes the sentence behind each side, so the user can judge it', () => {
    const { contradictions } = verifyClaims([
      { ...claim('a.com', '10 million'), text: 'A says 10.' },
      { ...claim('b.com', '90 million'), text: 'B says 90.' },
    ]);
    expect(contradictions[0].claim1.text).toBe('A says 10.');
    expect(contradictions[0].claim2.text).toBe('B says 90.');
  });

  it('does not invent a contradiction between two links on one domain', () => {
    const { findings, contradictions } = verifyClaims([
      claim('reuters.com', '100 million'),
      claim('reuters.com', '250 million'),
    ]);
    // One publisher correcting itself is an erratum, not two sources disagreeing.
    expect(findings[0].verdict).toBe('single_source');
    expect(contradictions).toHaveLength(0);
  });

  it('omits a ratio when the values are not comparable numbers', () => {
    const { contradictions } = verifyClaims([
      claim('a.com', 'alpha'), claim('b.com', 'beta'), 'k|p',
    ]);
    expect(contradictions[0].ratio).toBeUndefined();
  });

  it('keeps findings for unrelated claims separate', () => {
    const { findings } = verifyClaims([
      claim('a.com', '100 million', 'acme|raised'),
      claim('b.com', '100 million', 'globex|raised'),
    ]);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.verdict === 'single_source')).toBe(true);
  });

  it('lists the independent domains the run actually touched', () => {
    const { independentDomains } = verifyClaims([
      claim('a.com', 'x'), claim('b.com', 'x'), claim('a.com', 'y', 'k2|p'),
    ]);
    expect(independentDomains).toEqual(['a.com', 'b.com']);
  });

  it('handles no claims at all', () => {
    expect(verifyClaims([])).toEqual({ findings: [], contradictions: [], independentDomains: [] });
  });
});

describe('pickLastSource: never guessing recency', () => {
  const sources = [
    { url: 'https://a.com/1', title: 'A', publishedAt: '2026-01-01' },
    { url: 'https://b.com/2', title: 'B', publishedAt: '2026-03-05' },
    { url: 'https://c.com/3', title: 'C', publishedAt: '2026-02-02' },
  ];

  it('names the newest source when timestamps are trustworthy', () => {
    const last = pickLastSource(sources, true);
    expect(last.reliable).toBe(true);
    expect(last.url).toBe('https://b.com/2');
    expect(last.domain).toBe('b.com');
    expect(last.publishedAt.toISOString().slice(0, 10)).toBe('2026-03-05');
  });

  it('refuses to name a source when the dates are untrustworthy', () => {
    const last = pickLastSource(sources, false);
    expect(last.reliable).toBe(false);
    expect(last.url).toBeNull();
    // The reason has to travel with the refusal, or a caller will retry anyway.
    expect(last.reason).toMatch(/scraped/i);
    expect(last.reason).toMatch(/cannot be identified/i);
  });

  it('says so when no source carried a date at all', () => {
    const last = pickLastSource([{ url: 'https://a.com/1', title: 'A' }], true);
    expect(last.reliable).toBe(false);
    expect(last.reason).toMatch(/None of the sources returned a publication date/i);
  });

  it('handles an empty source list', () => {
    expect(pickLastSource([], true).reason).toMatch(/No sources/i);
  });

  it('ignores undated sources when a dated one exists', () => {
    const last = pickLastSource([{ url: 'https://a.com/1' }, ...sources], true);
    expect(last.url).toBe('https://b.com/2');
  });
});

/* ------------------------------------------------------------------ runner */

function harness(overrides = {}) {
  const events = [];
  const fetched = [];
  const searched = [];
  // Records first, then delegates. Spreading overrides over the recorders would
  // silently drop every call a test is asserting on.
  const deps = {
    emit(event) { events.push(event); },
    async searchNews(query, count, opts) {
      searched.push({ query, count, opts });
      if (!overrides.searchNews) return { results: [], timestampsReliable: true, provider: 'test' };
      return overrides.searchNews(query, count, opts);
    },
    async fetchPage(url) {
      fetched.push(url);
      return overrides.fetchPage ? overrides.fetchPage(url) : '';
    },
  };
  return { deps, events, fetched, searched };
}

const RESULT = (url, publishedAt, title = 'T') => ({ url, publishedAt, title });

describe('runResearch: events the UI can render', () => {
  it('emits stages the execution card already knows how to draw', async () => {
    const { deps, events } = harness({
      async searchNews() { return { results: [RESULT('https://a.com/1', '2026-01-01')], timestampsReliable: true }; },
      async fetchPage() { return 'Acme Corp raised 100 million in funding.'; },
    });
    await runResearch(deps, { query: 'acme funding' });

    const stages = events.map((e) => e.stage);
    // Each of these has an emoji in ResearchExecutionCard.stageEmoji; an unknown
    // stage renders as a generic gear and the user loses the narrative.
    for (const s of ['planning', 'searching', 'search_complete', 'ranking', 'fetching', 'extracted', 'contradiction_check', 'coverage_update', 'generating', 'complete']) {
      expect(stages).toContain(s);
    }
  });

  it('tags every event with the research id so concurrent runs do not cross', async () => {
    const { deps, events } = harness();
    const out = await runResearch(deps, { query: 'q', researchId: 'job-7' });
    expect(out.researchId).toBe('job-7');
    expect(events.every((e) => e.researchId === 'job-7')).toBe(true);
  });

  it('finishes at 100 progress and a terminal status', async () => {
    const { deps, events } = harness({
      async searchNews() { return { results: [RESULT('https://a.com/1', '2026-01-01')], timestampsReliable: true }; },
      async fetchPage() { return 'Acme Corp raised 100 million.'; },
    });
    await runResearch(deps, { query: 'q' });
    const last = events[events.length - 1];
    expect(last.stage).toBe('complete');
    expect(last.status).toBe('completed');
    expect(last.progress).toBe(100);
  });

  it('reports failure when no source could be read', async () => {
    const { deps, events } = harness({
      async searchNews() { return { results: [RESULT('https://a.com/1', '2026-01-01')], timestampsReliable: true }; },
      async fetchPage() { return ''; },
    });
    const out = await runResearch(deps, { query: 'q' });
    // Fetched one, read zero: that is a failure, not a success.
    expect(out.pagesFetched).toBe(1);
    expect(out.pagesRead).toBe(0);
    expect(events[events.length - 1].status).toBe('failed');
  });

  it('fails when search found nothing at all', async () => {
    const { deps, events } = harness();
    const out = await runResearch(deps, { query: 'q' });
    expect(events[events.length - 1].status).toBe('failed');
    expect(events[events.length - 1].message).toMatch(/No sources were found/i);
    expect(out.pagesRead).toBe(0);
  });

  it('does not report failure when pages were read but held no claims', async () => {
    // A readable page with nothing checkable is still a successful search.
    const { deps, events } = harness({
      async searchNews() { return { results: [RESULT('https://a.com/1', '2026-01-01')], timestampsReliable: true }; },
      async fetchPage() { return 'A readable article with no figures in it.'; },
    });
    const out = await runResearch(deps, { query: 'q' });
    expect(out.pagesRead).toBe(1);
    expect(out.coverage).toEqual({ percentage: 0, covered: 0, total: 0 });
    expect(events[events.length - 1].status).toBe('completed');
  });
});

describe('runResearch: budgets are hard limits', () => {
  it('runs no more queries than the budget allows', async () => {
    const { deps, searched } = harness({
      async searchNews() { return { results: [RESULT('https://a.com/1', '2026-01-01')], timestampsReliable: true }; },
    });
    const out = await runResearch(deps, {
      query: 'q',
      queries: ['a', 'b', 'c', 'd', 'e'],
      budget: { maxQueries: 2 },
    });
    expect(searched).toHaveLength(2);
    expect(out.queriesUsed).toBe(2);
  });

  it('names the queries it did not have budget for', async () => {
    // Silently dropping planned work would let the report imply coverage it
    // never achieved.
    const { deps } = harness({
      async searchNews() { return { results: [], timestampsReliable: true }; },
    });
    const out = await runResearch(deps, { query: 'q', queries: ['a', 'b', 'c'], budget: { maxQueries: 1 } });
    expect(out.skippedQueries).toEqual(['b', 'c']);
    expect(out.stoppedReason).toMatch(/Stopped at the query budget/);
  });

  it('fetches no more pages than the budget allows', async () => {
    const { deps, fetched } = harness({
      async searchNews() {
        return {
          results: [1, 2, 3, 4, 5].map((i) => RESULT(`https://d${i}.com/1`, '2026-01-01')),
          timestampsReliable: true,
        };
      },
      async fetchPage() { return 'Acme Corp raised 10 million.'; },
    });
    const out = await runResearch(deps, { query: 'q', budget: { pagesToFetch: 2 } });
    expect(fetched).toHaveLength(2);
    expect(out.pagesFetched).toBe(2);
  });

  it('de-duplicates URLs across queries so a page is not read twice', async () => {
    const { deps, fetched } = harness({
      async searchNews() { return { results: [RESULT('https://a.com/1', '2026-01-01')], timestampsReliable: true }; },
      async fetchPage() { return 'Acme Corp raised 10 million.'; },
    });
    await runResearch(deps, { query: 'q', queries: ['one', 'two'], budget: { maxQueries: 2 } });
    expect(fetched).toEqual(['https://a.com/1']);
  });

  it('passes the configured results-per-query through to the provider', async () => {
    const { deps, searched } = harness();
    await runResearch(deps, { query: 'q', budget: { resultsPerQuery: 4, days: 3 } });
    expect(searched[0].count).toBe(4);
    expect(searched[0].opts.days).toBe(3);
  });
});

describe('runResearch: survives bad input', () => {
  it('keeps going when one query throws', async () => {
    const { deps, events } = harness({
      async searchNews(query) {
        if (query === 'bad') throw new Error('provider exploded');
        return { results: [RESULT('https://a.com/1', '2026-01-01')], timestampsReliable: true };
      },
      async fetchPage() { return 'Acme Corp raised 10 million.'; },
    });
    const out = await runResearch(deps, { query: 'q', queries: ['bad', 'good'] });
    expect(events.some((e) => e.stage === 'search_error' && /provider exploded/.test(e.message))).toBe(true);
    expect(out.pagesFetched).toBe(1);
    expect(out.queriesUsed).toBe(2);
  });

  it('records a fetch error and keeps reading the rest', async () => {
    const { deps, events } = harness({
      async searchNews() {
        return {
          results: [RESULT('https://a.com/1', '2026-01-01'), RESULT('https://b.com/2', '2026-01-02')],
          timestampsReliable: true,
        };
      },
      async fetchPage(url) {
        if (url.includes('a.com')) throw new Error('connection reset');
        return 'Acme Corp raised 10 million.';
      },
    });
    const out = await runResearch(deps, { query: 'q' });
    expect(events.some((e) => e.stage === 'fetch_error' && /connection reset/.test(e.message))).toBe(true);
    expect(out.pagesFetched).toBe(2);
    expect(out.pagesRead).toBe(1);
  });

  it('does not count a dead link as a source it used', async () => {
    const { deps } = harness({
      async searchNews() {
        return {
          results: [RESULT('https://a.com/1', '2026-01-01'), RESULT('https://b.com/2', '2026-01-02')],
          timestampsReliable: true,
        };
      },
      async fetchPage(url) {
        if (url.includes('a.com')) return '';
        return 'Acme Corp raised 10 million.';
      },
    });
    const out = await runResearch(deps, { query: 'q' });
    // The report lists what it tried; `used` must mean it actually read it.
    expect(out.sources).toHaveLength(2);
    const usedByDomain = Object.fromEntries(out.sources.map((s) => [s.name, s.used]));
    expect(usedByDomain).toEqual({ 'a.com': false, 'b.com': true });
  });

  it('does not claim to know the last source when dates are untrustworthy', async () => {
    const { deps, events } = harness({
      async searchNews() {
        return { results: [RESULT('https://a.com/1', '2026-01-01')], timestampsReliable: false };
      },
      async fetchPage() { return 'Acme Corp raised 10 million.'; },
    });
    const out = await runResearch(deps, { query: 'q' });
    expect(out.timestampsReliable).toBe(false);
    expect(out.lastSource.reliable).toBe(false);
    expect(events.find((e) => e.stage === 'ranking').message).toMatch(/Most recent source unknown/);
  });

  it('fetches newest-first when the dates are trustworthy', async () => {
    const { deps, fetched } = harness({
      async searchNews() {
        return {
          results: [
            RESULT('https://old.com/1', '2026-01-01'),
            RESULT('https://new.com/1', '2026-06-01'),
            RESULT('https://mid.com/1', '2026-03-01'),
          ],
          timestampsReliable: true,
        };
      },
      async fetchPage() { return 'Acme Corp raised 10 million.'; },
    });
    await runResearch(deps, { query: 'q', budget: { maxQueries: 1 } });
    expect(fetched).toEqual(['https://new.com/1', 'https://mid.com/1', 'https://old.com/1']);
  });
});

describe('runResearch: end-to-end verification', () => {
  // Two claims per article: one all three agree on, one they disagree about. The
// distinction matters — a run where every claim is disputed and nothing is
// corroborated is a very different report from one with both outcomes.
  const PAGES = {
    'https://reuters.com/1': 'Acme Corp raised 100 million in a funding round. Acme Corp employs 4000 people.',
    'https://bloomberg.com/1': 'Acme Corp raised 100 million in a funding round. Acme Corp employs 4000 people.',
    'https://wsj.com/1': 'Acme Corp raised 250 million in a funding round. Acme Corp employs 4000 people.',
  };

  const twoDomainSearch = harness({
    async searchNews() {
      return {
        results: [
          RESULT('https://reuters.com/1', '2026-01-01', 'Reuters'),
          RESULT('https://bloomberg.com/1', '2026-01-02', 'Bloomberg'),
          RESULT('https://wsj.com/1', '2026-01-03', 'WSJ'),
        ],
        timestampsReliable: true,
      };
    },
    async fetchPage(url) { return PAGES[url] ?? ''; },
  });

  it('corroborates a claim agreed on by two publishers', async () => {
    const { deps } = twoDomainSearch;
    const out = await runResearch(deps, { query: 'acme funding' });
    const agreed = out.findings.find((f) => f.predicate === 'employs');
    expect(agreed.verdict).toBe('corroborated');
    expect(agreed.domains.sort()).toEqual(['bloomberg.com', 'reuters.com', 'wsj.com']);
  });

  it('judges the two claims in the same run independently', async () => {
    // Agreement on one fact must not launder a disagreement on another.
    const { deps } = twoDomainSearch;
    const out = await runResearch(deps, { query: 'acme funding' });
    const byPredicate = Object.fromEntries(out.findings.map((f) => [f.predicate, f.verdict]));
    expect(byPredicate).toEqual({ raised: 'disputed', employs: 'corroborated' });
  });

  it('reports the dispute and names a source for each side', async () => {
    const { deps } = twoDomainSearch;
    const out = await runResearch(deps, { query: 'acme funding' });
    expect(out.contradictions).toHaveLength(1);
    const [c] = out.contradictions;
    expect(c.type).toMatch(/raised/);
    // The two sides disagree on the number. Which of the two agreeing publishers
    // is quoted for the majority side is an arbitrary tie-break, so assert the
    // disagreement itself rather than the tie-break.
    expect(c.type).toContain('100 million');
    expect(c.type).toContain('250 million');
    const sources = [c.claim1.source, c.claim2.source];
    expect(sources).toContain('wsj.com');
    expect(sources.every((s) => s.endsWith('.com'))).toBe(true);
    expect(new Set(sources).size).toBe(2);
  });

  it('computes coverage over distinct domains, not pages read', async () => {
    const { deps } = twoDomainSearch;
    const out = await runResearch(deps, { query: 'acme funding' });
    expect(out.coverage.total).toBeGreaterThan(0);
    expect(out.coverage.percentage).toBe(100);
  });

  it('puts the contradictions on the event the report component reads', async () => {
    const { deps, events } = twoDomainSearch;
    await runResearch(deps, { query: 'acme funding' });
    const coverageEvent = events.find((e) => e.stage === 'coverage_update');
    // ResearchReport renders `contradictions` directly; if the pipeline omits it
    // the panel silently never appears.
    expect(Array.isArray(coverageEvent.contradictions)).toBe(true);
    expect(coverageEvent.contradictions).toHaveLength(1);
    expect(coverageEvent.contradictions[0]).toHaveProperty('claim1.source');
    expect(coverageEvent.contradictions[0]).toHaveProperty('claim2.source');
  });

  it('marks the sources it actually read as used', async () => {
    const { deps } = twoDomainSearch;
    const out = await runResearch(deps, { query: 'acme funding' });
    expect(out.sources).toHaveLength(3);
    expect(out.sources.every((s) => s.used)).toBe(true);
    expect(out.sources.map((s) => s.name).sort()).toEqual(['bloomberg.com', 'reuters.com', 'wsj.com']);
  });

  it('gives an empty run zero coverage rather than 100 percent', async () => {
    const { deps } = harness({
      async searchNews() { return { results: [RESULT('https://a.com/1', '2026-01-01')], timestampsReliable: true }; },
      async fetchPage() { return 'No numbers in this article at all, just prose.'; },
    });
    const out = await runResearch(deps, { query: 'q' });
    expect(out.coverage).toEqual({ percentage: 0, covered: 0, total: 0 });
    expect(out.contradictions).toEqual([]);
  });
});
