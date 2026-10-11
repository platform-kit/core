/*
 * The forms module, pinned: forms.md's own tests for the parts of it the kit vendored (settings, data
 * blocks, attributes, the phone tables, the Composer — packages/kit/vendor/formsmd/tests, run as they
 * were written), then the kit's own — the parser over a fixture with every kind, conditions, a binding,
 * a data block and a div (build/fixtures/forms); the writer (one label changed and composed afresh, the
 * unmodelled constructs byte for byte, a document nothing changed in written as it was); what the parser
 * refuses (post-url, a field that does not close, a name given twice); the logic (conditions, jumps,
 * bindings as nunjucks evaluates them); the screens by page mode; the validation by kind; the grade.
 * `npm test` runs it with the forms module on.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { run as runVendored } from '../vendor/formsmd/tests/jest-lite.mjs'
import { parseForm, fieldContract, KINDS } from '../src/lib/forms/parse.js'
import { holds, renderCopy, nextSlide, context } from '../src/lib/forms/logic.js'
import { renderMarkdown } from '../src/lib/forms/markdown.js'
import { formScreens } from '../src/lib/forms/screens.js'
import { validateField, validateSlide } from '../src/lib/forms/validate.js'
import { grade } from '../supabase/functions/_shared/forms/score.js'
import { serialiseForm, composeField } from './form-io.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures/forms', n), 'utf8')
let n = 0, bad = 0
const t = (name, fn) => { n++; try { fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 3).join('\n    ')) } }

/* ---- forms.md's own tests, for what is vendored ---- */
{
  const dir = path.join(HERE, '../vendor/formsmd/tests')
  const quiet = console.warn; console.warn = () => {}
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort()) {
    await import(path.join(dir, f))
    const r = await runVendored(f)
    n += r.n; bad += r.bad
  }
  console.warn = quiet
}

