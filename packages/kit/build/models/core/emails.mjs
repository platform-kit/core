/* The email designs: a Templatical template each (content/emails/<kind>.json) with its subject a line of
   content/app/ui/emails.md; the seven kinds are the functions' (tags.js KINDS). The record: data { subject },
   parsed the design; a save writes the design and the subject and compiles the designs beside the functions. */
import { Refusal } from '../util.mjs'
import { KINDS } from '../../../supabase/functions/_shared/emails/tags.js'
import { parseStrings, serialiseStrings } from '../../strings-admin.mjs'

const SUBJECTS = 'content/app/ui/emails.md'
const subjects = async (store) => { const raw = await store.read(SUBJECTS); return raw == null ? { scope: 'emails', fmRaw: 'scope: emails', spaced: true, groups: {} } : parseStrings(raw) }

export default {
  key: 'emails', name: 'Emails', dir: 'content/emails', ext: 'json', title: 'subject', module: 'emails', editor: 'EmailsAdmin', creates: true,
  names: () => KINDS,
  read: async (name, ctx) => {
    if (!KINDS.includes(name)) throw new Refusal(404, 'unknown email')
    let design = null
    try { const raw = await ctx.store.read('content/emails/' + name + '.json'); if (raw != null) design = JSON.parse(raw) } catch { /* not built yet */ }
    /* the subject as the site says it, else the theme's default (the same merge the functions' strings.json is built from) */
    let subject = (((await subjects(ctx.store)).groups[name] || {}).mail || {}).subject || ''
    if (!subject) { try { const { uiScope } = await import('../../strings-io.mjs'); subject = (((await uiScope('emails', ctx.store, ctx.theme ? { theme: ctx.theme } : {})) || {})[name] || {}).mail?.subject || '' } catch { /* no theme to read */ } }
    return { data: { subject }, content: '', parsed: design }
  },
  grammar: {
    parse: (text) => ({ data: {}, content: '', parsed: JSON.parse(text) }),
    serialise: (rec, ctx) => {
      if (!KINDS.includes(ctx.name)) throw new Refusal(400, 'unknown email')
      const d = rec.parsed
      if (!d || typeof d !== 'object' || !Array.isArray(d.blocks) || !d.settings) throw new Refusal(400, 'not a design')
      return JSON.stringify(d, null, 2) + '\n'
    },
  },
  after: async (rec, ctx) => {
    if (typeof rec.data.subject === 'string') {
      const sub = await subjects(ctx.store)
      sub.groups[ctx.name] = sub.groups[ctx.name] || {}; sub.groups[ctx.name].mail = { ...(sub.groups[ctx.name].mail || {}), subject: rec.data.subject.trim() }
      await ctx.store.write(SUBJECTS, serialiseStrings(sub.fmRaw || 'scope: emails', sub.groups, true), { collection: 'ui', slug: 'emails' })
    }
    await ctx.script('emails.mjs'); await ctx.script('chat-email-strings.mjs')
  },
}
