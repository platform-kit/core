/*
 * THE SUPPLIERS: one module each behind one shape, shared by the build (node) and the functions
 * (Deno) — plain JavaScript on fetch alone. `suppliers(env)` binds them to an environment
 * (`env(k)` → a string) and gives:
 *
 *   SUPPLIERS            every supplier known
 *   supplier(id)         one of them, or a throw naming the id
 *   providersFor(format) the suppliers that make a format AND have their keys (or are mocked)
 *
 * A SUPPLIER MAKES A VARIANT OUT OF ARTEFACTS. That is the whole vocabulary, and it is
 * deliberately empty of any word belonging to one kind of thing:
 *
 *   chosen      the variant’s own option values — what the buyer picked
 *   artefacts   whatever the KIND produced for that variant: a book’s page count and its print
 *               files, a garment’s artwork and its placements. The supplier understands them
 *               and nothing between the two needs to.
 *
 * The interface used to take `pages` and `files` by name, which meant a supplier that makes
 * anything other than a book could not implement it — and "plug-in" was true only of printers.
 *
 * A supplier:
 *   id, name, stateful (a title lives there)
 *   makes      the formats it can MAKE. A supplier that makes nothing — a post room — is never
 *              offered as a way to make something; it is chosen by name.
 *   sends      whether anything physically travels
 *   configured() mock()                          keys present; every call answered locally
 *   keys                                         the ENVIRONMENT keys it asks for, by name
 *   needs                                        the ARTEFACTS it needs a kind to have produced
 *   levels { standard, priority, express }       our shipping words in its
 *   options(format) → [{ key, label, type, choices, default, help }]     the admin’s tab
 *   catalogue(chosen) → [{ name, values }] | null    the OFFER'S OWN AXES, from whatever it
 *              publishes — a blueprint's colours and sizes. null (the default) is a supplier that
 *              publishes no catalogue, which is most of them: a printer makes what it is sent.
 *              What comes back is reconciled into the file as ordinary option rows marked with
 *              this supplier's id (`reconcileOptions` in _shared/variants.js), so a value the
 *              catalogue drops goes off sale without a cart line losing its meaning. Do not
 *              confuse it with `options(format)`, which is the SHOP's choices about how a thing
 *              is made and is shown in the admin.
 *   product({ chosen, options }) → its descriptor (pure)
 *   measure({ product, artefacts }) → { width, height, …, unit }   a shape, where it has one
 *   quote({ product, artefacts, quantity, country, level }) → { print, shipping, currency, days }
 *   validate({ product, artefacts }) → { ok, errors }
 *   register({ product, artefacts, title, sku, existing }) → { ref, paid, validated }   (stateful only)
 *   order({ product, artefacts, ref, title, quantity, address, email, level, externalId, callbackUrl }) → { id, status, cost }
 *   status(id) → { status, tracking, cost }      statusOf(word) → ours (submitted · in_production ·
 *                                                shipped · rejected · canceled · failed)
 *   webhook(body) → the job id a callback names   ensureWebhook(url)
 *
 * A supplier that sends nothing — a download — answers `order` by saying it is already done. One
 * that is a shelf in a back room says so too, and waits for somebody to mark it sent.
 */
import { lulu } from './lulu.js'
import { mixam } from './mixam.js'
import { bookvault } from './bookvault.js'
import { postRoom } from './post-room.js'
import { download } from './download.js'
import { printify } from './printify.js'

/* THE PRINTERS, which are the suppliers that make a printed thing */
export const PRINTER_IDS = ['lulu', 'mixam', 'bookvault']
/* and every supplier, printers among them: a shop's own post room and a download are suppliers
   too, and treating them as such is what keeps every surface that reads an order free of
   branches for "but this one is a file" */
export const SUPPLIER_IDS = [...PRINTER_IDS, 'printify', 'post-room', 'download']
export const FORMATS_PRINTED = ['softcover', 'hardcover', 'premium']

/*
 * WHAT A SUPPLIER MUST BE, checked once when it is registered rather than discovered at a call
 * site. A site adds its own through `store.suppliers` in platformkit.config.js and the registry
 * walks the kit’s and the site’s as one list — nothing downstream knows which it came from,
 * which is the only way a seam is real.
 */
const SHAPE = {
  id: 'a slug naming this supplier',
  name: 'what a person calls it',
  makes: 'the formats it can MAKE, as a list; [] for one that only sends',
  keys: 'the ENVIRONMENT keys it asks for, so a deploy can refuse before it starts',
  needs: 'the ARTEFACTS it needs a kind to have produced — matched when a shop is configured',
  catalogue: 'async (chosen) → [{ name, values }] | null, where the supplier publishes its own axes',
}
const METHODS = ['configured', 'mock', 'options', 'product', 'measure', 'quote', 'validate', 'order', 'status', 'statusOf', 'webhook', 'ensureWebhook']

export function checkSupplier(x) {
  const bad = []
  if (!x || typeof x !== 'object') return ['a supplier must be a module returning an object']
  if (typeof x.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(x.id)) bad.push(`id: ${SHAPE.id}`)
  if (typeof x.name !== 'string' || !x.name) bad.push(`name: ${SHAPE.name}`)
  if (!Array.isArray(x.makes)) bad.push(`makes: ${SHAPE.makes}`)
  if (!Array.isArray(x.keys)) bad.push(`keys: ${SHAPE.keys}`)
  if (!Array.isArray(x.needs)) bad.push(`needs: ${SHAPE.needs}`)
  for (const m of METHODS) if (typeof x[m] !== 'function') bad.push(`${m}: every supplier answers the whole interface`)
  /* catalogue is the one optional method: most suppliers publish none, and a stub returning null
     on every one of them would be five files saying nothing. Absent means none. */
  if (x.catalogue !== undefined && typeof x.catalogue !== 'function') bad.push(`catalogue: ${SHAPE.catalogue}`)
  /* our three shipping words in its, or nulls where nothing travels */
  if (!x.levels || typeof x.levels !== 'object') bad.push('levels: our three shipping words in its own')
  else for (const w of ['standard', 'priority', 'express']) if (!(w in x.levels)) bad.push(`levels.${w}: missing`)
  return bad
}

export function printers(env, own = []) {
  const PRINTERS = { lulu: lulu(env), mixam: mixam(env), bookvault: bookvault(env), printify: printify(env), 'post-room': postRoom(env), download: download(env) }
  /* and the site’s own, refused by name at registration rather than halfway through a sale */
  for (const make of own) {
    const x = typeof make === 'function' ? make(env) : make
    const bad = checkSupplier(x)
    if (bad.length) throw new Error(`suppliers: ${(x && x.id) || 'a supplier'} does not keep the shape —\n  ${bad.join('\n  ')}`)
    if (PRINTERS[x.id]) throw new Error(`suppliers: two suppliers are called "${x.id}"`)
    PRINTERS[x.id] = x
  }
  const printer = (id) => { const p = PRINTERS[id]; if (!p) throw new Error('no printer named ' + id); return p }
  /* WHO CAN MAKE THIS, and is usable. `makes` rather than `formats` because a supplier may
     touch a format without making it: a post room sends a paperback and could not print one,
     and offering it beside Lulu would be offering a shelf as a printing press. */
  const ids = Object.keys(PRINTERS)
  const providersFor = (format, { mocked = true } = {}) => ids.map((id) => PRINTERS[id])
    .filter((p) => (p.makes || p.formats).includes(format) && (p.configured() || (mocked && p.mock())))
  return { PRINTERS, SUPPLIERS: PRINTERS, ids, printer, supplier: printer, providersFor }
}