/* ---- the parser ---- */
const m = parseForm(fixture('every-kind.md'))
t('the fixture parses with no error', () => assert.deepEqual(m.errors, []))
t('the settings: forms.md\'s (defaults filled) and the kit\'s', () => {
  assert.equal(m.settings.title, 'Every kind'); assert.equal(m.settings['page-progress'], 'show'); assert.equal(m.settings.page, 'form-slides'); assert.equal(m.settings.accent, '0, 102, 255')
  assert.deepEqual(m.kit, { published: true, once: true, respond: 'anyone', embedOrigins: ['https://example.com', 'http://localhost:3000'], webhook: 'https://example.com/hook', pass: 1, score: { pick: 'b' }, paid: '', ticket: '', ticketTitle: '', ticketPriority: '' })
})
t('the data block is read', () => assert.deepEqual(m.data, { brand: 'Acme', plans: ['Free', 'Pro'] }))
t('the slides: start first, the bodies, the end last', () => assert.deepEqual(m.slides.map((s) => s.type), ['start', 'body', 'body', 'body', 'body', 'end']))
t('the start slide: its button and its copy with a binding and an attribute line', () => { const s = m.slides[0]; assert.equal(s.button, 'Go'); assert.equal(s.blocks[0].type, 'markdown'); assert.deepEqual(s.blocks[0].deps, ['brand']); assert.ok(s.blocks[0].md.includes('[.text-center]')) })
t('every kind is a field of its kind', () => {
  const kinds = Object.fromEntries(m.fields.map((f) => [f.name, f.kind]))
  assert.deepEqual(kinds, { name: 'text', email: 'email', site: 'url', phone: 'tel', secret: 'password', age: 'number', about: 'text', plan: 'select', pick: 'choice', many: 'choice', pickOther: 'text', picture: 'picture', stars: 'rating', nps: 'scale', when: 'date', at: 'time', stamp: 'datetime', file: 'file', said: 'voice', seen: 'video' })
  assert.deepEqual([...new Set(m.fields.map((f) => f.kind))].sort(), [...KINDS].sort())   /* every kind the language has, at least once */
})
t('the parameters, per kind, as forms.md reads them', () => {
  const f = Object.fromEntries(m.fields.map((x) => [x.name, x]))
  assert.equal(f.name.required, true); assert.equal(f.name.params.maxlength, '40'); assert.equal(f.name.params.placeholder, 'Name')
  assert.equal(f.phone.params.country, 'GB'); assert.deepEqual(f.phone.params.availablecountries, ['GB', ' US']); assert.equal(f.phone.params.placeholder, '07400 123456')
  assert.equal(f.age.params.min, '0'); assert.equal(f.age.params.max, '120'); assert.equal(f.age.params.unitend, 'years')
  assert.equal(f.about.params.multiline, true)
  assert.deepEqual(f.plan.params.options, [{ value: 'free', label: 'Free' }, { value: 'pro', label: 'Pro' }, { value: 'Other', label: 'Other' }]); assert.equal(f.plan.params.selected, 'free')
  assert.deepEqual(f.pick.params.choices.map((c) => c.value), ['a', 'b', 'C'])
  assert.equal(f.many.params.multiple, true); assert.equal(f.many.params.horizontal, true)
  assert.deepEqual(f.picture.params.choices, [{ value: 'Sun', label: 'Sun', image: 'https://example.com/sun.png' }, { value: 'Moon', label: 'Moon', image: 'https://example.com/moon.png' }]); assert.equal(f.picture.params.supersize, true)
  assert.equal(f.stars.params.outof, 7); assert.equal(f.stars.params.icon, 'heart')
  assert.equal(f.nps.params.startat, 1); assert.equal(f.nps.params.outof, 5); assert.equal(f.nps.params.labelstart, 'No'); assert.equal(f.nps.params.labelend, 'Yes')
  assert.equal(f.when.params.min, '2024-01-01'); assert.equal(f.when.params.placeholder, 'YYYY-MM-DD')
  assert.equal(f.file.params.sizelimit, 2); assert.equal(f.file.params.imageonly, true)
})
t('a display condition in a bind div lands on its field, with the dependency', () => { const f = m.fields.find((x) => x.name === 'pickOther'); assert.equal(f.condition, "(pick == 'C')"); assert.deepEqual(f.deps, ['pick']) })
t('a jump condition lands on its slide', () => assert.equal(m.slides[3].jump, "plan == 'pro'"))
t('the page progress is read as a percentage', () => assert.deepEqual(m.slides.slice(1, 5).map((s) => s.progress), ['25%', '50%', '75%', '100%']))
t('a div with attributes is a div block, its attributes read, its source kept', () => { const d = m.slides[4].blocks.find((b) => b.type === 'div'); assert.ok(d); assert.deepEqual(d.attrs.classes, ['col-6']); assert.equal(d.attrs.id, 'half'); assert.ok(d.raw.startsWith('::: [.col-6 #half]')); assert.equal(d.blocks[0].type, 'markdown') })
t('an if/else round copy gives each branch its condition, the two as a group with the whole source', () => { const g = m.slides[4].blocks.find((b) => b.type === 'div' && b.blocks.length === 2); assert.ok(g); assert.deepEqual(g.blocks.map((b) => b.condition), ["(plan == 'pro')", "not (plan == 'pro')"]); assert.ok(g.raw.startsWith('{% if') && g.raw.endsWith('{% endif %}')) })
t('a field under a condition carries its whole bind div as its source', () => { const f = m.fields.find((x) => x.name === 'pickOther'); assert.ok(f.raw.startsWith('::: [{$ pick $}]') && f.raw.trim().endsWith(':::')) })
t('the end slide: its redirect and its binding', () => { const e = m.slides[5]; assert.equal(e.redirect, 'https://example.com/done'); assert.deepEqual(e.blocks[0].deps, ['name']) })
t('the field contract the function checks against', () => { const c = fieldContract(m); assert.deepEqual(c.find((x) => x.name === 'pick'), { name: 'pick', question: 'Pick one', kind: 'choice', required: true, multiple: false, values: ['a', 'b', 'C'], slide: 2 }); assert.equal(c.find((x) => x.name === 'many').multiple, true) })
t('every block knows its line', () => assert.equal(m.fields.find((x) => x.name === 'name').line, 27))

