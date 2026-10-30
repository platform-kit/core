---
title: Publishing basics
description: The Published switch, titles and descriptions for search, share images, access levels, and writing in the editor.
order: 11
sources:
  [
    packages/kit/supabase/functions/_shared/gate.js,
    packages/kit/build/velite.mjs,
    packages/kit/src/lib/seo.js,
    packages/kit/src/lib/seo-head.js,
    packages/kit/src/lib/access.js,
    packages/kit/theme/src/pages/SharePage.vue,
  ]
reviewed: 2026-10-18
---

Use the Published switch to control whether a record is available to visitors. Set titles, descriptions, and images so search results and shared links describe the right page. This guide covers the shared rules; each editor has its own fields and validation.

## The Published switch

Published is on by default. When it is on, the record can appear on its public page and in the listings, search results, sitemap, or generated output provided for that content type. When it is off, the record stays available in the admin but is omitted from public output. A companion is available only when its book is published.

For a site's diagnostic or quiz, turn off the test's Published switch to remove it from the app. Its card and entry point are removed with it. Experiments use a separate **Active** switch: pausing an experiment is not the same as hiding its records; visitors see its first variant while it is paused.

## Title, description, share image

Set the site's defaults under **Settings → Site settings**: site name, tagline, description, public address, social handle, and optional default share image. A record's title and description are used on its page. Where offered, a record's **Share image** overrides the default; landing pages use their **Image** field.

If no image is supplied, the build generates a share card. Each page points to its own card when one is available; otherwise it uses the site's default. Article and book cards use their own content.

Index-page titles and descriptions are in **Settings → UI strings → pages**, under the `seo` group.

## The picture a link shows

A generated card is available at `/share/<kind>/<id>.png`; the default card is `/share/default.png`. A record's own share image takes precedence over its generated card. Set the site's **Mark** in Site settings to include the site's logo; when no mark is set, the theme's mark is used where available. The favicon is generated from the same mark, so no separate icon upload is required.

Long titles are reduced to fit the card instead of running beyond its frame. A short title is left at its original size.

## Who can read what

Articles, wiki pages, and docs may be limited to **guest**, **authenticated** (signed in), **paid** (has a qualifying purchase), or **subscribed** (has a live membership) readers. A visitor below the required level sees the page title and an access prompt instead of the protected content. Books can set chapter allowances by reader class; a blank allowance means the full book is available to that class. The book's introduction is outside the chapter count.

Text a visitor may not read is never published to them. The site's published files carry each gated record's title, description and a short opening; a book carries its free chapters and, for each locked chapter, its title and first lines. A reader with access is sent the rest when they open it, after the server checks their own account. A static site has no server to ask, so it does not publish gated text at all.

### Summaries without the book

A book can publish its summaries and never its text. Set `fullText: false` on the book (in the admin, turn off **Publish the full text**). Its title, description, cover, introduction, chapter titles and companion are published as usual, and its chapters' text is sent to nobody: not a guest, a member or a buyer. It never reaches the published files, the server's content index or the content rows either. Readers read it in summary mode only, print offers only its summary edition, and the spoken book records only its introduction and summaries.

The book's file needs only its chapter headings, one `# Title` per chapter, so that the companion can match its chapters by title. While the summaries are being written, the file may hold the full text. The build warns that the text is still there, and it is still never published. Remove it once the summaries are done.

## Writing in the editor

Use the rich-text editor for headings, paragraphs, emphasis, links, lists, quotes, code, and images. Books and companions are edited one chapter at a time; unopened chapters are left unchanged. Line breaks used for verse or other intentional line-by-line text are preserved. Printed books also preserve deliberate hard breaks, while ordinary prose broken at every source line is flowed for print.

Site-wide interface copy—such as navigation labels and footer text—belongs in **Settings → UI strings**, not in a content record's body.

## Dates and ordering

Articles are ordered by date, newest first. Wiki pages and docs use their order value within a folder (lower values first); folders are ordered by their earliest page. Products and collections also have an order value, and may be marked featured. Landing pages are reached by their route rather than an order value.

## What the build refuses

The admin validates records when you save them. For example, it will not save an incomplete product offer or a landing section missing a required field. Some cross-record and file-format checks run during a build instead. A build can reject a product with a missing or duplicated key, an invalid funnel step, an email design that cannot compile, or a malformed hand-edited test file. If a build fails after a hand edit, use the error's record and field or line to correct the source file, then build again.
