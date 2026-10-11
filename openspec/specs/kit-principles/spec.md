# kit-principles

## Purpose

What PlatformKit is for, who it serves, how it is opinionated, and what it replaces. The spec every kit spec answers to, as `product-principles` is for a site. Where this is silent, the answer is a question for James; where a kit spec disagrees with this, this wins.

## What it is

PlatformKit is an open-source toolkit for running a content, publishing, coaching or membership business on one site: the content system, the paid membership, the shop and the printed book, the support chat, the newsletter and the funnels, the analytics, the search, the page builder — built once, under one roof, with a default theme that covers most of what such a business needs on the day it launches. A person adopts it to be in the business of creating and managing, not of building the generic infrastructure underneath.

It is publishing-first: the reader, the book, the newsletter, the paid chapter come first, and SaaS shapes (a product with accounts and plans and nothing to read) are supported and will be more so. Its nearest neighbour on the SaaS side is a starter kit like ReadyKit; the difference is that PlatformKit is a running product with a theme, not a starting point.

## How it is opinionated

Laravel's kind of opinion: **convention over configuration, and a small number of strong conventions rather than a large number of options.** A site is content in markdown plus one config file; every service (payments, calendar, printers, mail, push) is made to match the files, never consulted for what the files say; every reader-facing string is markdown; structured data is edited as fields; a concept with its own lifecycle is its own record; identity is the account; UI is looked at before it is shown; a deploy that cannot succeed is refused before it starts. Someone who accepts the conventions gets everything working together; someone who fights them will find the kit in the way, on purpose.

Batteries included, every battery replaceable: each module works out of the box with the default theme, and each can be switched off, or any piece of it overridden by name, without touching the kit.

## What it replaces

The comparables, and which module carries each one's core job. A module documents what it deliberately does not do that its comparable does.

