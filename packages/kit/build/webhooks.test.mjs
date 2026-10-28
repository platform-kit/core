/* The webhook subscriptions a deployment ships: declared in platformkit.config.js, written to
   webhooks.json with no secret in it, and pushed into four tables that do not agree on what a
   subscription looks like. What this pins is the part that could quietly go wrong: a secret read
   from the environment and never from the file, a subscription somebody made through the API never
   touched, a subscription that stays being updated rather than remade so what it has done survives
   a deploy, and one the file no longer names removed. Skipped with a note when the stack is down. */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const note = (m) => console.log('webhooks: ' + m)
if (process.env.WEBHOOKS_TEST === '0') { note('skipped (WEBHOOKS_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
if (!url || !localStack()) { note('skipped — no local stack in .env'); leave(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); leave(0) }

let pass = 0, fail = 0
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m + (d ? ' — ' + d : '')) } }
const svc = createClient(url, serviceKey(), { auth: { persistSession: false } })
const rows = async (t) => ((await svc.from(t).select('*')).data) || []

/* the declaration goes to a file of the test's own: the site's webhooks.json is in the functions folder the stack
   serves, and every write there reloaded every function mid-run */
const SCRATCH = mkdtempSync(join(tmpdir(), 'webhooks-test-'))
const F = join(SCRATCH, 'webhooks.json')
const { pushWebhooks } = await import('./webhooks-push.mjs')
process.env.SUPABASE_URL = url
process.env.WH_TEST_SECRET = 'shhh-' + Math.random().toString(36).slice(2, 8)

let mine = null
try {
  const made = await svc.from('content_webhooks').insert({ name: 'Theirs', url: 'https://theirs.example/hook', topics: ['entry.published'] }).select().single()
  mine = made.data

  writeFileSync(F, JSON.stringify([
    { kind: 'content', name: 'Our indexer', url: 'https://ours.example/hook', topics: ['entry.published'] },
    { kind: 'support', url: 'https://ours.example/desk', subscriptions: [] },
    { kind: 'scheduling', url: 'https://ours.example/cal', triggers: [], secret_env: 'WH_TEST_SECRET' },
  ], null, 2) + '\n')
  await pushWebhooks({ file: F })

  let c = await rows('content_webhooks')
  ok('a shipped subscription is there after a deploy', c.some((r) => r.url === 'https://ours.example/hook' && r.source === 'file'))
  ok('one somebody made through the API is untouched', c.some((r) => r.id === mine.id && r.source === 'hand'))
  ok('a table that calls the address something else still gets one',
    (await rows('scheduling_webhooks')).some((r) => r.subscriber_url === 'https://ours.example/cal' && r.source === 'file'))
  ok('the secret is read from the environment', ((await rows('scheduling_webhooks')).find((r) => r.source === 'file') || {}).secret === process.env.WH_TEST_SECRET)
  ok('and is nowhere in the file', !readFileSync(F, 'utf8').includes(process.env.WH_TEST_SECRET))
  ok('every kind is pushed', (await rows('support_webhooks')).some((r) => r.source === 'file'))

  const before = (await rows('content_webhooks')).find((r) => r.source === 'file')
  await svc.from('content_webhooks').update({ last_at: new Date().toISOString() }).eq('id', before.id)
  writeFileSync(F, JSON.stringify([{ kind: 'content', name: 'Our indexer, renamed', url: 'https://ours.example/hook', topics: [] }], null, 2) + '\n')
  await pushWebhooks({ file: F })

  c = await rows('content_webhooks')
  const after = c.find((r) => r.source === 'file')
  ok('one that stays is updated rather than remade, so what it has done survives a deploy', !!after && after.id === before.id && !!after.last_at)
  ok('and says what the file now says', !!after && after.name === 'Our indexer, renamed')
  ok('a kind the file dropped entirely is cleared', !(await rows('support_webhooks')).some((r) => r.source === 'file'))
  ok('and theirs has still never been touched', c.some((r) => r.id === mine.id))
} finally {
  if (mine) await svc.from('content_webhooks').delete().eq('id', mine.id)
  for (const t of ['content_webhooks', 'support_webhooks', 'scheduling_webhooks', 'form_webhooks']) await svc.from(t).delete().eq('source', 'file')
  rmSync(SCRATCH, { recursive: true, force: true })
}

console.log('\nwebhooks: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
