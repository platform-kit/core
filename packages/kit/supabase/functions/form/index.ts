/*
 * The forms' backend — what forms.md leaves to a Google Sheet, here out of the box. A form's runner
 * posts each slide as it is finished (multipart, as forms.md posts: the fields by name, a file as
 * itself, `_end` on the last) and reads back what this person has answered so far (`get`), so a form
 * left half-done is picked up on any device. No JWT is required (config.toml: verify_jwt = false): a
 * reader is known by their session's JWT, a guest by the browser's anonymous id in X-Form-Anon — the
 * analytics' own id. The service role writes; nothing on the client touches the tables.
 *
 * The fields a form declares — from _shared/forms.json, written by build/forms.mjs from the documents (in cloud
 * mode the rows parsed live, _shared/forms-live.ts)
 * — are the only ones accepted; a choice must be one of its choices; a file goes to the private
 * `forms` bucket under <response>/<field>/<name>. A form allowing one response (`#! once = true`)
 * refuses a second from the same person. `_end` closes the response, grades a quiz (the shared
 * score.js) and delivers the response once to every webhook: the subscriptions the Forms API keeps
 * (form_webhooks, Typeform's Webhooks API — each signed with its own secret) and the document's own
 * `webhook` setting (signed with FORMS_WEBHOOK_SECRET — derived from the service key when unset) — every
 * delivery Typeform's `form_response` payload under `Typeform-Signature: sha256=<base64 hmac>`, the
 * document's also under the `X-Form-Signature` (hex) it always had; a failed delivery is kept on the row,
 * per subscriber, and tried again on the form's next completion. The row keeps what the Responses API
 * says about a visit (`meta`: the user agent, the referer, the GET prefill as `hidden`). An embed on another site says where it is (the request's Origin), which is checked
 * against the form's `embed-origins`; the site's own origin always passes.
 *
 *   POST multipart   _form, _slide, [_end], [_fileFields], <field>=<value>…   a slide's answers
 *   POST { action: 'get', form }                                            my answers so far
 */
import { admin, json, preflight, getUser, appUrl } from '../_shared/lib.ts'
import { offer } from '../_shared/offers.ts'
import { formsNow } from '../_shared/forms-live.ts'   /* forms.json in git mode; the rows parsed in cloud mode, so a form written through the API or the admin takes answers at once */
import { grade } from '../_shared/forms/score.js'
import { definitionOf } from '../_shared/api/typeform/definition.js'
import { itemOf, webhookPayloadOf, fileUrlOf } from '../_shared/api/typeform/response.js'
import { throughDoor } from '../_shared/doors.ts'
import { fresh } from '../_shared/compiled.ts'   /* the compiled artefacts, re-read within a few seconds of a publish */

type Field = { name: string; kind: string; required: boolean; multiple: boolean; values?: string[]; slide: number }
type Form = { title: string; fields: Field[]; kit: { published: boolean; once: boolean; respond: string; embedOrigins: string[]; webhook: string; pass: number | null; score: Record<string, string>; paid?: string; ticket?: string; ticketTitle?: string; ticketPriority?: string }; settings: { page: string }; api?: any }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_VALUE = 20000
const MAX_FILE = 25 * 1024 * 1024
const env = (k: string) => Deno.env.get(k) ?? ''

/* the site's own origin, and locally any localhost port (the demo and the site run side by side) */
function originAllowed(req: Request, form: Form) {
  const from = req.headers.get('x-form-origin') || req.headers.get('origin') || ''
  if (!from) return true
  let site = ''
  try { site = new URL(appUrl()).origin } catch { site = '' }
  if (from === site) return true
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(from) && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(site)) return true
  return (form.kit.embedOrigins || []).map((o) => o.replace(/\/+$/, '')).includes(from.replace(/\/+$/, ''))
}

async function who(req: Request) {
  const user = await getUser(req)
  const anon = (req.headers.get('x-form-anon') || '').trim()
  return { user, anon: UUID.test(anon) ? anon.toLowerCase() : '' }
}
const ident = (w: { user: any; anon: string }) => (w.user ? { user_id: w.user.id, anon_id: w.anon || null } : { user_id: null, anon_id: w.anon })

/* A PAID FORM'S CREDIT. One entitlement row per purchase — the shape a paid session uses — so
   paying twice means answering twice, which is what somebody buying a second reading has bought.
   It is checked before the first slide is taken and SPENT when the answer is finished: a form
   somebody paid for and abandoned is still theirs to come back to. */
async function formCredit(userId: string, sku: string) {
  const o = offer(sku)
  const { data } = await admin.from('entitlements').select('id').eq('user_id', userId)
    .eq('kind', 'product').eq('key', 'form:' + (o?.key ?? sku)).eq('active', true).limit(1)
  return data && data.length ? (data[0] as any).id as string : null
}

