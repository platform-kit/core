/*
 * THE FACES A SITE NAMED, read from content/site.md before velite has compiled anything.
 *
 * The plugin needs them at buildStart, which is earlier than the `site` collection exists, so this
 * reads the frontmatter directly. It is deliberately the smallest possible reader — the schema is
 * velite's and the validation is typefaces.mjs's; this only has to find three strings.
 *
 * It reads through `fs` rather than the content store on purpose: the typefaces are needed to write
 * the HTML head, which only ever happens where there IS a checkout. In cloud mode nothing rebuilds,
 * so the head was written by the last build that ran.
 */
import fs from 'node:fs'
import path from 'node:path'

const SLOTS = ['heading', 'body', 'mono']

export function readSiteFonts(root = process.cwd()) {
  const file = path.join(root, 'content/site.md')
  if (!fs.existsSync(file)) return {}
  const text = fs.readFileSync(file, 'utf8')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}

  /* the `fonts:` block and its indented keys — a block mapping, which is how the writer writes it */
  const lines = m[1].split(/\r?\n/)
  const at = lines.findIndex((l) => /^fonts:\s*$/.test(l))
  if (at < 0) {
    /* a one-line flow mapping, which a person may well have typed */
    const flow = m[1].match(/^fonts:\s*\{(.*)\}\s*$/m)
    if (!flow) return {}
    const out = {}
    for (const pair of flow[1].split(',')) {
      const kv = pair.split(':')
      if (kv.length < 2) continue
      const k = kv[0].trim(), val = kv.slice(1).join(':').trim().replace(/^['"]|['"]$/g, '')
      if (SLOTS.includes(k) && val) out[k] = val
    }
    return out
  }

  const out = {}
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i]
    if (!/^\s+\S/.test(l)) break           /* the block ended */
    const kv = l.match(/^\s+([a-z]+):\s*(.*)$/)
    if (!kv) continue
    const val = kv[2].trim().replace(/^['"]|['"]$/g, '')
    if (SLOTS.includes(kv[1]) && val) out[kv[1]] = val
  }
  return out
}
