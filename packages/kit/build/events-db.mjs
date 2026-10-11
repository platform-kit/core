/*
 * THE EVENTS, MADE REAL — the half of the projection that needs a database and not a disk.
 *
 * It lives apart from events-push.mjs for one reason: that file reaches for the environment
 * (tts/storage.mjs, which opens .env with node:fs) to find a database, and a file that touches the
 * filesystem at import time cannot be in the admin's pipe. This half imports nothing of the sort,
 * so the Edge Function can run it when somebody publishes — which is the only way an event ever
 * becomes rows in a deployment where nothing rebuilds.
 *
 * The projection is ONE WAY and the files own it: an event no file declares is removed, and so is
 * an occurrence the repeat no longer makes. Two things survive the rewrite even so, because they
 * are acts and not declarations — an occurrence somebody has said they are coming to, and one
 * called off by hand or carrying a note. A file must never quietly cancel somebody's evening.
 */
import { occurrencesOf, WINDOW_DAYS } from './events.mjs'

/*
 * WHAT MAY BE COMMENTED ON — one row per event, beside the content's own.
 *
 * comment_subjects is the one table every comment policy reads, whatever the kind: who may SEE the
 * thing and who may SAY something on it. Projecting it is how a policy can answer for an article
 * and an event without knowing what either is.
 */
export async function projectEventComments(db, rows) {
  const want = rows.map((r) => ({
    kind: 'event', subject: r.slug,
    /* an event's audience is a fill rule rather than a class ladder, so a gated event is at least
       members-only here; the event's own policy is still the fence on the event itself */
    access: (r.audience || []).length ? ['authenticated'] : [],
    allow: r.comments || 'members',
    updated_at: new Date().toISOString(),
  }))
  if (want.length) {
    const { error } = await db.from('comment_subjects').upsert(want, { onConflict: 'kind,subject' })
    if (error) throw new Error(`events: could not update comment subjects: ${error.message}`)
  }
  const { data: had, error: hadError } = await db.from('comment_subjects').select('subject').eq('kind', 'event')
  if (hadError) throw new Error(`events: could not read comment subjects: ${hadError.message}`)
  if (!Array.isArray(had)) throw new Error('events: could not read comment subjects: expected a row list')
  const keep = new Set(want.map((r) => r.subject))
  const gone = had.map((r) => r.subject).filter((s) => !keep.has(s))
  if (gone.length) {
    const { error } = await db.from('comment_subjects').delete().eq('kind', 'event').in('subject', gone)
    if (error) throw new Error(`events: could not remove stale comment subjects: ${error.message}`)
  }
  return { subjects: want.length, gone: gone.length }
}

