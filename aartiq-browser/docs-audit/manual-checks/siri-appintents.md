# Manual check — Siri / Shortcuts App Intents reach real routes

**Feature id:** `siri.appintents`
**Published on:** `Aartiq-Landing-Page/src/app/docs/apple-integration/page.tsx` (the Siri & Shortcuts section)
**Automatable part:** none, and that is the point — see below.

- status: unverified

`unverified` until this file carries a dated maintainer sign-off. `check-docs.ts`
reads this line, so do not reword the key.

## What CI cannot check

The intents are Swift, compiled into the shipped app, and invoked by Siri or the
Shortcuts app on a user's Mac. `AppIntents.swift` declares twenty
`AppIntent` structs and `AartiqShortcutsProvider.appShortcuts` declares the
phrase list. Neither is reachable from a Linux or Windows runner, and mocking
the thing under test would only prove the mock works.

So the page's central claim is checked against the Swift source by reading, and
by hand on a Mac:

> Twenty App Intents registered from the native panel. Fifteen reach a route the
> macOS bridge actually serves. Five do not.

"Fifteen reach a real route" is the claim most worth confirming, because it is
the one a reader acts on. "Five do not" is the safer direction to be wrong in.

## The fifteen phrases published as working

Each row below is a phrase the page renders as working. Confirm it resolves to
its intent and that the intent reaches a handler.

| # | Phrase | Reaches a route? |
| --- | --- | --- |
| 1 | Ask Aartiq [prompt] | _yes / no_ |
| 2 | Refine Aartiq's response to be [instruction] | _yes / no_ |
| 3 | Regenerate Aartiq's response | _yes / no_ |
| 4 | What did Aartiq say? | _yes / no_ |
| 5 | List my conversations in Aartiq | _yes / no_ |
| 6 | Open my [conversation] in Aartiq | _yes / no_ |
| 7 | New chat in Aartiq | _yes / no_ |
| 8 | Reset Aartiq chat | _yes / no_ |
| 9 | Search [query] with Aartiq | _yes / no_ |
| 10 | Switch Aartiq model to [model] | _yes / no_ |
| 11 | What can you do with Aartiq | _yes / no_ |
| 12 | Run [command] in Aartiq — queues only | _yes / no_ |
| 13 | Create a [format] about [topic] — queues only | _yes / no_ |
| 14 | Schedule [task] [time] — queues only | _yes / no_ |
| 15 | _(the page renders 15 phrases; if the list above has fewer, the page and this document have drifted — fix whichever is wrong)_ | |

## The three that queue instead of acting

Phrases 12–15 are published as working *with a stated limit*: they type a request
into the chat and return. Confirm the limit is the real behaviour — that they do
not execute the command, produce a file, or register a schedule.

| Phrase | Queues only, as documented? |
| --- | --- |
| Run [command] in Aartiq | _yes / no — and if it executed, say what it executed_ |
| Create a [format] about [topic] | _yes / no_ |
| Schedule [task] [time] | _yes / no_ |

`Run [command]` is the one that matters for safety. It is the only intent that
carries a shell command, and the page says it "is not executed by the intent, and
it does not bypass approval". If it turns out to execute without approval, that
is a security finding, not a docs fix — stop and report it rather than editing
this table.

## The five published as unreachable

The page lists these as not reaching a route. Confirm they fail as described,
rather than being absent from the app entirely.

| Intent | Fails as described? |
| --- | --- |
| Capture Screenshot | _yes / no_ |
| Switch AI Model | _yes / no_ |
| Create Document | _yes / no_ |
| _(two more, per the page's table)_ | _yes / no_ |

## Procedure

On a Mac with Aartiq installed and the bridge running:

1. Open the Shortcuts app and confirm the Aartiq phrase group appears.
2. Invoke each of the fifteen phrases in turn. Record the outcome above.
3. Invoke each of the three queuing phrases and confirm nothing is executed,
   created, or scheduled.
4. Invoke each of the five unreachable intents and record the failure.
5. Restart Aartiq and repeat one phrase, to confirm the bridge is reachable from
   a cold start and not only from a session already open.

## Sign-off

| Field | Value |
| --- | --- |
| macOS version | _e.g. 15.4_ |
| Hardware | _Apple silicon model_ |
| Build | _version and commit_ |
| Fifteen phrases reaching routes | _N of 15_ |
| Queuing phrases confirmed queue-only | _yes / no_ |
| Unreachable intents confirmed unreachable | _yes / no_ |
| Checked by | _maintainer handle_ |
| Date | _YYYY-MM-DD_ |

## If the check fails

Do not edit this table to make it pass. A phrase that does not reach a route is
a documentation bug: fix the page's table and `feature-triage.md`, and record the
outcome in `docs-audit/consistency-report.md`. A phrase that executes when the
page says it queues is a security finding — report it first.

Until this document is signed, the page must keep its present wording, which
already states the limits it can prove from source, and no page may claim the
App Intents are verified end to end.
