/* The funnels: markdown under content/funnels, a step per heading (build/funnel-io.mjs) — the grammar; the funnel editor
   is the editor; every write compiles them beside the functions (build/funnels.mjs). The record: data the frontmatter,
   parsed { steps }; the list carries each funnel's audience rules described. */
import { Refusal } from '../util.mjs'
import { parseFunnel, serialiseFunnel, FUNNELS_DIR, slugOk, goalOk } from '../../funnel-io.mjs'
import { normalizeRules, describeRules } from '../../../supabase/functions/_shared/emails/rules.js'

export default {
  key: 'funnels', name: 'Funnels', dir: FUNNELS_DIR, title: 'title', module: 'funnels', editor: 'FunnelsAdmin', creates: true,
  grammar: {
    parse: (text) => { const f = parseFunnel(text); return { data: f.data, content: '', parsed: { steps: f.steps } } },
    serialise: (rec) => {
      const steps = rec.parsed && Array.isArray(rec.parsed.steps) ? rec.parsed.steps : []
      if (!steps.length) throw new Refusal(422, 'a funnel has at least one step')
      return serialiseFunnel(rec.data, steps)
    },
  },
  prepare: (rec, ctx) => { if (!slugOk(ctx.name)) throw new Refusal(400, 'the name is lower-case words joined by hyphens'); if (!goalOk(rec.data && rec.data.goal)) throw new Refusal(422, 'the goal is a path on the site, beginning with /'); return rec },
  summary: (rec) => { const rules = normalizeRules(rec.data.audience); return { steps: rec.parsed.steps, rules, goal: rec.data.goal || null, words: describeRules(rules) } },
  after: (rec, ctx) => ctx.script('funnels.mjs'),
  afterRemove: (name, ctx) => ctx.script('funnels.mjs'),
  actions: {
    /* the markdown as the email carries it (html), for the editor's preview */
    preview: async ({ body }) => { const { mdToEmailHtml } = await import('../../../supabase/functions/_shared/emails/markdown.js'); return { html: mdToEmailHtml(String(body || '')) } },
  },
  options: {
    /* the compiled email designs a funnel or a blast may be piped through */
    /* the designs are the files under content/emails; compiled or not, a design is one the admin may name */
    designs: async (ctx) => (await ctx.store.list('content/emails', { ext: 'json' })).map((k) => ({ value: k, label: k })),
  },
}
