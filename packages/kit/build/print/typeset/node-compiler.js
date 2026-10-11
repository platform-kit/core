/*
 * TYPST ON A MACHINE. @myriaddreamin/typst-ts-node-compiler — the native build, a platform binary
 * of about 44 MB, which is why it is an optional peer of the kit and not a dependency: a site with
 * the print module off installs none of it.
 *
 * This is the whole of what the rest of the build knows about it. See ./compiler.js for why.
 */
import path from 'node:path'

export async function create({ workspace, fonts } = {}) {
  const { NodeCompiler } = await import('@myriaddreamin/typst-ts-node-compiler')
  const c = NodeCompiler.create({
    workspace: workspace || process.cwd(),
    ...(fonts ? { fontArgs: [{ fontPaths: [fonts] }] } : {}),
  })
  /* a compile that failed prints its errors where somebody setting a book will see them, then
     throws: a half-document is worse than no document, because it is a book nobody checks */
  const must = (file) => {
    const r = c.compile({ mainFilePath: file })
    if (r.hasError()) { r.printErrors(); throw new Error('typst: ' + path.basename(file)) }
    return r
  }
  return {
    pdf(file) { must(file); return c.pdf({ mainFilePath: file }) },
    svg(file) { must(file); return c.svg({ mainFilePath: file }) },
    query(file, selector) { return c.query(must(file).result, { selector }) },
  }
}
