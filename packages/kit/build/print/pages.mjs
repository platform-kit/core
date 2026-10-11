/*
 * Which pages show a book best, from what the document says about itself (the <where> and
 * <mark-n> metadata book.typ writes, read back with a query) and how much text each page holds
 * (pdf.js, over the print file — build/print/raster.mjs): the chapter whose first page is the
 * fullest (a page of text, never an opener with two lines and air), and the page with the most
 * highlights; the same chapter's page in another edition, by its title.
 */

/* `where`: [{ kind, title, page }] the openers; `marks`: [{ page }]; `all`: [{ items }] by page.
   → { chapter: { title, page, full }, marks: { page, count } } */
export function choose(where, marks, all) {
  const fullest = Math.max(1, ...all.map((s) => s.items))
  const chapters = where.filter((w) => w.kind === 'chapter' && w.page >= 1 && w.page <= all.length)
  const scored = chapters.map((c) => ({ ...c, items: all[c.page - 1].items })).sort((a, b) => b.items - a.items)
  const chapter = scored[0] ? { title: scored[0].title, page: scored[0].page, full: scored[0].items >= fullest * 0.6 } : null
  const byPage = new Map()
  for (const m of marks) if (m.page) byPage.set(m.page, (byPage.get(m.page) || 0) + 1)
  const hot = [...byPage.entries()].sort((a, b) => b[1] - a[1] || (all[b[0] - 1]?.items || 0) - (all[a[0] - 1]?.items || 0))[0]
  return { chapter, marks: hot ? { page: hot[0], count: hot[1] } : null }
}

/* the sheet a chapter opens on in another edition, by its title */
export const pageOf = (where, title) => (where.find((w) => w.kind === 'chapter' && w.title === title) || {}).page || null
