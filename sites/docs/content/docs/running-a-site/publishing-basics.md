---
title: Publishing basics
description: The Published switch, titles and descriptions for search, share images, access levels, and writing in the editor.
order: 11
sources: [packages/kit/build/velite.mjs, packages/kit/src/lib/seo.js, packages/kit/src/lib/seo-head.js, packages/kit/src/lib/access.js, packages/movable-types/src/pages/SharePage.vue]
reviewed: 2026-10-08
---

A session type may also carry the hours it is bookable at by default, so a site deployed from its folder offers times before any host has set their own.

## The Published switch

Every record — an article, a book and its companion, a wiki or docs page, a product, a collection, a landing page, an ad, a session, a test — carries **Published**. It is the one switch that decides whether the thing exists to the outside world.

- On (the default): the record is built, listed, searchable, prerendered, in the sitemap, and given a share image.
- Off: the file stays on disk and in the admin, and the build leaves it out entirely. A companion goes wherever its book goes.

It is also how a quiz or a reading is taken out of the app on a site with an instrument: the test's file says `published: false` and its card, tab and scorer all go with it — nothing else has to be edited, and no copy should ever count the tests.

Experiments are the exception: they have an **Active** flag instead, which means *running*, not *hidden*. A paused experiment shows everyone its first variant.

## Title, description, share image

Every page the site shows sets its own browser title, search description and share picture. Where they come from:

- **Site settings** (Settings → Site settings) hold the defaults: the site's name, tagline, description, public address, social handle, and a default share image if you want one.
- **A record's own fields** — `title`, `description` — override them on its page. An article or a book may also set a **Share image** of its own; a landing page sets `image`.
- **Index pages** (the library, the store) take their titles from Settings → UI strings, under the `pages` scope, `## seo`.

If you set no share image, the build photographs one: the default landing's opening section on its own ground for most pages; an article's title over its cover; a book's cover beside its title and author. The favicon is drawn the same way, from the site's mark. You never upload an icon. The share route requests its artwork eagerly and awaits browser decoding; errors are logged. The same SEO-head resolver supplies metadata to development workspace previews, so the directory does not need to infer a site's title, description or image from its files.

## Who can read what

Articles, wiki pages and docs may carry an access level — **guest**, **authenticated** (signed in), **paid** (has bought something), **subscribed** (a live membership). Somebody below the bar sees the page's head and a gate offering the way up (sign in, buy, join). Books are gated by chapter instead: each book says how many chapters each class may read before the paywall (a blank means the whole book for that class), and the guest allowance starts after the introduction.

## Writing in the editor

The body of most records is a rich-text editor that writes markdown. What it supports: headings, paragraphs, bold and italic, links, lists, quotes, code, images. Two things to know:

- Books and companions are edited **chapter by chapter**: a book is split at its top-level headings, one chapter open at a time, and everything you did not open is kept byte for byte.
- Line breaks inside a paragraph (verse, an address, a run of affirmations) are kept as hard breaks. In a book they are honoured by the printed edition too, unless the whole book was typed with a break at the end of every line, in which case the typesetter flows them.

Long-form copy that is not a record — the header's links, the landing's fine print, the footer — lives under Settings → UI strings, not in a body.

## Dates and ordering

Articles order by date, newest first. Wiki pages and docs order by their `order` field within their folder (lower first), then by title; folders take the order of their lowest page. Products and collections have an `order` too, and `featured` for the rails. A landing page has no order — it has a route.

## What the build refuses

Saving in the admin validates a record against its schema, so a form will not let you save a product with no price, a session with no cal.com address, or a landing section with a missing required field. A few rules are checked at build time instead and would fail a deploy rather than a save: a product with no key or a shared key, a funnel step with no subject, an email design that will not compile, a hand-edited test file with a malformed line. The admin's own writers never produce those; they come from hand edits.


## The picture a link shows

Every page has one, and every page now points at its own: the address is `/share/<kind>/<id>.png`
for an article, a wiki entry, a doc, a product, a collection and a landing page alike. Before, a
product with no picture of its own fell through to the site's default card, so a link to a product
showed the site's name. A record that names its own share picture still wins.

What answers that address depends on the deployment: the file the build photographed, a prerender
sidecar's photograph of the app's own card, or the `share-image` function drawing one. You do not
choose — the server does.

**The mark on the card** is `mark` in Site settings: an SVG or a PNG you upload. It is used as it
is, untinted, because a logo has its own colours. Leave it empty and the theme draws its own in
your accent; a site with neither shows its name alone, which is a perfectly good brand row.

**A long title is stepped down** until the card holds it, rather than growing off the top of the
frame — which is what it used to do at about 130 characters, ending up set over the bright part of
the picture. A short title is unchanged.
