/* `npm test` for a site: the kit's own checks, then the site's (platformkit.config.js build.tests — each a
   script run from the site's root, in order), then the specs. One failing check stops the run, as one
   `&&` chain would; the report names each as it goes. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { loadSite } from './site.mjs'
import { workspaceRoot } from './sites.mjs'

const ROOT = process.cwd()
const WORKSPACE_ROOT = workspaceRoot(ROOT)
const KIT = (f) => fileURLToPath(new URL('./' + f, import.meta.url))
const c = await loadSite(ROOT)
/* A MODULE IS ON UNLESS IT SAYS false — the same reading as deploy-checks, steps.mjs and the
   router. This was `!!c.modules[m]`, which makes a module ABSENT from the config off: the root site
   never lists articles, books, wiki, docs, models or api because they are on by default, so their
   checks were being skipped on the one site that uses them. A test runner that disagrees with the
   rest of the kit about what is switched on will always skip the checks nobody thought to list. */
const on = (m) => c.modules[m] !== false

/* the kit's checks, each behind the module it belongs to */
/* the site's supabase/ tree is generated, never committed: assembled fresh, then checked for what an
   assembly cannot fix (a hand-added file, a migrations folder, an unresolved import, the seed line) */
const KIT_TESTS = [
  ['assemble.mjs'],
  ['assemble.mjs', '--check'],
  on('store') && ['product-keys.mjs', '--check'],
  /* the data the functions import is generated, not committed: made first, so a fresh clone has
     every one of them before a test reads one and before any function is served */
  ['functions-data.mjs'],
  on('store') && ['catalog.mjs', '--check'],
  on('emails') && ['emails.mjs', '--check'],
  on('funnels') && ['funnels.mjs', '--check'],
  on('enrichment') && ['enrich.test.mjs'],   /* where a stage's result is kept: a file in a checkout, the run's own state in the cloud, and the two are one shape */
  ['content.test.mjs'],
  ['projection-safety.test.mjs'],   /* a projection must surface errors before its declaration sweep can delete rows */
  ['content-rules.test.mjs'],   /* and whether the record's fields make sense TOGETHER: velite checks each field's shape, drops what fails and exits 0, and the deploy runs the build and no tests — so a declaration that contradicts itself (a cal.com url beside the native scheduler's settings) throws from prepare and fails the build */   /* every record against its schema: velite drops what does not validate, silently, and the site is built without it */
  ['admin-cms-mode.test.mjs'],
  ['tailwind.test.mjs'],
  ['strings-floor.test.mjs'],  /* a string the compiled collection has not got still comes back as the theme's own word, so no label is ever a blank */
  ['avatar.test.mjs'],  /* one person, one face: every read that hands out a drawn face hands out the parts it was drawn with, and nothing draws the reader's own face out of their display name */
  ['proposal-trace.test.mjs'],  /* what a proposal promises reaches a requirement: the Stripe bullet that named five things against deltas requiring one is how four features were never built, with every check green */
  ['docs-review-date.test.mjs'],
  ['checkout-params.test.mjs'],  /* a trial, tax, the payment methods accepted and a quantity the buyer may change — four things Stripe always offered and the store never passed; and the assertion that an offer declaring none of them resolves to exactly what it did before */
  ['payment-provider-adapters.test.mjs'], /* every declared provider operation is mapped by the Stripe and Hyperswitch adapter contracts */
  ['hyperswitch-sdk.test.mjs'],
  ['hyperswitch-payment-provider.test.mjs'],   /* the Hyperswitch adapter against its API's shapes: checkout, refunds, payouts, and its webhook signature and age */
  ['payment-providers.test.mjs'],
  ['inference-config.test.mjs'],   /* each site's inference: its own providers, tariffs and markup, validated, and never in the browser */
  /* the live Stripe test-mode journeys, where the run has a test key (the end-to-end run's, from the site's own .env) */
  /* in the end-to-end run, on a site that pays through Stripe (the runner says, and has refused a run without a test key) */
  process.env.PLATFORMKIT_E2E_STRIPE === '1' && ['stripe-testmode.integration.mjs'],
  process.env.PLATFORMKIT_E2E_STRIPE === '1' && ['stripe-usage-recovery.integration.mjs'],   /* the provider contract every adapter is held to */
  ['payment-provider-registry.test.mjs'],   /* which provider a site selects, what is assembled for it, and that its secrets stay server-side */
  ['site-payment-provider.test.mjs'],
  ['one-package.test.mjs'],
  ['check.test.mjs'],         /* platformkit check: every problem at once, one list of needs, offline by default */
  ['member-panels.test.mjs'],   /* the member card's panels: the kit's three by module, a site's off, own panels and order, the theme's words, no site named */
  on('spaces') && ['member-panels-db.test.mjs'],   /* the card's readings through may_see_member, refused as empty to anybody else, and the card and the admin agreeing on purchases */   /* PlatformKit is one package, platformkit: the retired names gone, the command and the theme packed, the command running from the packed copy */   /* a site's own adapter, registered through its own module and selected, with no change to the kit */
  on('store') && ['payment-provider-db.test.mjs'],   /* provider references and event ids kept apart by provider, against the stack */
  process.env.HYPERSWITCH_BROWSER_INTEGRATION_CONFIG && ['hyperswitch-browser.integration.mjs', process.env.HYPERSWITCH_BROWSER_INTEGRATION_CONFIG],
  process.env.HYPERSWITCH_LOCAL_INTEGRATION_CONFIG &&
    ['hyperswitch-local.integration.mjs', process.env.HYPERSWITCH_LOCAL_INTEGRATION_CONFIG],
  on('store') && ['usage.test.mjs'],
  ['usage-incremental-recovery.test.mjs'],
  ['copilot.test.mjs'],  /* a spoken conversation's grant: one bot, one person, one room, a ceiling it cannot raise and a clock it cannot wind back — every field altered in turn */
  ['copilot-db.test.mjs'],  /* what a person told an assistant is theirs: they read their own and nobody else's, delete their own, and no client may write a word into somebody's mouth the assistant would recall as theirs */
  ['fonts.test.mjs'],   /* the three faces: the families the kit offers, a name nobody serves refused, a face left unset falling to the theme's, and every stack ending in a generic so a face that never loads still sets type */
  ['first-party.test.mjs'],   /* the site runs on its own code: a product's client is driven by the tests and imported by nothing that runs */
  ['declarations.test.mjs'],   /* the line between a declaration and state, held mechanically: every table classified, no projection a client can write */
  ['sql-columns.test.mjs'],   /* every column a SQL function names, against the declaration: postgres resolves NEW at runtime, so `new.printer` after a rename to `supplier` compiled and raised on every insert — and a site's own SQL reads the kit's columns, which makes them an API across the boundary */
  on('api') && ['webhooks.test.mjs'],   /* the subscriptions a deployment ships: declared, pushed, and never holding a secret */   /* the line between a declaration and state, held mechanically: every table classified, no projection a client can write */
  ['transcript.test.mjs'],   /* what the browser writes down while somebody speaks: the arithmetic, with no browser in it */
  ['interrupt.test.mjs'],
  ['identity.test.mjs'],
  on('print') && ['print-parity.test.mjs'],
  on('print') && ['print-jobs.test.mjs'],
  on('print') && ['print-cloud.test.mjs'],
  on('print') && ['print-jobs-db.test.mjs'],   /* a set is a job that outlives its request: the result kept, a cut-off set carried on from its finished interior, a held lease left alone, a cancel that stops and clears, attempts that run out */   /* a book set where there is no machine: against the running stack, and binding the same count the build does; skipped where the stack is down or the book is not in rows */   /* a book cut into runs where one call cannot hold it: the order kept, a long chapter never split, a run that overran moving only what follows it */   /* one engine, two drivers: the seam is the only door, and a book set in a function is the same edition as one set on a machine */   /* who is here, told once: the guard six modules load and discard on, and the refresh that must tell nobody */   /* what may interrupt a reader, and who has the corner: one rule the ad and the chat both ask */
  ['analytics.test.mjs'],
  ['content-api.test.mjs'],   /* the content API: the index over the compiled content */
  ['analytics-sdk.test.mjs'],   /* the drop-in script: PostHog's declared surface on it, its size, its behaviours in a headless page against the served door */   /* what a session records on arrival; the channel rule, the audience, recirculation and right now against the stack when it is up */
  ['companions.test.mjs'],
  on('tts') && ['speech.test.mjs'],
  ['markup.test.mjs'],   /* what a person may write in a message: the marks every chat surface offers, the ones it does not, and that nothing typed ever becomes markup */
  on('coaching') && ['chat.test.mjs'],
  on('sessions') && ['recordings.test.mjs'],
  on('sessions') && ['teams.test.mjs'],      /* a team is a file: the grammar, and what the compile refuses — a fill that means nothing, a booking type naming a team that is gone */
  ['share-cloud.test.mjs'],   /* the nginx config is valid with a prerender sidecar and without one; the stack itself behind PLATFORMKIT_SHARE_STACK=1 */
  on('bots') && ['bots-db.test.mjs'],   /* the bots reach the surface on a publish, and the theme's skills with no package directory to read them from */
  on('events') && ['events-db.test.mjs'],   /* the calendar reaches the database on a publish, with no machine: a save over rows moves nothing */
  on('sessions') && ['teams-db.test.mjs'],   /* and its membership is rows: the rule filling it, an invitation surviving a change to the rule, and a membership that is not a directory */
  on('sessions') && ['holds-db.test.mjs'],   /* nobody's time is taken twice: the hold written with the booking, two at the same instant with one refused, a group holding its host once */
  on('sessions') && ['times.test.mjs'],   /* the native scheduler's arithmetic: wall time in a zone, the open starts of a host */
  on('sessions') && ['scheduling.test.mjs'],   /* the site's own scheduler against the served functions and Mailpit; skipped where the site has no native type */
  on('sessions') && ['meetings.test.mjs'],   /* the site's own video room in its mock: the token door, the signed events, the recording landed; skipped where no type is in a room */   /* a call's recording pulled, signed and kept, against the served functions when the stack serves them */
  on('support') && ['support.test.mjs'],
  on('support') && ['tickets.test.mjs'],   /* the work as against the conversation: what is owed on a ticket, the order, the narrowing */
  on('bots') && ['agents.test.mjs'],       /* what a run does next: cancelled mid-flight, out of money, a model asking for two tools at once */
  ['search.test.mjs'],
  ['recommendations.test.mjs'],  /* what a reader is interested in, derived rather than stored: a re-tagged piece changes it with nothing re-run, a partial read counts, and a purchase outweighs any amount of browsing */                  /* a landing page's words are its sections', and what the palette leaves out */
  ['content-kinds.test.mjs'],           /* every content type can be edited with no checkout, and no build script opens content with fs */
  ['artefacts.test.mjs'],               /* every compiled artefact says how it reaches a deployment that does not build, and compiles the same from content alone */
  ['modes.test.mjs'],
  ['who-can.test.mjs'],   /* every seeded kind of person against every action that defines one — what they may DO, asked of the database rather than of the page, because a hidden button is not a closed door */
  ['manifests.test.mjs'],   /* what a module declares about itself: a missing shape, a typo’d field, an exception with no reason and two manifests under one key are each refused rather than quietly meaning nothing */
  ['site-module.test.mjs'],   /* the extension model tried against a site that uses it: sites/demo registers a module the kit has never heard of, and it gets everything one of the kit's does — and loses all of it, and nothing of the kit's, when its switch says false. Skips loudly if the fixture is not in the checkout. */
  ['modules-off.test.mjs'],   /* one module off at a time, every module: its own steps stop and its secrets stop being demanded, nothing else moves, every step is gated on a switch that exists, and a coupling that is real is NAMED rather than tolerated */                   /* the three shapes: every module declares what it does in each, and the code is derived to see whether it backs the claim */
  on('bots') && ['anthropic.test.mjs'],    /* the second provider: the shape both ways, the order, and which failures are worth trying somebody else for */
  on('bots') && ['agents-db.test.mjs'],    /* and the real worker against the stack: a dead worker resumed, a cancel that stops a tool, a budget that holds */   /* the work as against the conversation: what is owed on a ticket, the order, the narrowing */
  on('events') && ['recurrence.test.mjs'],   /* when something happens again: the rule as fields, the occurrences, the daylight saving */
  on('events') && ['calendar.test.mjs'],     /* what is on, as a surface asks for it: today, on now, and the gathering by day */
  on('spaces') && ['spaces.test.mjs'],
  /* a channel's seal: the one resolution of the channel's answer against its space's, and the
     grammar that was carrying neither — behind its own module, which is separate from spaces */
  on('space-encryption') && ['encryption.test.mjs'],
  /* and what a sealed message actually leaves in the row and in the index, against the stack */
  on('space-encryption') && ['encryption-db.test.mjs'],
  ['comments.test.mjs'],   /* the shape of a conversation, and the flagged list: whole words, so Scunthorpe is not held */
  ['reactions.test.mjs'],  /* best is not top: 9 up and 1 down above 40 up and 30 down, on fixed numbers */
  ['comments-db.test.mjs'],  /* who is held and who is not, against the stack: the flagged word beating trust, what an approval writes down, the embed's three declarations */
  on('spaces') && ['ban-db.test.mjs'],   /* a ban keeps somebody out by every door at once, and a shadow ban is invisible to everybody but its author; against the stack, skipped where it is down */
  on('spaces') && ['desk.test.mjs'],   /* the staff's one list: the shape every source fills, and what is owed said once */
  on('spaces') && on('social-publishing') && ['desk-social.test.mjs'],
  on('spaces') && on('social-publishing') && ['social-capabilities.test.mjs'],
  on('spaces') && on('social-publishing') && ['social-edge-runtime.test.mjs'],
  on('spaces') && ['spaces-db.test.mjs'],
  on('spaces') && ['community-nav.test.mjs'],   /* the community's navigation: its places for every kind of person and configuration */
  on('network') && ['network.test.mjs'],   /* the network's arithmetic: audiences, pages, threads, links */
  on('network') && ['network-media.test.mjs'],   /* what a post may carry and how it goes over the protocol */
  on('network') && ['network-db.test.mjs'],   /* the network's audiences, blocks, timeline and moderation, against the stack */
  on('spaces') && on('network') && ['community-notes-db.test.mjs'],   /* the community's one notification list, against the stack */
  on('network') && ['atproto.test.mjs'],
  on('network') && ['atproto-interop.test.mjs'],   /* the wider network checked by its own tools: a PLC directory, a verified repository, the stream as a relay reads it, an app view */   /* the network as an atproto server, driven by Bluesky's own client against the served function */
  on('spaces') && ['community-db.test.mjs'],
  on('spaces') && ['desk-db.test.mjs'],   /* the staff's one list against the stack: three sources, each answered where it lives, and nothing for a reader */
  (on('spaces') || on('sessions')) && ['huddle.test.mjs'],   /* a call that needs no account: the ICE servers and where they came from, the standard's credential against a known vector, the provider a room gets, the mesh's own answers, and no vendor named anywhere */   /* the spaces against the local stack: the fill sweep, the isolation, the counters against a walk, the cursor, mentions, the edit guard, the live topic; skipped when the stack is down */   /* the spaces' arithmetic: unread as a subtraction, the cursor, the divider, mentions as tokens, what notifies, the search grammar */
  on('funnels') && ['funnels-analytics.test.mjs'],   /* the funnel reads against the seed, and the unsubscribe link marking its send; skipped when the stack is down */
  on('forms') && ['forms.test.mjs'],
  on('forms') && ['forms.mjs', '--check'],
  on('forms') && c.modules.api !== false && ['forms-api.test.mjs'],
  on('sessions') && c.modules.api !== false && ['scheduling-api.test.mjs'],
  on('store') && c.modules.api !== false && ['storefront-api.test.mjs'],
  on('support') && c.modules.api !== false && ['support-api.test.mjs'],
  on('social-publishing') && ['social-permissions.test.mjs'],
  on('social-publishing') && ['social-security.test.mjs'],
  on('social-publishing') && ['social-automation.test.mjs'],
  on('social-publishing') && ['social-automation-db.test.mjs'],
  on('social-publishing') && ['social-automation-admin.test.mjs'],
  on('social-publishing') && ['social-webhooks.test.mjs'],
  on('social-publishing') && ['social-publishing.test.mjs'],
  on('social-publishing') && ['social-delivery.test.mjs'],
  on('social-publishing') && ['social-oauth.test.mjs'],
  on('social-publishing') && ['social-managed.test.mjs'],
  on('social-publishing') && ['social-outcome.test.mjs'],
  on('social-publishing') && ['social-admin.test.mjs'],
  on('social-publishing') && ['social-metrics.test.mjs'],
  on('social-publishing') && ['social-metrics-db.test.mjs'],
  /* the community as a Matrix homeserver: the translation under Node, then matrix-js-sdk — the
     library Element is built on — against the served function */
  on('spaces') && c.modules.api !== false && ['matrix-api.test.mjs'],   /* the desk as Chatwoot's APIs: the shapes under Node; the Client and Application APIs, the webhooks and the snippet against the served function */   /* the store as Shopify's Storefront API: the products from the offers under Node; the official client, the cart and the handoff against the served function */   /* the sessions as cal.com's API v2: the shapes under Node; cal.js pointed at the site, the judge, the webhooks and cal.com's embed against the served function */   /* the forms as Typeform's API: the shapes under Node; the official client, the webhooks and the embed against the served function */
  c.modules.models !== false && ['models.test.mjs'],
  c.modules.models !== false && ['models.mjs', '--check'],
  ['steps.test.mjs'],
  ['content-refresh.test.mjs'],
  ['social-adapter.test.mjs'],
  ['social-provider-matrix.test.mjs'],
  on('social-publishing') && ['social-operations.test.mjs'],
  ['pipe.test.mjs'],
  ['admin-fence.test.mjs'],
  ['admin-classes.test.mjs'],   /* every `ui-` class a component wears is one something defines: `.ui-in` is not `.ui-input`, styled nothing, and drew a white input on the dark theme in three places */
  ['tiers.test.mjs'],
  on('sessions') && ['booking.test.mjs'],   /* one list, two kinds of record: a provider's offering wearing a booking type's shape, so the surface and the judge can never disagree about what it is */
  ['providers-db.test.mjs'],   /* what a provider may do: the cautious policy, a signed version frozen, who is owed the new one, an offering theirs and never deleted, and failing to sign stopping selling and nothing else */
  ['payouts.test.mjs'],   /* what the business owes, as arithmetic: a share of a week refused where it is written, a refund reversing in proportion and never more, and earned · payable · waiting · sent kept four different numbers */
  ['people-db.test.mjs'],   /* every account in one read, against the stack: the narrowings, the search, what the desk already knows about one person, and nothing at all for a reader */
  ['payouts-db.test.mjs'],   /* the same arithmetic in the database: the sweep firing once however often it runs, the delay, and a refund reversing a line that has already gone */
  ['awards-db.test.mjs'],   /* the event stream awards a badge when its rule is met and not before, and a client can neither award itself one nor read what the site believes about it */   /* who a booking type is for: one rule both sides of the gate ask, and a list of tiers that implies no ladder */   /* a coach reaches the admin for one thing — their own page — and the pipe refuses every other record, not merely hides it */
  ['store.test.mjs'],   /* the store under the pipe: the checkout, and the rows on the local stack when it is up; the export; the push with GitHub mocked; the admin function's door */
  ['entry.test.mjs'],
  ['collections.test.mjs'],
  ['permissions.test.mjs'],
  ['permissions-db.test.mjs'],
  ['ledger.test.mjs'],   /* what a payment means: who paid, which offer, what it grants — the decisions apart from the writing */   /* and the policies asked the same question as the rules, per account per table */   /* the four vocabularies under one ability, answering exactly as they did, and a site that adds, narrows and revokes */   /* the second content engine, held to the shape of the first: a relative directory, the body from the parser, an eager plain, a single that is a record */   /* cloud mode's adapter against velite: every built entry made again from its file as a row, field for field */
  on('print') && ['suppliers.test.mjs'],   /* the plug-in seam: every printer wears the same shape, its statuses land in our words, and nothing outside its own file chooses one by name */
  on('funnels') && ['marketing.test.mjs'],   /* who marketing mail goes to and that it goes once: a misspelt rule dropped rather than becoming everybody, an email’s uuid surviving a rename and a reorder, and the sign-in design keeping Supabase’s own link */
  on('print') && ['edition-id.test.mjs'],   /* what makes an edition an edition: too sensitive and every deploy pays a setup fee again and voids every proof; too blunt and a changed word ships under the old id — every input and every non-input, and the order, since the hash is a join */
  ['interaction.test.mjs'],   /* a browser that USES the site rather than only looking at it: the palette typed into, a guest’s line sent and shown, a diagnostic answered, the bag opened — the class of fault a route walk cannot see, since the page renders perfectly and dies on the first keystroke. Skips loudly with no dev server. */
  ['signed-in-as.test.mjs'],   /* the same kinds of person as who-can.test.mjs, but signed in through a real browser: the set of admin sections each one reaches BY ADDRESS (a missing link proves nothing about a missing lock), and one thing their role exists for actually carried out. Skips loudly with no dev server. */
  ['theme-look.test.mjs'],   /* a palette is complete or it is not a palette: every colour the theme reads, against every colour each look defines. An incomplete palette does not look broken in review — it looks right on every page somebody opened and wrong on the one they did not, which is how the theme came to ship a button with its text the same colour as its background. */
  ['webhook-doors.test.mjs'],   /* the doors that face the internet: every inbound webhook refuses an unsigned, wrongly signed, altered or stale body and a replayed cal.com "created" revives nothing; LiveKit's development secret signs nothing without an account; a mocked printer is not walked to shipped; and a reader who may add a recording nobody has made and may never replace one — against the functions and the storage API as they are actually served */
  ['test-coverage.test.mjs'],   /* nothing untested by construction: every function named by a test, no early exit but through the helper, every claim naming a test that runs */
  ['test-stack.test.mjs'],   /* where a stack test reads its stack: the run's own addresses, a skip that fails under the end-to-end run, and the one marker for a fact about the site */
  ['function-doors.test.mjs'],   /* the functions nothing else called: each door refusing the wrong caller and answering the right one, against the stack */
  ['function-bodies.test.mjs'],   /* every SQL function in the declaration compiles against the tables as built — the schema loads with the check off, so a body naming a column that is not there fails only when called */
  ['ownership.test.mjs'],   /* an account reaches only its own records: no definer function a visitor may call goes unchecked; a profile's address is not its own to write and claims nothing until proven; another account's orders, bookings, tickets, payouts, usage and answers come back as nothing; staff within their roles; links an hour at most and only to a booking's own folder — skipped when the stack is down or OWNERSHIP_TEST=0 */
  ['roles.test.mjs'],   /* roles granted only by administrators: no reader, editor or provider writes themselves a role, a class, an entitlement or a membership, an offering already on sale, or an approved comment; the last administrator always remains, even two removing each other at once — skipped when the stack is down or ROLES_TEST=0 */
  on('store') && ['checkout-tamper.test.mjs'],   /* the server decides what a buyer pays: a tampered checkout read back from Stripe's test mode — price, currency, discount, class, quantity, shape and shipping all the server's — skipped without a test-mode key or CHECKOUT_TAMPER_TEST=0 */
  ['abuse-limits.test.mjs'],   /* one visitor's flood refused and another still served at guest checkout, form answers, analytics intake and the support widget, counted by the address the proxy wrote; a compressed body opened only to a megabyte — skipped when the stack is down or ABUSE_LIMITS_TEST=0 */
  ['doors-db.test.mjs'],   /* the refusals to somebody who is NEARLY allowed: a password session claiming a confirmed address, a member asking for the figures, a membership that lapsed yesterday, a forged tracking token — the boundary a change quietly moves */
  on('store') && ['money-db.test.mjs'],   /* the database half of a payment arriving twice: one session is one purchase, one grant is one row, and three credits from one payment are THREE — the per-unit source id exists because a shared one folds them into one and nobody is told */
  on('funnels') && ['dryrun-db.test.mjs'],   /* “see who would get this” must send nothing: the rows counted either side of a dry run against the served function — and a loud skip where no PUBLISHED funnel has an email step, since nothing moves there whatever the guards do */
  on('store') && ['prices.test.mjs'],   /* a price list is a contextual ABSOLUTE price, Medusa's model read off its source: an override always wins and may be dearer; a sale is min(sale, default) */
  on('store') && ['promotions.test.mjs'],   /* and a discount is a different thing entirely — percentage or flat, off items, the order or the shipping, spread each/across/once */   /* most specific wins, not cheapest, and the base list loses every tie — both counter-intuitive, both got wrong first time */
  on('store') && ['stock.test.mjs'],   /* sold out is not the same as not sold, and unknown is BUYABLE — a shop that stops selling when it cannot reach its database fails silently and in the one direction nobody notices */
  on('store') && ['promotions-db.test.mjs'],   /* a budget nothing counts is a decoration: ten checkouts racing for three uses, and exactly three win */
  on('store') && ['inventory-db.test.mjs'],   /* what is left, against the real database: the decrement is ONE statement, so two sessions racing for the last unit cannot both win — a read-then-write implementation passes every test but this one */
  on('store') && ['usage-db.test.mjs'],   /* what was granted less what was used, against the real database: replay, exhaustion, two readers, and no client writes */
  on('store') && ['orders-db.test.mjs'],   /* an order has a life: the transactions summing to the total and refused AT THE WRITE, fulfilment and payment derived from the rows rather than stored beside them, an edit that raises the version while an invoice still renders at the old one, and stock coming back on received and never on requested */
  on('store') && ['sales.test.mjs'],   /* the Bestseller badge is earned, never set: no sales means no badge (the path a fresh clone takes), the count is per BOOK across its offers, and neither an old sale nor a refund is a sale */
  ['reads-db.test.mjs'],   /* one read is one read: a session in three segments must move the Content page by ONE, keep the deepest point and add the seconds — figures nobody can check are worse than none, because they get acted on */
  ['twice-db.test.mjs'],   /* an event arriving more than once — a retried MEETING_ENDED, a cron run a minute later, an entitlement whose week runs out: does the thing, does it again, and counts */
  ['guards-db.test.mjs'],   /* what a signed-in client may change and what the database does on its own: the desk’s guard trigger column by column, one coaching thread per pair either way round, a member who cannot grant themselves a role, and every scheduled job present after a reset */
  on('books') && ['ranking.test.mjs'],   /* Find your book: the two best chapters rather than the plain best, both halves counting, and the pace a lean of at most 0.15 that never outweighs what somebody wrote — a ranking cannot fail visibly, it just returns the wrong three */
  ['unpublished.test.mjs'],   /* nothing unpublished reaches the bundle, checked against the compiled output rather than against a reading of the hook that drops it — and the same record published does appear, so a filter that dropped everything would not pass */
  ['sell-rules.test.mjs'],   /* what the shop REFUSES: a cloth the book does not offer, a country outside the list, a spine past the foil, a proof gone stale — the decisions over plain data, and every one of them a refusal that renders nothing when it works */
  ['rewrites.mjs', '--check'],   /* deploy/_redirects covers the modules; the nginx template says what the file says */
  ['sites-host.test.mjs'],
  ['site-repositories.test.mjs'],
  ['source-cli.test.mjs'],
  ['runtime-paths.test.mjs'],
  ['deploy-pins.test.mjs'],
  ['dev-workspace.test.mjs'],
  ['dev-directory.test.mjs'],
  ['dev.test.mjs'],
  ['dev-stop.test.mjs'],
  ['bootstrap-env.test.mjs'],
  ['workspace-root.test.mjs'],
  ['site-boundary.test.mjs'],
  ['cron-registration.test.mjs'],   /* every scheduled job declared by a module, registered once, unscheduled when its module goes off */
  ['assets.test.mjs'],   /* where a picture is kept and how its address is written, the media library's rule */
  ['rewrites.test.mjs'],   /* the nginx instance in Docker against the local stack: every rewrite reaches its function, every other path the app; skipped when Docker or the stack is down */
  ['steps.mjs', '--check'],   /* every build step's needs — a package a module needs and the site has not installed */
  ['deploy-checks.mjs', '--test'],
  ['overrides.test.mjs'],
  ['gate.test.mjs'],   /* what of a record a reader is sent: each class's chapters, a bought book's lift, a teaser never the whole chapter */
  on('books') && ['reader-content.test.mjs'],   /* the same, against the local stack: a guest, a non-member, a buyer and a member sent only their own; no visitor reads the content table; skipped when the stack is down or READER_CONTENT_TEST=0 */
  ['gated-content.test.mjs'],   /* a whole build of the demo with gated fixtures publishes no gated sentence, pre-rendered pages included; slow, GATED_CONTENT_TEST=0 skips it */
  ['bundle-secrets.test.mjs'],  /* a whole build of the demo with every server secret planted publishes none of them; slow, BUNDLE_SECRETS_TEST=0 skips it */
  ['usage-alert.test.mjs'],   /* which usage payments raise the site-wide banner, and the pages it keeps off */
  ['assembled-tree.test.mjs'],   /* the assembled supabase/ tree is generated: the step passes on a fresh checkout and a stale copy, and refuses a file neither owner declared */
  ['site-modules.test.mjs'],   /* the #site/* modules are files the dependency scan follows: a package only the site imports is pre-bundled at startup, not found mid-request */
  ['sections.test.mjs'],   /* the landing catalogue: registry ↔ schemas, defaults valid, no one site's vocabulary, the embed patterns */
  ['site-nav.test.mjs'],   /* who the community link is for: shown to a visitor when there is a room to walk into, a word while it is a way in */
  ['icons.mjs', '--check'],   /* every glyph a page names is one something can draw: an unknown name used to be skipped in silence and drew a hole */
  ['yaml-keep.test.mjs'],   /* a save keeps the file's own comments, and moves no line it did not change — over every self-documenting record this grammar writes */
  ['strings.test.mjs'],
  ['images.test.mjs'],   /* the image sources as a class: a source with no key is absent, the key stays server-side, and what is chosen lands in the library — plus Unsplash's licence conditions as code */
  ['variants.test.mjs'],   /* options in, variants out — and a two-way proof over every book in print that its own cart lines, skus and refusals come out unchanged */
  ['store-kinds.test.mjs'],   /* the seam a kind of thing reaches the store through: two slots and an opaque record, driven by a fixture kind for something the kit does not sell */
  ['store-separation.test.mjs'],   /* and the store names no kind of thing — both ways, so deleting print's vocabulary fails too */
  ['destructive.test.mjs'],
  ['schema.test.mjs'],   /* the declaration's loop on a database of its own; skipped when Docker is down or SCHEMA_TEST=0 */
  ['policies.test.mjs'],   /* who may read what, on the local stack's seed: an administrator every order and booking, a reader their own; skipped when the stack is down or POLICY_TEST=0 */
  fs.existsSync(path.join(WORKSPACE_ROOT, 'sites', 'docs', 'content', 'docs')) && ['docs-check.mjs'],   /* the docs agree with the code (the reference pages exactly; every page's sources exist) */
].filter(Boolean)

