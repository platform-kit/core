/*
 * WHICH PANELS A MEMBER'S CARD DRAWS, and in what order (openspec: kit-extension-model, "A site registers what a
 * member's card says about somebody"). Pure, so it is tested without a browser; vite's #site/member calls it.
 *
 *   gatesOf(site)                      which of the kit's panels the site's modules allow: Working with an instrument of
 *                                      the site's own (instrument.module), Read with a library, Bought with the store,
 *                                      Courses with the courses module
 *   arrange(kitPanels, gates, mine)    the kit's allowed panels less the site's `off`, then the site's own `panels`, in the
 *                                      site's `order` where it gives one (anything it does not name keeps its place after)
 */
export function gatesOf(site) {
  const on = (k) => ((site && site.modules) || {})[k] !== false
  return {
    working: on('instrument') && !!(site && site.instrument && site.instrument.module),
    read: on('books') || on('articles'),
    bought: on('store'),
    courses: on('courses'),
  }
}

export function arrange(kitPanels, gates, mine = {}) {
  const off = new Set(mine.off || [])
  const list = [...kitPanels.filter((p) => gates[p.key] && !off.has(p.key)), ...(mine.panels || [])]
  const order = mine.order || []
  if (!order.length) return list
  const at = (k) => { const i = order.indexOf(k); return i < 0 ? order.length + list.findIndex((p) => p.key === k) : i }
  return [...list].sort((a, b) => at(a.key) - at(b.key))
}
