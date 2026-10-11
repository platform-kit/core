---
title: Articles, wiki and docs
description: The three prose collections — a magazine, a canon, and a manual — and how each is arranged.
order: 13
reviewed: 2026-10-11
sources:
  [
    packages/movable-types/src/components/content/TreeSection.vue,
    packages/movable-types/src/components/content/ArticleView.vue,
    packages/movable-types/src/components/content/ArticleIndex.vue,
    packages/movable-types/src/pages/ContentPage.vue,
  ]
---

Three collections hold prose, and they differ in how they are read.

## Articles

The magazine: dated pieces, newest first, at `/content/articles`. An article has a title, a description, a date, an author, tags, an optional **hero image** (a web address, an uploaded file or one chosen from the [library](/content/docs/running-a-site/content/media) — with one, the image runs to the top of the page and the header floats over it), an optional **share image**, an optional **media** track (a video or audio, one or a playlist, shown as a block), and an **access level**.

At the foot of every article is the site's **close** — a question and a button — worded by a footer ad when one is published, else by the site's own words. Ads may also appear inline in an article's body when their audience and topics match; see [Ads and experiments](/content/docs/running-a-site/marketing/ads-and-experiments).

## Wiki

The canon, page by page, at `/content/wiki`: pages arranged in **folders**, each folder a section, ordered by the `order` field. Readers can browse the navigation tree or jump to a heading in the page; a page may also have a cover.

Files live under `content/wiki/`, and a folder becomes a section whose title is the folder's name, prettified (`getting-oriented` → "Getting oriented"). A page's **related** field lists other pages by id to show at its foot.

## Docs

A manual, at `/content/docs` — the same shell as the wiki with denser content and a **search** that opens the site-wide palette narrowed to the docs. Pages under `content/docs/`, folders as sections, `order` within a folder, the landing page of the docs grouping its cards by section. (You are reading one.)

Every docs page carries: title, description, order, tags, an optional cover, author, date and updated dates, related pages, media, and an access level.

## A docs-only site

A site configured down to the docs alone — the other kinds off, nothing on that needs an account — is a standalone documentation site: the docs at `/` and `/docs`, no hub, a plain shell with the tree down the side and no hero, a header with the site's links and no sign-in. This site is one. See [Modules](/content/docs/building-a-site/modules).

## Where they show up

All three are in the site-wide search (⌘K), in the sitemap, and on the content hub at `/content` alongside the books. Each records a _content view_ event when read, which is what the analytics count and what the funnels' _interest_ rule reads.

## Comments

Off unless the file says otherwise: `comments: members` (or `everyone`, `hosts`). Naming a space and a channel makes the conversation a post in the community as well — one thread, two ways in. See [Comments](/content/docs/building-a-site/comments).
