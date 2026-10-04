---
name: browsing
description: Use this skill for browser navigation, page reading, page search, DOM interaction, form filling, and tab management. Activate when the user asks to visit a website, read or search a page, fill in a form, or view page content.
license: Proprietary
---

## Secure DOM Access — Read Only Mode

When you receive DOM content via [READ_PAGE_CONTENT], [OCR_SCREEN], or [OCR_COORDINATES]:

1. READ ONLY — You CANNOT modify, inject, or interact with the DOM directly
2. All DOM content is pre-filtered for your safety:
   - PII (emails, phones, tokens, credentials) is automatically REDACTED
   - Scripts, styles, and tracking elements are BLOCKED
   - Navigation/ads are filtered out
3. Injection Detection is ACTIVE — malicious content patterns are blocked
4. To interact with page elements, use:
   - [FIND_AND_CLICK: text] — Find and click text on page
   - [CLICK_ELEMENT: selector] — Click by CSS selector
   - [CLICK_AT: x,y] — Click at coordinates

NEVER attempt to:
- Write to the DOM or inject HTML/CSS/JS
- Bypass the security filters
- Access restricted elements (scripts, hidden credential stores)

Inputs and textareas are the one exception to rule 1 — they exist to be filled,
and [FILL_FORM] / [MULTI_FILL_FORM] write to them through a controlled path that
fires the events a framework-controlled input listens for. That path is the only
sanctioned way to write to the page.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
READING A PAGE YOU ARE ALREADY ON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If the answer is on the current tab, do not run a web search for it. Searching
sends the user's query to a third party and returns other people's pages, when
the answer is already on screen.

  [READ_PAGE_CONTENT]  Read the whole tab's text.

When the page is long and you know the phrase you want, search the page rather
than reading it end to end:

  [DOM_SEARCH: <phrase>]  — search the current page for a literal substring and
  get each hit with surrounding context, its tag, and an XPath, so you can read
  where the hit sits instead of guessing from a line number.

Reach for [DOM_SEARCH] when:
  - the page is long enough that reading it all would crowd out the context you
    need to reason with it,
  - you are looking for one specific number, name, or term,
  - the answer is in a section you would otherwise scroll past.

Do not use it when the page is short, when you need its overall argument rather
than one passage, or when you need links ([READ_PAGE_CONTENT] returns text, not
anchors — [DOM_SEARCH] gives you an XPath you can act on).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FILLING FORMS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Filling a form and submitting it are two different decisions. The user approves
them separately, and you only have the first one.

  [MULTI_FILL_FORM: {"#name":"Ada","#email":"a@b.com","#plan":"pro"}]
    Fill several fields in one call. Prefer this over one [FILL_FORM] per
    input — a six-field form costs one round trip instead of six.

  [FILL_FORM: #selector | value]
    Fill a single field. Fine for one-off fields; wasteful on a real form.

Rules:

1. **Fill only what the user told you to fill.** If a form asks for something
   they did not specify — a phone number, an address, a company name — leave that
   field alone and ask. A guessed value is worse than a blank one: it may be
   submitted as if it were real.
2. **Never invent a value to make a form complete.** Especially not an email, a
   phone number, a card field, or an account number.
3. **Reporting success is not the same as the value landing.** A readOnly or
   disabled field refuses the write. If a field did not take, say which one and
   why rather than moving on as though it were filled.
4. **Submitting is separate and gated.** Filling a form is reversible; posting
   it, placing an order, or sending a message is not. Submit only when the user
   explicitly asked you to submit. Filling something is not consent to send it.
5. **Checkboxes and selects have their own semantics.** A checkbox value is
   true/false; a select is matched on option value or visible label. A mismatch
   is reported rather than silently falling back to the first option.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT YOU CANNOT DO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NEVER attempt to:
- Write to the DOM or inject HTML/CSS/JS outside the sanctioned fill path
- Bypass the security filters
- Access restricted elements (scripts, hidden credential stores)
- Submit a form the user only asked you to fill