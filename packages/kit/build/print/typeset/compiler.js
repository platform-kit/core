/*
 * THE ONE SEAM TYPST IS BEHIND.
 *
 * A print edition is set by a Typst compiler, and there are two of them: a native one on a machine
 * with a build box (`@myriaddreamin/typst-ts-node-compiler`, a 44 MB platform binary) and a WASM
 * one in an Edge Function, where a cloud-only site has nothing else. They are the same compiler —
 * the same program, built twice — so what they produce is byte-identical and an edition set by
 * either is the same edition.
 *
 * That matters more than it sounds. An edition is a hash of the source, the templates and the
 * trim, and `print.json` says which file a printer has. If the two paths could diverge, nobody
 * could tell which edition a printed book actually is.
 *
 * So everything the build needs of Typst is these four calls, and `build/print.mjs` knows about no
 * others — `build/print-parity.test.mjs` refuses a Typst import anywhere else under build/print/.
 * A driver implements them; nothing else about a driver is anybody's business.
 *
 *   create({ workspace, fonts })   a compiler, however that driver makes one
 *   pdf(file)                      compile and render → Uint8Array
 *   svg(file)                      the same page as SVG (the store draws the cover from it)
 *   query(file, selector)          the document's account of itself: where each chapter opened,
 *                                  where each highlight fell. A `<label>` selector, or 'metadata'.
 *
 * A compile that fails throws with the file named. It never returns a half-document: a PDF that is
 * wrong in a way nobody notices is the failure this whole area is careful about.
 */

/* the drivers, by name. A site never picks one — the caller does, from where it is running. */
const DRIVERS = {
  node: () => import('./node-compiler.js'),
  wasm: () => import('./wasm-compiler.js'),
}

/*
 * WHICH DRIVER. Named outright where a caller knows (the function always wants wasm), otherwise
 * node on a machine that has it and wasm where there is no filesystem to have it on. It is asked
 * once per compiler rather than per call, because making one is the expensive part.
 */
export async function typesetter({ driver, workspace, fonts } = {}) {
  const pick = driver || (typeof process !== 'undefined' && process.versions && process.versions.node ? 'node' : 'wasm')
  const load = DRIVERS[pick]
  if (!load) throw new Error(`typeset: no such compiler driver "${pick}" — one of ${Object.keys(DRIVERS).join(', ')}`)
  const mod = await load()
  const c = await mod.create({ workspace, fonts })
  return {
    driver: pick,
    pdf: (file) => c.pdf(file),
    svg: (file) => c.svg(file),
    query: (file, selector) => c.query(file, selector),
  }
}

/* WHAT A DOCUMENT SAYS ABOUT ITSELF is its own module — the Edge Function needs it and must not
   have this file, whose driver map names the native binary as a literal specifier the edge runtime
   would resolve. Re-exported so build/print.mjs still reads the seam as one thing. */
export { readback } from './readback.js'
