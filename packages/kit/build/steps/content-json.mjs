/* The published content beside the functions, for the content API (build/content-json.mjs) */
export default {
  key: 'content-json', title: 'The content index', phase: 'functions', after: ['analytics-config'],
  when: (env, site) => ['articles', 'books', 'wiki', 'docs'].some((k) => site.modules[k] !== false), whenText: 'every library kind is off',
  inputs: ['content/articles/**', 'content/books/**', 'content/wiki/**', 'content/docs/**', 'content/site.md'],
  run: ({ script }) => script('content-json.mjs'),
}
