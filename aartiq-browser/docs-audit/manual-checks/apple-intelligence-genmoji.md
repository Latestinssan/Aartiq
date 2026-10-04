# Manual check — Genmoji renders on macOS

**Feature id:** `apple-intelligence.genmoji`
**Automatable part:** `aartiq-browser/tests/apple-intelligence-genmoji.test.js`

- status: unverified

`unverified` until this file carries a dated maintainer sign-off. `check-docs.ts`
reads this line, so do not reword the key.

## What the test suite cannot check

The suite proves the command exists end to end as far as CI can see it: the
export, the request payload, the non-macOS refusal, the IPC channel agreement
between `main.js` and `preload.js`, the Swift availability gate, and the absence
of an Apple Intelligence entry point in `view_preload.js`.

It cannot prove that an emoji comes out. That needs all of:

- macOS 15.4 or newer (the Swift arm is behind `#available(macOS 15.4, *)`)
- Apple Intelligence enabled in System Settings
- an Apple-silicon machine, so the `ImagePlayground` framework is present
- a human looking at the result

None of that exists on `ubuntu-latest` or `windows-latest`, and none of it can be
faked without mocking the thing under test, which the ground rules forbid.

## Procedure

On a Mac that meets the requirements above, with Aartiq running from a build
that includes the compiled helper:

1. Open the Apple Intelligence panel.
2. Ask for an emoji, for example `a cat wearing a party hat`.
3. Confirm the result renders and that the reported OS floor in the reply
   matches the running macOS version.

Record what happened, including the failure case:

4. On a Mac below 15.4, repeat. Expect a refusal carrying
   `Genmoji requires macOS 15.4 or newer.` rather than a crash or a silent hang.

## Sign-off

| Field | Value |
| --- | --- |
| Checked on | _macOS version, model_ |
| Helper binary present | _yes / no_ |
| Emoji rendered | _yes / no_ |
| Pre-15.4 refusal correct | _yes / no / not tested_ |
| Checked by | _maintainer handle_ |
| Date | _YYYY-MM-DD_ |

Until every row above is filled in, the docs generator must render Genmoji as
`Not implemented` rather than `Verified`, and no page may list it under available
features.
