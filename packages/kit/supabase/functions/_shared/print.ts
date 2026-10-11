/*
 * The printers, from the functions' side: an order's row sent to whichever printer made its
 * edition's format (the modules under ./printers are shared with the build — one file per
 * printer, plain JavaScript on fetch), with the edition's files as signed urls into the private
 * `print` bucket (good for a week — the printer fetches them once), and the job read back for
 * its status and tracking. PRINT_MOCK=1 (local only — the deploy refuses it), or a printer with
 * no keys, answers every call locally: a job id is made up and its status walks
 * CREATED → IN_PRODUCTION → SHIPPED on each read, so an order can be watched end to end.
 */
import { admin } from './lib.ts'
import { printers } from './suppliers/index.js'
import { of } from './compiled.ts'
/* read at call time: every use here is inside a function, so nothing needs a live binding */
const catalog = () => of<Record<string, any>>('catalog')
import { shippedEmail } from './email.ts'

const env = (k: string) => Deno.env.get(k) ?? ''
export const BUCKET = 'print'
export const { PRINTERS, printer } = printers(env) as { PRINTERS: Record<string, any>; printer: (id: string) => any; providersFor: (f: string) => any[] }

/* a week's signed url to a file of the edition, for the printer to fetch */
async function signed(path: string) {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 7 * 86400)
  if (error || !data?.signedUrl) throw new Error(`print: no signed url for ${path} — ${error?.message ?? 'missing'}`)
  /* the printer fetches the file itself: a local stack's bucket is out of its reach, so say so
     rather than submit a job it will reject (the order stays 'failed' for a retry on a real bucket) */
  if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0|kong)(:|\/)/.test(data.signedUrl)) throw new Error('print: the edition is in a local bucket the printer cannot fetch from — PRINT_MOCK=1 for a local run')
  return data.signedUrl
}

/* the edition to print, from the catalog's index (build/print.mjs writes content/store/print.json,
   build/catalog.mjs carries it): a book's edition for the contents chosen — its files' folder,
   and per format the printer, its product, the cover files by key, a title it keeps */
export type Printed = { provider: string; product: any; products?: Record<string, any> | null; key: string; covers: Record<string, string>; ref?: string | number | null }
export type Edition = { edition: string; pages: number; printers: Record<string, Printed>; epub: boolean; foilStamp?: { title: string; author: string } | null }
export const editionOf = (slug: string, contents?: string): Edition | null => {
  const b = ((catalog() as any).editions ?? {})[slug]
  if (!b || !b.editions) return null
  return b.editions[contents || Object.keys(b.editions)[0]] ?? null
}
export const editionsOf = (slug: string): Record<string, Edition> => (((catalog() as any).editions ?? {})[slug] ?? {}).editions ?? {}
/* the book behind its editions: its title and each format's offer key — there whether or not a
   format is on sale, since a proof is ordered before it is */
export const bookOf = (slug: string): { title: string; keys: Record<string, string> } | null => { const b = ((catalog() as any).editions ?? {})[slug]; return b ? { title: b.title ?? slug, keys: b.keys ?? {} } : null }
/* the cover's key for what was chosen: a linen's by its cloth and foil, the others the format's one */
export const coverKeyOf = (p: Printed, cloth?: string | null, foil?: string | null) => {
  if (p.products && cloth) { const k = `${p.key.split('-').slice(0, 2).join('-')}-${cloth}-${foil || 'gold'}`; if (p.covers[k]) return k }
  return p.key
}

/* WHAT A BOOK'S KIND DERIVED FOR THIS ROW. `chosen` is the generic slot every kind writes;
   print had six columns of its own beside it saying the same thing, which is what made
   `fulfilments` a print_orders with a wider remit rather than a table any kind can use. This is
   the only place the shape is known, so a kind that is not print never meets it. */
export const chosenOf = (row: any) => (row?.chosen ?? {}) as
  { book?: string; edition?: string; format?: string; contents?: string; cloth?: string; foil?: string }

/* submit a row to its printer; on a failure the row says so and stays for a retry */
export async function submitPrintOrder(row: any, title: string) {
  const c = chosenOf(row)
  const ed = editionOf(c.book, c.contents || undefined)
  const stamp = { updated_at: new Date().toISOString() }
  const fail = async (error: string) => { await admin.from('fulfilments').update({ status: 'failed', error, ...stamp }).eq('id', row.id); return null }
  if (!ed) return fail('no edition of this book has been set — node build/print.mjs --book ' + c.book)
  const format = c.format || 'hardcover'
  const pf = ed.printers?.[format]
  if (!pf) return fail(`the edition has no ${format} — node build/print.mjs --book ${c.book}`)
  const ck = coverKeyOf(pf, c.cloth, c.foil), cover = pf.covers?.[ck]
  if (!cover) return fail(`the edition has no ${ck} cover — node build/print.mjs --book ${c.book}`)
  const product = pf.products?.[ck] ? { ...pf.product, pod: pf.products[ck] } : pf.product
  const p = printer(pf.provider)
  if (p.stateful && !pf.ref && !p.mock()) return fail(`${p.name} has no title for this edition yet — node build/print.mjs --book ${c.book}`)
  try {
    const dir = `${c.book}/${ed.edition}/`
    const files = p.mock() ? { interior: 'mock', cover: 'mock', jacket: null } : { interior: await signed(dir + 'interior.pdf'), cover: await signed(dir + cover), jacket: product.jacket ? await signed(dir + cover) : null }
    const job = await p.order({
      /* the artefacts a book's kind made for this variant: its page count and its files. A
         supplier takes a variant and its artefacts; what is IN them is the kind's business. */
      product, artefacts: { pages: ed.pages, files }, ref: pf.ref, title, quantity: row.quantity, address: row.address ?? {}, email: row.email,
      level: row.shipping_level || 'standard', externalId: row.id,
      callbackUrl: `${env('SUPABASE_URL').replace(/\/+$/, '')}/functions/v1/print-webhook?provider=${pf.provider}`,
      foilStamp: product.jacket ? ed.foilStamp ?? null : null,
    })
    await admin.from('fulfilments').update({ status: p.statusOf(job.status) ?? 'submitted', supplier: pf.provider, supplier_job: job.id, supplier_status: job.status, cost: job.cost, error: null, chosen: { ...c, edition: c.edition || ed.edition }, ...stamp }).eq('id', row.id)
    return job
  } catch (e) {
    return fail(String((e as any)?.message ?? e).slice(0, 500))
  }
}

/* read the job back from its printer and put its status on the row; true when anything changed */
export async function refreshPrintOrder(row: any) {
  if (!row.supplier_job) return false
  /* a row whose printer we do not know is a row we cannot ask about: asking the wrong printer
     would read back somebody else's job id, or nothing, and write that over this order's status */
  if (!row.supplier) return false
  const p = printer(row.supplier)
  const job = await p.status(row.supplier_job)
  const status = p.statusOf(job.status) ?? row.status
  if (status === row.status && job.status === row.supplier_status && !job.tracking) return false
  await admin.from('fulfilments').update({ status, supplier_status: job.status, ...(job.tracking ? { tracking: job.tracking } : {}), ...(job.cost ? { cost: job.cost } : {}), updated_at: new Date().toISOString() }).eq('id', row.id)
  /* the parcel shipped: the buyer told once, with the tracking, the moment the status turns */
  if (status === 'shipped' && row.status !== 'shipped') await shippedEmail({ ...row, tracking: job.tracking ?? row.tracking }, bookOf(chosenOf(row).book)?.title ?? chosenOf(row).book ?? '')
  return true
}
