/*
 * THE THEME'S OWN HEADER, NAMED ONCE.
 *
 * The bottom of the three layers (content's nav, else the config's, else this). It was written
 * inside SiteLayout.vue, which was fine while the layout was the only thing that needed it — and
 * stopped being fine the moment the admin had to show an editor what their site is INHERITING.
 * Two copies of a list like this drift silently: the header would show one thing and the editor
 * would promise another.
 *
 * Each item is a `key` rather than a label, so the word comes from the strings and stays
 * translatable; a site's own item carries a `label` instead, written in content/site.md.
 */
export function themeNav({ docsOnly = false, storeOn = true, hasPricing = false, routes = {} } = {}) {
  const R = { content: '/content', docs: '/docs', store: '/store', ...routes }
  return [
    docsOnly ? { key: 'docs', href: R.docs, prefix: true } : { key: 'content', href: R.content, prefix: true },
    ...(hasPricing ? [{ key: 'pricing', href: '/pricing' }] : []),
    ...(storeOn ? [{ key: 'store', href: R.store }] : []),
  ]
}
