/*
 * WHAT A DOCUMENT SAYS ABOUT ITSELF, read the same way by both Typst drivers.
 *
 * book.typ writes a `<where>` at every opener and a `<mark-n>` at every highlight, and this is the
 * shape build/print.mjs reads them in — so the native driver and the WASM one cannot disagree about
 * it by answering with slightly different objects. It takes a compiler, not a file: `c.query` is one
 * of the four calls the seam is.
 *
 * IT LIVES IN ITS OWN FILE because the Edge Function needs it and must not have the seam. compiler.js
 * names its two drivers as literal specifiers, one of them the 44 MB native binary's, and the edge
 * runtime resolves every literal specifier it can see whether the branch runs or not: importing
 * `readback` from there took the whole runtime down at boot. Keep this module free of imports.
 */
export function readback(c, file) {
  const where = c.query(file, '<where>').map((q) => q.value)
  const marks = c.query(file, 'metadata').filter((q) => /^<mark-/.test(q.label || '')).map((q) => q.value)
  return { where, marks }
}