/* ---- every example from docs.forms.md, as the parity pass pinned it (build/fixtures/formsmd/expected.json) ---- */
{
  const dir = path.join(HERE, 'fixtures/formsmd')
  const expected = JSON.parse(readFileSync(path.join(dir, 'expected.json'), 'utf8'))
  for (const [f, want] of Object.entries(expected)) t('docs example ' + f, () => {
    const m = parseForm(readFileSync(path.join(dir, f), 'utf8'))
    assert.deepEqual({ errors: m.errors.map((e) => e.message.replace(/ — .*/, '')), slides: m.slides.map((s) => s.type + (s.jump ? '?' + s.jump : '') + (s.progress ? '@' + s.progress : '')), fields: m.fields.map((x) => x.name + ':' + x.kind + (x.required ? '*' : '') + (x.condition ? '?' : '')) }, want)
  })
}

/* ---- what is refused ---- */
t('post-url is refused, naming the line', () => { const r = parseForm(fixture('refused-post-url.md')); assert.equal(r.errors.length, 1); assert.equal(r.errors[0].line, 2); assert.match(r.errors[0].message, /post-url/) })
t('a field that does not close is refused, naming the line', () => { const r = parseForm(fixture('unclosed.md')); assert.ok(r.errors.some((e) => e.line === 3 && /does not close/.test(e.message))) })
t('a name given twice is refused', () => { const r = parseForm('a = TextInput(| question = A)\n\nb = TextInput(| question = B)\n\n---\n\na = EmailInput(| question = A again)'); assert.ok(r.errors.some((e) => /already a field/.test(e.message))) })
t('a right answer naming no field is refused', () => { const r = parseForm('#! score = nope: x\n\na = TextInput(| question = A)'); assert.ok(r.errors.some((e) => /not a field/.test(e.message))) })
t('an invalid parameter is a warning with its line, never an error', () => { const r = parseForm('a = TextInput(| question = A | outOf = 5)'); assert.deepEqual(r.errors, []); assert.equal(r.warnings.length, 1); assert.equal(r.warnings[0].line, 1) })
t('a bad kit setting is refused', () => { assert.ok(parseForm('#! respond = someone').errors.length); assert.ok(parseForm('#! pass = many').errors.length); assert.ok(parseForm('#! embed-origins = not an origin').errors.length) })
t('single page: one slide, the delimiter is a rule', () => { const r = parseForm('#! page = single\n\n# One\n\n---\n\n# Two'); assert.equal(r.slides.length, 1) })

