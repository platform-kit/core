/* The Forms API (forms-api): the site's forms as Typeform's.
   (1) Under Node: a document of every kind through the parser and `apiShape` to Typeform's definition — the kind map,
       a group per slide, a statement for free markdown, the jump condition as logic, the screens; a row to Typeform's
       response item, typed by kind; the Responses query recomputed. (2) With the stack up and the function served: the
       official `@typeform/api-client` pointed at the site (`apiBaseUrl`) — forms, a definition, responses, me,
       workspaces — the refusals (no key, a revoked one, a content key), a webhook put, delivered on a completion and
       verified with its secret, listed, deleted; a response deleted with its rows; the insights summary. (3) On
       Playwright: `@typeform/embed` on a page of another origin, `createWidget` with the site's address, the callbacks.
   (4) The writes: a definition to the builder's model to a forms.md document and back (document.js), the refusals, JSON
       Patch; on the demo in cloud mode the life of a form through the client — create, get, list, update, patch, the
       runner's page, delete; in git mode the 405.
   Skipped where the stack is down or the forms module is off; FORMS_API_TEST=0 skips it. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { loadSite } from './site.mjs'
import { parseForm } from '../src/lib/forms/parse.js'
import { apiShape } from './forms.mjs'
import { definitionOf, listItemOf, flatFields, TYPE_OF } from '../supabase/functions/_shared/api/typeform/definition.js'
import { itemOf, answerOf, webhookPayloadOf, fileUrlOf } from '../supabase/functions/_shared/api/typeform/response.js'
import { parseResponsesQuery, applyResponsesQuery } from '../supabase/functions/_shared/api/typeform/query.js'
import { summaryOf } from '../supabase/functions/_shared/api/typeform/insights.js'
import { modelFromDefinition, applyPatch } from '../supabase/functions/_shared/api/typeform/document.js'
import { serialiseForm } from './form-io.mjs'
import { context as browserContext } from './browser.mjs'   /* one timeout for every browser here: build/browser.mjs */
import { leave, notHere, stackOf } from './test-stack.mjs'

const note = (m) => console.log('forms-api: ' + m)
if (process.env.FORMS_API_TEST === '0') { note('skipped (FORMS_API_TEST=0)'); process.exit(0) }
const ROOT = process.cwd()
const c = await loadSite(ROOT)
if (c.modules.forms === false || c.modules.api === false) { note('the forms or the api module is off — nothing to check'); { notHere('forms-api.test.mjs', 'its module is off'); process.exit(0) } }
let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + (e && e.message ? e.message.split('\n').join('\n    ') : e)) } }

/* ---- (1) the shapes under Node ---- */
const EVERY = `#! title = Every kind
#! meta-description = One of each.
#! score = pick: b
#! pass = 1

-> start -> Begin

# Welcome
A line under the title.

---
|> 1/3

name* = TextInput(| question = Your name | placeholder = Jane)
about = TextInput(| question = About you | description = A paragraph | multiline)
email* = EmailInput(| question = Email)
site = UrlInput(| question = Site)
phone = TelInput(| question = Phone)
secret = PasswordInput(| question = A word)
age = NumberInput(| question = Age | min = 1 | max = 120)

---
|> 2/3

city = SelectBox(| question = City | options = Paris, Rome, Oslo)
pick* = ChoiceInput(| question = Pick one | choices = a, "b" Bee, c)
many = ChoiceInput(| question = Pick some | choices = x, y, z | multiple)
pic = PictureChoice(| question = A picture | choices = Sun && /a.png, Moon && /b.png)
stars = RatingInput(| question = Stars | outof = 7)
scale = OpinionScale(| question = How likely | startat = 1 | outof = 10 | labelstart = Not | labelend = Very)

---
-> pick == 'b'
|> 3/3

Some free words before the fields.

when = DatetimeInput(| question = When)
day = DateInput(| question = Day)
at = TimeInput(| question = At)
doc = FileInput(| question = A file)

---
-> end -> https://example.com/thanks

# Thanks
`
const model = parseForm(EVERY)
assert.deepEqual(model.errors, [], 'the every-kind document parses: ' + JSON.stringify(model.errors))
const compiled = { title: model.title, kit: model.kit, settings: { page: model.settings.page }, api: apiShape(model, 'every') }
const def = definitionOf(compiled, { site: 'https://x.test', apiBase: 'https://x.test/api/forms' })

