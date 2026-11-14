/*
 * A module is reached only through its front doors (openspec: modules-as-packages): no file outside a module's folder
 * imports anything in it but its index.ts or its build/index.mts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { allCrossings, crossings } from './modules/boundaries.mjs'

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('nothing in the kit or a fixture site reaches past a module\'s front doors', () => {
  const found = allCrossings()
  assert.deepEqual(found, [], found.join('\n'))
})

test('an import past the front door is refused, naming it', () => {
  const planted = [{ file: path.join(KIT, 'build', 'planted.mts'), text: `import { libraryOf } from '../modules/courses/lib/paths.js'\nimport { KINDS } from '../modules/courses/build/index.mjs'\n` }]
  const found = crossings(planted)
  assert.equal(found.length, 1, found.join('\n'))
  assert.match(found[0], /build\/planted\.mts → packages\/kit\/modules\/courses\/lib\/paths\.js/)
})

test('by package name too, and from another module', () => {
  const planted = [{ file: path.join(KIT, 'modules', 'other', 'ui', 'X.vue'), text: `<script setup>\nimport CoursePlayer from 'platformkit/modules/courses/ui/CoursePlayer.vue'\nimport { libraryOf } from 'platformkit/modules/courses/index.js'\n</script>` }]
  const found = crossings(planted)
  assert.equal(found.length, 1, found.join('\n'))
  assert.match(found[0], /CoursePlayer\.vue/)
})

test('inside its own folder a module imports what it likes', () => {
  assert.deepEqual(crossings([{ file: path.join(KIT, 'modules', 'courses', 'ui', 'CoursesView.vue'), text: `import X from './CoursePlayer.vue'\nimport { readCourses } from '../build/io.mjs'` }]), [])
})

test('every relative import inside a module folder points at a file', async () => {
  const { unresolved } = await import('./modules/boundaries.mjs')
  const found = unresolved()
  assert.deepEqual(found, [], found.join('\n'))
})
