/*
 * THE KIT'S OWN MODULES — each saying what it is, what it does in the three deployment shapes,
 * and what switching it off takes away.
 *
 * Written from what the CODE says rather than from the matrix that used to live in modes.mjs: the
 * matrix was the thing under suspicion. `build/manifests.test.mjs` compares the two cell by cell
 * until modes.mjs derives from here, and `modes.test.mjs` goes on asking the code whether a claim
 * is true — a manifest saying cloud does not make it so.
 *
 * `owns.env` is filled as deploy-checks' per-module needs move here (task 2.2). An empty list
 * means "not moved yet", never "asks for nothing".
 *
 * `owns.schema` and `owns.functions` are the whole of a module's backend, and switching it off leaves none of it
 * in the site's assembled supabase/ tree (openspec: module-switch-removes-backend). What every site has is `core`,
 * and what joins two modules is glue owned by both — both in build/modules/backend.mts, which the manifests check
 * holds the tree to: a schema file or a function nobody owns is refused by name.
 */
import type { ModuleDeclaration } from './manifest.mjs'
import { folderManifests, KIT_MODULES_DIR } from './folders.mjs'

/* the modules in their order. A module moved into packages/kit/modules/<key>/ is named here by its key alone and read from its
   folder, keeping its place, since the order is what the assembled cron block and the deployment matrix follow */
