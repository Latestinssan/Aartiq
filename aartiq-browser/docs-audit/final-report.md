# Docs/code consistency audit — final report

Scope: the M1–M21 + X1–X5 inventory in `docs-audit/mismatch-inventory.md`, executed as five
PRs across `Latestinssan/Aartiq` and `Latestinssan2/Aartiq-Landing-Page`. Source code was the
only source of truth throughout: every fix cites `file:line`, every new gate was written to fail
before its fix, and every mutation check is recorded next to this file.

## Merged PRs and exact counts

| PR | Branch | Contents | Full-suite counts at that point |
|---|---|---|---|
| Aartiq **#14** / landing **#5** | `pr1/docs-mismatch-fixes` | Inventory + docs-only fixes for M1, M5, M7, M8, M9, M11, M12(docs), M15, M17, M19, M20, M21, X3; gate tests | **1019 total / 993 passed / 0 failed / 26 skipped**, 37 suites |
| Aartiq **#15** / landing **#6** | `pr2/network-listeners` | M3 loopback bind + no wildcard CORS, M4 port split, M6 port metric, X4; `tests/network-listener-hardening.test.js` (failing-first 5/9, then 10/10); `src/service/service-bind.js`; 11 mutations killed | **1029 / 1003 / 0 / 26**, 38 suites |
| Aartiq **#16** | `pr3/verify-b1-b2` | Mutation records for B1 approval gate (2 killed, 1 surviving mutation explained) and B2 Linux IPC (3/3 killed); test-only de-flake of `approval-gate-concurrency.test.js` | **1029 / 1003 / 0 / 26**, 38 suites (post-rebase) |
| Aartiq **#18** / landing **#8** | `pr4/licence-comet-rename` / `pr4/licence-audit-rename` | M14 licence unification (Apache-2.0 everywhere), M16 Comet→Aartiq file renames with migration; `check-docs` rule (j) + 4 negative cases; 8 mutations killed | **1035 / 1009 / 0 / 26**, 39 suites |
| Aartiq **#20** / landing **#10** | `pr5/m12-system-root-validation` | M12 code half: `addAllowedDirectory` refuses system roots; `tests/permission-store-system-root.test.js` (failing-first 10 failed / 2 passed → 12/12); 3 mutations killed | **1047 / 1021 / 0 / 26**, 40 suites |

**Final state of `main`:** `f4d3c5ae` — `npm run docs:check` ✓ (4 baseline warnings),
`npm run docs:test` **26/26**, full suite **1047 total / 1021 passed / 0 failed / 26 skipped,
40 suites** (macOS, `npx jest --ci --runInBand --forceExit --json` inside `aartiq-browser/`).
Test counts in the README and the landing `test-facts.generated.json` are regenerated from that
JSON (`npm run docs:test-facts -- --from`), never hand-edited.

Mutation records (each: baseline green → mutate → failing tests recorded → restore byte-identical
→ post-revert green): `mutation-check-docs-gates.txt`, `mutation-check-network-hardening.txt`
(11/11), `mutation-check-approval-gate.txt`, `mutation-check-linux-ipc.txt` (3/3),
`mutation-check-licence-rename.txt` (8/8), `mutation-check-system-roots.txt` (3/3).

## Security behavior changes — flagged, not silent

These three PRs changed runtime security behavior. Each got its own PR with a failing test first
and is listed here for maintainer review:

1. **M3 (PR #15):** background task service (3999) and PDF sync server default to `127.0.0.1`
   instead of `0.0.0.0`; `AARTIQ_SERVICE_HOST` opts back in; the `Access-Control-Allow-Origin: *`
   header is gone from both.
2. **M4 (PR #15):** agent API moves to **46204**, native bridge keeps **46203**.
   Deviation from the brief, decided by source: **`aartiq-mcp` also keeps 46203**, because
   `aartiq-mcp/server/bridge-client.js` only calls `/native-mac-ui/*`, which `bridgeApp` serves on
   46203 — pinned by test and mutation-checked in both directions.
3. **M12 (PR #20):** `addAllowedDirectory` refuses system roots (`/`, the POSIX OS directories,
   bare drive roots, `C:\Windows`, `C:\Program Files*`) with an audit-trail entry. The rule is
   **exact match, not a prefix ban** — `/etc/aartiq` stays allowed; the boundary is pinned as a
   test so widening it is a deliberate maintainer decision.

## Could not verify (no guessing)

- **M4 runtime consequence:** which service actually answered on 46203 when both started —
  requires running the app; not reproduced.
- **M18 benchmarks:** no re-run script exists in the tree, so the v0.3.4 figures were neither
  re-derived nor removed; provenance labelling is enforced, retention is a maintainer choice.
- **M17 tool counts:** `origin/main` has 28 tools / 9 categories in `tools.ts`; landing PR #4's
  skills page (branch `docs/agent-tools-and-research`) claims 36 / 11 citing `tools.ts:22-419`,
  which does not exist on `main` — an unpushed feature branch. The published counts follow
  `main`; **when that branch lands, regenerate the counts and the registry gate will tell you.**
  (Note: the concurrent session's uncommitted edits to `skills/page.tsx`, `search-index.ts` and
  `features/page.tsx` were temporarily backed up during PR4 to keep the tree verifiable, then
  restored byte-for-byte; they now live on their own branch.)

## Left for the maintainer (recorded, not decided)

- **WiFi sync (3004)** still binds every interface with no token (M2/X5-adjacent); hardening it
  is a security-behavior change beyond this brief (`docs-audit/issues/wifi-sync-bind-address.md`).
- **Approval id scheme (B1):** the `consumedTickets.add` mutation **survived** — the gate does not
  pin ticket consumption ordering; gap explained in `mutation-check-approval-gate.txt`.
- **M7 dead QR branch:** remote-origin shell escalates risk (`sync-handlers.js:232-236`) but its
  QR branch is unreachable; docs now state the truth, removing the dead code is the maintainer's call.
- **M16 leftovers:** `comet-permissions.json`, `comet-security-settings.json`, `comet-vault-key`
  are still persisted under Comet names — cited by no doc; renaming them is a separate migration.
- **X1:** `.github/workflows/sync-component-docs.yml` pushes to `Latestinssan/Aartiq-Landing-Page`,
  which does not exist (real remote: `Latestinssan2/...`); fixing the target is CI behavior.
- **M15:** the unified status paragraph wording awaits maintainer sign-off.
- **M12 boundary:** exact-match vs prefix-ban on system roots (see above).

## Process notes

- Both repositories live in the user's local clones; the landing branch work happened on branches
  in that clone, and commits from a concurrent session are interleaved in landing history
  (`fix/github-api-rate-limit` #7, `docs/agent-tools-and-research` #9). Landing PRs are stacked on
  `docs/honest-feature-docs`; Aartiq PRs base `main`.
- CI does not gate merges here (Aartiq `jest.yml` is `workflow_dispatch`-only; landing checks are
  CodeRabbit + Vercel) — the local gates (`docs:check`, `docs:test`, full jest, mutation records)
  are the gate, run before every PR.
- No marketing language was added anywhere; where the old text was flattering and the source was
  not, the source won and the sentence changed.
