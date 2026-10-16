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
 */
export const MODULES = [
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
    owns: {
      steps: ['sales'],
      functions: ['usage-meter-report', 'usage-topup'],
      cron: [
        { name: 'stock-holds', schedule: '*/20 * * * *', command: 'select public.inventory_sweep()' },
        { name: 'payouts-sweep', schedule: '15 * * * *', command: 'select public.payouts_sweep()' },
        { name: 'usage-meter-reports', schedule: '*/5 * * * *', command: 'select public.run_usage_meter_reports()' },
      ],
      env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY'],
    },
  },
  {
    key: 'memberships', what: 'tiers, the billing portal', needs: 'there is nowhere to keep a membership',
    static: false, git: true, cloud: true,
    owns: {
      functions: ['hyperswitch-subscription-renewal'],
      cron: [
        { name: 'hyperswitch-subscription-renewal', schedule: '*/15 * * * *', command: 'select public.run_hyperswitch_subscription_renewal()' },
      ],
      env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    },
  },
  {
    key: 'sessions', what: 'booking types, the booker, the calendar', needs: 'there is nowhere to keep a booking',
    static: false, git: true, cloud: true,
    owns: {
      steps: ['teams', 'teams-push'],
      cron: [
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
      cron: [{ name: 'chat-followups', schedule: '* * * * *', command: 'select public.send_booking_followups()' }],
      env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
    },
  },
  {
    key: 'support', what: 'the widget, the desk, the prompts', needs: 'there is nowhere to keep a conversation',
    static: false, git: true, cloud: true,
    owns: {
      steps: ['support-sdk'],
      cron: [
        { name: 'support-escalate', schedule: '*/5 * * * *', command: 'select public.run_support_escalation()' },
        { name: 'support-retain', schedule: '20 4 * * *', command: 'select public.run_support_retention()' },
      ],
      env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
    },
  },
  {
    key: 'social-publishing', what: 'drafts and scheduled posts for social accounts', needs: 'accounts, media and delivery records live in the backend',
    static: false, git: true, cloud: true,
    owns: {
      schema: ['99-social.sql'],
      functions: ['social', 'social-oauth', 'social-publish', 'social-webhook', 'social-automation'],
      cron: [
        { name: 'social-publishing', schedule: '* * * * *', command: 'select public.run_social_publishing()' },
        { name: 'social-metrics', schedule: '*/10 * * * *', command: 'select public.run_social_metrics()' },
        { name: 'social-automation-recovery', schedule: '* * * * *', command: 'select public.run_social_automation()' },
      ],
    },
  },
  {
    key: 'spaces', what: 'rooms, channels, threads, huddles — and the community served as a Matrix homeserver', needs: 'there is nowhere to keep a room or who is in it',
    static: false, git: true, cloud: true,
    /* THE MATRIX SURFACE IS THE COMMUNITY, not a module of its own: it is the same rooms and the
       same guards, reached by another kind of client, so it comes and goes with this switch and
       answers for the three shapes with it. It needs a backend for the same reason spaces does,
       and additionally the api module, which gates every other door the same way. */
    owns: {
      steps: ['spaces', 'spaces-push'], functions: ['matrix-api'], schema: ['91-matrix.sql'],
      cron: [
        { name: 'spaces-later', schedule: '* * * * *', command: 'select public.run_space_scheduled();' },
        { name: 'spaces-sweep', schedule: '23 * * * *', command: 'select public.run_spaces_sweep();' },
      ],
    },
  },
  {
    key: 'space-encryption', what: 'a channel whose messages the server cannot read', needs: 'a key lives on a device and the cipher in a row',
    /*
     * ITS OWN SWITCH, AND NOT PART OF SPACES. End-to-end encryption costs a site things it may
     * want more than it wants secrecy: there is no search of an encrypted channel, no bot in one,
     * and no moderating what nobody can read. A site that wants rooms should not have to take
     * that bargain to get them, and a site that wants it should take it deliberately. So the
     * module is separate, and `encrypted: true` with it off is refused at the build rather than
     * quietly ignored — a channel a site believes is sealed and is not is the worst of the three
     * possible states.
     */
    requires: [{ module: 'spaces', why: 'there is no channel to encrypt without the rooms it belongs to' }],
    static: false, git: true, cloud: true,
    owns: { schema: ['92-encryption.sql'] },
  },
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
  {
    key: 'events', what: 'what is on, and who says they are coming', needs: 'there is nowhere to keep who is coming',
    static: false, git: true, cloud: true,
    owns: {
      steps: ['events', 'events-push'],
      cron: [{ name: 'event-reminders', schedule: '*/5 * * * *', command: 'select public.run_event_reminders()' }],
    },
  },
  {
    key: 'forms', what: 'the builder, /form/<slug>, the responses', needs: 'there is nowhere to keep a response',
    static: false, git: true, cloud: true,
    owns: { steps: ['form-embed', 'forms'] },
  },
  {
    key: 'funnels', what: 'funnels, blasts, audiences, the runner', needs: 'there is nobody to send to and nowhere to record it',
    static: false, git: true, cloud: true,
    owns: {
      steps: ['funnels-run', 'funnels'],
      cron: [{ name: 'email-funnels', schedule: '7 * * * *', command: 'select public.run_email_funnels()' }],
      env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
    },
  },
  {
    key: 'emails', what: 'the designs and the send function', needs: 'there is nothing to send with',
    static: false, git: true, cloud: true,
    owns: { steps: ['emails'], env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'], },
  },
  {
    key: 'push', what: 'web push to the staff', needs: 'there is nothing to send a notification from',
    static: false, git: true, cloud: true,
    owns: { env: ['VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'VITE_VAPID_PUBLIC_KEY'], },
  },
  {
    key: 'models', what: 'content models and their entries', needs: 'an entry is edited through the admin, which needs a backend',
    static: false, git: true, cloud: true,
    owns: { steps: ['models-json'] },
  },
  {
    key: 'api', what: 'the content API', needs: 'the API is Edge Functions',
    static: false, git: true, cloud: true,
    owns: {
      cron: [
        { name: 'content-push', schedule: '* * * * *', command: 'select public.run_content_push()' },
        { name: 'sweep-uploads', schedule: '50 4 * * *', command: 'select public.sweep_uploads()' },
      ],
    },
  },
  {
    key: 'bots', what: 'bots, tools and commands', needs: 'an agent run is rows and a function',
    static: false, git: true, cloud: true,
    owns: {
      steps: ['bots', 'bots-push'],
      cron: [
        { name: 'agents-sweep', schedule: '* * * * *', command: 'select public.run_agents();' },
        { name: 'agents-schedule', schedule: '*/5 * * * *', command: 'select public.run_agent_schedules();' },
      ],
    },
  },
  {
    /*
     * A BOT THAT IS SPOKEN TO. The thinking is the bots module's loop, untouched — no second
     * loop, no second provider seam, no second set of tools. This owns only what that loop has
     * never had: a door in a shape a voice front end can speak to, and somewhere to keep what a
     * person told an assistant where its file says to recall.
     *
     * SHAPES. Static has no functions at all, so there is no endpoint to speak to and no run to
     * make — a spoken conversation cannot be had there, and the text surfaces are unaffected.
     * Git and cloud are the same answer, because the grant, the endpoint and the run are rows and
     * a function either way: whether the bot's file is a file or a row is something neither the
     * door nor the loop can tell.
     */
    key: 'copilot', what: 'an assistant that is spoken to', needs: 'a grant, an endpoint and a run — all three need a backend',
    static: false, git: true, cloud: true,
    requires: [{ module: 'bots', why: 'a voice is a way to reach a bot, and without the bots there is nothing to speak to' }],
    owns: { functions: ['copilot-llm', 'copilot-speak'], schema: ['95-copilot.sql'] },
  },
  {
    key: 'instrument', what: 'a site\'s own readings', needs: 'an answer is written to an account',
    /* the instrument runs on the forms module's runner — one without the other cannot serve. The
       DEPENDENT declares it, so forms need not know who uses it. */
    requires: [{ module: 'forms', why: 'the instrument runs on the forms module\u2019s runner \u2014 one without the other cannot serve' }],
    static: false, git: true, cloud: true,
    owns: {},
  },
  {
    key: 'recommendations', what: 'Recommended For You, and the recommendations tab', needs: 'it is derived from what an account has read and bought',
    static: false, git: true, cloud: true,
    owns: {},
  },
  /*
   * PRINT WORKS IN THE CLOUD, PICTURES AND ALL, and this is the claim the whole derivation is tested
   * with — because a debt that has been PAID and is still listed is the exact failure it prevents.
   * That happened: print's cloud path was finished, its entry sat on the debt list for days, and the
   * same wrong belief was then repeated from recollection alone.
   *
   * Every action on the print model branches on `ctx.editions`, the admin's Edge Function hands it
   * in, and print-render does the rendering over the print bucket. It carried a `browser` exception
   * for the three pages of the interior a listing shows, and closing that turned up two more of the
   * same kind nothing had noticed: the cover the shop draws the book from was not made either (the
   * WASM compiler cannot write SVG), and a book set in the cloud never reached the store at all,
   * because print.json is derived and the live layer only refreshes collections.
   *
   * All three are one shape of gap — something a BROWSER has to do, in a mode whose whole point is
   * that no build box exists. The answer is that there IS a browser: the administrator's, in front of
   * the button they just pressed. print-render hands it what the document says about itself and takes
   * back the pictures it drew.
   */
  {
    key: 'print', what: 'books in print: editions, covers, quotes, orders', needs: 'an order has nowhere to go and no printer to go to',
    static: false, git: true, cloud: true,
    owns: { steps: ['lulu-webhook', 'print-type', 'print'], env: ['LULU_CLIENT_KEY', 'LULU_CLIENT_SECRET', 'MIXAM_USER', 'MIXAM_PASS', 'BOOKVAULT_API_KEY', 'PRINT_MOCK'], },
  },
  /*
   * SPOKEN BOOKS WORK IN THE CLOUD, and this claim was wrong before.
   *
   * `tts` is on the admin function's MACHINE list, so an administrator cannot commission a recording
   * there — and that was read as a gap. It is not one. The reader's own browser speaks a chapter with
   * the same model, caches it, and a signed-in reader's finished chapter is uploaded to the bucket
   * under the name the script would have given it; the next reader is served the recording rather
   * than making it. So every book gets audio on first read, wherever it is deployed, and the script
   * is an optimisation that fills the bucket ahead of anybody asking rather than the only way a
   * recording exists.
   *
   * Speaking a library is hours of CPU per book, which is the wrong shape for an Edge Function at any
   * price. That the admin cannot start one is the correct design, not a missing feature.
   */
  {
    key: 'tts', what: 'the spoken books', needs: 'a recording is kept in a bucket',
    static: false, git: true, cloud: true,
    owns: { steps: ['tts'] },
  },
  /* NO MODULE CARRIES AN EXCEPTION ANY MORE. Enrichment was the last one: the cache, the store and
     the worker branch that walks the stages inside a run are all done, proved by one book enriched
     end to end in cloud mode. A run in the cloud
     writes a DRAFT, which is where the discipline lives — nobody sees a generated companion until
     an administrator publishes it.
     WHAT FORCED THIS CLOSED is modes.test.mjs section 4: an exception must name a change that is
     still LIVE, so archiving the change fails the suite until the claim is raised to true. Note
     which guard that is, because the other one could not have done it: section 3 asks the
     derivation whether the gap is still real, and for `kind: 'machine'` it asks the admin's MACHINE
     list — which still holds `enrich`, correctly, because the button that SPAWNS the script is
     machine-only even now that the button that posts a RUN is not. One module, two actions, one
     list: unfalsifiable from that direction, and the archive guard is what caught it. */
  {
    key: 'enrichment', what: 'the introductions and the companions', needs: 'a run is rows, and the book is read through the store',
    static: false, git: true, cloud: true,
    owns: {},
  },
  {
    key: 'translation', what: 'reserved — a coming change', needs: 'not built',
    static: false, git: false, cloud: false,
    owns: {},
  },
]
