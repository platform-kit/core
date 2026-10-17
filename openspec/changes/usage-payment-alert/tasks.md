# Tasks

## 1. The rules and the server read

- [x] 1.1 Add `packages/kit/src/lib/usage-alert.js` with the statuses that need the customer and the paths the banner stays off, and `packages/kit/build/usage-alert.test.mjs` covering requires-action, failed, pending, none, signed-out, and each quiet path. Register it in `test.mjs`. Verified by running it.
- [x] 1.2 Add the `attention` action to `packages/kit/supabase/functions/usage-topup/index.ts`, answered after the sign-in check from the customer's own subscriptions. Verified against the local stack with a seeded settlement, and an unauthenticated request refused.

## 2. The banner

- [x] 2.1 Give `LandingAnnouncement.vue` an `alert` tone and a `remember` prop (default true), and make it clear only a header offset it set itself. Verified by the rendered strip in both tones.
- [x] 2.2 Add `UsagePaymentAlert.vue` to the shell above every page, with its copy in `content/ui/usage.md` under `alert`, and have the Usage view dispatch `pk:usage-attention` with the statuses it loads. Verified by rendering the banner on a landing page, a content page and Billing at 1280×900 and 390×844 in light and dark; dismissing it and navigating; and a signed-out page and a checkout page with no banner.

## 3. Documentation

- [x] 3.1 Describe the banner on `sites/docs/content/docs/running-a-site/selling/usage-billing.md`, and the Announcement's two props where the theme's sections are documented. Verified by `node build/docs-check.mjs`.

## 4. Verify

- [x] 4.1 Run `node build/usage-alert.test.mjs`, the attention read, the rendered states, `openspec validate usage-payment-alert --strict` and the docs check. Report each scenario as passed, failed, or not verified, with the reason.
