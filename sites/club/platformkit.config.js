/*
 * THE SECOND SITE OF THE END-TO-END RUN: a members' club with a backend and a different module selection from
 * the demo's, so every run builds two stacks side by side and proves they never meet (openspec:
 * test-environment). The demo turns everything on; this turns on only what a membership site needs, so a
 * function, table or test that assumes a module the site has off shows up here and nowhere else.
 *
 * It has no code of its own on purpose. Everything here is the theme's, so a failure on this site is a failure
 * in the kit or the theme and never in the fixture.
 */
export default {
  name: 'Northlight Club',
  theme: 'platformkit/theme',
  modules: {
    /* a little writing, behind the membership */
    articles: true, wiki: false, books: false, docs: false,
    /* what a club runs: memberships, a form to join and a support desk */
    memberships: true, forms: true, support: true,
    /* and nothing else */
    store: false, print: false, sessions: false, coaching: false,
    funnels: false, emails: false, instrument: false, recommendations: false,
    translation: false, tts: false, enrichment: false, push: false, models: false, spaces: false, 'space-encryption': false,
    events: false, bots: false, api: false, network: false, courses: false,
    'social-publishing': false, copilot: false,
  },
  languages: ['en'],
  data: { ports: 54440 },
}
