/*
 * A buyer's files: POST { book } → { files: [{ contents, format, url }] } — the PDFs and
 * EPUBs of a book the signed-in reader has bought, as a download of their own or with a
 * printed copy that includes them (the offer's `includes`, src/lib/print-offers.js). A file
 * bought is every edition of it: the parts, the full text, the summary, whichever the
 * build has set — the contents are a choice at print time, not a limit on what is theirs.
 * The urls are signed into the private `print` bucket for an hour; the client asks again
 * when they lapse.
 */
import { admin, json, preflight, getUser } from '../_shared/lib.ts'
import { OFFERS } from '../_shared/offers.ts'
import { editionsOf } from '../_shared/print.ts'

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const user = await getUser(req)
  if (!user) return json({ error: 'sign in' }, 401)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const slug = String(body?.book ?? '')
  if (!/^[a-z0-9-]+$/.test(slug)) return json({ error: 'bad request' }, 400)
  /* what of this book they hold: the skus of their paid purchases */
  const { data: rows } = await admin.from('purchases').select('sku, key').eq('user_id', user.id).eq('status', 'paid')
  const held = new Set<string>()
  for (const r of rows ?? []) {
    const o = Object.values(OFFERS).find((x) => x.sku === r.sku || x.key === r.key)
    if (!o || o.book !== slug) continue
    if (o.kind === 'download' && o.format) held.add(o.format)
    if (o.kind === 'print') for (const f of o.includes ?? []) held.add(f)
  }
  if (!held.size) return json({ files: [] })
  const files: Array<{ contents: string; format: string; url: string }> = []
  for (const [contents, ed] of Object.entries(editionsOf(slug))) {
    const want: Array<[string, string]> = []
    if (held.has('pdf')) want.push(['pdf', 'interior.pdf'])
    if (held.has('epub') && ed.epub) want.push(['epub', 'book.epub'])
    for (const [format, name] of want) {
      const { data, error } = await admin.storage.from('print').createSignedUrl(`${slug}/${ed.edition}/${name}`, 3600, { download: `${slug}-${contents}.${format}` })
      /* the path alone: the function's own address for the bucket is the stack's inside one
         (kong, locally), and the client puts its public address in front */
      if (!error && data?.signedUrl) files.push({ contents, format, url: data.signedUrl.replace(/^https?:\/\/[^/]+/, '') })
    }
  }
  return json({ files })
})
