/*
 * Lulu's webhook, at the url registered with it before there was one function for every
 * supplier: the same handler as print-webhook?provider=lulu (a registration is never lost).
 */
import { admin, json } from '../_shared/lib.ts'
import { printer, refreshPrintOrder } from '../_shared/print.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const p = printer('lulu')
  /* a mocked printer has nobody to call it, and each read of a mock job moves it on a step: a call here
     could only be somebody walking a pretend order to "shipped" */
  if (p.mock()) return json({ ok: true, ignored: 'mock printer' })
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const jobId = p.webhook(body)
  if (!jobId) return json({ ok: true, ignored: 'no job' })
  const { data: row } = await admin.from('fulfilments').select('*').eq('supplier_job', jobId).maybeSingle()
  if (!row) return json({ ok: true, ignored: 'unknown job' })
  const changed = await refreshPrintOrder(row)
  return json({ ok: true, changed })
})
