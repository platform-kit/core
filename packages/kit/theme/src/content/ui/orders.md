---
scope: orders
---

## page

### head

title: Print orders
subtitle: Print jobs and where they are.
refresh: Refresh
loading: Loading orders…
empty: No hardcover has been ordered yet.
signin-heading: Sign in to see the orders
signin-subtitle: Orders are read from the account's own rows.
signin-cta: Sign in
denied-heading: Admins only
denied-subtitle: This account is not an admin.
error-heading: Couldn't load the orders
error-subtitle: Try again in a moment.
count: {n} orders
filter-all: All
filter-open: Open
filter-shipped: Shipped
filter-trouble: Needs attention

### status

new: New
submitted: With the printer
in-production: In production
shipped: Shipped
rejected: Rejected
canceled: Canceled
failed: Failed

### row

copies: {n} copies
copy: 1 copy
ordered: Ordered
job: Job
tracking: Tracking
cost: Printer's cost
address: Ships to
buyer: Buyer
edition: Edition
no-edition: No edition of this book has been set
error: Error
submit: Send to the printer
retry: Try again
refreshing: Checking…
refresh-one: Check status
sent: Sent to the printer
proof: Proof

## orders

### head

title: Orders
subtitle: Every sale, and what has happened to it since.
refresh: Refresh
loading: Loading orders…
empty: Nothing has been bought yet.
count: {n} orders
filter-all: All
filter-book: Unlocks
filter-download: Downloads
filter-good: Goods
filter-membership: Memberships
filter-session: Sessions
filter-refunded: Refunded
filter-print: Print
filter-unfulfilled: To send
filter-returns: Returns

### status

paid: Paid
refunded: Refunded
unpaid: Unpaid
part_paid: Part paid
part_refunded: Part refunded
unfulfilled: Nothing sent
part_fulfilled: Part sent
fulfilled: Sent
nothing_to_send: Nothing to send
requested: Return asked for
received: Return received
new: New
submitted: With the supplier
in_production: Being made
shipped: Shipped
rejected: Rejected
canceled: Canceled
failed: Failed

### row

ordered: Ordered
buyer: Buyer
guest: Guest
amount: Amount
product: Product
variant: Variant
session: Stripe session
print: Also a print order
print-link: See it under Print orders
kind-book: Unlock
kind-download: Download
kind-good: Good
kind-membership: Membership
kind-session: Session
kind-print: Printed copy
order: Order
lines: What was on it
paid-of: {paid} of {total}
sent-of: {sent} of {want} sent
send-again: Send to the printer
try-again: Try again
check-now: Check status
checking: Checking…
went: Sent to the printer
fulfilments: Sent
returns: Coming back
transactions: Money
version: Edited {n} times
each: each
refund: Refund
payment: Payment
credit: Credit
chargeback: Chargeback
no-fulfilments: Nothing has gone out yet.
no-returns: Nothing has come back.
supplier: Made by
tracking: Tracking
exchange: Exchanged for order {n}

## bookings

### head

title: Bookings
subtitle: Sessions booked, upcoming and past.
refresh: Refresh
loading: Loading bookings…
empty-upcoming: Nothing is booked.
empty-past: No session has happened yet.
empty-all: Nothing has been booked yet.
count: {n} bookings
tab-upcoming: Upcoming
tab-past: Past
tab-all: All

### status

upcoming: Upcoming
ended: Ended
cancelled: Cancelled
rescheduled: Rescheduled
no-show: No-show
refused: Refused
pending: Pending
rejected: Rejected

### refused

guest: not a member
not-included: not included
over: over the allowance
unpaid: unpaid

### row

when: When
type: Type
attendee: Attendee
provider: {provider}
credit: Paid with a credit
join: Join
recording: Recording
transcript: Transcript
recording-pending: Pending
recording-failed: Failed
recording-retry: Fetch again
recording-kept: Kept {n} days
recording-watch: Watch
recording-download: Download
minutes: {n} min
no-account: no account
scheduled-here: This site
where: Where
by-host: Booked by {name}
new: Book for someone
new-close: Close

## editions

### listing

drawing: Drawing the pages for the listing…
drawn: {n} pictures drawn for the listing
none: The listing's pictures could not be drawn here — the book itself is set and on sale
stale: The book was set again while the pictures were being drawn, so they were not kept

### interior

handover: Getting the book ready to typeset in this browser…
type: Loading the type…
compile: Typesetting the interior in this browser — a long book takes a minute…
upload: Storing the interior…
finish: Making the covers and the e-book…
