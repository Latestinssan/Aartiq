"use strict";
/**
 * Research pipeline — runs a bounded research job and reports what it is doing.
 *
 * The UI already knows how to render research progress (`researchState.ts`,
 * `ResearchExecutionCard`, `ResearchReport`); nothing produced those events. This
 * is the producer.
 *
 * Three properties matter more than features here:
 *
 * 1. **Bounded.** Every job carries an explicit budget (maxQueries, pagesToFetch,
 *    follow-up rounds). Research that cannot be stopped is research that will
 *    quietly spend the user's API credits, and the budget is what the caller
 *    shows the user before consenting to it.
 *
 * 2. **Honest about dates.** "The most recent report" is only answerable when the
 *    provider gave real publication dates. When it did not, this says the recency
 *    is unknown rather than picking the most plausible-looking link.
 *
 * 3. **Diverse corroboration.** Two articles repeating the same wire story are one
 *    source wearing two hats. Verification counts *distinct registrable domains*,
 *    so a claim repeated across one publisher's syndication network does not
 *    verify itself.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BUDGET = void 0;
exports.clampBudget = clampBudget;
exports.domainOf = domainOf;
exports.parsePublished = parsePublished;
exports.extractClaims = extractClaims;
exports.verifyClaims = verifyClaims;
exports.pickLastSource = pickLastSource;
exports.runResearch = runResearch;
exports.DEFAULT_BUDGET = {
    maxQueries: 6,
    resultsPerQuery: 8,
    pagesToFetch: 12,
    maxFollowUpRounds: 2,
    days: 7,
};
const LIMITS = {
    maxQueries: [1, 20],
    resultsPerQuery: [1, 20],
    pagesToFetch: [1, 40],
    maxFollowUpRounds: [0, 6],
    days: [1, 365],
};
/**
 * Clamp a partial budget to something a caller can safely afford. Per-run options
 * with defaults: anything unset takes the default, anything out of range is
 * pulled into range rather than rejected, so a UI slider cannot produce a job
 * that cannot run.
 */
function clampBudget(partial) {
    const out = { ...exports.DEFAULT_BUDGET };
    if (!partial)
        return out;
    for (const key of Object.keys(LIMITS)) {
        const [lo, hi] = LIMITS[key];
        const raw = partial[key];
        // `Number(null)` and `Number('')` are 0, which would silently clamp a missing
        // value to the *minimum* budget instead of leaving the default in place.
        if (raw === null || raw === undefined || raw === '')
            continue;
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n))
            continue;
        out[key] = Math.max(lo, Math.min(hi, Math.round(n)));
    }
    return out;
}
/* -------------------------------------------------------------- utilities */
/**
 * Registrable-ish domain: last two labels, with the common two-part public
 * suffixes handled so `bbc.co.uk` and `guardian.co.uk` stay distinct hosts.
 * Good enough for "are these two citations independent?".
 */
function domainOf(url) {
    try {
        const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        const parts = host.split('.').filter(Boolean);
        if (parts.length <= 2)
            return parts.join('.');
        const secondLevel = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);
        const tail = parts.slice(-2).join('.');
        if (secondLevel.has(parts[parts.length - 2]) && parts.length >= 3) {
            return parts.slice(-3).join('.');
        }
        return tail;
    }
    catch {
        return '';
    }
}
/** Extract a comparable date from whatever shape a provider returned. */
function parsePublished(value) {
    if (!value)
        return null;
    const raw = String(value).trim();
    if (!raw)
        return null;
    // Relative ages: "2 hours ago", "3 days ago".
    const rel = raw.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/i);
    if (rel) {
        const n = Number(rel[1]);
        const unit = rel[2].toLowerCase();
        const ms = {
            minute: 60e3, hour: 3600e3, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6,
        }[unit] ?? 864e5;
        return new Date(Date.now() - n * ms);
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
const NUMBER_WORDS = {
    million: 'million', billion: 'billion', thousand: 'thousand', percent: '%', '%': '%',
    trillion: 'trillion', crore: 'crore', lakh: 'lakh',
};
/**
 * Digits with an optional currency and magnitude: `$450 million`, `12%`, `1,200`.
 *
 * The trailing boundary accepts sentence punctuation as well as whitespace.
 * Without that, a figure at the end of a sentence loses its magnitude — "raised
 * 100 million." would read as "100" — which silently turns agreement between two
 * sources into an apparent contradiction.
 */
const NUMBER_RE = /(\$|€|£|₹)?\s*(\d[\d,.]*)\s*(million|billion|trillion|thousand|crore|lakh|percent|%)?(?=\s|[.,;:!?)]|$)/i;
/**
 * Words that cannot identify a claim. A predicate is meant to answer "what
 * happened to the subject", so articles, prepositions and narration verbs are
 * useless as a key — "The company" and "It" are not entities.
 */
