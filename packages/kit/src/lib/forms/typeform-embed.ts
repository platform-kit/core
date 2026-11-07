/*
 * The runner inside Typeform's embed (@typeform/embed 6): the iframe it opens at <domain>/to/<id> carries
 * ?typeform-embed=<type>&typeform-embed-id=<id>&…, and the library listens on the parent for messages of the shape
 * { type: 'form-…', embedId, …data } — form-ready, form-theme { theme: { backgroundColor, color } }, form-started,
 * form-screen-changed { ref }, form-height-changed { height }, form-submit { formId, responseId }, form-close. This
 * is that side: read the query, post the messages. Pure but for window; nothing when the page is not embedded.
 */
export function embedContext(search = typeof location !== 'undefined' ? location.search : '') {
  const q = new URLSearchParams(search || '')
  const type = q.get('typeform-embed')
  if (!type) return null
  return { type, id: q.get('typeform-embed-id') || '', source: q.get('typeform-source') || '', medium: q.get('typeform-medium') || '', hideFooter: q.get('embed-hide-footers') === 'true' || q.get('embed-hide-footer') === 'true', hideHeaders: q.get('embed-hide-headers') === 'true', autoResize: q.get('typeform-embed-auto-resize') === 'true' }
}

export function embedMessenger(ctx: { id: string } | null) {
  if (!ctx || typeof window === 'undefined' || window.parent === window) return null
  const post = (type: string, data = {}) => { try { window.parent.postMessage({ type, embedId: ctx.id, ...data }, '*') } catch (e) { /* no parent */ } }
  return {
    ready: () => post('form-ready'),
    theme: (backgroundColor: any, color: any) => post('form-theme', { theme: { backgroundColor, color } }),
    started: () => post('form-started'),
    screen: (ref: any) => post('form-screen-changed', { ref }),
    height: (height: number) => post('form-height-changed', { height: Math.ceil(height) }),
    submit: (formId: any, responseId: any) => post('form-submit', { formId, responseId }),
    close: () => post('form-close'),
  }
}
