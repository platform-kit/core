# PlatformKit Features

This is an inventory of features built into PlatformKit Core and its default theme. It is organized by the modules and product surfaces a site owner can actually select and use, with the user-visible sub-features listed under each.

PlatformKit is configurable: the generic demo exercises the built modules it enables, but an individual site may switch modules off, use only some features, or add its own content, policies, and modules. Feature availability also depends on the chosen deployment shape, backend, and any outside provider a capability uses. A feature appearing here does not mean it is enabled or configured on every site; consult the module reference for the per-shape support matrix and its provider requirements.

## Platform-wide features

### Build scripts and command-line tools

- Develop, build, test, and deploy a selected site without turning that site into part of the PlatformKit package.
- Run the CLI from a site directory, select a site by name or path, or choose multiple workspace sites for development.
- Restart a workspace dev run after its terminal closes; the next run takes over the earlier run's site and function servers and front door, and names the resources it stopped.
- Register separately owned site repositories, fetch a pinned revision, and update to an explicitly chosen revision. Updates refuse a checkout with local changes.
- Build from a site's own repository, using its dependencies and lockfile. A site can use exact published PlatformKit packages or invoke the CLI from the public Core repository.
- Extend the build with site- and theme-provided steps. Steps have named phases, module ownership, and declared prerequisites.
- Compile content collections, page routes, search data, catalogs, emails, forms, fonts, icons, social data, and other generated site assets.
- Generate static files and prerendered pages, or run the single-page-app build where prerendering is not wanted.
- Run focused checks for schemas, content, modules, deployment modes, generated artifacts, docs, and site-specific tests.

### Modules and deployment modes

- Enable or disable kit features by module; a disabled module's routes, admin views, build steps, and related assets are removed rather than merely hidden.
- Add a site-owned or theme-owned module with its own routes, admin sections, build steps, environment needs, and deployment-mode declaration.
- Check that every module declares what it owns and what it supports in each deployment shape. Checks detect duplicate ownership and feature dependencies that cannot be satisfied.
- Choose among three deployment shapes:
  - **Static:** built files only; no live backend.
  - **Git and backend:** a repository remains the source of truth; publishing can commit changes for a new build.
  - **Cloud:** content is stored in the backend and can be published without a repository checkout or site rebuild.
- Run a docs-only site without the normal landing-page shell or sign-in requirements.

### Database, backend, and APIs

- Declare database tables, functions, policies, triggers, indexes, buckets, and other platform data as source files, then assemble them for a site.
- Reset a local database from the declarations and seed data; plan a live database update by comparing the live database with a shadow of the declared result.
- Review and guard destructive database changes before applying a plan.
- Assemble and deploy the Edge Functions used by enabled features, along with the generated catalogs, strings, templates, and other data they need.
- Provide API surfaces for content, forms, commerce, scheduling, support, community/Matrix, and the site's social network/AT Protocol, subject to the matching modules being enabled.
- Keep Stripe as the built-in compatibility default while allowing a site to register its own server-side payment adapter, secrets, webhook verification, and supported capabilities.
- Apply the same shared checkout, order, subscription, usage, and payout rules to normalized events from the selected provider; refuse unsupported operations before provider side effects.
- Provide shared request handling, authentication, permissions, webhooks, and mock providers for supported integrations.

### Admin and CMS

- Provide a single administrative workspace whose navigation and views follow the enabled modules and the signed-in staff member's role.
- List content in sortable, filterable tables; create, edit, publish, unpublish, and delete records in forms suited to each record type.
- Register site-specific admin sections and editors without changing the kit or theme.
- Edit registered content models and their entries, including single-record models, access settings, ordering, and model-specific fields.
- Preview draft content in the live site frame before publishing.
- Edit structured values through controls such as selects, checkboxes, lists, date/time pickers, and field groups instead of asking editors to type the underlying grammar.
- Edit reusable interface copy through named string groups. Theme defaults can be overridden by a site.
- Edit selected operational records, including orders, print jobs, bookings, social accounts, forms and responses, and conversations, when their modules are enabled.

### Analytics and reporting

