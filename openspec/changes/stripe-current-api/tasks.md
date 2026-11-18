# Tasks

## 1. The version

- [x] 1.1 `STRIPE_API_VERSION` in `lib.ts`; `stripe@23` in `package.json`, `deno-shim.d.ts`, the registry generator and the Deno tests
- [x] 1.2 The repricing test sends `STRIPE_API_VERSION`

## 2. The adapter

- [x] 2.1 Subscription period from the item, falling back to the subscription; the plan change's first phase ends there
- [x] 2.2 Invoice subscription from `parent`; line price from `pricing`; both with the old fallback, in the snapshot and the webhook
- [x] 2.3 `allowed_payment_method_types` in checkout
- [x] 2.4 `duration` in place of `iterations`
- [x] 2.5 The adapter type-checks against `stripe@23`

## 3. The check

- [x] 3.1 `platformkit check` warns about a webhook endpoint on an older version

## 4. Verify

- [x] 4.1 The adapter's unit tests, with new-shape and old-shape fixtures
- [x] 4.2 Stripe test mode: checkout, tamper, payment plans, continuation, repricing, usage recovery
- [x] 4.3 A real browser checkout in test mode
- [x] 4.4 `npm run dev` starts and a checkout opens
- [x] 4.5 The documentation's payment-provider page

## Notes from verification

- Stripe's library returns a decimal amount as a `Stripe.Decimal` since v22, so the metered price's amount is compared as normalised text (`decimalText`), with a unit case in `build/usage.test.mts`.
- The test-mode adapter run creates its promotion code with `promotion: { type: 'coupon', … }`, which replaced `coupon` in 2025-09-30.
- 4.3 and 4.4 ran together: in `npm run dev`, a member signed in at the front door, bought the demo's Member on Stripe Checkout with a test card, and came back to "Payment received"; the subscription row carries its billing period from the item.
