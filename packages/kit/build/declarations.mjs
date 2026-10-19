/*
 * Where the line falls, table by table.
 *
 * One question decides it: if the database were deleted and the repository redeployed, should this
 * come back? Yes — it is a DECLARATION, it is a file under content/, and the database may hold a
 * one-way PROJECTION of it. No — it is STATE, it lives in the database and nowhere else.
 *
 * This file exists because a rule written in prose is obeyed until somebody is in a hurry. Every
 * table the kit declares must appear here, so adding one means answering the question in the same
 * commit, and build/declarations.test.mjs refuses a table that appears in neither list, a projected
 * table a client could write, client code that writes one, and a projection with no source.
 *
 * A third state, `pending`, is a declaration that is not a file YET: it names the change that will
 * move it, the checks step over it, and the test prints it every run so the debt is loud rather
 * than quiet. An entry with no such change, or one that has been archived, fails.
 *
 * Secrets are in neither list on purpose. A secret is an environment variable; it has never been a
 * declaration or state, and naming it here would invite somebody to put one in a file.
 */

/*
 * PROJECTED FROM A CONTENT PATH — the database holds a copy nobody edits.
 *
 * `by` is the script that writes it, and it is part of the truth rather than a note: a projection
 * that nothing restores after `platformkit migrate reset` leaves an EMPTY table, and an empty table
 * does not fail — whatever asks it politely finds nothing. The bots went missing that way and the
 * support desk's Get an instant answer quietly started no run; the search rows went with them, which
 * is a bot's search tool finding an empty library. `build/declarations.test.mjs` now refuses a
 * projection whose `by` the reset does not run.
 */
export const DECLARED = {
  spaces:        { by: 'spaces-push', from: 'content/spaces/*.md' },
  channels:      { by: 'spaces-push', from: 'content/spaces/*/*.md', note: "the declared rooms; a direct message is kind 'dm', made by the people in it, and no file names one" },
  space_roles:   { by: 'spaces-push', from: 'content/spaces/*.md' },
  teams:         { by: 'teams-push', from: 'content/teams/*.md',
                   note: 'a team is a group the site points work at — a booking type may be the team\'s. Who is IN it is team_members, which is state: a declaration names classes of people and never a person' },
  space_grants:  { by: 'spaces-push', from: 'content/spaces/*.md',   note: "the rows a file owns (source 'file'); one given to a person through space_grant_person is 'hand' and is state on the same table" },
  space_hooks:   { by: 'spaces-push', from: 'content/spaces/*/*.md', note: "a channel's `hears`" },
  provider_terms: { by: 'providers-push', from: 'content/providers.md',
                    note: "what a provider has to agree to before they may sell. The FILE is the current wording; a version anybody has signed is frozen in the database, because a signature against text that has since changed is not a signature" },
  content_search:       { by: 'search-push', from: ['content/articles/**/*.md', 'content/wiki/**/*.md', 'content/docs/**/*.md', 'content/books/*.md', 'content/store/products/*.md', 'content/pages/*.md'],
                          note: 'the search index — one row per published document, built by the same grammar the palette searches in the browser (src/lib/search-rows.js) and written by build/search-push.mjs after every build. It spans every library kind, which is why its source is a list' },
  achievements:         { by: 'achievements-push', from: ['content/achievements/*.md'],
                          why: 'what a person can earn, and what earns it — a rule, so a file' },
  trait_rules:          { by: 'achievements-push', from: ['content/traits.md'],
                          why: 'what the site takes an event to mean about somebody — a rule, so a file' },
  space_flair:          { by: 'spaces-push', from: ['content/spaces/*.md'],
                          note: 'what a space says people may wear: the slug, the name, the colour and the glyph. Who HOLDS one is space_member_flair, which is state' },
  comment_subjects:     { by: 'comments-push', from: ['content/events/*.md', 'content/articles/**/*.md', 'content/wiki/**/*.md', 'content/docs/**/*.md', 'content/books/*.md', 'content/store/products/*.md', 'content/comments.md'],
                          note: 'what may be commented on and by whom — projected so one policy answers for every kind without knowing what any of them is' },
  bots:                 { by: 'bots-push', from: 'content/bots/*.md', note: 'the table exists so a surface can name the bots it may summon; the worker reads the compiled file rather than this, so there is one copy of what a bot is and it is the file' },
  calendar_events:      { by: 'events-push', from: 'content/events/*.md' },
  calendar_occurrences: { by: 'events-push', from: 'content/events/*.md', note: 'expanded from each event\'s repeat over a rolling year by build/events-push.mjs; one somebody is coming to, or one called off by hand, survives a rewrite because those are acts' },
}

