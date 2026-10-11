/* The spaces: a space is a file (content/spaces/<slug>.md) and each of its channels is a file under its
   folder (build/spaces-io.mjs is the grammar) — one model over both, because they are one thing to edit
   and the record's name says which it is ('the-guild' or 'the-guild/lounge'). The editor is SpacesAdmin;
   every save compiles the declaration (build/spaces.mjs) and, on a machine, projects it. */
import { Refusal } from '../util.mjs'
import {
  SPACES_DIR, parseSpace, serialiseSpace, parseChannel, serialiseChannel, parseTarget,
  KINDS, MODES, VISIBILITIES, CAPABILITIES, EVENTS, FILLS, slugOk, roleSlugOk,
} from '../../spaces-io.mjs'

const isChannel = (name) => String(name || '').includes('/')

/* over a checkout a write IS the file: compile, then project. Over rows a write is a draft and
   nothing moves until it is published — see `projected`. */
async function onSpaceWrite(ctx) {
  if (ctx.store && ctx.store.kind === 'rows') return
  await ctx.script('spaces.mjs')
  await ctx.script('spaces-push.mjs').catch((e) => console.warn('spaces: not projected — ' + e.message))
}

export default {
  key: 'spaces', name: 'Spaces', dir: SPACES_DIR, title: 'name', module: 'spaces',
  editor: 'SpacesAdmin', creates: true, nested: true, body: true, bodyLabel: 'What this place is',
  grammar: {
    parse: (text, ctx) => {
      const f = isChannel(ctx.name) ? parseChannel(text) : parseSpace(text)
      return { data: f.data, content: f.content, parsed: { kind: isChannel(ctx.name) ? 'channel' : 'space' } }
    },
    serialise: (rec, ctx) => (isChannel(ctx.name) ? serialiseChannel(rec.data, rec.content) : serialiseSpace(rec.data, rec.content)),
  },
  prepare: (rec, ctx) => {
    const parts = String(ctx.name || '').split('/')
    if (parts.length > 2) throw new Refusal(400, 'a channel lives in one space: <space>/<channel>')
    for (const p of parts) if (!slugOk(p)) throw new Refusal(400, 'the name is lower-case words joined by hyphens')
    return rec
  },
  checks: [
    (rec, ctx) => {
      const out = []
      const at = (path, message) => out.push({ path, message })
      const d = rec.data || {}
      if (!String(d.name || '').trim()) at('name', 'a name, as people will read it')
      if (isChannel(ctx.name)) {
        if (!MODES.includes(d.mode)) at('mode', `one of ${MODES.join(', ')}`)
        if (!VISIBILITIES.includes(d.visibility)) at('visibility', `one of ${VISIBILITIES.join(', ')}`)
        for (const e of d.hears || []) if (!EVENTS.includes(e)) at('hears', `"${e}" is not one of ${EVENTS.join(', ')}`)
      } else {
        if (!KINDS.includes(d.kind)) at('kind', `one of ${KINDS.join(', ')}`)
        for (const k of Object.keys(d.fill || {})) if (!FILLS[k]) at('fill', `"${k}" is not one of ${Object.keys(FILLS).join(', ')}`)
        const seen = new Set()
        for (const r of d.roles || []) {
          if (!roleSlugOk(r.slug)) at('roles', `"${r.slug}" is lower-case words joined by hyphens`)
          else if (seen.has(r.slug)) at('roles', `two roles are called "${r.slug}"`)
          seen.add(r.slug)
          if (!String(r.name || '').trim()) at('roles', `${r.slug} needs a name`)
          for (const c of r.can || []) if (!CAPABILITIES.includes(c)) at('roles', `"${c}" is not one of ${CAPABILITIES.join(', ')}`)
        }
      }
      for (const g of d.grants || []) {
        if (!CAPABILITIES.includes(g.capability)) at('grants', `"${g.capability}" is not one of ${CAPABILITIES.join(', ')}`)
        const t = parseTarget(g.to)
        if (!t.scope) at('grants', `"${t.bad}" is not a target — everyone, tier:<slug>, role:<slug> or bought:<sku>`)
        /* a declaration names classes of people; naming a person is an act, and acts are rows */
        if (/^user:/.test(String(g.to || ''))) at('grants', 'a file never names a person — give one person a capability in Voice, which writes it as an act')
      }
      return out
    },
  ],
  /* the listing's ctx has no name (it is per model, not per record); the record carries its own */
  /* the rail counts spaces; the channels are inside them */
  count: (names) => names.filter((n) => !isChannel(n)).length,
  summary: (rec, ctx) => { const n = rec.name || ctx.name || ''; return { kind: isChannel(n) ? 'channel' : 'space', space: isChannel(n) ? String(n).split('/')[0] : n } },
  /* the compile refuses a malformed declaration and so refuses the save; the projection needs a
     database and a service key, so where there is none it says so and the deploy does it */
  after: async (rec, ctx) => { await onSpaceWrite(ctx) },
  afterRemove: async (name, ctx) => { await onSpaceWrite(ctx) },
  /*
   * THE ROOMS, MADE REAL ON A PUBLISH. compileSpaces reads the declaration through the store and
   * pushSpaces takes it in hand, so between them they need a database and not a disk — which is the
   * only way a space becomes a space where nothing rebuilds. A save over rows is a draft and moves
   * nothing.
   */
  projected: async (ctx) => {
    const db = ctx.store && ctx.store.kind === 'rows' ? ctx.store.client : null
    if (!db) return
    const { compileSpaces } = await import('../../spaces.mjs')
    const { pushSpaces } = await import('../../spaces-push.mjs')
    /*
     * compileSpaces RETURNS THE LIST, not an object holding one. This read `{ spaces }`, which is
     * undefined for an array — and pushSpaces, handed nothing, falls back to reading spaces.json
     * off a disk the Edge Function does not have, says "nothing declared" and returns. So a
     * publish in cloud mode projected no room at all, and said so in a log nobody reads. It is
     * null when the declaration would not compile, and then there is nothing to push.
     */
    const spaces = await compileSpaces({ store: ctx.store, write: false })
    if (!spaces) return
    await pushSpaces({ declared: spaces, db, quiet: true })
  },
  options: {
    /* what a room may be told, what a grant may give, and who may be given one */
    'space-events': () => EVENTS.map((value) => ({ value, label: value })),
    'space-capabilities': () => CAPABILITIES.map((value) => ({ value, label: value })),
    /*
     * WHERE A CONVERSATION LIVES, for anything that takes comments. A library record may say its
     * comments ARE a post in a channel, and the admin has to offer the site's own spaces and rooms
     * rather than ask somebody to type two slugs — which is the difference between a field and a
     * grammar. A forum room is the only kind that can hold one: a stream is not a thread.
     */
    'comment-spaces': async (ctx) => {
      const { readSpaces } = await import('../../spaces-io.mjs')
      return (await readSpaces(ctx.store)).map((s) => ({ value: s.slug, label: s.data.name || s.slug }))
    },
    'comment-channels': async (ctx) => {
      const { readSpaces, encryptedOf } = await import('../../spaces-io.mjs')
      const out = []
      for (const s of await readSpaces(ctx.store)) {
        for (const c of s.channels) {
          if ((c.data.mode || 'stream') !== 'forum') continue
          /* a sealed room is not offered: the comments on a book chapter are a public conversation
             with a room behind them, and a room nobody but its members can read is not that */
          if (encryptedOf(c.data, s.data)) continue
          out.push({ value: c.slug, label: `${s.data.name || s.slug} — ${c.data.name || c.slug}` })
        }
      }
      return out
    },
    /*
     * WHERE A BOT MAY SPEAK, for a schedule's `in: <space>/<channel>`.
     *
     * A sealed room is NOT OFFERED, which is the point: a bot would have to read the room to
     * answer in it and nothing on this side can. Leaving it in the list and refusing the save
     * teaches somebody the rule by failing them; leaving it out teaches it by the room simply not
     * being one of the choices, which is the same rule said the better way round. The build
     * refuses it as well (`sealedRooms` in spaces-io.mjs, asked by bots.mjs), because a file may
     * be written by hand.
     */
    'bot-channels': async (ctx) => {
      const { readSpaces, encryptedOf } = await import('../../spaces-io.mjs')
      const out = []
      for (const s of await readSpaces(ctx.store)) {
        for (const c of s.channels) {
          if (encryptedOf(c.data, s.data)) continue
          out.push({ value: `${s.slug}/${c.slug}`, label: `${s.data.name || s.slug} — ${c.data.name || c.slug}` })
        }
      }
      return out
    },
  },
}
