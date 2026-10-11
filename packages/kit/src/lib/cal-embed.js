/*
 * The booking page inside cal.com's embed (@calcom/embed-core 1.5): the iframe it opens at <origin>/<calLink> carries
 * ?embed=<namespace>&embedType=inline|modal|floatingButton&theme=…&layout=…, and the library listens on the parent for
 * messages of the shape { originator: 'CAL', type, namespace, data } — __iframeReady, __dimensionChanged
 * { iframeHeight, iframeWidth, isFirstTime }, linkReady, bookingSuccessfulV2 { uid, title, startTime, endTime,
 * eventTypeId, status, paymentRequired, isRecurring }, rescheduleBookingSuccessfulV2, bookingCancelled, __routeChanged.
 * This is that side: read the query, post the messages. Nothing when the page is not embedded.
 */
export function calEmbedContext(search = typeof location !== 'undefined' ? location.search : '') {
  const q = new URLSearchParams(search || '')
  if (!q.has('embed')) return null
  return { namespace: q.get('embed') || '', type: q.get('embedType') || 'inline', theme: q.get('theme') || '', layout: q.get('layout') || '' }
}
export function calEmbedMessenger(ctx) {
  if (!ctx || typeof window === 'undefined' || window.parent === window) return null
  const post = (type, data = {}) => { try { window.parent.postMessage({ originator: 'CAL', type, namespace: ctx.namespace, data, fullType: `CAL:${ctx.namespace}:${type}` }, '*') } catch (e) { /* no parent */ } }
  let first = true
  return {
    ready: () => post('__iframeReady'),
    linkReady: () => post('linkReady'),
    size: (h, w) => { post('__dimensionChanged', { iframeHeight: Math.ceil(h), iframeWidth: Math.ceil(w), isFirstTime: first }); first = false },
    route: () => post('__routeChanged'),
    booked: (b) => post('bookingSuccessfulV2', { uid: b.uid, title: b.title, startTime: b.start, endTime: b.end, eventTypeId: b.eventTypeId ?? null, status: b.status || 'accepted', paymentRequired: false, isRecurring: false, ...(b.join_url ? { videoCallUrl: b.join_url } : {}) }),
    moved: (b) => post('rescheduleBookingSuccessfulV2', { uid: b.uid, title: b.title, startTime: b.start, endTime: b.end, eventTypeId: b.eventTypeId ?? null, status: b.status || 'accepted', paymentRequired: false, isRecurring: false }),
    cancelled: (b) => post('bookingCancelled', { booking: b, organizer: {}, eventType: {} }),
  }
}
