#!/usr/bin/env node
/*
 * The declaration, made real: spaces.json into the spaces, channels, roles, grants and hooks tables.
 *
 * It is a PROJECTION and behaves like one. It is the only writer — no client has an insert, update
 * or delete policy on any of these tables — and it goes one way: the file says what exists, this
 * makes the database agree, and nothing here ever reads the database back into a file.
 *
 *   · a space, channel or role is upserted by its slug, so its id survives every edit and every
 *     message, membership and unread counter hanging off it survives with it;
 *   · a space or channel whose file has gone is ARCHIVED, never deleted: a room is full of what
 *     people said, and a file removed by mistake must not take a year of conversation with it. A
 *     file that comes back un-archives it, with everything still in it;
 *   · a role the declaration no longer names IS deleted, which takes it off everybody who held it —
 *     that is what removing a role means;
 *   · a direct message is a channel too (kind 'dm'), made at runtime by people rather than declared,
 *     and is never touched;
 *   · a grant the declaration owns (source 'file') is replaced wholesale; one given to a person by
 *     hand (source 'hand', through space_grant_person) is never touched;
 *   · no counter, no membership, no message, no read mark is written here at all.
 *
 * With no service key, or nothing declared, it says so and does nothing.
 *
 *   node build/spaces-push.mjs            project
 *   node build/spaces-push.mjs --check    say what it would do, and change nothing
 *   node build/spaces-push.mjs --seed     project, then ask the database to seed its demo rooms
 *                                         (seed_spaces_demo, and the site's own seed_site_spaces)
 */
import { createClient } from '@supabase/supabase-js'

const ROOT = process.cwd()
export const FILE = 'supabase/functions/_shared/spaces.json'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const result = async (query, label) => {
  const value = await query
  if (value.error) throw new Error(`${label}: ${value.error.message}`)
  return value
}
const rows = (value, label) => {
  if (!Array.isArray(value.data)) throw new Error(`${label}: expected a row list`)
  return value.data
}

/* `root` is the site whose declaration is projected (a test feeds it a fixture); `declared` the
   compiled record itself, for a caller that has one in hand */
