/* What reader-content sends, against the local stack and its seed (functions/reader-content, _shared/gate.js):
   the demo's members-only book to a guest, a signed-in reader on nothing (free@example.com), the buyer of the
   book, a member (member@example.com), an expired session and a request that claims a class — each sent exactly
   what their own entitlements allow, a refusal carrying no text. Then the content table, which no visitor reads
   directly, and the rows a visitor is sent, cut as a guest may read them. Run from a site's root; skipped with a
   note when the stack or its functions are not up (READER_CONTENT_TEST=0 skips it too). */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { splitChapters } from '../supabase/functions/_shared/gate.js'
import { leave, notHere } from './test-stack.mjs'

const note = (m) => console.log('reader-content: ' + m)
if (process.env.READER_CONTENT_TEST === '0') { note('skipped (READER_CONTENT_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in the environment'); leave(0) }
const fn = url + '/functions/v1/reader-content'
let up = false
try { up = (await fetch(fn, { method: 'OPTIONS', signal: AbortSignal.timeout(4000) })).status < 500 } catch { /* down */ }
if (!up) { note('skipped — the functions are not served'); leave(0) }

/* the site's own first gated book (canAccess), and what its front matter lets a guest and a signed-in reader read */
const BOOKS_DIR = path.join(process.cwd(), 'content/books')
const front = (f) => (fs.readFileSync(f, 'utf8').match(/^---\n([\s\S]*?)\n---/) || [, ''])[1]
const gated = fs.existsSync(BOOKS_DIR) ? fs.readdirSync(BOOKS_DIR).filter((n) => n.endsWith('.md')).sort().find((n) => /^canAccess:\s*\n\s+- /m.test(front(path.join(BOOKS_DIR, n))) && !/^published:\s*false/m.test(front(path.join(BOOKS_DIR, n)))) : null
if (!gated) { notHere('reader-content', 'the site has no gated book (canAccess)'); process.exit(0) }
const BOOK = gated.replace(/\.md$/, '')
const file = path.join(BOOKS_DIR, gated)
const num = (k) => { const m = new RegExp('^' + k + ':\\s*(\\d+)', 'm').exec(front(file)); return m ? Number(m[1]) : null }
const GUEST = num('guestChapters') ?? 0, SIGNED = num('authenticatedChapters') ?? GUEST
const source = fs.readFileSync(file, 'utf8').replace(/^---[\s\S]*?\n---\n?/, '')
/* each chapter's last sentence: past any teaser, which is never more than half a chapter */
const lasts = splitChapters(source).map((p) => p.replace(/^# .*$/m, '').trim().split(/(?<=[.!?])\s+/).filter((s) => s.length > 20).pop())

let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const service = createClient(url, serviceKey(), { auth: { persistSession: false } })
const tokenOf = async (email) => {
  const r = await (await fetch(url + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()
  return r.access_token || null
}
const ask = async (body, token) => {
  const r = await fetch(fn, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const fullChapters = (raw) => lasts.filter((s) => String(raw || '').includes(s)).length

const member = await tokenOf('member@example.com'), free = await tokenOf('free@example.com')
if (!member || !free) { note('skipped — the seed has no member@ or free@ account'); leave(0) }
const userOf = async (token) => (await service.auth.getUser(token)).data.user
const memberId = (await userOf(member)).id, freeId = (await userOf(free)).id

/* the member is a member for this test, whatever the seed says; the grant is removed at the end */
const grant = await service.from('entitlements').insert({ user_id: memberId, kind: 'class', key: 'subscribed', source: 'reader-content-test', source_id: 'probe' }).select('id').single()

try {
  const book = { collection: 'books', slug: BOOK }
  const guest = await ask(book)
  ok('a guest is sent the book', guest.status === 200)
  ok('…with no locked chapter whole', fullChapters(guest.data.raw) <= GUEST, `${fullChapters(guest.data.raw)} whole, ${GUEST} free`)
  ok('…and every chapter title', splitChapters(guest.data.raw).length === lasts.length)

  const nonMember = await ask(book, free)
  ok('a signed-in reader on nothing gets no locked chapter', fullChapters(nonMember.data.raw) <= SIGNED, `${fullChapters(nonMember.data.raw)} whole, ${SIGNED} free`)

  const m = await ask(book, member)
  ok('a member is sent every chapter whole', fullChapters(m.data.raw) === lasts.length, `${fullChapters(m.data.raw)} of ${lasts.length}`)
  ok('…and the companion', typeof m.data.companion === 'string' || m.data.companion === null)

  /* buying a members-only book does not open it (the reader's own rule) */
  const bought = await service.from('entitlements').insert({ user_id: freeId, kind: 'product', key: BOOK, source: 'reader-content-test', source_id: 'probe' }).select('id').single()
  try {
    const b = await ask(book, free)
    ok('the buyer of a members-only book is sent no locked chapter', fullChapters(b.data.raw) <= SIGNED)
  } finally { if (bought.data) await service.from('entitlements').delete().eq('id', bought.data.id) }

  const expired = await ask(book, member.slice(0, -4) + 'xxxx')
  ok('a broken session is a guest', fullChapters(expired.data.raw) <= GUEST)
  const claimed = await ask({ ...book, class: 'subscribed', entitlements: { class: 'subscribed' } }, free)
  ok('a claimed class is ignored', fullChapters(claimed.data.raw) <= SIGNED)

  ok('an unknown record is not found', (await ask({ collection: 'books', slug: 'no-such-book' }, member)).status === 404)
  ok('a collection with no gate is refused', (await ask({ collection: 'products', slug: 'x' }, member)).status === 400)

  /* the content table: no visitor reads it; the rows they are sent are cut */
  const P = 'content/books/gate-probe.md', C = 'content/companions/gate-probe.md', A = 'content/articles/gate-probe.md'
  const probeBook = '# One\n\nFree words for everyone to read here.\n\n# Two\n\n' + 'Opening of the locked chapter. '.repeat(12) + 'The probe book ends with a private sentence.\n'
  const probeComp = '# One\n\n## Summary\n\nFree summary.\n\n# Two\n\n## Summary\n\nThe locked summary is private.\n\n## Quiz\n\n1. Q?\n   - [x] a\n   - [ ] b\n   - [ ] c\n   - [ ] d\n'
  const fm = (o) => '---\n' + Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\n'
  await service.from('content').upsert([
    { path: P, collection: 'books', slug: 'gate-probe', published: true, pending: false, data: { title: 'Probe', guestChapters: 1 }, body: probeBook, text: fm({ title: 'Probe', guestChapters: 1 }) + probeBook },
    { path: C, collection: 'companions', slug: 'gate-probe', published: true, pending: false, data: { book: 'gate-probe' }, body: probeComp, text: fm({ book: 'gate-probe' }) + probeComp },
    { path: A, collection: 'articles', slug: 'gate-probe', published: true, pending: false, data: { title: 'Gated', canAccess: ['paid'] }, body: 'The gated article is private.', text: fm({ title: 'Gated', canAccess: ['paid'] }) + 'The gated article is private.' },
  ])
  try {
    const direct = await createClient(url, anon, { auth: { persistSession: false } }).from('content').select('path, body, text').like('path', '%gate-probe%')
    ok('a visitor reads no content row directly', !direct.error && direct.data.length === 0, JSON.stringify(direct.data || direct.error).slice(0, 120))
    const rows = (await ask({ action: 'rows' })).data.rows || []
    const by = Object.fromEntries(rows.filter((r) => /gate-probe/.test(r.path)).map((r) => [r.collection, r]))
    const all = JSON.stringify(rows.filter((r) => /gate-probe/.test(r.path)))
    ok('the rows a visitor is sent include the probe records', !!(by.books && by.companions && by.articles))
    ok('…with no locked chapter, summary or gated article text', !/ends with a private sentence|locked summary is private|gated article is private/.test(all))
    ok('…keeping the free chapter and the locked chapter\'s title', by.books && by.books.body.includes('Free words for everyone') && /^# Two$/m.test(by.books.body))
    ok('…and saying which locked chapters have a quiz', by.companions && Array.isArray(by.companions.data.quizzed) && by.companions.data.quizzed.includes('Two'))
    const adminToken = await tokenOf('admin@example.com')
    if (adminToken) {
      const asAdmin = JSON.stringify(((await ask({ action: 'rows' }, adminToken)).data.rows || []).filter((r) => /gate-probe/.test(r.path)))
      ok('an administrator is sent the rows whole', /ends with a private sentence/.test(asAdmin) && /gated article is private/.test(asAdmin))
    }
  } finally { await service.from('content').delete().like('path', '%gate-probe%') }
} finally {
  if (grant.data) await service.from('entitlements').delete().eq('id', grant.data.id)
}

console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed (what each reader is sent)`)
process.exit(fail ? 1 : 0)
