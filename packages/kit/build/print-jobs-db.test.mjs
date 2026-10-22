/*
 * A SET THAT OUTLIVES ITS REQUEST (openspec: print-production, "A book is set as a job that outlives its request"),
 * against the stack: print-render opens a job per set, leases it to one worker, writes down what it has finished, and
 * a later call — the sweep's, with { job } — carries a cut-off set on from there.
 *
 *   a set that finishes          answers as before, with its job, and the row holds the result
 *   a worker cut off mid-book    a job left with its interior done and its lease lapsed is finished by the next call,
 *                                which takes the interior back from the bucket instead of compiling it again
 *   a lease still held           another worker leaves it alone, and says so
 *   an owner cancels             the job stops, and the files it made for an edition the store does not sell go
 *   a job that never finishes    is failed once its attempts are spent, not tried for ever
 *   nobody else's                a visitor reads no job and claims none
 */
import { createClient } from '@supabase/supabase-js'
import { requireStack, notHere, moduleOn } from './test-stack.mjs'

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
/* a job's row once it is finished, waiting for the sweep or the worker still on it (a minute and a half at most) */
const settled = async (id) => { for (let i = 0; i < 45; i++) { const r = await rowOf(id); if (r && !['queued', 'running'].includes(r.state)) return r; await new Promise((res) => setTimeout(res, 2000)) } return rowOf(id) }

/* a book the site prints, from its rows (the content export put them there) */
const { data: books } = await service.from('content').select('path, text').like('path', 'content/books/%').is('deleted_at', null)
const printed = (books ?? []).find((b) => /^print:/m.test(b.text || ''))
if (!printed) { notHere('print-jobs-db', 'the site has no book with a print block in its rows'); process.exit(0) }
const BOOK = printed.path.replace(/^content\/books\//, '').replace(/\.md$/, '')
const CONTENTS = ((/\n  contents:\s*\n\s+- (\w+)/.exec(printed.text) || [])[1]) || 'parts'

try {
  /* ─── a set that finishes ─── */
  const began = new Date(Date.now() - 1000).toISOString()
  let first = await call({ book: BOOK, contents: CONTENTS, draft: true })
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