/* ---- the writer ---- */
const raw = fixture('every-kind.md')
t('a document nothing changed in is written as it was', () => assert.equal(serialiseForm(parseForm(raw), raw), raw))
t('one label changed: the field composed afresh, everything else byte for byte, and it parses again', () => {
  const w = parseForm(raw)
  const f = w.slides[1].blocks[0]; f.params.question = 'What is your name?'; f.dirty = true
  const doc = serialiseForm(w, raw)
  assert.notEqual(doc, raw)
  assert.ok(doc.includes('name* = TextInput(\n\t| question = What is your name?\n\t| placeholder = Name\n\t| maxlength = 40\n)'))
  for (const b of [w.slides[1].blocks[1], w.slides[2].blocks[3], w.slides[4].blocks.find((x) => x.type === 'div')]) assert.ok(doc.includes(b.raw), 'kept: ' + b.raw.slice(0, 30))
  assert.ok(doc.includes(w.head.dataBlocks[0]))
  const again = parseForm(doc)
  assert.deepEqual(again.errors, [])
  assert.deepEqual(again.fields.map((x) => x.name), w.fields.map((x) => x.name))
  assert.equal(again.fields[0].params.question, 'What is your name?')
})
t('a field with a condition is composed inside its bind div', () => { const s = composeField({ kind: 'choice', name: 'q', required: true, params: { question: 'Pick', choices: [{ value: 'a', label: 'A' }, { value: 'B', label: 'B' }], multiple: true }, condition: "x == 'y'", deps: ['x'] }); assert.equal(s, "::: [{$ x $}]\n{% if x == 'y' %}\nq* = ChoiceInput(\n\t| question = Pick\n\t| choices = \"a\" A, B\n\t| multiple\n)\n{% endif %}\n:::") })
t('a setting changed is replaced in place; a theming line is kept as written', () => {
  const w = parseForm(raw); w.settingsChanges = { title: 'Renamed', once: null, pass: '2' }
  const doc = serialiseForm(w, raw)
  assert.ok(doc.startsWith('#! title = Renamed\n#! page-progress = show\n#! respond = anyone\n'))
  assert.ok(!doc.includes('#! once')); assert.ok(doc.includes('#! pass = 2')); assert.ok(doc.includes('#! accent = #0066ff'))
})

/* ---- the logic ---- */
t('a condition holds as nunjucks reads it', () => { assert.equal(holds("pick == 'C'", { pick: 'C' }), true); assert.equal(holds("pick == 'C'", { pick: 'a' }), false); assert.equal(holds('age > 18 and plan == "pro"', { age: 20, plan: 'pro' }), true); assert.equal(holds('', {}), true); assert.equal(holds('nope', {}), false) })
t('a jump: the next slide whose condition holds, or has none', () => { const s = [{}, { jump: "plan == 'pro'" }, {}]; assert.equal(nextSlide(s, 0, { plan: 'free' }), 2); assert.equal(nextSlide(s, 0, { plan: 'pro' }), 1) })
t('a binding renders into the copy; a list reads as a list', () => { assert.equal(renderCopy('Hi {$ name $}, {{ brand }}', context({ brand: 'Acme' }, { name: 'Jo' })), 'Hi Jo, Acme'); assert.equal(renderCopy('{$ many $}', { many: ['a', 'b'] }), 'a, b') })
t('the copy renders with forms.md\'s block attributes', () => { const h = renderMarkdown('[.text-center #hi]\nHello **{$ name $}**\n\n# [.mb-2] T', { name: 'Jo' }); assert.ok(h.includes('<p id="hi" class="fmd-text-center">Hello <strong>Jo</strong></p>')); assert.ok(h.includes('<h1 class="fmd-mb-2">T</h1>')) })

/* ---- the screens ---- */
t('form-slides: a screen per slide, the end last, a jump as a skip', () => {
  const ctx = { plan: 'free' }
  const s = formScreens(m, () => ctx)
  assert.equal(s.length, 6); assert.equal(s[5].end, true); assert.equal(s[4].last, true); assert.equal(s[1].post, true); assert.equal(s[0].isForm, true)
  assert.equal(s[3].skip(), true); ctx.plan = 'pro'; assert.equal(s[3].skip(), false)
  assert.deepEqual(s[1].fields.map((f) => f.name), ['name', 'email', 'site', 'phone', 'secret', 'age', 'about'])
  assert.deepEqual(s.map((x) => x.progress), [0, 25, 50, 75, 100, 100])
})
t('slides: the same screens, nothing posted', () => { const w = parseForm(raw.replace('#! title = Every kind', '#! title = Every kind\n#! page = slides')); const s = formScreens(w, () => ({})); assert.equal(s.length, 6); assert.ok(s.every((x) => !x.post)); assert.equal(s[1].isForm, false) })
t('single: one screen, every block', () => { const w = parseForm(raw.replace('#! title = Every kind', '#! title = Every kind\n#! page = single')); const s = formScreens(w, () => ({})); assert.equal(s.length, 1); assert.equal(s[0].single, true); assert.equal(s[0].fields.length, 20) })
t('a document with no end slide gets the default one', () => { const w = parseForm('a = TextInput(| question = A)'); const s = formScreens(w, () => ({})); assert.equal(s.length, 2); assert.equal(s[1].defaultEnd, true) })