/* what people did, and what the machine keeps for itself */
/*
 * DERIVED, which is the third answer and neither of the other two.
 *
 * A projection has a source in `content/` and a script that makes the database agree with it, and it
 * must be there after a reset or the site is missing something. A derived table is a CACHE: it is
 * made from what is already here, an empty one is a correct state, and whatever reads it has an
 * answer without it. Nothing is lost by dropping it.
 */
export const DERIVED = {
  network_repo_blocks: 'a joined member\'s signed repository, made by the atproto function from their public rows; made again from nothing, it holds the same records',
  network_commits: 'where each of those repositories stands — its latest commit',
  compiled: 'the compiled artefacts — the catalog, the forms, the funnels — for a deployment that cannot rebuild to ship them as files (cloud mode with git out of the cycle and no deploy hook). Written by a publish, read only by the Edge Functions, and empty everywhere else: a function with no row reads the file the deploy shipped, which is what it did before this existed',
}

export const STATE = {
  /* foundation */
  app_settings: 'where the functions are and the key they are called with, written by the deploy; cloud mode\'s token',
  profiles: 'an account',
  user_docs: 'what one person wrote',
  /* cloud mode's own store — the projection of content/, and the drafts on it */
  content: 'cloud mode holds every content file as a row: the projection of the repository, not a second source',
  content_drafts: 'a draft nobody has published',
  /* the instrument */
  answers: 'what somebody answered',
  results: 'what that came to',
  signals: 'what it says about them',
  /* forms */
  form_responses: 'somebody filled it in',
  form_answers: 'what they put',
  form_webhooks: 'a subscription somebody made — a deployment may also SHIP one, and those carry source = file',
  /* analytics */
  events: 'what happened',
  /* commerce */
  purchases: 'somebody paid',
  subscriptions: 'somebody is paying',
  entitlements: 'what that got them',
  usage_events: 'what a person and an assistant spent, in measured usage',
  usage_grants: 'the units a payment or subscription period gave somebody',
  usage_meter_reports: 'whether recorded overage reached the selected provider or was settled with a PlatformKit renewal, and when safe retries end',
  usage_reservations: 'prepaid units held for in-progress billable work',
  usage_topup_preferences: 'a reader’s own automatic top-up choices and consent',
  usage_topup_attempts: 'idempotent automatic top-up charges and their grant state',
  usage_inference_attempts: 'each assistant call that will be billed, before and after it ran',
  usage_incremental_settlements: 'the payment taken for overage as it built up, and its recovery when it needed the customer',
  payment_provider_refs: 'which provider object stands for which customer, subscription or order',
  payment_events: 'the provider event ids already handled, so nothing is handled twice',
  payment_subscription_renewals: 'a renewal PlatformKit charged itself, claimed so it is charged once',
  orders: 'what somebody placed',
  order_items: 'what was on it, at each version it has had',
  order_transactions: 'money in and out of it',
  fulfilments: 'something on its way to somebody',
  fulfilment_items: 'which lines went in which parcel',
  returns: 'something on its way back',
  return_items: 'which lines came back, and whether they can be sold again',
  stripe_events: 'the ids already handled, so nothing is handled twice',
  /* STOCK IS STATE, AND THE FILE MAY NOT SAY HOW MANY. If the database were deleted and the
     repository redeployed, the count must not come back as five: a file says a variant is
     TRACKED, a row says how many. That is why there is no `stock:` frontmatter field for
     anybody to write, and why this is here rather than in the projected list. `available` is
     stocked less reserved and is never stored — see 41-inventory.sql. */
  inventory: 'how many are left, which nothing but a sale, a return or a stock take may change',
  inventory_movements: 'why each count moved, so a count that has drifted can be read back',
  /* A BUDGET IS A PROMISE ABOUT THE FUTURE; only a row can say how much of it is gone. If the
     database were deleted and the repository redeployed, a half-spent campaign must not come
     back with its budget full — which is exactly what a `used:` field in a file would do. */
  promotion_usage: 'how much of a discount\u2019s budget has gone',
  promotion_uses: 'every time one was allowed, so a budget that has drifted can be read back',
  /* the coaching chat */
  conversations: 'two people',
  conversation_members: 'where each of them has read to',
  messages: 'what they said',
  message_reactions: 'what they thought of it',
  /* sessions */
  bookings: 'a time somebody took',
  booking_checkout_fulfilments: 'the one paid Checkout fulfillment attempt for a session booking',
  provider_schedules: 'a host\'s own sets of hours, keyed to an account — a type\'s DEFAULTS are declared instead, and asks for a set BY NAME',
  provider_overrides: 'a day they changed',
  provider_ooo: 'a stretch of days somebody said they would be away — an act with a date on it, and their own',
  team_members: 'who is in a team — swept in by the file\'s rule, or invited; an invitation survives a change to the rule, which is why the row says how they came to be there',
  booking_holds: "whose time a booking takes — one row per person it takes, because a booking may take more than one and an exclusion constraint can only refuse what it can see in a row",
  session_reminders: 'what has already been sent',
  scheduling_webhooks: 'a subscription somebody made',
  /* emails */
  email_log: 'what was sent to whom',
  email_links: 'the token a link is',
  email_events: 'an open, a click',
  funnel_members: 'where somebody has got to',
  /* the support desk */
  support_contacts: 'who wrote in',
  support_conversations: 'a thread',
  support_messages: 'what was said',
  support_agents_seen: 'who was at the desk',
  support_webhooks: 'a subscription somebody made',
  /* push */
  push_subscriptions: 'one browser said yes',
  /* social publishing */
  social_publisher_grants: 'who may publish for this site and what happened to their invitation',
  social_publisher_account_permissions: 'which actions an active publisher may take for each connected account',
  social_provider_configs: 'the configured provider application, with its secret held separately in Vault',
  social_backend_configs: 'the enabled managed publishing routes and their Vault-held credentials',
  social_accounts: 'a social account connection and the Vault reference for its tokens',
  social_oauth_states: 'a short-lived, single-use provider authorization started by a publisher',
  social_posts: 'the authored words and time zone for a social post',
  social_attachments: 'the private media attached to a social post',
  social_deliveries: 'one scheduled or published attempt for a post/account pair',
  social_delivery_attempts: 'the durable record of each provider delivery attempt and its outcome',
  social_metrics_snapshots: 'the provider-supported measurements observed for a delivery at a point in time',
  social_automations: 'an authorized publisher\'s account-scoped keyword rule',
  social_inbound_events: 'verified provider conversation activity awaiting processing',
  social_automation_responses: 'a generated reply for one event, destination and delivery state',
  /* the API */
  api_keys: 'a credential is issued, never declared — and only its hash is kept',
  /* THE MATRIX SURFACE'S THREE. A session is an act somebody took in a client; where they have read
     to is an act too, and theirs alone; and an attempt at the door is a fact about a minute that
     has passed. Drop them all and every client signs in again, which is the test for state. */
  matrix_sessions: 'somebody signed a Matrix client in — and it holds a refresh token, so the table has RLS on with no policies and only the service role reaches it',
  matrix_read: 'where a Matrix client has read to, which is that person\'s own and separate from where our own client has',
  /* ENCRYPTION'S FOUR, and every one of them state by the same test. A DEVICE is an act: somebody
     signed a client in on a laptop. Drop them all and every reader sets a device up again — and
     the messages already sealed become unreadable, which is the guarantee WORKING and not the
     guarantee failing. There is no file anywhere that could bring a private key back, because
     there is no file anywhere that ever had one. */
  space_devices: 'somebody signed a client in on a device, and it published that device\'s public keys',
  space_one_time_keys: 'a device uploaded keys for correspondents to claim — each claimable exactly once, which is a property of the delete',
  space_to_device: 'a room key on its way from one device to another, queued and deleted once delivered',
  space_key_backups: 'a reader\'s own sessions, sealed under a recovery key this database has never seen and cannot read',
  api_rate: 'how many requests a key or an address has made in this second and this hour — a counter the doors share because an isolate\'s memory is not shared; swept, never declared',
  matrix_login_attempts: 'what the door has been asked, for the hour\'s cap — swept, never declared',
  content_webhooks: 'a subscription somebody made',
  storefront_carts: 'a bag somebody is filling',
  /* spaces: everything about a person, and everything anybody said */
  space_members: 'a fill rule made it, or somebody was invited',
  space_member_roles: 'somebody was given a role',
  channel_members: 'in the room, and how far they have read',
  space_messages: 'what was said',
  space_mentions: 'who was named',
  provider_terms_signed: 'somebody agreed to a version of the terms — an act, and the record of what they agreed to',
  provider_offerings: "what one provider sells of their own. A declaration names classes of people and never a person, so this cannot be a file: it is Ada's ninety minutes, and it is hers to write",
  payout_rules: 'what the business has agreed to pay somebody — set by an administrator, never by the person it pays',
  payout_lines: 'what was owed, for what, and what has since happened to it. Written when a rule fires and never edited, because "why is this number what it is" must have an answer that is a list rather than a re-derivation',
  payout_accounts: "the account a person connected for their own money — a reference the processor gave us and nothing else: no card, no bank details, not ever",
  reactions: 'what they thought of it — a comment or a message, one table for both',
  votes: 'whether it was worth reading — up or down, one per person',
  space_poll_votes: 'how one person answered a question the room was asked — an act, and one that could not be reproduced from any file',
  space_saved: 'what one person kept',
  /* a pin is an ACT — somebody put it there, and the row says who and when. A file could say
     "this room has rules"; it could not say which message is the rules. */
  space_pins: 'what a moderator pinned to a room',
  space_member_flair: "who wears a piece of flair — a fill rule, a moderator's hand, or the platform's own events. A declaration names classes of people; only a row names a person",
  space_mutes: 'what a person has asked not to hear — a room, a space, or somebody',
  /* a decision already made, waiting for its hour. A file could not hold it: it names a person,
     a room and a minute, and it is gone the moment it has happened. */
  space_scheduled: 'a message somebody wrote now to be sent later',
  desk_done: 'what one member of staff has finished with',
  agent_runs: 'one thing a bot was asked to do: its state, what it has spent, whether somebody called it off — the row IS the loop, which is what makes a run survive the worker that was taking it',
  agent_steps: 'every step a run took, with what it cost — a model call, a tool call, or the saying of an answer',
  copilot_threads: 'a conversation somebody had with an assistant — state and theirs, written under their own session: nothing in any file declares it, and if the database were rebuilt from the repository it must not come back',
  copilot_lines: 'the lines of one of those conversations — state, theirs, append-only, and policed by the same user_id the thread carries so a line needs no join to be read safely',
  copilot_memory: 'what a person TOLD an assistant, where its file says it recalls — state and not a projection, because if the database were deleted and the repository redeployed this must not come back: it is what somebody said, not something a file declares. Theirs to read and theirs to delete, written only by the platform',
  copilot_sessions: 'the short-lived ceiling for one signed spoken conversation, keyed by its unguessable room and written only by the service role',
  support_tickets: 'a piece of work the desk is carrying — raised by somebody, or noticed by the staff; it outlives the conversation it came from',
  support_ticket_assignees: 'who is on one, one row each because two people working a ticket together is ordinary',
  support_ticket_events: 'everything that happened to a ticket, in one column: what was said, what was noted, and every change of state',
  support_ticket_links: 'which conversations a ticket came out of — many to many, because one chat throws up several and a ticket outlives any of them',
  comments: 'what somebody said, about anything — an event, an article, a book. The subject is a kind and an id, so a new commentable thing needs no table and no policy of its own',
  event_reminders: 'what has already been sent, so a rerun never reminds anybody twice',
  calendar_rsvps: 'who said they are coming to one occurrence of an event, and whether they came',
  user_achievements: 'what somebody has earned — a fact about a person, written once by the event stream and never edited',
  user_traits: 'what the site has come to believe about somebody from what they did — an act of theirs, noted',
  space_requests: 'somebody asking to be let into a space, what they answered and who said yes — an act, never a rule',
  space_invites: 'an invitation somebody made, and how many have used it — an act, and the one way into a space that no rule describes',
  space_moderation: 'every act of moderation: a report, a message removed, a member muted or removed. Each names a person and a moment, and none of it could be reproduced from a file',
  /* THE SOCIAL NETWORK (93-network.sql). Every row is something a person did — posted, followed,
     liked, blocked — so all of it is state; no file declares a post, and a database rebuilt from the
     repository must not bring one back. */
  network_identities: 'the portable identity made for somebody who joined the wider network, and where its key is kept — made by their own act',
  network_posts: 'what somebody posted, and who they said may read it',
  network_likes: 'a like — the liker\'s own record',
  network_reposts: 'a repost — the reposter\'s own record',
  network_follows: 'who follows whom — the follower\'s record',
  network_blocks: 'who has shut whom out — the blocker\'s record',
  network_mutes: 'who somebody has asked not to hear from — private, and never a record anybody else reads',
  network_pins: 'which spaces somebody has pinned into their timeline',
  network_seen: 'when somebody last looked at what happened to them',
  network_moderation: 'every act of moderation on the network: a report, a post removed, a person suspended, a suspension lifted',
  network_app_passwords: 'a password somebody made for another app — kept only as a hash',
  network_sessions: 'a session of another app, backed by one the auth server issued',
  network_login_attempts: 'wrong app passwords an address has tried, so a guesser can be stopped',
  network_prefs: 'what another app keeps for somebody — their own settings, meaning nothing to the site',
  network_seq: 'every event the wider network has been told, numbered — a relay keeps its place by the number, so it must not come back different',
  network_dirty: 'whose public records changed since their repository was last made',
}

export const pendingOf = (name) => (DECLARED[name] && DECLARED[name].pending) || null
export const isDeclared = (name) => Object.prototype.hasOwnProperty.call(DECLARED, name)
export const isState = (name) => Object.prototype.hasOwnProperty.call(STATE, name)