export async function pushSpaces({ check = false, seed = false, root = ROOT, declared: given = null, quiet = false, db: client = null } = {}) {
  /*
   * THE DECLARATION COMES IN, or is read from the file the compile wrote. A caller with one in hand
   * — the admin's Edge Function on a publish — hands it over and nothing here opens a file; the
   * script's own path reads spaces.json, and only then is node:fs reached for at all.
   */
  let declared = given
  if (!declared) {
    const { existsSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const file = join(root, FILE)
    if (!existsSync(file)) { if (!quiet) console.log('spaces: nothing declared'); return { spaces: 0 } }
    declared = JSON.parse(readFileSync(file, 'utf8'))
  }
  /* and the environment only where nobody handed a database in */
  let db = client
  if (!db) {
    const { supabaseUrl, serviceKey } = await import('./tts/storage.mjs')
    const url = supabaseUrl(), key = serviceKey()
    if (!url || !key) { if (!quiet) console.log('spaces: no service key — the declaration is not projected'); return { spaces: 0 } }
    db = createClient(url, key, { auth: { persistSession: false } })
  }
  const said = []
  const say = (m) => { said.push(m); if (!quiet) console.log('  ' + m) }

  /* the spaces, by slug */
  const had = rows(await result(db.from('spaces').select('id, slug, name, kind, fill, dms, discoverable, welcome, groups, "group", position, history, joining, cover, thumb, archived_at'), 'spaces: could not read existing rows'), 'spaces: could not read existing rows')
  const byslug = new Map(had.map((s) => [s.slug, s]))
  const ids = new Map()
  for (const s of declared.filter((x) => x.published)) {
    const want = {
      slug: s.slug, name: s.name, kind: s.kind, fill: s.fill, dms: s.dms !== false, archived_at: null,
      discoverable: !!s.discoverable, welcome: s.welcome || null, groups: s.groups || [],
      group: s.group || null, position: Number.isFinite(Number(s.position)) ? Number(s.position) : 99,
      history: s.history || [],
      joining: s.join && s.join.how && s.join.how !== 'none' ? s.join : {},
      cover: s.cover || null, thumb: s.thumb || null,
    }
    const was = byslug.get(s.slug)
    if (!was) {
      say(`+ space ${s.slug}`)
      if (!check) { const { data, error } = await db.from('spaces').insert(want).select('id').single(); if (error) throw new Error(`spaces: ${s.slug}: ${error.message}`); ids.set(s.slug, data.id) }
    } else {
      ids.set(s.slug, was.id)
      if (was.name !== want.name || was.kind !== want.kind || !same(was.fill, want.fill) || was.archived_at
        || was.dms !== want.dms
        || was.discoverable !== want.discoverable || (was.welcome || null) !== want.welcome
        || !same(was.groups || [], want.groups)
        || (was.group || null) !== want.group || Number(was.position ?? 99) !== want.position
        || !same(was.history || [], want.history) || !same(was.joining || {}, want.joining)
        || (was.cover || null) !== want.cover || (was.thumb || null) !== want.thumb) {
        say(`~ space ${s.slug}${was.archived_at ? ' (back from the archive)' : ''}`)
        if (!check) { const { error } = await db.from('spaces').update(want).eq('id', was.id); if (error) throw new Error(`spaces: ${s.slug}: ${error.message}`) }
      }
    }
  }
  /* a space the declaration no longer publishes is archived, with everything in it */
  const wanted = new Set(declared.filter((x) => x.published).map((x) => x.slug))
  for (const s of had) if (!wanted.has(s.slug) && !s.archived_at) {
    say(`- space ${s.slug} archived (its file is gone)`)
    if (!check) await result(db.from('spaces').update({ archived_at: new Date().toISOString() }).eq('id', s.id), `spaces: could not archive ${s.slug}`)
  }
  if (check) {
    if (!quiet) console.log(said.length ? `spaces: ${said.length} change(s) to make` : `spaces: ${declared.length} declared, the database already agrees`)
    return { spaces: declared.length, said }
  }

  for (const s of declared.filter((x) => x.published)) {
    const sid = ids.get(s.slug)
    if (!sid) continue

    /* the roles */
    const hadRoles = rows(await result(db.from('space_roles').select('id, slug, name, colour, rank').eq('space_id', sid), `spaces: ${s.slug}: could not read roles`), `spaces: ${s.slug}: could not read roles`)
    const roleId = new Map(hadRoles.map((r) => [r.slug, r.id]))
    for (const r of s.roles) {
      const want = { space_id: sid, slug: r.slug, name: r.name, colour: r.colour, rank: r.rank }
      const was = hadRoles.find((x) => x.slug === r.slug)
      if (!was) { const { data, error } = await db.from('space_roles').insert(want).select('id').single(); if (error) throw new Error(`spaces: ${s.slug}/${r.slug}: ${error.message}`); roleId.set(r.slug, data.id); say(`+ role ${s.slug}/${r.slug}`) }
      else if (was.name !== r.name || was.colour !== r.colour || was.rank !== r.rank) { await result(db.from('space_roles').update(want).eq('id', was.id), `spaces: ${s.slug}/${r.slug}: could not update role`); say(`~ role ${s.slug}/${r.slug}`) }
    }
    const keepRoles = new Set(s.roles.map((r) => r.slug))
    for (const r of hadRoles) if (!keepRoles.has(r.slug)) { await result(db.from('space_roles').delete().eq('id', r.id), `spaces: ${s.slug}/${r.slug}: could not remove role`); roleId.delete(r.slug); say(`- role ${s.slug}/${r.slug} (and off everybody who held it)`) }

    /* THE BADGES. What they are is the file's; who wears one is an act, and the act is never
       touched here — a badge whose wording changes is the same badge, and everybody keeps it. A
       badge the file stops declaring goes, and goes off everybody, which is the only way a
       projection can mean anything. */
    const hadFlair = rows(await result(db.from('space_flair').select('id, slug, name, colour, icon, note, inline, position').eq('space_id', sid), `spaces: ${s.slug}: could not read flair`), `spaces: ${s.slug}: could not read flair`)
    for (const x of s.flair || []) {
      const want = { space_id: sid, slug: x.slug, name: x.name, colour: x.colour || null, icon: x.icon || null,
        note: x.note || null, inline: x.inline !== false, position: Number(x.position) }
      const was = hadFlair.find((y) => y.slug === x.slug)
      if (!was) { const { error } = await db.from('space_flair').insert(want); if (error) throw new Error(`spaces: ${s.slug}/flair/${x.slug}: ${error.message}`); say(`+ flair ${s.slug}/${x.slug}`) }
      else if (was.name !== want.name || (was.colour || null) !== want.colour || (was.icon || null) !== want.icon
        || (was.note || null) !== want.note || was.inline !== want.inline || Number(was.position) !== want.position) {
        await result(db.from('space_flair').update(want).eq('id', was.id), `spaces: ${s.slug}/flair/${x.slug}: could not update`); say(`~ flair ${s.slug}/${x.slug}`) }
    }
    const keepFlair = new Set((s.flair || []).map((x) => x.slug))
    for (const x of hadFlair) if (!keepFlair.has(x.slug)) { await result(db.from('space_flair').delete().eq('id', x.id), `spaces: ${s.slug}/flair/${x.slug}: could not remove`); say(`- flair ${s.slug}/${x.slug} (and off everybody wearing it)`) }

    /* the channels — declared ones only; a direct message is nobody's declaration */
    const hadCh = rows(await result(db.from('channels').select('id, slug, name, topic, mode, visibility, position, "group", cover, thumb, archived_at, reactions, votes, fill, encrypted').eq('space_id', sid).eq('kind', 'channel'), `spaces: ${s.slug}: could not read channels`), `spaces: ${s.slug}: could not read channels`)
    /* the room's own answer, else the space's, else the platform's — reactions on, votes off. The
       resolution happens here so the row holds the answer and nothing reading it knows the ladder. */
    const takes = (c, key, dflt) => (c[key] == null ? (s[key] == null ? dflt : s[key]) : c[key])
    const chId = new Map(hadCh.map((c) => [c.slug, c.id]))
    for (const c of s.channels.filter((x) => x.published)) {
      const want = {
        space_id: sid, slug: c.slug, name: c.name, topic: c.topic, mode: c.mode,
        visibility: c.visibility, position: c.order, group: c.group || null,
        cover: c.cover || null, thumb: c.thumb || null, archived_at: null,
        reactions: takes(c, 'reactions', true), votes: takes(c, 'votes', false),
        /* the room's own rule, which the sweep reads the way it reads a space's */
        fill: c.fill || {},
        /* SEALED. Already resolved against the space by `encryptedOf` when spaces.json was
           compiled, so the row holds the answer and nothing reading it knows the ladder. It is
           written on the way UP only: the database refuses true → false once the room has used a
           key, and a declaration that changed its mind about a room full of ciphertext would
           otherwise be a failed push every time. */
        encrypted: c.encrypted === true,
      }
      const was = hadCh.find((x) => x.slug === c.slug)
      if (!was) { const { data, error } = await db.from('channels').insert(want).select('id').single(); if (error) throw new Error(`spaces: ${s.slug}/${c.slug}: ${error.message}`); chId.set(c.slug, data.id); say(`+ channel ${s.slug}/${c.slug}`) }
      else if (was.name !== c.name || was.topic !== c.topic || was.mode !== c.mode || was.visibility !== c.visibility
        || was.position !== c.order || (was.group || null) !== (c.group || null)
        || (was.cover || null) !== (c.cover || null) || (was.thumb || null) !== (c.thumb || null) || was.archived_at
        || was.reactions !== want.reactions || was.votes !== want.votes || !same(was.fill || {}, want.fill)
        || (was.encrypted === true) !== want.encrypted) { await result(db.from('channels').update(want).eq('id', was.id), `spaces: ${s.slug}/${c.slug}: could not update channel`); say(`~ channel ${s.slug}/${c.slug}${was.archived_at ? ' (back from the archive)' : ''}`) }
    }
    const keepCh = new Set(s.channels.filter((x) => x.published).map((c) => c.slug))
    for (const c of hadCh) if (!keepCh.has(c.slug) && !c.archived_at) { await result(db.from('channels').update({ archived_at: new Date().toISOString() }).eq('id', c.id), `spaces: ${s.slug}/${c.slug}: could not archive channel`); say(`- channel ${s.slug}/${c.slug} archived (its file is gone; what was said in it is not)`) }

    /* every member of the space is in its open channels — the fill makes the membership, this makes the rooms */
    await result(db.rpc('space_sync_members'), `spaces: ${s.slug}: could not sync membership`)

    /* the grants the file owns: replaced wholesale, a hand grant untouched */
    await result(db.from('space_grants').delete().eq('space_id', sid).eq('source', 'file'), `spaces: ${s.slug}: could not replace file grants`)
    const grantRows = []
    for (const g of s.grants) {
      const row = { capability: g.capability, scope: g.scope, space_id: sid, source: 'file', note: g.note || null }
      if (g.channel) { const id = chId.get(g.channel); if (!id) continue; row.channel_id = id }
      if (g.scope === 'tier') row.tier = g.tier
      if (g.scope === 'product') { if (!g.product_key) throw new Error(`spaces: ${s.slug}: the grant to bought:${g.sku} names no offer key — the catalog holds no offer "${g.sku}" (or was not read)`); row.product_key = g.product_key }
      if (g.scope === 'role') { const id = roleId.get(g.role); if (!id) continue; row.role_id = id }
      if (Number.isFinite(g.days)) row.days = g.days
      grantRows.push(row)
    }
    if (grantRows.length) await result(db.from('space_grants').insert(grantRows), `spaces: ${s.slug} grants`)

    /* which room hears which of the platform's own events */
    await result(db.from('space_hooks').delete().eq('space_id', sid), `spaces: ${s.slug}: could not replace event hooks`)
    const hooks = []
    for (const c of s.channels.filter((x) => x.published)) for (const e of c.hears) { const id = chId.get(c.slug); if (id) hooks.push({ space_id: sid, event: e, channel_id: id }) }
    if (hooks.length) await result(db.from('space_hooks').upsert(hooks, { onConflict: 'space_id,event' }), `spaces: ${s.slug} hooks`)
  }

  if (!quiet) console.log(said.length
    ? `spaces: ${declared.length} declared, ${said.length} change(s)`
    : `spaces: ${declared.length} declared, the database already agrees`)
  if (seed) {
    const { error } = await db.rpc('seed_spaces_demo')
    if (error) console.log('  (no demo seed: ' + error.message + ')')
    /* and the site's own rows that need the rooms to exist — a seed runs before the declaration is
       projected, so a space cannot be named in one. A site with none simply has no such function. */
    const site = await db.rpc('seed_site_spaces')
    if (site.error && !/does not exist|not find the function|schema cache/i.test(site.error.message)) {
      console.log('  (the site seed: ' + site.error.message + ')')
    }
  }
  return { spaces: declared.length, said }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await pushSpaces({ check: process.argv.includes('--check'), seed: process.argv.includes('--seed') })
}
