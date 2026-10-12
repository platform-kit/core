---
title: Orders
description: What happens to a sale after it is paid for — the lines, the money, the parcels and the returns.
order: 22
sources:
  [
    packages/kit/supabase/schemas/43-orders.sql,
    packages/kit/build/orders-db.test.mjs,
    packages/movable-types/src/components/Orders.vue,
    packages/kit/supabase/functions/_shared/ledger.ts,
  ]
reviewed: 2026-10-12
---

A purchase says what somebody bought. An **order** is the thing that has a life after that: an
address that may be corrected, two parcels against one basket, money going back, something coming
back.

A paid session can be booked as the buyer checks out. The ledger takes the attendee email from Stripe's Checkout Session, then claims its id in the service-role-only `booking_checkout_fulfilments` table before contacting the scheduler. The claim records `processing`, then `booked`, `unavailable` or `failed`; a duplicate webhook or success-page confirmation cannot claim the same session again. A successful booking stores the Checkout Session id on `bookings` under a unique index as a second safeguard.

**Sales → Orders** is every sale and what has happened to it since. The printed copies are a
_filter_ of that page rather than a page of their own — a parcel from a printer and a parcel off
your own shelf are the same fact about one sale, and having two pages meant a shop selling both
had to look in two places to see one order.

A parcel that is waiting or has failed carries its own two buttons, beside the error if there is
one: **Send to the printer** (**Try again** on a failure) hands the job to the printer, and
**Check status** asks the printer where an existing job is — which is how a printer that sends no
webhook of its own is followed. They came late to this page: the consolidation moved the list and
left the actions behind on the page nobody could reach any more, so for a while a failed job was
shown in the admin with nothing to do about it.

## What an order is made of

|             |                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Lines**   | What was on it, as it read at the time — the title, the shape, the price each. A line keeps its identity for ever, so it is still recognisable after the order has been edited |
| **Money**   | Every payment and every refund, each carrying the processor's own id, so the same event arriving twice is one row                                                              |
| **Parcels** | What has gone out, and what is still being made. Each one names its lines and how many of each                                                                                 |
| **Returns** | What is coming back, with states of their own                                                                                                                                  |

## Nothing about an order's state is stored

There is no "payment status" column and no "fulfilment status" column. Paid, part-paid, sent,
part-sent — every one is worked out from the rows it is a total of, every time it is asked for.

That is not tidiness. A stored total is a second source that disagrees with the rows the first
time anything goes wrong, and the one that is wrong is the one every page reads. Cancel a parcel
and the order says _nothing sent_ again immediately, with nothing told to recompute.

## Editing an order

An edit **raises the order's version** and writes a new row for each line it touched. Nothing is
overwritten, so:

- an invoice rendered again at version 1 still shows version 1 — what the buyer was actually
  shown, not what the order became;
- a return raised before an edit still reads against the quantities that were actually sent.

A line removed by an edit is marked rather than deleted, for the same reason.

## Returns, and when the stock comes back

A return is **requested** first and **received** when the thing is in your hands. Those are two
different moments and the shelf moves at the second one.

Crediting the stock at the request would sell a unit that has not come back, and you would find
out when the next buyer's order could not be filled. A unit that comes back damaged is marked
_not restocked_ — it is in the shop but not on the shelf, and that is a decision somebody makes
rather than something to infer.

**An exchange is a return with an outbound order**, not a fourth kind of thing: what comes back is
a return, what goes out is an order, and the return remembers which order it became.

## What cannot be written

The transactions on an order must sum to what the order costs, and the rule is enforced **at the
write**: taking more than is owed, or giving back more than was taken, is refused and the row is
not there afterwards. A check that ran later would leave a row that should never have existed for
somebody to find.

Nothing on these tables is written from a browser. An order comes from the ledger, from what the
payment processor says was paid; a parcel from the [supplier](/content/docs/reference/suppliers)
that made it; a return from your own action in the admin.

## Where it came from

The printed-copy table was renamed rather than replaced — `print_orders` became `fulfilments`,
and its printer columns became supplier ones — so every copy ordered before any of this still
reads, under its new name, with its tracking intact.

The rename left six columns behind that only a book could fill — `book`, `edition`, `format`,
`contents`, `cloth` and `foil` — which made the shared table a `print_orders` with a wider
name rather than one any kind of thing can be fulfilled through. They are gone from the code: a
row now carries the **variant** the buyer chose, exactly as the rest of the store names it, and
beside it `chosen`, the record of what that variant's kind derived from it. Print reads them
through one function (`chosenOf`), so a kind that is not print never meets a book's vocabulary at
all, and the staff's notifications, a bot's answer about a parcel and the admin's own row all read
the same generic pair.

The six columns themselves survive one more deploy, and that is a property of the declaration
rather than a plan anybody has to remember. A plan applies renames, then the schema diff, then the
data script — so a deploy that dropped the columns would drop them _before_ the script that carries
their values into `chosen`, and every printed copy ordered before the change would lose what it
was. So the backfill ships first and the drop follows, and `store-separation.test.mjs` fails
either way: add a seventh column and it fails, drop the six and it fails until the exception is
deleted with them. An exception that cannot outlive its reason is the only kind worth writing down.
