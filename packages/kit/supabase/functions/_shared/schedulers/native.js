/*
 * The site's own scheduler: a host's sets of hours (provider_schedules, provider_overrides) less their bookings are
 * the open times; a booking is a row of `bookings` from the moment it is made, with the site's own
 * uid, and a time is never booked twice — the exclusion constraint on (host, time) refuses the
 * second of two inserts in the same second (`23P01`, answered `taken`), and a group session's seats
 * are counted under an advisory lock on the time. Plain JavaScript, bound to a database client
 * (supabase-js with the service role) and an environment; the arithmetic is ./times.js.
 *
 *   slots(type, from, to, timeZone)   → { slots: { 'YYYY-MM-DD': [iso…] }, minutes }
 *   book(type, { start, attendee, user_id, notes, phone }) → the normalised booking
 *   reschedule(uid, start, by)        by: 'reader' | 'host'  — the notice is the reader's rule alone
 *   cancel(uid, by, reason)
 *
 * The normalised booking is `{ uid, start_at, end_at, title, type, host_id, where, join_url, raw }`.
 */
import { byDay, offer, share, overLimit, runTimes } from './times.js'
import { waitsForYes, lengthChosen, nameOf } from '../sessions/page.js'
import { occurrences, problems as repeatProblems } from '../recurrence.js'

/* the grid a type sits on when it does not say: a quarter of an hour, which is what everybody
   expects of a calendar that has not been told otherwise */