/* the response this person is on for the form: open, or the completed one on a `once` form */
async function findResponse(slug: string, form: Form, w: { user: any; anon: string }) {
  let q = admin.from('form_responses').select('id, completed_at, score, total, passed').eq('form', slug)
  q = w.user ? q.eq('user_id', w.user.id) : q.is('user_id', null).eq('anon_id', w.anon)
  const { data } = await q.order('started_at', { ascending: false }).limit(5)
  const rows = data ?? []
  const open = rows.find((r: any) => !r.completed_at)
  const done = rows.find((r: any) => r.completed_at)
  if (form.kit.once && done) return { row: done, already: true }
  return { row: open ?? null, already: false }
}

async function hmacRaw(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
async function hmac(secret: string, body: string) { return hex(await hmacRaw(secret, body)) }
/* Typeform signs base64: `Typeform-Signature: sha256=<base64 hmac-sha256>` */
async function typeformSig(secret: string, body: string) { return 'sha256=' + b64(await hmacRaw(secret, body)) }
const webhookSecret = () => Deno.env.get('FORMS_WEBHOOK_SECRET') || ('forms:' + env('SUPABASE_SERVICE_ROLE_KEY').slice(-32))

/* the response as the webhook and `get` shape it */
async function responseView(id: string) {
  const { data: r } = await admin.from('form_responses').select('id, form, user_id, anon_id, started_at, completed_at, score, total, passed').eq('id', id).single()
  const { data: rows } = await admin.from('form_answers').select('field, value, file_path, file_name, file_type, file_size, slide, answered_at').eq('response_id', id).order('answered_at')
  const answers: Record<string, unknown> = {}
  for (const a of rows ?? []) answers[a.field] = a.file_path ? { name: a.file_name, type: a.file_type, size: a.file_size } : a.value
  const lastSlide = (rows ?? []).reduce((m: number | null, a: any) => (a.slide == null ? m : m == null ? a.slide : Math.max(m, a.slide)), null as number | null)
  return { ...r, answers, last_slide: lastSlide, files: (rows ?? []).filter((a: any) => a.file_path).map((a: any) => ({ field: a.field, name: a.file_name, type: a.file_type, size: a.file_size })) }
}

/* the subscribers of a form: the API's rows, and the document's own webhook as one more (its secret the site's) */
async function subscribers(slug: string, form: Form) {
  const { data } = await admin.from('form_webhooks').select('id, tag, url, secret, enabled').eq('form', slug).eq('enabled', true)
  const list = (data ?? []).map((w: any) => ({ key: 'tag:' + w.tag, id: w.id, url: w.url, secret: w.secret || webhookSecret(), own: false }))
  if (form.kit.webhook) list.push({ key: 'document', id: null, url: form.kit.webhook, secret: webhookSecret(), own: true })
  return list
}
/* the response as Typeform delivers it: the definition as the form is now, the answers typed by kind */
async function payloadOf(slug: string, form: Form, id: string) {
  const { data: r } = await admin.from('form_responses').select('*').eq('id', id).single()
  const { data: rows } = await admin.from('form_answers').select('field, value, file_path, file_name, file_type, file_size, slide, answered_at').eq('response_id', id)
  const def = definitionOf(form, { site: appUrl().replace(/\/+$/, ''), apiBase: appUrl().replace(/\/+$/, '') + '/v1/forms-api' })
  const item = itemOf(r, rows ?? [], form, (p: string) => fileUrlOf(appUrl().replace(/\/+$/, '') + '/v1/forms-api', slug, p))
  return JSON.stringify(webhookPayloadOf(item, def, crypto.randomUUID()))
}
/* one delivery per subscriber; what failed is kept on the row by subscriber, for the retry */
async function deliver(slug: string, form: Form, id: string) {
  const subs = await subscribers(slug, form)
  if (!subs.length) return
  const body = await payloadOf(slug, form, id)
  const { data: row } = await admin.from('form_responses').select('meta').eq('id', id).single()
  const failed: Record<string, string> = { ...((row?.meta || {}).webhook_failed || {}) }
  for (const s of subs) {
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json', 'typeform-signature': await typeformSig(s.secret, body), 'x-form': slug }
      if (s.own) headers['x-form-signature'] = 'sha256=' + (await hmac(s.secret, body))
      const r = await fetch(s.url, { method: 'POST', headers, body })
      if (!r.ok) throw new Error('the webhook answered ' + r.status)
      delete failed[s.key]
      if (s.id) await admin.from('form_webhooks').update({ last_at: new Date().toISOString(), last_error: null }).eq('id', s.id)
    } catch (e) {
      failed[s.key] = String((e as Error)?.message ?? e).slice(0, 300)
      if (s.id) await admin.from('form_webhooks').update({ last_error: failed[s.key] }).eq('id', s.id)
    }
  }
  const meta = { ...(row?.meta || {}), webhook_failed: failed }
  const any = Object.keys(failed).length
  await admin.from('form_responses').update({ meta, webhook_at: any ? null : new Date().toISOString(), webhook_error: any ? Object.entries(failed).map(([k, v]) => k + ': ' + v).join('; ').slice(0, 500) : null }).eq('id', id)
}
/* deliveries that failed before, tried again on the form's next completion (a few at a time) */
async function retry(slug: string, form: Form, except: string) {
  const { data } = await admin.from('form_responses').select('id').eq('form', slug).is('webhook_at', null).not('webhook_error', 'is', null).not('completed_at', 'is', null).neq('id', except).order('completed_at').limit(5)
  for (const r of data ?? []) await deliver(slug, form, r.id)
}
/* what the Responses API says about the visit: kept on the row when it is made */
function metaOf(req: Request, body: any) {
  let hidden: Record<string, string> = {}
  try { const h = JSON.parse(String(body._hidden || '{}')); if (h && typeof h === 'object') for (const [k, v] of Object.entries(h).slice(0, 20)) hidden[String(k).slice(0, 40)] = String(v).slice(0, 200) } catch { /* none */ }
  const ua = req.headers.get('user-agent') || ''
  return { user_agent: ua.slice(0, 300), referer: (req.headers.get('referer') || req.headers.get('x-form-origin') || '').slice(0, 300), platform: /mobile|android|iphone|ipad/i.test(ua) ? 'mobile' : 'other', browser: 'default', hidden }
}

