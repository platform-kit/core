---
title: The store
description: The storefront, products, collections, shipping, guest checkout, and how Stripe is kept in step with the files.
order: 20
sources:
  [
    packages/movable-types/src/components/store,
    packages/movable-types/src/assets/print-fonts,
    packages/movable-types/src/components/admin/OptionsField.vue,
    packages/movable-types/src/components/store/VariantPicker.vue,
    packages/kit/supabase/functions/_shared/variants.js,
    packages/kit/src/lib/tint.js,
    packages/kit/src/lib/storefront.js,
    packages/kit/src/lib/shipping.js,
    packages/kit/supabase/functions/_shared/prices.js,
    packages/kit/supabase/functions/_shared/promotions.js,
    packages/movable-types/src/components/store/CartDrawer.vue,
    packages/kit/supabase/schemas/41-inventory.sql,
    packages/kit/src/lib/shipto.js,
    packages/kit/src/lib/commerce.js,
    packages/kit/src/lib/cart.js,
    packages/kit/supabase/functions/create-checkout-session,
    packages/kit/supabase/functions/_shared/offers.ts,
    packages/kit/supabase/functions/_shared/ledger.ts,
    packages/kit/supabase/functions/_shared/ledger-rules.js,
    packages/kit/supabase/functions/_shared/sessions/guest-booking.js,
    packages/kit/supabase/schemas/40-commerce.sql,
    packages/kit/supabase/schemas/55-sessions.sql,
  ]
reviewed: 2026-10-10
---

The store sells three kinds of thing: **books** (online unlocks, printed copies, files), **memberships** (see [Memberships and pricing](/content/docs/running-a-site/selling/memberships-and-pricing)), and **goods**. It is switched on by the `store` module; off, the route, the nav link, the bag and every store view in the admin are gone.

What it does **not** sell is a provider's own time. An offering is a row rather than a file, is booked rather than added to a bag, and is priced from its own row at the checkout — see [Providers and payouts](/content/docs/running-a-site/selling/providers-and-payouts).

## The storefront

Sales → **Storefront** is one record: the front of the store. Its hero (an eyebrow, a title — one run may be italicised with `*asterisks*`, the only mark it takes — a sub-line, a primary button and a quiet second one), and a set of **switches**: show the collection tiles, the featured rail, the editions band (what is inside every copy), the membership band, and the book online as a way to have it. Under the hero three printed books stand: the best seller of the last ninety days in the middle (earned from paid purchases at build time — never a field), or else the longest featured book; either side the shortest and the longest of the rest. `heroBooks` overrides the choice and is normally left empty. The store's ground is the landing's ground, in the look's colours. A book does not have to be **in print** to stand there: a shop that sells its books online and nothing else stands up its own covers, and the three are ordered by how much text each book holds. A press that fills the gap with a photograph of its shelf instead gets a flat panel where the books should be, so leave `heroImage` empty unless the picture is the point.

A press selling printed books alone keeps every switch but the shelves off.

## Products

Sales → **Products**: one file per thing a person can buy, and the file is the whole offer.

| Field                                                     | What it is                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **sku**                                                   | The product's slug and address (`/store/products/<sku>`); what pricing rows and session records point at                                                                                                                                                                                                                                                                                                |
| **key**                                                   | Its identity: eight characters given once on first save, shown read-only, never edited. Stripe and every purchase are attributed by it, so a sku may be renamed after it has sold and nothing is lost                                                                                                                                                                                                   |
| **kind**                                                  | `book` (an unlock — opens the book online), `good`, `membership`, `session` (a paid coaching call), `form` (an answer somebody pays to have looked at, which a form names by sku — see [Forms](/content/docs/running-a-site/marketing/forms)). Two more are DERIVED and never written in a product file: `print` and `download` come from a book's print block, and `event` from a paid event's `cost:` |
| **billing / period**                                      | `once`, or `subscription` with `weekly` or `monthly`                                                                                                                                                                                                                                                                                                                                                    |
| **price / currency**                                      | In dollars as written (10 or 10.00)                                                                                                                                                                                                                                                                                                                                                                     |
| **book**                                                  | For an unlock: which book                                                                                                                                                                                                                                                                                                                                                                               |
| **tier / rank**                                           | For a membership: its level and where it ranks                                                                                                                                                                                                                                                                                                                                                          |
| **chat-hours**                                            | What a membership or session promises: a coach's reply within this many hours                                                                                                                                                                                                                                                                                                                           |
| image, gallery, badge, featured, order, tags, collections | The editorial layer: pictures, a "New" badge, the rails                                                                                                                                                                                                                                                                                                                                                 |
| **options**, **sizes**, **variants**, **unsold**          | The shapes it is sold in — see below                                                                                                                                                                                                                                                                                                                                                                    |
| **tracked**, **backorder**                                | Whether the stock is counted, and whether it may be sold past zero. Never _how many_ — that is kept in the shop                                                                                                                                                                                                                                                                                         |
| **compare**, **rating**, **reviews**                      | An old price as written, struck through beside the price on the card and the spotlight; stars out of five and how many reviews, under the price                                                                                                                                                                                                                                                         |

