/*
 * A DESIGN → HTML, inside an Edge Function.
 *
 * The two packages are imported STATICALLY and by version, and that is the whole point of this file
 * existing. The runtime resolves a function's npm dependencies from the module graph it can see
 * before it runs; a specifier worked out at run time is not in that graph, and the answer is
 * "could not find constraint … in the list of packages" however correct the specifier is. So the
 * compile the pipe needs cannot import these itself — it is handed this instead, the way the print
 * model is handed a renderer rather than choosing one.
 *
 * Neither is a Node package. @templatical/renderer turns the design into MJML, and mjml-browser is
 * MJML's own browser build — the same pair the admin's Test button has always used in the browser,
 * which is what made it obvious that a design could be compiled here too.
 */
import { renderToMjml } from 'npm:@templatical/renderer@0.39.0'
/* mjml-browser's bundle reaches for cheerio with a plain require, which the runtime cannot see when
   it works out what to fetch — so it is named here, statically, to put it in the graph */
import 'npm:cheerio@1.2.0'
import mjml2html from 'npm:mjml-browser@5.4.1'

export async function compileDesign(content: unknown): Promise<string> {
  const mj = await renderToMjml(content as never, { allowHtmlBlocks: true })
  const r = await (mjml2html as (s: string, o: unknown) => { html: string; errors?: Array<{ level?: string; message?: string; formattedMessage?: string }> })(mj, { validationLevel: 'soft', minify: false })
  const bad = (r.errors ?? []).filter((e) => e && e.level !== 'warning')
  if (bad.length) throw new Error(bad.map((e) => e.formattedMessage || e.message).join('; '))
  return r.html
}
