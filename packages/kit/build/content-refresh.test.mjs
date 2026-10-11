import assert from 'node:assert/strict'
import { refreshContent } from './content-refresh.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++ } catch (e) { fail++; console.log('  FAIL', name, '\n   ', String(e.message || e)) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL', name, '\n   ', String(e.message || e)) }
}

await ta('a local content change runs prepare, function data, site, then local projections', async () => {
  const calls = []
  const run = async (phase, options) => { calls.push([phase, options.localProjectionOnly === true]); return [phase] }
  const makeFunctionsData = async (options) => { calls.push(['functions-data', options.phases, options.changed]); return ['bots'] }
  const result = await refreshContent({
    site: { root: '/site' }, changed: ['content/bots/companion.md'],
    env: { SUPABASE_URL: 'http://127.0.0.1:54321' }, run, makeFunctionsData,
  })
  assert.deepEqual(calls, [
    ['prepare', false],
    ['functions-data', ['functions'], ['content/bots/companion.md']],
    ['site', false],
    ['after', true],
  ])
  assert.deepEqual(result, { prepare: ['prepare'], functions: ['bots'], site: ['site'], after: ['after'] })
})

await ta('a remote content change never runs database projections', async () => {
  const calls = []
  await refreshContent({
    site: { root: '/site' }, changed: ['content/bots/companion.md'],
    env: { SUPABASE_URL: 'https://project.supabase.co' },
    run: async (phase, options) => { calls.push([phase, options.localProjectionOnly === true]); return [] },
    makeFunctionsData: async () => [],
  })
  assert.deepEqual(calls, [['prepare', false], ['site', false]])
})

console.log(`✔ content refresh: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
