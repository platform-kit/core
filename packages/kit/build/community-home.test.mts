/*
 * THE CARDS ON THE COMMUNITY'S HOME (openspec: community-home): spaces' home slot and the site's community.homeCards,
 * in order, with the build refusing a site card it cannot draw or one that takes a key Home already has.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homeCardsOf } from './site.mjs'

const keys = (list: any[]) => list.map((x) => x.key)

test('a site with courses on gets the Course card; with courses off, none', () => {
  assert.deepEqual(keys(homeCardsOf({ modules: {} })), ['course'])
  assert.deepEqual(keys(homeCardsOf({ modules: { courses: false } })), [])
  assert.deepEqual(keys(homeCardsOf({ modules: { network: false } })), [])
})

test("a site's cards sit among the kit's by order, 20 unless they say", () => {
  const cards = homeCardsOf({ modules: {}, community: { homeCards: [{ key: 'stage', component: './src/Stage.vue' }, { key: 'first', component: './src/First.vue', order: 1 }] } })
  assert.deepEqual(keys(cards), ['first', 'course', 'stage'])
  assert.equal(cards.find((c: any) => c.key === 'stage')?.order, 20)
})

test('the build refuses a site card it cannot draw', () => {
  assert.throws(() => homeCardsOf({ modules: {}, community: { homeCards: [{ key: 'stage' }] } }), /component is the path/)
  assert.throws(() => homeCardsOf({ modules: {}, community: { homeCards: [{ key: 'Stage', component: './a.vue' }] } }), /lower-case slug/)
  assert.throws(() => homeCardsOf({ modules: {}, community: { homeCards: { key: 'stage' } } }), /a list of cards/)
  assert.throws(() => homeCardsOf({ modules: {}, community: { homeCards: [{ key: 'stage', component: './a.vue', order: 'soon' }] } }), /order is a number/)
})

test("a site card may not take a key Home already has, its own or the kit's", () => {
  for (const key of ['course', 'coaching', 'reading']) assert.throws(() => homeCardsOf({ modules: {}, community: { homeCards: [{ key, component: './a.vue' }] } }), /a card Home already has/, key)
  assert.throws(() => homeCardsOf({ modules: {}, community: { homeCards: [{ key: 'a', component: './a.vue' }, { key: 'a', component: './b.vue' }] } }), /a card Home already has/)
})
