/*
 * A print order, from the admin's side: POST { id, action: 'submit' | 'refresh' }.
 * `submit` sends a new or failed order to the printer (a retry after the edition
 * was set, or the printer was down); `refresh` reads the job back and puts its
 * status and tracking on the row — the printer's webhook does the same on its
 * own, this is for looking now. And { action: 'proof', book, contents, format,
 * cloth, foil, address, email, level } orders ONE copy of a set edition to the
 * admin's own address — a proof, flagged on its row and never a purchase — and
 * sends it at once: the copy an edition is read on before it is marked proofed and
 * put on sale (the block's proofed record; the store and the catalog refuse an
 * edition without it). Admins only; the row itself is never written from the
 * client (fulfilments has no insert or update policy).
 */
import { admin, json, preflight, getUser } from '../_shared/lib.ts'
import { rolesOf, isAdmin } from '../_shared/roles.ts'
import { offerByKey } from '../_shared/offers.ts'
import { submitPrintOrder, refreshPrintOrder, editionOf, bookOf, chosenOf } from '../_shared/print.ts'

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const user = await getUser(req)
  if (!user) return json({ error: 'sign in' }, 401)
  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (!isAdmin(await rolesOf(user.id))) return json({ error: 'admins only' }, 403)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const id = String(body?.id ?? ''), action = String(body?.action ?? 'refresh')
  if (action === 'proof') {
    const book = String(body?.book ?? ''), contents = String(body?.contents ?? 'parts'), format = String(body?.format ?? 'softcover')
    const b = bookOf(book), ed = editionOf(book, contents)
    if (!b || !ed) return json({ error: 'no such edition has been set — set the editions first' }, 404)
    const key = b.keys?.[format]
    if (!key || !ed.printers?.[format]) return json({ error: `the edition has no ${format}` }, 400)
    const a = body?.address && typeof body.address === 'object' ? body.address : {}
    const address = { name: String(a.name ?? ''), line1: String(a.line1 ?? ''), line2: String(a.line2 ?? ''), city: String(a.city ?? ''), state: String(a.state ?? ''), postal_code: String(a.postal_code ?? ''), country: String(a.country ?? '').toUpperCase(), phone: String(a.phone ?? '') }
    if (!address.name || !address.line1 || !address.city || !address.postal_code || !address.country) return json({ error: 'the address needs a name, a line, a city, a postal code and a country' }, 400)
    const { data: row, error } = await admin.from('fulfilments').insert({
      purchase_id: null, user_id: user.id, email: String(body?.email ?? user.email ?? ''),
      key, quantity: 1, address, status: 'new', shipping_level: String(body?.level ?? 'standard'),
      variant: [contents, body?.cloth, body?.foil].filter(Boolean).map(String).join('.'),
      chosen: { book, edition: ed.edition, format, contents, cloth: body?.cloth ? String(body.cloth) : '', foil: body?.foil ? String(body.foil) : '' },
      supplier: ed.printers[format].provider ?? '', proof: true,   /* the edition says who; never a guess */
    }).select().single()
    if (error || !row) return json({ error: 'the proof could not be recorded — ' + (error?.message ?? '') }, 500)
    const job = await submitPrintOrder(row, b.title)
    const { data: after } = await admin.from('fulfilments').select('*').eq('id', row.id).maybeSingle()
    return json({ ok: !!job, order: after })
  }
  const { data: row } = await admin.from('fulfilments').select('*').eq('id', id).maybeSingle()
  if (!row) return json({ error: 'no such order' }, 404)
  if (action === 'submit') {
    if (!['new', 'failed'].includes(row.status)) return json({ error: 'already with the printer' }, 409)
    const job = await submitPrintOrder(row, offerByKey(row.key)?.title ?? chosenOf(row).book ?? '')
    const { data: after } = await admin.from('fulfilments').select('*').eq('id', id).maybeSingle()
    return json({ ok: !!job, order: after })
  }
  const changed = await refreshPrintOrder(row)
  const { data: after } = await admin.from('fulfilments').select('*').eq('id', id).maybeSingle()
  return json({ ok: true, changed, order: after })
})
