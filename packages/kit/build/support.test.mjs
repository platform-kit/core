/*
 * The support chat's arithmetic, pinned: when a chat prompt shows (src/lib/support/when.js —
 * the `when:` line of a funnel's chat step, read, written back, matched against a moment,
 * and said in words). Plain assertions; run by `npm test`.
 */
import assert from 'node:assert/strict'
import { seconds, spanWord, parseWhen, serialiseWhen, globToRegExp, pageMatches, holds, describeWhen } from '../src/lib/support/when.js'

let n = 0
const t = (name, fn) => { fn(); n++ }

t('seconds', () => {
  assert.equal(seconds('30s'), 30); assert.equal(seconds('2m'), 120); assert.equal(seconds('1h'), 3600); assert.equal(seconds('45'), 45)
  assert.equal(seconds('abc'), null); assert.equal(seconds(''), null); assert.equal(seconds(90), 90)
  assert.equal(spanWord(30), '30s'); assert.equal(spanWord(120), '2m'); assert.equal(spanWord(3600), '1h'); assert.equal(spanWord(90), '90s')
})
t('parseWhen', () => {
  const { when, errors } = parseWhen('on-site 30s, on-page /store/**, page-time 10s, signed-in false, returning, cart')
  assert.deepEqual(errors, [])
  assert.deepEqual(when, { 'on-site': 30, 'on-page': '/store/**', 'page-time': 10, 'signed-in': false, returning: true, cart: true })
  assert.deepEqual(parseWhen('').when, {})
  assert.equal(parseWhen('on-site soon').errors.length, 1)
  assert.equal(parseWhen('bogus 3').errors.length, 1)
  assert.equal(parseWhen('on-page store').errors.length, 1)
  assert.deepEqual(parseWhen('signed-in').when, { 'signed-in': true })
})
t('serialiseWhen round-trips', () => {
  const line = 'on-site 2m, on-page /store/**, page-time 10s, signed-in false, returning, cart'
  assert.equal(serialiseWhen(parseWhen(line).when), line)
  assert.equal(serialiseWhen({ returning: false, cart: false }), '')
  assert.equal(serialiseWhen({ 'signed-in': true }), 'signed-in')
})
t('globs', () => {
  assert.ok(pageMatches('/', '/')); assert.ok(!pageMatches('/', '/store'))
  assert.ok(pageMatches('/store', '/store')); assert.ok(pageMatches('/store', '/store/')); assert.ok(!pageMatches('/store', '/store/products/x'))
  assert.ok(pageMatches('/store/**', '/store')); assert.ok(pageMatches('/store/**', '/store/products/the-kybalion'))
  assert.ok(pageMatches('/store/products/*', '/store/products/x')); assert.ok(!pageMatches('/store/products/*', '/store/products/x/y'))
  assert.ok(pageMatches('/**', '/anything/at/all')); assert.ok(pageMatches('/**', '/'))
  assert.ok(pageMatches('/store/**', '/store/products/x?y=1'))
  assert.ok(globToRegExp('/a.b').test('/a.b')); assert.ok(!globToRegExp('/a.b').test('/aXb'))
})
t('holds', () => {
  const w = parseWhen('on-site 30s, on-page /store/**, signed-in false').when
  assert.ok(holds(w, { onSite: 31, path: '/store/products/x', signedIn: false }))
  assert.ok(!holds(w, { onSite: 10, path: '/store/products/x', signedIn: false }))
  assert.ok(!holds(w, { onSite: 31, path: '/app', signedIn: false }))
  assert.ok(!holds(w, { onSite: 31, path: '/store', signedIn: true }))
  assert.ok(!holds({}, { onSite: 999 }), 'a line with no trigger never shows')
  assert.ok(holds({ cart: true, returning: true }, { cart: true, returning: true }))
  assert.ok(!holds({ cart: true }, { cart: false }))
  assert.ok(holds({ 'page-time': 5 }, { pageTime: 5 }))
})
t('describeWhen', () => {
  assert.equal(describeWhen(parseWhen('on-site 30s, on-page /store/**, signed-in').when), 'after 30s on the site · on /store/** · signed in')
  assert.equal(describeWhen(parseWhen('page-time 1h, signed-in false, cart').when), '1h on the page · guests only · with something in the bag')
})
import { splitChoices, joinChoices, choiceKey, findChoice, cutAnswer, offerOf, CHOICE_CAP } from '../src/lib/support/when.js'
t('choices', () => {
  const r = splitChoices('Hi there!\nWhat can we help with?\n\n- I need support\n- Other')
  assert.equal(r.text, 'Hi there!\nWhat can we help with?')
  assert.deepEqual(r.choices, [{ key: 'i-need-support', text: 'I need support', children: [] }, { key: 'other', text: 'Other', children: [] }])
  assert.deepEqual(splitChoices('Just a line.').choices, [])
  assert.equal(choiceKey('Questions about a product?'), 'questions-about-a-product')
  const body = 'Hi there!\n\n- A paperback\n- The files'
  assert.equal(joinChoices(splitChoices(body).text, splitChoices(body).choices), body)
  assert.equal(joinChoices('Just a line.', []), 'Just a line.')
  assert.equal(joinChoices('Line', ['One', ' ', 'Two']), 'Line\n\n- One\n- Two')
})
t('nested choices', () => {
  const body = 'Hi\n\n- I have questions about coaching\n  - how much does it cost?\n  - how long does it take?\n- I need support\n  - Something else.\n- Other'
  const r = splitChoices(body)
  assert.equal(r.text, 'Hi')
  assert.deepEqual(r.choices.map((c) => [c.key, c.children.map((x) => x.key)]), [['i-have-questions-about-coaching', ['i-have-questions-about-coaching/how-much-does-it-cost', 'i-have-questions-about-coaching/how-long-does-it-take']], ['i-need-support', ['i-need-support/something-else']], ['other', []]])
  assert.equal(joinChoices(r.text, r.choices), body)
  assert.equal(findChoice(r.choices, 'i-need-support/something-else').text, 'Something else.')
  assert.equal(findChoice(r.choices, 'nope'), null)
  /* a jump of two levels reads as one, never crashes */
  assert.equal(splitChoices('L\n\n- a\n      - deep').choices[0].children[0].key, 'a/deep')
})
t('default never ticks', () => {
  assert.ok(!holds(parseWhen('default').when, { onSite: 999, path: '/' }))
  assert.equal(describeWhen(parseWhen('default').when), "the panel's default")
  assert.equal(serialiseWhen(parseWhen('default').when), 'default')
})

