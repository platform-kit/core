# Tasks

## 1. Groundwork

- [ ] 1.1 `commitments` with its grants and row-level security; `declarations.test.mts` passes
- [ ] 1.2 Catalogue: `plans` on any offer; `terms` and `changes` on a membership; `missed`; the build refusals listed in the design
- [x] 1.3 Confirm how each provider lets a buyer cancel or switch plan (Hyperswitch: only the kit's /billing; Stripe: a portal configuration), recorded in the design
- [ ] 1.4 A kit-managed Stripe portal configuration with cancellation and plan switching off, used for buyers in a commitment

## 2. Buying

- [ ] 2.1 Checkout takes a plan or term, prices it on the server, and requires acceptance of the commitment
- [ ] 2.2 Paid in full: a purchase, an entitlement (until the term ends, for a term), and a commitment row for a term; the method saved where `then` continues
- [ ] 2.3 Paid monthly: a subscription that ends after the last payment, and a commitment row

## 3. Running a commitment

- [ ] 3.1 Paid and failed reports from the Stripe webhook and the Hyperswitch renewal run update the commitment
- [ ] 3.2 Restrict and restore through the entitlement, as `missed.restrict` says; the emails
- [ ] 3.3 The scheduled job: default after retries end, renewal reminders
- [ ] 3.4 The sessions module's rule: bookings cancelled after the offer's grace period, without refund, through `cancelBooking`
- [ ] 3.5 What follows a term: end, monthly, renew
- [ ] 3.6 Plan changes follow `changes`; cancellation is refused mid-commitment

## 4. Screens and docs

- [ ] 4.1 The plan and term picker in the Pricing section and on the store's offer page
- [ ] 4.2 The account's billing view and the admin's person view show the commitment
- [ ] 4.3 The selling documentation and the strings reference

## 5. Verify

- [ ] 5.1 Every scenario in the spec, on Stripe test mode and on the local Hyperswitch
- [ ] 5.2 The existing store, checkout and membership tests unchanged and passing
