/*
 * The content models, pinned: the record's grammar over a fixture site with a model of every kind, every
 * option and a rule of every family (build/fixtures/models/site) — parsed, written, byte-stable on a rerun;
 * what the reader refuses (an unknown kind, an unknown rule, two fields with one key, a title field the
 * model lacks, a group holding a list, a reference to no model), each with the file, the field and the
 * fault; every rule family against a passing and a failing value; required, unique, a reference that is
 * not there, shown-when skipping; the fixture entry of every kind read into the collection with its
 * values in their shapes; the carry (a field renamed in five entries, byte-compared outside the renamed
 * line; a kind changed under entries counted); the JSON writer; a `books` model beside the stock books.
 * `npm test` runs it with the models module on.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { s } from 'velite'
import { z } from 'zod'
import { KINDS, KIND_KEYS, RULES, RULE_KEYS, rulesFor, ruleString, checkRules } from '../src/lib/models/rules.js'
import { readModel, writeModel, readModels, renameField, renameModel, entryNames, publishedModels } from './model-io.mjs'
import { schemaFor, checkEntry, validateEntry, shownHolds, defaultsOf, sortEntries, writeJson, jsonFor, collectionName, readEntries, checkAll } from './models.mjs'
import { describeSchema, collectionsFor } from './admin-schemas.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIX = path.join(HERE, 'fixtures/models')
let n = 0, bad = 0
const t = (name, fn) => { n++; try { fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 3).join('\n    ')) } }
const ta = async (name, fn) => { n++; try { await fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 3).join('\n    ')) } }
/* the theme's words, so the messages under test are the real ones */
const scopeFile = path.join(HERE, '../../movable-types/src/content/ui/models.md')
const { parseGroups } = await import('./strings-io.mjs')
const words = parseGroups(readFileSync(scopeFile, 'utf8'))
const fresh = () => { const d = mkdtempSync(path.join(tmpdir(), 'models-')); cpSync(path.join(FIX, 'site'), d, { recursive: true }); return d }

/* ---- the kinds and the rules ---- */
t('every kind has a group and a base; every rule a shape and its kinds', () => {
  for (const k of KIND_KEYS) { assert.ok(['text', 'choices', 'media', 'structure'].includes(KINDS[k].group), k); assert.ok(KINDS[k].base, k) }
  for (const r of RULE_KEYS) { assert.ok(['n', 'range', 'list', 'pattern', 'date', 'text', 'none'].includes(RULES[r].params), r); assert.ok(RULES[r].kinds.length, r) }
  assert.ok(rulesFor('number').includes('between') && !rulesFor('number').includes('regex'))
  assert.ok(rulesFor('date').includes('after') && !rulesFor('text').includes('after'))
})
t('every kind and every rule has its words', () => {
  for (const k of KIND_KEYS) assert.ok(words.kinds[k] && words.kinds[k].name, 'kind ' + k)
  for (const r of RULE_KEYS) assert.ok(words.rules[r] && words.rules[r].message, 'rule ' + r)
  for (const r of ['required', 'unique', 'reference', 'type']) assert.ok(words.rules[r] && words.rules[r].message, r)
})
t('a rule row becomes validatorjs\'s string only at the run', () => {
  assert.equal(ruleString({ rule: 'min', params: 3 }), 'min:3')
  assert.equal(ruleString({ rule: 'between', params: [1, 10] }), 'between:1,10')
  assert.equal(ruleString({ rule: 'in', params: ['a', 'b'] }), 'in:a,b')
  assert.equal(ruleString({ rule: 'regex', params: '^a|b$' }), 'regex:/^a|b$/')
  assert.equal(ruleString({ rule: 'alpha' }), 'alpha')
  assert.equal(ruleString({ rule: 'after', params: '2020-01-01' }), 'after:_p')
  assert.equal(ruleString({ rule: 'nope' }), null)
})
t('every rule family: a passing and a failing value, worded from the scope', () => {
  const cases = [
    ['min', 3, 'abc', 'ab'], ['max', 3, 'abc', 'abcd'], ['between', [1, 10], 5, 11], ['size', 3, 'abc', 'ab'],
    ['in', ['x', 'y'], 'x', 'z'], ['not_in', ['x'], 'y', 'x'], ['regex', '^a|b$', 'a', 'c'],
    ['alpha', undefined, 'abc', 'a1'], ['alpha_num', undefined, 'a1', 'a-1'], ['alpha_dash', undefined, 'a-1_b', 'a b'],
    ['numeric', undefined, '12', 'x'], ['integer', undefined, 12, 1.5], ['digits', 4, '1234', '123'],
    ['url', undefined, 'https://a.co', 'nope'], ['email', undefined, 'a@b.co', 'a@'], ['date', undefined, '2020-01-01', 'yesterday'],
    ['after', '2020-01-01', '2021-01-01', '2019-01-01'], ['before', '2020-01-01', '2019-01-01', '2021-01-01'],
    ['starts_with', 'he', 'hello', 'yellow'], ['ends_with', 'lo', 'hello', 'help'],
  ]
  assert.equal(cases.length, RULE_KEYS.length, 'every rule covered')
  for (const [rule, params, ok, ko] of cases) {
    const rows = [{ rule, params }]
    assert.deepEqual(checkRules(ok, rows, words.rules, { field: 'F' }), [], rule + ' passes ' + ok)
    const m = checkRules(ko, rows, words.rules, { field: 'F' })
    assert.equal(m.length, 1, rule + ' fails ' + ko)
    assert.ok(m[0].startsWith('F '), rule + ': ' + m[0])
    assert.ok(!/\{\w+\}/.test(m[0]), rule + ' filled: ' + m[0])
  }
  assert.deepEqual(checkRules('', [{ rule: 'min', params: 3 }], words.rules), [], 'an empty value passes every rule')
  assert.deepEqual(checkRules(['a', 'b', 'c'], [{ rule: 'max', params: 2 }], words.rules).length, 1, 'a list is measured by its length')
})

