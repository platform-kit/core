# Tasks

## 1. Groundwork

- [ ] 1.1 `membership_terms` with its grants and row-level security; `declarations.test.mts` passes
- [ ] 1.2 Catalogue: `terms` and `changes`, with the build refusals listed in the design
- [ ] 1.3 Confirm whether Hyperswitch's portal can hide cancellation, and record the answer in the design

## 2. Buying

- [ ] 2.1 Checkout takes a term and a plan, prices them on the server, and requires acceptance of the commitment
- [ ] 2.2 Pay in full: a purchase, an entitlement until the term ends, and a term row; the method saved where `then` continues
- [ ] 2.3 Monthly: a subscription and a term row

## 3. Running a term

- [ ] 3.1 Paid and failed reports from the Stripe webhook and the Hyperswitch renewal run update the term
- [ ] 3.2 Restrict and restore through the entitlement; the three emails
- [ ] 3.3 The scheduled job: bookings cancelled after 24 hours, default after retries end, renewal reminders
- [ ] 3.4 What follows a term: end, monthly, renew
- [ ] 3.5 Plan changes follow `changes`; cancellation is refused mid-term

## 4. Screens and docs

- [ ] 4.1 The Pricing section's term and plan picker
- [ ] 4.2 The account's billing view and the admin's person view show the term
- [ ] 4.3 The selling documentation and the strings reference

## 5. Verify

- [ ] 5.1 Every scenario in the spec, on Stripe test mode and on the local Hyperswitch
- [ ] 5.2 The existing store, checkout and membership tests unchanged and passing