const LISTED: Array<ModuleDeclaration | string> = [
  {
    key: 'articles', what: 'the magazine and its lane on the hub',
    static: true, git: true, cloud: true,
    owns: {},
  },
  {
    key: 'books', what: 'the shelf, the reader and the book pages',
    static: true, git: true, cloud: true,
    owns: {},
  },
  {
    key: 'wiki', what: 'the wiki and its lane',
    static: true, git: true, cloud: true,
    owns: {},
  },
  {
    key: 'docs', what: 'the documentation tree',
    static: true, git: true, cloud: true,
    owns: {},
  },
  /*
   * THE SHAPES A THING IS SOLD IN ADD NO SHAPE OF THEIR OWN, and that is worth saying because it
   * looks as though they should.
   *
   * A variant's price, sku and whether it is sold are worked out at BUILD time and written onto
   * the offer in catalog.json — and cloud mode never builds again. The reason it still holds is
   * that the catalog is a PUBLISHED artefact (build/artefacts.mjs): a publish compiles it into
   * `public.compiled` and the functions read that row over the shipped file, and both
   * `catalog.mjs` and `variants.mjs` are in the assembled pipe, so the publish derives the
   * shapes with exactly the code the build would have. An editor adding a colour in cloud mode
   * therefore has it in Stripe and at the checkout on publish, with no deploy. Static is `false`
   * for the store as a whole, so there is nothing to answer for there.
   */
  {
    key: 'store', what: 'the storefront, the bag, checkout, the shapes a thing is sold in', needs: 'there is nowhere to keep an order',
    static: false, git: true, cloud: true,
    pages: [
      { name: 'StorePage', order: 110, page: 'theme:pages/StorePage.vue', test: 'platformkit/lib/page-routes.js#store' },
      { name: 'CartHandoffPage', order: 150, page: 'theme:pages/CartHandoffPage.vue', test: 'platformkit/lib/page-routes.js#cartHandoff', keyBy: 'route', props: { path: 'route' } },
    ],
    owns: {
      steps: ['sales'],
      schema: ['41-inventory.sql', '42-promotions.sql', '43-orders.sql'],
      functions: ['usage-meter-report', 'usage-topup'],
      cron: [
        { name: 'stock-holds', schedule: '*/20 * * * *', command: 'select public.inventory_sweep()' },
        { name: 'usage-meter-reports', schedule: '*/5 * * * *', command: 'select public.run_usage_meter_reports()' },
      ],
      env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY'],
    },
  },
  /* memberships: in its own folder, packages/kit/modules/memberships/ */
  'memberships',
  {
    key: 'sessions', what: 'booking types, the booker, the calendar', needs: 'there is nowhere to keep a booking',
    static: false, git: true, cloud: true,
    pages: [
      { name: 'CallPage', order: 30, page: 'theme:pages/CallPage.vue', test: 'platformkit/lib/page-routes.js#call', keyBy: 'route' },
      { name: 'BookPage', order: 140, page: 'theme:pages/BookPage.vue', test: 'platformkit/lib/page-routes.js#book', keyBy: 'route', props: { path: 'route' } },
    ],
    owns: {
      steps: ['teams', 'teams-push'],
      schema: ['55-sessions.sql', '56-teams.sql', '57-providers.sql'],
      functions: ['book-session', 'cal-webhook', 'cancel-session', 'coach-hours', 'livekit-webhook', 'payouts', 'providers',
        'scheduling-api', 'session-files', 'session-recordings', 'session-reminders', 'session-room', 'session-slots'],
      cron: [
        /* the providers' ledger (57-providers.sql) paid out, hourly */
        { name: 'payouts-sweep', schedule: '15 * * * *', command: 'select public.payouts_sweep()' },
        { name: 'session-recordings', schedule: '*/10 * * * *', command: 'select public.run_session_recordings()' },
        { name: 'session-recordings-retain', schedule: '40 4 * * *', command: 'select public.run_session_recordings_retain()' },
        { name: 'session-reminders', schedule: '*/5 * * * *', command: 'select public.run_session_reminders()' },
      ],
      env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CAL_WEBHOOK_SECRET', 'CAL_API_KEY', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'STORAGE_S3_ACCESS_KEY', 'STORAGE_S3_SECRET_KEY'],
    },
  },
  {
    key: 'coaching', what: 'the members\' chat with the coaches', needs: 'there is nowhere to keep a message',
    static: false, git: true, cloud: true,
    owns: {
      schema: ['50-chat.sql'], functions: ['chat-notify'],
      cron: [{ name: 'chat-followups', schedule: '* * * * *', command: 'select public.send_booking_followups()' }],
      env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
    },
  },
  {
    key: 'support', what: 'the widget, the desk, the prompts', needs: 'there is nowhere to keep a conversation',
    static: false, git: true, cloud: true,
    pages: [
      { name: 'SupportPage', order: 180, page: 'theme:pages/SupportPage.vue', test: 'platformkit/lib/page-routes.js#support' },
    ],
    owns: {
      steps: ['support-sdk'],
      schema: ['70-support.sql', '72-tickets.sql'], functions: ['support', 'support-api'],
      cron: [
        { name: 'support-escalate', schedule: '*/5 * * * *', command: 'select public.run_support_escalation()' },
        { name: 'support-retain', schedule: '20 4 * * *', command: 'select public.run_support_retention()' },
      ],
      env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
    },
  },
  /* social-publishing: in its own folder, packages/kit/modules/social-publishing/ */
  'social-publishing',
  {
    key: 'spaces', what: 'rooms, channels, threads, huddles — and the community served as a Matrix homeserver', needs: 'there is nowhere to keep a room or who is in it',
    static: false, git: true, cloud: true,
    /* THE MATRIX SURFACE IS THE COMMUNITY, not a module of its own: it is the same rooms and the
       same guards, reached by another kind of client, so it comes and goes with this switch and
       answers for the three shapes with it. It needs a backend for the same reason spaces does,
       and additionally the api module, which gates every other door the same way. */
    /* what other modules may add: a panel on a member's card, a place in the community */
    slots: ['member-card', 'place'],
    pages: [
      { name: 'SpacesPage', order: 200, page: 'theme:pages/SpacesPage.vue', test: 'platformkit/lib/page-routes.js#spaces' },
      /* with the network on too, /feed opens on the spaces page in either layout: one page answers both */
      { name: 'SpacesPage', order: 205, page: 'theme:pages/SpacesPage.vue', test: 'platformkit/lib/page-routes.js#feed', with: 'network' },
    ],
    owns: {
      steps: ['spaces', 'spaces-push'], functions: ['spaces', 'matrix-api'], schema: ['90-spaces.sql', '91-matrix.sql', '98-community.sql'],
      cron: [
        { name: 'spaces-later', schedule: '* * * * *', command: 'select public.run_space_scheduled();' },
        { name: 'spaces-sweep', schedule: '23 * * * *', command: 'select public.run_spaces_sweep();' },
      ],
    },
  },
  /* space-encryption: in its own folder, packages/kit/modules/space-encryption/ */
  'space-encryption',
  /*
   * THE SITE'S OWN SOCIAL NETWORK: a page per person, follows, a timeline, posts each saying who may
   * read them — and the same served as an atproto server, so Bluesky's app signs in with the host
   * swapped (openspec: social-network, atproto-api).
   *
   * SHAPES. Static has nowhere to keep an account or a post, so it is refused there outright. Git
   * and cloud are the same answer: everything here is state — rows people made — and nothing is
   * projected from a file, so whether the site rebuilds is a question it never asks.
   *
   * IT DOES NOT REQUIRE SPACES. A space's feed is pinned into the timeline where the spaces are on;
   * where they are off, the network is pages, follows and posts, and nothing of a space is offered.
   */
  {
    key: 'network', what: 'a page per person, follows, a timeline — and the same served to atproto apps', needs: 'a post, a follow and an account are rows',
    static: false, git: true, cloud: true,
    pages: [
      { name: 'FeedPage', order: 210, page: 'theme:pages/FeedPage.vue', test: 'platformkit/lib/page-routes.js#feed' },
    ],
    owns: {
      schema: ['93-network.sql'], functions: ['atproto'], env: ['NETWORK_HANDLE_DOMAIN', 'NETWORK_PLC_ROTATION_KEY'],
      cron: [
        /* a joined member's repository made to agree with their public rows, for whatever an ask missed */
        { name: 'network-project', schedule: '*/5 * * * *', command: 'select public.run_network_project();' },
        /* the relay asked to crawl the site again, once a day, while anybody has joined */
        { name: 'network-crawl', schedule: '17 3 * * *', command: 'select public.run_network_crawl();' },
      ],
    },
  },
  /* events: in its own folder, packages/kit/modules/events/ */
  'events',
  /* courses: in its own folder, packages/kit/modules/courses/ */
  'courses',
  {
    key: 'forms', what: 'the builder, /form/<slug>, the responses', needs: 'there is nowhere to keep a response',
    static: false, git: true, cloud: true,
    pages: [
      { name: 'FormPage', order: 120, page: 'theme:pages/FormPage.vue', test: 'platformkit/lib/page-routes.js#form', keyBy: 'route', props: { path: 'route' } },
    ],
    owns: { steps: ['form-embed', 'forms'], schema: ['25-forms.sql'], functions: ['form', 'forms-api'] },
  },
  /* funnels: in its own folder, packages/kit/modules/funnels/ */
  'funnels',
  {
    key: 'emails', what: 'the designs and the send function', needs: 'there is nothing to send with',
    static: false, git: true, cloud: true,
    owns: { steps: ['emails'], functions: ['send-email'], env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'], },
  },
  /* push: in its own folder, packages/kit/modules/push/ */
  'push',
  {
    key: 'models', what: 'content models and their entries', needs: 'an entry is edited through the admin, which needs a backend',
    static: false, git: true, cloud: true,
    pages: [
      { name: 'EntriesPage', order: 250, page: 'theme:pages/EntriesPage.vue', test: 'platformkit/lib/page-routes.js#entries', keyBy: 'route', props: { path: 'route' } },
    ],
    owns: { steps: ['models-json'] },
  },
  /* api: in its own folder, packages/kit/modules/api/ */
  'api',
  /* bots: in its own folder, packages/kit/modules/bots/ */
  'bots',
  /* copilot: in its own folder, packages/kit/modules/copilot/ */
  'copilot',
  /* instrument: in its own folder, packages/kit/modules/instrument/ */
  'instrument',
  /* recommendations: in its own folder, packages/kit/modules/recommendations/ */
  'recommendations',
  /* print: in its own folder, packages/kit/modules/print/ */
  'print',
  /* tts: in its own folder, packages/kit/modules/tts/ */
  'tts',
  /* enrichment: in its own folder, packages/kit/modules/enrichment/ */
  'enrichment',
  /* translation: in its own folder, packages/kit/modules/translation/ */
  'translation',
]

/* every module of the kit: the listed ones as written, and each named by key read from its own folder (openspec: modules-as-packages) */
const FOLDERS = await folderManifests(KIT_MODULES_DIR)
for (const f of FOLDERS) if (!LISTED.includes(f.key)) throw new Error(`packages/kit/modules/${f.key}/ is a module folder the list in build/modules/kit.mts does not name: add '${f.key}' where it belongs in the order`)
export const MODULES: ModuleDeclaration[] = LISTED.map((e) => {
  if (typeof e !== 'string') return e
  const f = FOLDERS.find((m) => m.key === e)
  if (!f) throw new Error(`build/modules/kit.mts names '${e}', which has no folder under packages/kit/modules/`)
  return f
})