/*
 * WHICH CHECKS NEED A STACK — read from each one's own source rather than kept as a list: a test that asks
 * for a stack's address needs one, and a new one is classified the moment it is written. Those run in the
 * end-to-end run (build/e2e.mjs → `test.mjs --e2e`), on a stack built for it from the site's files, where
 * a skip is a failure. `npm test` still runs them for the parts that need nothing, and says plainly at the
 * end that their stack parts are the other run's.
 */
/* a stack test is one that takes its stack from build/test-stack.mjs — the import is the mark, and test-coverage.test.mjs
   fails any test that reaches a stack without it (a pattern guessed from the source let fifteen tests drop out of the run) */
const STACK_SOURCE = /from '\.\/test-stack\.mjs'|supabaseUrl\(\)|localStack\(\)/
const needsStack = (file) => { try { return STACK_SOURCE.test(fs.readFileSync(file, 'utf8')) } catch { return false } }
const E2E = process.argv.includes('--e2e')
/* the checks that make databases of their own, which only the end-to-end run's Docker should be asked for */
const E2E_ALSO = ['schema.test.mjs', 'cloud-lane.test.mjs', 'stripe-testmode.integration.mjs', 'stripe-usage-recovery.integration.mjs']

if (E2E) {
  /* every stack check this site's modules switch on, the site's own among them; each runs whatever came before */
  const kit = KIT_TESTS.filter(([f]) => needsStack(KIT(f)) || E2E_ALSO.includes(f)).map(([f, ...a]) => [`kit: ${f}`, KIT(f), a])
  const own = ((c.build && c.build.tests) || []).filter((t) => needsStack(path.resolve(ROOT, t))).map((t) => [`site: ${t}`, path.resolve(ROOT, t), []])
  const cloud = [['lane: cloud', KIT('cloud-lane.test.mjs'), []]]
  const failed = []
  /* THE FUNCTIONS ANSWERING before each test: a test that writes into the functions tree (webhooks.json, a step's
     data) makes the runtime reload, and the next test's first calls met a 502 — a failure of the order, not the code */
  const FUNCTIONS = process.env.PLATFORMKIT_TEST_FUNCTIONS_URL || ''
  const settled = async () => {
    if (!FUNCTIONS) return
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(FUNCTIONS + '/cal-webhook', { method: 'OPTIONS', signal: AbortSignal.timeout(5000) }); if (r.status !== 502 && r.status !== 503) return } catch { /* reloading */ }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  for (const [label, file, a] of [...kit, ...own, ...cloud]) {
    console.log(`\n▸ ${label}`)
    await settled()
    const r = spawnSync(process.execPath, [file, ...a], { cwd: ROOT, env: process.env, encoding: 'utf8', maxBuffer: 1 << 28 })
    const out = (r.stdout || '') + (r.stderr || '')
    process.stdout.write(out)
    /* a check that could not run is not a check that passed */
    /* the one accepted stand-down is a fact about the site (test-stack.mjs notHere: 'not on this site'); everything else that did not run is a failure */
    const skipped = out.split('\n').filter((l) => !/not on this site/i.test(l) && /\b(skipped|NOT covered|NOT RUN|not looked at|not served|is not up|could not run)\b/i.test(l))
    if (r.status !== 0) { failed.push(label); console.log(`✗ ${label} failed`) }
    else if (skipped.length) { failed.push(label); console.log(`✗ ${label} could not run in full — ${skipped.slice(0, 3).map((l) => l.trim()).join(' | ').slice(0, 300)}`) }
  }
  console.log(failed.length ? `\n✖ ${failed.length} of ${kit.length + own.length + 1} end-to-end check(s) failed or could not run` : `\n✔ every end-to-end check passed (${kit.length + own.length + 1})`)
  process.exit(failed.length ? 1 : 0)
}

