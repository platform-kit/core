/*
 * A session type (catalog.json's `sessions`, from content/sessions/*.md) as cal.com's event type (API v2, 2024-06-14) —
 * what `GET /v2/event-types` answers and what a booking's `eventType` names. Plain JavaScript, no imports, pinned
 * under Node against cal.com's published shape. The id is a stable positive integer from the slug (FNV-1a, 31 bits),
 * given once and always the same, since cal.com's ids are integers and its clients type them so.
 */
export function eventTypeId(slug) {
  let h = 0x811c9dc5
  for (const ch of String(slug)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return (h & 0x7fffffff) || 1
}
export function locationsOf(where) {
  const w = where || { kind: 'none' }
  switch (w.kind) {
    case 'video': return [{ type: 'integration', integration: 'cal-video' }]
    case 'link': return [{ type: 'link', link: w.url || '', public: true }]
    case 'place': return [{ type: 'address', address: [w.name, w.address].filter(Boolean).join(', '), public: true }]
    case 'phone': return w.number ? [{ type: 'phone', phone: w.number, public: true }] : [{ type: 'attendeePhone' }]
    default: return []
  }
}
/* our word for how a booking is shared → cal.com's */
const SCHEDULING = { 'round-robin': 'ROUND_ROBIN', one: 'ROUND_ROBIN', collective: 'COLLECTIVE', managed: 'MANAGED' }
/* a form's field kinds → cal.com's booking-field types; anything else is free text, which is what
   its own renderer falls back to */
const FIELD = { text: 'text', email: 'email', url: 'url', tel: 'phone', number: 'number', select: 'select', choice: 'radio', date: 'date', time: 'text', datetime: 'text', file: 'text', rating: 'number', scale: 'number', password: 'text', picture: 'radio', voice: 'text', video: 'text' }

/**
 * @param {object} s      the session, as catalog.json holds it
 * @param {object} o      { hosts: [{ id, name, email, priority, weight, fixed }], price, site, form }
 */
export function eventTypeOf(s, o = {}) {
  const users = (o.hosts || []).map((h) => ({ id: eventTypeId('user:' + (h.email || h.id)), name: h.name || h.email || '', email: h.email || '', username: String(h.email || '').split('@')[0], avatarUrl: null, weekStart: 'Monday', brandColor: null, darkBrandColor: null, metadata: {} }))
  const page = s.page || {}
  const limits = s.limits || {}
  const rota = Object.fromEntries((s.rota || []).map((r) => [String(r.email || '').toLowerCase(), r]))
  /* HOW A BOOKING IS SHARED, under cal.com's own name. One host is a rota with one name in it, so
     it answers ROUND_ROBIN rather than inventing a fourth word cal.com's clients do not know. */
  const schedulingType = SCHEDULING[String(s.assign || 'round-robin')] || 'ROUND_ROBIN'
  /* the reschedule rules, as cal.com states them: what is DISABLED */
  const noCancel = page.cancel === false, noMove = page.reschedule === false
  /* the fields a booking asks for: cal.com's three, the phone where the type asks for theirs, then
     the type's form — which is what "booking fields" means to anybody reading this API */
  const bookingFields = [
    { type: 'name', slug: 'name', required: true, isDefault: true },
    { type: 'email', slug: 'email', required: true, isDefault: true },
    ...(page.notes === false ? [] : [{ type: 'notes', slug: 'notes', required: false, isDefault: true }]),
    ...(s.where && s.where.kind === 'phone' && !s.where.number ? [{ type: 'phone', slug: 'attendeePhoneNumber', required: true, isDefault: true }] : []),
    ...((o.form && o.form.fields) || []).map((x) => ({
      type: FIELD[x.kind] || 'text', slug: x.name, label: x.question && x.question !== '...' ? x.question : x.name,
      required: !!x.required, isDefault: false,
      ...(Array.isArray(x.values) && x.values.length ? { options: x.values } : {}),
    })),
  ]
  return {
    id: eventTypeId(s.slug), ownerId: users[0] ? users[0].id : null,
    lengthInMinutes: s.duration || 0,
    /* every length it offers, the default first — one length answers as a list of one, which is what
       cal.com does for a type that offers no choice */
    lengthInMinutesOptions: (Array.isArray(s.lengths) && s.lengths.length ? s.lengths : [{ minutes: s.duration || 0 }]).map((l) => (typeof l === 'number' ? l : l.minutes)),
    title: s.title || s.slug, slug: s.slug, description: s.line || '',
    locations: locationsOf(s.where), bookingFields,
    disableGuests: true,
    slotInterval: s.interval || 15, offsetStart: s.offset || 0,
    minimumBookingNotice: (s.notice || 0) * 60, beforeEventBuffer: s.buffer || 0, afterEventBuffer: s.buffer || 0,
    /* a run the reader books, in cal.com's shape; a type that happens at a fixed time is not one */
    recurrence: s.repeat ? { interval: 1, occurrences: s.repeat.count, frequency: String(s.repeat.every || 'week').toUpperCase() + 'LY' } : null,
    metadata: { requires: s.requires, below: s.below || null, weekly: s.weekly || 0, monthly: s.monthly || 0, scheduler: s.scheduler, sku: s.sku || null, record: !!s.record, team: s.team || null, form: s.form || null, customName: s.name || null },
    price: o.price ? o.price.amount : 0, currency: o.price ? o.price.currency : 'usd',
    /* the page's own switches */
    lockTimeZoneToggleOnBookingPage: page.zone === false,
    hideCalendarNotes: page.notes === false, hideCalendarEventDetails: page.details === false, hideOrganizerEmail: page.organiser === false,
    successRedirectUrl: page.redirect || null, forwardParamsSuccessRedirect: !!page.redirect,
    hidden: page.hidden === true,
    requiresBookerEmailVerification: page.account === true,
    disableCancelling: noCancel, disableRescheduling: noMove,
    allowReschedulingPastBookings: page.past === true,
    seatsPerTimeSlot: s.seats > 1 ? s.seats : null, seatsShowAvailabilityCount: s.seats > 1 && page.seatsLeft === true,
    seats: s.seats > 1 ? { seatsPerTimeSlot: s.seats, showAvailabilityCount: page.seatsLeft === true, showAttendeeInfo: page.attendees === true } : { disabled: true },
    useDestinationCalendarEmail: false,
    /* the SET of hours it asks its hosts for, by name; cal.com keys a schedule by id, so the id is
       the one this API gives that set (see schedule.js) */
    scheduleId: s.schedule ? eventTypeId('schedule-name:' + s.schedule) : null,
    bookerLayouts: null,
    /* whether the host confirms: always, or only inside the notice */
    requiresConfirmation: !!s.confirm,
    confirmationPolicy: !s.confirm ? { type: 'disabled' } : s.confirm === 'notice' ? { type: 'time', noticeThreshold: { count: s.notice || 0, unit: 'hours' }, blockUnconfirmedBookingsInBooker: true } : { type: 'always', blockUnconfirmedBookingsInBooker: true },
    color: null, customName: s.name || null, users,
    /* who gives it, and how the rota treats each */
    hosts: (o.hosts || []).map((h) => { const r = rota[String(h.email || '').toLowerCase()] || {}; return { userId: eventTypeId('user:' + (h.email || h.id)), name: h.name || h.email || '', mandatory: !!r.fixed, priority: ['lowest', 'low', 'medium', 'high', 'highest'][r.priority == null ? 2 : r.priority], scheduleId: null } }),
    /* a type given by a team takes every member, so cal.com's own word for that is true */
    schedulingType, assignAllTeamMembers: !!(s.team && !(s.hosts || []).length), teamId: s.team ? eventTypeId('team:' + s.team) : null,
    bookingLimitsCount: { ...(limits.day ? { day: limits.day } : {}), ...(limits.week ? { week: limits.week } : {}), ...(limits.month ? { month: limits.month } : {}), ...(limits.year ? { year: limits.year } : {}) },
    bookingLimitsDuration: { ...(limits.minutesDay ? { day: limits.minutesDay } : {}), ...(limits.minutesWeek ? { week: limits.minutesWeek } : {}) },
    bookingWindow: s.windowDays ? { type: 'businessDays', value: s.windowDays, rolling: true } : (s.windowFrom || s.windowTo) ? { type: 'range', value: [s.windowFrom || null, s.windowTo || null] } : [],
    bookerActiveSlots: null,
    isInstantEvent: false,
    _links: { book: (o.site || '') + '/book/' + s.slug },
  }
}
