---
title: Applications and intro calls
description: An offer that asks for an application, a call or both before its checkout opens.
order: 23
sources:
  [
    packages/kit/build/catalog.mts,
    packages/kit/build/admissions.test.mts,
    packages/kit/supabase/schemas/47-admissions.sql,
    packages/kit/supabase/functions/_shared/admissions.ts,
    packages/kit/supabase/functions/admissions,
    packages/kit/supabase/functions/create-checkout-session,
    packages/kit/supabase/functions/form,
    packages/kit/src/lib/admissions.ts,
    packages/kit/theme/src/pages/ApplyPage.vue,
    packages/kit/theme/src/pages/CheckoutPage.vue,
    packages/kit/theme/src/components/admin/ApplicationsAdmin.vue,
  ]
reviewed: 2026-11-20
---

Most offers go straight to checkout. A coaching program, a mentorship or a cohort is often sold another way: the buyer applies first, talks to you first, or both. An offer's `before` block says which.

## Setting it up

In the offer's file under `content/store/products/`:

```yaml
before:
  apply: mentorship-application # a form in content/forms/
  review: person # person: someone approves each one; none: applying is enough
  call: intro-call # a free booking type in content/sessions/
  call-required: false # false: the call is offered, never needed; true: it is the way in
  open-for: 14d # optional: how long checkout stays open once it opens
```

Every key is optional, and an offer with no `before` block sells exactly as before. The build refuses a block that names a form or a booking type the site doesn't have, a call that costs money, `review` without an application, `call-required` without a call, `open-for` on an offer nothing gates, and a `before` block on something that ships.

## What the buyer sees

| The offer says                   | The button says                   | Checkout opens when                                                  |
| -------------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| `call`                           | Buy, with a link to book the call | always                                                               |
| `call` and `call-required: true` | Book a call                       | the call has happened, unless the host marks "not a fit"             |
| `apply` and `review: none`       | Apply                             | the application is sent                                              |
| `apply` and `review: person`     | Apply                             | someone approves it                                                  |
| `apply` and a required `call`    | Apply                             | it is approved, then the call has happened                           |
| `apply` and an optional `call`   | Apply                             | it is approved; the call is offered on the application's last screen |

**Apply** opens `/apply/<sku>`, which asks the buyer to sign in, then runs the form. Where the offer also offers a call, the last screen comes after the answers are sent: it shows the booker for that booking type and a way to decline it. Declining changes nothing.

Once they've applied, the pricing card and the offer's checkout page say **Application sent**, then **Declined**, or show the ways to pay once checkout is open. Checkout stays open until they pay or a reviewer closes it; an offer that sets `open-for` gives it a deadline instead.

## Reviewing

**Sales → Applications** lists the applications, waiting ones first, each with the applicant, their answers under each question, and the call if they booked one. **Approve** opens checkout for them (or lets them book a required call); **Decline** tells them; **Close checkout** takes an open one back; **Reopen** gives a closed or declined one another go. A note written beside the button goes in the email.

Administrators review every offer's applications. The host of an offer's call reviews that offer's, through the same function. On a held booking of a required call, the host's bookings page has **Not a fit**, which closes the buyer's checkout and tells them.

## Emails

Four emails, each a design under admin → Emails with its subject in the `emails` strings:

- `application-received`: to the applicant, when they apply.
- `application-review`: to every reviewer, when someone applies.
- `application-approved`: to the applicant, with the note and a link to `/checkout/<sku>`.
- `application-declined`: to the applicant, with the note.

The kit sends no reminders of its own. A funnel with `admission: open` in its audience reaches people who were let through and haven't paid, and paying takes them out of it. `admission: applied` and `admission: declined` reach the other two groups; `abandoned-offer` narrows any of them to particular offers.

## Underneath

One row per person per offer in `admissions` (`47-admissions.sql`), moved only along its paths: applied, approved, booked, open, then used, closed, declined or expired. Checkout (`create-checkout-session`) refuses an offer that requires an application or a call unless the buyer's row is open, so a request made by hand is refused as the page is. A purchase, subscription or plan for the offer marks the row used. An hourly job opens rows whose required call has ended and marks rows past an `open-for` deadline expired.

All the buyer's words are in the `checkout` strings (`## admission`), and the review screen's in `## review`.