| instead of                                     | the kit's module                              | what it does                                                                                             |
| ---------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| WordPress                                      | content collections, the admin CMS, the theme | pages, articles, books, wiki and docs as markdown; an admin that edits them as forms; a theme system     |
| Contentful, Sanity, Strapi | content models, content API | content types defined in the admin as fields with kinds and rules; entries as markdown with frontmatter, edited as forms; delivered as data, plain pages, static JSON or a landing section, as each model says — and served over Contentful's own Delivery, Preview, GraphQL, Sync and Images APIs — and, in cloud mode, written through its Management API with its webhooks — with keys, so a Contentful client works with the host swapped, reading and writing |
| Laravel Spark, Memberstack                     | memberships, auth                             | tiers with ranks, subscriptions switched up now and down later, the billing portal, roles                |
| Ghost, Substack                                | memberships, the reader, funnels and blasts   | free and paid content by chapter allowance; a newsletter to the audience, on site and by email           |
| Shopify, BigCommerce, Gumroad | store | products, a bag, checkout with shipping chosen first, guest checkout, downloads, orders — the store served over Shopify's own Storefront API (products, collections, the cart, a checkout url into the site's bag) with a public token, so a headless storefront and Shopify's storefront client work with the domain swapped |
| Blurb                                          | print editions, print production              | a book typeset, covered and quoted by the build; printed to order and shipped by a printer plug-in       |
| Crisp, Chatwoot, Intercom | support chat, coaching chat | an embedded chat for guests and readers with an inbox, prompts, escalation; a members' chat with coaches — the desk served over Chatwoot's own Client and Application APIs with webhooks and keys, and Chatwoot's website snippet mounting the site's widget on any page, so anything written for Chatwoot works with the base changed |
| Slack, Microsoft Teams, Discord | spaces | the business's own chat: spaces whose membership is a role or a tier, channels read as a stream or a forum, direct messages, threads, mentions that decide the notification, search, huddles, a channel that may be end-to-end encrypted, and operations channels the platform writes into — an order, a failed print job, an escalation are the database's own messages, not an integration — and the whole of it served as a **Matrix homeserver's Client-Server API**, so Element, FluffyChat, Nheko and any other Matrix client sign in and read the site's rooms with the host swapped, on every platform, without the kit shipping an application of its own |
| Circle.so, Mighty Networks, Skool, Discourse | spaces, network, memberships | a community for the site's members: the tier that was bought is the membership of the space, channels per book, topic or cohort read as chat, a forum or a feed, the space's feed pinnable in any atproto client, and a member's card showing what they have read, scored and bought |
| Bluesky, Mastodon | network | the site's own social network: every member a page, follows, a timeline, posts with likes, reposts, replies and quotes, each post to everyone, to the site's own people or to a space's members — closed to the site's people by default, joined to Bluesky's network by the site's switch and each member's consent — the whole of it served as an atproto server and app view, so Bluesky's app and any atproto client sign in with the host swapped |
| Calendly, Acuity, cal.com | sessions | booking inside the app on the site's own calendar (a coach's hours, seats, notice, reminders and invitations) or on cal.com's engine, under the site's own judge of what a plan allows — the sessions served over cal.com's own API v2 with webhooks and keys, so cal.com's embed and anything written against its API work with the host swapped |
| Zoom, Google Meet, Daily | sessions | a video room on the site for a booked call or a channel’s huddle — on LiveKit where the site has an account, recorded into the site’s own storage, and browser to browser with no account and nothing to configure where it has none; or a link to a room elsewhere |
| Mixpanel                                       | analytics, recommendations                    | events as the record, dashboards, audiences from what the account knows, personalisation signals         |
| ActiveCampaign                                 | funnels                                       | drip sequences targeted by rules, cooldowns, once-ever per email, chat prompts as steps                  |
| Mailchimp                                      | blasts, emails                                | one-off sends to an audience, designs built in the admin, tracked links, unsubscribe                     |
| Wikipedia, Read the Docs, Docusaurus, Mintlify | wiki and docs collections, search             | reference content with its own index and navigation                                                      |
| Algolia                                        | search                                        | semantic and text search built at build time, instant in the browser, no service                         |
| Elementor, Plasmic, Builder.io | page builder, experiments | landing pages from a catalogue of some forty sections with schemas and layouts — openers (an announcement, a hero that takes any visual, a marquee), content (features, a split, a bento, steps, a showcase, before/after, a carousel, tabs, a gallery, a video, prose, a timeline, a divider), proof (logos, stats, testimonials, a quote, a comparison, an FAQ, integrations), commerce (pricing, perks, products, a spotlight, collections), people (a team, a newsletter, a contact block, a form), the site's own data (articles, a model's entries), closers (a call to action, a countdown, the close, a footer) — each a form in the admin with one look fold (tone, glow, ground, spacing, width, reveal), drawn in the site's look; A/B tests as their own records |
| Typeform, SurveyMonkey, forms.md | forms, and instrument over it | a general-use form builder: a form is a forms.md document (its field kinds, slides, logic jumps, bindings), run by the kit's own runner in the site's design, written by a builder that never shows the grammar, with the backend forms.md lacks — every answer a row as it is given, files in a bucket, a webhook, responses and analytics in the admin — on its own page, embedded, or on a landing page; and, over it, the quiz-scoring / IRT instrument: screens drawn from a bank, scored by the site's registered graders — the forms served over Typeform's own Create (read), Responses, Webhooks and Insights APIs with keys, so Typeform's client and embed work with the host swapped |
| ElevenLabs, Audible's pipeline                 | spoken books                                  | every chapter spoken locally, cached by its text, generated in the browser when missing                  |
| Weglot, Lokalise                               | translation                                   | every language as files, audited, served statically per route                                            |
| OneSignal                                      | staff notifications                           | web push per browser per topic, asked by the database                                                    |
| Auth0, Clerk                                   | auth                                          | sign-in, staff roles, the app's own confirmation of an address                                           |

## Requirements

### Requirement: Publishing first, SaaS supportable

The kit SHALL serve a content, publishing, coaching or membership business completely with its default theme, and SHALL run a site with no content to read (accounts, plans, a store) without a module that does not apply getting in the way.

#### Scenario: a SaaS-shaped site

- **WHEN** a site declares memberships and the store on and the reader, print, instrument and spoken books off
- **THEN** the site serves, the deploy asks for nothing the off modules need, and no page names reading

Verified by: the demo run in that configuration in the kit's CI

### Requirement: Convention over configuration

A site SHALL be launchable from content and one config file with no code; every convention in `product-principles`' engineering stance SHALL hold in the kit; a site that needs to break one SHALL find the kit refuses rather than bends.

#### Scenario: from clone to a business

- **WHEN** the demo is cloned, its environment set and `platformkit deploy` run
- **THEN** a working business — content, membership, store, chat, newsletter — is live with no code written

Verified by: the demo's deploy in the kit's CI (NOT VERIFIED until phase 5)

### Requirement: Every comparable's core job is a module with a switch