const run = (label, cmd, args) => {
  console.log(`\n▸ ${label}`)
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: process.env })
  if (r.status !== 0) { console.error(`\n✗ ${label} failed`); process.exit(r.status || 1) }
}
console.log('\n══ lane: git — a checkout with a backend ══')
/* the schema check makes and breaks a database of its own in Docker: the end-to-end run's, not this one's */
for (const [f, ...args] of KIT_TESTS.filter(([f]) => f !== 'schema.test.mjs')) run(`kit: ${f}${args.length ? ' ' + args.join(' ') : ''}`, process.execPath, [KIT(f), ...args])
for (const t of (c.build && c.build.tests) || []) run(`site: ${t}`, process.execPath, [path.resolve(ROOT, t)])
/* the adapters' Deno tests, run as Deno runs them (the functions are Deno's); test-coverage holds that every one is listed here */
export const DENO_TESTS = ['stripe-payment-provider.test.ts', 'hyperswitch-payment-provider-adapter.test.ts']
for (const t of DENO_TESTS) run(`kit: ${t} (deno)`, 'deno', ['test', '--no-lock', '-A', KIT(t)])
/* the specs, where a site keeps them */
if (fs.existsSync(path.join(WORKSPACE_ROOT, 'openspec'))) run('openspec validate', 'npx', ['openspec', 'validate', '--all', '--strict'])

