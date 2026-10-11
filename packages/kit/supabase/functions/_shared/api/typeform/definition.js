/*
 * A form of the compiled forms (build/forms.mjs → _shared/forms.json, its `api` part) as Typeform's form definition —
 * what `GET /forms/{id}` answers and what a webhook's `definition` carries. Plain JavaScript, no imports, pinned under
 * Node (build/forms-api.test.mjs) against Typeform's documented shape.
 *
 * The map from forms.md's kinds to Typeform's types: text → short_text (long_text when the document says so), email,
 * url → website, tel → phone_number, password → short_text, number, select → dropdown, choice → multiple_choice,
 * picture → picture_choice, rating, scale → opinion_scale, datetime/date → date, time → short_text, file →
 * file_upload; a slide is a `group` holding its fields, free markdown a `statement`, a jump condition a `logic`
 * entry on the field before the slide it guards. Ids: the form's is its slug, a field's id and ref its name, a
 * choice's its value.
 */
export const TYPE_OF = { text: 'short_text', email: 'email', url: 'website', tel: 'phone_number', password: 'short_text', number: 'number', select: 'dropdown', choice: 'multiple_choice', picture: 'picture_choice', rating: 'rating', scale: 'opinion_scale', datetime: 'date', date: 'date', time: 'short_text', file: 'file_upload' }
const OP = { is: 'equal', isnot: 'not_equal', gt: 'greater_than', lt: 'lower_than', contains: 'contains', set: 'is', unset: 'is_not' }
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'x'
const idOf = (s) => slugify(s)
/* a statement's title: the first line of the markdown, its marks dropped */
const line = (md) => String(md || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('```')) || ''
const plain = (t) => String(t || '').replace(/^#+\s*/, '').replace(/\*\*|__|`/g, '').replace(/\{\$\s*([^}]*?)\s*\$\}/g, '{$1}').trim()

export function fieldOf(f, opts = {}) {
  const type = TYPE_OF[f.kind] || 'short_text'
  const out = { id: f.name, ref: f.name, title: plain(f.question) || f.name, type, properties: {}, validations: { required: !!f.required } }
  if (f.description) out.properties.description = plain(f.description)
  if (type === 'multiple_choice' || type === 'dropdown' || type === 'picture_choice') {
    out.properties.choices = (f.choices || []).map((c) => ({ id: idOf(c.value), ref: idOf(c.value), label: c.label || c.value, ...(type === 'picture_choice' && c.image ? { attachment: { type: 'image', href: c.image } } : {}) }))
    if (type === 'multiple_choice') { out.properties.allow_multiple_selection = !!f.multiple; out.properties.allow_other_choice = false; out.properties.randomize = false; out.properties.vertical_alignment = true }
    if (type === 'dropdown') out.properties.alphabetical_order = false
    if (type === 'picture_choice') { out.properties.allow_multiple_selection = !!f.multiple; out.properties.supersized = false; out.properties.show_labels = true }
  }
  if (type === 'rating') { out.properties.steps = f.outof || 5; out.properties.shape = 'star' }
  if (type === 'opinion_scale') { out.properties.steps = f.outof || 10; out.properties.start_at_one = f.startat === 1; out.properties.labels = { left: f.labelstart || '', center: '', right: f.labelend || '' } }
  if (type === 'date') { out.properties.structure = 'YYYYMMDD'; out.properties.separator = '-' }
  if (type === 'number') { if (f.min != null && f.min !== '') out.validations.min_value = Number(f.min); if (f.max != null && f.max !== '') out.validations.max_value = Number(f.max) }
  if (type === 'phone_number') out.properties.default_country_code = 'US'
  if (f.kind === 'text' && opts.long) out.type = 'long_text'
  return out
}

export function statementOf(md, i) {
  const title = plain(line(md))
  return { id: 'statement-' + i, ref: 'statement-' + i, title, type: 'statement', properties: { button_text: 'Continue', hide_marks: true, description: plain(String(md || '').split('\n').slice(1).join('\n')) || undefined } }
}

/* the logic: a slide with a jump condition is shown only when it holds — said as a jump from the field before it,
   past it, when it does not; a condition the rows cannot say (an expression) is kept as `always` with the expression
   beside it, so a reader sees there is a rule */
function logicOf(slides, fieldsByName) {
  const out = []
  const bodies = slides.filter((s) => s.type === 'body')
  bodies.forEach((s, i) => {
    if (!s.jump) return
    const before = bodies[i - 1]; const after = bodies[i + 1]
    const from = before && [...before.items].reverse().find((it) => it.field)
    if (!from) return
    const to = after ? { type: 'field', value: (after.items.find((it) => it.field) || {}).field || 'group-' + after.index } : { type: 'thankyou', value: 'default_tys' }
    const rows = s.jumpRows || []
    if (rows.length) {
      const conds = rows.map((r) => (r.op === 'set' || r.op === 'unset' ? { op: r.op === 'set' ? 'is' : 'is_not', vars: [{ type: 'field', value: r.field }, { type: 'constant', value: true }] } : { op: OP[r.op] || 'equal', vars: [{ type: 'field', value: r.field }, { type: 'constant', value: /^-?\d+(\.\d+)?$/.test(r.value) ? Number(r.value) : r.value }] }))
      /* jump past the slide when the condition does NOT hold: Typeform has no "not", so each row's negation; a rule of
         several rows is written as one `and` of them jumping INTO the slide, and the fall-through past it */
      const neg = { equal: 'not_equal', not_equal: 'equal', greater_than: 'lower_than', lower_than: 'greater_than', is: 'is_not', is_not: 'is', contains: 'not_contains' }
      const condition = conds.length === 1 ? { op: neg[conds[0].op] || 'not_equal', vars: conds[0].vars } : { op: 'or', vars: conds.map((c) => ({ op: neg[c.op] || 'not_equal', vars: c.vars })) }
      out.push({ type: 'field', ref: from.field, actions: [{ action: 'jump', details: { to }, condition }] })
    } else out.push({ type: 'field', ref: from.field, actions: [{ action: 'jump', details: { to }, condition: { op: 'always', vars: [] } }], expression: s.jump })
  })
  return out
}

/**
 * @param {object} form  a compiled form (forms.json[slug]) — `api`, `kit`, `title`
 * @param {object} o     { site: the site's public address, apiBase: the Forms API's base, long: (field) => long text? }
 */
export function definitionOf(form, o = {}) {
  const api = form.api || {}
  const slug = api.slug
  const fields = []
  let n = 0
  const byName = Object.fromEntries((api.fields || []).map((f) => [f.name, f]))
  for (const s of api.slides || []) {
    if (s.type !== 'body') continue
    const inner = []
    for (const it of s.items || []) {
      if (it.field && byName[it.field]) inner.push(fieldOf(byName[it.field], { long: o.long ? o.long(byName[it.field]) : false }))
      else if (it.md) inner.push(statementOf(it.md, ++n))
    }
    if (!inner.length) continue
    fields.push({ id: 'group-' + s.index, ref: 'group-' + s.index, title: (inner.find((x) => x.type === 'statement') || inner[0]).title, type: 'group', properties: { fields: inner, button_text: 'Continue', show_button: true } })
  }
  const start = (api.slides || []).find((s) => s.type === 'start')
  const end = (api.slides || []).find((s) => s.type === 'end')
  const md = (s) => (s ? (s.items || []).filter((x) => x.md).map((x) => x.md).join('\n\n') : '')
  const quiz = !!Object.keys((form.kit || {}).score || {}).length
  return {
    id: slug, type: quiz ? 'quiz' : 'form', title: form.title || api.title || slug,
    workspace: { href: (o.apiBase || '') + '/workspaces/default' }, theme: { href: (o.apiBase || '') + '/themes/default' },
    settings: { language: 'en', progress_bar: 'proportion', meta: { allow_indexing: false, description: api.description || '' }, hide_navigation: false, is_public: form.kit?.published !== false, is_trial: false, show_progress_bar: true, show_typeform_branding: false, are_uploads_public: false, show_time_to_complete: false, show_number_of_submissions: false, show_cookie_consent: false, show_question_number: true, show_key_hint_on_choices: true, autosave_progress: true, free_form_navigation: false, use_lead_qualification: false, pro_subdomain_enabled: false, capabilities: { e2e_encryption: { enabled: false, modifiable: false } } },
    welcome_screens: start ? [{ id: 'welcome-' + start.index, ref: 'welcome', title: plain(line(md(start))), properties: { show_button: true, button_text: start.button || 'Start', description: plain(md(start).split('\n').slice(1).join('\n')) || undefined } }] : [],
    thankyou_screens: [{ id: 'default_tys', ref: 'default_tys', title: end ? plain(line(md(end))) : 'Thank you', type: 'thankyou_screen', properties: { show_button: !!(end && end.redirect), share_icons: false, button_mode: end && end.redirect ? 'redirect' : 'reload', button_text: end && end.button ? end.button : 'Done', ...(end && end.redirect ? { redirect_url: end.redirect } : {}) } }],
    fields, logic: logicOf(api.slides || [], byName),
    created_at: api.created_at || null, last_updated_at: api.updated_at || null, published_at: api.updated_at || null,
    _links: { display: (o.site || '') + '/to/' + slug, responses: (o.apiBase || '') + '/forms/' + slug + '/responses' },
  }
}

/* the list's item */
export function listItemOf(form, o = {}) {
  const api = form.api || {}
  return { id: api.slug, title: form.title || api.title || api.slug, last_updated_at: api.updated_at || null, created_at: api.created_at || null, settings: { is_public: form.kit?.published !== false, is_trial: false }, self: { href: (o.apiBase || '') + '/forms/' + api.slug }, theme: { href: (o.apiBase || '') + '/themes/default' }, _links: { display: (o.site || '') + '/to/' + api.slug, responses: (o.apiBase || '') + '/forms/' + api.slug + '/responses' } }
}

/* every field of a definition, flat, in order — a group's inside it — as a webhook's definition lists them */
export function flatFields(def) {
  const out = []
  const walk = (list) => { for (const f of list || []) { if (f.type === 'group') walk(f.properties.fields); else if (f.type !== 'statement') out.push({ id: f.id, ref: f.ref, title: f.title, type: f.type, properties: f.properties, validations: f.validations, ...(f.properties.choices ? { choices: f.properties.choices.map((c) => ({ id: c.id, ref: c.ref, label: c.label })) } : {}) }) } }
  walk(def.fields)
  return out
}