Each row of the comparables table SHALL be carried by a named module that works out of the box, can be switched off whole, and documents in its spec what it deliberately does not do that the comparable does. The Typeform row SHALL read: **instead of** Typeform, SurveyMonkey, forms.md — **the kit's module** forms, and instrument over it — **what it does** a general-use form builder: a form is a forms.md document (its field kinds, slides, logic jumps, bindings), run by the kit's own runner in the site's design, written by a builder that never shows the grammar, with the backend forms.md lacks — every answer a row as it is given, files in a bucket, a webhook, responses and analytics in the admin — on its own page, embedded, or on a landing page; and, over it, the quiz-scoring / IRT instrument: screens drawn from a bank, scored by the site's registered graders — the forms served over Typeform's own Create (read), Responses, Webhooks and Insights APIs with keys, so Typeform's client and embed work with the host swapped. `instrument` SHALL require `forms`. The table SHALL carry a Contentful row, after the WordPress row, reading: **instead of** Contentful, Sanity, Strapi — **the kit's module** content models, content API — **what it does** content types defined in the admin as fields with kinds and rules; entries as markdown with frontmatter, edited as forms; delivered as data, plain pages, static JSON or a landing section, as each model says — and served over Contentful's own Delivery, Preview, GraphQL, Sync and Images APIs — and, in cloud mode, written through its Management API with its webhooks — with keys, so a Contentful client works with the host swapped, reading and writing. The Shopify row SHALL read: **instead of** Shopify, BigCommerce, Gumroad — **the kit's module** store — **what it does** products, a bag, checkout with shipping chosen first, guest checkout, downloads, orders — the store served over Shopify's own Storefront API (products, collections, the cart, a checkout url into the site's bag) with a public token, so a headless storefront and Shopify's storefront client work with the domain swapped. The Crisp row SHALL read: **instead of** Crisp, Chatwoot, Intercom — **the kit's module** support chat, coaching chat — **what it does** an embedded chat for guests and readers with an inbox, prompts, escalation; a members' chat with coaches — the desk served over Chatwoot's own Client and Application APIs with webhooks and keys, and Chatwoot's website snippet mounting the site's widget on any page, so anything written for Chatwoot works with the base changed. The Elementor row SHALL read: **instead of** Elementor, Plasmic, Builder.io — **the kit's module** page builder, experiments — **what it does** landing pages from a catalogue of some forty sections with schemas and layouts — openers (an announcement, a hero that takes any visual, a marquee), content (features, a split, a bento, steps, a showcase, before/after, a carousel, tabs, a gallery, a video, prose, a timeline, a divider), proof (logos, stats, testimonials, a quote, a comparison, an FAQ, integrations), commerce (pricing, perks, products, a spotlight, collections), people (a team, a newsletter, a contact block, a form), the site's own data (articles, a model's entries), closers (a call to action, a countdown, the close, a footer) — each a form in the admin with one look fold (tone, glow, ground, spacing, width, reveal), drawn in the site's look; A/B tests as their own records. The Calendly row SHALL read: **instead of** Calendly, Acuity, cal.com — **the kit's module** sessions — **what it does** booking inside the app on the site's own calendar (a coach's hours, seats, notice, reminders and invitations) or on cal.com's engine, under the site's own judge of what a plan allows — the sessions served over cal.com's own API v2 with webhooks and keys, so cal.com's embed and anything written against its API work with the host swapped. The Zoom row SHALL read: **instead of** Zoom, Google Meet, Daily — **the kit's module** sessions, spaces — **what it does** a video room on the site for a booked call or a channel's huddle — on LiveKit where the site has an account, recorded into the site's own storage, and browser to browser with no account and nothing to configure where it has none; or a link to a room elsewhere. The table SHALL carry a Slack row, reading: **instead of** Slack, Microsoft Teams, Discord — **the kit's module** spaces — **what it does** the business's own chat: spaces whose membership is a role or a tier, channels read as a stream or a forum, direct messages, threads, mentions that decide the notification, search, huddles, a channel that may be end-to-end encrypted, and operations channels the
platform writes into — an order, a failed print job, an escalation are the database's own messages, not an integration. The Circle row SHALL replace the prior wording and read: **instead of** Circle.so, Mighty Networks, Skool, Discourse — **the kit's module** spaces, network, memberships — **what it does** a community for the site's members: the tier that was bought is the membership of the space, channels per book, topic or cohort read as chat, a forum or a feed, the space's feed pinnable in any atproto client, and a member's card showing what they have read, scored and bought. The table SHALL carry a Bluesky, Mastodon row, reading: **instead of** Bluesky, Mastodon — **the kit's module** network — **what it does** the site's own social network: every member a page, follows, a timeline, posts with likes, reposts, replies and quotes, each post to everyone, to the site's own people or to a space's members — closed to the site's people by default, joined to Bluesky's network by the site's switch and each member's consent — the whole of it served as an atproto server and app view, so Bluesky's app and any atproto client sign in with the host swapped.

