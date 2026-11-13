/*
 * Modules meet through slots (openspec: modules-as-packages): a module declares the places others may add to, others
 * fill them from their manifests, and a fill is installed only while its module, the slot's owner and everything it
 * names in `with` are on. A fill naming a slot nobody declares is refused.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readManifests, fillsOf } from './modules/manifest.mjs'
import { resolveModules } from './site.mjs'

const keys = (fills: Array<{ key: string, module: string }>) => fills.map((f) => `${f.module}:${f.key}`).sort()
const MODULES = resolveModules()

test('a fill for a slot nobody declares is refused', () => {
  const mod = (key: string, extra: any) => ({ key, what: key, static: true, git: true, cloud: true, ...extra })
  const { faults } = readManifests([
    { manifest: mod('host', { slots: ['shelf'] }), where: 'host' },
    { manifest: mod('guest', { fills: { 'host:shelf': [{ key: 'a' }], 'host:drawer': [{ key: 'b' }], 'core:nowhere': [{ key: 'c' }] } }), where: 'guest' },
  ])
  assert.ok(faults.some((f: string) => /fills host:drawer, a slot no module declares/.test(f)), faults.join('\n'))
  assert.ok(faults.some((f: string) => /fills core:nowhere, a slot no module declares/.test(f)), faults.join('\n'))
  assert.ok(!faults.some((f: string) => /host:shelf/.test(f)), faults.join('\n'))
})

test('courses with everything on fills the admin, the member card and the community', () => {
  const on = {}
  assert.deepEqual(keys(fillsOf(MODULES, on, 'core:admin-screen')).filter((k) => k.startsWith('courses:')), ['courses:course-enrollments'])
  assert.deepEqual(keys(fillsOf(MODULES, on, 'spaces:member-card')).filter((k) => k.startsWith('courses:')), ['courses:courses'])
  assert.deepEqual(keys(fillsOf(MODULES, on, 'spaces:place')).filter((k) => k.startsWith('courses:')), ['courses:courses'])
})

test('with spaces off, its slots take nothing, and courses still fills the admin', () => {
  const off = { spaces: false }
  assert.deepEqual(fillsOf(MODULES, off, 'spaces:member-card'), [])
  assert.deepEqual(fillsOf(MODULES, off, 'spaces:place'), [])
  assert.ok(keys(fillsOf(MODULES, off, 'core:admin-screen')).includes('courses:course-enrollments'))
})

test('with the network off, the Courses place is not in the community', () => {
  assert.ok(!keys(fillsOf(MODULES, { network: false }, 'spaces:place')).includes('courses:courses'))
  assert.ok(keys(fillsOf(MODULES, { network: false }, 'spaces:member-card')).includes('courses:courses'))
})

test('with courses off, nothing of it is in any slot', () => {
  const off = { courses: false }
  for (const slot of ['core:admin-screen', 'spaces:member-card', 'spaces:place']) assert.ok(!fillsOf(MODULES, off, slot).some((f) => f.module === 'courses'), slot)
})
