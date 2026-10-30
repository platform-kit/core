/*
 * TYPST AS WEBASSEMBLY — the same compiler, built for a runtime with no filesystem and no native
 * binaries. It is what lets a site with Supabase and nothing else set a book in print at all.
 *
 * Two things differ from the native driver, and both are the runtime's doing rather than ours:
 *
 *   THE SOURCES ARE HANDED OVER, not read. There is no disk in an Edge Function, so every .typ
 *   file and every font goes in as bytes (`add_source`, `add_raw_font`). The caller therefore
 *   passes `files` — a map of path to text — and the same map on a machine is simply what was
 *   written there.
 *
 *   THE FONTS ARE FETCHED ONCE PER WORKER and held, because a worker serves many requests and
 *   re-reading ~10 MB of type for each one is most of the budget. A font that will not load is a
 *   LOUD failure: a book set in a fallback face is a book nobody notices is wrong until it is
 *   printed, which is the expensive moment.
 *
 * The seam it implements is ./compiler.js — see there for why an edition must be identical from
 * either driver.
 */

let wasmReady = null

/* the module, initialised once per worker. A browser bundle hands over the .wasm's address (Vite's `?url`), because a
   bundler cannot see the name the package works out for itself; Deno and Node find it beside the module */
async function engine(wasm) {
  if (!wasmReady) {
    wasmReady = (async () => {
      /* Deno wants an npm: specifier and node wants the bare name; the same package either way,
         which is the pattern the github module already uses for fflate */
      const mod = await import('npm:@myriaddreamin/typst-ts-web-compiler@0.7.0')
        .catch(() => import('@myriaddreamin/typst-ts-web-compiler'))
      /* wasm-bindgen's default export takes the module's bytes; in a worker it resolves the .wasm
         beside itself, which is what the bundler and the function both want */
      if (typeof mod.default === 'function') await mod.default(wasm ? { module_or_path: wasm } : undefined)
      return mod
    })()
  }
  return wasmReady
}

/*
 * WHAT A COMPILE ANSWERED. It hands back the bytes themselves on success — a Uint8Array opening
 * "%PDF" — and a diagnostics object when the document did not set. Both are truthy, so the test is
 * whether there are bytes and not whether there is a value.
 */
function must(out, file) {
  if (out && (out.byteLength || out.length)) return out
  const said = out && out.diagnostics
    ? out.diagnostics.map((d) => (d && (d.message || d)) || '').join('; ')
    : (out && out.message) || 'no diagnostics'
  throw new Error('typst: ' + file + ' — ' + said)
}

export async function create({ files = {}, fonts = [], wasm } = {}) {
  const mod = await engine(wasm)
  const builder = new mod.TypstCompilerBuilder()
  builder.set_dummy_access_model()          /* no filesystem: every source is added below */
  for (const font of fonts) {
    if (!font || !font.byteLength) throw new Error('typeset: a font was empty — a book set in a fallback face is wrong in a way nobody sees until it is printed')
    await builder.add_raw_font(new Uint8Array(font))
  }
  const c = await builder.build()
  for (const [p, text] of Object.entries(files)) c.add_source(p.startsWith('/') ? p : '/' + p, String(text))

  const main = (file) => (String(file).startsWith('/') ? String(file) : '/' + String(file))
  return {
    pdf(file) { return must(c.compile(main(file), null, 'pdf', 0), file) },
    svg(file) { return must(c.compile(main(file), null, 'svg', 0), file) },
    query(file, selector) {
      const said = c.query(main(file), null, selector, null)
      try { return JSON.parse(said || '[]') } catch (e) { throw new Error('typst: ' + file + ' — the query did not answer with json') }
    },
    /* a source added after the compiler was built: a re-render with a page offset, a second edition */
    put(p, text) { c.add_source(main(p), String(text)) },
    /* and BYTES, for what is not text: a paperback's front is the e-book's own picture, and on a
       machine Typst reads it off the disk. Here there is no disk, so it is mapped in as a shadow
       file under the path the source names. */
    bytes(p, data) { c.map_shadow(main(p), new Uint8Array(data)) },
  }
}
