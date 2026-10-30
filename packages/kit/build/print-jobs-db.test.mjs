/*
 * A SET THAT OUTLIVES ITS REQUEST (openspec: print-production, "A book is set as a job that outlives its request"),
 * against the stack: print-render opens a job per set, leases it to one worker, writes down what it has finished, and
 * a later call — the sweep's, with { job } — carries a cut-off set on from there.
 *
 *   a set waits for its interior the function compiles no interior: the job waits, the sweep leaves it, and the
 *                                administrator's browser sets it (build/print/typeset/interior.js — run here in Node,
 *                                the same WebAssembly) and hands it back; an interior off the binding is refused
 *   a set that finishes          answers as before, with its job, and the row holds the result
 *   the same edition again       takes the interior back from the bucket and never waits
 *   in a browser                 the browser's half, loaded through the site's own Vite as the admin bundle loads it
 *                                (the WebAssembly by its `?url`), finishes a waiting job to the same pages
 *   a worker cut off mid-book    a job left with its interior done and its lease lapsed is finished by the next call,
 *                                which takes the interior back from the bucket instead of compiling it again
 *   a lease still held           another worker leaves it alone, and says so
 *   an owner cancels             the job stops, and the files it made for an edition the store does not sell go
 *   a job that never finishes    is failed once its attempts are spent, not tried for ever
 *   nobody else's                a visitor reads no job and claims none
 */
import { createClient } from '@supabase/supabase-js'
import { requireStack, notHere, moduleOn } from './test-stack.mjs'
import { fileURLToPath } from 'node:url'
import { finishWaiting, setInterior } from './print/typeset/interior.js'

