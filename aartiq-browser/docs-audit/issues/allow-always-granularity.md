# Allow Always: argument-aware grant policy

**Label:** security
**Status:** partially resolved — grant lifetime shipped; semantic normalisation still open

## Summary

A permanent "Allow Always" grant is keyed on the normalised full command line, so
a grant matches one specific invocation. That is narrower than before, but it is
still text matching, and it does not model what a command will actually do.

Two gaps remain.

1. **Normalisation is textual, not semantic.** `normalizeCommandPattern` in
   `src/lib/shell-command-tiers.js` collapses whitespace and lower-cases. So
   `ls  -la` and `ls -la` share a key, while `ls "$HOME"` and `ls /home/me` do
   not — even though they do the same thing. The user is shown one of these and
   the other runs under the grant. **Still open.**

2. **A grant is permanent, and the world it applies to is not.** A grant recorded
   for `grep -r deploy .` keeps applying as the contents of that directory
   change. A grant for `npm test` keeps applying as the test suite it names is
   edited. **Resolved: every grant now expires after 30 days — see Resolution
   below.**

The immediate granularity defect — first-word keying across two stores, one of
them persistent — is fixed. This issue is about the remaining design question.

## Affected functions

- `normalizeCommandPattern(command)` — `src/lib/shell-command-tiers.js`
- `alwaysApprovalEligibility(command)` — same file
- `buildShellCommandKey(command)` — `src/core/command-validator.js`
- `PermissionStore._normalizeCommand(command)` — `src/lib/permission-store.js`
- `PermissionStore.canAutoExecute(command, riskLevel)` — same file

## Why narrowing was not enough

Permanent grants are already withheld for network-capable, script-capable and
destructive binaries, and for any command containing a URL
(`NEVER_ALWAYS_ELIGIBLE` in `src/lib/shell-command-tiers.js`). That removes the
cases where a repeat has effects the user cannot see in the dialog text. What
remains is `cp`, `mv`, `mkdir`, `touch` and similar local writes, where the
residual risk is that the grant outlives the situation the user approved it in.

## Suggested fix

Replace text matching with a structured policy per command. Something like a
binary plus an argument shape:

```
{ binary: 'grep', allowArgs: ['-r', '-i'], requireNoUrl: true, ttlSeconds: 3600 }
```

then decide eligibility by parsing arguments against the shape rather than
comparing the whole line. Two properties matter more than the parser:

- **Scope the grant to a directory or a prefix where the binary supports it**, so
  a grant for `grep` under `~/notes` does not apply to `~/.ssh`.
- **Give every grant a lifetime**, or require periodic re-confirmation, so a
  grant cannot outlive the situation it was granted in. `PermissionStore.grant`
  already supports an `expires_at`; per-command grants currently never set one.

Whichever design is chosen, keep the eligibility rule in
`shell-command-tiers.js` so the dialog, the grant recorder and the gate continue
to read one file.

## Resolution (gap 2 — lifetime, shipped)

Every per-command "Allow Always" grant now carries a clock:

- `ALWAYS_GRANT_TTL_MS` (30 days) lives in `src/lib/shell-command-tiers.js`
  next to `alwaysApprovalEligibility`, so the dialog, the grant recorder and
  the gate read one policy file.
- `PermissionStore.setAutoCommand` writes `granted_at`/`expires_at` into a new
  `settings.autoApprovedCommandGrants` map, parallel to the existing
  `autoApprovedCommands` string array — the array keeps its shape, so every
  stored file, IPC payload and consumer is unchanged.
- On load, grants written before lifetimes existed are given a full first
  lifetime from the upgrade (audited as
  `settings.autoApprovedCommandGrantBackfilled`) rather than being revoked all
  at once for a policy the user never saw. Expired grants are swept from set,
  array and map together with an audit line
  (`settings.expireAutoApprovedCommand`); nothing is dropped silently.
- `canAutoExecute` checks the clock on every decision, which covers a grant
  that expires while the process is running. An expired grant falls back to
  the same opt-in low-tier rule (`autoApproveLowRiskShell`) as an absent one.
- `security-settings-get` exposes the map read-only — its update handler
  whitelists its fields, so a renderer round-tripping stale settings cannot
  rewrite or erase a grant's clock. The settings panel shows `· 12d left` on
  each grant chip, and the approval dialog's Always button explains the 30-day
  window in its tooltip.

Covered by `tests/allow-always-lifetime.test.js`.

Gap 1 (textual rather than semantic normalisation) remains open: a grant still
matches the normalised text of one invocation rather than what the command
will do, and scoping it to a binary plus argument shape plus directory is the
remaining design question.