/*
 * THE BEST SELLER IS EARNED, AND NO SALES MEANS NO BADGE.
 *
 * The Bestseller badge is not a field anybody sets — it is the book that actually sold most in
 * ninety days, read from the paid purchases at build time. Two things follow, and both are easy
 * to lose without anybody noticing.
 *
 * NO SALES MEANS NO BADGE. A new site, or a site whose database is out of reach at build time,
 * must not print "Bestseller" on something. A badge on a book nobody has bought is a small lie
 * told in the shop window, and the person who would catch it — whoever set up the site — is
 * exactly the person who has no sales to compare it against.
 *
 * AND IT MUST BE THE RIGHT BOOK. The count is per book, across every offer that names it (an
 * unlock and a printed copy are both sales of the same book), and a tie goes to whichever sold
 * most recently rather than to whichever the database happened to return first — otherwise the
 * badge moves between two books at random on every deploy.
 *
 * The compile is exercised against the real stack where it is up. Where it is not, the
 * no-database path is still checked, because that is the path a fresh clone takes.
 *
 *   node packages/kit/build/sales.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

let n = 0, bad = 0
const t = async (name, fn) => { n++; try { await fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 5).join('\n    ')) } }
const note = (s) => console.log('  ' + s)

const OUT = path.join(process.cwd(), '.velite', 'sales.json')
const had = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null
const salesModule = new URL('./sales.mjs', import.meta.url).href

/* ─── the path a fresh clone takes: no database, and therefore no claim ─── */
await t('with no database in reach there is no best seller, and it says why', async () => {
  /* Run from a directory that has no .env. Clearing the environment is not enough: the script
     loads .env from its working directory itself, so a test that only unset SUPABASE_URL was
     still handed the real one and reported a best seller — which looked like the no-database
     path being broken when it was the test never reaching it. */
  const os = await import('node:os')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-noenv-'))
  try {
    const r = execSync(`${process.execPath} -e "import(process.argv[1]).then(m => m.salesReport()).then(r => console.log(JSON.stringify(r)))" ${JSON.stringify(salesModule)}`,
      { cwd: tmp, encoding: 'utf8' })
    const out = JSON.parse(r.trim().split('\n').pop())
    assert.equal(out.bestseller, null, 'a site with no database named a best seller')
    assert.deepEqual(out.books, {})
    assert.ok(out.note, 'it did not say why')
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})

/* ─── against the stack: what it reports must follow from the rows ─── */
let cfg = null
try { cfg = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) } catch { /* down */ }
if (!cfg || !cfg.API_URL) note('⚠ no local stack — the best seller is only checked on the no-database path in this run')
else {
  const { createClient } = await import('@supabase/supabase-js')
  const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const env = { ...process.env, SUPABASE_URL: cfg.API_URL, SUPABASE_SERVICE_ROLE_KEY: cfg.SERVICE_ROLE_KEY }
  const run = () => JSON.parse(execSync(`${process.execPath} -e "import(process.argv[1]).then(m => m.salesReport()).then(r => console.log(JSON.stringify(r)))" ${JSON.stringify(salesModule)}`,
    { cwd: process.cwd(), encoding: 'utf8', env }).trim().split('\n').pop())

  /* which offers name a book at all — without one, no purchase can be attributed */
  let offers = {}
  try { offers = JSON.parse(fs.readFileSync('supabase/functions/_shared/catalog.json', 'utf8')).offers || {} } catch { /* none */ }
  const bookOffers = Object.values(offers).filter((o) => o.book)
  if (!bookOffers.length) note('⚠ no offer in the catalog names a book — the attribution cannot be checked here')
  else {
    const A = bookOffers[0]
    const other = bookOffers.find((o) => o.book !== A.book)
    const PROBE = 'cs_sales_probe_'
    const clean = async () => { await admin.from('purchases').delete().like('stripe_checkout_session_id', PROBE + '%') }
    const buy = async (offer, i, when) => admin.from('purchases').insert({
      stripe_checkout_session_id: PROBE + Date.now() + '_' + i, key: offer.key, sku: offer.sku,
      status: 'paid', amount_total: 1000, currency: 'usd', created_at: when,
    })
    await clean()
    const before = run()

    try {
      const ago = (d) => new Date(Date.now() - d * 86400e3).toISOString()
      /* three of A, so it outsells whatever the seed holds by a clear margin */
      const need = (before.books[A.book] || 0)
      const top = Math.max(...Object.values(before.books || {}), 0)
      const buys = top - need + 3
      for (let i = 0; i < buys; i++) await buy(A, i, ago(1))
      const now = run()
      await t('a book that sold most is the best seller', async () => {
        assert.equal(now.bestseller, A.book, `sold ${JSON.stringify(now.books)}`)
      })
      await t('and the count is per BOOK, not per offer', async () => {
        assert.equal(Number(now.books[A.book] || 0), need + buys, `${now.books[A.book]} for ${need + buys} purchases`)
      })

      /* a purchase older than the window must not count */
      await buy(A, 999, ago(120))
      const aged = run()
      await t('a purchase older than the ninety days is not counted', async () => {
        assert.equal(Number(aged.books[A.book] || 0), Number(now.books[A.book] || 0), 'an old sale was counted')
      })

      /* A REFUND IS NOT A SALE. `purchases.status` may only be paid or refunded — the first
         version of this used 'open', which the constraint rejects, so the row never existed and
         the check passed by comparing a count with itself. The insert is asserted now. */
      const ref = await admin.from('purchases').insert({ stripe_checkout_session_id: PROBE + 'refunded', key: A.key, sku: A.sku, status: 'refunded', amount_total: 1000, currency: 'usd', created_at: ago(1) })
      await t('a refunded purchase can be written', async () => { assert.ok(!ref.error, ref.error && ref.error.message) })
      const unpaid = run()
      await t('a refunded purchase is not a sale', async () => {
        assert.equal(Number(unpaid.books[A.book] || 0), Number(now.books[A.book] || 0), 'a refund counted as a sale')
      })

      if (other) {
        await t('and a book with fewer sales does not wear the badge', async () => {
          assert.notEqual(unpaid.bestseller, other.book)
        })
      }
    } finally {
      await clean()
      run()   /* leave sales.json as the real rows say */
    }
  }
}

/* the checkout is left as it was found */
if (had != null) fs.writeFileSync(OUT, had)

console.log(bad ? `sales: ${n - bad} passed, ${bad} failed` : `sales: ${n} passed, 0 failed`)
process.exit(bad ? 1 : 0)
