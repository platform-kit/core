#!/usr/bin/env node
/*
 * The spaces, compiled: content/spaces/<slug>.md and content/spaces/<slug>/<channel>.md
 * (build/spaces-io.mjs is the grammar) checked and flattened into one record the projection and
 * the browser both read —
 *
 *   .velite/spaces.json                          for the site (what a space is, who may be in it)
 *   supabase/functions/_shared/spaces.json       for the functions and build/spaces-push.mjs
 *
 * Every grant is flattened to the row space_grants holds — at the scope the file declared it at,
 * carrying the space (and the channel, where it was declared on one), so a grant means what the
 * file that holds it says and nothing wider. A `bought:<sku>` is widened here to the offer's KEY,
 * which is what every purchase is attributed by, the way a funnel's book slug is widened to its
 * skus; an unknown sku is a fault, not a silent nothing.
 *
 * Refused: a space with no name, a slug the database would not take, a kind · mode · visibility ·
 * capability · event the schema does not know, two roles with one slug, a grant naming a role no
 * space declares, a fill with a key that is not one of the four, a channel in no space, a welcome
 * naming a room the space does not have, a channel naming a group the space does not declare, and a
 * declared group no room sits under — a heading with nothing under it is a heading nobody meant.
 *
 *   node build/spaces.mjs            compile
 *   node build/spaces.mjs --check    compile, and say what each space is
 */
import { join } from 'node:path'
import { storeFor } from './store/index.mjs'
import { readSpaces, parseTarget, encryptedOf, KINDS, MODES, VISIBILITIES, CAPABILITIES, EVENTS, FILLS, SPANS, WINDOWED, spanMinutes, fillSets, slugOk, roleSlugOk } from './spaces-io.mjs'

const ROOT = process.cwd()
export const OUT = 'supabase/functions/_shared/spaces.json'
/* THE GLYPHS A BADGE MAY WEAR: the surface's own set (SpaceIcon), never an uploaded picture. A name
   that is not one of these is refused at the compile rather than drawn as an empty square. */
export const GLYPHS = ['star', 'sparkle', 'shield', 'pin', 'ticket', 'smile', 'head', 'people', 'clock',
  'bell', 'lock', 'flag', 'chart', 'quote', 'link', 'tick', 'home', 'thread', 'search', 'video', 'mic']
export const SITE_OUT = '.velite/spaces.json'

/* a sku → the offer's key, and the tiers a site actually sells, from the catalog the functions read.
   A fill or a grant naming a tier no membership declares fills nobody and grants nobody — silently,
   which is the worst way for a room to be empty — so it is a fault like an unknown sku. */
export function catalogOf(root, given = null) {
  /* the catalog as DATA. On a machine the caller reads it off the disk (build/spaces-disk.mjs); in an
     Edge Function there is no file, and an absent catalog means the sku and tier checks below simply
     find nothing to contradict — which is what they did before, when the read threw and was caught. */
  const cat = given || { offers: {}, sessions: [] }
  const offers = cat.offers || {}
  const list = Object.values(offers)
  const types = cat.sessions || []
  return {
    keyOf: (sku) => { const o = offers[sku] || list.find((x) => x.sku === sku); return o && o.key ? o.key : null },
    tiers: new Set(list.filter((o) => o.kind === 'membership' && o.tier).map((o) => o.tier)),
    sessions: new Set(types.map((s) => s.slug)),
    /* a site with no store at all cannot be told it has the wrong tier */
    sells: list.length > 0,
    books: types.length > 0,
  }
}

/* ONE FILL, CHECKED AND PUT IN THE COLUMN'S WORDS — a space's and a channel's alike, because they
   are the same grammar and two copies of this would be two copies to get subtly different.
   `bad(message)` is the caller's, so a fault is named where it was written. */
/* DOES THIS ROOM'S RULE CONTRADICT ITS SPACE'S? Only a plain contradiction is worth refusing: every
   alternative on both sides demands the same key, each with one value, and no value is shared. Then
   nobody who is in the space can be in the room, and the room can never have anybody in it.
   Anything subtler — a role against a tier, a window, a list — is left alone, because a compile that
   guessed at "could these ever both be true" would refuse rooms that are perfectly reasonable. */
