/*
 * WHAT IS ON, as a surface asks for it.
 *
 * Two kinds of thing sit side by side in a community and neither is the other:
 *
 *   an EVENT happens at a time and people come to it — the Tuesday call, the first-Friday sit;
 *   a BOOKING TYPE is a thing somebody books a slot of — an hour with a coach.
 *
 * Circle, Mighty Networks and every community product show both, because the question a member is
 * asking is one question: what is on, and what can I book. So this module answers with one list of
 * each, in one read, and the page draws them as two shelves of the same room.
 *
 * The reads are the database's (events_upcoming, events_mine, event_rsvp). The arithmetic — what
 * "today" and "tomorrow" mean to the person reading, what to call the gap until it starts, whether
 * a thing is on now — is pure, lives in model.js with the rest of the spaces' own, and is pinned by
 * build/calendar.test.mjs; it is re-exported here so a surface has one place to ask.
 */
import { ref, reactive } from 'vue'
import { supabase } from '../supabase.js'
/* the arithmetic lives with the rest of the spaces' own, where a test can read it without a browser */
export { whenWord, clockOf, untilWord, isOn, byDay, dayOf } from './model.js'

/* ------------------------------------------------------------------ the reads */

export const calendar = reactive({ upcoming: [], mine: [], loading: false, error: null })
export const calendarOn = ref(false)

export async function loadCalendar(spaceId = null, { days = 60, limit = 50 } = {}) {
  if (!supabase) return []
  calendar.loading = true
  try {
    const { data, error } = await supabase.rpc('events_upcoming', { p_space: spaceId, p_days: days, p_limit: limit })
    if (error) throw error
    calendar.upcoming = data || []
    calendarOn.value = true
    return calendar.upcoming
  } catch (e) {
    /* a site with the events module off has no such function, and that is not an error to show */
    calendar.upcoming = []
    calendarOn.value = false
    return []
  } finally { calendar.loading = false }
}

export async function loadMine({ days = 90 } = {}) {
  if (!supabase) return []
  try {
    const { data } = await supabase.rpc('events_mine', { p_days: days })
    calendar.mine = data || []
  } catch { calendar.mine = [] }
  return calendar.mine
}

/* say you are coming — and have the list say so at once, since the answer carries the new count */
/* the reason is the file's business (rsvp.reason) and rides on the answer; a call with none never
   wipes one already given */
export async function rsvp(occurrenceId, state = 'going', reason = null, guests = 0) {
  if (!supabase) return { error: 'offline' }
  const { data, error } = await supabase.rpc('event_rsvp', { p_occurrence: occurrenceId, p_state: state, p_guests: guests, p_reason: reason })
  if (error) return { error: error.message }
  if (data && data.ok) {
    const row = calendar.upcoming.find((o) => o.id === occurrenceId)
    if (row) { row.mine = state === 'out' ? null : state; row.going = data.going }
  }
  return data || {}
}

/* ONE EVENT, WHOLE — for its own page: what it is, when it next runs, where, who hosts, who is
   coming and what has been said. One read, because a page asks all of it at once. */
export async function eventPage(slug) {
  if (!supabase || !slug) return null
  const { data, error } = await supabase.rpc('event_page', { p_slug: slug })
  return error ? null : data
}

/* saying something about an event, and taking it back. Comments are on the EVENT rather than on one
   occurrence: a question about a weekly sit is a question about the sit. */
export async function saySomething(eventId, body) {
  if (!supabase || !eventId) return { error: 'offline' }
  const { data, error } = await supabase.rpc('event_say', { p_event: eventId, p_body: String(body || '') })
  return error ? { error: error.message } : data || {}
}
export async function unsay(commentId) {
  if (!supabase || !commentId) return { error: 'offline' }
  const { data, error } = await supabase.rpc('event_unsay', { p_comment: commentId })
  return error ? { error: error.message } : data || {}
}

/* an occurrence called off, or a word about it — the people who keep the space */
export async function setOccurrence(occurrenceId, { cancelled = null, note = null } = {}) {
  if (!supabase) return { error: 'offline' }
  const { data, error } = await supabase.rpc('event_occurrence_set', { p_occurrence: occurrenceId, p_cancelled: cancelled, p_note: note })
  if (error) return { error: error.message }
  return data || {}
}
