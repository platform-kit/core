/* The offers, from content/store/products and the books' print blocks priced by the editions just set, beside the functions that sell them (build/catalog.mjs) */
export default {
  key: 'catalog', title: 'The catalog', phase: 'functions', after: ['print'],
  inputs: ['content/store/**', 'content/books/**', 'content/sessions/**'],
  run: ({ script }) => script('catalog.mjs'),
}
