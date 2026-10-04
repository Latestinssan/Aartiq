# Feature reality report

**Scope.** The documentation-honesty pass over the eight docs pages that describe
features, and the closure of triage item 3 (Genmoji). Sixty-one features across
`Landing_Page/data/features.manifest.json`; the human-readable form is
`feature-triage.md`.

**Rule everything below follows.** Code wins over docs. No feature is presented
as available without a passing test that says so, and a page that cannot be
checked by a test is a page that will drift.

---

## 1. What the pass found

The docs were not wrong at random. Two things were wrong in a specific, fixable
way:

**The pages described larger surfaces than exist.** `windows-integration` and
`linux-integration` each documented an integration considerably more capable than
the module behind it. The Linux page claimed a system tray, KRunner support,
`scrot` capture and pocketsphinx dictation. None of the four exists. The Windows
page documented a `POST http://localhost:3000/api/commands` endpoint and a
Power Automate flow; there is no listener on port 3000 anywhere in the project,
and `port 3000` appears in the codebase only as timeouts and one UI placeholder.

**Nothing compared any claim to the source.** Four pages described an
integration surface larger than the code, and a green test run said nothing about
whether the pages were right. That is the deeper finding: the docs were not
wrong, they were *unfalsifiable*.

### Claims removed outright

No code existed for these at all, so they were removed rather than queued:

| Removed | Why |
| --- | --- |
| `POST localhost:3000/api/commands` | No listener on port 3000 in the project. |
| Power Automate flow, Windows | No HTTP surface to call. |
| Linux system tray, KRunner, `scrot`, pocketsphinx | Not implemented; `startVoiceRecognition` names whisper.cpp and returns `success: false`. |
| macOS Writing Tools, Priority Notifications | No API is called anywhere. |
| `keyboard.global-hotkeys` documentation | Real and working, but deliberately undocumented — `maintainer-decides`. |

### Claims corrected rather than removed

Real code, wrong description. Each is now a transcription with the limit stated:

- **Deep links.** 19 commands. 7 work, 3 *prepare* (type a sentence into the chat
  and return `success: true`), 9 are dead. Delivery is macOS-only: `app.on('open-url')`
  is the only path, and `handleWindowsShortcutAction` / `handleWindowsURLScheme` /
  `handleLinuxURLScheme` are imported and never called. `create-doc` does not
  appear in `SiriShortcutsIntegration.js` at all.
- **Keyboard shortcuts.** Rebuilt from the real 39-entry `shortcutDefinitions`
  table. The old page cited `src/lib/KeyboardShortcutService.ts`, which does not
  exist.
- **Apple integration.** 61 documented intents; 15 reachable, 46 unreachable.
  Per-command OS floors taken from the Swift, not from a single "macOS 15.0".

---

## 2. What was built

### Four gate suites, 94 tests, all green

Each reads the unit under test for real — no mocking of the thing being
documented — and re-derives its facts from source on every run. That is why they
did not go stale when the repository advanced underneath them (see §5).

| Suite | Tests | What it derives |
| --- | --- | --- |
| `tests/apple-intelligence-genmoji.test.js` | 24 | Genmoji export, payload, OS gate, IPC channel agreement |
| `tests/docs-shortcuts-match-source.test.js` | 7 | The 39-entry `shortcutDefinitions` table |
| `tests/docs-deep-links-match-source.test.js` | 19 | The `open-url` handler's command map and branches |
| `tests/docs-platform-integration-match-source.test.js` | 44 | 24 action handlers, their sends, and their listeners |

Full suite at the time of writing: **1158 passed, 26 skipped, 1 failed**. The
failure is not in this work — see §7.

### Mutation-checked, because a gate nobody has seen fail is decoration

A docs gate that cannot fail is worse than none, since it reads as evidence. Each
suite has a harness that breaks one thing at a time and requires the suite to
notice:

| Harness | Mutations | Killed |
| --- | --- | --- |
| `mutation-check-genmoji.sh` | 7 | 7 |
| `mutation-check-deeplinks.js` | 12 | 12 |
| `mutation-check-platform-docs.js` | 15 | 15 |
| `mutation-check-manifest.js` | 16 | 16 (2 by warning) |