/* ---- the record ---- */
const site = path.join(FIX, 'site')
const every = readModel(readFileSync(path.join(site, 'content/models/every-kind.md'), 'utf8'), 'every-kind')
t('the fixture model reads clean and holds every kind', () => {
  assert.deepEqual(every.errors, [])
  const kinds = new Set(every.model.fields.map((f) => f.kind))
  for (const k of KIND_KEYS) assert.ok(kinds.has(k), 'kind ' + k)
  const m = every.model
  assert.equal(m.title, 'title'); assert.equal(m.body, 'Notes'); assert.deepEqual(m.access, ['authenticated'])
  assert.deepEqual(m.order, { by: 'rank', dir: 'desc' }); assert.deepEqual(m.deliver, { data: true, pages: true, json: true, section: true })
  const code = m.fields.find((f) => f.key === 'code')
  assert.deepEqual(code.shown, { field: 'live', is: 'is', value: true })
  assert.equal(code.rules.length, 6)
  const used = new Set(m.fields.flatMap((f) => (f.rules || []).map((r) => r.rule)).concat(m.fields.flatMap((f) => (f.fields || []).flatMap((g) => (g.rules || []).map((r) => r.rule)))))
  for (const r of RULE_KEYS) assert.ok(used.has(r), 'rule ' + r + ' in the fixture')
})
t('written, read again, written again: byte-stable', () => {
  const a = writeModel(every.model)
  const again = readModel(a, 'every-kind')
  assert.deepEqual(again.errors, [])
  assert.deepEqual(again.model, every.model)
  assert.equal(writeModel(again.model), a)
  assert.ok(!/[{[]/.test(a.split('\n').filter((l) => !l.includes('params:')).join('\n')), 'block YAML, never flow')
})
await ta('readModels lists by name, with the cross-model faults', async () => {
  const all = await readModels(site)
  assert.deepEqual(all.map((x) => x.name), ['every-kind', 'people'])
  assert.deepEqual(all.flatMap((x) => x.errors), [])
  assert.deepEqual((await publishedModels(site)).map((m) => m.key), ['every-kind', 'people'])
})
await ta('what the reader refuses, naming the file, the field and the fault', async () => {
  const want = { 'unknown-kind': /fields\[0\]: unknown kind "paragraph"/, 'unknown-rule': /fields\[0\]: unknown rule "confirmed"/, 'dup-keys': /two fields share the key "a"/, 'no-title': /the title field "name" is not one/, nested: /cannot hold a list/ }
  for (const [name, re] of Object.entries(want)) {
    const { errors } = readModel(readFileSync(path.join(FIX, 'refused', name + '.md'), 'utf8'), name)
    assert.ok(errors.some((e) => re.test(e) && e.startsWith('content/models/' + name + '.md')), name + ': ' + errors.join(' | '))
  }
  const d = fresh(); cpSync(path.join(FIX, 'refused/no-model.md'), path.join(d, 'content/models/no-model.md'))
  const x = (await readModels(d)).find((m) => m.name === 'no-model')
  assert.ok(x.errors.some((e) => /a reference to a model that is not there \("ghosts"\)/.test(e)), x.errors.join(' | '))
  rmSync(d, { recursive: true, force: true })
})
t('a rule the kind does not take, and a bad parameter, are faults', () => {
  const bad = (fields) => readModel('---\n' + JSON.stringify({ key: 'x', name: 'X', title: 'a', fields }) + '\n---\n', 'x').errors
  assert.ok(bad([{ key: 'a', kind: 'number', label: 'A', rules: [{ rule: 'regex', params: 'x' }] }]).some((e) => /does not apply to a number/.test(e)))
  assert.ok(bad([{ key: 'a', kind: 'text', label: 'A', rules: [{ rule: 'min', params: 'lots' }] }]).some((e) => /min needs a number/.test(e)))
  assert.ok(bad([{ key: 'a', kind: 'text', label: 'A', rules: [{ rule: 'regex', params: '(' }] }]).some((e) => /not a valid pattern/.test(e)))
  assert.ok(bad([{ key: 'a', kind: 'select', label: 'A' }]).some((e) => /needs options/.test(e)))
  assert.ok(bad([{ key: 'a', kind: 'markdown', label: 'A', unique: true }]).some((e) => /unique is for the text kinds/.test(e)))
})

/* ---- the derivation and the check ---- */
const people = readModel(readFileSync(path.join(site, 'content/models/people.md'), 'utf8'), 'people').model
const refs = { people: new Set(await entryNames(site, 'people')) }
const first = (await readEntries(site, 'every-kind'))[0]
t('the fixture entry of every kind parses with its values in their shapes', () => {
  const r = validateEntry(every.model, first.data, { siblings: [], refs, words }, z)
  assert.deepEqual(r.errors, [])
  const d = r.data
  assert.equal(typeof d.rank, 'number'); assert.equal(d.live, true); assert.deepEqual(d.colours, ['red']); assert.deepEqual(d.guests, ['bob', 'carol'])
  assert.deepEqual(d.where, { city: 'Lisbon', seats: 20 }); assert.deepEqual(d.sessions, [{ name: 'Opening', length: 30 }]); assert.equal(d.host, 'alice')
  assert.equal(first.content.trim(), 'The body.')
})
t('velite\'s schema takes the same entry (an image and a file as strings here, since velite copies them)', () => {
  const r = s.object(schemaFor(every.model, s)).safeParse({ ...first.data, cover: undefined, sheet: undefined })
  assert.ok(r.success, JSON.stringify(r.error && r.error.issues))
})
t('the admin\'s schema describes every field with its widget and its label', () => {
  const desc = describeSchema(z.object(schemaFor(every.model, z, { admin: true })))
  const by = Object.fromEntries(desc.map((f) => [f.name, f]))
  assert.equal(by.title.label, 'Title'); assert.equal(by.title.widget, 'string'); assert.equal(by.blurb.widget, 'text'); assert.equal(by.about.widget, 'markdown')
  assert.equal(by.colour.widget, 'select'); assert.deepEqual(by.colour.choices.map((c) => c.value), ['red', 'blue'])
  assert.equal(by.colours.widget, 'multiselect'); assert.equal(by.tags.widget, 'list')
  assert.equal(by.host.widget, 'select'); assert.equal(by.host.options, 'model:people'); assert.equal(by.guests.widget, 'multiselect')
  assert.equal(by.cover.widget, 'image'); assert.equal(by.sheet.widget, 'file'); assert.equal(by.where.widget, 'group'); assert.equal(by.sessions.widget, 'rows'); assert.equal(by.links.widget, 'rows')
  assert.equal(by.where.fields.length, 2); assert.equal(by.sessions.of, 'group'); assert.equal(by.links.of, 'url')
  assert.deepEqual(by.code.shown, { field: 'live', is: 'is', value: true }); assert.equal(by.title.unique, true); assert.equal(by.title.rules.length, 2)
  assert.equal(by.rank.grid, false); assert.equal(by.title.grid, true)
})
t('required, unique, a reference that is not there, a rule — each named by field', () => {
  const errs = (data, sibs = []) => checkEntry(every.model, data, { siblings: sibs, refs, words })
  assert.deepEqual(errs({ ...first.data, title: '' }).map((e) => e.field), ['title'])
  assert.equal(errs({ ...first.data, title: '' })[0].message, 'Title is required.')
  assert.deepEqual(errs({ ...first.data, title: 'ab' }).map((e) => e.message), ['Title must be at least 3.'])
  assert.deepEqual(errs(first.data, [{ title: 'First entry' }]).map((e) => e.message), ['Title must be unique — another entry has this value.'])
  assert.deepEqual(errs({ ...first.data, host: 'zed' }).map((e) => e.message), ['Host: no entry "zed".'])
  assert.deepEqual(errs({ ...first.data, guests: ['bob', 'zed'] }).map((e) => e.field), ['guests'])
  assert.deepEqual(errs({ ...first.data, where: { seats: 1 } }).map((e) => e.field), ['where.city'])
  assert.deepEqual(errs({ ...first.data, sessions: [{ name: 'x', length: 2 }] }).map((e) => e.field), ['sessions[0].length'])
  assert.deepEqual(errs({ ...first.data, colours: ['red', 'blue', 'red'] }).map((e) => e.message), ['Colours must be at most 2.'])
})
t('shown-when: a hidden field skips every check, and keeps its value', () => {
  assert.equal(shownHolds({ field: 'live', is: 'is', value: true }, { live: true }), true)
  assert.equal(shownHolds({ field: 'live', is: 'is', value: true }, { live: false }), false)
  /* ONE OF SEVERAL: a field shown for three of four choices. `is-not` against the exception also
     shows it while the question is unanswered, which is why this exists. */
  const some = { field: 'allow', is: 'in', value: ['everyone', 'members', 'hosts'] }
  assert.equal(shownHolds(some, { allow: 'members' }), true)
  assert.equal(shownHolds(some, { allow: 'off' }), false)
  assert.equal(shownHolds(some, {}), false, 'unanswered is not one of them')
  assert.equal(shownHolds({ field: 'allow', is: 'not-in', value: ['off'] }, { allow: 'members' }), true)
  assert.equal(shownHolds({ field: 'tags', is: 'in', value: ['b'] }, { tags: ['a', 'b'] }), true, 'a list holding one of them')
  assert.equal(shownHolds({ field: 'x', is: 'empty' }, {}), true)
  assert.equal(shownHolds({ field: 'x', is: 'not-empty' }, { x: [] }), false)
  assert.equal(shownHolds({ field: 'c', is: 'is-not', value: 'red' }, { c: 'blue' }), true)
  const hidden = { ...first.data, live: false, code: 'nope' }
  assert.deepEqual(checkEntry(every.model, hidden, { siblings: [], refs, words }), [])
  const shownBad = { ...first.data, live: true, code: 'nope' }
  assert.ok(checkEntry(every.model, shownBad, { siblings: [], refs, words }).length >= 3)
  assert.deepEqual(checkEntry(every.model, { ...first.data, live: true, code: '' }, { siblings: [], refs, words }).map((e) => e.field), ['code'])
})
t('the type check speaks too', () => {
  const r = validateEntry(every.model, { ...first.data, rank: 'three' }, { siblings: [], refs, words }, z)
  assert.equal(r.ok, false); assert.equal(r.errors[0].field, 'rank')
})
t('defaults and order', () => {
  assert.deepEqual(defaultsOf(every.model), { published: true, rank: 1, live: true })
  const list = sortEntries([{ rank: 2 }, { rank: 9 }, { rank: 5 }], every.model)
  assert.deepEqual(list.map((x) => x.rank), [9, 5, 2])
  assert.deepEqual(sortEntries([{ name: 'b' }, { name: 'a' }], people).map((x) => x.name), ['a', 'b'])
})
await ta('checkAll over the fixture site is clean, and a hand-written entry that fails a rule is refused with its line', async () => {
  const d = fresh()
  let r = await checkAll(d, { words })
  assert.deepEqual(r.faults, []); assert.equal(r.report.length, 2)
  writeFileSync(path.join(d, 'content/models/people/zed.md'), '---\nname: Al\nrole: pilot\n---\n')
  r = await checkAll(d, { words })
  assert.ok(r.faults.some((f) => f.startsWith('content/models/people/zed.md: Role:')), r.faults.join(' | '))
  rmSync(d, { recursive: true, force: true })
})

/* ---- the carry ---- */
await ta('a field renamed in five entries: the one line, the rest byte for byte', async () => {
  const d = fresh()
  const before = Object.fromEntries((await entryNames(d, 'people')).map((n) => [n, readFileSync(path.join(d, 'content/models/people', n + '.md'), 'utf8')]))
  assert.equal(await renameField(d, 'people', 'role', 'part'), 5)
  for (const [name, was] of Object.entries(before)) {
    const now = readFileSync(path.join(d, 'content/models/people', name + '.md'), 'utf8')
    assert.equal(now, was.replace('\nrole:', '\npart:'), name)
  }
  assert.equal(await renameField(d, 'people', 'nothere', 'x'), 0)
  rmSync(d, { recursive: true, force: true })
})
await ta('a kind changed under entries: how many would fail, and which', async () => {
  const m = { ...people, fields: people.fields.map((f) => (f.key === 'role' ? { ...f, kind: 'number', options: undefined } : f)) }
  const entries = await readEntries(site, 'people')
  const failing = entries.filter((e) => !validateEntry(m, e.data, { siblings: [], refs: {}, words }, z).ok).map((e) => e.slug)
  assert.deepEqual(failing, ['alice', 'bob', 'carol', 'dave', 'erin'])
})
await ta('a model renamed: the file, the folder, and every reference to it', async () => {
  const d = fresh()
  assert.equal(await renameModel(d, 'people', 'teachers'), 1)
  assert.ok(existsSync(path.join(d, 'content/models/teachers.md')) && !existsSync(path.join(d, 'content/models/people.md')))
  assert.deepEqual(await entryNames(d, 'teachers'), ['alice', 'bob', 'carol', 'dave', 'erin'])
  const ek = readModel(readFileSync(path.join(d, 'content/models/every-kind.md'), 'utf8'), 'every-kind').model
  assert.equal(ek.fields.find((f) => f.key === 'host').model, 'teachers')
  await assert.rejects(() => renameModel(d, 'teachers', 'every-kind'), /already there/)
  rmSync(d, { recursive: true, force: true })
})

/* ---- a books model beside the stock books ---- */
await ta('a `books` model lives under models/ and the stock books are untouched', async () => {
  const d = fresh()
  mkdirSync(path.join(d, 'content/books'), { recursive: true })
  writeFileSync(path.join(d, 'content/books/stock.md'), '---\ntitle: A stock book\n---\n# One\n')
  writeFileSync(path.join(d, 'content/models/books.md'), '---\nkey: books\nname: Books\ntitle: title\nfields:\n  - key: title\n    kind: text\n    label: Title\n')
  mkdirSync(path.join(d, 'content/models/books'), { recursive: true })
  writeFileSync(path.join(d, 'content/models/books/custom.md'), '---\ntitle: A custom book\n---\n')
  const cols = await collectionsFor(d)
  assert.ok(cols.books && cols.books.dir === 'content/books', 'the stock collection stands')
  assert.ok(cols['models/books'] && cols['models/books'].dir === 'content/models/books', 'the model is its own collection')
  assert.equal(collectionName('books'), 'models_books')
  assert.deepEqual((await readEntries(d, 'books')).map((e) => e.slug), ['custom'])
  assert.equal(readdirSync(path.join(d, 'content/books')).join(), 'stock.md')
  rmSync(d, { recursive: true, force: true })
})

/* ---- the JSON ---- */
await ta('the JSON writer: one file per model with JSON on, from .velite, the body as markdown', async () => {
  const d = fresh()
  mkdirSync(path.join(d, '.velite'), { recursive: true })
  writeFileSync(path.join(d, '.velite/models_every_kind.json'), JSON.stringify([{ slug: 'first', title: 'First entry', rank: 3, body: '<p>html</p>', raw: 'The body.' }]))
  writeFileSync(path.join(d, '.velite/models_people.json'), JSON.stringify([{ slug: 'alice', name: 'Alice' }]))
  const w = await writeJson(d, path.join(d, 'dist'))
  assert.deepEqual(w, ['every-kind'])
  const j = JSON.parse(readFileSync(path.join(d, 'dist/data/models/every-kind.json'), 'utf8'))
  assert.equal(j.model.key, 'every-kind'); assert.equal(j.model.fields.length, every.model.fields.length)
  assert.deepEqual(j.entries, [{ slug: 'first', title: 'First entry', rank: 3, body: 'The body.' }])
  assert.deepEqual(jsonFor(d, every.model).entries[0].slug, 'first')
  assert.ok(!existsSync(path.join(d, 'dist/data/models/people.json')), 'JSON off writes nothing')
  rmSync(d, { recursive: true, force: true })
})

console.log(`${bad ? '✖' : '✔'} models: ${n - bad}/${n} checks`)
if (bad) process.exit(1)
