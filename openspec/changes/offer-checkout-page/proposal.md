# Proposal

## Why

An offer sold in terms or on a plan could be bought only on the store's offer page, because that is where the commitment is shown and accepted. A site with the store module off therefore couldn't sell its memberships or programmes at all. There was also no single address to send a buyer to pay at from an email, and no way to tell who opened a checkout and left, so nobody could be followed up.

## What Changes

- **Every offer has a checkout page at `/checkout/<sku>`**, in the core: what the offer is, its ways to pay with what each commits the buyer to, and the button to the payment provider. It works with the store module off.
- **The Pricing section and a membership's own button send a term or plan offer there**, and with the store off, an offer's old store address forwards there.
- **`/checkout` alone opens the reader's own latest unfinished checkout.**
- **A checkout a signed-in person opens is recorded.** Whether it was left unfinished is worked out from what they have paid for on that offer since, for every payment provider alike.
- **A funnel can reach people who left a checkout:** `abandoned-checkout: <span>`, narrowed by `abandoned-offer: [skus]`. Paying takes them out of the audience.

## Capabilities

### New Capabilities

- `offer-checkout`: an offer's own checkout page, and following up a checkout left unfinished.

## Impact

- `theme/src/pages/CheckoutPage.vue`, its strings (`theme/src/content/ui/checkout.md`), the route and page test, core pages.
- `LandingPricing.vue` and `commerce.ts` send term offers to the page.
- `supabase/schemas/46-checkouts.sql` (core): `checkouts_started`, `checkouts_left`, `my_checkout_left`, with their grants.
- `create-checkout-session` records the checkout.
- The audience grammar (`_shared/emails/rules.ts`, `email_audience_match`) and the admin's audience editor.
- The payment-plans and funnels documentation, the frontmatter reference, the route census.