- Record site and feature events through the site's analytics endpoint, including registered site-specific events and goals.
- Measure visits, page views, sessions, acquisition channels, campaigns, entry and exit pages, audience characteristics, and return visits.
- Filter dashboard reports by date range, visitor class, source, channel, campaign, page, device, browser, country, and language where those facts are available.
- Inspect content views and measured reading time, as well as reports for commerce, membership, forms, support, experiments, and email funnels when those features are enabled.
- Explore event and goal trends over time, compare them with the previous period, and export supported reports.
- Keep reports aggregated; analytics surfaces report counts and summaries rather than exposing lists of individual readers or answers.
- Restrict analytics data and reports to authorized administrators and analysts.

### Content editing, publishing, and media

- Store site content as structured records with validated fields and markdown bodies.
- Use one shared content pipeline for file-backed sites and backend-backed cloud content.
- Keep drafts separate from published content; unpublished records remain editable but are omitted from the public build, search, sitemap, and share-image output.
- Publish one record or a batch of pending records. In cloud mode, publishing updates live data and can push the change to the site's repository as one commit.
- Read and write content through a common store interface so build tools and the admin work with either files or backend rows.
- Manage uploads in the media library; use library assets in content and page fields, and resolve assets consistently during builds.

### Page builder and landing sections

- Build landing pages from ordered, named sections rather than hand-writing page layouts.
- Choose sections from the theme's catalogue, with groups, searchable entries, layout sketches, and multiple layouts where available.
- Edit each section through a form generated from its schema, including text, links, images, icons, lists, conditional fields, and layout options.
- Reorder sections and preview the page as it will appear; selecting a section in the builder and selecting it in the preview stay in sync.
- Use generic section families for announcements, hero layouts, marquees, features, split layouts, bento grids, steps, showcases, before/after comparisons, carousels, tabs, galleries, video, prose, timelines, dividers, logos, statistics, testimonials, quotes, comparisons, FAQs, integrations, pricing, products, collections, teams, newsletters, contact/forms, article and model-entry listings, calls to action, countdowns, closes, and footers.
- Apply shared layout controls for tone, ground, spacing, width, reveal, anchor, and glow; site-specific skins can change a section's presentation without duplicating its content.
- Validate section data both in the editor and when the server saves it.

### Theme, design, and site identity

- Use the default theme's responsive reader, admin, landing-page, store, and community interfaces.
- Set a site's look, colors, and heading/body/monospace fonts in site settings. The theme provides a working default palette; a site may register its own look.
- Change look colors through generated controls rather than editing CSS, while retaining the option to define a site-specific palette and section skins.
- Override theme components by name and register site-specific routes, navigation, page sections, admin views, content models, analytics events, and recommendations.
- Store user-facing interface text in editable content, with theme defaults and site overrides merged by group and key.
- Generate page titles, descriptions, social metadata, share images, and favicons from site settings and each page's content.
- Generate share cards for the site, content entries, store records, and landing pages; prerender public pages for crawlers when the host supports it.

## Content modules

### Articles (`articles`)

- Publish an article collection with index pages and an articles lane in the content hub.
- Give articles titles, descriptions, dates, images, tags/topics, access rules, and rich markdown bodies.
- Present article pages with shared typography, navigation, metadata, search, and share cards.
- Include only published and accessible articles in public listings and generated search data.

### Books (`books`)

- Provide a book shelf, book index pages, covers, authorship and descriptive metadata.
- Read books chapter by chapter, with a contents list, previous/next navigation, saved reading state, and access limits.
- Edit long book text by chapter so unopened chapters are preserved when one chapter is changed.
- Associate companion material with a book where the site supplies it, including chapter summaries, key points, and quizzes.
- Offer chapter audio when recordings or in-browser speech are available; see `tts`.
- Offer printed and downloadable editions when the site configures print offers; see `print` and `store`.

### Wiki (`wiki`)

- Publish a site wiki as its own content collection, with index pages and a wiki lane in the content hub.
- Organize pages by folders and explicit order; render formatted markdown with links and metadata.
- Apply publication and access rules to individual pages.
- Include published, accessible wiki pages in search, share cards, and site navigation where configured.

### Documentation (`docs`)

- Publish documentation pages with ordering, folders, navigation, and an on-page contents rail.
- Run a documentation-only site in a plain tree-and-page shell, with a collapsible navigation tree suited to phones.
- Build documentation indexes, routes, search entries, sitemap entries, and share metadata from the documentation records.
- Use the same editing and publication workflow as other content collections.

