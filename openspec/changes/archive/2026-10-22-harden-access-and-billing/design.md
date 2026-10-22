# Design

## Context

What exists today, as a starting point for the review:

- **Prices:** `create-checkout-session` builds the charge from the site's offers through `_shared/prices.js`, `_shared/promotions.js` and `_shared/stock.js`; it reads no price, amount or discount from the request. `promotions-db.test.mjs` proves a budget holds under racing checkouts.
- **Webhooks:** `stripe-webhook` verifies Stripe's signature; `payment-provider-webhook` reuses it for the selected provider; `cal-webhook` verifies cal.com's signature; `webhook-doors.test.mjs` proves unsigned Stripe and cal.com bodies are refused. Social webhooks are handled separately and not yet covered by that test.
- **Links:** customer files and recordings are signed for an hour (`book-files`, `session-files`, recordings); print jobs sign links for seven days (`_shared/print.ts`, `print-render`), for the printer to fetch.
- **Roles:** roles are written through `set_roles`, which refuses removing the last administrator; `policies.test.mjs` covers who may read orders and bookings on the seed.
- **Browser keys:** the Vite build exposes `VITE_*` variables plus a few named flags (`packages/kit/vite/index.mjs` `envPrefix`); `.env.example`'s `VITE_` keys are all public by design.

## Decisions

**Review first, then fix with a test.** Task 1 is the review: each guarantee's surface is listed exhaustively from the code (every function and table that reads a customer's record, every role path, every inbound webhook, every signed link, every public door), and the findings are written into `review.md` in this change before any code changes. Each finding is fixed with the test that would have caught it.

**Tests by guarantee, not by function.** Each requirement has one test that walks every surface the review listed, so a new function that forgets a check fails the guarantee's test once it's added to the list. The surface lists live in the tests as data, and the review records how each was found, so a later change can find it again.

**Refusals look like absence.** Another account's record is answered as if it did not exist, so ids can't be probed for existence.

**Printer links.** Seven days stays if the review confirms the printer needs it; otherwise it shortens to the job's own window. Either way it is a link to a print file, never to a customer's purchased download.

**Abuse limits.** Limits use the existing per-visitor counters where they exist (support's guest limits) and the same mechanism elsewhere; they are configured in the site's policy record, not in code.

**Secrets in the bundle.** `bundle-secrets.test.mjs` builds the demo with a distinctive sentinel in every server-side variable the kit reads and searches the output for each, so a variable added later under a public prefix is caught.

**Language.** Refusals reuse the existing error strings. There is no new copy.

**Data ownership.** No new records.

**Controls and motion.** None.

## Deliberately not built

- **A penetration test or third-party audit.** This change makes the guarantees testable; an outside audit can then check them.
- **The content gate.** Covered by `protect-gated-content`.
- **Providers' own security.** Stripe, Hyperswitch, cal.com and the social platforms are trusted for their side.

## Risks

- The review may find more than one change can hold; findings beyond these guarantees are recorded in `review.md` and proposed separately.
