# Unreleased

## Security

### File-sync listeners bind loopback by default

The background task service (3999) and the PDF sync server listened on
`0.0.0.0` with `Access-Control-Allow-Origin: *` and no switch to stop them —
the README said so plainly. Both now listen on `127.0.0.1`. Setting
`AARTIQ_SERVICE_HOST` opts a routable host back in for phone/laptop file
access. Neither listener sends a CORS allow-origin header any more, so a page
open in any browser on the machine cannot read their responses; the mobile
clients are native HTTP clients and never needed it.

WiFi sync (3004) is untouched: it still binds every interface with only the
pairing handshake protecting it. That remains open.

### The agent API and the native bridge no longer share port 46203

Both defaulted to 46203, so whichever started second lost the bind and the
error was logged and swallowed — not visible from outside. The agent API now
defaults to 46204. The native bridge keeps 46203 because the Swift CLI, the
command-line tool and the compiled panel binaries hard-code it. `aartiq-mcp`
also keeps 46203: its BridgeClient calls only the native bridge's
`/native-mac-ui/*` routes.

Both changes are pinned by `tests/network-listener-hardening.test.js`, with
the mutation record in `aartiq-browser/docs-audit/mutation-check-network-hardening.txt`.

### System roots are refused by the directory allowlist

`addAllowedDirectory` accepted anything you typed — `/`, `/etc`, a Windows
drive root — and wrote it to settings as a read-write allowance. It now
refuses the filesystem root, the directories the operating system lives in
and Windows drive / system directories, and records the refusal in the audit
trail instead. The refusal is exact-match: a path *under* a root is a
different decision and stays allowed, pinned as the boundary case so
widening the ban is a deliberate choice rather than an accident. Flagged for
maintainer review (docs-audit M12); the AutomationSettings UI path and the
tests-only default in `directory-allowlist.js` are untouched. Gate:
`tests/permission-store-system-root.test.js` (10 failed before the fix, 12/12
after), mutation record
`aartiq-browser/docs-audit/mutation-check-system-roots.txt`.

## Licensing

### The browser ships Apache-2.0 everywhere

The repository root, the README badge and GitHub's API all reported
Apache-2.0 while `aartiq-browser/LICENSE.txt` was a restrictive EULA — the
file the Windows installer displayed. The EULA is replaced with the same
Apache-2.0 text the root carries, and `package.json` now declares
`"license": "Apache-2.0"`, so installer, manifest and repository agree. The
decision and the full EULA it replaced are recorded in
`aartiq-browser/docs-audit/licence-decision.md`; `docs:check` rule (j) fails
if the copies ever diverge again.

## Changed

### Comet → Aartiq file names

The permission audit trail is `aartiq-audit.jsonl` now; a legacy
`comet-audit.jsonl` is renamed on first load, and an existing
`aartiq-audit.jsonl` is never overwritten. Chat export dialogs default to
`aartiq-chat-<timestamp>.txt` / `.pdf` instead of `comet-chat-*`.

---

## Agent page tools and claim-level research verification

### What was added

The Agent API grew from 30 to 36 tools across 11 categories, and Deep Research
stopped being a label on a search call and became a real bounded job.

| Tool | Verb | What it does |
|------|------|--------------|
| `page_find` | — | Search one already-open page. No network request, no other tab touched. `mode="tree"` matches accessible name, value, href and role and returns refs you can act on; `mode="text"` scans rendered prose and returns context snippets. |
| `dom_query` | — | Run a DOM query with the same redaction and injection filtering as the rest of the read path. |
| `get_page_text` | — | The open tab's text. |
| `web_search` | — | Web search. Links and snippets, no dependable publication dates. |
| `news_search` | — | News search. Real publication dates. |
| `search_providers` | — | Which provider is configured, whether it scrapes, whether it has a news index. |
| `fill_form` | `input` | Fill fields. Never submits. |
| `form_submit` | `sideEffecting` | Submit. Goes through the approval gate. |

`page_find` matters more than it looks. A search is real egress: it sends the
user's query to a third party and returns somebody else's page. When the answer
is already on screen, that is the wrong trade. The tool makes the cheap option
available without asking the agent to be careful.

### Search prefers APIs, and says when it can't

`search_providers` reports the actual configuration rather than leaving the
agent to guess why results came back undated:

