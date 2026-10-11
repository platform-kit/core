---
title: Start here
description: What PlatformKit is, who these docs are for, and where to begin.
order: 1
sources: [openspec/specs/kit-principles/spec.md]
reviewed: 2026-10-11
---

PlatformKit is an open-source web platform for operating a business from one site. A site's configuration selects the features it needs: for example, a shop can add subscriptions and bookings, while a publisher can combine a library, memberships, print sales, and newsletters. The site keeps its own content, business rules, and visual identity.

PlatformKit includes content pages and collections, a page builder, accounts, a store and checkout, memberships, bookings, forms, community features, support, email campaigns, analytics, and an admin. A site can enable these modules together or leave out the ones it does not use. The generic demo shows modules working together. This documentation site disables the application modules and serves docs without sign-in.

## Choose a guide

**I edit a site.** Use [The admin, in one tour](/content/docs/running-a-site/the-admin), then open the guide for your task: [publishing content](/content/docs/running-a-site/publishing-basics), [selling](/content/docs/running-a-site/selling/store), [bookings](/content/docs/running-a-site/bookings/sessions-and-coaching), or [marketing](/content/docs/running-a-site/marketing/emails).

**I am creating or extending a site.** Start with [Architecture](/content/docs/building-a-site/architecture) to see what belongs to the kit, theme, and site. Then follow [Your first site](/content/docs/building-a-site/your-first-site) and [Configuration](/content/docs/building-a-site/configuration).

**I need an exact setting or command.** Look in [Reference](/content/docs/reference/cli) for CLI commands, [configuration keys](/content/docs/reference/config-keys), [environment variables](/content/docs/reference/environment-variables), and [content fields](/content/docs/reference/frontmatter).

## Where content lives and what gets published

In file-backed mode, a page, book, product, or email design lives as a markdown or JSON file in the site's `content/` directory. In cloud mode, a row in `public.content` holds the draft and published version. Editors change the draft in the admin; publishing makes it live and, when the site has a repository in its publish cycle, commits the change and triggers a rebuild.

The Published switch controls what readers can see. When a record is unpublished, it stays available for editing but is omitted from public pages, indexes, and search. In a file-backed site its file remains in the repository; in cloud mode its draft remains in the database.
