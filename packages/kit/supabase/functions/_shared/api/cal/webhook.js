/*
 * The payload a scheduling webhook delivers, as cal.com delivers one — the same fields the kit's own cal-webhook reads
 * back (triggerEvent, createdAt, payload { type, title, startTime, endTime, organizer, attendees, uid, bookingId,
 * eventTypeId, status, metadata, responses, cancellationReason, rescheduleUid }) — so the loop is symmetric: a site's
 * subscriber may be another site's cal-webhook. Signed X-Cal-Signature-256: HMAC-SHA256 of the raw body, hex.
 */
export const TRIGGERS = ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED', 'BOOKING_REJECTED', 'MEETING_STARTED', 'MEETING_ENDED', 'BOOKING_NO_SHOW_UPDATED', 'RECORDING_READY']
export function payloadOf(trigger, booking, extra = {}) {
  const organizer = booking.hosts[0] ? { id: booking.hosts[0].id, name: booking.hosts[0].name, email: booking.hosts[0].email, username: booking.hosts[0].username, timeZone: booking.hosts[0].timeZone, language: { locale: 'en' } } : null
  return {
    triggerEvent: trigger, createdAt: new Date().toISOString(),
    payload: {
      type: booking.eventType ? booking.eventType.slug : '', title: booking.title, description: booking.description, additionalNotes: booking.description, customInputs: {},
      startTime: booking.start, endTime: booking.end, organizer, attendees: booking.attendees.map((a) => ({ name: a.name, email: a.email, timeZone: a.timeZone, language: { locale: a.language || 'en' } })),
      location: booking.location, destinationCalendar: null, uid: booking.uid, bookingId: booking.id, eventTypeId: booking.eventTypeId, eventTitle: booking.title, status: String(booking.status || '').toUpperCase(), metadata: booking.metadata, responses: booking.bookingFieldsResponses,
      cancellationReason: booking.cancellationReason || undefined, rescheduleUid: booking.rescheduledFromUid || undefined, videoCallData: booking.meetingUrl ? { url: booking.meetingUrl } : undefined, ...extra,
    },
  }
}
