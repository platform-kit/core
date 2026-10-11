/*
 * The browser's side of the `form` function: a slide's answers posted as it is finished, the answers
 * so far read back for a return (on another device too), the whole thing closed with `_end`. The
 * identity is the session's JWT when there is one (supabase-js sends it), else the browser's anonymous
 * id in X-Form-Anon — the same id the analytics keep. A file rides as itself, multipart, as forms.md
 * posts one. An embed on another site brings its own client (setFormClient) and says where it is
 * (X-Form-Origin), which the function checks against the form's allowed origins.
 */
import { supabase as site } from '../supabase.js'
import { anonId } from '../analytics.js'

let client = site
let origin = ''
export function setFormClient(c, from) { client = c; origin = from || '' }

function headers() {
  const h = { 'x-form-anon': anonId() }
  if (origin) h['x-form-origin'] = origin
  return h
}
async function call(body, h) {
  if (!client) throw new Error('no backend')
  const { data, error } = await client.functions.invoke('form', { body, headers: { ...headers(), ...(h || {}) } })
  if (error) {
    let msg = error.message || 'failed'
    try { const ctx = error.context; if (ctx && typeof ctx.json === 'function') { const j = await ctx.json(); if (j && j.error) msg = j.error; if (j && j.code) { const e = new Error(msg); e.code = j.code; throw e } } } catch (e) { if (e.code) throw e }
    throw new Error(msg)
  }
  return data
}

/* a slide's values — a File as itself, a list as JSON — and `_end` when the form is done */
export function postSlide(slug, values, { end = false, slide = 0 } = {}) {
  const fd = new FormData()
  fd.append('_form', slug)
  fd.append('_slide', String(slide))
  if (end) fd.append('_end', 'true')
  /* the page's query — a GET prefill, a campaign's parameters — as the response's hidden fields (Typeform's `hidden`) */
  try { const h = {}; for (const [k, v] of new URLSearchParams(location.search)) if (!k.startsWith('typeform-') && !k.startsWith('embed-') && !k.startsWith('_')) h[k] = v; if (Object.keys(h).length) fd.append('_hidden', JSON.stringify(h)) } catch (e) { /* no window */ }
  const files = []
  for (const [k, v] of Object.entries(values || {})) {
    if (v == null) continue
    if (typeof File !== 'undefined' && v instanceof File) { fd.append(k, v, v.name); files.push(k) }
    else if (Array.isArray(v)) fd.append(k, JSON.stringify(v))
    else fd.append(k, String(v))
  }
  if (files.length) fd.append('_fileFields', files.join(','))
  return call(fd)
}
/* what this person has answered so far on a form, and whether they finished it */
export function getResponse(slug) { return call({ action: 'get', form: slug }) }
