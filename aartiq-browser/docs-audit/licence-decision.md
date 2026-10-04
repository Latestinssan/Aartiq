# Licence decision — aartiq-browser becomes Apache-2.0

**Status:** decided (2026-10-04), implemented in the licence/unification change.
**Scope:** `aartiq-browser/` desktop code. `aartiq-mcp/` stays MIT. The landing
repository stays unlicensed (private).

## The conflict this resolves

The audit recorded the conflict as mismatch-inventory M14:

- The repository root `LICENSE` is Apache-2.0, the README badge links it, and
  `gh api` reports `license: Apache-2.0` because GitHub reads that file.
- `aartiq-browser/LICENSE.txt` was a 24-line End User Licence Agreement that
  forbade modification, derivative works and redistribution — while the file's
  own line 4 asserted "This Is Open Source Software".
- `aartiq-browser/package.json` set `build.nsis.license = LICENSE.txt`, so the
  **Windows installer displayed the EULA**, not Apache-2.0.
- The package manifest had no `license` field at all, so npm could not
  contradict either file.

The EULA and the root licence cannot both be correct. Publishing the conflict
without a verdict was the right state while the question was open; it is not
the right state once the question is answered.

## The decision

**The browser becomes Apache-2.0.** The Apache-2.0 side was already what the
root licence, the README badge, GitHub's API and this repository's own
trademark paragraph all said; the EULA was the single outlier. The decision is
the user's (recorded in the audit as "Decision (user)"), not inferred from
which text sounded better.

Implemented as:

1. `aartiq-browser/LICENSE.txt` now carries the Apache-2.0 text, byte-identical
   to the repository root `LICENSE`. The Windows NSIS installer keeps pointing
   at this file and therefore now displays Apache-2.0.
2. `aartiq-browser/package.json` declares `"license": "Apache-2.0"`.
3. The landing SSOT (`legal.licenseConflict`) is marked resolved with this file
   cited as its evidence, so the README licence block stops publishing an
   open conflict and the licence table row moves from `conflicted` to
   `verified`.
4. `scripts/check-docs.ts` gained a rule that fails if the three copies ever
   disagree again (installer file, package field, SSOT flag), with negative
   tests in `scripts/test-check-docs.ts`.
5. `tests/licence-audit-rename.test.js` pins the shipped files themselves.

## What the old EULA said (kept for the record)

Replaced in full; nothing of it survives as a licence term. Preserved verbatim
here because deleting a legal file without keeping a copy loses the only
record of what users were previously asked to agree to:

```text
END USER LICENSE AGREEMENT (EULA)

This End User License Agreement ("Agreement") is a legal agreement between you and Latestinssan for the Aartiq Browser software.
This Is Open Source Software.Made By Latestinssan
1. LICENSE GRANT
Latestinssan grants you a non-exclusive, non-transferable license to use the Aartiq Browser for personal or professional use.

2. RESTRICTIONS
You may not:
- Reverse engineer, decompile, or disassemble the software.
- Modify or create derivative works based on the software.
- Remove any proprietary notices or labels on the software.
- Do Not Resell or Distribute the Software.
3. TERMINATION
This license is effective until terminated. Your rights under this license will terminate automatically without notice if you fail to comply with any terms of this Agreement.

4. DISCLAIMER OF WARRANTY
THE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND. LATESTINSSAN DISCLAIMS ALL WARRANTIES, EITHER EXPRESS OR IMPLIED.

5. LIMITATION OF LIABILITY
IN NO EVENT SHALL LATESTINSSAN BE LIABLE FOR ANY SPECIAL, INCIDENTAL, INDIRECT, OR CONSEQUENTIAL DAMAGES WHATSOEVER.

6. COPYRIGHT
Copyright (c) 2026 Latestinssan. All rights reserved.
```

## Not changed

- `aartiq-mcp/` keeps its MIT licence and its own `LICENSE` file — different
  component, already consistent.
- The root `LICENSE` was already Apache-2.0 and is untouched.
- `nsis-installer.nsi` / `build.nsis.license` keep their pointer; only the
  pointed-at text changed.