| Provider | Key | Scrapes | News index | Notes |
|----------|-----|---------|-----------|-------|
| Tavily | `TAVILY_API_KEY` | no | yes | Recommended. 1,000 free credits/month, no card. |
| Brave | `BRAVE_API_KEY` | no | yes | Free tier needs a card and requires attribution. |
| SerpAPI | `SERP_API_KEY` / `SERPAPI_API_KEY` | no | yes | 250 free searches/month. |
| Google CSE | `GOOGLE_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID` | no | no | **Deprecated** — closed to new customers; existing keys end 2027-01-01. Falls back automatically. |
| DuckDuckGo | none | **yes** | no | Parses HTML. Rate-limits, breaks when markup changes. |
| Google (scraped) | none | **yes** | no | Blocks automated traffic; expect 429s. |

Having no key is supported, not a failure state — but the results are scraped,
so they are slower, rate-limited, fragile, and carry no publication dates. That
is reported as such rather than presented as equivalent to an API result.

### Form filling and form submission are different decisions

Filling a form is reversible. Submitting it is not — it places an order, posts a
message, sends an application. So they are two tools rather than one tool with a
`submit` flag: `fill_form` carries the `input` verb and never submits,
`form_submit` is `sideEffecting` and goes through the approval gate. A caller
cannot reach the side effect by passing a parameter.

Three bugs here were found by tests written for the new tools:

- `typeScript` emitted a bare `clearFirst` identifier, throwing `ReferenceError`
  on every `type_ref`.
- Contenteditable detection relied only on `el.isContentEditable`, so a plain
  `div` was reported as successfully filled.
- `fillFormScript` fell back to `document.forms[0]` and could land a fill in an
  arbitrary form, or submit one.

### Refs fail loudly instead of addressing the wrong element

Refs bind by a `data-aartiq-ax` stamp the collector writes onto actionable
nodes, with `backendNodeId` as first-priority identity. A stale ref now errors
rather than scripting whatever element happens to sit where the target used to
be after the page shifted.

The collector stamps only actionable elements. An earlier version stamped
blanket, which perturbed page code that queries the DOM. `SnapshotManager` also
pruned `depth` after recursing into it, flattening the tree it returned.

### Claim-level cross-verification

`src/lib/research-pipeline.ts` runs:

```
plan → search → fetch pages → extract claims → cross-verify → rank → generate
```

with the search provider, page fetcher and progress emitter injected, so the
whole pipeline tests without network access.

**The claim is the unit of verification, not the article.** Claims are keyed on
`subject|verb`, so "450 million dollars" and "450 million euros" stay one claim
with two conflicting figures. Matching more loosely would have hidden the
disagreement the check exists to find.

**Independence is re-derived, not trusted.** Corroboration needs ≥2 distinct
domains, and the domains are computed from each claim's own URL rather than
taken from the caller — otherwise `news.reuters.com` and `uk.reuters.com` pass
as two sources, which is one source.

**A last source is named only when the dates are real.** If publication
timestamps are not reliable, the answer is "unknown" with the reason attached,
rather than the newest-looking result. Recency-of-fetch is not
recency-of-publication, and a ranking function is not a date. Returning the
reason matters: without it a caller retries and guesses anyway.

**Budget.** Search budget options are per-run with defaults. An absent option
takes the default, not the minimum.

Progress streams to the chat sidebar over `research-progress`
(`runResearch` in `preload.js` → `applyResearchProgress` in `researchState.ts`),
and a "Sources disagree" panel renders the unresolved contradictions inline.

#### Known limit

Claim extraction surfaces numeric claims with a named subject. Disputed
*qualitative* findings never reach the contradictions panel. That is a false
negative rather than a false positive, and the coverage percentage therefore
reflects numeric agreement specifically, not overall source agreement. It is
stated rather than hidden, because a coverage figure that means something
narrower than its label is how a research tool starts lying.

#### Bugs the new tests found

- `clampBudget` read `Number(null)` as 0, so an absent field clamped to the
  minimum instead of the default.
- `verifyClaims` trusted the caller's domain strings (above).
- The number regex required whitespace after a magnitude, so "raised 100
  million." was read as `100` and turned agreement into a false contradiction.
- Subject extraction keyed on articles and pronouns merged every claim into
  `the|company`.
- Terminal status was keyed on pages attempted rather than pages read.

#### Tests

- `tests/agent-api-bridge-tools.test.js` — 35 cases
- `tests/page-scripts-forms.test.js` — 48 cases
- `tests/snapshot-ref-binding.test.js` — 23 cases
- `tests/web-search-service.test.js` — 27 cases
- `tests/research-pipeline.test.js` — 60 cases
- `tests/research-progress-plumbing.test.js` — 24 cases
