/*
 * What a site's backend receives does not move (openspec: modules-as-packages).
 *
 * Assembles each snapshot site with its modules as configured and with each module off in turn, and compares
 * every file's hash with build/fixtures/assembled-tree.json.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { snapshot, SNAPSHOT_FILE, SNAPSHOT_SITES } from './assembled-snapshot.mjs'

const recorded = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'))
const now = await snapshot()

const differences = (was: Record<string, any>, is: Record<string, any>) =>
  Object.keys({ ...was, ...is }).filter((k) => JSON.stringify(was[k]) !== JSON.stringify(is[k])).map((k) => `${k}: ${JSON.stringify(was[k]) ?? '(none)'} → ${JSON.stringify(is[k]) ?? '(none)'}`)

for (const site of SNAPSHOT_SITES) {
  test(`${site}: the assembled backend is byte-identical with its modules as configured`, () => {
    const d = differences(recorded[site].all, now[site].all)
    assert.deepEqual(d, [], d.join('\n'))
  })
  test(`${site}: and with each module off in turn`, () => {
    const d = differences(recorded[site].off, now[site].off)
    assert.deepEqual(d, [], d.join('\n'))
  })
}