await ok('a definition: every kind in Typeform\'s type, a group per slide, a statement for free markdown, the screens, the links', () => {
  assert.equal(def.id, 'every'); assert.equal(def.type, 'quiz'); assert.equal(def.title, 'Every kind')
  assert.equal(def.fields.length, 3, 'three body slides → three groups'); assert.ok(def.fields.every((g) => g.type === 'group'))
  const flat = flatFields(def)
  const types = Object.fromEntries(flat.map((f) => [f.id, f.type]))
  assert.deepEqual(types, { name: 'short_text', about: 'short_text', email: 'email', site: 'website', phone: 'phone_number', secret: 'short_text', age: 'number', city: 'dropdown', pick: 'multiple_choice', many: 'multiple_choice', pic: 'picture_choice', stars: 'rating', scale: 'opinion_scale', when: 'date', day: 'date', at: 'short_text', doc: 'file_upload' })
  for (const [kind, type] of Object.entries(TYPE_OF)) assert.ok(typeof type === 'string' && type, kind)
  const pick = flat.find((f) => f.id === 'pick'); assert.deepEqual(pick.properties.choices.map((x) => x.label), ['a', 'Bee', 'c']); assert.equal(pick.properties.allow_multiple_selection, false); assert.equal(pick.ref, 'pick')
  assert.equal(flat.find((f) => f.id === 'many').properties.allow_multiple_selection, true)
  assert.equal(flat.find((f) => f.id === 'pic').properties.choices[0].attachment.href, '/a.png')
  assert.equal(flat.find((f) => f.id === 'stars').properties.steps, 7)
  const sc = flat.find((f) => f.id === 'scale'); assert.deepEqual([sc.properties.steps, sc.properties.start_at_one, sc.properties.labels.left, sc.properties.labels.right], [10, true, 'Not', 'Very'])
  assert.deepEqual([flat.find((f) => f.id === 'age').validations.min_value, flat.find((f) => f.id === 'age').validations.max_value], [1, 120])
  assert.equal(flat.find((f) => f.id === 'name').validations.required, true); assert.equal(flat.find((f) => f.id === 'about').validations.required, false)
  assert.equal(flat.find((f) => f.id === 'about').properties.description, 'A paragraph')
  const third = def.fields[2]; assert.equal(third.properties.fields[0].type, 'statement'); assert.equal(third.properties.fields[0].title, 'Some free words before the fields.')
  assert.equal(def.welcome_screens[0].title, 'Welcome'); assert.equal(def.welcome_screens[0].properties.button_text, 'Begin')
  assert.equal(def.thankyou_screens[0].title, 'Thanks'); assert.equal(def.thankyou_screens[0].properties.button_mode, 'redirect'); assert.equal(def.thankyou_screens[0].properties.redirect_url, 'https://example.com/thanks')
  assert.equal(def._links.display, 'https://x.test/to/every'); assert.equal(def._links.responses, 'https://x.test/api/forms/forms/every/responses')
  assert.equal(def.settings.meta.description, 'One of each.')
})
await ok('the jump condition as logic: shown only when pick is b → jump past the slide from the field before it when pick is not b', () => {
  assert.equal(def.logic.length, 1)
  const l = def.logic[0]; assert.equal(l.type, 'field'); assert.equal(l.ref, 'scale', 'from the last field of the slide before')
  assert.deepEqual(l.actions[0].details.to, { type: 'thankyou', value: 'default_tys' }, 'past the last body slide is the end')
  assert.deepEqual(l.actions[0].condition, { op: 'not_equal', vars: [{ type: 'field', value: 'pick' }, { type: 'constant', value: 'b' }] })
})
await ok('a response item: every answer typed by its kind, the token the row, the times, the metadata, the score', () => {
  const row = { id: 'r1', form: 'every', anon_id: 'abcdef12-0000-4000-8000-000000000000', user_id: null, origin: '/x', started_at: '2026-09-01T10:00:00Z', completed_at: '2026-09-01T10:04:00Z', score: 1, meta: { user_agent: 'UA', referer: 'https://ref', platform: 'other', browser: 'default', hidden: { utm: 'a' } } }
  const rows = [['name', 'Jane'], ['about', 'Long'], ['email', 'j@x.y'], ['site', 'https://j.x'], ['phone', '+1 555'], ['age', 40], ['city', 'Rome'], ['pick', 'b'], ['many', ['x', 'z']], ['pic', 'Sun'], ['stars', 5], ['scale', 9], ['when', '2026-09-02T09:30'], ['day', '2026-09-03'], ['at', '09:30']].map(([field, value]) => ({ field, value, file_path: null }))
  rows.push({ field: 'doc', value: 'cv.pdf', file_path: 'r1/doc/cv.pdf', file_name: 'cv.pdf' })
  const item = itemOf(row, rows, compiled, (p) => fileUrlOf('https://x.test/api/forms', 'every', p))
  assert.equal(item.token, 'r1'); assert.equal(item.response_id, 'r1'); assert.equal(item.landed_at, '2026-09-01T10:00:00.000Z'); assert.equal(item.submitted_at, '2026-09-01T10:04:00.000Z')
  assert.deepEqual(item.metadata, { user_agent: 'UA', platform: 'other', referer: 'https://ref', network_id: 'abcdef12', browser: 'default' }); assert.deepEqual(item.hidden, { utm: 'a' }); assert.equal(item.calculated.score, 1)
  const by = Object.fromEntries(item.answers.map((a) => [a.field.id, a]))
  assert.deepEqual(item.answers.map((a) => a.field.id), ['name', 'about', 'email', 'site', 'phone', 'age', 'city', 'pick', 'many', 'pic', 'stars', 'scale', 'when', 'day', 'at', 'doc'], 'in the form\'s order')
  assert.deepEqual([by.name.type, by.name.text], ['text', 'Jane']); assert.deepEqual([by.email.type, by.email.email], ['email', 'j@x.y']); assert.deepEqual([by.site.type, by.site.url], ['url', 'https://j.x']); assert.deepEqual([by.phone.type, by.phone.phone_number], ['phone_number', '+1 555'])
  assert.deepEqual([by.age.type, by.age.number], ['number', 40]); assert.deepEqual([by.stars.type, by.stars.number], ['number', 5]); assert.deepEqual([by.scale.type, by.scale.number], ['number', 9])
  assert.deepEqual(by.pick, { field: { id: 'pick', type: 'multiple_choice', ref: 'pick' }, type: 'choice', choice: { id: 'b', ref: 'b', label: 'Bee' } })
  assert.deepEqual(by.many.choices, { ids: ['x', 'z'], refs: ['x', 'z'], labels: ['x', 'z'] }); assert.equal(by.many.type, 'choices')
  assert.deepEqual([by.city.type, by.city.choice.label], ['choice', 'Rome']); assert.deepEqual([by.pic.type, by.pic.choice.label], ['choice', 'Sun'])
  assert.equal(by.day.type, 'date'); assert.equal(by.day.date, '2026-09-03T00:00:00.000Z'); assert.equal(by.when.type, 'date')
  assert.equal(by.doc.type, 'file_url'); assert.equal(by.doc.file_url, 'https://x.test/api/forms/forms/every/responses/r1/fields/doc/files/cv.pdf')
  assert.equal(by.at.type, 'text')
  const p = webhookPayloadOf(item, def, 'e1'); assert.equal(p.event_type, 'form_response'); assert.equal(p.form_response.form_id, 'every'); assert.equal(p.form_response.token, 'r1'); assert.equal(p.form_response.definition.fields.length, def.fields.length); assert.equal(p.form_response.answers.length, 16)
  const li = listItemOf(compiled, { site: 'https://x.test', apiBase: 'https://x.test/api/forms' }); assert.equal(li.id, 'every'); assert.equal(li._links.display, 'https://x.test/to/every')
})
await ok('the Responses query: the arguments read, the page by token, the filters', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ row: { id: 'r' + i, started_at: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(), completed_at: i % 3 === 2 ? null : new Date(Date.UTC(2026, 8, 1 + i, 1)).toISOString() }, answers: [{ field: 'name', value: i % 2 ? 'Jane' : 'Bob' }, ...(i % 5 === 0 ? [{ field: 'email', value: 'e@x' }] : [])] }))
  const p1 = parseResponsesQuery({ page_size: '10' }); assert.deepEqual(p1.errors, []); const r1 = applyResponsesQuery(p1, structuredClone(items)); assert.equal(r1.total_items, 30); assert.equal(r1.page_count, 3); assert.equal(r1.items.length, 10); assert.equal(r1.items[0].row.id, 'r29', 'newest first by submitted_at (a row not yet submitted sorts by its start)')
  const p2 = parseResponsesQuery({ page_size: '10', after: r1.items[9].row.id }); const r2 = applyResponsesQuery(p2, structuredClone(items)); assert.equal(r2.items[0].row.id, 'r19', 'the page after a token')
  const done = applyResponsesQuery(parseResponsesQuery({ completed: 'true', page_size: '100' }), structuredClone(items)); assert.equal(done.total_items, 20)
  const open = applyResponsesQuery(parseResponsesQuery({ completed: 'false', page_size: '100' }), structuredClone(items)); assert.equal(open.total_items, 10)
  const since = applyResponsesQuery(parseResponsesQuery({ since: '2026-09-20T00:00:00Z', page_size: '100' }), structuredClone(items)); assert.ok(since.total_items > 0 && since.items.every((it) => (it.row.completed_at || it.row.started_at) >= '2026-09-20'))
  const jane = applyResponsesQuery(parseResponsesQuery({ query: 'jane', page_size: '100' }), structuredClone(items)); assert.equal(jane.total_items, 15)
  const withEmail = applyResponsesQuery(parseResponsesQuery({ answered_fields: 'email', page_size: '100' }), structuredClone(items)); assert.equal(withEmail.total_items, 6)
  const only = applyResponsesQuery(parseResponsesQuery({ fields: 'email', page_size: '100' }), structuredClone(items)); assert.ok(only.items.every((it) => it.answers.every((a) => a.field === 'email')))
  const ids = applyResponsesQuery(parseResponsesQuery({ included_response_ids: 'r1,r2' }), structuredClone(items)); assert.equal(ids.total_items, 2)
  const asc = applyResponsesQuery(parseResponsesQuery({ sort: 'landed_at,asc' }), structuredClone(items)); assert.equal(asc.items[0].row.id, 'r0')
  assert.ok(parseResponsesQuery({ page_size: '5000' }).errors.length); assert.ok(parseResponsesQuery({ completed: 'maybe' }).errors.length); assert.ok(parseResponsesQuery({ sort: 'name,up' }).errors.length)
})
await ok('the insights summary: views and drop-offs per field from the slides reached', () => {
  const s = summaryOf(def, { started: 100, finished: 40, slides: [{ slide: 1, reached: 100 }, { slide: 2, reached: 70 }, { slide: 3, reached: 50 }], average_seconds: 90 })
  assert.equal(s.form.summary.completion_rate, 40); assert.equal(s.form.summary.total_visits, 100); assert.equal(s.form.summary.responses_count, 40); assert.equal(s.form.summary.average_time, 90)
  assert.equal(s.fields.length, 17); assert.equal(s.fields.find((f) => f.id === 'age').views, 100); assert.equal(s.fields.find((f) => f.id === 'age').dropoffs, 30, 'the last field of slide 1 loses those who never reached slide 2')
})

