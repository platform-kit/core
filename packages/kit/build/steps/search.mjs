/* The search index, projected into the database after the content is compiled — the one index
   anything on the server may ask (a bot's search_site, and whatever asks next). It needs the
   compiled collections, so it runs after them, and a database to write to. */
export const searchPushStep = {
  key: 'search-push', title: 'What the site has published, searchable', phase: 'after',
  when: (env, site) => ['articles', 'books', 'wiki', 'docs', 'store'].some((k) => site.modules[k] !== false),
  whenText: 'there is nothing published to index',
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY'] },
  localProjection: true,
  inputs: ['content/**'],
  run: ({ script }) => script('search-push.mjs'),
}
export default searchPushStep
