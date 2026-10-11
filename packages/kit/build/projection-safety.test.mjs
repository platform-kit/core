import assert from 'node:assert/strict'
import { projectEventComments, projectEvents } from './events-db.mjs'
import { projectSearch } from './search-db.mjs'

let pass = 0, fail = 0
const test = async (name, fn) => {
  try { await fn(); pass++ } catch (error) {
    fail++
    console.log(`  FAIL ${name}\n   ${String(error.message || error)}`)
  }
}

await test('search projection reports a failed index write', async () => {
  const db = { from: () => ({ upsert: async () => ({ error: { message: 'write failed' } }) }) }
  await assert.rejects(() => projectSearch({ rows: [{ kind: 'article', id: 'one' }], db }), /could not index documents: write failed/)
})

await test('search projection never sweeps after a failed existing-row read', async () => {
  const writes = []
  const db = {
    from: (table) => ({
      upsert: async () => ({ error: null }),
      select: async () => ({ data: null, error: { message: 'read failed' } }),
      delete: () => { writes.push(table); return { in: async () => ({ error: null }) } },
    }),
  }
  await assert.rejects(() => projectSearch({ rows: [{ kind: 'article', id: 'one' }], db }), /could not read existing documents: read failed/)
  assert.deepEqual(writes, [])
})

await test('event projection stops before writes when its prerequisite read fails', async () => {
  const writes = []
  const db = {
    from: (table) => ({
      select: async () => ({ data: null, error: { message: 'read failed' } }),
      insert: () => { writes.push(table) },
      update: () => { writes.push(table) },
      delete: () => { writes.push(table) },
    }),
  }
  await assert.rejects(() => projectEvents({ events: [], rows: [], db }), /could not read spaces: read failed/)
  assert.deepEqual(writes, [])
})

await test('event comment projection stops before cleanup when its read fails', async () => {
  const writes = []
  const db = {
    from: (table) => ({
      upsert: async () => ({ error: null }),
      select: () => ({ eq: async () => ({ data: null, error: { message: 'read failed' } }) }),
      delete: () => { writes.push(table); return { eq: () => ({ in: async () => ({ error: null }) }) } },
    }),
  }
  await assert.rejects(() => projectEventComments(db, []), /could not read comment subjects: read failed/)
  assert.deepEqual(writes, [])
})

console.log(`✔ projection safety: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
