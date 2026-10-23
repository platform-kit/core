---
title: Glossary
description: The words these docs use, in one place.
order: 3
sources:
  [
    packages/kit/build/site.mjs,
    packages/kit/src/lib/router.js,
    packages/kit/theme/src/pages/AdminPage.vue,
  ]
reviewed: 2026-10-22
---

**Site.** One PlatformKit website and its configuration, content, visual design, and site-specific features. The generic demo and this documentation site are separate sites.

**The kit.** `platformkit` — shared code for content processing, the CLI, build and deploy, database declarations, APIs, and application services such as checkout, memberships, messaging, email, and print production.

**The theme.** `platformkit/theme` — the pages, components, admin screens, and styles that users see. A site can replace a theme component by name.

**Form.** A record under `content/forms/` that defines its questions, answer types, conditions, and completion behavior. A form can have its own page, appear on a landing page, or be embedded on another site. See [Forms](/content/docs/running-a-site/marketing/forms).

**Deployment shape.** The site's runtime and publishing arrangement, declared with `deployment: { backend, content, repo }`: **static** serves built files without a backend; **git** uses a repository and backend, and published changes are committed and rebuilt; **cloud** uses a backend without a repository, and database rows are the source of truth. A backend site with row-backed content has a production CMS. See [The three deployment shapes](/content/docs/building-a-site/deployment-modes).

**Row-backed content.** Content stored in Supabase instead of files (`CONTENT_STORE=cloud`). Each record has a draft and a published version. Publishing makes the draft live; if the site has a repository in its publish cycle, publishing also commits the change and triggers a rebuild. See [Cloud mode](/content/docs/running-a-site/settings/cloud-mode).

**Content model.** A site-defined record type, such as an event or teacher profile. The model specifies the fields; entries are stored under `content/models/<key>/` and can be published on `/c/<key>`. See [Content models](/content/docs/running-a-site/content/content-models).

**Module.** A feature group that a site enables or disables in `platformkit.config.js`, such as the store, forms, support desk, or email campaigns. A disabled module contributes no routes, navigation, admin screens, build steps, or deployment-secret requirements.

**The admin.** The site's editing and operations interface at `/admin`. Local development exposes the CMS. Production exposes content editing for row-backed sites and operational screens according to the site's modules and the staff member's role. Static sites do not deploy an admin or authentication.

**Course.** Sections and lessons in order that a reader works through and finishes, released all at once or over time, with an optional certificate. Somebody taking one has an **enrollment**, kept even if they lose access. See [Courses](/content/docs/running-a-site/content/courses).

**Collection.** A group of records with the same fields, such as articles, books, products, pages, or email designs. File-backed collections are stored under `content/`.

**Published.** A record's visibility setting. An unpublished record stays editable but is excluded from the public site and its indexes. Its file remains in a file-backed site; its draft remains in cloud storage.

**Frontmatter.** The structured fields between the opening `---` lines of a markdown record. Editors change these through form controls in the admin; developers can edit them in the file.

**Look.** A site's colour palette and font tokens. The site registers available looks in its configuration and selects one in Site settings.

**Landing page / section.** A public page assembled from ordered sections such as a hero, pricing block, or FAQ. Editors add, configure, and reorder sections in the page builder.

**Strings.** Editable interface copy—labels, buttons, empty states, prompts—stored in markdown under `content/app/ui/`. Editors manage it in Settings → UI strings. Theme defaults are used wherever the site has no override.

**Companion.** A record paired with a book. It can contain chapter summaries, key ideas, quiz questions, and a short recommendation blurb.

**Highlight (a mark).** An editorial underline included in a book's text and marked with a colour. It is separate from highlights a reader adds.

**Edition.** A specific printed or downloadable version of a book, defined by its contents, trim, and cover. The build creates the edition files; the store can sell them.

**Offer / sku / key.** An offer is an item the store sells. Its `sku` is the offer's URL-safe identifier and may change; its permanent `key` is the identity used to match the offer with Stripe records and purchases.

**Tier.** A membership level with a rank. Multiple offers, such as weekly and monthly plans, can provide the same tier; a higher rank includes lower-ranked tiers.

**Session.** A bookable appointment, such as a coaching call. The `sessions` module can use PlatformKit's scheduler or cal.com; each session record sets its price and access rules.

**Coaching chat.** Private conversations between members and coaches, with one thread for each member–coach pair.

**Support desk.** A public chat widget for guests and signed-in readers, connected to a staff inbox. It is separate from coaching chat.

**Funnel / blast / prompt.** A funnel sends a sequence of scheduled emails to matching accounts. A blast sends one campaign to an audience. A prompt is a funnel step that appears in the browser as a support-chat prompt instead of an email.

**Audience.** Rules that determine which accounts qualify for a campaign, based on account activity, purchases, memberships, reading, or other supported account data.

**Migration plan.** The proposed database changes needed to match the declared schema, including supported renames, schema differences, and the data script. Preview it with `platformkit migrate --plan`; deploy applies the plan after its safety checks.

**Database declaration.** Schema files that describe the database's intended end state. PlatformKit compares that declaration with the database; sites do not write migrations.

**Supabase.** The backend PlatformKit uses for Postgres, authentication, file storage, and edge functions. Local development runs a Supabase stack in Docker.

**Edge function.** Server-side code deployed to Supabase for work such as checkout, webhooks, support requests, email, or push notifications.

**Instrument.** An optional site module for assessments, scoring, and results pages, such as diagnostics or personality and word tests.

**OpenSpec.** The workflow used to propose and implement platform changes: define the requirements, implement the tasks, then verify each requirement before archiving the change.
