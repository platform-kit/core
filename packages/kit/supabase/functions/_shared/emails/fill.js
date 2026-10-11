/*
 * The handful of Handlebars an email design may use, filled with an order: `{{name}}` (HTML-
 * escaped), `{{{raw}}}`, `{{this}}`, dotted paths, `{{#each list}}…{{/each}}`, `{{#if x}}…
 * {{else}}…{{/if}}`, `{{#unless x}}…{{/unless}}`, nested freely. A Go template's token
 * (`{{ .ConfirmationURL }}`, what Supabase Auth fills in the emails it sends) is left exactly as
 * written unless the data carries `$go` — a preview or a test send does, the real path never.
 * Plain JavaScript, no imports — the function fills a compiled design at send time, the admin
 * fills one for a preview, the build checks a design fills at all. Not a template language: no
 * helpers, no partials.
 */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const get = (scope, path) => {
  if (path === 'this' || path === '.') return scope[scope.length - 1]
  for (let i = scope.length - 1; i >= 0; i--) {
    let v = scope[i]
    if (v == null || typeof v !== 'object') continue
    let ok = true
    for (const k of path.split('.')) { if (v != null && typeof v === 'object' && k in v) v = v[k]; else { ok = false; break } }
    if (ok) return v
  }
  return undefined
}
const truthy = (v) => !(v == null || v === false || v === '' || v === 0 || (Array.isArray(v) && !v.length))

/* the template as a tree: text, a value, or a block with its body; an else is a marker inside the
   block's body, so nesting stays simple */
const TOKEN = /\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([#/])?\s*(each|if|unless|else)?\s*([\w.]*)\s*\}\}/g
function run(nodes, scope, out) {
  for (const n of nodes) {
    if (typeof n === 'string') { out.push(n); continue }
    if ('v' in n) {
      if (n.v.startsWith('.')) { const go = get(scope, '$go'); const v = go && typeof go === 'object' ? go[n.v.slice(1)] : undefined; out.push(v == null ? n.src : esc(v)); continue }
      const v = get(scope, n.v); if (v == null) continue; out.push(n.raw ? String(v) : esc(v)); continue
    }
    const v = get(scope, n.path)
    const [then, other] = split(n)
    if (n.kind === 'each') { if (Array.isArray(v) && v.length) for (const item of v) run(then, scope.concat([item]), out); else run(other, scope, out); continue }
    const on = n.kind === 'unless' ? !truthy(v) : truthy(v)
    run(on ? then : other, scope, out)
  }
}
/* the body up to the else, and after it */
function split(b) {
  const i = b.body.findIndex((x) => x && x.elseMark)
  return i < 0 ? [b.body, []] : [b.body.slice(0, i), b.body.slice(i + 1)]
}
export function fill(tpl, data) {
  const tree = parse(tpl)
  const out = []
  run(tree.body, [data || {}], out)
  return out.join('')
}
export function parse(tpl) {
  const root = { body: [] }, stack = [root]
  let at = 0, m
  const top = () => stack[stack.length - 1]
  const text = (s) => { if (s) top().body.push(s) }
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(tpl))) {
    text(tpl.slice(at, m.index)); at = m.index + m[0].length
    const [, raw, mark, word, path] = m
    if (raw) { top().body.push({ v: raw, raw: true }); continue }
    if (word === 'else' && !mark) { top().body.push({ elseMark: true }); continue }
    if (mark === '#') { const b = { kind: word || 'if', path, body: [] }; top().body.push(b); stack.push(b); continue }
    if (mark === '/') { if (stack.length > 1) stack.pop(); continue }
    if (path) top().body.push({ v: path, src: m[0] })
  }
  text(tpl.slice(at))
  return root
}
/* a plain-text twin of an html email, for clients that show none of the markup */
/* a filled line of plain text — a subject — with the escaping a tag was given for html taken back off */
export const unescapeText = (t) => String(t).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
export function plain(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
    /* the preheader and its padding are for the inbox's preview line, not the letter */
    .replace(/<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => `${t.replace(/<[^>]+>/g, '').trim()} (${h})`)
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => (n < 32 || (n >= 8192 && n <= 8207) ? '' : String.fromCharCode(+n))).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l, i, a) => l || (a[i - 1] && a[i - 1] !== '')).join('\n').trim()
}