/*
 * THE OTHER TWO SHAPES, RUN AS THEIR OWN LANES.
 *
 * Everything above is one shape — a checkout with a backend — and it passed green the whole time
 * the static shape could not be deployed at all. A suite that only ever exercises the arrangement
 * the developer happens to be sitting in is a suite that reports on one third of the product.
 *
 * These only run where the fixtures are (the kit's own repository); a site that installed the kit
 * has its own shape and no business building ours. A lane that is skipped SAYS SO at the end of the
 * run rather than passing quietly, which is the whole difference between a skip and a lie.
 */
const skipped = []
if (fs.existsSync(path.join(ROOT, 'sites', 'docs', 'platformkit.config.js'))) {
  if (process.env.PLATFORMKIT_SKIP_STATIC_LANE === '1') skipped.push('static — PLATFORMKIT_SKIP_STATIC_LANE=1, so a site with no backend was not built or walked')
  else { console.log('\n══ lane: static — a site with no backend, built and walked ══'); run('lane: static', process.execPath, [KIT('static-site.test.mjs')]) }
}

if (process.env.PLATFORMKIT_SKIP_CLOUD_LANE === '1') skipped.push('cloud — PLATFORMKIT_SKIP_CLOUD_LANE=1, so the publish cycle over rows was not exercised')
else { console.log('\n══ lane: cloud — content in rows, nothing that rebuilds ══'); run('lane: cloud', process.execPath, [KIT('cloud-lane.test.mjs')]) }

if (skipped.length) {
  console.log('\n⚠ ' + skipped.length + ' lane(s) skipped — these shapes are NOT covered by this run:')
  for (const s of skipped) console.log('   ' + s)
}
{
  const stackChecks = KIT_TESTS.filter(([f]) => needsStack(KIT(f)) || E2E_ALSO.includes(f)).map(([f]) => f)
  console.log(`\n✔ every check passed — ${stackChecks.length} of them need a stack, and their stack parts are NOT covered here: they run under \`platformkit test --e2e\` (${stackChecks.join(', ')})`)
}