const S = requireStack('print-jobs-db')
if (!(await moduleOn('print'))) { notHere('print-jobs-db', 'the print module is off'); process.exit(0) }
let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + String(detail).slice(0, 400) : '')) } }
const O = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(S.api, S.service, O)
const anon = createClient(S.api, S.anon, O)
const call = async (body, bearer = S.service) => {
  const r = await fetch(`${S.functions}/print-render`, { method: 'POST', headers: { apikey: S.anon, authorization: 'Bearer ' + bearer, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const rowOf = async (id) => (await service.from('print_jobs').select('*').eq('id', id).maybeSingle()).data
const made = []
/* a job's row once it is finished, waiting for the sweep or the worker still on it: a worker cut off holds its lease
   for LEASE_SECONDS (150, print-render), the sweep asks again within the minute after, and the set then runs — so up
   to five minutes. Ninety seconds failed whenever the first worker was cut off with its lease still held. */
const settled = async (id) => { for (let i = 0; i < 150; i++) { const r = await rowOf(id); if (r && !['queued', 'running'].includes(r.state)) return r; await new Promise((res) => setTimeout(res, 2000)) } return rowOf(id) }

/* a book the site prints, from its rows (the content export put them there) */
const { data: books } = await service.from('content').select('path, text').like('path', 'content/books/%').is('deleted_at', null)
const printed = (books ?? []).find((b) => /^print:/m.test(b.text || ''))
if (!printed) { notHere('print-jobs-db', 'the site has no book with a print block in its rows'); process.exit(0) }
const BOOK = printed.path.replace(/^content\/books\//, '').replace(/\.md$/, '')
const CONTENTS = ((/\n  contents:\s*\n\s+- (\w+)/.exec(printed.text) || [])[1]) || 'parts'

try {
  /* ─── a set waits for its interior, which the browser sets ─── */
  /* a run before this one may have set this edition already, and then nothing waits: its interior goes, so the wait is seen */
  {
    const { data: old } = await service.from('print_jobs').select('done').eq('book', BOOK).eq('contents', CONTENTS).not('done->>edition', 'is', null).limit(20)
    for (const e of new Set((old ?? []).map((r) => r.done.edition))) await service.storage.from('print').remove([`${BOOK}/${e}/interior.json`])
  }
  const began = new Date(Date.now() - 1000).toISOString()
  let first = await call({ book: BOOK, contents: CONTENTS, draft: true })
  ok('a set with no interior for its edition waits for one', first.status === 202 && first.body?.state === 'waiting' && first.body?.waiting === 'interior' && typeof first.body?.job === 'string', JSON.stringify(first.body).slice(0, 300))
  if (first.body?.job) {
    made.push(first.body.job)
    const again = await call({ job: first.body.job })
    ok('…asked again without one, it still waits, and is not tried', again.status === 202 && again.body?.state === 'waiting' && (await rowOf(first.body.job)).attempts <= 1, JSON.stringify(again.body).slice(0, 200))
    const swept = await service.rpc('run_print_jobs')
    ok('…and the sweep leaves it alone', !swept.error && (await rowOf(first.body.job)).state === 'waiting', JSON.stringify(swept.error))
    const joined = await call({ book: BOOK, contents: CONTENTS, draft: true })
    ok('…a second set of the same book joins it', joined.body?.job === first.body.job && joined.body?.state === 'waiting', JSON.stringify(joined.body).slice(0, 200))

    /* the browser's half, with an interior that is not what it says: two pages more than the file holds */
    const h = (await call({ job: first.body.job, interior: 'handover' })).body
    ok('the handover says what to compile: the source, the type, the binding, where to put it', !!h?.files?.['interior.typ'] && h.fonts?.length > 0 && Number(h.min) > 0 && typeof h.upload === 'string' && !/kong/.test(h.upload), JSON.stringify(h && { min: h.min, fonts: h.fonts && h.fonts.length, upload: h.upload }).slice(0, 200))
    const fonts = []
    for (const p of h?.fonts || []) fonts.push(new Uint8Array(await (await fetch(S.api + p)).arrayBuffer()))
    const wrong = await setInterior({ files: h.files, fonts, min: h.min, step: h.step })
    const put = await fetch(S.api + h.upload, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'x-upsert': 'true' }, body: wrong.pdf })
    ok('…and the interior goes up to the address it gave', put.ok, put.status)
    const refused = await call({ job: first.body.job, interior: { edition: h.edition, pages: wrong.pages + 2, pad: wrong.pad + 2, where: [], marks: [] } })
    ok('an interior that is not what it says is refused, and the job with it', refused.status === 422 && (await rowOf(first.body.job)).state === 'failed', JSON.stringify(refused.body).slice(0, 200))
    first = await call({ book: BOOK, contents: CONTENTS, draft: true })
    if (first.body?.job) made.push(first.body.job)
    if (first.body?.state === 'waiting') {
      const body = await finishWaiting({ job: first.body.job, ask: async (b) => (await call(b)).body, base: S.api })
      first = { status: body && body.ok ? 200 : 500, body }
    }
  }

  /* ─── a set that finishes ─── */
  /* A COLD WORKER MAY LOSE THE ANSWER — the gateway gives up on a first set while the compiler loads — and that is the
     case a job is for: the set goes on, and its row has the result. So the caller asks the job, not the request. */
  if (!(first.status === 200 && first.body?.ok)) {
    const { data: opened } = await service.from('print_jobs').select('id').eq('book', BOOK).eq('contents', CONTENTS).gte('created_at', began).order('created_at', { ascending: false }).limit(1).maybeSingle()
    ok('a set whose answer was lost still has its job', !!opened, JSON.stringify(first.body).slice(0, 200))
    if (opened) { await settled(opened.id); first = await call({ job: opened.id }) }
  }
  ok('a set answers', first.status === 200 && first.body && first.body.ok === true, JSON.stringify(first.body).slice(0, 300))
  ok('…with the job it ran as', typeof first.body?.job === 'string')
  const done = first.body?.job ? await rowOf(first.body.job) : null
  if (done) made.push(done.id)
  ok('…and the job holds the result, done', done && done.state === 'done' && done.result && done.result.edition === first.body.edition, JSON.stringify(done && { state: done.state, error: done.error }))
  ok('…with the interior written down as finished, for its edition', !!done && done.done?.interior?.edition === first.body.edition && done.done.interior.pages > 0, JSON.stringify(done && done.done && done.done.interior && { edition: done.done.interior.edition, pages: done.done.interior.pages }))

  /* ─── the same edition again ─── */
  if (done && first.body?.edition) {
    const second = await call({ book: BOOK, contents: CONTENTS, draft: true })
    if (second.body?.job) made.push(second.body.job)
    ok('the same edition set again takes its interior back and never waits', second.status === 200 && second.body?.ok === true && second.body.edition === first.body.edition && second.body.pages === first.body.pages, JSON.stringify(second.body).slice(0, 200))
  }

  /* ─── the browser's half, in a browser ─── */
  if (done && first.body?.edition && S.app) {
    await service.storage.from('print').remove([`${BOOK}/${first.body.edition}/interior.json`])
    const w = await call({ book: BOOK, contents: CONTENTS, draft: true })
    if (w.body?.job) made.push(w.body.job)
    ok('with its interior gone, the same edition waits again', w.body?.state === 'waiting', JSON.stringify(w.body).slice(0, 200))
    if (w.body?.state === 'waiting') {
      const { launch, page: open } = await import('./browser.mjs')
      const browser = await launch()
      try {
        const { page } = await open(browser)
        await page.goto(S.app)
        /* the admin bundle's own imports (fixtures/print-interior-browser.js): Vite resolves them, and the .wasm by its ?url */
        const mod = '/@fs' + fileURLToPath(new URL('./fixtures/print-interior-browser.js', import.meta.url))
        const out = await page.evaluate(async ({ mod, job, fns, api, key }) => {
          try {
            const { finishWaiting, wasm } = await import(mod)
            const ask = async (body) => (await fetch(fns + '/print-render', { method: 'POST', headers: { authorization: 'Bearer ' + key, apikey: key, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
            const r = await finishWaiting({ job, ask, base: api, wasm })
            return { ok: r.ok, pages: r.pages, edition: r.edition, error: r.error }
          } catch (e) { return { thrown: String(e && e.message || e) } }
        }, { mod, job: w.body.job, fns: S.functions, api: S.api, key: S.service })
        ok('the browser\'s half, loaded as the admin bundle loads it, sets the same interior in a browser', out.ok === true && out.pages === first.body.pages && out.edition === first.body.edition, JSON.stringify(out).slice(0, 300))
      } finally { await browser.close() }
    }
  }

  /* ─── a worker cut off after the interior ─── */
  if (done && first.body?.edition) {
    const at = `${BOOK}/${first.body.edition}`
    const stamp = async () => ((await service.storage.from('print').list(at)).data || []).find((f) => f.name === 'interior.pdf')?.updated_at
    const before = await stamp()
    const { data: cut } = await service.from('print_jobs').insert({
      book: BOOK, contents: CONTENTS, request: { draft: true }, state: 'running', attempts: 1,
      lease_until: new Date(Date.now() - 60000).toISOString(), done: { edition: first.body.edition, interior: done.done.interior },
    }).select('*').single()
    made.push(cut.id)
    const resumed = await call({ job: cut.id })
    ok('a job cut off with its interior done is finished by the next call', resumed.status === 200 && resumed.body?.ok === true && resumed.body.job === cut.id, JSON.stringify(resumed.body).slice(0, 300))
    /* by this call or by the minute's sweep, whichever claimed it first: either way, the second attempt */
    ok('…on its second attempt', (await settled(cut.id)).attempts === 2, (await rowOf(cut.id)).attempts)
    ok('…the same edition and pages', resumed.body?.edition === first.body.edition && resumed.body?.pages === first.body.pages)
    ok('…taking the interior back rather than compiling it again', (await stamp()) === before, `${before} → ${await stamp()}`)
    const asked = await call({ job: cut.id })
    ok('a finished job asked again answers its result', asked.status === 200 && asked.body?.state === 'done' && asked.body?.edition === first.body.edition)
  }

  /* ─── a lease still held ─── */
  {
    const { data: busy } = await service.from('print_jobs').insert({ book: 'job-probe-held', contents: 'parts', state: 'running', attempts: 1, lease_until: new Date(Date.now() + 120000).toISOString() }).select('*').single()
    made.push(busy.id)
    const r = await call({ job: busy.id })
    ok('a job another worker holds is left alone, and says so', r.status === 202 && r.body?.running === true, JSON.stringify(r.body))
    ok('…its attempts unchanged', (await rowOf(busy.id)).attempts === 1)
  }

  /* ─── an owner cancels ─── */
  {
    const edition = 'feedfacefeedface'
    await service.storage.from('print').upload(`job-probe-cancel/${edition}/interior.pdf`, new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf', upsert: true })
    const { data: c } = await service.from('print_jobs').insert({ book: 'job-probe-cancel', contents: 'parts', state: 'running', attempts: 1, lease_until: new Date(Date.now() - 1000).toISOString(), done: { edition } }).select('*').single()
    made.push(c.id)
    const asked = await call({ job: c.id, cancel: true })
    ok('a cancel is taken', asked.status === 200 && asked.body?.cancelling === true, JSON.stringify(asked.body))
    const r = await call({ job: c.id })
    ok('…the next worker stops instead of setting', r.body?.state === 'cancelled', JSON.stringify(r.body))
    ok('…and the job says cancelled', (await rowOf(c.id)).state === 'cancelled')
    const left = ((await service.storage.from('print').list(`job-probe-cancel/${edition}`)).data || []).map((f) => f.name)
    ok('…and the files it made for an edition nobody sells are gone', !left.includes('interior.pdf'), left.join(', '))
  }

  /* ─── a job that never finishes ─── */
  {
    const { data: tired } = await service.from('print_jobs').insert({ book: 'job-probe-tired', contents: 'parts', state: 'running', attempts: 5, lease_until: new Date(Date.now() - 1000).toISOString() }).select('*').single()
    made.push(tired.id)
    const r = await call({ job: tired.id })
    ok('a job past its attempts is failed, not tried again', r.status === 500 && (await rowOf(tired.id)).state === 'failed', JSON.stringify(r.body))
  }

  /* ─── nobody else's ─── */
  {
    const { data: seen } = await anon.from('print_jobs').select('id').limit(1)
    ok('a visitor reads no job', !seen || seen.length === 0, JSON.stringify(seen))
    const claim = await anon.rpc('print_job_claim', { p_id: made[0] || '00000000-0000-0000-0000-000000000000', p_worker: 'visitor' })
    ok('…and claims none', !!claim.error, JSON.stringify(claim.data))
    const sweep = await anon.rpc('run_print_jobs')
    ok('…nor runs the sweep', !!sweep.error)
    const anonymous = await call({ book: BOOK, contents: CONTENTS }, S.anon)
    ok('…nor sets a book', anonymous.status === 401 || anonymous.status === 403, anonymous.status)
  }
} finally {
  if (made.length) await service.from('print_jobs').delete().in('id', made)
  await service.storage.from('print').remove(['job-probe-cancel/feedfacefeedface/interior.pdf'])
}

console.log(fail ? `print-jobs-db: ${fail} failed, ${pass} passed` : `print-jobs-db: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
