/*
 * THE FIXTURE FOR THE STATIC LANE, AND THE SHAPE MOST STATIC SITES ACTUALLY TAKE.
 *
 * sites/docs proves a site with EVERY module off works with no backend, and that is the easy case:
 * the docs shell has no sign-in, no lists drawn from a database, nothing that would ever reach for
 * one. It is so inert that it makes no backend call even when a Supabase url IS configured, which
 * means it cannot prove the lane's network watch works — the check could be broken and the run
 * would still be green.
 *
 * This is the other one: a library — articles and a wiki, the hub, the reader, the search — with
 * every row-backed module off and no backend. It is the brochure, the magazine, the marketing site,
 * and it is where a component that quietly stops guarding `configured` would actually show up.
 *
 * It has no code of its own on purpose. Everything here is the theme's, so a failure in this lane is
 * a failure in the kit or the theme and never in the fixture.
 */
export default {
  name: 'Northlight Brochure',
  theme: 'platformkit/theme',
  /* no Supabase at all: the deploy asks for nothing but the site's own address, and switching on any
     module below that needs a backend fails at the commit (build/modes.mjs says which do) */
  deployment: { backend: false },
  modules: {
    /* the library, which is what a brochure is */
    articles: true, wiki: true, books: false, docs: false,
    /* and nothing that is a row */
    store: false, print: false, memberships: false, sessions: false, coaching: false, support: false,
    funnels: false, emails: false, forms: false, instrument: false, recommendations: false,
    translation: false, tts: false, enrichment: false, push: false, models: false, spaces: false, 'space-encryption': false,
    events: false, bots: false, api: false, network: false,
    'social-publishing': false, copilot: false,
  },
  languages: ['en'],
  data: { ports: 54360 },
}
