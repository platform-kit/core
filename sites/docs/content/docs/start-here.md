---
title: Start here
description: What PlatformKit is, who these docs are for, and where to begin.
order: 1
sources: [openspec/specs/kit-principles/spec.md]
reviewed: 2026-10-10
---

PlatformKit is an open-source platform for running a business on one site. What a site _is_ depends on which modules it switches on, and the range is wide: a documentation site, a shop, a subscription business, a practice taking bookings, a community, a publisher, a SaaS product with accounts and plans — most often several of those at once, which is the point of having them under one roof.

What there is to switch on: content of every kind — landing pages, articles, a wiki, documentation, a book library, and **content models** for the kinds the platform has never heard of (teachers, events, properties, case studies, recipes, anything with fields); a store selling goods, files, subscriptions and printed things; memberships in tiers; bookings against a calendar, with video rooms; a community of spaces and channels with chat, threads and huddles, plus a social network members can connect to Bluesky by choice — any channel may be end-to-end encrypted, and the whole of it readable in Element or any other Matrix client; a support desk with one queue for everyone waiting on the staff; forms; marketing funnels, emails and A/B tests; analytics; and an admin where all of it is edited.

Two sites in this repository run on it and they look nothing alike. Northlight Press, the demo, is a small press with every module on. This documentation site has every module off but the docs you are reading — which makes it a static site with no database anywhere.

These docs are written for two audiences, and the sections say which.

For the whole thing in one read — what the platform is, how it is opinionated, and what it replaces — start with [What PlatformKit is](/content/docs/what-platformkit-is).

**Editors** run a site day to day: writing and publishing, putting something on sale, answering customers, sending a campaign. Nothing in the _Running a site_ section needs code, a terminal or a developer. Start with [The admin, in one tour](/content/docs/running-a-site/the-admin).

**Developers** build a site, extend it, or work on the platform itself. _Building a site_ explains the three layers (the kit, the theme, a site), the config, the content pipeline, the declared database and the deploy. Start with [Architecture](/content/docs/building-a-site/architecture) and then [Your first site](/content/docs/building-a-site/your-first-site).

**Reference** is tables: every environment variable, CLI command, config key and frontmatter field.

Two habits run through everything and are worth knowing before you read on:

1. **Content is files.** A book, a page, a product, a funnel, an email design — each is a markdown or JSON file in the site's `content/` folder. The admin edits those files; the build compiles them; nothing lives only in a database. That is why a site can be checked out, copied, diffed and restored.
2. **Nothing unpublished reaches the site.** Every content record has a Published switch. Off, the file stays on disk and in the admin and is left out of the build entirely — no page, no search result, no share image.
