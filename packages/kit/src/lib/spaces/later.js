/*
 * WHEN "LATER" IS.
 *
 * The choices a person is offered for sending later, and what each one means as a moment. Pure —
 * given a clock it returns times — so "tomorrow morning" is a test rather than a thing somebody
 * notices is wrong on a Sunday. No imports, no DOM.
 *
 * The rule behind the choices: nobody wants to fill in a date. They want "in an hour", "tomorrow
 * morning", "Monday" — and, rarely, an exact time. Four offers and one field, never a calendar.
 */

const H = 3600e3
const at = (d, hour, minute = 0) => { const x = new Date(d); x.setHours(hour, minute, 0, 0); return x }

/*
 * The offers, at this moment. `morning` is nine o'clock — tomorrow's, unless it is the small hours
 * and this morning's nine has not happened yet, in which case somebody means today. `monday` is
 * the next one, which on a Monday means the one coming rather than the one an hour ago.
 */
export function offers(now = Date.now(), { morningHour = 9, eveningHour = 18 } = {}) {
  const d = new Date(now)
  const out = [{ key: 'hour', when: new Date(now + H) }]

  const laterToday = at(d, eveningHour)
  if (laterToday.getTime() > now + H) out.push({ key: 'evening', when: laterToday })

  const thisMorning = at(d, morningHour)
  const morning = thisMorning.getTime() > now ? thisMorning : at(new Date(now + 24 * H), morningHour)
  out.push({ key: 'morning', when: morning })

  /* the NEXT Monday: on a Monday that is seven days away, not this morning */
  const monday = new Date(now)
  const days = ((8 - monday.getDay()) % 7) || 7
  out.push({ key: 'monday', when: at(new Date(now + days * 24 * H), morningHour) })

  /* two offers for the same moment is noise: on a Sunday night "tomorrow morning" IS Monday */
  const seen = new Set()
  return out.filter((o) => {
    const t = o.when.getTime()
    if (t <= now || seen.has(t)) return false
    seen.add(t)
    return true
  })
}

/* is this a moment somebody may schedule for: in the future, and not beyond a year */
export const usable = (when, now = Date.now()) => {
  const t = when instanceof Date ? when.getTime() : Date.parse(when)
  return Number.isFinite(t) && t > now && t <= now + 366 * 24 * H
}

/* what a datetime-local field needs, in the reader's own zone rather than UTC */
export function fieldValue(when) {
  const d = when instanceof Date ? when : new Date(when)
  if (isNaN(d)) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
