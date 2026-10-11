/*
 * A DESIGN → HTML, in Node and in Deno.
 *
 * The build compiles every design into a file beside the functions, and that is how a deployment
 * that builds gets them. One shape does not build — cloud mode with the repository out of the cycle
 * and no deploy hook — and there a publish has to compile the design itself, in an Edge Function.
 *
 * It can, and the admin has been proving it all along: its Test button compiles the open design in
 * the BROWSER with the same two packages. Neither is a Node package — @templatical/renderer turns the
 * design into MJML, and mjml-browser is MJML's own browser build, which opens no file and spawns
 * nothing. What does not run in an Edge Function is the full `mjml` package the build uses, and the
 * two are not the same thing — which is the whole of why this was once written off as impossible.
 *
 * So the build keeps `mjml` (its output is what the committed file holds, to the byte) and the
 * function takes `npm:mjml-browser`. One module, the specifier resolved where it runs.
 */
/* the bare specifier resolves on a machine; the `npm:` one in an Edge Function, where it must carry
   a version — a bare npm specifier is "not in the list of packages" there, which is the runtime
   asking to be told exactly what to fetch (the push function's `npm:web-push@3.6.7` says the same).
   These two are pinned to what the kit depends on, and move with it. */
export const RENDERER = 'npm:@templatical/renderer@0.39.0'
export const MJML = 'npm:mjml-browser@5.4.1'
const load = async (...specifiers) => {
  let last = null
  for (const s of specifiers) { try { return await import(s) } catch (e) { last = e } }
  throw last || new Error('no specifier resolved')
}

export async function compileDesign(content) {
  const { renderToMjml } = await load('@templatical/renderer', RENDERER)
  const mod = await load('mjml', MJML)
  const mjml2html = mod.default || mod
  const mj = await renderToMjml(content, { allowHtmlBlocks: true })
  const r = await mjml2html(mj, { validationLevel: 'soft', minify: false })
  const bad = (r.errors || []).filter((e) => e && e.level !== 'warning')
  if (bad.length) throw new Error(bad.map((e) => e.formattedMessage || e.message).join('; '))
  return r.html
}

/*
 * EVERY DESIGN, from the store — the site's own where it has one, the kit's shipped copy where it
 * has not (the same arrangement the theme's strings have). `kitDesign` is how the caller hands over
 * the fallbacks, because where they live differs: a package directory on a machine, a bundled record
 * in a function.
 */
export async function compileDesigns({ store, kinds, kitDesign = () => null, compile = compileDesign }) {
  const out = {}
  const faults = []
  for (const kind of kinds) {
    let design = null
    try { const t = await store.read('content/emails/' + kind + '.json'); if (t) design = JSON.parse(t) } catch { /* the site has none */ }
    if (!design) design = await kitDesign(kind)
    if (!design) { faults.push(`content/emails/${kind}.json: no design — build it under admin → Emails`); continue }
    try { out[kind] = await compile(design) } catch (e) { faults.push(`content/emails/${kind}.json: ${e.message}`) }
  }
  return { designs: out, faults }
}
