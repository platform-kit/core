# Tasks

## 1. The review

- [ ] 1.1 List every surface for each guarantee from the code: every function and table that reads or changes a customer's record, every path that writes roles or entitlements, every inbound webhook, every signed link and its lifetime, every public door, and every environment variable the browser build can see. Write the lists and the findings into `review.md` in this change. Verified by `review.md` naming each surface with its file and the check it relies on.

## 2. Tests and fixes

- [ ] 2.1 Add `build/checkout-tamper.test.mjs` and fix any finding. Verified by running it against the local stack.
- [ ] 2.2 Add `build/ownership.test.mjs` (every customer-record surface, staff roles, link lifetimes) and fix any finding. Verified by running it against the local stack.
- [ ] 2.3 Add `build/roles.test.mjs` (self-promotion through every role and entitlement path; the last administrator) and fix any finding. Verified by running it against the local stack.
- [ ] 2.4 Extend `build/webhook-doors.test.mjs` to every inbound webhook with unsigned, wrongly signed, altered and stale events, and fix any finding. Verified by running it against the local stack.
- [ ] 2.5 Add `build/abuse-limits.test.mjs` for guest checkout, sign-up, support, forms and analytics intake, adding limits where missing. Verified by running it against the local stack.
- [ ] 2.6 Add `build/bundle-secrets.test.mjs` and fix any finding. Verified by running it.
- [ ] 2.7 Register the new tests in `test.mjs` (the stack-backed ones skipped when the stack is down, as the existing ones are). Verified by `node build/test.mjs` listing them.

## 3. Documentation

- [ ] 3.1 Describe the guarantees on the security-related docs pages (payments, access, the edge functions reference) and in FEATURES.md where a guarantee is a feature a site owner relies on. Verified by `node build/docs-check.mjs`.

## 4. Verify

- [ ] 4.1 Run every new and extended test, `openspec validate harden-access-and-billing --strict` and the docs check. Report each scenario as passed, failed, or not verified, with the reason, and list every finding from `review.md` as fixed or proposed separately.