function contradicts(spaceFill, roomFill) {
  const a = fillSets(spaceFill), b = fillSets(roomFill)
  if (!a.length || !b.length) return null
  const one = (sets, key) => {
    const vals = []
    for (const s of sets) {
      const v = s[key]
      if (v == null || Array.isArray(v)) return null   /* not asked, or asked several ways */
      vals.push(String(v))
    }
    return vals
  }
  for (const key of ['tier', 'entitlement', 'bought']) {
    const sv = one(a, key), rv = one(b, key)
    if (!sv || !rv) continue
    if (rv.some((x) => sv.includes(x))) continue
    return { key, space: [...new Set(sv)].join(', '), room: [...new Set(rv)].join(', ') }
  }
  return null
}

export function buildFill(raw, { bad, where, keyOf, tierOk, sessionOk, sells, books }) {
  const sets = fillSets(raw)
  const built = sets.map((set, i) => {
    const one = {}
    const spans = {}
    for (const [k, v] of Object.entries(set)) {
      /* A SPAN IS A QUALIFIER, NOT A CONDITION. It says how long matching admits somebody for; it
         cannot admit anybody by itself, so a set carrying one and naming nothing it could hang on
         is a set somebody wrote half of. */
      if (SPANS.includes(k)) {
        const mins = spanMinutes(v)
        if (!mins) bad(`${where(i)}: ${k} "${v}" is not a span — a number and a unit (30m, 12h, 7d, 2w)`)
        else spans[k] = mins
        continue
      }
      const col = FILLS[k]
      if (!col) { bad(`${where(i)}: "${k}" is not one of ${[...Object.keys(FILLS), ...SPANS].join(', ')}`); continue }
      if (k === 'role') one.role = (Array.isArray(v) ? v : [v]).map(String)
      /* A SITE WITH NO CATALOGUE CANNOT BE TOLD ITS SKU IS WRONG, which is what `sells` is for and
         was passed here for before it was wired. In an Edge Function there is no catalog file at all,
         so keyOf answers null for every sku a site really does sell — and the compile refused a
         saved space naming one, with a message saying the opposite of the truth. With no catalogue
         the sku is kept as written: nothing can be widened, and nothing can match either. */
      else if (k === 'bought') {
        const key = keyOf(String(v))
        if (!key && sells) bad(`${where(i)}: bought "${v}" is not an offer this site sells`)
        else one.product = key || String(v)
      }
      else if (k === 'booking') { if (!sessionOk(String(v))) bad(`${where(i)}: booking "${v}" is not a booking type this site has`); else one.booking = String(v) }
      /* a tier or an entitlement may be a list, any of which admits (space_fill_values reads either); each
         is checked on its own, so one bad name in a list is named rather than the whole list joined */
      else {
        const vals = (Array.isArray(v) ? v : [v]).map(String)
        if (k === 'tier') for (const t of vals) if (!tierOk(t)) bad(`${where(i)}: tier "${t}" is not one any membership declares`)
        /* a cohort is one cohort OF a course: on its own it would name nobody */
        if (k === 'cohort' && !('course' in set)) bad(`${where(i)}: a cohort is one of a course's — name the course too`)
        one[col] = Array.isArray(v) ? vals : vals[0]
      }
    }
    if (Object.keys(spans).length) {
      const on = Object.keys(set).filter((k) => WINDOWED.includes(k))
      if (!on.length) bad(`${where(i)}: a window needs something to hang on — ${WINDOWED.join(' or ')}`)
      /* A PURCHASE HAS NO FUTURE. withinNext asks when something is going to happen, and a purchase
         has already happened or has not been made. */
      if (spans.withinNext && !set.booking) bad(`${where(i)}: withinNext asks about something still to come, and only a booking can be`)
      if (spans.withinLast) one.within_last = spans.withinLast
      if (spans.withinNext && set.booking) one.within_next = spans.withinNext
    }
    if (!Object.keys(one).length) bad(`${where(i)}: an alternative with nothing in it fills nobody — remove it, or say what it takes`)
    return one
  }).filter((o) => Object.keys(o).length)
  /* two alternatives saying the same thing is a mistake, not a preference */
  const said = new Set()
  for (let i = 0; i < built.length; i++) {
    const k = JSON.stringify(Object.entries(built[i]).sort())
    if (said.has(k)) bad(`${where(i)}: says the same as an earlier alternative`)
    said.add(k)
  }
  /* a single set is written as a mapping, exactly as it always was */
  return built.length > 1 ? built : built[0] || {}
}

