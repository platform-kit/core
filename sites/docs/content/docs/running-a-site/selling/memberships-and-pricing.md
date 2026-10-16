---
title: Memberships and pricing
description: Tiers, the pricing page, buying from a landing page, switching up and down, and what a membership unlocks.
order: 22
sources:
  [
    packages/kit/supabase/functions/create-checkout-session,
    packages/kit/supabase/functions/_shared/ledger.ts,
    packages/kit/supabase/functions/_shared/ledger-rules.js,
    packages/kit/supabase/functions/_shared/payment-provider.mjs,
    packages/kit/src/payment-provider.d.ts,
    packages/kit/build/ledger.test.mjs,
    packages/movable-types/src/components/landing/LandingPricing.vue,
    packages/kit/src/lib/auth.js,
  ]
reviewed: 2026-10-12
---

A **membership** is a tier — a level — and any number of offers may belong to it: `group-coaching-weekly` and `group-coaching-monthly` are two product files with the same **tier** slug. A higher **rank** includes everything below it. Never assume one membership product.

**What a tier lets somebody do** is a rule now, not a comparison spread through the app: `hasTier` and the ranked tiers still read as they did, and the same fact is carried by the site's one ability (see [Accounts and roles](/content/docs/running-a-site/settings/accounts-and-roles)), so a session type asking for a tier and a page gating on one ask the same question in the same place.

## What a payment means

The ledger writes what somebody owns after they have paid, and **what it decides** is apart from the writing of it, in `_shared/ledger-rules.js` — plain JavaScript over plain objects, so it can be read and checked without a database. The rules, each of which somebody can lose money or access by:

- **the buyer** is what the checkout carried, then Stripe's own reference, then the customer the payment was made under. A guest has none of them: the purchase is written against the address Stripe collected and claimed when an account is made with it.
- **which offer a line is** — the price's lookup key, which is the offer's identity and survives a rename, before the sku, which may have been reused.
- **a book unlock opens that book. A printed copy and a file open nothing online** — somebody who bought the paperback has not bought the right to read it here.
- **a session, an offering or a form is one credit PER UNIT**, each its own row: three bought is three owed, and sharing a source id would collide on the upsert and quietly make three into one.
- **the same payment decides the same thing every time it is seen.** Stripe retries events and the client's `confirm-checkout` writes the same rows as the webhook, so every grant's source id is a function of the payment and nothing else.

`ledger.test.mjs` pins all of it. Before this the most consequential file in the kit had no test of its own, for a structural reason rather than a careless one: every decision sat between two database writes.

Stripe is the compatibility default, but a site may register its own payment adapter for the
checkout, subscription changes, and customer portal operations it supports. Shared membership
tiers and entitlement rules remain the same; see [Payment providers](/content/docs/building-a-site/payment-providers).

## The tiers

Each membership offer is a product of kind `membership` with a **tier** slug, a **rank**, a **billing** of `subscription`, a **period** (weekly or monthly) and a **price**. `chat-hours` on it promises a coach's reply time (72 / 48 / 24 hours across three tiers, say), which the coaching inbox counts against.

The store's membership band shows one card per tier with a price and a Join button per offer, when the storefront's switch is on.

## The pricing page

The pricing page is a landing page with a **Pricing** section: rows you write in the page builder — a name, a glyph, a price line (with a "from" before it when it is a floor), features (one written `- ` is drawn crossed out: what the rung lacks), a button — as columns, rows, one rung, a choice list with a radio per rung, or a selector whose ticked options add up to a total. A row with a **sku** _buys from the page_: sign in first (the modal says why), then the offer's own checkout. So a site can sell a membership with the store switched off. An optional toggle lets the page flip between weekly and monthly rows; the rows stand as columns, as bands, or as one rung alone, the featured one outlined, in ink or in the accent, and a **compare** table of the plans by their features can sit under them.

## What a member gets

Every rule that reads "subscribed" — a book's chapters for members, an article's access level, the coaching chat, the sessions a tier includes — reads the live membership. The header's account menu offers **Manage membership** through the selected provider's customer portal when that adapter supports it.

## One subscription per person, and switching

A person holds one subscription. The pricing page marks their rung **Subscribed** (its button opens the portal) and every other membership rung **Switch**:

- **Up** (a higher rank, or another offer of the same tier) happens now: the rest of the period on the new plan less the rest on the old, charged at once. A card that fails leaves the plan as it was.
- **Down** takes effect at the renewal: the paid-for plan runs to the end of its period, and the lower one begins then. The page marks the coming rung with the date; pressing the current rung again calls the step down off.

Checkout returns to the app with a toast saying what happened; the purchase is theirs on landing whether or not the provider's webhook has arrived yet.

## Coaching sessions and memberships

A session record's **requires** names who may book it: anyone, guests, signed-in people, or a tier (and every higher rank), optionally hidden from a tier and up — and a membership offer may say the other way round what it includes: **Sessions included** on the product, rows of a booking type with how many a week and a month, which admit that type to the tier under those counts whatever the type's own rules say (a paid type included). A visitor can inspect public sessions and availability before signing in; choosing a time for a paid session asks them to sign in before checkout and checks the selected time again afterward. See [Sessions and coaching](/content/docs/running-a-site/bookings/sessions-and-coaching).
