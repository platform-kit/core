/*
 * The UI strings' grammar, pure: `## group` / `### key [Name]` / `field: value` → { group: { key: { field } } },
 * and the merge of a site's groups over the theme's, field by field. The build reads it (build/strings-io.mjs,
 * velite's ui collection), the admin's strings editor writes against it, and in cloud mode the browser reads a
 * saved strings row through it (lib/entry.js), so the words are parsed one way everywhere.
 */
export function parseGroups(raw) {
  const groups = {}
  let group = null, key = null
  for (const line of String(raw || '').split(/\r?\n/)) {
    const h3 = /^###\s+(\S+)(?:\s+(.+?))?\s*$/.exec(line)
    if (h3) { key = h3[1].trim(); if (group) groups[group][key] = h3[2] ? { name: h3[2].trim() } : {}; continue }
    const h2 = /^##\s+(?!#)(.+?)\s*$/.exec(line)
    if (h2) { group = h2[1].trim(); groups[group] = groups[group] || {}; key = null; continue }
    /* a field name may carry a dot: the words for what a room hears are keyed on the event
       (hook-purchase.paid), and a name the grammar cannot read is a blank on screen rather than an error */
    const kv = /^([A-Za-z0-9._-]+):\s*(.*)$/.exec(line)
    if (kv && group && key) groups[group][key][kv[1]] = kv[2].trim()
  }
  return groups
}
/* the frontmatter's scope and title, without a YAML parser: two plain lines */
export function stringsHead(raw) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(raw || ''))
  const out = {}
  for (const l of (fm ? fm[1] : '').split(/\r?\n/)) { const m = /^(scope|title):\s*(.*)$/.exec(l); if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
  return out
}
/* the site's groups over the theme's: group → key → field, the site's field winning; nothing of the base lost */
export function mergeGroups(base, over) {
  const out = {}
  for (const g of new Set([...Object.keys(base || {}), ...Object.keys(over || {})])) {
    out[g] = {}
    const b = (base || {})[g] || {}, o = (over || {})[g] || {}
    for (const k of new Set([...Object.keys(b), ...Object.keys(o)])) out[g][k] = { ...(b[k] || {}), ...(o[k] || {}) }
  }
  return out
}