/* ---- (2) the served door ---- */
/* ---- (4) the writes: a definition back to a document, and the life of a form through the client in cloud mode ---- */
const PROBE_DEF = (title) => ({
  title,
  settings: { is_public: true, show_progress_bar: true, meta: { description: 'A probe.' } },
  welcome_screens: [{ ref: 'welcome', title: 'Welcome', properties: { button_text: 'Begin', description: 'Two minutes.' } }],
  thankyou_screens: [{ ref: 'default_tys', title: 'Thanks', properties: { button_mode: 'redirect', redirect_url: 'https://example.com/done' } }],
  fields: [
    { ref: 'about', type: 'group', title: 'About you', properties: { fields: [
      { ref: 'name', type: 'short_text', title: 'Your name', validations: { required: true } },
      { ref: 'email', type: 'email', title: 'Your email', validations: { required: true } },
    ] } },
    { ref: 'interest', type: 'multiple_choice', title: 'What brings you here?', properties: { choices: [{ ref: 'reading', label: 'Reading' }, { ref: 'writing', label: 'Writing' }, { ref: 'other', label: 'Something else' }] }, validations: { required: true } },
    { ref: 'more', type: 'group', title: 'Tell us', properties: { fields: [{ ref: 'other_text', type: 'long_text', title: 'Tell us what' }] } },
    { ref: 'score', type: 'opinion_scale', title: 'How likely are you to recommend us?', properties: { steps: 10, start_at_one: false, labels: { left: 'Not at all', right: 'Very' } } },
    { ref: 'note', type: 'statement', title: 'Nearly done', properties: { description: 'One last thing.' } },
  ],
  logic: [{ type: 'field', ref: 'interest', actions: [{ action: 'jump', details: { to: { type: 'field', value: 'score' } }, condition: { op: 'not_equal', vars: [{ type: 'field', value: 'interest' }, { type: 'constant', value: 'other' }] } }] }],
})
await ok('a definition → the builder\'s model → a forms.md document → the same definition: two groups, the kinds, the choices, the scale, a statement, the screens and the one logic jump', () => {
  const { id, title, published, model: m } = modelFromDefinition(PROBE_DEF('Probe survey'))
  assert.deepEqual([id, title, published], ['probe-survey', 'Probe survey', true])
  const doc = serialiseForm(m, null)
  const back = parseForm(doc); assert.deepEqual(back.errors, [], JSON.stringify(back.errors)); assert.deepEqual(back.warnings, [])
  assert.ok(doc.includes('#! title = Probe survey') && doc.includes('-> start -> Begin') && doc.includes('-> end -> https://example.com/done') && doc.includes("-> interest == 'other'") && doc.includes('| multiline'), doc)
  const again = definitionOf({ title: back.title, kit: back.kit, settings: { page: back.settings.page }, api: apiShape(back, id) }, { long: (f) => !!f.multiline })
  const types = flatFields(again).map((f) => f.type + ':' + f.ref)
  assert.deepEqual(types, ['short_text:name', 'email:email', 'multiple_choice:interest', 'long_text:other_text', 'opinion_scale:score'])
  assert.deepEqual(again.fields.map((g) => g.properties.fields.length), [2, 1, 1, 1, 1], 'a group per slide')
  assert.deepEqual(again.logic, PROBE_DEF('x').logic, 'the jump comes back as given')
  assert.equal(flatFields(again).find((f) => f.ref === 'interest').properties.choices.map((c) => c.label).join(','), 'Reading,Writing,Something else')
  assert.deepEqual([again.welcome_screens[0].properties.button_text, again.thankyou_screens[0].properties.redirect_url], ['Begin', 'https://example.com/done'])
  const sc = flatFields(again).find((f) => f.ref === 'score'); assert.deepEqual([sc.properties.steps, sc.properties.labels.left, sc.properties.labels.right], [10, 'Not at all', 'Very'])
  /* the refusals */
  assert.throws(() => modelFromDefinition({ title: 'x', fields: [{ ref: 'pay', type: 'payment', title: 'Pay' }] }), (e) => e.code === 'UNSUPPORTED_TYPE' && /payment/.test(e.message))
  assert.throws(() => modelFromDefinition({ title: 'x', fields: [{ ref: 'a', type: 'short_text', title: 'A' }, { ref: 'b', type: 'short_text', title: 'B' }, { ref: 'c', type: 'short_text', title: 'C' }], logic: [{ type: 'field', ref: 'a', actions: [{ action: 'jump', details: { to: { type: 'field', value: 'c' } }, condition: { op: 'begins_with', vars: [{ type: 'field', value: 'a' }, { type: 'constant', value: 'x' }] } }] }] }), (e) => e.code === 'LOGIC' && /begins_with/.test(e.message))
  assert.throws(() => modelFromDefinition({ title: 'x', fields: [{ ref: 'a', type: 'short_text', title: 'A' }, { ref: 'b', type: 'short_text', title: 'B' }], logic: [{ type: 'field', ref: 'a', actions: [{ action: 'jump', details: { to: { type: 'field', value: 'a' } }, condition: { op: 'always', vars: [] } }] }] }), (e) => e.code === 'LOGIC')
  assert.throws(() => modelFromDefinition({ fields: [] }), (e) => e.code === 'VALIDATION_ERROR')
  /* JSON Patch */
  const patched = applyPatch(again, [{ op: 'replace', path: '/title', value: 'Probe survey 2' }, { op: 'add', path: '/fields/-', value: { ref: 'when', type: 'date', title: 'When?' } }, { op: 'remove', path: '/fields/0/properties/fields/1' }, { op: 'test', path: '/settings/is_public', value: true }])
  assert.equal(patched.title, 'Probe survey 2'); assert.equal(patched.fields.length, 6); assert.equal(patched.fields[0].properties.fields.length, 1)
  assert.throws(() => applyPatch(again, [{ op: 'replace', path: '/nope/x', value: 1 }]), /no such path/)
  assert.throws(() => applyPatch(again, [{ op: 'test', path: '/title', value: 'other' }]), /test at/)
})

