/*
 * The schedulers, one module each behind one shape, shared by the functions (Deno) and the kit's
 * tests (node) — plain JavaScript. `schedulers({ db, env })` binds them and gives:
 *
 *   SCHEDULERS         { native, cal } — every scheduler known
 *   scheduler(id)      one of them, or a throw naming the id
 *   schedulerOf(type)  the one a booking type names: its `scheduler`, else cal.com when it carries
 *                      a cal.com url, else the site's own
 *
 * A scheduler:
 *   id, configured(), mock()
 *   slots(type, from, to, timeZone)                       → { slots: { day: [iso…] }, minutes }
 *   book(type, { start, attendee, user_id, notes, phone, credit_id }) → a booking (the site's shape for native; cal.com's for cal)
 *   reschedule(uid, start, by, reason)   cancel(uid, by, reason)
 *
 * The judge, the credits, the week of chat and the mirror are the site's own (../sessions.ts) and
 * live in front of every scheduler alike.
 */
import { cal } from './cal.js'
import { native } from './native.js'

export const SCHEDULER_IDS = ['native', 'cal']
export const schedulerIdOf = (type) => (type?.scheduler === 'native' || type?.scheduler === 'cal' ? type.scheduler : type?.url || type?.username ? 'cal' : 'native')

export function schedulers({ db, env }) {
  const SCHEDULERS = { native: native({ db, env }), cal: cal(env) }
  const scheduler = (id) => { const s = SCHEDULERS[id]; if (!s) throw new Error('no scheduler named ' + id); return s }
  const schedulerOf = (type) => scheduler(schedulerIdOf(type))
  return { SCHEDULERS, scheduler, schedulerOf }
}