The body is the long description; its `## ` sections become the details panels of the product page.

**A printed book's page previews.** The product gallery prefers the edition's generated page
images. If a fresh deploy has no such images because print generation was skipped, the same slides
show bounded excerpts in a Vue page layout that uses the print edition's fonts, 6 × 9 proportions,
margins, chapter opener and highlight wash. Original-text slides use the book, rewritten-edition
slides use the companion summary when it exists, and the marked-lines slide uses the chapter's
editorial marks. The excerpt is capped at 220 words, keeps the slide order, captions and zoom, and
does not run Typst or create a PDF; line wrapping and pagination are not the print file's.
On phones, readers can swipe left or right one slide at a time or tap the position
dots; vertical swipes still scroll the page.

**A product with no picture.** A membership and a session have nothing to photograph. Their card sets the product's own title on a ground made from its name, so a shelf never comes out with a hole in it; their product page simply leaves the gallery out and the words come first. Nothing has to be invented to fill a frame.

Nothing reads Stripe to show a price. The store, the product page and the pricing page render from the files alone, so the store looks the same locally with no Stripe account at all.

## The shapes a thing is sold in

A product may be sold in more than one shape — a notebook in linen or leather, ruled or dotted;
a shirt in three sizes and two colours. **Options** are what a buyer chooses between; the
**variants** are every combination of them, and they are worked out for you. Nobody types a
combination and nobody keeps a list of them in step.

In Store → Products the editor shows the options as rows — a name, and the values as chips you
add, reorder by dragging and remove — and beneath them a table of every shape that follows,
with three things you may set on each:

|                 |                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Price**       | Blank means the offer’s own price, which the field shows you in grey. Fill it in only where that shape costs something different                                          |
| **Its own sku** | Blank means the one made from the product’s (`notebook-leather-lined`), which is what Stripe and a warehouse see. Fill it in where you already have a code for that shape |
| **Sold**        | Turn it off for a combination you do not make. It stays on the page, struck through, rather than disappearing                                                             |

### When the supplier says what the shapes are

Where you sell something somebody else makes, the colours and the sizes are not yours to invent:
they are whatever that supplier is running this month, and they change without telling you. So a
product may name its **supplier**, and where that supplier publishes a catalogue the editor shows
**Read the catalogue again**. What comes back is written into the product as ordinary option rows,
marked with whose they are — you cannot type over them, and you do not have to keep them in step.

A value the supplier has stopped making is **struck through and kept**, never deleted. Every shape
that holds it goes off sale at once and the till refuses one, but an order already placed still
reads as the words the buyer chose — which it would not if the row had gone. Bring the colour
back into the catalogue and it sells again; there is nothing to tidy up. Your own _Sold_ switches
are untouched by a refresh: those are your decision, and this is news.

Most suppliers publish no catalogue — a printer makes what it is sent — and then the options are
yours as usual. [Suppliers](/content/docs/reference/suppliers) has the whole of it.

**Why a withdrawn shape is shown rather than hidden.** If values appeared and vanished as the
buyer picked other options, the page would read as broken. So Plain is visible and unpressable
while Leather is chosen, and comes back when they choose Linen.

The price on the page follows the choice: before anything is picked it says _from_ the cheapest,
because any single number would be one somebody is not charged; where every shape costs the same
it simply says the price.

**Sizes alone.** A shop that only needs sizes may write `sizes: [S, M, L]` instead, which IS one
Size option — the same mechanism written short, not a second one.

> **Two things worth knowing before you reorder options.** The order you write them in is part of
> each shape's identity, so moving Colour above Size renames every shape and anything already in
> somebody's basket stops being recognised — the editor asks before it lets you, and says how many
> settings it would carry. Renaming a _value_ is free, on the other hand: a sale keeps the words it
> was made with, so a purchase from last year still reads "Leather · Lined" after you have
> reworded it to "Full-grain leather".

## What is left

Turn **Count the stock** on for a product whose units run out, and the shop keeps the number —
per shape, so linen and leather are counted separately. **Sell past zero** keeps the thing on
sale when there are none left, for a made-to-order run or a pre-order.

**The number is not in the file.** The file says the stock is counted; the shop says how many.
That is deliberate: a count written into a product would come back as whatever it said every
time the site was redeployed, wiping out everything that had sold since. So you set the count
in Store → Products, on the product itself, and every change is recorded with a reason — a
delivery received, a sale, a return, a stock take — so a number that has drifted can be read
back rather than guessed at.

**What a shopper sees.** A shape with none left is marked sold out on the card, on the page and
in the bag, and the checkout refuses it; with **Sell past zero** on, none of that happens.