export async function compileSpaces({ check = false, store, write = true, catalog = null, forms: formNames = null, modules = null } = {}) {
  const st = store || await storeFor(ROOT)
  /* the store says where the site is: a test feeds a store over a fixture, and neither the catalog it
     reads nor the files it writes may be this checkout's */
  const root = (st && st.root) || ROOT
  /*
   * THE CATALOG AND THE FORMS ARE DATA HERE, NOT FILES. Both are the build's own outputs, read to
   * check a declaration against them — does this sku exist, is this tier one a membership declares,
   * is this the name of a form. On a machine they are read off the disk by build/spaces-disk.mjs; in
   * the Edge Function that publishes there is no disk, and their absence means those checks find
   * nothing to contradict, exactly as before, when the read threw and was caught.
   */
  let cat = catalog, names = formNames, mods = modules
  if ((cat == null || names == null || mods == null) && st.kind !== 'rows') {
    const fsSide = await import('./spaces-disk.mjs')
    if (cat == null) cat = fsSide.catalogFrom(root)
    if (names == null) names = fsSide.formsFrom(root)
    if (mods == null) mods = await fsSide.modulesFrom(root)
  }
  /* a module is on unless the config says false; `null` is "nobody told us", which is how it
     arrives in an Edge Function — and an unanswerable question is not a fault */
  const encryptionOn = mods == null ? null : mods['space-encryption'] !== false
  const networkOn = mods == null ? null : mods.network !== false
  cat = catalogOf(root, cat)
  const forms = new Set(names || [])
  const keyOf = cat.keyOf
  const tierOk = (tier) => !cat.sells || cat.tiers.has(tier)
  /* a site with no booking types at all cannot be told it named the wrong one */
  const sessionOk = (slug) => !cat.books || cat.sessions.has(slug)
  const errors = []
  const declared = await readSpaces(st)
  const out = []

  for (const s of declared) {
    const at = `content/spaces/${s.slug}.md`
    const bad = (m) => errors.push(`${at}: ${m}`)
    if (!slugOk(s.slug)) bad('the name is lower-case words joined by hyphens')
    if (!String(s.data.name || '').trim()) bad('a space needs a name')
    if (!KINDS.includes(s.data.kind)) bad(`kind is one of ${KINDS.join(', ')} (got "${s.data.kind}")`)

    /* THE FILL, in the column's words. One set of conditions, or several of which any one is
       enough — each checked exactly as the one was, and named when it is at fault, because "fill:
       tier X is not one any membership declares" is no use when there are three alternatives. */
    const fillCtx = { bad, keyOf, tierOk, sessionOk, sells: cat.sells, books: cat.books }
    const spaceSets = fillSets(s.data.fill)
    const fill = buildFill(s.data.fill, { ...fillCtx, where: (i) => (spaceSets.length > 1 ? `fill[${i + 1}]` : 'fill') })

    const roles = []
    const seenRole = new Set()
    for (const r of s.data.roles || []) {
      if (!roleSlugOk(r.slug)) { bad(`roles: "${r.slug}" is lower-case words joined by hyphens`); continue }
      if (seenRole.has(r.slug)) { bad(`roles: two roles are called "${r.slug}"`); continue }
      seenRole.add(r.slug)
      if (!String(r.name || '').trim()) bad(`roles: ${r.slug} needs a name`)
      roles.push({ slug: r.slug, name: r.name, colour: r.colour || null, rank: r.rank || 0 })
    }

    const channels = []
    const seenChannel = new Set()
    for (const c of s.channels) {
      const cat = `content/spaces/${s.slug}/${c.slug}.md`
      const cbad = (m) => errors.push(`${cat}: ${m}`)
      if (!slugOk(c.slug)) cbad('the name is lower-case words joined by hyphens')
      if (seenChannel.has(c.slug)) { cbad('two channels of this space have that name'); continue }
      seenChannel.add(c.slug)
      if (!String(c.data.name || '').trim()) cbad('a channel needs a name')
      if (!MODES.includes(c.data.mode)) cbad(`mode is one of ${MODES.join(', ')} (got "${c.data.mode}")`)
      /* A FEED IS THE NETWORK'S READING: it is what a space's members post to from their timeline
         and what a pinned space runs through it. With the module off there is neither, so a room
         that asks for it is refused rather than drawn as a board nobody can post to from anywhere. */
      if (c.data.mode === 'feed' && networkOn === false) cbad('mode: feed, but the network module is off (platformkit.config.js: switch network on, or read this channel as a stream or a forum)')
      if (!VISIBILITIES.includes(c.data.visibility)) cbad(`visibility is one of ${VISIBILITIES.join(', ')} (got "${c.data.visibility}")`)
      for (const e of c.data.hears) if (!EVENTS.includes(e)) cbad(`hears: "${e}" is not one of ${EVENTS.join(', ')}`)
      if (c.data.group && !(s.data.groups || []).includes(c.data.group)) cbad(`group: "${c.data.group}" is not one this space declares`)
      /* A ROOM'S OWN RULE, in the space's own grammar and through the same builder — so a fault in
         one is worded exactly as a fault in the other. */
      const cSets = fillSets(c.data.fill)
      const cFill = buildFill(c.data.fill, { ...fillCtx, bad: cbad, where: (i) => (cSets.length > 1 ? `fill[${i + 1}]` : 'fill') })
      /* NARROWER, NEVER WIDER. A room's rule cannot let anybody in who is not in the space, so a
         rule no member of the space could pass is a room nobody can ever enter — which is the worst
         way to find out you made a mistake, because nothing tells you. Only a plain contradiction is
         refused: the same key demanded with different single values by every alternative on each
         side. Anything subtler is left alone rather than guessed at. */
      const clash = contradicts(s.data.fill, c.data.fill)
      if (clash) cbad(`fill: no member of this space could match it — the space asks ${clash.key} "${clash.space}" and this room asks "${clash.room}"`)
      /*
       * SEALED, OR REFUSED — never quietly open. `encryptedOf` is the one reading of the channel's
       * own answer and the space's; with the module off there is no schema to keep a key in and no
       * client to seal with, so a declaration that asks for it is a fault here rather than a room
       * that looks sealed in its file and carries plain text in the database.
       */
      const encrypted = encryptedOf(c.data, s.data)
      if (encrypted && encryptionOn === false) {
        cbad('encrypted: true, but the space-encryption module is off (platformkit.config.js: switch space-encryption on, or drop encrypted from this channel and the space above it)')
      }
      channels.push({
        slug: c.slug, name: c.data.name, topic: c.data.topic || null, mode: c.data.mode,
        visibility: c.data.visibility, published: c.data.published, order: c.data.order,
        group: c.data.group || null, cover: c.data.cover || null, thumb: c.data.thumb || null, hears: c.data.hears, about: c.content,
        fill: cFill, encrypted,
      })
    }

    /* every grant, at the scope its file declared it at */
    const grants = []
    const take = (g, where, channel) => {
      const cat = channel ? `content/spaces/${s.slug}/${channel}.md` : at
      const gbad = (m) => errors.push(`${cat}: ${m}`)
      if (!CAPABILITIES.includes(g.capability)) { gbad(`grants: "${g.capability}" is not one of ${CAPABILITIES.join(', ')}`); return }
      const t = parseTarget(g.to)
      if (!t.scope) { gbad(`grants: "${t.bad}" is not a target — everyone, tier:<slug>, role:<slug> or bought:<sku>`); return }
      const row = { capability: g.capability, space: s.slug, channel: channel || null, note: g.note || where }
      if (t.scope === 'everyone') row.scope = channel ? 'channel' : 'space'
      else if (t.scope === 'tier') {
        if (!tierOk(t.tier)) { gbad(`grants: tier "${t.tier}" is not one any membership declares`); return }
        row.scope = 'tier'; row.tier = t.tier
      }
      else if (t.scope === 'role') {
        if (!seenRole.has(t.role)) { gbad(`grants: role "${t.role}" is not one this space declares`); return }
        row.scope = 'role'; row.role = t.role
      } else if (t.scope === 'product') {
        const key = keyOf(t.sku)
        /* as in buildFill: with no catalogue there is nothing to contradict the sku */
        if (!key && cat.sells) { gbad(`grants: bought "${t.sku}" is not an offer this site sells`); return }
        row.scope = 'product'; row.product_key = key; row.sku = t.sku
      }
      if (Number.isFinite(g.days)) row.days = g.days
      grants.push(row)
    }
    for (const g of s.data.grants || []) take(g, 'the space', null)
    for (const r of s.data.roles || []) for (const cap of r.can || []) take({ capability: cap, to: 'role:' + r.slug }, 'the role', null)
    for (const c of s.channels) for (const g of c.data.grants || []) take(g, 'the channel', c.slug)

    /* A KEY A SPACE NO LONGER HAS is refused by name rather than ignored: a line that does nothing
       is a line somebody keeps editing. Sessions are booked where coaching lives (coaching.where). */
    for (const k of s.data.retired || []) bad(`${k}: a space no longer lists sessions to book — booking lives with coaching (platformkit.config.js coaching.where); take the line out`)

    /* the badges: a slug the database will take, said once, and a name to show */
    const flair = []
    const seenFlair = new Set()
    for (const x of s.data.flair || []) {
      if (!roleSlugOk(x.slug)) { bad(`flair: "${x.slug}" is lower-case words joined by hyphens`); continue }
      if (seenFlair.has(x.slug)) { bad(`flair: two badges of this space are called "${x.slug}"`); continue }
      if (x.icon && !GLYPHS.includes(x.icon)) { bad(`flair: "${x.icon}" is not a glyph this surface draws (${GLYPHS.join(', ')})`); continue }
      seenFlair.add(x.slug)
      flair.push({ ...x, position: Number.isFinite(Number(x.position)) ? Number(x.position) : flair.length })
    }

    /* a door that asks a form must name one this site actually has, or nobody gets through it */
    const jform = s.data.join && s.data.join.form
    if (jform && !forms.has(jform)) bad(`join: form "${jform}" is not a form of this site`)

    /* the welcome is a room, and a heading with nothing under it is a heading nobody meant */
    const welcome = s.data.welcome || ''
    if (welcome && !channels.some((c) => c.slug === welcome && c.published)) bad(`welcome: "${welcome}" is not a published room of this space`)
    for (const g of s.data.groups || []) if (!channels.some((c) => c.group === g)) bad(`groups: no room sits under "${g}"`)

    out.push({
      slug: s.slug, name: s.data.name, kind: s.data.kind, published: s.data.published,
      discoverable: s.data.discoverable, welcome: welcome || null, groups: s.data.groups || [],
      cover: s.data.cover || null, thumb: s.data.thumb || null,
      /* and where the space itself sits in everybody's column: the site's own arrangement */
      group: s.data.group || null, position: Number.isFinite(Number(s.data.position)) ? Number(s.data.position) : 99,
      history: s.data.history || [],
      /* the door, where the space opened one. 'none' is written as nothing at all, so a space that
         never thought about it cannot grow a Join button by a default changing under it. */
      join: (s.data.join && s.data.join.how && s.data.join.how !== 'none') ? s.data.join : undefined,
      fill, dms: s.data.dms !== false, about: s.content, roles, flair, channels, grants,
    })
  }

  if (errors.length) { console.error('✖ spaces:\n  ' + errors.join('\n  ')); process.exitCode = 1; return null }

  const text = JSON.stringify(out, null, 2) + '\n'
  /* the compile's own output, on the machine path alone: in a function a publish projects straight
     into the database and there is no file for anybody to read */
  if (write && st.kind !== 'rows') (await import('./spaces-disk.mjs')).writeSpaces(root, [OUT, SITE_OUT], text)
  if (check) for (const s of out) console.log(`  ${s.slug}${s.published ? '' : ' (unpublished)'} — ${s.kind}, ${s.channels.length} channel(s), ${s.roles.length} role(s), ${s.grants.length} grant(s)`)
  if (write) console.log(`spaces: ${out.length} declared → ${OUT}`)
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await compileSpaces({ check: process.argv.includes('--check') })
  if (!r) process.exit(1)
}