Deno.serve(async (req) => {
  await fresh()
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  /* answers from one visitor in an hour: the anonymous id is theirs to choose, so it is the address that is counted */
  { const d = await throughDoor(req, 'forms'); if (d.over) return json({ error: 'slow down', code: 'rate' }, 429) }
  const multipart = (req.headers.get('content-type') ?? '').includes('multipart/form-data')
  let fd: FormData | null = null
  let body: any = {}
  try {
    if (multipart) { fd = await req.formData(); body = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) }
    else body = await req.json()
  } catch { return json({ error: 'bad request' }, 400) }
  const slug = String(body._form ?? body.form ?? '')
  const form = ((await formsNow()) as Record<string, Form>)[slug]
  if (!form) return json({ error: 'no such form', code: 'form' }, 404)
  if (form.kit.published === false) return json({ error: 'this form is closed', code: 'closed' }, 410)
  if (!originAllowed(req, form)) return json({ error: 'this form is not allowed on that page', code: 'origin' }, 403)
  const w = await who(req)
  if (form.kit.respond === 'authenticated' && !w.user) return json({ error: 'sign in to answer this form', code: 'signin' }, 401)
  if (!w.user && !w.anon) return json({ error: 'no identity', code: 'anon' }, 400)
  /* WHAT IT COSTS. A paid form takes no answer until it is paid for — and says so in a shape the
     runner can act on (the sku, so it can send them to the checkout and bring them back). A
     response already open was paid for when it was started, so it is theirs to finish. */
  let credit: string | null = null
  if (form.kit.paid && w.user) credit = await formCredit(w.user.id, form.kit.paid)

  /* ---- my answers so far ---- */
  if (!multipart && body.action === 'get') {
    const { row, already } = await findResponse(slug, form, w)
    /* a paid form says so here, so the runner can take them to the checkout before the first
       question rather than after it. A response already open was paid for when it was started. */
    const pay = form.kit.paid && !row && !credit ? { unpaid: true, sku: form.kit.paid } : {}
    if (!row) return json({ answers: {}, completed: false, ...pay })
    const view = await responseView(row.id)
    return json({ response_id: row.id, answers: view.answers, last_slide: view.last_slide, completed: !!row.completed_at, already, score: row.score, total: row.total, passed: row.passed })
  }
  if (form.kit.paid) {
    const { row } = await findResponse(slug, form, w)
    if (!row && !credit) return json({ error: 'this form is paid for before it is answered', code: 'unpaid', sku: form.kit.paid }, 402)
  }
  if (!multipart) return json({ error: 'unknown action' }, 400)

  /* ---- a slide ---- */
  if (form.settings.page !== 'form-slides') return json({ error: 'this document is not a form', code: 'page' }, 400)
  const end = /^(true|1|yes)$/i.test(String(body._end ?? ''))
  const slide = Number.isFinite(Number(body._slide)) ? Number(body._slide) : null
  const fileFields = String(body._fileFields ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const byName = Object.fromEntries(form.fields.map((f) => [f.name, f]))
  const answers: { field: string; value: unknown; file?: File }[] = []
  for (const [k, v] of fd!.entries()) {
    if (k.startsWith('_')) continue
    const f = byName[k]
    if (!f) return json({ error: `"${k}" is not a field of this form`, code: 'field' }, 400)
    if (v instanceof File) { if (f.kind !== 'file' && f.kind !== 'voice' && f.kind !== 'video') return json({ error: `"${k}" is not a file field`, code: 'field' }, 400); if (v.size > MAX_FILE) return json({ error: 'the file is too large', code: 'size' }, 413); answers.push({ field: k, value: v.name, file: v }); continue }
    let value: unknown = String(v).slice(0, MAX_VALUE)
    if (f.multiple) { try { value = JSON.parse(String(v)) } catch { value = [String(v)] } if (!Array.isArray(value)) value = [value] }
    if (f.values && f.values.length) { const vs = Array.isArray(value) ? value : [value]; if (vs.some((x) => !f.values!.includes(String(x)))) return json({ error: `"${k}" is not one of the choices`, code: 'choice' }, 400) }
    if (f.kind === 'number' || f.kind === 'rating' || f.kind === 'scale') { const n = Number(value); if (String(value) !== '' && Number.isFinite(n)) value = n }
    answers.push({ field: k, value })
  }
  const { row: found, already } = await findResponse(slug, form, w)
  if (already) return json({ error: 'already answered', code: 'already' }, 409)
  let id = found ? found.id : ''
  if (!id) {
    const { data, error } = await admin.from('form_responses').insert({ form: slug, ...ident(w), origin: req.headers.get('x-form-origin') || req.headers.get('origin') || null, meta: metaOf(req, body) }).select('id').single()
    if (error) return json({ error: error.message }, 500)
    id = data.id
  }
  for (const a of answers) {
    const rec: any = { response_id: id, field: a.field, value: a.file ? a.value : a.value, slide, answered_at: new Date().toISOString(), file_path: null, file_name: null, file_type: null, file_size: null }
    if (a.file) {
      const safe = a.file.name.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'file'
      const path = `${id}/${a.field}/${safe}`
      const up = await admin.storage.from('forms').upload(path, a.file, { contentType: a.file.type || 'application/octet-stream', upsert: true })
      if (up.error) return json({ error: 'the file could not be kept: ' + up.error.message }, 500)
      Object.assign(rec, { file_path: path, file_name: a.file.name, file_type: a.file.type || null, file_size: a.file.size })
    }
    const { error } = await admin.from('form_answers').upsert(rec, { onConflict: 'response_id,field' })
    if (error) return json({ error: error.message }, 500)
  }
  let out: any = { response_id: id, completed: false }
  if (end) {
    const view = await responseView(id)
    const g = grade(form.kit.score || {}, view.answers, form.kit.pass)
    const patch: any = { completed_at: new Date().toISOString() }
    if (g.total) Object.assign(patch, { score: g.score, total: g.total, passed: g.passed })
    await admin.from('form_responses').update(patch).eq('id', id)
    out = { response_id: id, completed: true, score: g.total ? g.score : null, total: g.total || null, passed: g.passed }
    /* THIS ANSWER IS A PIECE OF WORK, where the form says so: a ticket, carrying the response, so
       the desk reads and filters the answers through it and this function never learns what a
       field means. One answer raises one ticket — a retry of the same response raises none. */
    if (form.kit.ticket) {
      const view2 = await responseView(id)
      const a = view2.answers as Record<string, unknown>
      const say = (k?: string) => (k && a[k] != null ? String(Array.isArray(a[k]) ? (a[k] as unknown[]).join(', ') : a[k]) : '')
      const title = say(form.kit.ticketTitle) || form.title || slug
      const prio = ['low', 'normal', 'high', 'urgent'].includes(say(form.kit.ticketPriority).toLowerCase())
        ? say(form.kit.ticketPriority).toLowerCase() : 'normal'
      /* whoever wrote it, where the desk already knows them as a contact */
      let contact: string | null = null
      if (w.user) {
        const { data: c } = await admin.from('support_contacts').select('id').eq('user_id', w.user.id).maybeSingle()
        contact = c ? (c as any).id : null
      }
      /* the body is every answer, said plainly, so a ticket reads as something before anybody opens the form */
      const body = Object.entries(a).map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : String(v ?? ''))).join('\n')
      await admin.rpc('support_ticket_from_form', {
        p_title: title, p_response: id, p_contact: contact, p_body: body,
        p_priority: prio, p_category: form.kit.ticket === 'yes' ? null : form.kit.ticket,
      })
    }
    /* the credit goes when the answer is finished, not when it was started */
    if (form.kit.paid && w.user && credit) await admin.from('entitlements').update({ active: false }).eq('id', credit)
    await deliver(slug, form, id)
    await retry(slug, form, id)
  }
  return json(out)
})
