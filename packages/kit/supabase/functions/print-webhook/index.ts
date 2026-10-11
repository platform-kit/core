/*
 * The printers' webhook, one function for all: <functions>/print-webhook?provider=<id>. A printer
 * POSTs when a job moves — Lulu to the url registered with it (build/deploy.mjs), Mixam to the
 * callback each order names. No user JWT (verify_jwt is off); the body is not trusted — the
 * printer's module says which job the call names, the job is read back from the printer's API and
 * the row set from that, so a forged call can at most cause a refresh. Bookvault sends none: its
 * open orders are refreshed by the admin's page and by print-order.
 */
import { admin, json } from '../_shared/lib.ts'
import { printer, refreshPrintOrder } from '../_shared/print.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const id = new URL(req.url).searchParams.get('provider') || 'lulu'
  let p: any
  try { p = printer(id) } catch { return json({ error: 'unknown printer' }, 400) }
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const jobId = p.webhook(body)
  if (!jobId) return json({ ok: true, ignored: 'no job' })
  const { data: row } = await admin.from('fulfilments').select('*').eq('supplier_job', jobId).maybeSingle()
  if (!row) return json({ ok: true, ignored: 'unknown job' })
  const changed = await refreshPrintOrder(row)
  return json({ ok: true, changed })
})
