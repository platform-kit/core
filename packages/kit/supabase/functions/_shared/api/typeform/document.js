/*
 * A Typeform form definition (what `POST /forms` and `PUT /forms/{id}` carry — Typeform's Create API) as the model the
 * forms builder edits, for the forms model's writer to compose into a forms.md document — the reverse of definition.js.
 * Plain JavaScript, no imports, pinned under Node (build/forms-api.test.mjs) by the round trip definition → document →
 * definition.
 *
 * The map back: short_text / long_text → text (long_text multiline), email, website → url, phone_number → tel, number,
 * dropdown → select, multiple_choice → choice, picture_choice → picture, rating (steps → outof), opinion_scale → scale
 * (steps, start_at_one, the labels), date, file_upload → file; a `group` a slide holding its fields, a top-level field
 * a slide of its own (one question a screen, as Typeform shows it), a `statement` free markdown (its title a heading,
 * its description under it), `welcome_screens[0]` the start slide (its button), `thankyou_screens[0]` the end slide
 * (a redirect), `settings` the document's `#!` lines (title, meta-description, is_public → published, the progress
 * bar). A type the runner has no kind for — payment, legal, matrix, ranking, yes_no, contact_info, address, nps — is
 * refused naming it (`{ code: 'UNSUPPORTED_TYPE' }`). The logic: Typeform jumps from a field, past what follows,
 * when a condition holds; forms.md shows a slide only when its jump condition holds — so a jump from the last
 * field of a slide to the slide after next (or to the end) under a condition becomes the next slide's condition
 * negated, in the rows condition.js can say; any other jump — to another target, a condition of an operator the
 * rows have no word for — is refused naming the field (`{ code: 'LOGIC' }`).
 */
const KIND_OF = { short_text: 'text', long_text: 'text', email: 'email', website: 'url', phone_number: 'tel', number: 'number', dropdown: 'select', multiple_choice: 'choice', picture_choice: 'picture', rating: 'rating', opinion_scale: 'scale', date: 'date', file_upload: 'file' }
export const UNSUPPORTED = ['payment', 'legal', 'matrix', 'ranking', 'yes_no', 'contact_info', 'address', 'nps', 'calendly']
const OP_OF = { equal: 'is', not_equal: 'isnot', greater_than: 'gt', lower_than: 'lt', contains: 'contains', is: 'set', is_not: 'unset' }
const NEG = { is: 'isnot', isnot: 'is', gt: 'lt', lt: 'gt', set: 'unset', unset: 'set' }   /* contains has no negation the rows can say */
const fail = (code, message) => { const e = new Error(message); e.code = code; throw e }
export const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
/* a field's name in the document: its ref (or id, or title) as an identifier */
const nameOf = (f, i) => { const raw = String(f.ref || f.id || slugify(f.title) || 'field' + i).replace(/[^a-zA-Z0-9_$]+/g, '_').replace(/^([0-9])/, '_$1'); return raw || 'field' + i }
const str = (v) => (v == null ? '' : String(v))

function fieldBlock(f, i) {
  if (!f || typeof f !== 'object') fail('VALIDATION_ERROR', 'a field is an object')
  const type = String(f.type || '')
  if (UNSUPPORTED.includes(type)) fail('UNSUPPORTED_TYPE', `the field type "${type}" (${nameOf(f, i)}) has no kind in this runner`)
  const kind = KIND_OF[type]
  if (!kind) fail('UNSUPPORTED_TYPE', `the field type "${type || '(none)'}" (${nameOf(f, i)}) is not one Typeform's definition names`)
  const p = f.properties || {}, v = f.validations || {}
  const params = { question: str(f.title) || nameOf(f, i) }
  if (p.description) params.description = str(p.description)
  if (type === 'long_text') params.multiline = true
  if (kind === 'select' || kind === 'choice' || kind === 'picture') {
    params.choices = (p.choices || []).map((c, j) => { const label = str(c.label || c.ref || c.id || 'choice ' + (j + 1)); const value = str(c.ref || c.id || label); return { label, value: value === label ? label : value, ...(kind === 'picture' ? { image: c.attachment && c.attachment.href ? str(c.attachment.href) : '' } : {}) } })
    if (kind !== 'select' && p.allow_multiple_selection) params.multiple = true
  }
  if (kind === 'rating') { if (p.steps) params.outof = Number(p.steps) }
  if (kind === 'scale') { if (p.steps) params.outof = Number(p.steps); if (p.start_at_one) params.startat = 1; const l = p.labels || {}; if (l.left) params.labelstart = str(l.left); if (l.right) params.labelend = str(l.right) }
  if (kind === 'number') { if (v.min_value != null) params.min = Number(v.min_value); if (v.max_value != null) params.max = Number(v.max_value) }
  return { type: 'field', kind, name: nameOf(f, i), required: !!v.required, params, attrs: {}, dirty: true, deps: [], condition: '' }
}
const statementBlock = (f) => { const p = f.properties || {}; const md = ['# ' + str(f.title).trim(), str(p.description).trim()].filter(Boolean).join('\n\n'); return { type: 'markdown', md, dirty: true, deps: [], condition: '' } }
const slide = (type, blocks, extra = {}) => ({ type, jump: '', progress: '', align: '', post: false, disablePrev: false, button: '', redirect: '', blocks, headDirty: true, dirty: true, ...extra })

