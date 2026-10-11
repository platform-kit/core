/* The webhook subscriptions a deployment ships: declared in platformkit.config.js, written to
   webhooks.json with no secret in it, and pushed into four tables that do not agree on what a
   subscription looks like. What this pins is the part that could quietly go wrong: a secret read
   from the environment and never from the file, a subscription somebody made through the API never
   touched, a subscription that stays being updated rather than remade so what it has done survives
   a deploy, and one the file no longer names removed. Skipped with a note when the stack is down. */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'

const note = (m) => console.log('webhooks: ' + m)
if (process.env.WEBHOOKS_TEST === '0') { note('skipped (WEBHOOKS_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
if (!url || !localStack()) { note('skipped — no local stack in .env'); process.exit(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); process.exit(0) }

let pass = 0, fail = 0
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m + (d ? ' — ' + d : '')) } }
const svc = createClient(url, serviceKey(), { auth: { persistSession: false } })
const rows = async (t) => ((await svc.from(t).select('*')).data) || []

const F = join(process.cwd(), 'supabase/functions/_shared/webhooks.json')

/*
 * WAIT FOR THE FUNCTIONS TO COME BACK.
 *
 * Writing this file is the point of the test — but where a dev server is running `functions
 * serve`, every write to the functions tree makes the edge runtime reload EVERY function, and the
 * next test in the run that calls one is answered "an invalid response was received from the
 * upstream server" by a runtime that is still starting. That is how this test silently broke
 * print-cloud in the full suite while passing on its own, and cost two suite runs before anybody
 * looked at which test ran before it.
 *
 * A test that disturbs the runtime settles it again before it returns.
 */
async function settle(ms = 30000) {
  /* the same default the other stack tests take, since a test run does not carry VITE_* */
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
  const alive = async () => {
    try { const r = await fetch(url + '/functions/v1/print-render', { method: 'POST', body: '{}', signal: AbortSignal.timeout(3000) }); return r.status !== 502 && r.status !== 503 }
    catch { return false }
  }
  /* First give the watcher time to NOTICE. Polling straight away sees a runtime that has not
     started reloading yet, returns healthy, and the restart then lands on whatever test runs
     next — which is the bug this function exists to stop, written once already. */
  await new Promise((r) => setTimeout(r, 2500))
  /* then wait for it to be healthy and STAY healthy, rather than for one lucky answer */
  const until = Date.now() + ms
  let run = 0
  while (Date.now() < until) {
    run = (await alive()) ? run + 1 : 0
    if (run >= 4) return
    await new Promise((r) => setTimeout(r, 500))
  }
}
const had = existsSync(F) ? readFileSync(F, 'utf8') : '[]\n'
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
  await pushWebhooks()

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
  await pushWebhooks()

  c = await rows('content_webhooks')
  const after = c.find((r) => r.source === 'file')
  ok('one that stays is updated rather than remade, so what it has done survives a deploy', !!after && after.id === before.id && !!after.last_at)
  ok('and says what the file now says', !!after && after.name === 'Our indexer, renamed')
  ok('a kind the file dropped entirely is cleared', !(await rows('support_webhooks')).some((r) => r.source === 'file'))
  ok('and theirs has still never been touched', c.some((r) => r.id === mine.id))
} finally {
  if (mine) await svc.from('content_webhooks').delete().eq('id', mine.id)
  for (const t of ['content_webhooks', 'support_webhooks', 'scheduling_webhooks', 'form_webhooks']) await svc.from(t).delete().eq('source', 'file')
  writeFileSync(F, had)
  await settle()
}

console.log('\nwebhooks: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
