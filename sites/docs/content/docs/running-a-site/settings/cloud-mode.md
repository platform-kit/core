---
title: Cloud mode
description: Store editable content in Supabase, publish it from the live admin, and understand what requires a repository or a deploy.
order: 43
sources:
  [
    packages/kit/src/lib/content-live.js,
    packages/kit/src/lib/print-index.js,
    packages/kit/src/lib/bucket-host.js,
    packages/kit/src/lib/entry.js,
    packages/kit/build/content-export.mjs,
    packages/kit/supabase/functions/admin/index.ts,
    packages/kit/supabase/functions/_shared/github.js,
    packages/movable-types/src/components/PublishingPage.vue,
    packages/movable-types/src/content/ui/publishing.md,
    packages/kit/build/models/index.mjs,
    packages/kit/supabase/functions/_shared/compiled.ts,
    packages/kit/supabase/schemas/12-compiled.sql,
    packages/kit/build/catalog.mjs,
    packages/kit/build/funnels.mjs,
    packages/kit/build/forms.mjs,
    packages/kit/supabase/functions/_shared/mjml.ts,
    packages/kit/build/emails-compile.mjs,
  ]
reviewed: 2026-10-11
---

Cloud mode stores editable content in Supabase instead of relying on files in a checkout. Use it when editors need to change published content from the live site. It requires a backend and the live admin at `/admin`; a static site cannot use it.

A deployment has three independent settings in `platformkit.config.js`:

- `deployment.backend`: whether the site uses a backend.
- `deployment.content`: `"files"` or `"rows"`. Choose `"rows"` for cloud content. `CONTENT_STORE=cloud` can select rows for a run.
- `deployment.repo`: whether a repository is part of publishing. It defaults to `true`; set it to `false` when the database is the only content store.

These settings describe different choices: content can live in rows while a repository still receives published changes. A repository is optional, but without one there is no Git history or commit-triggered deploy.

## What an editor sees

Sign in at the live site's `/admin` with an account allowed to edit content. In cloud mode, **Save draft** stores a private draft; visitors continue to see the current published version. The preview shows the draft. **Publish** makes it live. A new record remains absent from the site until its first publish. Deleting a record creates a pending removal; visitors keep seeing it until that removal is published. Use **Keep** on Content → Publishing to cancel a pending removal.

There is one draft per record. Saving again replaces that record's previous draft. Publishing a single record makes just that record live; Content → Publishing lets an editor review and publish all pending changes together.

When a visitor loads or refreshes the live site, the app reads published content from the database, so the edit does not require a site build. A page that was already open may need a refresh. A small number of machine-only tasks, such as generating spoken-book recordings, still need a checkout or deploy process; the admin indicates when an action cannot run there.

## What the functions read, where nothing rebuilds

Some Edge Functions use compiled data such as the product catalog, forms, and email or funnel definitions. In cloud mode, publishing updates the function-facing compiled data for the records it supports; saving a draft does not. A function may take a few seconds to refresh after publishing.

If publishing uses a repository, the published files are pushed as one commit. A deploy triggered by that commit updates generated pages and other build outputs. If the repository is out of the cycle, those outputs do not update automatically.

## A derived index is a row too

Some files are generated from content rather than edited directly. For example, `content/store/print.json` records the editions prepared for sale. In cloud mode the live version of this index is read from its database row, so publishing a print-edition update can change what the store displays without waiting for a site build. Generated indexes are not edited in the admin as ordinary content records.

## Content → Publishing

Open **Content → Publishing** to review pending records, including new drafts and removals. Check the list before publishing, then enter an optional commit message and choose **Publish everything** to validate and publish the pending changes together.

When a repository is connected, this page also shows the repository and branch, whether a token is configured, the latest push, any files still waiting, and the latest error. The token is stored by the server and is never shown again after it is saved. If a push fails, the published database content remains live and the files stay pending; fix the repository credentials or connection, then use **Push now** to retry. A scheduled retry also runs automatically.

With no repository configured, the page does not offer Git publishing. Use its content archive download to keep an external copy of the database-backed files. An archive is a copy, not version history.

## What waits for the deploy

Publishing updates supported live content and its database projections. A deploy is still needed for build-time outputs, including prerendered HTML and generated share images. Until a deploy runs, crawlers may receive the previous prerendered page even when an interactive visitor sees the new content. A deploy hook can request a rebuild after publishing; configure it on the Publishing page using the URL supplied by your host. Without a hook or another build trigger, schedule a deploy yourself when generated output needs to catch up.

## The deploy in cloud mode

For a repository-backed cloud deployment, a deploy exports the live published content to the checkout before building. The export reconciles the checkout with published database rows and pending publish changes; drafts remain drafts and are not exported as live content. This lets the build use the same content editors published.

Keep the backend connected and the site's deployment settings aligned with the intended arrangement. For an installation with no repository, treat the database as the source of record and maintain a separate archive; an empty checkout is not a backup of cloud content.