const STEP = 15
const hex = () => { const b = new Uint8Array(8); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') }

export function native({ db, env }) {
  /*
   * A TYPE'S HOSTS — the accounts it names by email, or, where it names none, THE MEMBERS OF ITS
   * TEAM, asked for at the time. A team's membership is rows, so this is the only honest way to
   * read it: a file listing the members would be a file naming people, and would be wrong the day
   * somebody joined.
   *
   * Each host carries how the rota treats them (priority, weight, whether they come to every
   * booking) — the type's `rota` where it says, the ordinary terms where it does not. A host the
   * type names who has no account is simply not a host: there is nobody to book.
   */
  async function hostsOf(type) {
    let emails = (type.hosts || []).map((e) => String(e).toLowerCase()).filter(Boolean)
    let rows = null
    if (!emails.length && type.team) {
      const { data } = await db.from('team_members').select('user_id, profiles!inner(id, email, display_name)').eq('team', type.team)
      rows = (data || []).map((m) => m.profiles).filter(Boolean)
    } else if (emails.length) {
      const { data } = await db.from('profiles').select('id, email, display_name').in('email', emails)
      rows = data || []
    }
    if (!rows) return []
    const rota = Object.fromEntries((type.rota || []).map((r) => [String(r.email || '').toLowerCase(), r]))
    const out = rows.map((p) => {
      const email = String(p.email || '').toLowerCase()
      const r = rota[email] || {}
      return { id: p.id, email, name: p.display_name || '', priority: r.priority == null ? 2 : Number(r.priority), weight: r.weight == null ? 100 : Number(r.weight), fixed: !!r.fixed }
    })
    /* the file's order, so a rota that ends level is at least stable between requests */
    if (emails.length) out.sort((x, y) => emails.indexOf(x.email) - emails.indexOf(y.email))
    else out.sort((x, y) => (x.email < y.email ? -1 : 1))
    return out
  }
  /* WHAT THE ROTA KNOWS about each host for this type: how many CONFIRMED bookings they have taken
     and when the latest was. A cancelled or refused booking leaves their turn where it was, which is
     why the status is asked for here and nowhere else. */
  async function rotaOf(type, hosts) {
    const state = {}
    for (const h of hosts) state[h.id] = { count: 0, last: undefined, credit: 0 }
    if (!hosts.length) return state
    const { data } = await db.from('bookings').select('host_id, start_at')
      .in('host_id', hosts.map((h) => h.id)).eq('type', type.slug).eq('status', 'accepted')
      .order('start_at', { ascending: false })
    for (const b of data || []) {
      const s = state[b.host_id]
      if (!s) continue
      s.count += 1
      if (s.last === undefined) s.last = Date.parse(b.start_at)
    }
    return state
  }
  /* WHICH SET OF HOURS THIS TYPE USES. A host keeps any number of named sets, one theirs by default,
     and a type may ask for one by name — falling back to their default where they keep no set of
     that name, because a type naming hours somebody does not keep should offer their ordinary times
     rather than nothing at all.

     Where they keep none, the TYPE may say when it is bookable (content/sessions/*.md `hours`), so a
     site deployed from its folder offers times on the first day instead of an empty calendar until
     somebody opens the Coaching tab. It is a default and never a cap: the moment a host sets their
     own, theirs is the only answer. */
  async function hoursOf(hostId, type) {
    const wanted = type && type.schedule ? String(type.schedule).trim().toLowerCase() : ''
    const { data: sets } = await db.from('provider_schedules')
      .select('id, name, is_default, timezone, weekly, buffer_before, buffer_after, notice_hours, max_per_day, max_per_week')
      .eq('user_id', hostId)
    const all = sets || []
    const h = (wanted && all.find((s) => String(s.name || '').trim().toLowerCase() === wanted))
      || all.find((s) => s.is_default) || all[0]
    if (h) {
      /* a date override belongs to the set it was written on; one written before there was more than
         one set has no set, and belongs to the default */
      const { data: o } = await db.from('provider_overrides').select('day, ranges, schedule_id').eq('user_id', hostId)
      const mine = (o || []).filter((x) => x.schedule_id === h.id || (!x.schedule_id && h.is_default))
      return { ...h, overrides: mine }
    }
    const d = type && type.hours
    if (!d || !d.weekly || !Object.keys(d.weekly).length) return null
    return {
      timezone: d.timezone || 'UTC', weekly: d.weekly, overrides: [],
      buffer_before: Number(type.bufferBefore ?? type.buffer) || 0,
      buffer_after: Number(type.bufferAfter ?? type.buffer) || 0,
      notice_hours: Number(type.notice) || 24, max_per_day: 0, max_per_week: 0,
    }
  }
  /* THE TIMES A HOST CANNOT TAKE, read from the holds rather than from their bookings: a hold is one
     person's time taken by one booking, so a collective session blocks every host it names and a
     group session blocks its host once. A group time of THIS type with a seat free is not busy for
     this type — the seats are what is counted there, not the hour. */
  async function busyOf(hostId, type, from, to) {
    const { data } = await db.from('booking_holds')
      .select('booking_uid, start_at, end_at, bookings!inner(type, seat_of, status)')
      .eq('user_id', hostId)
      .gte('end_at', from + 'T00:00:00Z').lte('start_at', to + 'T23:59:59Z')
    const rows = data || []
    const out = []
    for (const h of rows) {
      const b = h.bookings || {}
      if (!['accepted', 'pending'].includes(b.status)) continue
      /* this type's own group time, with room left: the seat count decides, not the hold */
      if (type.seats > 0 && b.type === type.slug) {
        const { count } = await db.from('bookings').select('uid', { count: 'exact', head: true })
          .eq('type', type.slug).eq('start_at', h.start_at).in('status', ['accepted', 'pending'])
        if ((count || 0) < type.seats) continue
      }
      out.push({ start: Date.parse(h.start_at), end: Date.parse(h.end_at) })
    }
    return out
  }
  /*
   * WHAT THE TYPE OFFERS between two days — everything the scheduler fetches, handed to one pure
   * function (offer() in times.js), which is where the rules actually live. The booker, the API and
   * the booking itself all come through here, so they cannot disagree about what is open.
   */
  async function offerOf(type, from, to, now, span) {
    const hosts = await hostsOf(type)
    if (!hosts.length) return { hosts: [], slots: [] }
    const each = []
    for (const h of hosts) {
      const hours = await hoursOf(h.id, type)
      if (!hours) continue
      each.push({ id: h.id, hours, busy: await busyOf(h.id, type, from, to), away: await awayOf(h.id, from, to), priority: h.priority, weight: h.weight })
    }
    /*
     * A COVER TAKES WHAT WOULD HAVE BEEN THEIRS. Where somebody away named one, the cover's own
     * times stand in for the days they are gone — so a reader is not turned away from a practice
     * that has somebody free. Only for those days, and only where the cover is not already a host
     * of the type, whose times are offered anyway.
     */
    const covering = []
    for (const h of hosts) {
      const mine2 = each.find((x) => x.id === h.id)
      for (const a2 of (mine2 && mine2.away) || []) {
        if (!a2.cover_id || hosts.some((x) => x.id === a2.cover_id)) continue
        const hrs = await hoursOf(a2.cover_id, type)
        if (!hrs) continue
        const only = new Set(daysBetween(a2.from, a2.to))
        const starts = { ...hrs }
        covering.push({
          id: a2.cover_id, hours: starts, busy: await busyOf(a2.cover_id, type, from, to),
          /* the mirror of away: the cover is available on THESE days and no others */
          away: awayExcept(from, to, only),
          priority: 0, weight: 100,
        })
      }
    }
    for (const c of covering) if (!each.some((x) => x.id === c.id)) each.push(c)
    /* AND A HOST FOR THOSE DAYS, not merely a set of times. The rota picks from the hosts; a cover
       whose hours are offered but who is not among them means the booking goes to the person who is
       away, and is refused because their hour is gone. They come LAST in the file's order and at
       the lowest priority, so they are the one taken only when nobody else can. */
    for (const c of covering) if (!hosts.some((h) => h.id === c.id)) {
      const { data: p } = await db.from('profiles').select('id, email, display_name').eq('id', c.id).maybeSingle()
      if (p) hosts.push({ id: p.id, email: String(p.email || '').toLowerCase(), name: p.display_name || '', priority: 0, weight: 100, fixed: false })
    }
    /* what the TYPE already holds, for its own limits — every host's, since a limit is the type's */
    let taken = []
    if (type.limits && Object.values(type.limits).some((v) => Number(v) > 0)) {
      const { data } = await db.from('bookings').select('start_at, end_at').eq('type', type.slug).eq('status', 'accepted')
        .gte('start_at', from + 'T00:00:00Z').lte('start_at', to + 'T23:59:59Z')
      taken = (data || []).map((b) => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) }))
    }
    const shaped = {
      duration: type.duration, step: type.interval || STEP, offset: type.offset,
      bufferBefore: type.bufferBefore ?? type.buffer, bufferAfter: type.bufferAfter ?? type.buffer, notice: type.notice,
      assign: type.assign, fixed: hosts.filter((h) => h.fixed).map((h) => h.id),
      windowDays: type.windowDays, windowFrom: type.windowFrom, windowTo: type.windowTo, limits: type.limits,
    }
    return { hosts, each, slots: offer({ type: shaped, hosts: each, taken, from, to, now, ...(span ? { span } : {}) }) }
  }
  /* IS THE WINDOW SHUT OVER THESE DAYS — and which way, because "not yet" and "no longer" are
     opposite instructions to somebody looking at a calendar. */
  function windowShut(type, from, to) {
    if (type.windowFrom && to < type.windowFrom) return { kind: 'not-yet', from: type.windowFrom }
    if (type.windowTo && from > type.windowTo) return { kind: 'closed', to: type.windowTo }
    if (Number(type.windowDays) > 0) {
      const last = new Date(Date.now() + Number(type.windowDays) * 864e5).toISOString().slice(0, 10)
      if (from > last) return { kind: 'too-far', to: last }
    }
    return null
  }
  /* the days of a stretch, inclusive */
  const daysBetween = (from, to) => { const out = []; let t = Date.parse(from + 'T12:00:00Z'); const end = Date.parse(to + 'T12:00:00Z'); while (t <= end && out.length < 400) { out.push(new Date(t).toISOString().slice(0, 10)); t += 864e5 } return out }
  /* THE MIRROR OF AWAY: a cover stands in on the days somebody is gone and on no others, and "away
     on every other day" is how that is said to a function whose only idea is being away. */
  const awayExcept = (from, to, only) => {
    const out = []
    let run = null
    for (const d2 of daysBetween(from, to)) {
      if (only.has(d2)) { if (run) { out.push(run); run = null } continue }
      if (!run) run = { from: d2, to: d2 }
      else run.to = d2
    }
    if (run) out.push(run)
    return out
  }
  /* THE DAYS A HOST IS AWAY that fall in the window asked for. A stretch overlapping the window at
     all is taken whole: the filter works in days, so a partial overlap is still those days. */
  async function awayOf(hostId, from, to) {
    const { data } = await db.from('provider_ooo').select('from, to, cover_id').eq('user_id', hostId).lte('from', to).gte('to', from)
    return data || []
  }
  /* WHAT THE TYPE ALREADY HOLDS around a day, wide enough for its widest cap — the year's, so the
     answer is the same one offer() computed rather than a second, narrower count. */
  async function heldOf(type, day) {
    const L = type.limits || {}
    if (!Object.values(L).some((v) => Number(v) > 0)) return []
    const wide = L.year ? 366 : L.month ? 62 : L.week || L.minutesWeek ? 14 : 2
    const from = new Date(Date.parse(day + 'T00:00:00Z') - wide * 432e5).toISOString()
    const to = new Date(Date.parse(day + 'T00:00:00Z') + wide * 432e5).toISOString()
    const { data } = await db.from('bookings').select('start_at, end_at').eq('type', type.slug).eq('status', 'accepted').gte('start_at', from).lte('start_at', to)
    return (data || []).map((b) => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) }))
  }
  /* WHOSE TURN IT IS at a time: the hosts free then, down cal.com's ladder (share() in times.js).
     For a COLLECTIVE type nobody takes a turn — everybody comes — so it answers every free host. */
  async function pickHosts(type, startMs, hosts, slots, state) {
    const at = slots.find((s) => s.start === startMs)
    if (!at) return []
    if (String(type.assign) === 'collective') return hosts.filter((h) => at.hosts.includes(h.id))
    /* somebody at every booking comes whoever takes it */
    const always = hosts.filter((h) => h.fixed && at.hosts.includes(h.id))
    const rota = hosts.filter((h) => !h.fixed)
    const took = rota.length ? share(rota, state, at.hosts) : null
    return took ? [took, ...always.filter((h) => h.id !== took.id)] : always
  }
  const whereOf = (type, phone) => {
    const w = type.where || { kind: 'none' }
    if (w.kind === 'phone' && !w.number && phone) return { kind: 'phone', number: phone, theirs: true }
    return w
  }
  const joinOf = (where) => (where.kind === 'link' && where.url ? where.url : null)
  const row = (b) => ({ uid: b.uid, start_at: b.start_at, end_at: b.end_at, title: b.title, type: b.type, host_id: b.host_id, where: b.where, join_url: b.join_url, status: b.status, raw: b })

  return {
    id: 'native',
    configured: () => true,
    mock: () => false,
    hostsOf, hoursOf,
    /*
     * WHEN A BOOKING TYPE HAPPENS AT A FIXED TIME.
     *
     * Two kinds of thing are booked, and they are not the same. Most are "whenever suits us": the
     * host's open hours less what is taken, and the reader picks. But a weekly group call happens
     * at seven on Tuesday whether anybody books or not, and offering it as an open calendar is
     * both wrong and a lot of empty slots.
     *
     * So a type may say `repeats:` in its own markdown, in the same grammar as everything else
     * that recurs here, and then ITS OCCURRENCES ARE ITS SLOTS — the host's hours are not asked,
     * because the time is the point. A host who is busy cancels the occurrence; they do not
     * quietly make it unbookable.
     */
    async slots(type, from, to, timeZone, who = null, minutes = 0, count = 0) {
      const now = Date.now()
      /* how many sessions the run is: what they asked for, within what the type allows */
      const runs = type && type.repeat ? Math.min(Math.max(1, Number(count) || type.repeat.count), type.repeat.most || type.repeat.count) : 1
      if (type && type.repeats) {
        const a = Math.max(Date.parse(from) || now, now)
        const b = Date.parse(to) || (a + 60 * 86400e3)
        const on = occurrences(type.repeats, { from: a, to: b, limit: 200 }).map((o) => o.start)
        /* a fixed time that is already full is not offered: a one-to-one has one seat, a group
           has as many as the type says */
        const seats = Math.max(1, Number(type.seats) || 1)
        const open = []
        /* HOW MANY SEATS ARE LEFT AT EACH TIME, where the type says to show it — a nudge and a
           warning at once, and some hosts want neither. It is counted here because it is the same
           count that decides whether the time is offered at all; asking twice would be two answers
           that can differ. */
        const show = ((type.page || {}).seatsLeft === true) && seats > 1
        const left = {}
        for (const start of on) {
          const { count } = await db.from('bookings')
            .select('uid', { count: 'exact', head: true })
            .eq('event', type.slug).eq('start_at', new Date(start).toISOString())
            .in('status', ['accepted', 'pending'])
          if ((count || 0) < seats) { open.push(start); if (show) left[new Date(start).toISOString()] = seats - (count || 0) }
        }
        return { slots: byDay(open, timeZone), minutes: type.duration, ...(show ? { left } : {}) }
      }
      /* AT THE LENGTH THEY ARE CHOOSING, since a ninety-minute session fits in fewer places than
         an hour does and showing the hour's times would offer what cannot be booked */
      const { hosts, each, slots } = await offerOf(minutes ? { ...type, duration: lengthChosen(type, minutes).minutes } : type, from, to, now)
      /* narrowed to ONE host where the caller asked for one: the times THEY are free at, which is
         what a host booking for somebody needs — the ordinary answer is the union, and a time only
         a colleague keeps is no use to them */
      /* A HOST NOBODY RECOGNISES HAS NO TIMES. Falling back to the union would answer a question
         about one person with an answer about everybody — and a host booking for somebody would be
         shown hours that are not theirs to give. */
      const only = who ? (hosts.find((h) => h.id === who || h.email === String(who).toLowerCase()) || {}).id || 'nobody' : null
      const mine = only ? slots.filter((s) => s.hosts.includes(only)) : slots
      /* HOW MANY SEATS ARE LEFT at each time, where the type says to show it. A group whose times
         come from the hosts' hours needs the same count the fixed-time one gives: what is offered
         is not what is left, and "2 left" is the whole reason a host turns this on. */
      /* A RUN IS OFFERED ONLY WHERE EVERY ONE OF ITS SESSIONS IS FREE. Offering the first and
         finding out at the sixth that the host is away is the worst way to learn it — so the whole
         run is checked here, over a window wide enough to hold it, and a start whose run does not
         fit is simply not shown. */
      let runnable = mine
      if (type.repeat && runs > 1) {
        const zone = (each[0] && each[0].hours && each[0].hours.timezone) || timeZone || 'UTC'
        const last = runTimes(Date.parse(to + 'T23:59:59Z'), { count: runs, every: type.repeat.every }, zone).pop()
        /* AS MANY DAYS AS THE RUN ACTUALLY SPANS. openStarts caps a window at two months, which is
           a fence against an unbounded scan and not a rule about how far ahead anything may be —
           and a run of six weekly sessions asked for from the first of a month is longer than it. */
        const until = new Date(last + 864e5).toISOString().slice(0, 10)
        const wideSpan = Math.ceil((Date.parse(until + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 864e5) + 2
        const wide = await offerOf(type, from, until, now, wideSpan)
        const free = new Set(wide.slots.map((s) => s.start))
        runnable = mine.filter((s) => runTimes(s.start, { count: runs, every: type.repeat.every }, zone).every((x) => free.has(x)))
      }
      const seatsAt = {}
      if (((type.page || {}).seatsLeft === true) && type.seats > 1 && runnable.length) {
        const { data: taken } = await db.from('bookings').select('start_at')
          .eq('type', type.slug).in('status', ['accepted', 'pending'])
          .gte('start_at', from + 'T00:00:00Z').lte('start_at', to + 'T23:59:59Z')
        const by = {}
        for (const b2 of taken || []) { const k = new Date(b2.start_at).toISOString(); by[k] = (by[k] || 0) + 1 }
        for (const s of runnable) { const k = new Date(s.start).toISOString(); seatsAt[k] = Math.max(0, type.seats - (by[k] || 0)) }
      }
      /* WHY A MONTH IS EMPTY, where it is. An empty calendar with no word is the worst answer a
         booking page can give — it looks broken, and the reader's next move depends entirely on
         which of these it is: turn the page, come back later, or write and ask. */
      let why = null
      if (!runnable.length) {
        const shut = windowShut(type, from, to)
        if (shut) why = shut
        else if (!hosts.length) why = { kind: 'no-hosts' }
        else if (!each.length) why = { kind: 'no-hours' }
        else why = { kind: type.assign === 'collective' && hosts.length > 1 ? 'no-shared-hours' : 'full' }
      }
      return { slots: byDay(runnable.map((s) => s.start), timeZone), minutes: type.duration, ...(type.repeat ? { run: runs } : {}), ...(Object.keys(seatsAt).length ? { left: seatsAt } : {}), ...(why ? { why } : {}) }
    },
    /* attendees: every address on the booking (the first the row's own); made_by: a host booking for them; host: the host asked for, when among the type's */
    async book(type, { start, attendee, attendees, user_id, notes, phone, credit_id, made_by, made_by_name, host: wanted, minutes, count, checkout_identity, stripe_checkout_session_id }) {
      const startMs = Date.parse(start)
      const day = new Date(startMs).toISOString().slice(0, 10)
      const { hosts, slots } = await offerOf(type, day, day, Date.now())
      if (!hosts.length) throw Object.assign(new Error('no host'), { code: 'no-host' })
      const named = wanted ? hosts.find((h) => h.id === wanted || h.email === String(wanted).toLowerCase()) : null
      /* WHO IS ON THE BOOKING. A host asked for by name is taken at their word (a host booking for
         somebody); a group session goes to the first host, because its time is the point and the
         seats are shared; otherwise the ladder decides, and a collective type puts everybody on. */
      const taking = named ? [named] : type.seats > 0 ? [hosts[0]] : await pickHosts(type, startMs, hosts, slots, await rotaOf(type, hosts))
      const host = taking[0] || null
      /* A CONFIRMATION THAT ARRIVED A MOMENT TOO LATE deserves to know WHY. A time gone because
         somebody took it and a time gone because the week is full are the same "no" to a reader
         with no reason, and they lead to opposite next moves: try another time, or try next week. */
      if (!host && !named) {
        const over = overLimit(type, startMs, await heldOf(type, day), 'UTC')
        if (over) throw Object.assign(new Error('full'), { code: 'full', span: over.span, limit: over.limit })
      }
      const withHim = taking.slice(1)
      const waits = !made_by && waitsForYes(type, startMs)
      const all = (attendees && attendees.length ? attendees : [attendee]).map((a) => ({ email: String(a.email || '').toLowerCase(), name: a.name || '', user_id: a.user_id || null })).filter((a) => a.email)
      const first = all[0] || attendee
      if (!host) throw Object.assign(new Error('taken'), { code: 'taken' })
      /* AT THE LENGTH THEY CHOSE, where the type offers several — and its own where it does not, or
         where a length nobody offers was asked for. */
      const chosen = lengthChosen(type, minutes)
      const end = new Date(startMs + chosen.minutes * 6e4).toISOString()
      const where = whereOf(type, phone)
      const uid = 'ns_' + hex()
      const rec = {
        uid, provider: 'native', type: type.slug, event: type.event,
        /* WHAT IT IS CALLED. A type's title is what somebody picks from a list; it is not always
           what belongs in a calendar beside four other things. */
        title: nameOf(type, { reader: first.name || first.email, host: host.name || host.email, length: chosen.minutes }),
        user_id: user_id || first.user_id || null, email: first.email, name: first.name || first.email, attendee_emails: [...new Set(all.map((a) => a.email))],
        ...(made_by ? { made_by, made_by_name: made_by_name || null } : {}),
        host_id: host.id, provider_id: host.id, provider_email: host.email,
        /* A BOOKING THAT WAITS FOR THE HOST'S WORD IS `pending` — and it HOLDS THE TIME from the
           moment it is made, because a time somebody is waiting on is not a time to offer anybody
           else. A host booking for people never waits on themselves. */
        start_at: new Date(startMs).toISOString(), end_at: end, status: waits ? 'pending' : 'accepted', where, join_url: joinOf(where),
        followup_at: new Date(Date.parse(end) + 5 * 6e4).toISOString(),
        ...(checkout_identity ? { checkout_identity } : {}),
        ...(stripe_checkout_session_id ? { stripe_checkout_session_id } : {}),
        /* a collective type's OTHER hosts, so the booker, the emails and the room know who is
           coming. The host_id stays one person — somebody owns every booking — and the time is
           taken from all of them by a hold each, which is what makes it collective. */
        payload: { ...(notes ? { notes } : {}), tz: attendee.timeZone || 'UTC', ...(withHim.length ? { co_hosts: withHim.map((h) => ({ id: h.id, email: h.email, name: h.name })) } : {}) }, updated_at: new Date().toISOString(), ...(credit_id ? { credit_id } : {}),
      }
      /* made whole under a lock on the time: a group session's seats counted there, a one-to-one's second insert refused by the constraint */
      const { data, error } = await db.rpc('book_native', { p: rec, p_seats: type.seats > 0 ? type.seats : 0, p_hosts: taking.map((h) => h.id) })
      if (error) throw Object.assign(new Error(error.message), { code: error.code === '23P01' || /full|taken/.test(error.message) ? 'taken' : 'db' })
      /*
       * THE REST OF THE RUN. Every session is its own booking — its own row, its own hold, its own
       * invitation — sharing the first one's uid as `run_of`, so "the run" is one query and moving
       * one can be told from moving all of them.
       *
       * IF ONE CANNOT BE MADE, NONE IS. The calendar only offered this start because the whole run
       * fitted; if something took one of them in between, a reader who asked for six and got four
       * has a worse problem than one who is told to pick again. So the ones already made are undone.
       */
      const runs = type.repeat ? Math.min(Math.max(1, Number(count) || type.repeat.count), type.repeat.most || type.repeat.count) : 1
      if (runs > 1) {
        const zone = (await hoursOf(host.id, type))?.timezone || 'UTC'
        const when = runTimes(startMs, { count: runs, every: type.repeat.every }, zone)
        const made = [data.uid]
        try {
          await db.from('bookings').update({ run_of: data.uid }).eq('uid', data.uid)
          for (const at of when.slice(1)) {
            const r2 = { ...rec, uid: 'ns_' + hex(), run_of: data.uid, checkout_identity: null, stripe_checkout_session_id: null, start_at: new Date(at).toISOString(), end_at: new Date(at + chosen.minutes * 6e4).toISOString(), followup_at: new Date(at + chosen.minutes * 6e4 + 5 * 6e4).toISOString() }
            const { data: d2, error: e2 } = await db.rpc('book_native', { p: r2, p_seats: 0, p_hosts: taking.map((h) => h.id) })
            if (e2) throw Object.assign(new Error(e2.message), { code: 'taken' })
            made.push(d2.uid)
          }
        } catch (e) {
          for (const uid of made) { await db.rpc('booking_release', { p_uid: uid }); await db.from('bookings').delete().eq('uid', uid) }
          throw Object.assign(new Error('one of the run had gone'), { code: 'taken' })
        }
        return { ...row(data), run: made }
      }
      return row(data)
    },
    /* a move keeps the uid, the host, the seat and the credit; the reader's notice is checked by the function */
    async reschedule(uid, start, by) {
      const { data: b } = await db.from('bookings').select('*').eq('uid', uid).maybeSingle()
      if (!b) throw Object.assign(new Error('no such booking'), { code: 'unknown' })
      const dur = Date.parse(b.end_at) - Date.parse(b.start_at)
      const startMs = Date.parse(start), end = new Date(startMs + dur).toISOString()
      /* the holds move first: the constraint is asked about the new time before the row says it is there */
      const moved = await db.rpc('booking_hold_move', { p_uid: uid, p_start: new Date(startMs).toISOString(), p_end: end })
      if (moved.error) throw Object.assign(new Error(moved.error.message), { code: moved.error.code === '23P01' ? 'taken' : 'db' })
      const { data, error } = await db.from('bookings').update({ start_at: new Date(startMs).toISOString(), end_at: end, followup_at: new Date(Date.parse(end) + 5 * 6e4).toISOString(), followup_sent_at: null, updated_at: new Date().toISOString(), payload: { ...(b.payload || {}), moved_by: by } }).eq('uid', uid).select().single()
      if (error) throw Object.assign(new Error(error.message), { code: error.code === '23P01' ? 'taken' : 'db' })
      return row(data)
    },
    async cancel(uid, by, reason) {
      const { data, error } = await db.from('bookings').update({ status: 'cancelled', updated_at: new Date().toISOString(), payload: { cancelled_by: by, reason } }).eq('uid', uid).select().single()
      /* and the time it was holding goes back — after the row, so a failed update leaves the hold */
      await db.rpc('booking_release', { p_uid: uid })
      if (error) throw Object.assign(new Error(error.message), { code: 'db' })
      return row(data)
    },
  }
}
