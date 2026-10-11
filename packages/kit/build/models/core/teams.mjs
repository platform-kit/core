/*
 * The teams: a team is a file (content/teams/<slug>.md; build/teams-io.mjs is the grammar) and who
 * is in it is rows. So this model edits the DECLARATION — the name, the line under it, the picture,
 * where it sits, and the ways somebody is swept in — and never a member: putting a person in a team
 * is an act, done from the team's own page, and a file that named one would be a file that owned
 * somebody's membership.
 *
 * The ways in are a list to tick, never the fill rule typed out (teams-io's fillWays / waysFill
 * carry a team's choice both ways, and a rule with no word keeps itself).
 */
import { z } from 'zod/v4'
import { Refusal } from '../util.mjs'
import { TEAMS_DIR, parseTeam, serialiseTeam, fillWays, waysFill, TEAM_WAYS, slugOk, readTeams, projectTeams } from '../../teams-io.mjs'

const WORD = {
  'role:provider': 'Everyone who gives appointments',
  'role:coach': 'Every coach',
  'role:support': 'Everyone on the support desk',
  'role:editor': 'Every editor',
  'role:analyst': 'Every analyst',
  'role:admin': 'Every administrator',
  'role:staff': 'Everyone on the staff',
  'entitlement:subscribed': 'Everyone with a live membership',
}

/* over a checkout a write IS the file, so the scripts run then: the compile refuses a malformed
   declaration and the push writes the rows. Over rows a write is a draft and nothing is projected
   until it is published — see `projected` below. */
async function onWrite(ctx) {
  if (ctx.store && ctx.store.kind === 'rows') return
  await ctx.script('teams.mjs')
  await ctx.script('teams-push.mjs').catch((e) => console.warn('teams: not projected — ' + e.message))
}

export default {
  key: 'teams', name: 'Teams', dir: TEAMS_DIR, title: 'name', module: 'sessions',
  creates: true, body: true, bodyLabel: 'What this team is',
  grammar: {
    parse: (text, ctx) => {
      const t = parseTeam(String(ctx.name || '').replace(/\.md$/, ''), text)
      return { data: { name: t.name, published: t.published, thumb: t.thumb, position: t.position, ways: fillWays(t.fill) }, content: t.about || '' }
    },
    serialise: (rec) => {
      const d = rec.data || {}
      return serialiseTeam({ name: d.name, published: d.published !== false, thumb: d.thumb || null, position: d.position, fill: waysFill(d.ways), about: rec.content || '' })
    },
  },
  prepare: (rec, ctx) => {
    if (!slugOk(String(ctx.name || '').replace(/\.md$/, ''))) throw new Refusal(400, 'the name is lower-case words joined by hyphens')
    return rec
  },
  fields: z.object({
    name: z.string().meta({ label: 'Name', grid: true, help: 'as people will read it' }),
    published: z.boolean().meta({ label: 'Published', grid: true }).optional(),
    /* A DECLARATION NAMES CLASSES OF PEOPLE. Who is in the team is rows: these are the rules that
       sweep somebody in, and anybody invited by hand stays whatever the rules say. */
    ways: z.array(z.string()).meta({ label: 'Who is in it', widget: 'multiselect', options: 'team-ways', help: 'the ways somebody joins on their own; anybody invited by hand stays in whatever these say. None: invitation only' }).optional(),
    thumb: z.string().meta({ label: 'Picture', widget: 'media' }).optional(),
    position: z.number().int().meta({ label: 'Where it sits', grid: true, help: 'lower comes first; 99 when blank' }).optional(),
  }),
  checks: [
    (rec) => {
      const out = []
      if (!String((rec.data || {}).name || '').trim()) out.push({ path: 'name', message: 'a name, as people will read it' })
      return out
    },
  ],
  /*
   * THE PROJECTION RUNS WHEREVER IT CAN, and that is not only on a machine.
   *
   * On a checkout the scripts do it: the compile refuses a malformed declaration (and so refuses the
   * save), then the push writes the rows. Over rows there is no machine — `ctx.script()` answers
   * "the deploy runs it" — and for a renderer that is right. For this it would be wrong: a team's
   * rows are a few upserts and a sweep, which need a database and not a disk, and the store is
   * holding one. A deployment with git out of the cycle and no deploy hook never rebuilds at all,
   * so a team saved there would never become a team.
   *
   * The declaration is not re-validated here: over rows a fill is only ever what the editor's list
   * of ways produced, and a hand-written file exists only where the compile runs.
   */
  after: async (rec, ctx) => { await onWrite(ctx) },
  afterRemove: async (name, ctx) => { await onWrite(ctx) },
  /* the declaration as it now stands, made real — a few upserts and the sweep, which need a
     database and not a disk, so they run in the Edge Function rather than waiting for a deploy */
  projected: async (ctx) => {
    const db = ctx.store && ctx.store.kind === 'rows' ? ctx.store.client : null
    if (!db) return
    await projectTeams({ teams: await readTeams(ctx.store), db })
  },
  options: {
    'team-ways': async (ctx) => {
      const out = Object.keys(TEAM_WAYS).map((value) => ({ value, label: WORD[value] || value }))
      /* the membership tiers this site sells, read through the store, so nobody types a slug and
         nothing here touches a disk (this model is in the pipe, which runs in an Edge Function) */
      try {
        const matter = (await import('gray-matter')).default
        for (const k of await ctx.store.list('content/store/products', { ext: 'md' })) {
          const d = matter(await ctx.store.read('content/store/products/' + k)).data || {}
          if (d.kind === 'membership' && d.tier && !out.some((o) => o.value === 'tier:' + d.tier)) out.push({ value: 'tier:' + d.tier, label: 'Everyone on ' + d.tier })
        }
      } catch {}
      return out
    },
  },
}