/*
 * A BOT'S ANSWER MAY END IN CHOICES — the same grammar, cut on the way into the row rather than at
 * render, so nothing downstream reparses markdown and no reader is shown the arrow.
 */
t('a closing list is cut off the answer', () => {
  const r = cutAnswer('Which copy is it?\n\n- The paperback\n- The hardcover')
  assert.equal(r.text, 'Which copy is it?')
  assert.deepEqual(r.choices.map((c) => c.text), ['The paperback', 'The hardcover'])
})
t('a list with nothing above it is a list, not an offer', () => {
  /* an answer that is all bullets — a summary, a set of steps — has nothing for the buttons to sit
     under, and cutting it would leave a message with no words at all */
  assert.deepEqual(cutAnswer('- one\n- two'), { text: '- one\n- two', choices: [] })
})
t('an answer with no list is left exactly as it is', () => {
  assert.deepEqual(cutAnswer('It went out on Tuesday.'), { text: 'It went out on Tuesday.', choices: [] })
})
t('too many, too long or too deep is not cut at all', () => {
  const many = 'Pick\n\n' + Array.from({ length: CHOICE_CAP.many + 1 }, (_, i) => '- option ' + i).join('\n')
  assert.equal(cutAnswer(many).choices.length, 0, 'over the cap the list stays in the words')
  assert.equal(cutAnswer(many).text, many)
  assert.equal(cutAnswer('Pick\n\n- ' + 'x'.repeat(CHOICE_CAP.chars + 1)).choices.length, 0)
  assert.equal(cutAnswer('Pick\n\n- a\n  - b\n    - c\n      - d').choices.length, 0)
})
t('a choice may point at a form or a page', () => {
  const r = cutAnswer('What next?\n\n- Report it -> form:report\n- The policy -> /docs/refunds')
  assert.equal(r.choices[0].form, 'report')
  assert.equal(r.choices[0].text, 'Report it', 'the arrow is shown to nobody')
  assert.equal(r.choices[1].href, '/docs/refunds')
})

/* WHICH OFFER IS LIVE: the last one, not taken, nothing said after it */
const offer = (over = {}) => ({ id: 'm2', choices: [{ key: 'a', text: 'A' }], ...over })
t('the last offer is the live one', () => {
  const r = offerOf([{ id: 'm1', body: 'hello' }, offer()])
  assert.equal(r.id, 'm2'); assert.equal(r.live, true)
})
t('taken is spent', () => {
  assert.equal(offerOf([offer({ choice_at: 'now' })]).live, false)
})
t('anything said after it takes the offer off the table', () => {
  /* the default asks about the LAST line: once somebody has spoken, no set is live at all */
  assert.equal(offerOf([offer(), { id: 'm3', body: 'something else' }]), null)
  assert.equal(offerOf([offer(), { id: 'm3', body: 'something else' }], { at: 'm2' }).live, false)
})
t('a withdrawn line said after it does not spend it', () => {
  assert.equal(offerOf([offer(), { id: 'm3', body: 'oops', deleted_at: 'now' }], { at: 'm2' }).live, true)
})
t('a message with no choices offers nothing', () => {
  assert.equal(offerOf([{ id: 'm2', body: 'just words' }]), null)
})
t('an offer may be asked for by name, wherever it is', () => {
  const r = offerOf([offer(), { id: 'm3', body: 'later' }], { at: 'm2' })
  assert.equal(r.id, 'm2'); assert.equal(r.live, false)
})
t('a room says taken its own way', () => {
  /* a space message keeps it in its own column, so the caller says how to read it */
  const m = { id: 'm2', choices: [{ key: 'a', text: 'A' }], choice_at: null, taken_here: true }
  assert.equal(offerOf([m], { answered: (x) => x.taken_here }).live, false)
})
console.log(`support: ${n} checks pass`)
