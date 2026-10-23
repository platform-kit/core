/*
 * The PlatformKit demo, as a site — Northlight Press, a small press for short practical books: every module
 * the kit ships, sample content for each, and no code of its own — the theme's defaults for the strings and
 * the sections, one palette of its own (the North look). The instrument is off (it needs a site's own
 * readings), so /app is the shell: accomplishments, coaching, chat.
 */
export default {
  name: 'Northlight Press',
  theme: 'platformkit/theme',
  deployment: { content: 'rows' },
  modules: {
    /* THE PRESS'S OWN. Nothing in the kit declares this name; src/stockists/module.js does, and
       it behaves as one of the kit's twenty-four in every way — see that file. */
    stockists: true,
    /* EVERY FEATURE THE KIT HAS, on. A showcase that switches things off is showing a smaller
       product than the one it is selling — and it is also the only site that exercises the whole
       matrix, so a module nobody turns on anywhere is a module nobody notices breaking.
       `translation` is the one exception and not a choice: it declares itself unbuilt in all three
       deployment shapes (build/modules/kit.mjs), so switching it on would be a claim the code
       cannot honour. */
    store: true, print: true, memberships: true, sessions: true, coaching: true, support: true,
    funnels: true, emails: true, forms: true, instrument: true, recommendations: true,
    tts: true, enrichment: true, push: true, models: true, spaces: true, 'social-publishing': true, courses: true,
    translation: false,
  },
  /* THE STORE THIS SITE RUNS: a supplier of its own, which nothing in the kit knows about. The
     bindery on Mill Lane is not a printing API and would never be worth a module in the kit —
     which is exactly what makes it the proof that a shop can add one. */
  store: { suppliers: './build/suppliers.mjs' },
  /* THE SOCIAL NETWORK, opened to other apps: Bluesky's app or any atproto client may sign in here with
     an app password — the showcase turns on what a site would have to opt into (it is off by default).
     The feed stays at /feed beside the spaces. */
  network: { apps: true },
  /* THE COMMUNITY IN THE SOCIAL LAYOUT: the spaces, their rooms and events and the network's feed all in one
     social-network frame; the chat layout remains available as the default. */
  /* For You: Explore as a grid of the photo and video posts — the demo shows every feature */
  community: { layout: 'social', forYou: true },
  /* NO PALETTE OF ITS OWN: the demo wears the theme's default, because showing what the kit looks
     like out of the box is the whole job of a showcase. */
  /* The header: the theme's links and an About page of the site's own. A module having a page
     does not earn it a place up here — stockists has a route, a build step and an admin section
     and is reached from the footer, because a header with everything in it is a header with
     nothing in it. */
  nav: { links: [{ key: 'content', href: '/content', prefix: true }, { key: 'pricing', href: '/pricing' }, { key: 'store', href: '/store' }, { key: 'about', href: '/about' }] },
  routes: [{ path: '/stockists', component: './src/stockists/StockistsPage.vue', module: 'stockists' }],
  /* the section is the screen; the model is what it saves through, so the shops can be edited by a
     Northlight with no checkout at all. A section without a model is a page that only works on a laptop. */
  admin: { sections: './src/stockists/sections.js', models: './build/admin-models.mjs' },
  /* Each fixture reserves a distinct Supabase service-port block so multiple sites can run together.
     The docs and brochure fixtures use the neighboring blocks; the schema test reserves 54380. */
  data: { ports: 54400 },
  languages: ['en'],
  /* the site's own build steps, beside the kit's (build/steps.mjs): each a module exporting one record — here the books as a CSV */
  build: {
    modules: ['./src/stockists/module.js'],
    steps: ['./build/steps/books-csv.mjs', './src/stockists/step.js'],
  },
  /* Where cloud mode publishes: a declaration, not a setting somebody types into the admin, so a
     fresh deployment already knows where its content goes. The token is the one secret and stays an
     environment variable — with none this demo pushes nowhere, which is the point: the target is
     configuration and the credential is not. */
  cloud: { repo: 'northlight-press/site', branch: 'main' },
  /* The subscriptions this deployment SHIPS already wired: a site that tells its own indexer when an
     entry is published, or posts its enquiries to the desk it actually uses, says so in the
     repository. A subscription somebody makes through the API is theirs and is never touched.
     A secret is NAMED, never written — env:NORTHLIGHT_FORM_SECRET. */
  webhooks: [
    { kind: 'content', name: 'the press index', url: 'https://hooks.example/northlight/entries', topics: ['Entry.publish', 'Entry.unpublish'] },
    { kind: 'form', form: 'contact', tag: 'desk', url: 'https://hooks.example/northlight/enquiries', secret: 'env:NORTHLIGHT_FORM_SECRET' },
  ],
  /* the site's own events — a goal joins the dashboard's goals, every one is a metric — and the sites that report in through
     the drop-in script (<domain>/analytics.js): a key a page sends, the hosts allowed to send under it */
  analytics: {
    events: [{ key: 'newsletter_signup', label: 'Newsletter sign-up', goal: true }, { key: 'video_play', label: 'Video played', value: 'seconds' }],
    sources: [{ key: 'pk_landing_7f3a9c2e51d4', name: 'landing', hosts: ['landing.example', 'localhost', '127.0.0.1'] }],
  },
}
