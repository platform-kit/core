---
title: Ads and experiments
description: Calls to action in three placements, chosen by audience and topic; A/B tests as their own records.
order: 37
sources:
  [
    packages/kit/src/lib/interrupt.js,
    packages/kit/src/lib/ads.js,
    packages/kit/src/lib/experiments.js,
    packages/movable-types/src/components/admin/ExperimentsAdmin.vue,
    packages/movable-types/src/components/CtaHost.vue,
    packages/movable-types/src/components/AdCard.vue,
    packages/movable-types/src/components/SiteClose.vue,
  ]
reviewed: 2026-10-14
---

## Ads

An **ad** (Marketing → Ads) is a call to action: an internal title, a **button** label (the one required field), a link, a headline, an optional picture or media, a body, and the rules for where and to whom it shows.

**Placements:**

- **modal** — a card at the bottom right of any eligible page (never inside the app, the admin, an article, checkout — `/checkout/…` — a form on its own page — `/form/…` or `/to/…` — a booking page — `/book/…` — or the API reference);
- **inline** — at the foot of an article's body;
- **both** — modal and inline;
- **footer** — the close at the foot of every article and the store's home (the question, the button, the glow on the ground). The footer shows the headline and the button only.

**Who sees it:** an **audience** (guest · authenticated · paid · subscribed; empty means everyone), the **topics** and **concepts** it speaks to and whether a page must match **any** or **all** (on an article the topics are scored against its tags; an ad that names none is eligible anywhere), a minimum number of topic views, a **cooldown** in hours between showings, and a **priority** to break ties. The picker scores every published ad for the page and the person and shows the best; with no footer ad the site's own words stand.

An ad's body is user-facing copy in the modal and inline placements; a note for the team goes in a comment, never in a field.

## Experiments

An **experiment** (Marketing → Experiments) is its own record, never a field on the thing it tests. Pages and ads know nothing about testing; the experiment points at them.

Its fields: **kind** (`page` or `ad`), **variants** (each a key, the page or ad it shows, and a weight), a **goal** (a path — the goal is a page view of it; for an ad experiment with no goal, a click on the ad), an **end date** (two weeks by default), a declared **winner**, **active**, and notes in the body.

- Visitors are assigned a variant by weight and keep it (sticky).
- A **page** experiment chooses among the pages on one route; an **ad** experiment collapses to the visitor's variant before the ad picker scores.
- The exposure is recorded once per session; the conversion is the goal.
- **Paused** (active off) means everyone sees the first variant, not that the experiment is hidden.

Experiments is a cards view with the results and the actions: pause, end, extend, declare a winner, add a variant by duplicating one. The drawer edits the record with a variants editor that chooses pages and ads from a list.

## Where nothing appears, and who has the corner

Two things put themselves over a page uninvited — an ad and the support chat — and they occupy the same corner. Until they were made to ask the same question, each decided alone, so somebody could get both at once, stacked, on a page where neither belonged. `lib/interrupt.js` is the one place that decides, and both ask it.

**Some pages are never interrupted.** A place of work is not a place to be sold to: the admin, the person's own app (`/app`), the configured community routes (feed, spaces and people), the person's own settings (`/p`), a form on its own page, the API reference, a booking page, the preview and the share cards. The shared predicate also reserves `/feed` and `/p` even when those routes are not active. On those nothing appears at all — not a card, not a teaser, not even the chat's launcher.

**In one page view the corner belongs to whoever takes it first**, and to nobody else. If an ad is going to show, the chat's pop-up is off for that page view; if the chat is already saying something, the ad waits for another page rather than stacking on it. The claim is dropped when the person goes somewhere else, because that is a new page view — and dismissing either gives the corner back, so the other may still speak later on the same page.

The rules are pure and pinned by `build/interrupt.test.mjs`, which is where to add a path that should be left alone. After an asynchronous ad lookup, the current route and the shared quiet-route predicate are checked again before the ad claims the corner, so navigation to an ineligible page cannot reveal a late card.

Checkout pages (`/checkout/…`) are also quiet: neither ads nor the support launcher appears over payment-entry controls.
