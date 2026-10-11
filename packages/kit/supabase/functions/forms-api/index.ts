/*
 * The Forms API — the site's forms served as Typeform's (forms-api): the Create API (read, and in cloud mode written), the Responses API,
 * the Webhooks API and the Insights summary, at <domain>/v1/forms-api/… (the /v1/* rewrite; the function's own
 * address answers too), so `@typeform/api-client` works with `apiBaseUrl` changed and anything written against
 * api.typeform.com with the base changed. A caller is a key of kind `forms` (Settings → API) — never no one,
 * whatever api.public says: responses are people's answers; a key of another door is FORBIDDEN. The shapes are
 * _shared/api/typeform/*, pinned under Node; the forms are _shared/forms-live.ts (forms.json in git mode, the rows parsed in
 * cloud mode); the rows are the form function's. A write — POST /forms, PUT · PATCH · DELETE /forms/{id} — turns Typeform's
 * definition into a forms.md document (typeform/document.js) and hands it to the content pipe for the forms model: the
 * parser's refusals come back as VALIDATION_ERROR, a type the runner has no kind for or a jump the rows cannot say as
 * 400 naming it; the write is published at once (Typeform has no draft) and pushed as the admin's publish is. Cloud
 * mode only: in git mode every write is 405. Errors are Typeform's ({ code, description }); the rate limit the api module's, with Retry-After.
 *
 *   GET    /me · /workspaces · /workspaces/default
 *   GET    /forms?search&page&page_size          GET /forms/{id}
 *   GET    /forms/{id}/responses?…               DELETE /forms/{id}/responses?included_tokens=a,b
 *   GET    /forms/{id}/responses/{token}/fields/{ref}/files/{name}   → the file (a signed url, an hour)
 *   GET    /forms/{id}/webhooks                  GET · PUT · DELETE /forms/{id}/webhooks/{tag}
 *   GET    /insights/{id}/summary
 *   POST   /forms                                PUT · PATCH (JSON Patch) · DELETE /forms/{id}     cloud mode; 405 in git mode
 */
import { admin, appUrl } from '../_shared/lib.ts'
import { tokenOf, keyOf, rateLimit } from '../_shared/api/keys.ts'
import { API_ON } from '../_shared/api/flags.ts'
import { formsNow, invalidateForms, CLOUD } from '../_shared/forms-live.ts'
import { modelFromDefinition, applyPatch } from '../_shared/api/typeform/document.js'
import { pipeFor, makerOf } from '../_shared/api/pipe.ts'
import { pushPending } from '../_shared/github.js'
import { definitionOf, listItemOf } from '../_shared/api/typeform/definition.js'
import { itemOf, fileUrlOf } from '../_shared/api/typeform/response.js'
import { parseResponsesQuery, applyResponsesQuery } from '../_shared/api/typeform/query.js'
import { errorOf } from '../_shared/api/typeform/errors.js'
import { summaryOf } from '../_shared/api/typeform/insights.js'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' }
const MAX_ROWS = 5000
const site = () => appUrl()
const apiBase = () => site() + '/v1/forms-api'
const published = async () => Object.entries(await formsNow()).filter(([, f]) => f.kit?.published !== false && f.settings?.page === 'form-slides')
const formOf = async (id: string) => { const f = (await formsNow())[id]; return f && f.kit?.published !== false && f.settings?.page === 'form-slides' ? f : null }
const WEBHOOK_COLS = 'id, form, tag, url, enabled, verify_ssl, created_at, updated_at'
const webhookView = (w: any) => ({ id: w.id, form_id: w.form, tag: w.tag, url: w.url, enabled: !!w.enabled, verify_ssl: !!w.verify_ssl, created_at: w.created_at, updated_at: w.updated_at })

