# Allow Always: argument-aware grant policy

**Label:** security
**Status:** open — partially narrowed, not solved

## Summary

A permanent "Allow Always" grant is keyed on the normalised full command line, so
a grant matches one specific invocation. That is narrower than before, but it is
still text matching, and it does not model what a command will actually do.

Two gaps remain.

1. **Normalisation is textual, not semantic.** `normalizeCommandPattern` in
   `src/lib/shell-command-tiers.js` collapses whitespace and lower-cases. So
   `ls  -la` and `ls -la` share a key, while `ls "$HOME"` and `ls /home/me` do
   not — even though they do the same thing. The user is shown one of these and
   the other runs under the grant.

2. **A grant is permanent, and the world it applies to is not.** A grant recorded
   for `grep -r deploy .` keeps applying as the contents of that directory
   change. A grant for `npm test` keeps applying as the test suite it names is
   edited.

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