**A basket does not hold stock for ever.** When somebody reaches the checkout the units are
reserved, and if they wander off the reservation is released when the checkout expires, so one
abandoned basket cannot hold your last unit all day.

## A sale, a members’ rate, a second currency

Sales → **Price lists**. A product’s own price is the usual one; a list is a further price for
some people, some of the time, or in another currency. Each list says what **kind** it is — a
_sale_, which strikes the usual price through beside it, or an _override_, which simply is the
price — optionally when it **starts** and **ends**, and who it is **for**, as rules rather than
a word: every rule must hold, and a list with none is for everybody.

**The most specific list wins, not the cheapest.** If you run a sale at $14 and a members’
rate at $15, a member pays **$15**. That is deliberate and it is the thing to understand
before writing a second list: you decide what specificity means, rather than arithmetic
deciding it for you. Where two lists are equally specific, the higher **priority** wins.

A list that has not started, or has ended, is simply not consulted — you do not have to
remember to unpublish it. And nothing about a list reaches Stripe as a price of its own: the
product keeps one price and one identity, and a line a list re-priced is charged at the
resolved amount, so a sale cannot leave anything behind in your Stripe account.

### What a shopper sees

The bag shows the subtotal, each discount by its title, and what there is to pay — a discount
somebody meets for the first time on Stripe’s own page is one they had no chance to understand.
Under it the bag says your discounts are already applied and Stripe accepts **one** further code
at the checkout, which is Stripe’s limit rather than ours.

> **A line in the bag holds the price before any discount.** The discount is worked out over the
> whole bag, because it can depend on the whole bag — a threshold discount is not a property of
> any one line. Storing the discounted price instead meant the bag discounted it a second time,
> which is the kind of error that costs money and shows nothing.

## Stripe is made to match

Stripe is kept in step _from_ the files, never the other way round. At deploy, and again just before every checkout, the offers are pushed: a Stripe product is found by the offer's key or created, its price found by the same key or created. A changed price makes a new Stripe price under the same key and retires the old — an existing subscriber stays on what they signed up at. The shopper's browser sends skus, never amounts, and a sku the files do not declare is refused.

## Collections

Sales → **Collections**: a title, subtitle, tile image, order, featured, and a curated list of products. The storefront shows them as tiles and shelves in the order you set.

## A book's store page

A book in print has **one store page** (`/store/products/<slug>`) carrying every way to have it: read online first (the unlock — "yours" when it is), then what is printed and what downloads, with the buyer's choices (contents; a hardcover's cloth and foil) made on the page. A card for a book shows **the book**, standing on the paper with no box round it, at the main offer's price ("From" when a dearer format exists) — the printed cover sheet where there is one, its own cover where there is not. Never a photograph of a cover in a shadowed box: that is what the gallery on the product page shows too, where the first slide is the book itself. The card's room is the book's own 2:3, so the quick-add pill spans the book rather than floating over bare paper beside it. Buying a printed copy or a file opens nothing online; only the unlock does.

## Shipping

Where the store ships and what it charges are the storefront's **shipping** settings: a whitelist of countries or a blacklist, a default price with per-country overrides (US $5, the rest $15, say), and the methods a buyer may choose — each a printer's shipping level (standard, priority, express) with a surcharge and a delivery estimate. The buyer picks the destination on the site first (the bag and the product page ask), and checkout is made for that country alone. The printer ships straight to the buyer; what the buyer paid for shipping is the site's.

## Checkout, guests, files

A bag of printed copies and files alone checks out **without an account**: Stripe asks the email itself, the purchase and the print order are written under that address, and when an account is later made with it, the purchases move onto the account. A paid session may also be booked as a guest when the site opts out of sign-in with `coaching.requireAuthToBook: false` and that session admits `anyone` or `guest`; Checkout must contain only that one session and its selected time. Its booking uses the email Stripe returns, not an address supplied by the browser. A verified account with that same address can later claim its booking and any unused session credit. Other session bookings, memberships, and online unlocks still require sign-in.

A buyer of a download — or of a printed copy whose format includes the files — gets **every** edition of that file, whichever they chose at print time; the store page and the person's cover page show them under _Your files_, as links good for an hour, minted on request.

## After a sale

The buyer gets the order's confirmation email (with the files' letter when a file is in it) and, later, the parcel-shipped email with tracking. A print order is written and sent to the printer the moment the payment lands. Sales → Print Orders follows it. The purchase shows in Analytics, and the buyer's account becomes _paid_ for every rule that reads it.

## Testing the store locally

With `STRIPE_MOCK=1` in the local settings, every buying path completes on the spot with no Stripe account: a purchase, a subscription, a switch of plan, a cancellation. The deploy refuses a mock switched on. A mock purchase differs from a real one only by its ids.

## Comments

A product takes them with `comments:` in its own file. See [Comments](/content/docs/building-a-site/comments).
