# Proposal

## Why

When an automatic usage charge needs the bank's verification, or is declined, the only place a customer learns of it is the "Usage payments needing attention" section of Billing → Usage. No banner, toast or email says anything, and Stripe and Hyperswitch send nothing for these charges. A payment that needs the customer can sit unpaid until they happen to open that tab.

## What Changes

- A signed-in customer with a usage payment that needs them — verification required, or failed — sees a red banner at the top of every page, built from the page builder's Announcement strip.
- The banner links to Billing → Usage, where the existing recovery controls are.
- Its × hides it for the current page view only. It comes back on the next page load or navigation, until the payment is settled.
- A payment that is only processing needs nothing from the customer, so it raises no banner.
- The banner never appears on checkout (it would sit over the payment form), on an embed inside another site, or on preview and share renders.
- The usage function gains a small read that answers whether the signed-in customer has such a payment, without loading the rest of the Usage view.

Proposed copy. The badge names the problem, the line says what is wrong, and the link says where to fix it:

> **Payment needed** · Your saved payment method needs verification to pay for your usage. · Review payment →

When the charge failed:

> **Payment needed** · A payment for your usage didn't go through. · Review payment →

## Non-goals

No email, and no change to the Usage view's own controls. The page builder's Announcement section gets no new editor fields: the red tone and the per-page-view dismissal are available to code only.

## What James should look at

The per-page-view dismissal: × hides the banner until the next navigation, not for the session, so it reappears on every page until the payment is settled.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-billing-usage`: a usage payment needing the customer is announced on every page until it is settled.

## Impact

- `packages/movable-types/src/components/landing/LandingAnnouncement.vue`: an alert tone and a dismissal that is not remembered.
- A new shell banner in `packages/movable-types/src/App.vue`, and its strings in `content/ui/usage.md`.
- `packages/kit/supabase/functions/usage-topup/index.ts`: the attention read.
- Surfaces to verify: the banner on a landing page, a content page and Billing, at desktop and mobile in light and dark; absent on checkout and for a signed-out visitor; back after dismissal on the next navigation.
