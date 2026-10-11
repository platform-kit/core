---

title: Glossary
description: The words these docs use, in one place.
order: 3
sources: [packages/kit/build/site.mjs, packages/kit/src/lib/router.js, packages/movable-types/src/pages/AdminPage.vue]
reviewed: 2026-10-11
---

**Site.** One installation of the platform: a config file, a folder of content, a palette, and whatever it registers on top. Northlight Press (the demo) is a site; this documentation is a site.

**The kit.** `@platform-kit/kit` — everything with no pixels: the content pipeline, the build, the database, the store, memberships, chats, funnels, emails, print production, spoken books, the deploy, the command line.

**The theme.** `@platform-kit/movable-types` — everything somebody or an editor sees: every page, component, screen and stylesheet. A site may replace any piece of it by name.

**Form.** A forms.md document under `content/forms`: slides, fields, conditions and bindings, run by the kit's runner on its own page, on a landing page or embedded on another site, every answer kept as it is given. See [Forms](/content/docs/running-a-site/marketing/forms).

**Deployment shape.** Which of three a site is, declared in its config as `deployment: { backend, content, repo }`: **static** (a build and a static host, no Supabase, deployed CMS or authentication), **git** (a repository and a backend; content may be files or rows, and publishing commits and rebuilds), **cloud** (a backend and no repository; Supabase rows are the source of truth and nothing rebuilds). A backend site with row-backed content includes its production CMS whether or not it has a repository. See [The three deployment shapes](/content/docs/building-a-site/deployment-modes).

**Row-backed content.** Content stored in Supabase rows rather than files (`CONTENT_STORE=cloud`): the production CMS is included and published edits become live. When a repository is in the publish cycle, those edits are committed back to it and rebuilt; without a repository, the rows are the only source. See [Cloud mode](/content/docs/running-a-site/settings/cloud-mode).

**Content model.** A kind of content of the site's own — teachers, events — defined in the admin as fields with kinds and rules, its entries markdown under `content/models/<key>/`, its pages under `/c/<key>`. See [Content models](/content/docs/running-a-site/content/content-models).

**Module.** A part of the platform a site can switch on or off in its config: the store, print, memberships, sessions, coaching, support, social publishing, spaces, events, funnels, emails, forms, models, the instrument, recommendations, translation, tts, enrichment, push. Off means gone — the pages, the nav link, the admin sections, and the settings the deploy would otherwise demand.

**The admin.** The surface at `/admin`: local development has the full CMS; production has content editors when content is row-backed, plus live views allowed by staff role. A static deployment has no deployed admin or authentication.

**Collection.** One kind of content: articles, wiki, docs, books, companions, ads, products, collections (of products), pages, sessions, experiments, funnels, blasts, email designs. Each is a folder of files under `content/`.

**Published.** The switch every record carries. Off, the file stays on disk and in the admin and is left out of the build.

**Frontmatter.** The block of fields at the top of a markdown file, between `---` lines. The admin edits these as form fields; a developer may edit them by hand.

**Look.** A palette: one CSS file of colour and font tokens the whole design wears. A site names its looks in the config and picks one in Site settings.

**Landing page / section.** A page of the site (`/`, `/pricing`, `/about`…) built from an ordered list of sections — Hero, How, Pricing, Close and so on — each with its own fields, arranged in the page builder.

**Strings.** Every word of the interface — labels, buttons, empty states, prompts — kept in markdown files under `content/app/ui/`, one per scope, and edited under Settings → UI strings. The theme ships defaults; a site changes only the words it wants to.

**Companion.** A book's second file: a summary, the key ideas and a five-question quiz for every chapter, plus the one-line insight shown wherever the book is recommended.

**Highlight (a mark).** An editorial underline baked into a book's text, colour-coded by theme, distinct from a person's own highlights.

**Edition.** One printed or downloadable version of a book: which contents, at which trim, with which cover — made by the build, kept in a private bucket, sold through the store.

**Offer / sku / key.** What the store sells. The sku is the slug (the product's address); the key is its permanent identity, eight characters given once and never edited, which Stripe and every purchase are attributed by.

**Tier.** A membership level. Any number of offers (weekly, monthly) may belong to one tier; a higher rank includes everything below.

**Session.** A coaching call, booked in the app through the native scheduler or cal.com; `sessions` the module that offers them. A site may require sign-in or allow guest booking, while each session's own access rule still applies.

**Coaching chat.** The members' chat with the coaches, one thread per member per coach.

**Support desk.** The support chat for guests and account holders — a widget on every public page, an inbox for the staff — kept entirely apart from coaching.

**Funnel / blast / prompt.** A funnel is a sequence of emails sent to an audience over days; a blast is one email sent once; a prompt is a funnel step that appears as a chat popup in the browser instead of an email.

**Audience.** The rules that pick who a funnel or blast goes to, written from what the account knows: how long inactive, what was bought, the membership tier, what was read.

**The plan.** What brings a database to the declared schema: the renames, the diff, the data script. Computed by `platformkit migrate --plan`, applied by the deploy.

**The declaration.** The database's schema as files describing its end state — never a migration.

**Supabase.** The hosted Postgres, auth, storage and edge functions the platform runs on. Locally a copy runs in Docker.

**Edge function.** A small server-side program (Deno) run by Supabase: the checkout, the webhooks, the support chat's door, the emails, the push notifications.

**Instrument.** A site's own module for readings (the diagnostics, the personality and word tests), their scoring and their results sheet. A site may have one, or none.

**OpenSpec.** The way a change to the platform is proposed, built and verified: a proposal read before code, spec deltas, tasks, a verification report.
