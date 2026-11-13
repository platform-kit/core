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
