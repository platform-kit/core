# Design

## Principle: a gate in front of the checkout that already exists

Everything a way in needs already exists except the gate. A call is a booking type: free, bookable by a guest where the site allows it, with an intake form if wanted. An application is a form: its questions, its responses, its admin view. Checkout, payment plans and terms are unchanged. What is new is one record saying where a person stands with one offer, and checkout reading it.

## The one new record: `admissions`

One row per person per offer they are working through:
- `user_id`, `sku`;
- `status`: `applied` | `approved` | `declined` | `booked` | `open` | `closed` | `used` | `expired`;
- `response_id` (the application, when there is one), `booking_id` (the call, when there is one);
- `decided_by`, `decided_at`, `note` (sent with the decision email when written);
- `open_until`.

It is its own record because an admission has its own lifecycle that a form response, a booking and a purchase do not have. A response is what someone wrote. A booking is a time. An admission is the decision that lets them pay. Grants are declared in its schema file: a person reads their own rows; administrators read all rows, and hosts read rows for offers whose call they host; the service role writes. Every change goes through one function, so the status can only move along the paths below.

## Product files

```yaml
kind: membership
# … price, terms, as today
before:
  call: intro-call              # a booking type (content/sessions/intro-call.md)
  call-required: false          # false: the call is offered beside the buy button; true: it is the way in
  apply: coaching-application   # a form (content/forms/coaching-application.md); omit for no application
  review: person                # person: someone approves each one; none: applying is enough
  open-for: 14d                 # how long checkout stays open once it opens
```

Every key is optional. With no `before` block, nothing changes.

The build refuses:
- a `call` that names no booking type, or one that is not free;
- an `apply` that names no form;
- `call-required` or `review` without the thing they qualify;
- `call` on a site with sessions off, or `apply` on a site with forms off;
- `open-for` on an offer with nothing gating it;
- a `before` block on an offer that ships.

## The ways in

| Offer says | The card shows | Checkout opens when |
|---|---|---|
| nothing | Buy | always (today) |
| `call` | Buy, and a link to book the call | always |
| `call`, `call-required: true` | Book a call | the call is held, unless the host marks "not a fit" |
| `apply`, `review: none` | Apply | the application is sent |
| `apply`, `review: person` | Apply | a reviewer approves it |
| `apply` and a required `call` | Apply | approved, then the call is held |
| `apply` and an optional `call` | Apply | approved; the approval email also offers the call |

An open admission lets the person check out for `open-for`. When they pay, it is `used`. When the time runs out, it is `expired`, and the buyer can ask the reviewers to reopen it from the same page; a reviewer reopens it from the queue.

**Why a held call opens checkout by itself.** The alternative is the host opening it by hand after each call. Then a host who forgets leaves a ready buyer with no way to pay. Opening on the held call, with "not a fit" as the host's way to close it, keeps the buyer moving and still leaves the decision with the host.

**Signing in.** An application and an admission belong to an account, as a membership does. Applying asks the buyer to sign in or create an account first, with the same sign-in step the pricing card already uses. An optional call follows the site's existing guest-booking rule.

**Declining and applying again.** A declined person sees that the application was declined and the note if one was written. Whether and when they may apply again is out of scope here (see Not done); for now they can't apply to the same offer again unless a reviewer reopens it.

## Flows

- **Apply.** The Apply button opens the offer's form for a signed-in person. On submit, the `form` function creates the admission (`applied`, or `open` when `review: none`) and emails the buyer and the reviewers.
- **Review.** Sales → Applications lists admissions waiting for a decision, newest first, with the form's answers and the person's link. Approve or Decline, with an optional note. Approving moves the admission to `approved` when a required call follows, or to `open` otherwise, and emails the buyer.
- **The call.** Booking the offer's call records the booking on the admission (`booked`). When the sessions module marks the booking held, the admission opens. The host's booking view has "Not a fit", which closes it and sends the declined email.
- **Checkout.** `create-checkout-session` looks up the offer's `before` block. If it gates the offer, it requires an `open` admission for this person and sku with `open_until` in the future, and refuses with a clear error otherwise. The success webhook marks the admission `used`.
- **Expiry.** The existing hourly sweep expires admissions past `open_until`.
- **Following up.** The kit sends no reminder of its own. A site writes a funnel with `admission: open` (and `abandoned-offer` or the offer's own `goal`) for as many emails as it wants, each linking to `/checkout/<sku>`; paying moves the admission to `used`, which takes the person out of the audience. `admission: applied` and `admission: declined` are there for a site that wants to write to those people too.

## Screens

- **Pricing section and the store's offer page.** The card reads the offer's `before` block from the catalogue and the reader's admission, if they have one. Its button says Buy, Apply, Book a call, Application sent, Checkout open until {date}, or Declined. The optional call is a quiet text link under the buy button.
- **Admin.** Sales → Applications, and the admission's history on the person's view.
- **Host.** "Not a fit" on a held booking of a gating call.

## Modules

The record and checkout's gate are core, beside checkout. `apply` needs the forms module and `call` needs sessions; the glue that joins a response or a booking to an admission is declared only while both modules are on, so switching either off removes its half without breaking the other.

## Not done

- Applying again after a decline (a waiting period, a limit). Raised as a follow-up once a site needs it.
- Paying a deposit to apply.
- Scoring an application automatically. A form can already score, so a later change could open checkout above a pass mark.
- Assigning applications to particular reviewers.