/* ---- the validation ---- */
const W = { required: 'req', 'invalid-email': 'mail', 'invalid-url': 'url', 'invalid-number': 'num', 'number-min': 'min {min}', 'number-max': 'max {max}', 'invalid-date': 'date', 'choice-required': 'choose', 'number-choice-required': 'pickone', 'file-size-error': 'big', 'too-long': 'long {n}', 'invalid-phone': 'phone' }
t('required, by kind', () => { assert.equal(validateField({ kind: 'text', required: true, params: {} }, '', W), 'req'); assert.equal(validateField({ kind: 'choice', required: true, params: { choices: [] } }, null, W), 'choose'); assert.equal(validateField({ kind: 'rating', required: true, params: {} }, null, W), 'pickone'); assert.equal(validateField({ kind: 'text', required: false, params: {} }, '', W), '') })
t('the shape a kind asks for', () => {
  assert.equal(validateField({ kind: 'email', params: {} }, 'nope', W), 'mail'); assert.equal(validateField({ kind: 'email', params: {} }, 'a@b.co', W), '')
  assert.equal(validateField({ kind: 'url', params: {} }, 'example.com', W), 'url'); assert.equal(validateField({ kind: 'url', params: {} }, 'https://example.com', W), '')
  assert.equal(validateField({ kind: 'number', params: { min: '0', max: '10' } }, '11', W), 'max 10'); assert.equal(validateField({ kind: 'number', params: {} }, 'x', W), 'num'); assert.equal(validateField({ kind: 'number', params: { min: '1' } }, '5', W), '')
  assert.equal(validateField({ kind: 'date', params: {} }, '2024-1-1', W), 'date'); assert.equal(validateField({ kind: 'date', params: {} }, '2024-01-01', W), '')
  assert.equal(validateField({ kind: 'text', params: { maxlength: '3' } }, 'abcd', W), 'long 3'); assert.equal(validateField({ kind: 'text', params: { pattern: '[a-z]+' } }, 'abc', W), '')
  assert.equal(validateField({ kind: 'tel', params: {} }, '12', W), 'phone')
  assert.equal(validateField({ kind: 'choice', params: { choices: [{ value: 'a' }] } }, 'z', W), 'choose'); assert.equal(validateField({ kind: 'choice', params: { choices: [{ value: 'a' }, { value: 'b' }], multiple: true } }, ['a', 'b'], W), '')
  assert.equal(validateField({ kind: 'file', params: { sizelimit: 1 } }, { size: 2 * 1024 * 1024, type: 'image/png' }, W), 'big')
})
t('a slide: the first message per field', () => assert.deepEqual(validateSlide([{ name: 'a', kind: 'text', required: true, params: {} }, { name: 'b', kind: 'email', params: {} }], { a: '', b: 'x' }, W), { a: 'req', b: 'mail' }))

/* ---- the grade ---- */
t('a quiz is graded by its right answers', () => { assert.deepEqual(grade({ q1: 'b', q2: 'Paris' }, { q1: 'B', q2: ' paris ' }, 2), { score: 2, total: 2, passed: true }); assert.deepEqual(grade({ q1: 'a | b' }, { q1: ['b', 'a'] }, null), { score: 1, total: 1, passed: null }); assert.deepEqual(grade({ q1: 'a' }, {}, 1), { score: 0, total: 1, passed: false }) })

console.log(`forms: ${n - bad}/${n} pass`)
process.exit(bad ? 1 : 0)