### Content models and entries (`models`)

- Define site-specific record types with fields, ordering, access rules, and optional singleton behavior.
- Create and edit entries in a generated admin section rather than building a separate CRUD interface.
- Publish entries as pages or structured data, and expose model entries to page sections and JSON endpoints.
- Control how entries are listed and ordered, and whether a model has a public page.

## Reader and account features

### Accounts and access

- Sign readers in and maintain account profiles and staff roles when a backend is enabled.
- Gate content by visitor class, such as guest, signed-in reader, purchaser, or active member.
- Provide sign-in, sign-up, account recovery, email confirmation, and role-aware admin access.
- Preserve public/static reading for sites that do not enable backend-dependent account features.

### Search and content index

- Search published content from the site's search interface, including articles, books, wiki, docs, and other registered content.
- Combine word-based matching with meaning-based discovery where the site's search model is configured.
- Filter results by content type and open matching entries directly.
- Build the reader's search data for static sites; maintain the server-side content index for APIs and bots where enabled.

### Recommendations (`recommendations`)

- Show a personalized "For You" content shelf based on a reader's available reading, purchase, or other registered signals.
- Provide recommendation panels for site-provided assessments or results pages.
- Fall back to general content where a visitor has no personal history to recommend from.

### Site-specific assessments (`instrument`)

- Supply a reusable quiz/reading runner and result-shell integration for a site's own assessments.
- Let a site register its own screens, tabs, answer formats, and results behavior.
- Save answers to the signed-in reader's account where the site enables account-backed assessments.
- Reuse the forms runner; the instrument module requires `forms`.
- PlatformKit provides the mechanics, not any one site's proprietary assessment, question bank, scoring rules, or interpretation copy.

### Comments, votes, and reactions

- Attach reader comments and voting to eligible content or community records.
- Support threaded discussion, moderation actions, and reactions where the site enables the corresponding surfaces.
- Show counts and a reader's own vote/reaction without exposing records the reader cannot access.

### Achievements and traits

- Award account-linked achievements from configured rules.
- Define traits from account activity and content-defined criteria.
- Display earned achievements and traits in the reader experiences that a site registers.

### Ads and experiments

- Create and place site-authored ads in supported inline, modal, and page placements.
- Target ad selection by configured audience/content rules.
- Run page or ad experiments with weighted variants, sticky visitor assignment, dates, and a declared or measured winner.
- Record exposures and goal events so the site can compare outcomes.

## Commerce modules

### Store (`store`)

- Publish products and collections, with product pages, collection pages, and store listings.
- Offer one-time purchases, digital products, memberships, paid forms, paid sessions, and other site-defined offer kinds.
- Provide a shopping bag, quantity controls, checkout, purchase confirmation, and an order ledger.
- Keep Markdown offers authoritative and synchronize the Stripe catalog by default; a site-owned adapter may provide catalog synchronization when it declares that capability.
- Sell product variants with named options and prices, including options refreshed from a supplier's catalogue and combinations a site defines.
- Apply configured promotions to eligible products or variants, with rules, limits, and budgets; track stock availability and hold stock during checkout.
- Fulfill physical goods and books through configured suppliers, and provide files or track print orders and delivery status where the offer requires them.
- Collect shipping destination and method for shippable goods; show order and delivery status to staff and eligible buyers.
- Support guest checkout for eligible print and file purchases; account-based products and services still require an account.
- Connect compatible commerce APIs for storefront clients and integrations.

### Memberships (`memberships`)

- Define membership tiers and recurring offers, including more than one billing period or offer per tier.
- Grant account entitlements from a live subscription and apply tier rank rules to member access.
- Let readers join, manage billing, and open the billing portal.
- Change an existing subscription in place: upgrades and same-tier plan changes take effect now; downgrades can be scheduled for renewal.
- Keep membership status and pending plan changes available to the site and its access rules.

### Printed books and downloads (`print`)

- Configure print and file formats for a book, with contents, prices or markup, rights, and format-specific options.
- Prepare interiors, covers, ebooks, previews, and print metadata from the book and its companion material.
- Compare quotes from supported print providers and select a provider per format or let the system select among configured providers.
- Set editions in storage, track edition versions, and avoid re-rendering an unchanged edition.
- Review proofs, record which edition has been proofed, and submit print orders.
- Show printed-book covers and sample pages on store listings.
- Fulfill print orders through configured printers; track status and shipping information.

