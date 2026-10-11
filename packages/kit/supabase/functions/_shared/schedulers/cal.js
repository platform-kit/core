/*
 * cal.com as a scheduler: the app books, moves and cancels through cal.com's API, so its public
 * booking pages are not part of the flow (hide the event types there) and a booking exists only
 * because the app decided it should. The scheduling stays cal.com's — availability, buffers, the
 * host a round-robin picks, the invites and the video link — we replace the page, not the engine.
 * Plain JavaScript on fetch alone, bound to an environment (`env(k)` → a string): `CAL_API_KEY`
 * is the key, and without one every call throws. `base` on the recordings names another API —
 * the service bearer's, for a test's stand-in of cal.com — and is never a caller's otherwise.
 */
const DEFAULT_API = 'https://api.cal.com/v2'

export function cal(env) {
  /* the base is cal.com's unless CAL_API_BASE says another — a site's own Scheduling API (scheduling-api), for one: the
     same client, pointed at the site, books on the native calendar (the closed loop the test runs) */
  const API = (env('CAL_API_BASE') || DEFAULT_API).replace(/\/+$/, '')
  const KEY = () => { const k = env('CAL_API_KEY') || ''; if (!k) throw new Error('CAL_API_KEY is unset'); return k }
  async function call(path, version, init = {}, base = API) {
    const res = await fetch(base + path, { ...init, headers: { Authorization: `Bearer ${KEY()}`, 'cal-api-version': version, 'Content-Type': 'application/json', ...(init.headers || {}) } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { const msg = body?.error?.message ?? body?.message ?? res.status; throw Object.assign(new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)), { status: res.status, body }) }
    return body?.data ?? body
  }
  /* event type ids, by slug, looked up once per username and kept for the life of the instance */
  const ids = new Map()
  const eventTypes = (username) => {
    if (!ids.has(username)) ids.set(username, call(`/event-types?username=${encodeURIComponent(username)}`, '2024-06-14').then((list) =>
      Object.fromEntries((list || []).map((e) => [e.slug, { id: e.id, minutes: e.lengthInMinutes, price: e.price || 0 }]))))
    return ids.get(username)
  }
  const eventTypeOf = async (s) => {
    const t = (await eventTypes(s.username))[s.event]
    if (!t) throw new Error(`cal.com has no event type "${s.event}" under ${s.username}`)
    return t
  }
  return {
    id: 'cal',
    configured: () => !!env('CAL_API_KEY'),
    mock: () => false,
    call, eventTypes, eventTypeOf,
    /* the open times of a type between two days, in a zone: { slots: { 'YYYY-MM-DD': [iso…] }, minutes } */
    /* `who` is the site's own idea: cal.com decides which host a round robin goes to, so it is ignored here */
    async slots(s, from, to, timeZone, who = null) {
      const t = await eventTypeOf(s)
      const data = await call(`/slots?eventTypeId=${t.id}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}&timeZone=${encodeURIComponent(timeZone)}`, '2024-09-04')
      const out = {}
      for (const [day, list] of Object.entries(data || {})) out[day] = list.map((x) => x.start)
      return { slots: out, minutes: t.minutes }
    },
    /* a booking made as the reader; cal.com sends the invites and makes the room. Answers cal.com's booking. */
    async book(s, { start, attendee, user_id, notes, stripe_checkout_session_id }) {
      const t = await eventTypeOf(s)
      return await call('/bookings', '2024-08-13', { method: 'POST', body: JSON.stringify({
        start, eventTypeId: t.id,
        attendee: { name: attendee.name || attendee.email, email: attendee.email, timeZone: attendee.timeZone, language: 'en' },
        metadata: { user_id, app: 'platformkit', ...(stripe_checkout_session_id ? { stripe_checkout_session_id } : {}) },
        ...(notes ? { bookingFieldsResponses: { notes } } : {}),
      }) })
    },
    /* moved by the attendee: cal.com wants their email as who moved it */
    reschedule: (uid, start, by, reason) => call(`/bookings/${encodeURIComponent(uid)}/reschedule`, '2024-08-13', { method: 'POST', body: JSON.stringify({ start, reschedulingReason: reason, rescheduledBy: by }) }),
    cancel: (uid, _by, reason) => call(`/bookings/${encodeURIComponent(uid)}/cancel`, '2024-08-13', { method: 'POST', body: JSON.stringify({ cancellationReason: reason }) }),
    /* what a Cal Video call left: the booking's recordings and transcripts, each answered with a fresh download
       link (the webhook's own link expires within the hour, so a pull asks here and never trusts the payload's).
       A booking on another provider — Zoom, Meet — answers an empty list. The shapes are cal.com's published
       OpenAPI: recordings `{ id, roomName, startTs, status, maxParticipants, duration, shareToken, downloadLink | null }`,
       transcripts an array of urls. */
    async recordingsOf(uid, base) {
      const list = await call(`/bookings/${encodeURIComponent(uid)}/recordings`, '2024-08-13', {}, base || API)
      /* a recording still processing has no link yet and is not one to pull */
      return (Array.isArray(list) ? list : []).map((r) => ({ id: r.id, url: r.downloadLink ?? '', startTs: Number(r.startTs ?? 0), duration: Number(r.duration ?? 0), status: String(r.status ?? '') })).filter((r) => r.url)
    },
    async transcriptsOf(uid, base) {
      const list = await call(`/bookings/${encodeURIComponent(uid)}/transcripts`, '2024-08-13', {}, base || API).catch((e) => { if (e?.status === 404) return []; throw e })
      const rows = Array.isArray(list) ? list : []
      return rows.map((t) => (typeof t === 'string' ? { format: '', url: t } : { format: String(t?.format ?? ''), url: String(t?.link ?? t?.url ?? '') })).filter((t) => t.url)
    },
  }
}
