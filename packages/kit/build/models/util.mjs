/* The pipe's small parts, kept apart so a core record may import them without a cycle through the registry. */
import path from 'node:path'
import matter from 'gray-matter'
import { spawn } from 'node:child_process'
import { keepComments } from './yaml-keep.mjs'
const KIT = (f) => path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', f)

export const NAME_RE = /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/
export const DUMP = { lineWidth: -1 }

/* YAML auto-parses unquoted dates to Date objects; keep them as plain YYYY-MM-DD strings so a round-trip
   through the editor doesn't expand them to a timestamp */
export function normDates(o) {
  if (o && typeof o === 'object') for (const k of Object.keys(o)) if (o[k] instanceof Date) o[k] = o[k].toISOString().slice(0, 10)
  return o
}
/* the form sends every field, set or not; the file on disk only carries the set ones */
export const compact = (data) => Object.fromEntries(Object.entries(data || {}).filter(([, v]) => !(v == null || v === '' || (Array.isArray(v) && v.length === 0))))
/* what is written: no blank lines, `published: true` never (the default) */
export function cleanData(data) {
  const clean = {}
  for (const [k, val] of Object.entries(data || {})) {
    if (val === '' || val == null) continue
    if (k === 'published' && val === true) continue
    if (Array.isArray(val) && val.length === 0) continue
    clean[k] = val
  }
  return clean
}
/* the default grammar: frontmatter and a body, exactly as the admin has always read and written them */
export const frontmatter = {
  parse: (text) => { const fm = matter(text); return { data: normDates(fm.data), content: fm.content.replace(/^\n/, '') } },
  /*
   * A file that documents itself keeps its documentation: where the front matter carries comments,
   * the save edits that document rather than building a new one (models/yaml-keep.mjs), so only the
   * lines that changed change. Where it carries none there is nothing to preserve, and the write is
   * the one it has always been, byte for byte — a second serialiser would mean a second set of
   * formatting habits and a diff on every file the first time it is touched.
   *
   * `ctx.current` is the file as it stands. In a checkout that is the file; where the content lives
   * in rows it is the row's text. This does not know which, and must not: the store answers that.
   */
  serialise: (rec, ctx) => {
    const body = '\n' + String(rec.content || '').replace(/^\n+/, '')
    const kept = ctx && ctx.current ? keepComments(ctx.current, cleanData(rec.data)) : null
    return kept == null ? matter.stringify(body, cleanData(rec.data), DUMP) : '---\n' + kept + '\n---\n' + body
  },
}
/* a kit script spawned in the site's root — a hook's compile; rejects with its stderr */
export const script = (name, args = [], root = process.cwd(), env = process.env) => new Promise((resolve, reject) => {
  const c = spawn(process.execPath, [KIT(name), ...args], { cwd: root, stdio: ['ignore', 'inherit', 'pipe'], env: { ...process.env, ...env } })
  let err = ''; c.stderr.on('data', (d) => { err += d })
  c.on('exit', (code) => (code ? reject(new Error(err.trim().split('\n').filter((l) => !/Deprecation|trace-deprecation/.test(l)).join(' ') || name + ' failed')) : resolve()))
})
export const issue = (path, message) => ({ path, message })
export class Refusal extends Error { constructor(code, error, extra = {}) { super(error); this.code = code; this.extra = extra } }