/* the responses of a form with their answers, shaped for the query plan */
async function responsesOf(slug: string) {
  const { data: rows } = await admin.from('form_responses').select('*').eq('form', slug).order('started_at', { ascending: false }).limit(MAX_ROWS)
  const ids = (rows ?? []).map((r: any) => r.id)
  const answers: Record<string, any[]> = {}
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await admin.from('form_answers').select('response_id, field, value, file_path, file_name, file_type, file_size, slide, answered_at').in('response_id', ids.slice(i, i + 500))
    for (const a of data ?? []) (answers[a.response_id] ||= []).push(a)
  }
  return (rows ?? []).map((row: any) => ({ row, answers: answers[row.id] || [] }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  const q: Record<string, string> = {}; url.searchParams.forEach((v, k) => { q[k] = v })
  const path = url.pathname.replace(/^(?:.*?\/functions\/v1)?\/forms-api(?=\/|$)/, '').replace(/\/+$/, '') || '/'
  let extra: Record<string, string> = {}
  const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { ...CORS, ...extra, 'Content-Type': 'application/json', ...headers } })
  const fail = (code: string, description?: string) => { const e = errorOf(code, description); return reply(e.body, e.status) }
  if (!API_ON) return fail('NOT_FOUND', 'The API is not on for this site.')

  const token = tokenOf(req, q)
  const caller = await keyOf(token, ['forms'])
  if (caller === 'other-kind') return fail('FORBIDDEN', 'This key does not open the Forms API: make one of kind forms under Settings → API.')
  if (!caller) return fail('AUTHENTICATION_FAILED')
  const rl = await rateLimit(caller.id ?? 'key'); extra = rl.headers
  if (rl.over) return reply(errorOf('TOO_MANY_REQUESTS').body, 429, { 'Retry-After': String(rl.reset) })

  const seg = path.split('/').filter(Boolean)
  const m = req.method
  try {
    if (m === 'GET' && path === '/me') { const { data: u } = caller.id ? await admin.from('api_keys').select('created_by, name').eq('id', caller.id).maybeSingle() : { data: null }; const { data: p } = u?.created_by ? await admin.from('profiles').select('email, display_name').eq('id', u.created_by).maybeSingle() : { data: null }; return reply({ alias: p?.display_name || u?.name || 'api', email: p?.email || '', language: 'en', user_id: u?.created_by || caller.id }) }
    if (m === 'GET' && path === '/workspaces') return reply({ total_items: 1, page_count: 1, items: [{ id: 'default', name: 'Default', default: true, shared: false, forms: { count: (await published()).length, href: apiBase() + '/workspaces/default/forms' }, self: { href: apiBase() + '/workspaces/default' } }] })
    if (m === 'GET' && (path === '/workspaces/default' || path === '/workspaces/default/forms')) return path.endsWith('/forms') ? listForms(q) : reply({ id: 'default', name: 'Default', default: true, shared: false, forms: { count: (await published()).length, href: apiBase() + '/workspaces/default/forms' }, self: { href: apiBase() + '/workspaces/default' } })

    if (seg[0] === 'forms') {
      if (seg.length === 1) { if (m === 'GET') return listForms(q); if (m === 'POST') return writeForm(null, await bodyOf(req)); return fail('METHOD_NOT_ALLOWED') }
      const slug = seg[1]
      if (seg.length === 2 && (m === 'PUT' || m === 'PATCH' || m === 'DELETE')) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return fail('VALIDATION_ERROR', 'A form id is lower-case words joined by hyphens.')
        if (m === 'DELETE') return deleteForm(slug)
        const body = await bodyOf(req)
        if (m === 'PUT') return writeForm(slug, body)
        const current = (await formsNow())[slug]; if (!current) return fail('NOT_FOUND', `No form "${slug}".`)
        let patched: any; try { patched = applyPatch(definitionOf(current, { site: site(), apiBase: apiBase() }), body) } catch (e: any) { return fail('VALIDATION_ERROR', String(e?.message ?? e)) }
        return writeForm(slug, patched)
      }
      const form = await formOf(slug); if (!form) return fail('NOT_FOUND', `No published form "${slug}".`)
      const def = () => definitionOf(form, { site: site(), apiBase: apiBase(), long: (f: any) => !!f.multiline })
      if (seg.length === 2) { if (m === 'GET') return reply(def()); return fail('METHOD_NOT_ALLOWED') }

      if (seg[2] === 'responses') {
        if (seg.length === 3 && m === 'GET') {
          const plan = parseResponsesQuery(q); if (plan.errors.length) return fail('VALIDATION_ERROR', plan.errors.join('; '))
          const page = applyResponsesQuery(plan, await responsesOf(slug))
          return reply({ total_items: page.total_items, page_count: page.page_count, items: page.items.map((it: any) => itemOf(it.row, it.answers, form, (p: string) => fileUrlOf(apiBase(), slug, p))) })
        }
        if (seg.length === 3 && m === 'DELETE') {
          const ids = String(q.included_tokens || q.included_response_ids || '').split(',').map((s) => s.trim()).filter(Boolean)
          if (!ids.length) return fail('VALIDATION_ERROR', 'included_tokens names the responses to delete.')
          const { data: rows } = await admin.from('form_responses').select('id').eq('form', slug).in('id', ids)
          const found = (rows ?? []).map((r: any) => r.id)
          if (found.length) {
            const { data: files } = await admin.from('form_answers').select('file_path').in('response_id', found).not('file_path', 'is', null)
            const paths = (files ?? []).map((f: any) => f.file_path); if (paths.length) await admin.storage.from('forms').remove(paths)
            await admin.from('form_responses').delete().in('id', found)
          }
          return reply(null, 204)
        }
        /* a file: /forms/{id}/responses/{token}/fields/{ref}/files/{name} */
        if (seg.length >= 7 && seg[4] === 'fields' && seg[6] === 'files') {
          const rid = seg[3], field = decodeURIComponent(seg[5])
          const { data: a } = await admin.from('form_answers').select('file_path, response_id').eq('response_id', rid).eq('field', field).maybeSingle()
          const { data: r } = a ? await admin.from('form_responses').select('form').eq('id', rid).maybeSingle() : { data: null }
          if (!a || !a.file_path || r?.form !== slug) return fail('NOT_FOUND', 'No such file.')
          const { data: s } = await admin.storage.from('forms').createSignedUrl(a.file_path, 3600)
          if (!s?.signedUrl) return fail('NOT_FOUND', 'The file is gone.')
          return new Response(null, { status: 302, headers: { ...CORS, Location: s.signedUrl } })
        }
        return fail('NOT_FOUND')
      }

      if (seg[2] === 'webhooks') {
        if (seg.length === 3 && m === 'GET') { const { data } = await admin.from('form_webhooks').select(WEBHOOK_COLS).eq('form', slug).order('created_at'); return reply({ items: (data ?? []).map(webhookView) }) }
        if (seg.length === 4) {
          const tag = seg[3]
          if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(tag)) return fail('VALIDATION_ERROR', 'A tag is letters, digits, _ . and -, 64 at most.')
          if (m === 'GET') { const { data } = await admin.from('form_webhooks').select(WEBHOOK_COLS).eq('form', slug).eq('tag', tag).maybeSingle(); return data ? reply(webhookView(data)) : fail('NOT_FOUND', 'No such webhook.') }
          if (m === 'PUT') {
            let body: any = {}; try { body = await req.json() } catch { return fail('BAD_REQUEST') }
            if (typeof body.url !== 'string' || !/^https?:\/\/\S+$/.test(body.url)) return fail('VALIDATION_ERROR', 'url is required and must be http(s).')
            const { data: had } = await admin.from('form_webhooks').select('id, secret').eq('form', slug).eq('tag', tag).maybeSingle()
            const rec: any = { form: slug, tag, url: body.url, enabled: body.enabled !== false, verify_ssl: body.verify_ssl !== false, updated_at: new Date().toISOString() }
            if (typeof body.secret === 'string') rec.secret = body.secret.slice(0, 200) || null
            const { data, error } = had ? await admin.from('form_webhooks').update(rec).eq('id', had.id).select(WEBHOOK_COLS).single() : await admin.from('form_webhooks').insert(rec).select(WEBHOOK_COLS).single()
            if (error) return fail('BAD_REQUEST', error.message)
            return reply(webhookView(data), had ? 200 : 201)
          }
          if (m === 'DELETE') { await admin.from('form_webhooks').delete().eq('form', slug).eq('tag', tag); return reply(null, 204) }
        }
        return fail('METHOD_NOT_ALLOWED')
      }
      return fail('NOT_FOUND')
    }

    if (seg[0] === 'insights' && seg.length === 3 && seg[2] === 'summary' && m === 'GET') {
      const form = await formOf(seg[1]); if (!form) return fail('NOT_FOUND', `No published form "${seg[1]}".`)
      const { data } = await admin.rpc('admin_forms', { days: 3650 })
      const stats = (Array.isArray(data) ? data : []).find((x: any) => x.form === seg[1]) || {}
      return reply(summaryOf(definitionOf(form, { site: site(), apiBase: apiBase() }), { started: stats.started, finished: stats.finished, slides: stats.slides, average_seconds: stats.avg_seconds }))
    }
    if (['themes', 'images'].includes(seg[0])) return fail('NOT_FOUND', 'The site has no themes or images API: a form is drawn in the site\'s design.')
    return fail('NOT_FOUND')
  } catch (e) {
    console.error('forms-api', e)
    return fail('BAD_REQUEST', String((e as Error)?.message ?? e))
  }

  async function listForms(q: Record<string, string>) {
    const search = String(q.search || '').trim().toLowerCase()
    const pageSize = Math.min(200, Math.max(1, Number(q.page_size) || 10)), page = Math.max(1, Number(q.page) || 1)
    const all = (await published()).map(([, f]) => listItemOf(f, { site: site(), apiBase: apiBase() })).filter((it) => !search || String(it.title).toLowerCase().includes(search) || String(it.id).includes(search))
    return reply({ total_items: all.length, page_count: Math.ceil(all.length / pageSize), items: all.slice((page - 1) * pageSize, page * pageSize) })
  }
  async function bodyOf(r: Request) { try { return await r.json() } catch { return null } }
  /* a definition written as a forms.md document through the pipe, published at once (Typeform has no draft), pushed */
  async function writeForm(id: string | null, def: any) {
    if (!CLOUD) return fail('METHOD_NOT_ALLOWED', 'This site keeps its forms as files in a checkout (git mode): a form is written in the admin. The Forms API writes in cloud mode (CONTENT_STORE=cloud).')
    if (!def || typeof def !== 'object') return fail('BAD_REQUEST', 'The body is a form definition.')
    let made: { id: string; title: string; published: boolean; model: any }
    try { made = modelFromDefinition(def, { id }) } catch (e: any) { return fail(e?.code === 'UNSUPPORTED_TYPE' || e?.code === 'LOGIC' ? 'BAD_REQUEST' : 'VALIDATION_ERROR', String(e?.message ?? e)) }
    const maker = await makerOf(caller as any)
    const { call } = pipeFor(maker.by)
    const current = await call('GET', 'file', { col: 'forms', name: made.id })
    const exists = current.status === 200
    if (!id && exists) return fail('VALIDATION_ERROR', `A form "${made.id}" exists: PUT /forms/${made.id} to replace it.`)
    const w = await call('POST', 'file', {}, { col: 'forms', name: made.id, data: { title: made.title, published: made.published }, content: '', parsed: made.model, create: !exists })
    if (w.status !== 200) { const b: any = w.body || {}; return fail(w.status === 422 || w.status === 400 ? 'VALIDATION_ERROR' : 'BAD_REQUEST', String(b.error || (b.issues || []).map((i: any) => i.message).join('; ') || 'the document was refused')) }
    const p = await call('POST', 'publish', {}, { col: 'forms', name: made.id }); if (p.status !== 200 && p.status !== 404) { const b: any = p.body || {}; return fail('BAD_REQUEST', String(b.error || 'the publish failed')) }
    await pushPending(admin, maker.by, { message: `${exists ? 'update' : 'create'} forms/${made.id} (Forms API)` }).catch(() => {})
    invalidateForms()
    const form = (await formsNow())[made.id]
    if (!form) return fail('BAD_REQUEST', 'The form was written but does not read back.')
    return reply(definitionOf(form, { site: site(), apiBase: apiBase(), long: (f: any) => !!f.multiline }), exists ? 200 : 201)
  }
  async function deleteForm(id: string) {
    if (!CLOUD) return fail('METHOD_NOT_ALLOWED', 'This site keeps its forms as files in a checkout (git mode): a form is removed in the admin.')
    const maker = await makerOf(caller as any)
    const { call } = pipeFor(maker.by)
    const r = await call('DELETE', 'file', { col: 'forms', name: id }); if (r.status === 404) return fail('NOT_FOUND', `No form "${id}".`); if (r.status !== 200) return fail('BAD_REQUEST', String((r.body as any)?.error || 'the delete failed'))
    const p = await call('POST', 'publish', {}, { col: 'forms', name: id }); if (p.status !== 200 && p.status !== 404) return fail('BAD_REQUEST', String((p.body as any)?.error || 'the publish failed'))
    await pushPending(admin, maker.by, { message: `delete forms/${id} (Forms API)` }).catch(() => {})
    invalidateForms()
    return reply(null, 204)
  }
})