#### Scenario: a module's non-goals

- **WHEN** a kit spec is read
- **THEN** it names its comparable and the things it leaves to that comparable on purpose

Verified by: `openspec validate` plus reading; phase 0 adds the section to every kit spec

#### Scenario: the table and the overview agree

- **WHEN** the Typeform, Contentful, Shopify, Crisp, Elementor, Calendly, Zoom, Circle and Bluesky/Mastodon rows are read in the spec's table and in the comparison document (`docs/COMPETITORS.md`, the docs site's copy)
- **THEN** they say the same thing in the first three columns, and `docs-check.mjs` holds them equal

Verified by: `node packages/kit/build/docs-check.mjs` in `npm test`

### Requirement: Files are the truth, so there is no lock-in

Everything a site is SHALL live in its own repository as markdown, config and its own code; a site SHALL be able to leave the kit with its content whole; the kit SHALL never hold a site's content in a service the site does not own.

#### Scenario: leaving

- **WHEN** a site stops using the kit
- **THEN** every word, offer, funnel, design and translation is still a file in its repository

Verified by: the repository's shape (by design)

### Requirement: Batteries included, every battery replaceable

Every module SHALL work with the default theme with no site code; every theme piece SHALL be overridable by name; a site SHALL never need to patch the kit — a need that cannot be met is a change to the kit through its own loop.

#### Scenario: a piece replaced

- **WHEN** a site overrides one theme component and switches one module off
- **THEN** nothing else about the site changes

Verified by: `kit-extension-model`'s override and switch tests

### Requirement: The site runs on its own code

Where this project serves an API shaped like another product, the client of that product SHALL be
installed and driven by the tests — that is the only way to know the compatibility is real — and
SHALL be imported by nothing that runs.

No file of a package's `src/`, of the Edge Functions, or of a site's own code SHALL import such a
client, and none SHALL be a `dependency` of any package rather than a `devDependency`. A drop-in is
written so that other people's code can reach this project; this project reaches itself in
first-party code.

Every such client SHALL be driven by at least one test, so that the list of them is never dead
weight carried for its own sake.

This SHALL NOT be read as a rule against third-party packages. A client of a real outside service —
a payment processor, a video platform, a mail relay, a printer — is how that service is reached and
belongs wherever it is needed. The rule is about the client of a product this project *stands in
for*.

#### Scenario: a vendor client reaches into the runtime

- **WHEN** any file that runs imports the client of a product this project stands in for
- **THEN** the check fails and names the file and the client

Verified by: `build/first-party.test.mjs`

#### Scenario: a vendor client is installed as a dependency

- **WHEN** such a client appears under `dependencies` rather than `devDependencies`
- **THEN** the check fails and names the package

Verified by: `build/first-party.test.mjs`

#### Scenario: a client nothing drives

- **WHEN** such a client is installed but no test drives it
- **THEN** the check fails, because a client that proves nothing should be dropped

Verified by: `build/first-party.test.mjs`

### Requirement: A site ships in three shapes, and which features each carries is declared

The kit SHALL support three deployment shapes, and a feature's support in each SHALL be a declaration in one canonical place rather than a property discovered by running it:

- **static** — a checkout, a build, a static host, and no backend at all. Only what is a file.
- **git** — a repository and a backend. A publish commits and the commit rebuilds. Every feature.
- **cloud** — a backend and no repository. Nothing ever builds again. Every feature that does not need a build.

`build/modes.mjs` SHALL name every module and, for each, its answer in each shape: **yes**, **no**, or **yes except** a named operation together with the change that would close it. A gap carried on purpose SHALL be named there and printed on every run, never left as silence. No other file SHALL be the place this question is answered: `PROJECTION_DEBT`, the `FIXED` artefacts and the admin function's `MACHINE` list SHALL be derived from the declaration and the code rather than written by hand.

**A site SHALL declare which shape it is**, in one `deployment` block in `platformkit.config.js` — `backend` (is there a database), `content` (`files` or `rows`) and `repo` (is git in the publish cycle) — each defaulting to today's behaviour where it is absent, so no existing site changes. One function SHALL resolve that declaration against the environment and the administrator's settings, and SHALL be the only place the shape is answered; `content` MAY be overridden per run and `repo` MAY be set by an administrator at runtime, since a deployment with no checkout cannot edit a config file. The shape SHALL NOT be inferred from an absent key: a shape that exists only in a deploy environment cannot be checked where the code is written, and the guard SHALL hold every site in the repository to its own declaration — a site claiming a shape while a module the matrix says needs another is switched on SHALL fail at that commit rather than at a deploy.

