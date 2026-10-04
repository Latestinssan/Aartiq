# Agent page tools, claim-level research verification, local listener auth, shell approval defaults

**Status:** Unreleased. The version number is the maintainer's to choose; nothing
here has been tagged and no version has been bumped.

Three independent bodies of work are unreleased. They are unrelated and neither
depends on the other:

1. **Agent page tools and claim-level research verification** — what an external
   agent can read and do on a page, and how the research job checks whether
   sources actually agree.
2. **Local listener authentication and shell approval defaults** — two
   defaults that were unconditional before.
3. **Unified Desktop Control, Master PIN, and Mobile Dual-Gate Permissions** —
   Native OS Keychain Master PIN, permanent sync authentication, Android Screen Lock verification,
   unified session tracking, and real hardware detection.

---

# Agent page tools and claim-level research verification

## What was added

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

## Search prefers APIs, and says when it can't

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

## Form filling and form submission are different decisions

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

## Refs fail loudly instead of addressing the wrong element

Refs bind by a `data-aartiq-ax` stamp the collector writes onto actionable
nodes, with `backendNodeId` as first-priority identity. A stale ref now errors
rather than scripting whatever element happens to sit where the target used to
be after the page shifted.

The collector stamps only actionable elements. An earlier version stamped
blanket, which perturbed page code that queries the DOM. `SnapshotManager` also
pruned `depth` after recursing into it, flattening the tree it returned.

## Claim-level cross-verification

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

### Known limit

Claim extraction surfaces numeric claims with a named subject. Disputed
*qualitative* findings never reach the contradictions panel. That is a false
negative rather than a false positive, and the coverage percentage therefore
reflects numeric agreement specifically, not overall source agreement. It is
stated rather than hidden, because a coverage figure that means something
narrower than its label is how a research tool starts lying.

### Bugs the new tests found

- `clampBudget` read `Number(null)` as 0, so an absent field clamped to the
  minimum instead of the default.
- `verifyClaims` trusted the caller's domain strings (above).
- The number regex required whitespace after a magnitude, so "raised 100
  million." was read as `100` and turned agreement into a false contradiction.
- Subject extraction keyed on articles and pronouns merged every claim into
  `the|company`.
- Terminal status was keyed on pages attempted rather than pages read.

### Tests

- `tests/agent-api-bridge-tools.test.js` — 35 cases
- `tests/page-scripts-forms.test.js` — 48 cases
- `tests/snapshot-ref-binding.test.js` — 23 cases
- `tests/web-search-service.test.js` — 27 cases
- `tests/research-pipeline.test.js` — 60 cases
- `tests/research-progress-plumbing.test.js` — 24 cases

---

# Local listener authentication and shell approval defaults

Two defaults changed. Both were unconditional before.

---

## Local listeners now require a credential

The MCP browser bridge listened on every network interface, answered every route
without a credential, and sent `Access-Control-Allow-Origin: '*'`. Pairing was
confirmed the moment any client opened the SSE stream, so the pairing token was
recorded state rather than a boundary, and a client that could reach the port
could also choose the token it would later be compared against.

Every listener now runs the same gate on every request, including SSE and every
POST route:

- **Bind.** The MCP browser bridge binds `127.0.0.1`. Exposing it on a LAN or
  Tailscale is a setting, off by default, and requires the token like every other
  mode. The setting must be a real boolean — a hand-edited config containing
  `"remote": "false"` does not open the listener.
- **Token.** A per-process token is required. It is generated by the server rather
  than supplied by a caller, and the route that previously accepted a
  caller-chosen token is gone.
- **Host.** The `Host` header must be the loopback host and that listener's own
  port. A request that names a hostname which resolves to loopback is refused.
- **Origin.** A request carrying a browser `Origin` must be on an allow-list of
  the app's own origins. Requests with no `Origin` are not browser requests and
  are authenticated by the token instead.
- **Logging.** Rejections record the reason, method and path. No token value is
  written to a log.

Also applied to the Agent API HTTP server, which had the same absence of checks
and auto-registers any unknown agent id, and to the native macOS bridge, whose
CLI token already existed and was written to `~/.aartiq-token` with mode `0600`
but which no route read.

`x-agent-id` remains an identifier. Authentication is the token.

### What users will notice

The Claude Desktop config Aartiq writes now carries the session token in the
`mcp-remote` URL, because `mcp-remote` accepts a bare URL and nothing else. The
token is regenerated on every Aartiq start, so **a config written before an
upgrade, or before the last restart, will be answered with 401** until
Auto-Configure is run again. The setup screens say so and show the current URL.

---

## Shell commands no longer auto-run

On every start, Aartiq created session grants for low and medium shell commands
with an eight-hour lifetime. No setting controlled it. The classifier treated
every non-destructive command as medium, so the grant covered `cp`, `mv`,
`mkdir`, `npm`, `git`, `curl` and `osascript`: those ran with no prompt for eight
hours after each launch.