/* the declaration, already compiled, written to the database it is given */
export async function projectEvents({ events, rows, db, log = () => {}, days = WINDOW_DAYS } = {}) {
  const wanted = (rows || []).filter((r) => r.published)

  /* what the site has, by slug, so an event keeps its id — an RSVP points at an occurrence, which
     points at an event, and a rewrite that made new ids would throw every answer away */
  const { data: spaceRows, error: spaceError } = await db.from('spaces').select('id, slug')
  if (spaceError) throw new Error(`events: could not read spaces: ${spaceError.message}`)
  if (!Array.isArray(spaceRows)) throw new Error('events: could not read spaces: expected a row list')
  const { data: channelRows, error: channelError } = await db.from('channels').select('id, slug, space_id')
  if (channelError) throw new Error(`events: could not read channels: ${channelError.message}`)
  if (!Array.isArray(channelRows)) throw new Error('events: could not read channels: expected a row list')
  const spaceId = (slug) => spaceRows.find((s) => s.slug === slug)?.id || null
  const channelId = (full) => {
    if (!full) return null
    const [space, room] = String(full).split('/')
    const sid = spaceId(space)
    return channelRows.find((c) => c.space_id === sid && c.slug === room)?.id || null
  }

  const { data: had, error: hadError } = await db.from('calendar_events').select('id, slug')
  if (hadError) throw new Error(`events: could not read existing events: ${hadError.message}`)
  if (!Array.isArray(had)) throw new Error('events: could not read existing events: expected a row list')
  const idOf = new Map(had.map((e) => [e.slug, e.id]))

  let made = 0, gone = 0, kept = 0
  for (const r of wanted) {
    const row = {
      slug: r.slug, title: r.title, sub: r.sub, body: r.body, cover: r.cover,
      space_id: spaceId(r.space), channel_id: channelId(r.channel),
      audience: r.audience, host_role: r.host_role, hosts: r.hosts || [], place: r.place,
      rsvp_answers: r.rsvp_answers || [], rsvp_reason: !!r.rsvp_reason, rsvp_list: r.rsvp_list || 'off',
      comments: r.comments || 'members', cost: r.cost || null,
      thumb: r.thumb || null, gallery: r.gallery || [], media: r.media || null,
      capacity: r.capacity, rsvp: r.rsvp, repeats: r.repeats,
      starts_at: r.starts_at, ends_at: r.ends_at, zone: r.zone, order: r.order,
      published: true, updated_at: new Date().toISOString(),
    }
    const id = idOf.get(r.slug)
    if (id) {
      const { error } = await db.from('calendar_events').update(row).eq('id', id)
      if (error) throw new Error(`events: ${r.slug}: ${error.message}`)
    }
    else {
      const { data, error } = await db.from('calendar_events').insert(row).select('id').single()
      if (error) throw new Error(`events: ${r.slug}: ${error.message}`)
      if (!data?.id) throw new Error(`events: ${r.slug}: insert returned no row id`)
      idOf.set(r.slug, data.id)
    }
    made++
  }

  await projectEventComments(db, wanted)

  /* an event no file declares any more */
  for (const e of had) {
    if (wanted.some((r) => r.slug === e.slug)) continue
    const { error } = await db.from('calendar_events').delete().eq('id', e.id)
    if (error) throw new Error(`events: could not remove ${e.slug}: ${error.message}`)
    gone++
  }

  /* the occurrences: what the rule makes now, against what is there */
  const from = Date.now()
  for (const e of (events || []).filter((x) => x.published !== false)) {
    const id = idOf.get(e.slug)
    if (!id) continue
    const want = occurrencesOf(e, { from, days })
    const wantAt = new Set(want.map((o) => o.starts_at))
    const { data: has, error: hasError } = await db.from('calendar_occurrences').select('id, starts_at, cancelled_at, note').eq('event_id', id)
    if (hasError) throw new Error(`events: ${e.slug}: could not read occurrences: ${hasError.message}`)
    if (!Array.isArray(has)) throw new Error(`events: ${e.slug}: could not read occurrences: expected a row list`)
    const hasAt = new Map(has.map((o) => [new Date(o.starts_at).toISOString(), o]))
    const fresh = want.filter((o) => !hasAt.has(o.starts_at)).map((o) => ({ event_id: id, starts_at: o.starts_at, ends_at: o.ends_at }))
    for (let i = 0; i < fresh.length; i += 500) {
      const { error } = await db.from('calendar_occurrences').insert(fresh.slice(i, i + 500))
      if (error) throw new Error(`events: ${e.slug}: could not add occurrences: ${error.message}`)
    }
    /* one the rule no longer makes goes — unless somebody is coming to it, or somebody has already
       said something about it by hand */
    const stale = has.filter((o) => !wantAt.has(new Date(o.starts_at).toISOString())
      && new Date(o.starts_at).getTime() > from)
    for (const o of stale) {
      if (o.cancelled_at || o.note) { kept++; continue }
      const { count, error: rsvpError } = await db.from('calendar_rsvps').select('*', { count: 'exact', head: true }).eq('occurrence_id', o.id)
      if (rsvpError) throw new Error(`events: ${e.slug}: could not check RSVPs for occurrence ${o.id}: ${rsvpError.message}`)
      if (count) { kept++; continue }
      const { error } = await db.from('calendar_occurrences').delete().eq('id', o.id)
      if (error) throw new Error(`events: ${e.slug}: could not remove stale occurrence ${o.id}: ${error.message}`)
    }
  }

  const { count: total, error: totalError } = await db.from('calendar_occurrences').select('*', { count: 'exact', head: true })
  if (totalError) throw new Error(`events: could not count occurrences: ${totalError.message}`)
  log(`events: ${made} on${gone ? `, ${gone} gone` : ''}, ${total} occurrence(s) within a year${kept ? `, ${kept} kept that the rule no longer makes` : ''}`)
  return { pushed: made, gone, occurrences: total }
}
