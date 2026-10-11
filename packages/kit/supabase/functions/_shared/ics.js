/*
 * A calendar invitation, made whole: one VEVENT as iCalendar (RFC 5545) — the uid, the times in UTC,
 * the summary, the description, the location, the organizer and the attendees, METHOD:REQUEST for a
 * booking or a move (SEQUENCE counting the moves) and METHOD:CANCEL for a cancellation. Pure, no
 * imports, no environment; the kit's test pins it. Lines are folded at 75 octets and text is
 * escaped as the standard says, so a place with a comma in its address lands as written.
 */
const pad = (n) => String(n).padStart(2, '0')
export const stamp = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z` }
export const escapeText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
/* a content line folded at 75 octets, the continuation lines beginning with a space */
export function fold(line) {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out = []; let i = 0
  while (i < bytes.length) {
    let n = Math.min(i === 0 ? 75 : 74, bytes.length - i)
    while (n > 1 && (bytes[i + n] & 0xc0) === 0x80) n--   /* never split a character */
    out.push((i === 0 ? '' : ' ') + new TextDecoder().decode(bytes.slice(i, i + n))); i += n
  }
  return out.join('\r\n')
}
/*
 * ics({ uid, start, end, summary, description, location, url, organizer: { name, email }, attendees: [{ name, email }],
 *       method: 'REQUEST' | 'CANCEL', sequence, now, product })
 */
export function ics(o) {
  const method = o.method === 'CANCEL' ? 'CANCEL' : 'REQUEST'
  const now = o.now ?? Date.now()
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${o.product || 'PlatformKit'}//EN`, 'CALSCALE:GREGORIAN', `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${o.uid}`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(Date.parse(o.start))}`, `DTEND:${stamp(Date.parse(o.end))}`,
    `SEQUENCE:${Math.max(0, Number(o.sequence) || 0)}`, `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    `SUMMARY:${escapeText(o.summary)}`,
  ]
  if (o.description) lines.push(`DESCRIPTION:${escapeText(o.description)}`)
  if (o.location) lines.push(`LOCATION:${escapeText(o.location)}`)
  if (o.url) lines.push(`URL:${o.url}`)
  if (o.organizer?.email) lines.push(`ORGANIZER;CN=${escapeText(o.organizer.name || o.organizer.email)}:mailto:${o.organizer.email}`)
  for (const a of o.attendees || []) if (a?.email) lines.push(`ATTENDEE;CN=${escapeText(a.name || a.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=${method === 'CANCEL' ? 'DECLINED' : 'ACCEPTED'}:mailto:${a.email}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
