/*
 * PUBLIC DOORS HAVE ABUSE LIMITS — one visitor's flood refused, and another visitor still served, at each
 * door anybody can reach: guest checkout, form answers, analytics intake and the support widget, against
 * the local stack. Sign-up is the auth server's own per-address limit, read from the config it runs with.
 *
 * A visitor is the address the platform's proxy writes (cf-connecting-ip here, as Cloudflare sets it in
 * front of a hosted project), never the first x-forwarded-for entry, which is the caller's to write; a
 * signed-in reader is counted by their account wherever they are. To reach a limit of hundreds without
 * sending hundreds of requests, the visitor's count is filled in the shared counter first (api_rate_take,
 * the one every isolate reads), and the next request is the one that must be refused.
 *
 * Run from a site's root with the stack's env; skipped with a note when it is down (ABUSE_LIMITS_TEST=0).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const note = (m) => console.log('abuse-limits: ' + m)
if (process.env.ABUSE_LIMITS_TEST === '0') { note('skipped (ABUSE_LIMITS_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
if (!url || !anonKey || !localStack()) { note('skipped — no local stack in the environment'); leave(0) }
try { const r = await fetch(`${url}/functions/v1/ingest`, { method: 'OPTIONS', signal: AbortSignal.timeout(4000) }); if (r.status >= 500) throw new Error() } catch { note('skipped — the functions are not served'); leave(0) }

let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + String(detail).slice(0, 300) : '')) } }
const DB_URL = process.env.PLATFORMKIT_TEST_DB_URL || `postgresql://postgres:postgres@127.0.0.1:${Number(new URL(url).port || 54321) + 1}/postgres`
const sql = async (q, args) => { const db = new pg.Client({ connectionString: DB_URL }); await db.connect(); try { return (await db.query(q, args)).rows } finally { await db.end() } }
/* the site's limits, as the functions read them (the policy record compiled beside them) */
const funnels = path.join(process.cwd(), 'supabase/functions/_shared/emails/funnels.json')
const policy = fs.existsSync(funnels) ? (JSON.parse(fs.readFileSync(funnels, 'utf8')).policy || {}) : {}
const LIMIT = { checkout: policy['limit-checkout'] || 30, forms: policy['limit-forms'] || 300, analytics: policy['limit-analytics'] || 1200 }
/* the counter's key for an address: a hash of it, as _shared/doors.ts makes it — never the address itself */
const { createHash } = await import('node:crypto')
const hashed = (ip) => 'a:' + createHash('sha256').update('platformkit-door:' + ip).digest('hex').slice(0, 32)
const fill = (who, n) => sql('select public.api_rate_take($1, null) from generate_series(1, $2)', [who, n])
const n = Math.floor(Math.random() * 200) + 20
const flooder = `198.51.100.${n}`, other = `198.51.100.${n + 1}`
const post = (fn, body, headers = {}) => fetch(`${url}/functions/v1/${fn}`, { method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const uuid = () => crypto.randomUUID()

try {
  /* ─── guest checkout ─── */
  await fill(`door:checkout:${hashed(flooder)}`, LIMIT.checkout)
  const over = await post('create-checkout-session', { items: [] }, { 'cf-connecting-ip': flooder })
  ok(`guest checkout refuses a visitor past ${LIMIT.checkout} an hour`, over.status === 429, over.status)
  const fine = await post('create-checkout-session', { items: [] }, { 'cf-connecting-ip': other })
  ok('…and still serves another visitor', fine.status !== 429, fine.status)
  /* a signed-in reader is counted by their account, wherever they are */
  {
    const c = createClient(url, anonKey, { auth: { persistSession: false } })
    const { data } = await c.auth.signInWithPassword({ email: 'free@example.com', password: 'password123' })
    if (data?.session) {
      await fill(`door:checkout:u:${data.user.id}`, LIMIT.checkout)
      const r = await post('create-checkout-session', { items: [] }, { authorization: 'Bearer ' + data.session.access_token, 'cf-connecting-ip': `198.51.100.${n + 2}` })
      ok('…and a signed-in reader is counted by their account, from any address', r.status === 429, r.status)
      await sql('delete from public.api_rate where who = $1', [`door:checkout:u:${data.user.id}`])
    } else note('⚠ free@ does not sign in — the account check is skipped')
  }

  /* ─── form answers ─── */
  await fill(`door:forms:${hashed(flooder)}`, LIMIT.forms)
  const f1 = await post('form', { action: 'get', form: 'probe' }, { 'cf-connecting-ip': flooder, 'x-form-anon': uuid() })
  ok(`form answers refuse a visitor past ${LIMIT.forms} an hour, whatever anonymous id they send`, f1.status === 429, f1.status)
  const f2 = await post('form', { action: 'get', form: 'probe' }, { 'cf-connecting-ip': other, 'x-form-anon': uuid() })
  ok('…and still serve another visitor', f2.status !== 429, f2.status)

  /* ─── analytics intake ─── */
  const batch = (anon) => ({ batch: [{ type: 'probe_flood', anon_id: anon, session_id: uuid(), path: '/' }] })
  await fill(`door:analytics:${hashed(flooder)}`, LIMIT.analytics)
  const a1 = await post('ingest', batch(uuid()), { 'cf-connecting-ip': flooder })
  ok(`analytics intake refuses a visitor past ${LIMIT.analytics} batches an hour, whatever anonymous id they send`, a1.status === 429, a1.status)
  const a2 = await post('ingest', batch(uuid()), { 'cf-connecting-ip': other })
  ok('…and still takes another visitor\'s', a2.status === 200, a2.status + ' ' + (await a2.text()).slice(0, 100))
  /* the caller's own x-forwarded-for is not who they are: a spoofed first entry is never counted as a visitor */
  {
    const spoof = `203.0.113.${n}`
    await post('ingest', batch(uuid()), { 'x-forwarded-for': spoof })
    const rows = await sql('select who from public.api_rate where who = $1 or who like $2', [`door:analytics:${hashed(spoof)}`, `door:%${spoof}%`])
    ok('a caller\'s own x-forwarded-for entry is never the address counted', !rows.length, JSON.stringify(rows))
    const raw = await sql('select who from public.api_rate where who ~ $1', ['^door:.*[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+'])
    ok('and no address is ever written into the counter', !raw.length, JSON.stringify(raw))
  }
  /* a compressed body that opens far past any batch is refused, not opened */
  {
    const { gzipSync } = await import('node:zlib')
    /* valid JSON when opened — an empty batch padded with eight megabytes of space — so only the cap refuses it */
    const bomb = gzipSync(Buffer.concat([Buffer.from('{"api_key":"probe","batch":['), Buffer.alloc(8 << 20, 32), Buffer.from(']}')]))
    const r = await fetch(`${url}/functions/v1/ingest/e/?compression=gzip-js`, { method: 'POST', headers: { apikey: anonKey, 'content-type': 'text/plain', 'cf-connecting-ip': other }, body: bomb })
    const said = await r.text()
    ok('a compressed body that opens past a megabyte is refused unopened', r.status === 400 && /json/.test(said), r.status + ' ' + said.slice(0, 80))
  }

  /* ─── the support widget ─── */
  {
    const results = []
    for (let i = 0; i < 6; i++) results.push((await post('support', { action: 'start', body: 'probe ' + i }, { 'cf-connecting-ip': flooder })).status)
    ok('the support widget refuses a sixth new guest from one visitor in an hour', results.slice(0, 5).every((s) => s === 200) && results[5] === 429, results.join(','))
    const r = await post('support', { action: 'start', body: 'probe other' }, { 'cf-connecting-ip': other })
    ok('…and still serves another visitor', r.status === 200, r.status)
  }

  /* ─── sign-up: the auth server's own per-address limit ─── */
  {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const tpl = fs.readFileSync(path.join(here, '../supabase/config.toml.template'), 'utf8')
    const m = /\[auth\.rate_limit\][\s\S]*?\nsign_in_sign_ups\s*=\s*(\d+)/.exec(tpl)
    ok('sign-ups and sign-ins are limited per address by the auth server', !!m && Number(m[1]) > 0 && Number(m[1]) <= 60, m ? m[1] : 'no sign_in_sign_ups')
  }
} finally {
  await sql(`delete from public.api_rate where who = any($1)`, [['checkout', 'forms', 'analytics'].flatMap((d) => [`door:${d}:${hashed(flooder)}`, `door:${d}:${hashed(other)}`])]).catch(() => {})
  await sql(`delete from public.events where type = 'probe_flood'`).catch(() => {})
  await sql(`delete from public.support_contacts where ip in ($1, $2)`, [flooder, other]).catch(() => {})
}

console.log(fail ? `abuse-limits: ${fail} failed, ${pass} passed` : `abuse-limits: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