const url = supabaseUrl(), anon = process.env.VITE_SUPABASE_ANON_KEY || ''
let served = false
try { served = !!(url && anon && localStack()) && (await fetch(url + '/functions/v1/forms-api/forms', { signal: AbortSignal.timeout(4000) })).status === 401 } catch { /* down */ }
if (!served) { note(`${pass} passed${fail ? ', ' + fail + ' failed' : ''} (the shapes — the local stack is not up or the forms-api function is not served)`); leave(fail ? 1 : 0) }
execFileSync(process.execPath, [new URL('./forms.mjs', import.meta.url).pathname], { stdio: 'ignore' })
/* the functions server reloads on the file's write: wait for it to answer again before asking anything */
for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 500)); try { const r = await fetch(url + '/functions/v1/forms-api/forms', { signal: AbortSignal.timeout(4000) }); if (r.status === 401) { await new Promise((x) => setTimeout(x, 1000)); break } } catch { /* reloading */ } }
const FORMS = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/forms.json'), 'utf8'))
const live = Object.entries(FORMS).filter(([, f]) => f.kit?.published !== false && f.settings?.page === 'form-slides').map(([k]) => k)
if (!live.length) { note(`${pass} passed — no published form on this site; the door is checked on the demo`); leave(fail ? 1 : 0) }
const { createClient } = await import('@supabase/supabase-js')
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const API = url + '/functions/v1/forms-api'
const sha256 = async (s) => { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('') }
const made = []
const makeKey = async (kind) => { const key = `pk_${kind}_probe${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; const { data: admin } = await service.from('profiles').select('id').eq('email', 'admin@example.com').maybeSingle(); const { error } = await service.from('api_keys').insert({ name: 'forms-api test', kind, gated: false, prefix: key.slice(0, 12), hash: await sha256(key), created_by: admin ? admin.id : null }); if (error) throw new Error(error.message); made.push(key); return key }
const get = async (p, headers = {}, init = {}) => { const r = await fetch(API + p, { headers, ...init }); return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) } }
try {
  const key = await makeKey('forms')
  const { createClient: tf } = await import('@typeform/api-client')
  const client = tf({ token: key, apiBaseUrl: API })
  /* the form with the most responses, and one of its completed responses */
  const { data: counts } = await service.from('form_responses').select('form').in('form', live).not('completed_at', 'is', null)
  const tally = {}; for (const r of counts ?? []) tally[r.form] = (tally[r.form] || 0) + 1
  const slug = live.sort((a, b) => (tally[b] || 0) - (tally[a] || 0))[0]
  /* a completion on the runner's function, as a guest — the site's every field answered with something of its kind */
  const complete = async (email) => {
    const form = FORMS[slug]
    const fd = new FormData(); fd.append('_form', slug); fd.append('_slide', '0'); fd.append('_end', 'true')
    for (const f of form.fields) { if (f.kind === 'file') continue; fd.append(f.name, f.values && f.values.length ? f.values[0] : f.kind === 'email' ? email : f.kind === 'number' || f.kind === 'rating' || f.kind === 'scale' ? '3' : f.kind === 'date' ? '2026-01-01' : f.kind === 'url' ? 'https://example.com' : 'probe') }
    const r = await fetch(url + '/functions/v1/form', { method: 'POST', headers: { apikey: anon, Authorization: 'Bearer ' + anon, 'x-form-anon': crypto.randomUUID() }, body: fd })
    const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.ok(j.completed && j.response_id, JSON.stringify(j)); return j.response_id
  }
  const seeded = tally[slug] ? null : await complete('seed@example.com')

  await ok('the official client, one base changed: forms, a definition, responses, me, workspaces', async () => {
    /* a page holds ten by default, as Typeform's does: a site with more forms than that is asked for all of them */
    const list = await client.forms.list({ pageSize: 200 })
    assert.equal(list.total_items, live.length); assert.deepEqual(list.items.map((i) => i.id).sort(), live.sort()); assert.ok(list.items[0]._links.display.endsWith('/to/' + list.items[0].id))
    const form = await client.forms.get({ uid: slug })
    assert.equal(form.id, slug); assert.ok(Array.isArray(form.fields) && form.fields.length); assert.ok(form.fields.every((g) => g.type === 'group'))
    const mine = definitionOf(FORMS[slug], { site: 'x', apiBase: 'y' }); assert.equal(flatFields(form).length, flatFields(mine).length, 'the served definition is the shape\'s')
    const res = await client.responses.list({ uid: slug, pageSize: 5, completed: 'true' })
    assert.ok(res.total_items >= 1); assert.ok(res.items.length <= 5); assert.ok(res.items.every((it) => it.submitted_at && it.answers.length && it.token === it.response_id))
    const first = res.items[0]; assert.ok(first.answers.every((a) => a.field && a.field.id && a.field.ref && a.type))
    const me = (await get('/me', { Authorization: 'Bearer ' + key })).body; assert.ok(me.alias && typeof me.user_id === 'string', JSON.stringify(me))
    const ws = await client.workspaces.list(); assert.equal(ws.items[0].id, 'default')
    const one = await client.responses.list({ uid: slug, pageSize: 1, ids: first.token }); assert.equal(one.total_items, 1)
  })
  await ok('no key, a revoked key, a content key: Typeform\'s errors', async () => {
    const none = await get('/forms'); assert.equal(none.status, 401); assert.equal(none.body.code, 'AUTHENTICATION_FAILED')
    const dk = await makeKey('delivery'); const other = await get('/forms', { Authorization: 'Bearer ' + dk }); assert.equal(other.status, 403); assert.equal(other.body.code, 'FORBIDDEN')
    const rk = await makeKey('forms'); await service.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('hash', await sha256(rk))
    const revoked = await get('/forms', { Authorization: 'Bearer ' + rk }); assert.equal(revoked.status, 401)
    const bad = await get('/forms/' + slug + '/responses?page_size=9999', { Authorization: 'Bearer ' + key }); assert.equal(bad.status, 400); assert.equal(bad.body.code, 'VALIDATION_ERROR')
    const nf = await get('/forms/nope', { Authorization: 'Bearer ' + key }); assert.equal(nf.status, 404); assert.equal(nf.body.code, 'NOT_FOUND')
    const write = await get('/forms', { Authorization: 'Bearer ' + dk, 'content-type': 'application/json' }, { method: 'POST', body: '{}' }); assert.equal(write.status, 403, 'a content key is refused a write too')
    assert.ok(none.headers.get('access-control-allow-origin'))
  })
  await ok('a webhook: put through the client, delivered on a completion and verified with its secret, listed, deleted, then silent', async () => {
    /* a local receiver */
    const got = []
    const server = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push({ sig: req.headers['typeform-signature'], body: b }); res.writeHead(200); res.end('ok') }) })
    await new Promise((r) => server.listen(0, '0.0.0.0', r))
    const port = server.address().port
    const receiver = `http://host.docker.internal:${port}/hook`
    try {
      const secret = 'shh-' + Math.random().toString(36).slice(2)
      const w = await client.webhooks.create({ uid: slug, tag: 'probe', url: receiver, enabled: true, secret })
      assert.equal(w.tag, 'probe'); assert.equal(w.enabled, true); assert.equal(w.url, receiver); assert.equal(w.secret, undefined, 'the secret is never answered back')
      const list = await client.webhooks.list({ uid: slug }); assert.ok(list.items.some((x) => x.tag === 'probe'))
      const j = { response_id: await complete('probe@example.com') }
      for (let i = 0; i < 40 && !got.length; i++) await new Promise((x) => setTimeout(x, 250))
      assert.equal(got.length, 1, 'one delivery')
      const payload = JSON.parse(got[0].body)
      assert.equal(payload.event_type, 'form_response'); assert.equal(payload.form_response.form_id, slug); assert.equal(payload.form_response.token, j.response_id); assert.ok(payload.form_response.definition.fields.length); assert.ok(payload.form_response.answers.length)
      const expect = 'sha256=' + createHmac('sha256', secret).update(got[0].body).digest('base64')
      assert.equal(got[0].sig, expect, 'Typeform-Signature verifies with the secret')
      /* the response lists on the API, then is deleted with its rows */
      const listed = await client.responses.list({ uid: slug, ids: j.response_id }); assert.equal(listed.total_items, 1)
      await client.responses.delete({ uid: slug, ids: j.response_id })
      const gone = await client.responses.list({ uid: slug, ids: j.response_id }); assert.equal(gone.total_items, 0)
      const { data: rows } = await service.from('form_answers').select('id').eq('response_id', j.response_id); assert.equal((rows ?? []).length, 0)
      /* deleted: the next completion is not delivered */
      await client.webhooks.delete({ uid: slug, tag: 'probe' })
      const after = await client.webhooks.list({ uid: slug }); assert.ok(!after.items.some((x) => x.tag === 'probe'))
      const j2 = { response_id: await complete('probe2@example.com') }
      await new Promise((x) => setTimeout(x, 1500)); assert.equal(got.length, 1, 'nothing more arrives')
      await client.responses.delete({ uid: slug, ids: j2.response_id })
    } finally { server.close(); await service.from('form_webhooks').delete().eq('tag', 'probe') }
  })
  await ok('the insights summary from the served numbers', async () => {
    const s = await client.insights.summary({ uid: slug })
    assert.ok(s.form.summary.total_visits >= s.form.summary.responses_count); assert.ok(s.fields.length)
  })
  /* ---- (3) the embed on Playwright ---- */
  await ok('@typeform/embed on another origin: the widget shows the site\'s form, reports ready and the screens, and finishing reports the response', async () => {
    const appUrl = (stackOf()?.app || '').replace(/\/+$/, '')
    let up = false; try { up = (await fetch(appUrl + '/to/' + slug, { signal: AbortSignal.timeout(3000) })).ok } catch { /* down */ }
    if (!up) { note('the dev server is not up at ' + appUrl + ' — the embed is checked by hand'); return }
    const embedJs = fs.readFileSync(new URL(import.meta.resolve('@typeform/embed/build/embed.js')), 'utf8')
    const embedCss = fs.readFileSync(new URL(import.meta.resolve('@typeform/embed/build/css/widget.css')), 'utf8')
    const page = `<!doctype html><html><head><style>${embedCss}</style></head><body><div id="w" style="height:600px"></div><script>${embedJs}</script><script>
      window.events = []
      tf.createWidget('${appUrl}/to/${slug}', { container: document.getElementById('w'), onReady: () => events.push('ready'), onStarted: () => events.push('started'), onQuestionChanged: (e) => events.push('q:' + e.ref), onHeightChanged: (e) => events.push('h:' + e.height), onSubmit: (e) => events.push('submit:' + e.responseId) })
    </script></body></html>`
    const host = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page) })
    await new Promise((r) => host.listen(0, '127.0.0.1', r))
    const origin = 'http://127.0.0.1:' + host.address().port
    try {
      const { chromium } = await import('playwright')
      const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH
      const b = await chromium.launch(exe ? { executablePath: exe } : {})
      const p = await (await browserContext(b, { viewport: { width: 1280, height: 900 } })).newPage()
      const errs = []; p.on('pageerror', (e) => errs.push(e.message))
      await p.goto(origin + '/', { waitUntil: 'load' })
      await p.waitForFunction(() => window.events.includes('ready'), null, { timeout: 30000 })
      const iframe = await p.$('#w iframe'); assert.ok(iframe, 'the iframe'); const src = await iframe.getAttribute('src'); assert.ok(src.includes('/to/' + slug + '?') && src.includes('typeform-embed=embed-widget'), src)
      const ev = await p.evaluate(() => window.events)
      assert.ok(ev.some((e) => e.startsWith('h:')), 'the height reported: ' + ev.join(','))
      assert.ok(ev.some((e) => e.startsWith('q:')), 'a screen reported: ' + ev.join(','))
      assert.deepEqual(errs, [])
      const dir = process.env.FORMS_API_SHOTS; if (dir) { await p.waitForTimeout(1500); await p.screenshot({ path: path.join(dir, 'typeform-embed-1280.png') }) }
      await b.close()
    } finally { host.close() }
  })
  if (seeded) await client.responses.delete({ uid: slug, ids: seeded })
  /* the writes on the served function: cloud mode on the demo, 405 in git mode */
  const cloudMode = fs.existsSync(path.join(ROOT, '.env.dev')) && /^CONTENT_STORE=cloud/m.test(fs.readFileSync(path.join(ROOT, '.env.dev'), 'utf8'))
  if (!cloudMode) await ok('in git mode a write is 405 with the reason', async () => {
    const r = await get('/forms', { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, { method: 'POST', body: JSON.stringify(PROBE_DEF('Probe')) }); assert.equal(r.status, 405); assert.match(r.body.description, /git mode/)
    assert.equal((await get('/forms/' + slug, { Authorization: 'Bearer ' + key }, { method: 'DELETE' })).status, 405)
    note('git mode — the life of a form through the client is checked on the demo in cloud mode')
  })
  else await ok('the life of a form through the client: created, read back the same, listed, updated whole and by a JSON Patch, shown by the runner, deleted; the refusals name the type and the line', async () => {
    const probe = 'probe-' + Date.now().toString(36)
    const cleanup = async () => { await get('/forms/' + probe, { Authorization: 'Bearer ' + key }, { method: 'DELETE' }).catch(() => {}) }
    try {
      const made = await client.forms.create({ data: { ...PROBE_DEF('Probe ' + probe), id: probe } })
      assert.equal(made.id, probe); assert.equal(made.title, 'Probe ' + probe)
      assert.deepEqual(flatFields(made).map((f) => f.type + ':' + f.ref), ['short_text:name', 'email:email', 'multiple_choice:interest', 'long_text:other_text', 'opinion_scale:score'])
      assert.deepEqual(made.logic, PROBE_DEF('x').logic)
      const read = await client.forms.get({ uid: probe }); assert.deepEqual(read.fields, made.fields); assert.deepEqual(read.logic, made.logic)
      const listed = await client.forms.list({ search: probe }); assert.ok(listed.items.some((f) => f.id === probe), 'listed')
      /* the row, and the document it holds */
      const { data: row } = await service.from('content').select('text, published_at').eq('path', 'content/forms/' + probe + '.md').maybeSingle()
      assert.ok(row && row.published_at, 'the row is live (Typeform has no draft)'); const parsed = parseForm(row.text); assert.deepEqual(parsed.errors, []); assert.equal(parsed.title, 'Probe ' + probe); assert.equal(parsed.fields.length, 5)
      /* a duplicate create is refused; a whole update by PUT */
      const dup = await get('/forms', { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, { method: 'POST', body: JSON.stringify({ ...PROBE_DEF('Probe ' + probe), id: probe }) }); assert.equal(dup.status, 400); assert.match(dup.body.description, /PUT/)
      const upd = await client.forms.update({ uid: probe, data: { ...PROBE_DEF('Probe ' + probe + ' edited') }, override: true }); assert.equal(upd.title, 'Probe ' + probe + ' edited')
      /* a JSON Patch */
      const patched = await client.forms.update({ uid: probe, data: [{ op: 'replace', path: '/title', value: 'Probe ' + probe + ' patched' }, { op: 'add', path: '/fields/-', value: { ref: 'when', type: 'date', title: 'When?' } }] })
      assert.equal(patched.title, 'Probe ' + probe + ' patched'); assert.ok(flatFields(patched).some((f) => f.ref === 'when' && f.type === 'date'), 'the field added')
      /* the refusals */
      const bad = await get('/forms/' + probe, { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, { method: 'PUT', body: JSON.stringify({ title: 'x', fields: [{ ref: 'pay', type: 'payment', title: 'Pay' }] }) }); assert.equal(bad.status, 400); assert.match(bad.body.description, /payment/)
      const badLogic = await get('/forms/' + probe, { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, { method: 'PUT', body: JSON.stringify({ title: 'x', fields: [{ ref: 'a', type: 'short_text', title: 'A' }, { ref: 'b', type: 'short_text', title: 'B' }, { ref: 'c', type: 'short_text', title: 'C' }], logic: [{ type: 'field', ref: 'a', actions: [{ action: 'jump', details: { to: { type: 'field', value: 'c' } }, condition: { op: 'begins_with', vars: [{ type: 'field', value: 'a' }, { type: 'constant', value: 'x' }] } }] }] }) }); assert.equal(badLogic.status, 400); assert.match(badLogic.body.description, /begins_with/)
      const still = await client.forms.get({ uid: probe }); assert.equal(still.title, 'Probe ' + probe + ' patched', 'a refused write changes nothing')
      /* the runner shows it, live from the rows */
      const appUrl = (stackOf()?.app || '').replace(/\/+$/, '')
      let up = false; try { up = (await fetch(appUrl + '/to/' + probe, { signal: AbortSignal.timeout(3000) })).ok } catch { /* down */ }
      if (up) {
        try {
          const { chromium } = await import('playwright')
          const shell = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell')
          const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (fs.existsSync(shell) ? shell : undefined) })
          try {
            const p = await b.newPage(); await p.goto(appUrl + '/to/' + probe, { waitUntil: 'networkidle', timeout: 30000 })
            await p.waitForFunction(() => document.body.innerText.includes('Welcome') && document.body.innerText.includes('Begin'), null, { timeout: 20000 })
            note('the runner shows the form the API wrote')
          } finally { await b.close() }
        } catch (e) { note('no browser — the runner\'s page is not looked at: ' + String(e.message).split('\n')[0]) }
      } else note('the dev server is not up at ' + appUrl + ' — the runner\'s page is checked by hand')
      /* deleted */
      await client.forms.delete({ uid: probe })
      assert.equal((await get('/forms/' + probe, { Authorization: 'Bearer ' + key })).status, 404)
      const { data: gone } = await service.from('content').select('deleted_at').eq('path', 'content/forms/' + probe + '.md').maybeSingle(); assert.ok(!gone || gone.deleted_at, 'the row is gone or marked deleted')
    } finally { await cleanup() }
  })
} finally {
  const hashes = []; for (const k of made) hashes.push(await sha256(k))
  if (hashes.length) await service.from('api_keys').delete().in('hash', hashes)
}
note(`${pass} passed${fail ? ', ' + fail + ' failed' : ''}`)
process.exit(fail ? 1 : 0)