/**
 * @param {object} def   Typeform's form definition (title, fields, welcome_screens, thankyou_screens, logic, settings)
 * @param {object} [o]   { id: the id given on the route (PUT), or none — then the definition's id, else its title slugified }
 * @returns {{ id, title, published, model }}  the builder's model, for serialiseForm(model, null)
 */
export function modelFromDefinition(def, o = {}) {
  if (!def || typeof def !== 'object') fail('VALIDATION_ERROR', 'the body is a form definition')
  const title = str(def.title).trim()
  const id = slugify(o.id || def.id || title)
  if (!id) fail('VALIDATION_ERROR', 'a form needs a title (its id is made from it) or an id')
  const s = def.settings || {}
  const published = s.is_public !== false
  const slides = []
  /* the welcome screen */
  const w = (def.welcome_screens || [])[0]
  if (w) { const wp = w.properties || {}; slides.push(slide('start', [{ type: 'markdown', md: ['# ' + str(w.title).trim(), str(wp.description).trim()].filter(Boolean).join('\n\n'), dirty: true, deps: [], condition: '' }], { button: wp.button_text && wp.button_text !== 'Start' ? str(wp.button_text) : '' })) }
  /* the fields: a group a slide, a top-level field a slide of its own */
  let n = 0
  const fieldSlides = []   /* [{ slide, refs: the fields' refs on it, last: the last field's ref }] */
  for (const f of def.fields || []) {
    if (f && f.type === 'group') {
      const blocks = []; const refs = []
      for (const g of (f.properties || {}).fields || []) { if (g && g.type === 'statement') blocks.push(statementBlock(g)); else { const b = fieldBlock(g, ++n); blocks.push(b); refs.push({ ref: str(g.ref || g.id), name: b.name }) } }
      if (!blocks.length) continue
      fieldSlides.push({ slide: slide('body', blocks), refs })
    } else if (f && f.type === 'statement') fieldSlides.push({ slide: slide('body', [statementBlock(f)]), refs: [] })
    else { const b = fieldBlock(f, ++n); fieldSlides.push({ slide: slide('body', [b]), refs: [{ ref: str(f.ref || f.id), name: b.name }] }) }
  }
  /* the logic: a jump from a field past the slide after it */
  for (const l of def.logic || []) {
    if (!l || l.type !== 'field') fail('LOGIC', 'a logic entry names a field (type: field)')
    const at = fieldSlides.findIndex((x) => x.refs.some((r) => r.ref === str(l.ref)))
    if (at < 0) fail('LOGIC', `the logic names a field the form does not have: ${str(l.ref)}`)
    const from = fieldSlides[at]
    if (from.refs[from.refs.length - 1].ref !== str(l.ref)) fail('LOGIC', `a jump goes from the last field of its screen (${str(l.ref)} is not)`)
    const next = fieldSlides[at + 1]
    if (!next) fail('LOGIC', `a jump from the last screen has nothing to skip (${str(l.ref)})`)
    for (const a of l.actions || []) {
      if (a.action !== 'jump') fail('LOGIC', `the runner has no action "${a.action}" (${str(l.ref)}): only jump`)
      const to = a.details && a.details.to
      const after = fieldSlides[at + 2]
      const target = after ? after.refs[0] && after.refs[0].ref : null
      const skipsOne = to && ((to.type === 'thankyou' && !after) || (to.type === 'field' && target && str(to.value) === target))
      if (!skipsOne) fail('LOGIC', `a jump from ${str(l.ref)} must skip the screen after it (to ${after ? 'the field ' + target : 'the thank-you screen'}); the runner shows a screen on a condition and skips nothing else`)
      const rows = rowsOfCondition(a.condition, fieldSlides, str(l.ref))
      if (next.slide.jump) fail('LOGIC', `the screen after ${str(l.ref)} already has a condition`)
      next.slide.jump = exprOf(rows)
    }
  }
  slides.push(...fieldSlides.map((x) => x.slide))
  /* the thank-you screen */
  const t = (def.thankyou_screens || [])[0]
  if (t) { const tp = t.properties || {}; slides.push(slide('end', [{ type: 'markdown', md: ['# ' + str(t.title).trim(), str(tp.description).trim()].filter(Boolean).join('\n\n'), dirty: true, deps: [], condition: '' }], { redirect: tp.button_mode === 'redirect' && tp.redirect_url ? str(tp.redirect_url) : '' })) }
  const settingsChanges = { title: title || null, 'meta-description': s.meta && s.meta.description ? str(s.meta.description) : null, 'page-progress': s.show_progress_bar === false ? 'hide' : 'show', published: published ? null : 'false' }
  const model = { settings: { page: 'form-slides' }, kit: { published }, title, slides, fields: [], head: { settingsLines: [], dataBlocks: [] }, settingsChanges, dirty: true, slidesChanged: true, warnings: [], errors: [] }
  return { id, title, published, model }
}