#### Scenario: a module with no declaration

- **WHEN** a module is added to the kit and `build/modes.mjs` does not name it
- **THEN** the guard refuses, so the question is answered in the same commit

Verified by: `build/modes.test.mjs`

#### Scenario: a claim the code does not support

- **WHEN** a module claims **static** and owns a table, an Edge Function or a build step needing a backend; or claims **cloud** and owns a projected table with no `projected()` hook, an artefact in `FIXED`, an action in `MACHINE`, or a content directory with no admin model
- **THEN** the guard refuses, naming the module, the claim and the evidence against it

Verified by: `build/modes.test.mjs`

#### Scenario: a debt paid and still listed

- **WHEN** a module's cloud path is finished — as print's was, over `print-render` and the print bucket
- **THEN** the derived lists stop naming it without anybody editing a list, because they are computed from the code

Verified by: `build/modes.test.mjs` — the derivation asserted against print, whose paid debt outlived its entry once

#### Scenario: a gap carried on purpose

- **WHEN** a module answers **yes except** for an operation
- **THEN** the exception names the operation and a live change, and the run prints it; a named change that is archived without closing the gap fails the guard

Verified by: `build/modes.test.mjs`

#### Scenario: a site claiming a shape it does not keep

- **WHEN** a site declares `backend: false` and a module the matrix says needs a backend is switched on
- **THEN** the guard refuses at that commit, naming the site, the module and what it needs

Verified by: `build/modes.test.mjs` — the store switched on in `sites/docs` and the check watched to fail

#### Scenario: a declaration and a stray key

- **WHEN** a site declares no backend and a backend key is set in the environment
- **THEN** the deploy is refused: the declaration is the truth and the key is a mistake, not an override

Verified by: `deploy-checks --test`

### Requirement: The Slack row says the chat is also a Matrix homeserver

The comparables table's Slack row SHALL name the surface alongside the community itself, as the
Shopify, Chatwoot, cal.com, Typeform and Contentful rows name theirs. It SHALL read: **instead of**
Slack, Microsoft Teams, Discord — **the kit's module** spaces — **what it does** the business's own
chat: spaces whose membership is a role or a tier, channels read as a stream or a forum, direct
messages, threads, mentions that decide the notification, search, huddles, and operations channels
the platform writes into — an order, a failed print job, an escalation are the database's own
messages, not an integration — and the whole of it served as a **Matrix homeserver's Client-Server
API**, so Element, FluffyChat, Nheko and any other Matrix client sign in and read the site's rooms
with the host swapped, on every platform, without the kit shipping an application of its own —
**what it leaves out** no federation (a site is a homeserver for its own people, not a node on the
public network), no end-to-end encryption (the site reads its own rooms for search, moderation and
its bots), no presence, no Matrix VoIP (a huddle is the site's own video), and no workspaces sold to
other operators from one instance.

`docs/COMPETITORS.md` and the docs site's copy of the table SHALL carry the same row, and
the check SHALL hold them equal.

#### Scenario: the table and the docs agree

- **WHEN** the overview doc and this spec's table are compared
- **THEN** the Slack row is identical in both, naming the Matrix surface and what it leaves out

Verified by: `packages/kit/build/docs-check.mjs`, in `npm test`

### Requirement: Core explains its purpose and supported features

The Core repository SHALL include accessible purpose and feature documents that describe
PlatformKit rather than a downstream site. Feature claims SHALL be grounded in current
specifications and implementation evidence, and SHALL distinguish capabilities available to sites
from capabilities enabled only by configuration, registration, published content, or generic
fixtures. These documents SHALL not identify or reproduce a downstream site's product identity,
content, or policies.

#### Scenario: a reader learns what Core offers

- **WHEN** a reader consults Core's purpose and feature documents
- **THEN** they can understand PlatformKit's purpose and its supported capabilities without
  mistaking a downstream site's product features for Core behavior

Verified by: `packages/kit/build/site-boundary.test.mjs`, `packages/kit/build/docs-check.mjs`, and a
feature-claim audit against the named specs and implementation tests

#### Scenario: a site-specific reference is added to Core

- **WHEN** a maintained Core document names or reproduces a downstream site's identity or product
  content
- **THEN** the boundary check refuses the change

Verified by: `packages/kit/build/site-boundary.test.mjs`