### Sessions and scheduling (`sessions`)

- Define bookable session types with descriptions, eligibility, prices, membership requirements, and usage limits.
- Offer an in-app booking experience with available dates and times, confirmation, and booking status.
- Use the built-in scheduler or connect cal.com behind the same booking interface.
- Apply membership eligibility, per-period booking limits, and paid-session credits.
- Let readers reschedule or cancel eligible bookings; keep the booking record and credit state in sync.
- Send booking notices and reminders; connect video rooms and recordings where configured.
- Expose compatible scheduling API behavior for client applications.

### Events (`events`)

- Publish dated and repeating events, with occurrences expanded for upcoming schedules.
- Let community members RSVP and show who plans to attend, subject to site access rules.
- Send event reminders and show relevant events alongside the community or booking experience.

## Forms and communication modules

### Forms (`forms`)

- Build multi-slide forms from editable records, with typed fields, validation, conditional questions, answer-based branching, progress controls, and editable end pages.
- Collect text, choice, rating, date/time, file, voice, and video answers; resume an unfinished response and enforce one-answer-per-person rules where configured.
- Publish hosted form pages, embed forms on landing pages or other sites, and restrict eligible embedding origins.
- Score quiz-style forms, accept paid responses, or use a completed response to raise a support ticket.
- Review and filter responses and form analytics in the admin.
- Connect form completion to configured webhooks and analytics.
- Provide a Typeform-compatible forms API and embed interface.

### Email designs (`emails`)

- Create and edit transactional and authentication email designs in the admin.
- Compile email designs for use by the site's backend functions.
- Preview, test, and send sample messages before using a design.
- Fill approved designs with order, booking, support, authentication, or other supported event data at send time.
- Use the site's configured mail relay; email is optional only where the site does not use a mail-dependent feature.

### Funnels and campaigns (`funnels`)

- Create multi-step email funnels and one-time email blasts.
- Target recipients with audience rules based on account state, membership, purchases, activity, interests, and other supported signals.
- Schedule steps by elapsed time; apply daily/weekly/monthly sending limits, per-funnel cooldowns, and opt-out preferences.
- Resume a partially sent blast without sending duplicates.
- Use stable email identities so renamed or edited campaigns do not cause an email to be sent twice to the same person.
- Add chat-prompt steps that the browser can show when configured visit and page conditions hold.
- Review audience counts, run previews, funnel progress, delivery, opens, and clicks in the admin.

### Reader support (`support`)

- Add a support-chat launcher and panel to public pages for guests and signed-in readers.
- Keep support conversations separate from member coaching conversations.
- Give staff an inbox with assignment, status filters, unread indicators, search, private notes, and reply tools.
- Support text, attachments, voice notes, canned replies, transcripts, message withdrawal, typing indicators, and live conversation updates.
- Show prompts and choice trees from configured funnels; turn a reader's response into a support thread.
- Acknowledge the first reader message, reopen resolved threads when a reader writes again, and escalate overdue conversations by digest.
- Apply guest abuse limits and file-retention rules; avoid asking anonymous guests for an unverified identity claim.

### Coaching chat (`coaching`)

- Provide a separate member-to-coach conversation area and staff inbox.
- Keep one thread per member and coach; show unread counts, sent/read state, and recent activity.
- Support text, voice notes, reactions, replies, and message withdrawal.
- Send an away email when appropriate and suppress duplicate notices while the other person is active.
- Show response-time expectations to coaches where the member's plan defines them.

### Staff browser notifications (`push`)

- Let each staff browser opt into selected notification topics.
- Send notifications for supported events such as new support conversations, purchases, accounts, memberships, and bookings.
- Test notifications from admin settings and remove expired browser subscriptions.

## Community and social modules

### Spaces (`spaces`)

- Create public or private community spaces and rooms; allow open joining, requests, invitations, or membership rules based on account roles, tiers, and purchases.
- Organize rooms into groups and choose conversation, forum, or feed presentation; support direct messages, threads, mentions, reactions, polls, files, voice, moderation, and huddles where configured.
- Show community directories, member profiles, welcome rooms, and selected feeds or events on community pages.
- Allow event and RSVP features when the related module is enabled.
- Connect the community through Matrix-compatible APIs and clients.

