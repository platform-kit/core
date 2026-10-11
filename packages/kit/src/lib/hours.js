/*
 * A host's hours, from the client: what the Coaching tab's "Your hours" panel reads and writes,
 * through the coach-hours function (the one place the shape is checked). A host is any account
 * that gives appointments — an administrator today. The week is `{ '1': [['09:00','12:00']], … }`
 * (ISO weekday → ranges, in the host's zone); an exception is a day off (ranges null) or a day's
 * ranges instead of the week's — and an exception belongs to the set of hours it was written on,
 * because a day off from the evenings is not a day off from the mornings.
 */
import { supabase } from './supabase.js'

async function call(body) {
  const { data, error } = await supabase.functions.invoke('coach-hours', { body })
  if (error) { let msg = error.message || 'request failed', code = ''; try { const j = await error.context.json(); if (j && j.error) { msg = j.error; code = j.code || '' } } catch (e) { /* no body */ } const e = new Error(msg); e.code = code; throw e }
  if (data && data.error) { const e = new Error(data.error); e.code = data.code || ''; throw e }
  return data
}
/* A HOST KEEPS ANY NUMBER OF NAMED SETS, one theirs by default. Every call may name one; a call
   that names none means the default, which is what every call meant before there was more than one. */
export const getHours = () => call({ action: 'get' })
export const setHours = (hours, schedule) => call({ action: 'set', hours, schedule })
export const makeDefault = (schedule) => call({ action: 'default', schedule })
export const forgetHours = (schedule) => call({ action: 'forget', schedule })
export const setOverride = (day, ranges, note, schedule) => call({ action: 'override', day, ranges, note: note || '', schedule })
export const removeOverride = (day, schedule) => call({ action: 'unoverride', day, schedule })
/* the zones the browser knows, the reader's first */
export function zones() {
  let list = []
  try { list = Intl.supportedValuesOf('timeZone') } catch (e) { list = ['UTC'] }
  const mine = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch (e) { return 'UTC' } })()
  return { list, mine }
}
export const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7']
export const emptyHours = () => ({ name: 'Working hours', timezone: zones().mine, weekly: {}, buffer_before: 0, buffer_after: 0, notice_hours: 24, max_per_day: 0, max_per_week: 0 })

/*
 * AWAY — the stretches somebody is not available for, theirs to keep. Rows rather than a function,
 * because they are the person's own and RLS already says so; the cover is chosen from the people
 * who give appointments, which the desk's own read answers.
 */
export async function getAway() {
  const { data, error } = await supabase.from('provider_ooo').select('id, from, to, reason, cover_id').order('from')
  if (error) throw error
  return data || []
}
export async function addAway({ from, to, reason, cover }) {
  const { data: me } = await supabase.auth.getUser()
  const uid = me?.user?.id
  if (!uid) throw new Error('sign in first')
  const { error } = await supabase.from('provider_ooo').insert({ user_id: uid, from, to, reason: reason || null, cover_id: cover || null })
  if (error) throw error
  return getAway()
}
export async function removeAway(id) {
  const { error } = await supabase.from('provider_ooo').delete().eq('id', id)
  if (error) throw error
  return getAway()
}
/* who could cover: the other people who give appointments, by the name they show */
export async function coverChoices() {
  const { data, error } = await supabase.rpc('cover_choices')
  if (error || !Array.isArray(data)) return []
  return data.map((p) => ({ id: p.id, name: p.name || '' }))
}
