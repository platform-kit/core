/* The blasts: markdown under content/blasts (build/funnel-io.mjs); a sent blast is the record and is never edited; the
   identity is the file's, whatever the form sent. `sent` is the send's record written back; every write compiles. */
import { Refusal } from '../util.mjs'
import { parseBlast, serialiseBlast, BLASTS_DIR, slugOk, goalOk, readBlast, blastNames, writeBlast } from '../../funnel-io.mjs'
import { normalizeRules, describeRules } from '../../../supabase/functions/_shared/emails/rules.js'

export default {
  key: 'blasts', name: 'Blasts', dir: BLASTS_DIR, title: 'title', module: 'funnels', editor: 'BlastsAdmin', creates: true,
  grammar: {
    parse: (text) => { const b = parseBlast(text); return { data: b.data, content: b.body } },
    serialise: (rec) => serialiseBlast(rec.data, String(rec.content || '')),
  },
  prepare: async (rec, ctx) => {
    if (!slugOk(ctx.name)) throw new Refusal(400, 'the name is lower-case words joined by hyphens')
    const cur = (await blastNames(ctx.store)).includes(ctx.name) ? (await readBlast(ctx.store, ctx.name)).data : {}
    if (cur.status === 'sent') throw new Refusal(409, 'a sent blast is not edited — make a new one')
    if (!goalOk(rec.data && rec.data.goal)) throw new Refusal(422, 'the goal is a path on the site, beginning with /')
    rec.data = { ...rec.data, id: cur.id || rec.data.id, status: 'draft' }
    return rec
  },
  summary: (rec) => { const rules = normalizeRules(rec.data.audience); return { body: rec.content, rules, goal: rec.data.goal || null, words: describeRules(rules) } },
  after: (rec, ctx) => ctx.script('funnels.mjs'),
  afterRemove: (name, ctx) => ctx.script('funnels.mjs'),
  actions: {
    /* the send's record: status sent, when, how many */
    sent: async ({ name, n }, ctx) => {
      name = String(name || '')
      if (!(await blastNames(ctx.store)).includes(name)) throw new Refusal(404, 'no such blast')
      const b = await readBlast(ctx.store, name)
      await writeBlast(ctx.store, name, { ...b.data, status: 'sent', sent_at: new Date().toISOString(), sent: Number(n) || 0 }, b.body)
      await ctx.script('funnels.mjs')
      return { ok: true }
    },
  },
}
