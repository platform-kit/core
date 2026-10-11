/* The UI strings: one file per scope under content/app/ui, `## group / ### key / field: value` — the shape velite reads
   (build/strings-admin.mjs is the grammar the admin used); the strings editor is the editor. The record: data
   { scope, title }, parsed { fmRaw, spaced, groups } — the frontmatter text goes back verbatim, comments and all.
   A save of the two scopes the functions carry copies them beside the functions. */
import { parseStrings, serialiseStrings } from '../../strings-admin.mjs'

export default {
  key: 'strings', name: 'UI strings', dir: 'content/app/ui', title: 'scope', editor: 'StringsEditor', creates: true,
  grammar: {
    parse: (text) => { const p = parseStrings(text); return { data: { scope: p.scope, title: p.title }, content: '', parsed: { fmRaw: p.fmRaw, spaced: p.spaced, groups: p.groups } } },
    serialise: (rec) => { const p = rec.parsed || {}; return serialiseStrings(p.fmRaw || `scope: ${(rec.data && rec.data.scope) || ''}`, p.groups || {}, !!p.spaced) },
  },
  summary: (rec) => ({ file: rec.name + '.md', scope: rec.data.scope, title: rec.data.title, fmRaw: rec.parsed.fmRaw, spaced: rec.parsed.spaced, groups: rec.parsed.groups }),
  after: (rec, ctx) => (/^(emails|chat)$/.test(ctx.name) ? ctx.script('chat-email-strings.mjs') : undefined),
}