- Those grants are no longer created.
- Auto-approval is now the `autoApproveLowRiskShell` setting, **default off**. It
  covers read-only commands only.
- Medium-risk commands prompt every time.
- The `autoApproveMidRisk` setting no longer applies to shell commands. It still
  applies to MCP tool actions, which is a separate question.

### The classifier now has a `low` tier

It previously returned `high` for a destructive pattern and `medium` for
everything else, so `low` was never produced for a shell command. The per-command
table now lives in one file that both the classifier and the documentation
generator read, so the two cannot describe different systems.

`curl`, `wget`, `npm`, `npx`, `git`, `node`, `python`, `osascript` and the other
network- or script-capable commands are not `low`. An unrecognised command is
`medium`, never `low`. A command line containing a URL is never `low`.
`chmod` stays `high`.

### "Allow Always" now applies to one command

Grants were keyed on the first word, so answering "Always" to one `curl`
authorised every later `curl` regardless of its arguments. Grants are now keyed
on the whole command line.

Permanent grants are no longer offered for network-capable, script-capable and
destructive commands, or for anything with a URL in its arguments. **Allow Once**
is always available. `cp`, `mv` and `mkdir` can still take a grant, and that
grant now matches that exact command line only.

Grants you made before are migrated on first load:

- a grant for a command that can still take one is kept, and now covers only the
  exact command line rather than every invocation of the binary;
- a grant for a network-capable, script-capable or destructive command is
  **dropped**, and each drop is written to the audit log. These were the entries
  carrying the most authority for the least visibility. Re-approve them
  individually if you want them back.

Grants you made deliberately in **Settings → Permissions** are untouched.

---

## Tests

- `tests/local-server-auth.test.js` — 41 cases over real sockets: all-interfaces
  bind refused by default, 401 without a token, 403 on a foreign `Host`, 403 on a
  foreign `Origin`, 200 for valid loopback plus token, and the pairing flow end
  to end.
- `tests/shell-command-tiers.test.js` — 189 cases asserting the classifier's four
  invariants directly against the table.
- `tests/shell-approval-defaults.test.js` — 55 cases covering no startup grants,
  medium prompting, the opt-in setting, grant scoping and the migration.

---

# Unified Desktop Control, Master PIN, and Mobile Dual-Gate Permissions

## What was added

A complete unification of the Aartiq Flutter companion app with Aartiq Desktop:

1. **Master PIN (Stored in Native OS Keychain):**
   - 6-digit Master PIN hashed using PBKDF2-SHA256 (100,000 iterations).
   - Saved and encrypted directly in the Native OS Keychain (Apple Keychain on macOS, DPAPI on Windows, Secret Service on Linux) via Electron's `safeStorage` and `native-keychain.js`.
   - Stored in Android Keystore / iOS Keychain on mobile via `flutter_secure_storage`.
   - Raw PIN never leaves device; only salt and hash travel during pairing.
   - Enforces a 10-minute lockout after 5 consecutive failed attempts.

2. **Dual-Gate Verification on Mobile:**
   - Automation plans with risk categorization (`CRITICAL` 🔴, `HIGH` 🟠, `MEDIUM` 🟡, `LOW` 🟢), step-by-step shell command code blocks, risk factors, and security mitigations mirror Aartiq Desktop's execution plan.
   - Authorizing execution requires both:
     1. Master PIN verification.
     2. Android Native Device Screen Lock verification (`local_auth` prompt for fingerprint/face or system PIN/pattern).

3. **Permanent Local & Remote Sync Authentication:**
   - Cryptographic permanent token exchanged upon pairing.
   - Reconnecting mobile devices automatically authenticate without repeated pairing codes.
   - Seamless dual connectivity: Local LAN WebSocket (`:3004`) and Remote Cloud via Firebase Realtime Database.

4. **Unified Session Manager:**
   - Live session streaming: open tabs, automation tasks, browsing history, and permission decision audits.
   - Past session archives browsable on mobile with tab counts and task execution details.

5. **Real Hardware Detection & Device Image UI:**
   - Native OS friendly computer name detection (e.g. *"Sandip’s MacBook Pro"*).
   - Mobile hardware model detection (e.g. *"Google Pixel 8 Pro"*).
   - Visual device illustrations (MacBook, iMac, Android Phone, iPhone) with live status and permanent sync badges in both desktop and mobile UIs.

---

## Not fixed here

Written up as issue drafts in `aartiq-browser/docs-audit/issues/`:

- `allow-always-granularity.md` — argument-aware policy for permanent grants
- `remote-mode-auth-design.md` — how LAN/Tailscale mode should authenticate
- `wifi-sync-bind-address.md` — WiFi sync binds all interfaces by omission
- `pdf-sync-bind-address.md` — background service serves on `0.0.0.0`
- `pairing-token-in-url.md` — the token has to travel in the `mcp-remote` URL