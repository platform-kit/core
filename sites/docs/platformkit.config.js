/*
 * The PlatformKit documentation, as a site — every module off, the library's other kinds off, no store, no
 * page of its own: the docs collection alone. With nothing else on, the theme is a standalone documentation
 * site (router.js DOCS_ONLY): the docs at / and /docs in the plain shell, a header with the sections and no
 * sign-in. No code of its own — the theme's defaults and one palette (the Docs look). It documents the whole
 * system, for the people who edit a site and for the people who build one.
 */
export default {
  name: 'PlatformKit Docs',
  theme: 'platformkit/theme',
  modules: {
    articles: false, books: false, wiki: false, docs: true,
    store: false, print: false, memberships: false, sessions: false, coaching: false, support: false,
    funnels: false, emails: false, forms: false, instrument: false, recommendations: false,
    translation: false, tts: false, enrichment: false, push: false, models: false, spaces: false, 'space-encryption': false, copilot: false,
    'social-publishing': false,
    /* these three were on by omission — a module absent from this list is ON — which is how a site
       that documents having no backend was asking the deploy for a service-role key six times over */
    events: false, bots: false, api: false,
    /* the social network needs somewhere to keep a post — a documentation site has nowhere */
    network: false,
    /* a course needs somewhere to keep who is enrolled and how far they are */
    courses: false,
  },
  /* THE STATIC SHAPE: no Supabase at all. Nothing here needs one — the docs are files, the search
     index is built from them, and there is no sign-in — so the deploy asks for no database, no mail
     relay and no push keys, and builds the site and nothing else. Declared rather than inferred from
     an absent key, so that switching a backend-needing module on fails here at the commit that does
     it instead of at a deploy nobody may run for weeks (build/modes.mjs holds which is which). */
  deployment: { backend: false },
  /* NO PALETTE OF ITS OWN: the documentation wears the theme's default look, the same white-and-indigo
     the demo wears. The docs are PlatformKit's own front door, so what a reader sees here is what the
     kit looks like out of the box — a second palette on this site would only be a look nothing else
     uses, kept in step by hand. (It had one: src/looks/docs.css, cool paper and a blue accent, 114
     lines of tokens and nothing structural, so removing it leaves the design untouched.) */
  /* the header: the docs and their three sections; no call to action, no sign-in (nothing here needs an account) */
  nav: { links: [{ key: 'docs', href: '/docs', prefix: false }, { key: 'editors', href: '/docs/running-a-site/the-admin', prefix: false }, { key: 'developers', href: '/docs/building-a-site/architecture', prefix: false }, { key: 'reference', href: '/docs/reference/cli', prefix: false }] },
  /* the mark: PlatformKit's own, three cubes in isometric. The demo does not wear it — it is a
     different publisher, and a mark of one's own is the point of the kit. */
  overrides: { SiteMark: './src/components/SiteMark.vue' },
  languages: ['en'],
  /* its own port base, so its local stack can run beside another site's */
  data: { ports: 54340 },
}
