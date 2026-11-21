# Proposal

## Why

A site can sell an offer only by sending the buyer straight to checkout. Coaching, mentorships, cohorts and other high-ticket offers are usually sold another way: the buyer talks to the coach first, applies first, or both. Without that, a site either loses the buyer who wants a conversation before paying, or runs its calls and applications outside the platform, with nothing stopping an unreviewed buyer from paying.

## What Changes

- **An offer may offer a free call before buying.** It names a booking type. Its pricing card shows the call beside the buy button, as an option.
- **An offer may require the call.** The buy button is replaced by the call. Checkout opens for that person once the call is held, unless the host marks them as not a fit.
- **An offer may require an application.** It names a form. The buyer applies, and checkout opens for them when a person approves the application, or straight away if the offer says no review is needed.
- **An offer may require both.** The application comes first, then the call.
- **Checkout stays open** until the buyer pays or a reviewer closes it (an offer may set a deadline instead), and the buyer is emailed a link to the offer's checkout page (`/checkout/<sku>`).
- **An optional call can come last.** On an offer that requires an application and offers a call, the application's final screen, after the answers are sent, offers the call and a way to decline it.
- **A site can follow up an open admission** with an ordinary funnel: a new audience condition, `admission: open`, reaches people let through who haven't paid yet, and paying takes them out of it.
- **The server enforces it.** Checkout refuses an offer that requires an application or a call unless the buyer has been let through.
- **Reviewers have a queue.** Administrators, and the hosts of the offer's call, see each application with its answers, approve or decline it, and may add a note to the email.
- **Everything is set in the offer's markdown**, and every word the buyer sees is an editable string.
- **Nothing changes for an existing offer.** An offer without these settings goes straight to checkout, as today. Payment plans and terms work unchanged once checkout opens.

## Capabilities

### New Capabilities

- `offer-admission`: a free call beside an offer, and a required call, application or both before its checkout opens.

## Impact

- The catalogue (`packages/kit/build/catalog.mts`): a `before` block on any offer, checked against the site's forms and booking types.
- One new table, `admissions`: one row per person per offer they are working through, with its grants declared beside it.
- Checkout (`create-checkout-session`): refuses a gated offer without an open admission.
- The `form` function: a response to an offer's application creates or updates the admission.
- The sessions module: a held call opens the admission, and a host's "not a fit" closes it. Glue between sessions and the new record, declared only while both are on.
- The Pricing section and the store's offer page: the call link, and Apply or Book a call in place of the buy button.
- Admin: an Applications queue under Sales, and the admission on the person's view.
- Emails with editable strings: application received (to the buyer and the reviewers), approved, declined, checkout open.
- The audience grammar: `admission` (`open`, `applied`, `declined`), for a site's own funnels.
- The documentation's selling pages.