/* Typeform's condition — a jump when it holds — as the negated rows the next slide shows on */
function rowsOfCondition(c, fieldSlides, from) {
  if (!c || c.op === 'always') fail('LOGIC', `a jump from ${from} with no condition skips the next screen for everyone — leave the screen out instead`)
  const one = (x) => {
    const op = OP_OF[x.op]
    if (!op) fail('LOGIC', `the condition on ${from} uses "${x.op}", which the runner cannot say (equal, not_equal, greater_than, lower_than, is, is_not)`)
    const vars = x.vars || []
    const fv = vars.find((v) => v.type === 'field'), cv = vars.find((v) => v.type === 'constant')
    if (!fv) fail('LOGIC', `the condition on ${from} names no field`)
    const name = (fieldSlides.flatMap((s) => s.refs).find((r) => r.ref === str(fv.value)) || {}).name
    if (!name) fail('LOGIC', `the condition on ${from} names a field the form does not have: ${str(fv.value)}`)
    const neg = NEG[op]
    if (!neg) fail('LOGIC', `the condition on ${from} uses contains, which the runner cannot negate`)
    return { field: name, op: neg, value: op === 'set' || op === 'unset' ? '' : str(cv ? cv.value : '') }
  }
  /* one comparison, or an `or` of comparisons (the negation of an `and` the rows say) */
  if (c.op === 'or') return (c.vars || []).map(one)
  if (c.op === 'and') fail('LOGIC', `the condition on ${from} joins with and; the runner says a screen's rule as all-of, which is a jump on any-of (or)`)
  return [one(c)]
}
/* condition.js's exprOf, kept here so this file has no imports: the same words */
const lit = (v) => (/^-?\d+(\.\d+)?$/.test(String(v).trim()) ? String(v).trim() : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
export function exprOf(rows) {
  return (rows || []).filter((r) => r && r.field).map((r) => {
    switch (r.op) {
      case 'isnot': return `${r.field} != ${lit(r.value)}`
      case 'contains': return `${lit(r.value)} in ${r.field}`
      case 'gt': return `${r.field} > ${lit(r.value)}`
      case 'lt': return `${r.field} < ${lit(r.value)}`
      case 'set': return r.field
      case 'unset': return `not ${r.field}`
      default: return `${r.field} == ${lit(r.value)}`
    }
  }).join(' and ')
}

/* ---- JSON Patch (RFC 6902), the operations Typeform takes on a definition: add, replace, remove; test, move, copy ---- */
const parsePointer = (p) => { const s = String(p || ''); if (s === '') return []; if (!s.startsWith('/')) fail('VALIDATION_ERROR', `a JSON pointer starts with /: ${s}`); return s.slice(1).split('/').map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~')) }
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
function walkTo(doc, tokens, path) {
  let cur = doc
  for (const t of tokens) {
    if (Array.isArray(cur)) { const i = Number(t); if (!Number.isInteger(i) || i < 0 || i >= cur.length) fail('VALIDATION_ERROR', `no such path: ${path}`); cur = cur[i] }
    else if (cur && typeof cur === 'object' && t in cur) cur = cur[t]
    else fail('VALIDATION_ERROR', `no such path: ${path}`)
  }
  return cur
}
function setAt(doc, tokens, value, path, { insert = false, mustExist = false } = {}) {
  if (!tokens.length) return value
  const parent = walkTo(doc, tokens.slice(0, -1), path), last = tokens[tokens.length - 1]
  if (Array.isArray(parent)) {
    const i = last === '-' ? parent.length : Number(last)
    if (!Number.isInteger(i) || i < 0 || i > parent.length || (mustExist && i === parent.length)) fail('VALIDATION_ERROR', `no such path: ${path}`)
    if (insert) parent.splice(i, 0, value); else parent[i] = value
  } else if (parent && typeof parent === 'object') { if (mustExist && !(last in parent)) fail('VALIDATION_ERROR', `no such path: ${path}`); parent[last] = value }
  else fail('VALIDATION_ERROR', `no such path: ${path}`)
  return doc
}
function removeAt(doc, tokens, path) {
  if (!tokens.length) fail('VALIDATION_ERROR', 'the whole document cannot be removed')
  const parent = walkTo(doc, tokens.slice(0, -1), path), last = tokens[tokens.length - 1]
  if (Array.isArray(parent)) { const i = Number(last); if (!Number.isInteger(i) || i < 0 || i >= parent.length) fail('VALIDATION_ERROR', `no such path: ${path}`); return parent.splice(i, 1)[0] }
  if (parent && typeof parent === 'object' && last in parent) { const v = parent[last]; delete parent[last]; return v }
  fail('VALIDATION_ERROR', `no such path: ${path}`)
}
/**
 * @param {object} definition  the current definition
 * @param {Array} ops          [{ op: 'add' | 'replace' | 'remove' | 'move' | 'copy' | 'test', path, value?, from? }]
 * @returns {object} the patched definition (a copy)
 */
export function applyPatch(definition, ops) {
  if (!Array.isArray(ops)) fail('VALIDATION_ERROR', 'a JSON Patch is a list of operations')
  let doc = clone(definition)
  for (const [i, op] of ops.entries()) {
    if (!op || typeof op !== 'object' || !op.op) fail('VALIDATION_ERROR', `operation ${i} has no op`)
    const path = String(op.path ?? ''), tokens = parsePointer(path)
    switch (op.op) {
      case 'add': if (!('value' in op)) fail('VALIDATION_ERROR', `add at ${path} needs a value`); doc = setAt(doc, tokens, clone(op.value), path, { insert: true }); break
      case 'replace': if (!('value' in op)) fail('VALIDATION_ERROR', `replace at ${path} needs a value`); walkTo(doc, tokens, path); doc = setAt(doc, tokens, clone(op.value), path, { mustExist: true }); break
      case 'remove': removeAt(doc, tokens, path); break
      case 'move': { const from = parsePointer(String(op.from ?? '')); const v = removeAt(doc, from, String(op.from)); doc = setAt(doc, tokens, v, path, { insert: true }); break }
      case 'copy': { const from = parsePointer(String(op.from ?? '')); const v = clone(walkTo(doc, from, String(op.from))); doc = setAt(doc, tokens, v, path, { insert: true }); break }
      case 'test': { const v = walkTo(doc, tokens, path); if (JSON.stringify(v) !== JSON.stringify(op.value)) fail('VALIDATION_ERROR', `test at ${path} failed`); break }
      default: fail('VALIDATION_ERROR', `operation ${i}: no such op "${op.op}"`)
    }
  }
  return doc
}
