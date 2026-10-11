/*
 * The UI strings as the admin reads and writes them: `## group / ### key / field: value`, the same shape velite reads
 * (strings-io.mjs parses it for the build); the frontmatter text goes back verbatim, comments and all, and a file that
 * spaced its lines stays spaced. The grammar of the strings and emails models (build/models/core).
 */
import matter from 'gray-matter'

/* ---- ui strings: `## group / ### key / field: value`, the same shape velite reads ---- */
export function parseStrings(raw) {
  const fm = matter(raw)
  const groups = {}
  let group = null, key = null
  for (const line of fm.content.split(/\r?\n/)) {
    const h3 = /^###\s+(\S+)(?:\s+(.+?))?\s*$/.exec(line)
    if (h3) { key = h3[1].trim(); if (group) groups[group][key] = h3[2] ? { name: h3[2].trim() } : {}; continue }
    const h2 = /^##\s+(?!#)(.+?)\s*$/.exec(line)
    if (h2) { group = h2[1].trim(); groups[group] = groups[group] || {}; key = null; continue }
    /* a field name may carry a dot: the words for what a room hears are keyed on the event
       (hook-purchase.paid), and a name the grammar cannot read is a blank on screen rather than an error */
    const kv = /^([A-Za-z0-9._-]+):\s*(.*)$/.exec(line)
    if (kv && group && key) groups[group][key][kv[1]] = kv[2].trim()
  }
  /* the frontmatter text as written (its comments included) goes back verbatim */
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  return { scope: fm.data.scope || '', title: fm.data.title || '', fmRaw: m ? m[1] : `scope: ${fm.data.scope || ''}`, spaced: /^###[^\n]*\n\n/m.test(fm.content), groups }
}
export function serialiseStrings(fmRaw, groups, spaced = false) {
  const lines = ['---', fmRaw.replace(/\n+$/, ''), '---', '']
  for (const [gname, keys] of Object.entries(groups)) {
    lines.push('## ' + gname, '')
    for (const [kname, fields] of Object.entries(keys)) {
      const { name, ...rest } = fields
      lines.push('### ' + kname + (name ? ' ' + name : ''))
      if (spaced) lines.push('')
      for (const [f, v] of Object.entries(rest)) lines.push(`${f}: ${v}`)
      lines.push('')
    }
  }
  return lines.join('\n').replace(/\n+$/, '') + '\n'
}