### End-to-end encrypted channels (`space-encryption`)

- Mark a space or channel as end-to-end encrypted, with encryption keys held on members' devices.
- Encrypt supported message and attachment content so the server cannot read it.
- Keep encryption an explicit option separate from spaces.
- Encrypted channels do not support server-side search, bots, or moderation of message contents.

### Member social network (`network`)

- Give members profiles and follow relationships, with timelines and posts that support replies, quotes, likes, and reposts.
- Set post audiences, including public, site-member, and eligible space-member audiences.
- Provide notifications, blocks, mutes, and moderation tools.
- Serve compatible AT Protocol endpoints so AT Protocol clients can use the site's network; federation is a site configuration choice.

### Social publishing (`social-publishing`)

- Connect supported social accounts and invite publishers with appropriate access.
- Draft posts, attach media, schedule delivery, and review delivery status.
- Manage the connected accounts and publishing queue in the admin.
- Receive supported provider comments and direct messages, and use account-scoped publisher permissions to review or send responses.
- Configure keyword-triggered bot responses to supported provider comments or direct messages, with review-first or automatic delivery modes.

## Automation and assisted content modules

### Bots, tools, and commands (`bots`)

- Define task-oriented bots, their prompts, skills, audiences, tools, and limits as site content.
- Run durable, resumable, cancellable agent tasks with stored progress and budget controls.
- Let bots use declared tools and commands, including scheduled or event-triggered runs.
- Limit a run to data the requesting person is authorized to see.
- Configure model providers; where no model provider is configured, supported scripted responses can still run.
- Review bot definitions, grants, runs, and schedules through the admin surfaces provided by the site.

### Spoken assistant (`copilot`)

- Provide a voice-oriented interface to the bot system through a signed access grant.
- Support spoken input/output and a compatible chat-completions interface.
- Allow a bot to recall a person's saved information when the bot and site explicitly enable that behavior.
- Requires the `bots` module; it does not define a separate bot engine.

### Spoken books (`tts`)

- Play recorded chapter audio when a recording is available.
- Generate missing chapter audio in a compatible reader's browser, cache completed audio, and resume playback from the reader interface.
- Support locally generated recordings and a shared audio bucket where configured.
- Keep book reading available when audio is absent or the device does not support in-browser generation.

### Editorial enrichment (`enrichment`)

- Run assisted workflows for book introductions and companion material, including chapter summaries, key points, and quizzes.
- Cache stages so unchanged source material does not need to be processed again.
- Check generated material for missing source ideas and errors, and keep a reviewable result before it is written.
- Run enrichment only when explicitly requested with a configured provider; it is not part of ordinary site builds or reading and may incur provider charges.

## API surfaces

APIs are enabled with their owning feature rather than being a separate promise that every endpoint is present on every site.

- **Content API:** read and manage supported content collections through a Contentful-compatible interface.
- **Forms API:** create and manage forms and responses through a Typeform-compatible interface.
- **Store API:** read offers and operate carts through a Shopify-compatible storefront interface.
- **Scheduling API:** expose booking types, availability, bookings, and supported booking actions through a cal.com-compatible interface.
- **Support API:** let the support widget and authorized staff work with conversations through the support function.
- **Matrix API:** connect Matrix clients to eligible community spaces.
- **AT Protocol:** let compatible clients use the site's social network when `network` is enabled and configured.

## Explicitly not a built feature

- **Translation (`translation`):** reserved in the module manifest, but not implemented. It is not included in the feature inventory above.

For the project's objectives and intended audience, see [PURPOSE.md](./PURPOSE.md). For the capability comparisons, see [COMPETITORS.md](./COMPETITORS.md). For usage instructions and constraints, see the [PlatformKit documentation](../sites/docs/content/docs/what-platformkit-is.md) and the [module reference](../sites/docs/content/docs/building-a-site/modules.md).

---

**Sources:** `openspec/specs`, `packages/kit/build/modules/kit.mjs`, `packages/kit/build/modes.mjs`, `packages/kit/build`, `packages/kit/supabase`, `packages/kit/src/lib`, `packages/kit/src/payment-provider.mjs`, `packages/kit/src/payment-provider.d.ts`, `packages/movable-types/src`, `sites/demo/platformkit.config.js`
