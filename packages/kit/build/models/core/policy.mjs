/* The sending policy, one file: content/emails/policy.md (build/funnel-io.mjs); a save merges what the form sent over
   what the file holds — the desk's clocks stay as they are in the file — and compiles the funnels. */
import matter from 'gray-matter'
import { writeKeeping } from '../yaml-keep.mjs'
import { readPolicy, POLICY } from '../../funnel-io.mjs'
import { DUMP } from '../util.mjs'

export default {
  key: 'policy', name: 'Sending policy', dir: 'content/emails', single: 'policy', title: 'daily', module: 'funnels', editor: 'FunnelsAdmin', creates: true,
  grammar: {
    parse: (text) => ({ data: matter(text).data, content: '' }),
    /* as the comment policy: the sending rules are worth a line of explanation in the file */
    serialise: (rec, ctx) => writeKeeping(ctx && ctx.current, rec.data, '\n', () => matter.stringify('\n', rec.data, DUMP)),
  },
  prepare: async (rec, ctx) => { rec.data = { ...(await readPolicy(ctx.store)), ...(rec.data || {}) }; return rec },
  after: (rec, ctx) => ctx.script('funnels.mjs'),
}
