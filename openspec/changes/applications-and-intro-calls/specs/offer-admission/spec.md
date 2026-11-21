## ADDED Requirements

### Requirement: An offer may offer a free call before buying

An offer SHALL be able to name a free booking type in `before.call`. Unless `before.call-required` is true, its pricing card and offer page SHALL show the buy button as before and, beside it, a way to book that call. Booking the call SHALL NOT be needed to buy. The build SHALL refuse a call that names no booking type or names a paid one, and a call on a site with sessions off.

#### Scenario: talk first, or buy now

- **WHEN** an offer names a free intro call and does not require it
- **THEN** its card shows the buy button and a link to book the call, and a reader may check out without booking it

Verified by: `packages/kit/build/catalog.test.mts` and an offer driven in a browser

### Requirement: An offer may require the call

With `before.call-required: true`, the offer's card SHALL show a way to book the call in place of the buy button. Checkout SHALL open for that person when the call is held, and the person SHALL be emailed the link. The host SHALL be able to mark the person as not a fit, which closes checkout for them and sends the declined email.

#### Scenario: checkout opens after the call

- **WHEN** a reader books an offer's required call and the host holds it
- **THEN** checkout opens for that reader, and they are emailed a link to it

Verified by: `packages/kit/build/admissions-db.test.mts`

#### Scenario: not a fit

- **WHEN** the host marks a held call's reader as not a fit
- **THEN** checkout stays closed for that reader, and they are sent the declined email

Verified by: `packages/kit/build/admissions-db.test.mts`

### Requirement: An offer may require an application

An offer SHALL be able to name a form in `before.apply`. Its card SHALL show Apply in place of the buy button. Applying SHALL require an account. With `before.review: person`, checkout SHALL open for the applicant only when a reviewer approves the application; with `review: none`, it SHALL open when the application is sent. The applicant and the reviewers SHALL be emailed when an application arrives, and the applicant SHALL be emailed the decision with the reviewer's note when one is written. The build SHALL refuse an application that names no form, and an application on a site with forms off.

#### Scenario: approved

- **WHEN** a signed-in reader applies to an offer with `review: person` and a reviewer approves the application with a note
- **THEN** the reader is emailed the approval, the note and a link to checkout, and checkout stays open for them until they pay or a reviewer closes it

Verified by: `packages/kit/build/admissions-db.test.mts`

#### Scenario: declined

- **WHEN** a reviewer declines an application
- **THEN** the applicant is emailed the decision, their card says the application was declined, and they can't check out

Verified by: `packages/kit/build/admissions-db.test.mts`

#### Scenario: no review needed

- **WHEN** a reader applies to an offer with `review: none`
- **THEN** checkout opens for them as soon as the application is sent

Verified by: `packages/kit/build/admissions-db.test.mts`

### Requirement: An application may lead to a call

When an offer names both an application and a call, the application SHALL come first. With a required call, approval SHALL let the person book the call, and checkout SHALL open once the call is held. With an optional call, the application's last screen, shown after the answers are sent, SHALL offer the call with a way to decline it; booking it SHALL record the call on the admission, and declining SHALL change nothing. Approval SHALL open checkout whether or not the call was booked.

#### Scenario: apply, then talk, then pay

- **WHEN** an offer requires an application with review and a call, and a reader's application is approved and their call is held
- **THEN** checkout opens for them only after the call is held, and not before

Verified by: `packages/kit/build/admissions-db.test.mts`

#### Scenario: the call offered last

- **WHEN** a reader sends an application to an offer whose call is optional
- **THEN** the application is recorded first, and the screen after it offers the call and a way to decline it

Verified by: an application driven in a browser

### Requirement: The server lets only admitted buyers check out

Checkout SHALL refuse an offer that requires an application or a call unless the buyer has an open admission for that offer. An open admission SHALL stay open until the buyer pays or a reviewer closes it, unless the offer sets `before.open-for`, in which case it SHALL expire when that time runs out. A payment SHALL use up the admission. A reviewer SHALL be able to close an open admission and reopen a closed or expired one. Payment plans and terms SHALL work unchanged once checkout is open. Every email that opens checkout SHALL link to the offer's checkout page. A funnel's audience SHALL accept `admission` (`open`, `applied` or `declined`), matching people whose admission for any offer, or for the offers `abandoned-offer` names, is in that state.

#### Scenario: a direct checkout request without approval

- **WHEN** a signed-in reader with no open admission sends a checkout request for an offer that requires an application
- **THEN** checkout refuses it and no payment is taken

Verified by: `packages/kit/build/checkout-tamper.test.mts`

#### Scenario: the time runs out, where the offer sets one

- **WHEN** an offer sets `open-for` and an admission's time passes without a payment
- **THEN** checkout now refuses them, and a reviewer can reopen it

Verified by: `packages/kit/build/admissions-db.test.mts`

#### Scenario: a follow-up that stops when they pay

- **WHEN** a site's funnel targets `admission: open` and an admitted reader pays
- **THEN** the funnel reaches them while the admission is open and not after they pay

Verified by: `packages/kit/build/admissions-db.test.mts`

### Requirement: Reviewers have a queue

Administrators, and the hosts of an offer's call, SHALL see the applications waiting for a decision, each with its answers and its applicant, and SHALL be able to approve, decline or reopen one with an optional note. A host SHALL see only the applications for offers whose call they host. A person's admin view SHALL show their admissions.

#### Scenario: the queue

- **WHEN** two readers apply to an offer and a host of its call opens Sales → Applications
- **THEN** both applications are listed with their answers, and the host can approve or decline each

Verified by: an admin session driven in a browser

### Requirement: An existing offer is untouched

An offer without a `before` block SHALL be shown, bought and fulfilled exactly as before this change.

#### Scenario: no before block

- **WHEN** an offer with no `before` block is built and bought
- **THEN** its card, checkout and fulfilment behave exactly as before

Verified by: the existing catalogue and checkout tests, unchanged