Output recorded under `docs-audit/`. Ten mutations survived a first attempt and
each survivor was a real weakness in a test, not a bad mutation:

- The platform suite's `reachesApi` missed `executePowerShell`, so Windows volume
  derived as dead and the page's correct `works` failed. The derivation was wrong,
  not the page.
- An assertion scanned a 220-character window for a retraction, wide enough to
  pick up *"the previous version of this page listed twelve Hey Aartiq phrases"*
  and excuse the same sentence asserting the wake word. Retractions are now scoped
  to their own sentence.
- A `no \w+` negation marker matched *"no module is installed"* — a negation about
  a different subject. Removed.
- A mutation that added a bare `send` on an already-dead channel did not move the
  fact being measured. The suite measures whether anything is *listening*, so the
  mutation had to add a listener.

### A manifest gate

`npm run docs:check` now resolves every pointer in the manifest: test files must
exist **and contain that exact test name**; planned tests must *not* exist yet;
docs pages and hand-check sign-offs must exist. A test id that drifts from its
suite fails the build.

Two rules are deliberately warnings rather than failures, because failing would
block every unrelated docs edit:

- a `works` row with no test and no hand check (4 rows);
- a hand-check document still marked `unverified` (1 row).

### CODEOWNERS

`.github/CODEOWNERS` requires review on the manifest, the four gates, the checker,
the mutation harnesses and the hand-check records. The pages stay freely editable;
what is owned is the machinery that decides whether a page is telling the truth.

---

## 3. Severe finding: five Linux IPC channels are registered twice

Not part of the original scope. Found while writing the Linux page's bridge
table, when a claim I had written turned out to be wrong in the other direction.

I had documented that four of the eleven `linux:` bridge channels had no handler.
That was **my** error: the grep behind it read only `src/lib/linux-integration.js`
and missed eleven registrations in `main.js`. There is no gap. Both pages and the
gate were corrected, and the gate now asserts the opposite so the mistake cannot
return silently.

The real problem is worse than the one I had invented:

1. `setupLinuxIPCHandlers()` registers ten `linux:` channels, including
   `linux:notify`, `linux:create-shortcut`, `linux:install-gnome-shortcut`,
   `linux:create-launcher` and `linux:register-protocol`.
2. `main.js:752` calls it inside `if (process.platform === 'linux')`, then
   registers the same five names again at lines 781–805.
3. Electron's `ipcMain.handle` throws
   `Attempted to register a second handler for '<channel>'` on a duplicate
   (verified against `ipc-main-impl.ts` at v43.1.0, the version in `package.json`).
4. The call is not wrapped in a `try`, so **main.js stops executing at line 781**,
   and the four registrations after it never happen either.

**Not fixed here.** It is untriaged and outside this pass's mandate. It is
documented on the Linux page, and `docs-platform-integration-match-source.test.js`
pins the overlap, the ordering and the missing `try` so the claim cannot rot.

Why nobody noticed: the guard is Linux-only, and nothing in the repository
registers these channels on macOS or Windows, so both of those platforms are
unaffected. **This needs a maintainer decision.**

---

## 4. Still owed

### 18 rows blocked on a maintainer decision

Not implemented, not deleted, per instruction. The nine open questions are in the
manifest's `openQuestions`. The headline ones:

- **Voice / wake word.** Is the shipped trigger set or the documented one the
  product? A scope decision, not a bug fix.
- **Copilot surface.** Does Aartiq ship an embedded Copilot at all? `dual-chat` is
  also a data-egress decision.
- **Writing Tools / Priority Notifications.** The false claims are removed; the
  decision to build them is unanswered.
- **Raycast transport.** The HTTP API is retired; the handler layer is real but
  reachable only from inside the app.
- **Six macOS deep-link actions** that return `success` without doing the work.

### 4 unproven `works` rows

Real, and described in the docs, but no test proves them: `apple-intelligence.summary`,
`apple-intelligence.generate-image`, `http-api.native-bridge`, `keyboard.global-hotkeys`.
Listed as a standing warning so they stay visible.

### Two security items, deliberately not documented as features