const PREDICATE_STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'but', 'or', 'nor', 'so', 'yet', 'if', 'as',
    'in', 'on', 'at', 'for', 'to', 'of', 'with', 'by', 'from', 'into', 'over',
    'under', 'about', 'after', 'before', 'during', 'while', 'when', 'where',
    'that', 'this', 'these', 'those', 'there', 'it', 'its', 'they', 'their',
    'we', 'our', 'you', 'your', 'he', 'she', 'his', 'her', 'i', 'is', 'was',
    'were', 'are', 'be', 'been', 'being', 'has', 'have', 'had', 'will', 'would',
    'can', 'could', 'may', 'might', 'must', 'also', 'however', 'still', 'then',
    'than', 'here', 'not', 'no', 'now', 'afterwards',
]);
/** Leading capitalised words that are pronouns or articles, not an entity. */
const SUBJECT_STOPWORDS = new Set([
    'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'There', 'It', 'Its',
    'They', 'Their', 'We', 'Our', 'You', 'Your', 'He', 'She', 'His', 'Her',
    'I', 'But', 'And', 'So', 'Yet', 'If', 'As', 'In', 'On', 'At', 'For',
    'However', 'After', 'Before', 'When', 'While', 'Meanwhile', 'Still',
]);
function normaliseValue(raw) {
    const n = raw.replace(/,/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const unitMatch = n.match(/(million|billion|trillion|thousand|crore|lakh|percent|%)/);
    const amount = n.replace(/(million|billion|trillion|thousand|crore|lakh|percent|%)/g, '').trim();
    const num = Number(amount);
    if (Number.isFinite(num) && amount !== '') {
        const unit = unitMatch ? (NUMBER_WORDS[unitMatch[1]] ?? unitMatch[1]) : '';
        return `${num}${unit ? ` ${unit}` : ''}`;
    }
    return n;
}
/**
 * Pull assertive numeric claims out of page text.
 *
 * Deliberately narrow: a sentence must name a subject and assert a number. Vague
 * sentences produce no claim rather than a bad one, because a fabricated claim
 * would show up in the contradictions panel as though it were real.
 *
 * The claim key is `subject|predicate` where the predicate is the verb — the
 * thing that happened. Keying on the noun after the number instead would make
 * "raised 100 million dollars" and "raised 100 million euros" look like
 * different claims about the same fact, and hide a real disagreement.
 */
function extractClaims(text, url) {
    if (!text)
        return [];
    const domain = domainOf(url);
    const sentences = text
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .filter((s) => s.length > 15 && s.length < 400);
    const claims = [];
    const seen = new Set();
    for (const sentence of sentences) {
        const subjectMatch = sentence.match(/^([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/);
        if (!subjectMatch)
            continue;
        // Strip articles and pronouns from both ends. "The Acme Corp" and "It" are not
        // entities: keying on them would merge unrelated stories into one claim.
        const subjectWords = subjectMatch[1].split(/\s+/).filter(Boolean);
        while (subjectWords.length && SUBJECT_STOPWORDS.has(subjectWords[0]))
            subjectWords.shift();
        while (subjectWords.length && SUBJECT_STOPWORDS.has(subjectWords[subjectWords.length - 1])) {
            subjectWords.pop();
        }
        const subject = subjectWords.join(' ').trim();
        if (subject.length < 2)
            continue;
        const rest = sentence.slice(subjectMatch[0].length);
        // Prefer a number that follows the subject: a leading capitalised token may
        // itself be part of a figure ("Rs 450 million", "Acme's 12% stake").
        const numberMatch = rest.match(NUMBER_RE) ?? sentence.match(NUMBER_RE);
        if (!numberMatch)
            continue;
        const verbMatch = rest.match(/^\W*([A-Za-z][A-Za-z'-]*)/);
        let predicate = verbMatch ? verbMatch[1].toLowerCase() : '';
        if (!predicate || predicate.length < 3 || PREDICATE_STOPWORDS.has(predicate)) {
            // Fall back to what the number measures: "Acme secured 450 million in
            // funding" describes a round even without a clean verb.
            const after = rest.slice((numberMatch.index ?? 0) + numberMatch[0].length);
            const nounMatch = after.match(/^\W*([A-Za-z][A-Za-z'-]*)/);
            predicate = nounMatch ? nounMatch[1].toLowerCase() : '';
        }
        if (!predicate || predicate.length < 3 || PREDICATE_STOPWORDS.has(predicate))
            continue;
        const currency = numberMatch[1] ?? '';
        const value = normaliseValue(`${currency}${numberMatch[2]} ${numberMatch[3] ?? ''}`);
        const key = `${subject.toLowerCase()}|${predicate}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        claims.push({ key, subject, predicate, value, text: sentence.trim(), domain, url });
    }
    return claims;
}
/**
 * Group claims by what they are about, then judge each group.
 *
 * The diversity rule is the whole point: a claim needs assertions from two
 * *different* domains before it counts as corroborated. Three links from one
 * publisher, or three that syndicate the same wire copy, are one source.
 *
 * Domains are re-derived from each claim's URL rather than trusted as passed in.
 * Otherwise a caller handing us `news.reuters.com` and `uk.reuters.com` would
 * satisfy the two-domain bar with one publisher — which is the exact illusion
 * this check exists to prevent.
 */
function verifyClaims(claims) {
    const groups = new Map();
    for (const raw of claims) {
        const claim = {
            ...raw,
            domain: domainOf(raw.url) || raw.domain || '',
        };
        const list = groups.get(claim.key) ?? [];
        list.push(claim);
        groups.set(claim.key, list);
    }
    const findings = [];
    const contradictions = [];
    const allDomains = new Set();
    for (const [key, group] of groups) {
        const domains = [...new Set(group.map((c) => c.domain).filter(Boolean))];
        for (const d of domains)
            allDomains.add(d);
        const byValue = new Map();
        for (const c of group) {
            const list = byValue.get(c.value) ?? [];
            list.push(c);
            byValue.set(c.value, list);
        }
        const values = [...byValue.entries()].map(([value, items]) => ({
            value,
            domains: [...new Set(items.map((i) => i.domain).filter(Boolean))],
            text: items[0].text,
            url: items[0].url,
        }));
        let verdict;
        if (values.length > 1 && domains.length > 1)
            verdict = 'disputed';
        else if (domains.length >= 2)
            verdict = 'corroborated';
        else
            verdict = 'single_source';
        findings.push({ key, subject: group[0].subject, predicate: group[0].predicate, verdict, domains, values });
        if (verdict === 'disputed') {
            const [a, b] = values;
            const ratio = numericRatio(a.value, b.value);
            contradictions.push({
                type: `${a.value} vs ${b.value} ${group[0].predicate}`,
                claim1: { source: a.domains[0] || 'unknown', text: a.text },
                claim2: { source: b.domains[0] || 'unknown', text: b.text },
                ...(ratio ? { ratio } : {}),
            });
        }
    }
    return { findings, contradictions, independentDomains: [...allDomains].sort() };
}
/** How far apart two values are, when both are numbers. */
function numericRatio(a, b) {
    const na = Number(a.replace(/[^\d.]/g, ''));
    const nb = Number(b.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(na) || !Number.isFinite(nb) || na === nb)
        return undefined;
    const [lo, hi] = na < nb ? [na, nb] : [nb, na];
    if (lo === 0)
        return undefined;
    return (hi / lo).toFixed(1);
}
/**
 * Identify the newest source in the set.
 *
 * Only claims a winner when the provider said its timestamps are trustworthy.
 * Otherwise it reports `reliable: false` with the reason, because "here is the
 * most recent report" is the one claim a user will act on.
 */
function pickLastSource(sources, timestampsReliable) {
    const empty = { url: null, title: '', domain: '', publishedAt: null, reliable: false };
    if (!sources.length)
        return { ...empty, reason: 'No sources were found.' };
    if (!timestampsReliable) {
        return {
            ...empty,
            reliable: false,
            reason: 'No news-capable search API key is configured, so these results came from a scraped web '
                + 'search. Publication dates are unknown, so the most recent source cannot be identified.',
        };
    }
    const dated = sources
        .map((s) => ({ s, at: parsePublished(s.publishedAt) }))
        .filter((x) => x.at !== null);
    if (!dated.length) {
        return {
            ...empty,
            reason: 'None of the sources returned a publication date, so recency cannot be determined.',
        };
    }
    const newest = dated.reduce((best, cur) => (cur.at > best.at ? cur : best));
    return {
        url: newest.s.url,
        title: newest.s.title || newest.s.url,
        domain: domainOf(newest.s.url),
        publishedAt: newest.at,
        reliable: true,
    };
}
/* --------------------------------------------------------------- pipeline */
async function runResearch(deps, options) {
    const budget = clampBudget(options.budget);
    const researchId = options.researchId || `research-${Math.random().toString(36).slice(2, 10)}`;
    const queries = (options.queries?.length ? options.queries : [options.query]).filter(Boolean);
    let timestampsReliable = false;
    let queriesUsed = 0;
    let pagesFetched = 0;
    /** Attempts are not reads; a page that failed is not a source. */
    let pagesRead = 0;
    const readUrls = new Set();
    const seenUrls = new Set();
    const candidates = [];
    const skippedQueries = [];
    const pageClaims = [];
    deps.emit({
        researchId, query: options.query, stage: 'planning', status: 'running',
        message: `Planned ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'} · budget: `
            + `${budget.maxQueries} searches, ${budget.pagesToFetch} pages`,
        progress: 5,
    });
    // ---- search ----
    for (const [i, query] of queries.entries()) {
        if (queriesUsed >= budget.maxQueries) {
            skippedQueries.push(query);
            continue;
        }
        queriesUsed++;
        deps.emit({
            researchId, query, stage: 'searching', status: 'running', index: i + 1,
            message: `Searching: "${query}"`, progress: 5 + Math.round((i / Math.max(1, queries.length)) * 30),
        });
        let response;
        try {
            response = await deps.searchNews(query, budget.resultsPerQuery, { days: budget.days });
        }
        catch (e) {
            // One bad query must not end the run; the caller still gets a report of
            // what was found, plus the reason this query is missing.
            deps.emit({
                researchId, query, stage: 'search_error', status: 'running',
                message: `Search failed: ${e.message}`,
            });
            continue;
        }
        if (typeof response.timestampsReliable === 'boolean')
            timestampsReliable = response.timestampsReliable;
        if (response.reason) {
            deps.emit({ researchId, query, stage: 'searching', status: 'running', message: response.reason });
        }
        for (const r of response.results ?? []) {
            if (r?.url && !seenUrls.has(r.url)) {
                seenUrls.add(r.url);
                candidates.push(r);
            }
        }
    }
    deps.emit({
        researchId, stage: 'search_complete', status: 'running',
        message: `${seenUrls.size} unique sources found`
            + (skippedQueries.length ? ` · ${skippedQueries.length} skipped by budget` : ''),
        progress: 38,
    });
    // ---- last source, decided before spending fetches on it ----
    const lastSource = pickLastSource(candidates.filter((c) => !!c.url), timestampsReliable);
    deps.emit({
        researchId, stage: 'ranking', status: 'running',
        message: lastSource.reliable
            ? `Newest source: ${lastSource.domain} (${lastSource.publishedAt?.toISOString().slice(0, 10)})`
            : `Most recent source unknown — ${lastSource.reason}`,
        progress: 44,
        url: lastSource.url ?? undefined,
        source: lastSource.domain || undefined,
    });
    // ---- fetch, newest-first when we know the order ----
    const ordered = lastSource.reliable
        ? [...candidates].sort((a, b) => (parsePublished(b.publishedAt)?.getTime() ?? 0) - (parsePublished(a.publishedAt)?.getTime() ?? 0))
        : candidates;
    const toFetch = ordered.slice(0, budget.pagesToFetch);
    for (const [i, candidate] of toFetch.entries()) {
        if (pagesFetched >= budget.pagesToFetch)
            break;
        pagesFetched++;
        const domain = domainOf(candidate.url);
        deps.emit({
            researchId, stage: 'fetching', status: 'running', url: candidate.url, source: domain,
            message: `Reading ${domain} (${i + 1}/${toFetch.length})`, index: i + 1,
            progress: 45 + Math.round((i / Math.max(1, toFetch.length)) * 30),
        });
        let text = '';
        try {
            text = await deps.fetchPage(candidate.url, 6000);
        }
        catch (e) {
            deps.emit({
                researchId, stage: 'fetch_error', status: 'running', url: candidate.url, source: domain,
                message: `Could not read ${domain}: ${e.message}`,
            });
            continue;
        }
        if (!text) {
            deps.emit({
                researchId, stage: 'fetch_error', status: 'running', url: candidate.url, source: domain,
                message: `${domain} returned no readable text`,
            });
            continue;
        }
        pagesRead++;
        readUrls.add(candidate.url);
        const claims = extractClaims(text, candidate.url);
        pageClaims.push(...claims);
        deps.emit({
            researchId, stage: 'extracted', status: 'running', url: candidate.url, source: domain,
            message: claims.length
                ? `Extracted ${claims.length} claim${claims.length === 1 ? '' : 's'} from ${domain}`
                : `No checkable claims in ${domain}`,
        });
    }
    // ---- verification ----
    deps.emit({
        researchId, stage: 'contradiction_check', status: 'running',
        message: `Cross-checking ${pageClaims.length} claims across ${new Set(pageClaims.map((c) => c.domain)).size} domains`,
        progress: 82,
    });
    const { findings, contradictions, independentDomains } = verifyClaims(pageClaims);
    // A claim repeated across one publisher's network is not corroborated, so the
    // coverage figure is computed over distinct domains rather than page count.
    const coverage = {
        percentage: findings.length
            ? Math.round((findings.filter((f) => f.verdict !== 'single_source').length / findings.length) * 100)
            : 0,
        covered: findings.filter((f) => f.verdict !== 'single_source').length,
        total: findings.length,
    };
    const sources = toFetch.map((s) => ({
        name: domainOf(s.url) || s.url,
        title: s.title,
        url: s.url,
        articleCount: pageClaims.filter((c) => c.url === s.url).length,
        avgScore: 0,
        // A page that yielded no claim was still read; a page that could not be read
        // was not. The report shows both, so conflating them would hide dead links.
        used: readUrls.has(s.url),
        publicationDate: parsePublished(s.publishedAt)?.toISOString(),
    }));
    deps.emit({
        researchId, stage: 'coverage_update', status: 'running',
        message: `Coverage ${coverage.percentage}% · ${independentDomains.length} independent domains`
            + (contradictions.length ? ` · ${contradictions.length} contradiction${contradictions.length === 1 ? '' : 's'}` : ''),
        progress: 90, coverage, contradictions,
    });
    // ---- outcome ----
    const stoppedReason = skippedQueries.length
        ? `Stopped at the query budget (${budget.maxQueries}); ${skippedQueries.length} planned quer${skippedQueries.length === 1 ? 'y' : 'ies'} went unsearched.`
        : null;
    const outcome = {
        researchId, query: options.query, budget,
        queriesUsed, pagesFetched, pagesRead, skippedQueries, stoppedReason,
        timestampsReliable, lastSource, findings, contradictions, coverage, sources,
    };
    deps.emit({
        researchId, stage: 'generating', status: 'running',
        message: `Assembling report from ${independentDomains.length} domains`,
        progress: 96,
        sourceSummary: sources, coverage, contradictions,
    });
    // Failure is "nothing readable was found", not "nothing was attempted" — a run
    // that fetched four pages and read none of them produced no report, and must not
    // render as a success.
    const finalStatus = pagesRead === 0 ? 'failed' : 'completed';
    deps.emit({
        researchId, stage: 'complete', status: finalStatus, progress: 100,
        message: pagesRead === 0
            ? (candidates.length
                ? `None of the ${candidates.length} sources could be read — nothing to report.`
                : 'No sources were found — nothing to report.')
            : stoppedReason
                ?? `Done: ${pagesRead} pages, ${coverage.total} claims, ${coverage.percentage}% corroborated`,
        coverage, contradictions, sourceSummary: sources,
    });
    return outcome;
}
