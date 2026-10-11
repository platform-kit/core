/*
 * A response — a form_responses row with its form_answers — as Typeform's Responses API item, and as the
 * `form_response` a webhook delivers. Plain JavaScript, no imports, pinned under Node.
 *
 * The map by kind: text-like → { type: 'text', text }, email → email, url → url, tel → phone_number,
 * number / rating / scale → { type: 'number', number }, a choice → { type: 'choice', choice: { id, ref, label } }
 * (several → choices { ids, refs, labels }), date/datetime → { type: 'date', date }, a file → { type: 'file_url',
 * file_url } (a signed url the caller makes). The token and the response_id are the row's id; landed_at is when
 * it was started, submitted_at when it was completed; metadata from what the runner recorded on the row.
 */
import { TYPE_OF } from './definition.js'

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'x'
const iso = (v) => (v ? new Date(v).toISOString() : null)

export function answerOf(field, a, fileUrl) {
  const type = TYPE_OF[field.kind] || 'short_text'
  const head = { field: { id: field.name, type, ref: field.name } }
  const v = a.value
  if (a.file_path) return { ...head, type: 'file_url', file_url: fileUrl ? fileUrl(a.file_path) : a.file_path }
  switch (type) {
    case 'email': return { ...head, type: 'email', email: String(v ?? '') }
    case 'website': return { ...head, type: 'url', url: String(v ?? '') }
    case 'phone_number': return { ...head, type: 'phone_number', phone_number: String(v ?? '') }
    case 'number': case 'rating': case 'opinion_scale': return { ...head, type: 'number', number: Number(v) }
    case 'multiple_choice': case 'dropdown': case 'picture_choice': {
      const label = (x) => { const c = (field.choices || []).find((c) => c.value === x); return c ? (c.label || c.value) : String(x) }
      if (Array.isArray(v)) return { ...head, type: 'choices', choices: { ids: v.map((x) => slugify(x)), refs: v.map((x) => slugify(x)), labels: v.map(label) } }
      return { ...head, type: 'choice', choice: { id: slugify(v), ref: slugify(v), label: label(v) } }
    }
    case 'date': { const d = new Date(String(v ?? '')); return { ...head, type: 'date', date: isNaN(d) ? String(v ?? '') : d.toISOString() } }
    default: return { ...head, type: 'text', text: Array.isArray(v) ? v.join(', ') : String(v ?? '') }
  }
}

/**
 * @param {object} row      form_responses
 * @param {object[]} rows   form_answers of the row, in the form's order
 * @param {object} form     the compiled form (its `api.fields`)
 * @param {function} [fileUrl]  (path) => a url
 */
export function itemOf(row, rows, form, fileUrl) {
  const byName = Object.fromEntries(((form.api || {}).fields || []).map((f) => [f.name, f]))
  const order = ((form.api || {}).fields || []).map((f) => f.name)
  const answers = [...rows].sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field)).filter((a) => byName[a.field]).map((a) => answerOf(byName[a.field], a, fileUrl))
  const meta = row.meta || {}
  return {
    landing_id: row.id, token: row.id, response_id: row.id, response_type: 'completed',
    landed_at: iso(row.started_at), submitted_at: iso(row.completed_at),
    metadata: { user_agent: meta.user_agent || '', platform: meta.platform || 'other', referer: meta.referer || row.origin || '', network_id: String(row.anon_id || row.user_id || '').replace(/-/g, '').slice(0, 8), browser: meta.browser || 'default' },
    hidden: meta.hidden || {},
    calculated: { score: row.score ?? 0 },
    variables: row.score != null ? [{ key: 'score', type: 'number', number: row.score }] : [],
    ending: { id: 'default_tys', ref: 'default_tys' },
    answers,
  }
}

/* a file's address as Typeform gives one: under the Responses API, by the response, the field and the name (a key opens it) */
export const fileUrlOf = (apiBase, slug, path) => { const [rid, field, ...rest] = path.split('/'); return apiBase + '/forms/' + slug + '/responses/' + rid + '/fields/' + encodeURIComponent(field) + '/files/' + encodeURIComponent(rest.join('/')) }

/* the payload a webhook delivers */
export function webhookPayloadOf(item, definition, eventId) {
  return { event_id: eventId, event_type: 'form_response', form_response: { form_id: definition.id, token: item.token, landed_at: item.landed_at, submitted_at: item.submitted_at, definition: { id: definition.id, title: definition.title, fields: definition.fields }, answers: item.answers, hidden: item.hidden, calculated: item.calculated, variables: item.variables, ending: item.ending } }
}
