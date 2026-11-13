/*
 * Every address shows the page it showed before (openspec: modules-as-packages).
 *
 * The census in build/fixtures/route-census.json records, for each fixture site in dev and as built,
 * which page every address shows. This test works the census out again from how pages are chosen
 * now and compares it with that record, address by address.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { census, CENSUS_FILE, CENSUS_SITES } from './route-census.mjs'

const recorded = JSON.parse(fs.readFileSync(CENSUS_FILE, 'utf8'))
const now = await census()

for (const site of CENSUS_SITES) {
  test(`${site}: every address shows the page it showed before`, () => {
    const was = recorded[site], is = now[site]
    assert.ok(was, `no recorded census for ${site}`)
    const changed = Object.keys({ ...was, ...is }).filter((a) => was[a] !== is[a]).map((a) => `${a}: ${was[a] ?? '(not asked)'} → ${is[a] ?? '(not asked)'}`)
    assert.deepEqual(changed, [], changed.join('\n'))
  })
}

/* two pages at one order would make which one shows an accident of loading: refused, between modules and against core's */
test('two pages at one order are refused', async () => {
  const { readManifests } = await import('./modules/manifest.mjs')
  const page = (name: string, order: number) => ({ name, order, page: 'theme:pages/X.vue', path: '/' + name.toLowerCase() })
  const mod = (key: string, pages: any[]) => ({ key, what: key, static: true, git: true, cloud: true, pages })
  const { faults } = readManifests([{ manifest: mod('one', [page('A', 300)]), where: 'one' }, { manifest: mod('two', [page('B', 300)]), where: 'two' }])
  assert.ok(faults.some((f: string) => /one:A and two:B are both at order 300/.test(f)), faults.join('\n'))
  const { pageTable } = await import('../vite/index.mjs')
  const { modules } = readManifests([{ manifest: mod('three', [page('C', 20)]), where: 'three' }])
  await assert.rejects(() => pageTable({ modules: {} }, modules), /core:LandingPage and three:C are both at order 20/)
})

test('a page answers a test or a path, one of the two', async () => {
  const { readManifests } = await import('./modules/manifest.mjs')
  const m = (p: any) => readManifests([{ manifest: { key: 'x', what: 'x', static: true, git: true, cloud: true, pages: [{ name: 'X', order: 300, page: 'theme:pages/X.vue', ...p }] }, where: 'x' }]).faults
  assert.ok(m({}).some((f: string) => /answers a `test` or a `path`/.test(f)))
  assert.ok(m({ test: 'a#b', path: '/x' }).some((f: string) => /answers a `test` or a `path`/.test(f)))
  assert.deepEqual(m({ path: '/x' }), [])
})
