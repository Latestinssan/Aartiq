/**
 * Page scripts — the bodies injected into a tab to act on a stamped element.
 *
 * Every builder returns a self-contained IIFE string that resolves to plain
 * JSON-serialisable data. They share one contract:
 *
 *   - Resolve by AX_MARKER_ATTR stamp. Never by index, never by "first match".
 *   - Report per-target success instead of throwing, so one bad field in a form
 *     does not lose the results of the fields that worked.
 *   - Set values through the native prototype setter and dispatch both `input`
 *     and `change`, because a plain `el.value = x` is silently discarded by
 *     every framework-controlled input.
 *   - Treat checkbox/radio/select/contenteditable as the distinct controls they
 *     are rather than treating all of them as text inputs.
 *
 * Kept out of bridge.ts so the behaviour can be exercised against a real DOM in
 * tests instead of only being asserted through string matching.
 */

import { AX_MARKER_ATTR } from './manager';

/** Shape every action script resolves to. */
export interface FieldOutcome {
  axId: string;
  ok: boolean;
  /** Present when ok is false. */
  reason?: string;
  /** What the control actually ended up holding, when readable. */
  value?: string;
  checked?: boolean;
}

/** Escapes a value for safe embedding as a JS literal inside a script string. */
function lit(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * Shared prelude. Defines the helpers every builder uses so the individual
 * builders stay short enough to read.
 */
const PRELUDE = `
  var ATTR = ${JSON.stringify(AX_MARKER_ATTR)};
  function resolveEl(axId){
    if(!axId) return { el: null, reason: 'missing axId' };
    var el = document.querySelector('[' + ATTR + '="' + axId + '"]');
    if(!el) return { el: null, reason: 'element "' + axId + '" is no longer in the DOM (stale ref)' };
    return { el: el, reason: null };
  }
  function protoFor(el){
    var tag = (el.tagName || '').toLowerCase();
    if(tag === 'textarea') return window.HTMLTextAreaElement && HTMLTextAreaElement.prototype;
    if(tag === 'select') return window.HTMLSelectElement && HTMLSelectElement.prototype;
    if(tag === 'input') return window.HTMLInputElement && HTMLInputElement.prototype;
    return null;
  }
  // Native setter: frameworks patch the instance property, not the prototype,
  // so \`el.value = x\` writes into a shadow and never reaches their state.
  function setNativeValue(el, value){
    var proto = protoFor(el);
    if(proto){
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if(desc && desc.set){ desc.set.call(el, value); return; }
    }
    el.value = value;
  }
  function fire(el, type){
    try { el.dispatchEvent(new Event(type, { bubbles: true, cancelable: false })); } catch(_) {}
  }
  function isCheckable(el){
    var type = (el.getAttribute('type') || '').toLowerCase();
    return type === 'checkbox' || type === 'radio';
  }
  // \`isContentEditable\` is absent in some hosts and false on a container whose
  // child carries the attribute, so the attribute is the reliable signal.
  function isContentEditable(el){
    if(el.isContentEditable) return true;
    try { return (el.getAttribute && el.getAttribute('contenteditable') === 'true'); } catch(_) { return false; }
  }
  function scrollTo(el){
    try { if(el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch(_) {}
  }
  function truthy(v){
    if(v === true) return true;
    if(v === false || v == null) return false;
    var s = String(v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'checked';
  }
  function readBack(el){
    try {
      if(isCheckable(el)) return { value: undefined, checked: !!el.checked };
      if(isContentEditable(el)) return { value: (el.textContent || '').slice(0, 200) };
      var v = el.value;
      return { value: v == null ? undefined : String(v).slice(0, 200) };
    } catch(_) { return {}; }
  }
  function setChecked(el, want){
    if(!!el.checked === !!want) return;
    // Click rather than assign: the click is what fires the change event the
    // page's own listeners are listening for.
    el.click();
  }
  function fillOne(el, rawValue){
    if(isCheckable(el)){
      var want = truthy(rawValue);
      setChecked(el, want);
      if(el.checked !== want){ el.checked = want; fire(el, 'input'); fire(el, 'change'); }
      return { ok: !!el.checked === want, reason: 'could not set checked state' };
    }
    var tag = (el.tagName || '').toLowerCase();
    if(tag === 'select'){
      var target = String(rawValue == null ? '' : rawValue);
      var matched = false;
      for(var i=0;i<el.options.length;i++){
        var o = el.options[i];
        if(o.value === target || (o.textContent||'').trim() === target.trim()){
          el.selectedIndex = i; matched = true; break;
        }
      }
      if(!matched && el.options.length){
        el.selectedIndex = 0;
        fire(el, 'input'); fire(el, 'change');
        return { ok: false, reason: 'no option matched "' + target + '"; selected first option instead' };
      }
      if(!matched) return { ok: false, reason: 'select has no options' };
      fire(el, 'input'); fire(el, 'change');
      return { ok: true, reason: null };
    }
    if(isContentEditable(el)){
      el.textContent = String(rawValue == null ? '' : rawValue);
      fire(el, 'input'); fire(el, 'change');
      var got = el.textContent || '';
      if(got !== (rawValue == null ? '' : String(rawValue))){
        return { ok: false, reason: 'contenteditable region rejected the value' };
      }
      return { ok: true, reason: null };
    }
    if(el.readOnly){
      el.focus();
      return { ok: false, reason: 'field is readOnly' };
    }
    if(el.disabled){
      el.focus();
      return { ok: false, reason: 'field is disabled' };
    }
    var text = rawValue == null ? '' : String(rawValue);
    el.focus();
    setNativeValue(el, text);
    fire(el, 'input');
    fire(el, 'change');
    var got = el.value;
    if(got !== text){
      // Some controls normalise (trim, mask, strip). Report what landed rather
      // than claiming the exact value was applied.
      return { ok: false, reason: 'control rejected the value (normalised to ' + JSON.stringify(String(got).slice(0,60)) + ')' };
    }
    return { ok: true, reason: null };
  }
`;

function wrap(body: string): string {
  return `(function(){${PRELUDE}\n${body}})();`;
}

/** Click the stamped element. */
export function clickScript(axId: string): string {
  return wrap(`
  var r = resolveEl(${lit(axId)});
  if(!r.el) return { ok: false, reason: r.reason };
  scrollTo(r.el);
  try { r.el.focus && r.el.focus(); } catch(_) {}
  r.el.click();
  return { ok: true, reason: null, tag: (r.el.tagName||'').toLowerCase() };
`);
}

/** Replace the element's value. */
export function fillScript(axId: string, value: unknown): string {
  return wrap(`
  var r = resolveEl(${lit(axId)});
  if(!r.el) return { ok: false, reason: r.reason, fields: [{ axId: ${lit(axId)}, ok: false, reason: r.reason }] };
  var out = fillOne(r.el, ${lit(value)});
  var back = readBack(r.el);
  var field = { axId: ${lit(axId)}, ok: out.ok, reason: out.reason };
  if(back.value !== undefined) field.value = back.value;
  if(back.checked !== undefined) field.checked = back.checked;
  return { ok: out.ok, reason: out.reason, fields: [field], focusLost: document.activeElement !== r.el };
`);
}

/** Focus the element and append text to its current value. */
export function typeScript(axId: string, text: unknown, clearFirst = false): string {
  return wrap(`
  var r = resolveEl(${lit(axId)});
  if(!r.el) return { ok: false, reason: r.reason, fields: [{ axId: ${lit(axId)}, ok: false, reason: r.reason }] };
  var incoming = ${lit(text)} == null ? '' : String(${lit(text)});
  var prior = (isContentEditable(r.el) ? (r.el.textContent||'') : (r.el.value == null ? '' : String(r.el.value)));
  var next = ${lit(!!clearFirst)} ? incoming : (prior + incoming);
  var out = fillOne(r.el, next);
  var back = readBack(r.el);
  var field = { axId: ${lit(axId)}, ok: out.ok, reason: out.reason };
  if(back.value !== undefined) field.value = back.value;
  if(back.checked !== undefined) field.checked = back.checked;
  return { ok: out.ok, reason: out.reason, fields: [field] };
`);
}

/**
 * Fill several fields in one round trip. Every field is attempted even when an
 * earlier one fails; submission only happens when the caller asks for it *and*
 * every field landed. This is the difference between a partial fill the user
 * can see and a silent half-submitted form.
 */
export function fillFormScript(fields: Array<{ axId: string; value: unknown }>, submit: boolean): string {
  const payload = lit(fields);
  return wrap(`
  var spec = ${payload};
  var wantSubmit = ${lit(!!submit)};
  var results = [];
  var failed = 0;
  for(var i=0;i<spec.length;i++){
    var r = resolveEl(spec[i].axId);
    if(!r.el){ failed++; results.push({ axId: spec[i].axId, ok: false, reason: r.reason }); continue; }
    var out = fillOne(r.el, spec[i].value);
    var back = readBack(r.el);
    var field = { axId: spec[i].axId, ok: out.ok, reason: out.reason };
    if(back.value !== undefined) field.value = back.value;
    if(back.checked !== undefined) field.checked = back.checked;
    if(!field.ok) failed++;
    results.push(field);
  }
  var submitted = false;
  var submitReason = null;
  if(wantSubmit){
    if(!spec.length){
      submitReason = 'refused to submit: no fields were filled, so the target form is unknown';
    } else if(failed > 0){
      submitReason = 'skipped submit: ' + failed + ' of ' + spec.length + ' fields failed';
    } else {
      // Resolve the owning form from the fields that were actually filled.
      // Guessing (first stamped element, first form on the page) is how a submit
      // ends up on the wrong form entirely.
      var owner = null;
      for(var j=0;j<spec.length && !owner;j++){
        var cand = document.querySelector('[' + ATTR + '="' + spec[j].axId + '"]');
        if(!cand) continue;
        if(cand.form) owner = cand.form;
        else if(cand.closest && cand.closest('form')) owner = cand.closest('form');
      }
      if(owner){
        var ok = true;
        if(typeof owner.requestSubmit === 'function') owner.requestSubmit();
        else if(typeof owner.submit === 'function') owner.submit();
        else ok = false;
        submitted = ok;
        if(!ok) submitReason = 'form exposes no submit() method';
      } else {
        submitReason = 'no <form> element found for the filled fields';
      }
    }
  }
  return {
    ok: failed === 0 && (submitted || !wantSubmit),
    fields: results,
    failed: failed,
    requested: spec.length,
    submitted: submitted,
    submitReason: submitReason
  };
`);
}

/** Submit the form that owns the stamped element. Never implicit. */
export function formSubmitScript(axId: string, confirmText?: string): string {
  return wrap(`
  var r = resolveEl(${lit(axId)});
  if(!r.el) return { ok: false, reason: r.reason };
  var el = r.el;
  var form = el.form || (el.closest && el.closest('form'));
  if(!form){
    return { ok: false, reason: 'no <form> ancestor for this element — it is not part of a submittable form' };
  }
  var expected = ${lit(confirmText ?? null)};
  if(expected){
    var label = (form.getAttribute('data-aartiq-confirm') || form.getAttribute('aria-label') || '').trim();
    if(label && label !== expected){
      return { ok: false, reason: 'form confirmation label mismatch: expected "' + expected + '", page declares "' + label + '"' };
    }
  }
  var submitted = false;
  if(typeof form.requestSubmit === 'function'){ form.requestSubmit(); submitted = true; }
  else if(typeof form.submit === 'function'){ form.submit(); submitted = true; }
  if(!submitted) return { ok: false, reason: 'form exposes no submit() or requestSubmit()' };
  return { ok: true, reason: null, action: form.getAttribute('action') || null, method: (form.getAttribute('method') || 'get').toLowerCase() };
`);
}

/** Non-text interactions that do not change a value. */
export function elementActionScript(action: string, axId: string): string {
  const verb = String(action);
  return wrap(`
  var r = resolveEl(${lit(axId)});
  if(!r.el) return { ok: false, reason: r.reason };
  var el = r.el;
  var action = ${lit(verb)};
  if(action === 'click'){
    scrollTo(el);
    try { el.focus && el.focus(); } catch(_) {}
    el.click();
  } else if(action === 'hover'){
    try {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
    } catch(_){ return { ok: false, reason: 'hover unsupported here' }; }
  } else if(action === 'scroll'){
    el.scrollIntoView({ block: ${lit('center')}, inline: 'nearest', behavior: 'smooth' });
  } else if(action === 'focus'){
    if(!el.focus) return { ok: false, reason: 'element is not focusable' };
    el.focus();
    if(document.activeElement !== el) return { ok: false, reason: 'element refused focus (hidden or disabled)' };
  } else if(action === 'blur'){
    el.blur && el.blur();
  } else if(action === 'check'){
    if(!isCheckable(el)) return { ok: false, reason: 'not a checkbox or radio' };
    if(!el.checked){ setChecked(el, true); fire(el, 'input'); fire(el, 'change'); }
  } else if(action === 'uncheck'){
    if(!isCheckable(el)) return { ok: false, reason: 'not a checkbox or radio' };
    if(el.checked){ setChecked(el, false); fire(el, 'input'); fire(el, 'change'); }
  } else {
    return { ok: false, reason: 'unknown action "' + action + '"' };
  }
  return { ok: true, reason: null, action: action, tag: (el.tagName||'').toLowerCase() };
`);
}

/**
 * CSS query over the live DOM — the escape hatch for when the accessibility
 * tree does not expose what you need (hidden inputs, data-* carriers, anchors
 * with no accessible name). Read-only by construction.
 */
export function domQueryScript(
  selector: string,
  opts: { limit?: number; includeText?: boolean; includeAttrs?: string[] } = {}
): string {
  return wrap(`
  var sel = ${lit(selector)};
  var limit = ${lit(Math.max(1, Math.min(opts.limit ?? 20, 200)))};
  var attrs = ${lit(opts.includeAttrs ?? [])};
  var includeText = ${lit(opts.includeText !== false)};
  var out = [];
  var nodes;
  try {
    nodes = document.querySelectorAll(sel);
  } catch(e) {
    return { ok: false, reason: 'invalid CSS selector: ' + (e && e.message), matches: [] };
  }
  for(var i=0;i<nodes.length && out.length<limit;i++){
    var el = nodes[i];
    var row = {
      index: i,
      tag: (el.tagName||'').toLowerCase(),
      id: el.id || undefined,
      classes: el.className && typeof el.className === 'string' ? el.className : undefined,
      visible: !!(el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)),
      disabled: !!el.disabled,
      href: (el.tagName||'').toLowerCase() === 'a' ? (el.getAttribute('href') || undefined) : undefined,
      value: (el.value != null && el.value !== '') ? String(el.value).slice(0,200) : undefined,
      checked: isCheckable(el) ? !!el.checked : undefined
    };
    for(var a=0;a<attrs.length;a++){
      var v = el.getAttribute(attrs[a]);
      if(v != null) row[attrs[a]] = v.length > 300 ? v.slice(0,300) : v;
    }
    if(includeText){
      var t = (el.textContent || '').trim().replace(/\\s+/g, ' ');
      row.text = t.length > 300 ? t.slice(0,300) + '…' : t;
    }
    out.push(row);
  }
  return { ok: true, matches: out, total: nodes.length, truncated: nodes.length > out.length };
`);
}

/**
 * Live-DOM text search scoped to a single element. Unlike the snapshot path
 * this reads rendered text, so it also finds matches inside nodes the tree
 * pruned. Still one page, still no network.
 */
export function pageTextSearchScript(
  query: string,
  opts: { limit?: number; scopeSelector?: string; caseSensitive?: boolean } = {}
): string {
  return `(function(){
  var q = ${lit(query)};
  var scope = ${lit(opts.scopeSelector || null)};
  var limit = ${lit(Math.max(1, Math.min(opts.limit ?? 20, 200)))};
  var cs = ${lit(!!opts.caseSensitive)};
  var root = document.body || document.documentElement;
  if(scope){
    var s = null;
    try { s = document.querySelector(scope); } catch(e){ return { ok:false, reason:'invalid scope selector', matches: [] }; }
    if(!s) return { ok:false, reason:'scope "' + scope + '" matched nothing', matches: [] };
    root = s;
  }
  if(!q) return { ok: true, matches: [], total: 0, truncated: false };
  var hay = (root.innerText || root.textContent || '');
  var needle = cs ? q : q.toLowerCase();
  var subject = cs ? hay : hay.toLowerCase();
  var matches = [];
  var from = 0;
  while(matches.length < limit){
    var at = subject.indexOf(needle, from);
    if(at < 0) break;
    var start = Math.max(0, at - 60);
    var end = Math.min(hay.length, at + needle.length + 80);
    matches.push({
      index: matches.length,
      offset: at,
      context: (start > 0 ? '…' : '') + hay.slice(start, end).replace(/\\s+/g, ' ') + (end < hay.length ? '…' : '')
    });
    from = at + needle.length;
  }
  return { ok: true, matches: matches, total: matches.length, truncated: from <= subject.length };
})();`;
}