- The `preApproved` bypass chain (renderer → `preload.js:541` →
  `system-handlers.js:30-45` → `utils.js:154`/`:222`) is still live. It is to be
  **removed**, not documented.
- `volume` and `open-app` deep links shell out via `execPromise`, bypassing the
  capability controller that gates `execute-shell-command`.

---

## 5. One caveat about this report

The repository advanced repeatedly while this pass was running (`63baa5ee` →
`865fce5e` → `8033d541` → `21892c65` → `cbb6e8e4`). None of it invalidated a
claim, because the four gates re-derive their facts from source on every run — but
it is the reason the manifest now records `baseline.commit` (where the triage was
taken) and `baseline.verifiedAgainst` (the commit the rows were last re-read
against) separately.

The check earned its keep twice.

**First**, it reported that files cited as evidence had changed, and the re-read
found that `http-api.native-bridge`'s evidence described an implementation that no
longer exists. The **claim** still holds — the token gate is still on every route —
but it moved from per-route calls to a single `bridgeApp.use` middleware at
`main.js:1297`. The row now says so.

**Second**, it reported `main.js` and `preload.js` moved again. The entire
committed diff is two additions: `ipcMain.handle('research-run')` and the
`runResearch` / `onResearchProgress` bridge pair. Neither is a `windows:` or
`linux:` channel, a deep-link command, nor bridge auth — so all 22 flagged rows
stand unchanged, now recorded against `cbb6e8e4`.

Across all five advances, not one `windows:` or `linux:` IPC channel was added or
removed. The duplicate-registration finding in §3 and both bridge tables are
therefore unaffected.

**One thing the advance did cost.** All four gate suites were untracked when the
work began. A concurrent commit swept them in under an unrelated message
(`test(snapshot): cover ref binding and single-page search`). They are intact and
byte-identical to HEAD, but their provenance in the history is now misleading. Worth
noting in the PR rather than papering over with a no-op commit.

---

## 6. How to keep this honest

```bash
npm run docs:check                      # manifest pointers, stale-code, unproven rows
npx jest                                # the four gates, plus the rest of the suite
node scripts/mutation-check-manifest.js # prove the manifest gate bites
```

A feature cannot be published as available without a row in the manifest whose
`tests` array names a real test id. If the code changes and the docs do not, a gate
fails. If the manifest claims coverage that does not exist, `docs:check` fails.

---

## 7. Found in passing, not fixed: a capability ticket can be redeemed twice

Also outside this pass's scope, and in code this work never touched. Reported
rather than fixed, because it belongs to concurrent work in
`src/lib/approval-gate.js` (committed at `21892c65`, unmodified here) and because
it is a security defect, not a docs defect.

`tests/approval-gate.test.js` — committed, and failing — is correct:

```js
const [result1, result2] = await Promise.all([
  gate.consumeTicket(ticketId, 'TEST_ACTION', { value: 123 }),
  gate.consumeTicket(ticketId, 'TEST_ACTION', { value: 123 }),
]);
// Exactly one should succeed — both do.
```

The cause is a time-of-check-to-time-of-use race in `consumeTicket`:

| Line | Operation |
| --- | --- |
| 117 | `if (consumedTickets.has(ticketId)) return invalid` — the check |
| 134 | `const inputHash = await sha256(inputHash)` — **the await** |
| 145 | `consumedTickets.add(ticketId)` — the mark |

`consumeTicket` is `async`, and the only `await` sits between the check and the
mark. Both concurrent calls read the ticket, both pass the check, both suspend at
line 134, and both resume to add and return `{ valid: true }`.

An approval ticket is the mechanism that makes a privileged action happen exactly
once per human approval. Redeeming one twice defeats that, which is the opposite
of the project's "human-in-the-loop, always" principle. The same interleaving
would also let a ticket be validated and then expire between check and use.

**Fix shape:** mark consumed synchronously, before the first `await` — or hold a
per-ticket lock, or delete-and-return the ticket atomically at the top and treat
absence as already consumed. The hash verification can still run afterwards,
because the ticket has already been claimed by then.

Not attempted here. This pass's mandate was to make the docs honest and close
triage item 3, and touching a security gate that someone else is actively working
on would be the wrong move even when the bug is that clear.
