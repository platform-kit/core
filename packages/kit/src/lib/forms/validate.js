/*
 * What a field accepts, by kind — the runner's validation before a slide goes: required, and the shape
 * a kind asks for (an address, a url, a number in its range, a phone number, a date in its format, a
 * file under its limit, a choice among the choices). Pure: given the field, the value and the words,
 * the message that stops the slide, or '' when the value passes. The words are the `forms` scope's
 * (content/app/ui/forms.md, `## runner`).
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE = /^https?:\/\/[^\s]+$/i
const DATE = { datetime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, date: /^\d{4}-\d{2}-\d{2}$/, time: /^\d{2}:\d{2}$/ }

export const empty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0)

export function validateField(field, value, W) {
  const w = W || {}
  const p = field.params || {}
  const req = (msg) => (field.required && empty(value) ? msg : '')
  switch (field.kind) {
    case 'choice': case 'picture': { const r = req(w['choice-required'] || 'Please select an item in the list.'); if (r) return r
      const allowed = (p.choices || []).map((c) => c.value); const vs = Array.isArray(value) ? value : empty(value) ? [] : [value]
      return vs.every((v) => allowed.includes(v)) ? '' : (w['choice-required'] || 'Please select an item in the list.') }
    case 'select': { const r = req(w['select-required'] || w.required || 'This is required.'); if (r) return r
      return empty(value) || (p.options || []).some((o) => o.value === value) ? '' : (w['select-required'] || 'Select an option') }
    case 'rating': case 'scale': return req(w['number-choice-required'] || 'Please make a selection.')
    /* a voice note and a video are files: what differs is how they were made, and nothing past
       the field knows the difference */
    case 'voice': case 'video':
    case 'file': { const r = req(w.required || 'This is required.'); if (r) return r
      if (value && typeof value === 'object' && value.size != null && p.sizelimit && value.size > p.sizelimit * 1024 * 1024) return w['file-size-error'] || 'File exceeds the size limit.'
      if (value && typeof value === 'object' && p.imageonly && value.type && !/^image\//.test(value.type)) return w['file-image-only'] || 'Choose an image.'
      return '' }
    case 'email': { const r = req(w.required || 'This is required.'); if (r) return r; return empty(value) || EMAIL.test(String(value).trim()) ? '' : (w['invalid-email'] || 'Please enter an email address.') }
    case 'url': { const r = req(w.required || 'This is required.'); if (r) return r; return empty(value) || URL_RE.test(String(value).trim()) ? '' : (w['invalid-url'] || 'Please enter a web address (https://…).') }
    case 'tel': { const r = req(w.required || 'This is required.'); if (r) return r; const digits = String(value || '').replace(/\D/g, ''); return empty(value) || digits.length >= 4 ? '' : (w['invalid-phone'] || 'Please enter a phone number.') }
    case 'number': { const r = req(w.required || 'This is required.'); if (r) return r; if (empty(value)) return ''
      const n = Number(value); if (!Number.isFinite(n)) return w['invalid-number'] || 'Please enter a number.'
      if (p.min != null && n < Number(p.min)) return (w['number-min'] || 'At least {min}.').replace('{min}', p.min)
      if (p.max != null && n > Number(p.max)) return (w['number-max'] || 'At most {max}.').replace('{max}', p.max)
      return '' }
    case 'datetime': case 'date': case 'time': { const r = req(w.required || 'This is required.'); if (r) return r; if (empty(value)) return ''
      const v = String(value)
      if (!DATE[field.kind].test(v)) return w['invalid-' + field.kind] || 'Please use the right format.'
      if (p.min && v < p.min) return (w['date-min'] || 'On or after {min}.').replace('{min}', p.min)
      if (p.max && v > p.max) return (w['date-max'] || 'On or before {max}.').replace('{max}', p.max)
      return '' }
    default: { const r = req(w.required || 'This is required.'); if (r) return r; if (empty(value)) return ''
      const v = String(value)
      if (p.maxlength && v.length > Number(p.maxlength)) return (w['too-long'] || 'At most {n} characters.').replace('{n}', p.maxlength)
      if (p.pattern) { try { if (!new RegExp('^(?:' + p.pattern + ')$').test(v)) return w['invalid-pattern'] || 'Please match the requested format.' } catch { /* a pattern the browser would refuse too */ } }
      return '' }
  }
}

/* every visible field of a slide checked; the first message per field */
export function validateSlide(fields, values, W) {
  const errors = {}
  for (const f of fields) { const m = validateField(f, values[f.name], W); if (m) errors[f.name] = m }
  return errors
}
