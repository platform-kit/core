---
title: Commerce internals
description: The offers as files, Stripe made to match, the checkout, the ledger, the mock, guest checkout, memberships' switching, and print orders.
order: 54
sources:
  [
    packages/kit/build/kinds,
    packages/kit/supabase/functions/_shared/suppliers,
    packages/kit/supabase/functions/_shared/prices.js,
    packages/kit/supabase/functions/_shared/promotions.js,
    packages/kit/src/lib/promotions.js,
    packages/kit/build/promotions.test.mjs,
    packages/kit/supabase/schemas/42-promotions.sql,
    packages/kit/build/promotions-db.test.mjs,
    packages/kit/src/lib/prices.js,
    packages/kit/build/prices.test.mjs,
    packages/kit/supabase/functions/_shared/stock.js,
    packages/kit/src/lib/stock.js,
    packages/kit/build/stock.test.mjs,
    packages/kit/supabase/schemas/41-inventory.sql,
    packages/kit/build/inventory-db.test.mjs,
    packages/kit/supabase/functions/_shared/variants.js,
    packages/kit/src/lib/variants.js,
    packages/movable-types/src/components/store/VariantPicker.vue,
    packages/kit/build/variants.mjs,
    packages/kit/build/variants.test.mjs,
    packages/kit/build/store-kinds.test.mjs,
    packages/kit/build/store-separation.test.mjs,
    packages/kit/supabase/functions/_shared/offers.ts,
    packages/kit/supabase/functions/_shared/ledger.ts,
    packages/kit/supabase/functions/_shared/ledger-rules.js,
    packages/kit/build/ledger.test.mjs,
    packages/kit/supabase/functions/_shared/print.ts,
    packages/kit/supabase/functions/create-checkout-session,
    packages/kit/supabase/functions/confirm-checkout,
    packages/kit/supabase/functions/stripe-webhook,
    packages/kit/supabase/functions/book-files,
    packages/kit/build/catalog.mjs,
    packages/kit/src/lib/commerce.js,
    packages/kit/supabase/schemas/40-commerce.sql,
    packages/kit/build/policies.test.mjs,
    packages/movable-types/src/components/Orders.vue,
    packages/kit/build/product-keys.mjs,
    packages/kit/build/sales.mjs,
    packages/movable-types/src/pages/StorePage.vue,
    packages/kit/supabase/functions/create-portal-session,
    packages/kit/supabase/functions/push-catalog,
    packages/kit/supabase/functions/_shared/shipping.ts,
    packages/kit/supabase/functions/_shared/checkout-params.js,
    packages/kit/build/checkout-params.test.mjs,
  ]
reviewed: 2026-10-08
---

The catalog carries a session type whole, including the hours it is bookable at by default — so the scheduler has an answer before any host has set their own.

> The compile (`build/catalog.mjs`) runs **over the store**, so the same code answers from a checkout on a
> machine and from the rows in an Edge Function — which is what lets a publish make this artefact
> where the deployment will never build again ([cloud mode](/content/docs/running-a-site/settings/cloud-mode)).

## What a payment decides

The ledger writes what somebody owns once Stripe says they have paid. **What it decides** is apart from the writing of it, in `_shared/ledger-rules.js` — plain functions over plain objects, no client and no network, so the decisions can be read and checked on their own:

- `buyerOf(session)` — the checkout's own `user_id`, then Stripe's `client_reference_id`, then the customer the payment was made under. A guest has none of the three: the purchase is written against the address Stripe collected, and claimed when an account is later made with it.
- `offerOfLine(line)` — a line is matched by the price's **lookup key**, which is the offer's identity and survives a rename, before its sku, which may have been reused.
- `grantsOf(...)` — what the payment gives. A book unlock opens that book; **a printed copy and a file open nothing online**. A session, an offering or a form is one credit **per unit**, each its own row, because three bought is three owed and a shared source id would collide on the upsert and quietly make three into one.
- `ships`, `carriesFiles`, `opensOnline` — the three questions the ledger asks of an offer afterwards.

Every grant's source id is a function of the payment and nothing else, which is what makes the writes idempotent: Stripe retries its events, and the client's `confirm-checkout` writes the same rows as the webhook does.

`build/ledger.test.mjs` pins all of it. Before the split, the most consequential file in the kit had no test of its own — for a structural reason rather than a careless one: every decision sat between two database writes.

## The offers are markdown; Stripe is made to match

What is sold is `content/store/products/*.md`, one file per thing, and the file is the whole offer (the fields are in [The store](/content/docs/running-a-site/selling/store)). `build/catalog.mjs` writes the published offers — and a book's print offers derived from its block, and the storefront's shipping — to `supabase/functions/_shared/catalog.json`, which is **generated and not committed** — `npm run dev` makes it before the functions are served, `platformkit test` makes it first, and the deploy makes it before `supabase functions deploy` (see [the functions' data](/content/docs/building-a-site/dev-build-and-deploy)); `platformkit test` runs its checks (slugs, unique skus and keys, a price on every offer, a period on every subscription, tier and rank on every membership, every session's `requires` naming a tier some membership declares).

Beside the offers the catalog carries **what a function needs in order to render something in the
site's own voice**: the checkout's words, the three faces the site's looks set (`--f`, `--fd`,
`--m`), its accent, and its mark as flat SVG. The share-image function sets a card in them where no
browser can photograph the real one, and none of it can be read off a stylesheet from inside a
function — so it travels here (`build/fonts.mjs`).

`_shared/offers.ts` makes Stripe match an offer: the product found by `metadata.key` or created, its name and sku kept current; the price found by `lookup_key = key` or created, carrying `key`, `sku`, `kind`, `tier` and `book` as metadata. A changed amount, currency or period makes a **new** price under the same key and retires the old (the new one made the product's default first, since Stripe will not archive a default) — a subscriber stays on what they signed up at, and because every price of a tier carries the tier, both count. It runs in two places: `push-catalog` for every offer (the deploy calls it with the service-role key), and `create-checkout-session` for each sku in the cart just before the session is made, so an empty Stripe account still sells. The client sends skus (`checkout(items)`, `subscribe(sku)` in `lib/commerce.js`), never an amount or a Stripe id; a sku the files do not declare is refused.

## What Stripe already does, and this never passed

Four parameters Stripe has always offered and the store sent none of: a trial, tax, the payment
methods accepted, and a quantity the buyer may change. They are **parameters, not mechanisms** —
which is why they went missing for so long and why they are cheap now.

They are declared per offer and resolved by one pure module, `_shared/checkout-params.js`, which the
function (Deno) and the kit's test (node) both read, so the cart arithmetic is written once. The only
real decisions are how a cart of several offers resolves something that belongs to the _session_
rather than to a line:

- **trial** — the subscription's own, since a subscription session is one offer by construction. And
  **once per person per tier**: `subscriptions.trialed` is set the first time Stripe says _trialing_
  and never cleared, so a cancelled row is still the record that it happened; the tier is read from
  the catalogue through the row's `key`, so a weekly and a monthly offer of one tier share one trial
  and cancel-and-rejoin grants nothing.
- **tax** — on if **any** offer in the cart asks. The alternative, every offer having to agree, would
  silently not charge tax on a mixed cart, and under-collecting tax is the mistake that costs money
  much later. With a remembered customer, `automatic_tax` also needs `customer_update: { address:
'auto' }` or Stripe refuses.
- **payments** — the **intersection**, so a cart never offers a method one of its offers does not
  accept. Empty means Stripe's own default, which is exactly what every session sent before this.
- **adjustable** — a property of its own line, set per line. Named `adjustable` rather than
  `quantity` because a content file may never carry a count of anything (stock is a row), and the
  check that holds that rule refuses a field whose name reads like one — which it did, immediately.

A trialling member **is** a member: the ledger already counted `trialing` among the live statuses, so
the `subscribed` entitlement is active with its tier for the whole trial and every surface that reads
a tier sees one. That was true before any of this and is now pinned by a test rather than relied on.

**An offer declaring none of them resolves to nothing at all**, which is the assertion the suite
actually makes — the four fields are absent from every existing offer's catalogue record, byte for
byte, so nothing already being sold moved.

Tax is the one with no key to check: Stripe Tax is switched on in the Dashboard, and unconfigured it
returns **no tax rather than an error**. So the deploy cannot refuse on it and says so instead,
naming the offers that asked — a note, not a refusal, because blocking a deploy over a setting
nothing here can see is worse than telling somebody to go and look.

## Options in, variants out

An offer declares **options** — a name and its values, in the order they are shown — and the
build derives one **variant** per combination. A variant is the sellable thing: it carries its
own price, sku and weight, and it is what a cart line names.

```yaml
options:
  - name: Size
    values: [S, M, L]
  - name: Colour
    values: [{ value: deep-navy, label: Deep Navy }]
```

`sizes: [S, M, L]` is the short way to write one Size option and **is** that option — one
mechanism, so a shop that only needs sizes never meets the longer form.

Three things about it are worth knowing because they are not obvious:

- **The order of the options is the order of a variant's key.** `parts.black.gold` is contents,
  then cloth, then foil, because that is the order they are declared in. A cart line, a purchase
  and a print order all carry that key, so **reordering an offer's options changes them all** —
  the admin reorders _values_ freely and _options_ deliberately.
- **A value's slug is its identity; its label is what a person reads.** Rename the label as often
  as you like; the slug is what was sold.
- **A variant's sku and lookup key are derived once** from the offer's `sku` and `key`, which is
  why a sku may be renamed after it has sold without losing anything.

The grammar lives in `supabase/functions/_shared/variants.js` — plain JavaScript on nothing at all — so the **checkout function applies exactly the rule the build applied** when it wrote the catalog. Two implementations of "which combinations does this offer sell" is two answers the first time one of them is edited; the same arrangement as `ledger-rules.js` and the printers. `printVariant`, which print has used since before the store had options, is now a reading of that one rule in a book's words rather than a second copy of it. The print compatibility comparison runs when a site has published books set up for print; a generic site with printing switched off reports that comparison as skipped.

A combination a shop does not sell is listed in `unsold` — the few, rather than the many it does
— and stays visible as unavailable rather than vanishing.

On a page that is `VariantPicker.vue`: a row of chips per option, with a value **dimmed and struck through** when no still-available combination contains it given what is already chosen — so a notebook sold in linen in three rulings and leather in two strikes _Plain_ through the moment _Leather_ is picked, and restores it under _Linen_. It is never hidden: values that appear and vanish as you choose read as a broken page, and a buyer who wanted the one that has gone learns nothing from its absence.

The price follows the chosen shape — a variant's own where it has one, the offer's where it has not, from the same rule the catalog used. Until enough has been chosen to name one it says **from** the cheapest, because any single number before then is one the buyer would not be charged; where every shape costs the same there is nothing to qualify.

## A kind of thing is a registration, not a column

Some things a shop sells have needs nothing else has. A book in print has editions, a trim, a
spine, foil and a typeset interior. A garment made on demand has a blueprint, a placement and
artwork. An ordinary product — a mug, a download, a membership — has none of it, and may have
stock, which neither of the others ever does.

Putting all of that in one table gives every query columns it must ignore, and the fourth kind
adds six more. Building a separate system per kind is what print did once, when the store had
nothing to build on. So **a kind is a registration** — like an admin model, a landing section or
an image source — and it reaches the store through exactly **two slots**:

|                      |                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `options(offer)`     | the options and their values this kind supplies, from wherever it gets them: derived from a print block, fetched from a supplier's catalogue, or typed by the shop |
| `artefacts(variant)` | an **opaque** record of whatever a build made for one variant — a book's interior, cover, page count and edition; a garment's print file and placement             |

**The store never opens the parcel.** It stores the artefact record, hands it to a supplier, and
may ask exactly one question about it: whether the variant is _ready_, because a thing that
cannot be made yet cannot be sold yet. Anything else it wanted to know would be a book's word in
a table that mugs also use, and `store-separation.test.mjs` refuses that — in both directions,
so deleting print's vocabulary fails the test too.

A kind also declares what it **produces**, and a supplier declares what it **needs**. The two are
matched when a shop is configured, naming the missing artefact — not at the till, which is too
late to be useful.

**An ordinary product registers no kind.** Not a null `edition` column, not a branch on a kind
enum: absent. A shop selling mugs has no editions in its database and no typesetter in its build.

A site registers its own kinds in `platformkit.config.js`, and the registry walks the kit's and
the site's as one list.

## A price and a discount are different questions

Two modules, because neither can say the other’s thing. `prices.js` answers _what does this cost
for this person_ — contextual absolute prices. `promotions.js` answers _what comes off_ — a
percentage or a flat amount. Medusa keeps the same split (`modules/pricing`, `modules/promotion`)
and this project learned why the hard way: a single mechanism carrying both could express a sale
only as "$14", which goes stale when the product is re-priced, can silently become a price rise,
and cannot take 20% off a member’s own rate.

**Prices resolve first, discounts second, in that order, in both the page and the checkout.**
That order is the whole of it: a discount is a percentage of what you were going to pay.

### Which price

Medusa’s ordering, from `pricing/src/repositories/pricing.ts:310-312` — a list price beats a
plain one, then the most rules matched, then the **cheapest**. (The cheapest tiebreak is real;
it only ever settles prices of equal specificity, which is why it is not "cheapest wins".) And
the resolution from `pricing-module.ts:429`: an `override` always wins and is its own reference,
the cheapest if several; a `sale` is `min(sale, default)`.

One consequence worth knowing rather than rediscovering: **an override beats a cheaper sale**, so
in Medusa a member can pay more than a stranger. That is why a public discount here is a
promotion rather than a price list — a promotion applies on top of the member’s own rate.

### What comes off

`percentage` or `fixed`, targeting `items`, the `order` or the `shipping`. For items,
`allocation` decides what a flat amount means: `each` per line, `across` split by each line’s
share of the total and redistributed over what remains after earlier promotions, `once` off a
single line. `max_quantity` caps the units reached. Every adjustment is floored at nothing and
capped at the amount it comes from, so no stack of promotions can make a line negative.

**A budget is a promise, and a promise nothing counts is a decoration.** The limit is in the
file; how much of it is gone is a row (`promotion_usage`), because a half-spent campaign must
not come back full when the repository is redeployed. A `spend` budget counts the money given
away and a `usage` budget counts the times. The check and the increment are one statement, so
ten checkouts racing for three remaining uses yield exactly three — a read-then-write
implementation gives away four and nothing says so.

The budget is taken **before** the discount is given, which means working the discount out
twice: once to know what it is worth, and again over only the promotions whose budget allowed
it. A promotion refused for budget is simply not applied — the buyer pays the undiscounted
price rather than meeting an error about somebody else having spent the money.

An **order-level** discount is why `target` exists: "£10 off orders over £50" is the commonest
promotion there is and a per-item model cannot express it.

**`item_total` is the cart as it stands.** It was once a literal `0` at both call sites, which
made every `gte` threshold dead and every `lte` one match always — a discount meant for small
baskets given to every basket, silently. The checkout computes it from the standing prices
before resolving promotions; the page reads the bag.

**A price belongs to a product, and a caller naming none gets nothing.** The sku guard once
skipped itself when either side was empty, and the page passed no sku — so every product sold
one way matched every other and the shop showed the first product’s price, on every simple
product, with nothing failing.

**The page and the checkout use the same two modules in the same order**, so the amount shown
and the amount charged cannot differ. Where the result differs from the catalog price the
checkout charges it **inline**, carrying the offer’s metadata so `offerOfLine` attributes it
exactly as it would a catalog price — the ledger never learns about pricing.

## One seam a thing is made and sent through

**A supplier makes a VARIANT out of ARTEFACTS.** `chosen` is what the buyer picked; `artefacts`
is whatever the kind produced for that variant — a book’s page count and print files, a
garment’s artwork and placements. The supplier understands them and nothing between the two
needs to.

That phrasing is the whole point. The interface used to take `pages` and `files` by name, so a
supplier that makes anything but a book could not implement it, and "plug-in" was true only of
printers. `suppliers.test.mjs` checks the vocabulary against the source rather than by reading
it, because reading is how it was verified last time.

|         |                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `makes` | the formats it can MAKE. A supplier that makes nothing is never offered as a way to make something — a shelf is not a printing press |
| `sends` | whether anything physically travels                                                                                                  |
| `needs` | the environment keys it asks for, so a deploy can refuse before it starts                                                            |

**Two suppliers that are not printers**, and they are here to prove the seam rather than to pad
it. The shop’s own **post room** is a shelf and a person: it makes nothing, cannot quote (and
says `null` rather than a zero, which would read as _free_), and leaves an order `submitted`
until somebody marks it sent. A **download** is the other end: it makes a file, sends nothing,
costs a real zero, and is `shipped` on arrival — there is no moment between paying and having
it. Handled outside the seam, a download would need its own branch in every surface that reads
an order; as a supplier it needs none.

## What is left, and why `available` is never stored

Three stored numbers per shape — `stocked`, `reserved`, `incoming` — in `public.inventory`, and
`available` is `inventory_available()`, derived every time. A stored total and the rows it is a
total of are two sources that disagree the first time anything goes wrong, and the one that is
wrong is the one every page reads. (Shopify stores eight names and cannot let even its own API
write `committed`, which is what owning a derived number costs.)

**A file never says how many.** `tracked` and `backorder` are frontmatter; the count is a row.
If the database were deleted and the repository redeployed, a count in a file would come back as
whatever the file said. `declarations.test.mjs` walks every content schema and refuses a field
called `stock`, `quantity`, `available` or their like, so this cannot be broken by a field
nobody thought to add to a list.

**The decrement is one statement.** `inventory_take` puts its condition inside the `UPDATE`, so
two sessions racing for the last unit cannot both match — the second takes nothing and returns
false. It returns false rather than raising because the caller refuses politely, and because a
backorder means it may not care. `inventory-db.test.mjs` races two connections for one unit and
ten for four; a read-then-write implementation passes every other test and fails those.

**`backorder` lets the count go negative**, and there is deliberately no `stocked >= 0` check: a
shop selling past zero is owed units, and minus three is what that is. Zero while three people
wait is the number nobody can act on. `inventory_available` still floors at nothing, so a
shopper is never shown it.

**Reservations.** Checkout holds nothing for us, so the hold is ours: written when the session
is made, released on `checkout.session.expired` — the only hook there is. The release reads the
movements rather than a second table (every `reserved` for that session less what was released
or sold against it), so a session whose payment landed has nothing to give back and a retry of
the event writes nothing.

**A hold is released by a hook, with a floor under it.** Stripe’s `checkout.session.expired`
is the fast path; but it is one event arriving from outside, and it can be unconfigured, lost
past Stripe’s retries, or never set up. A hold never released is permanent, and since
`available` is stocked less reserved, the shop quietly stops selling the thing. So
`inventory_sweep()` runs on cron and gives back anything held longer than a checkout could
possibly live, writing a `released` movement like any other.

**A hold that cannot be placed does not fail the checkout, and a sale that cannot be taken does
not fail the ledger.** The count may move between the page and the call; the thing that must be
atomic is the sale, and it is. A webhook that threw over stock would make Stripe retry a
completed payment for ever.

### Sold out is not the same as not sold

`_shared/stock.js` is the rule, pure, shared by the page and the checkout. It keeps two answers
apart that a shop routinely conflates:

|            |                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| **unsold** | the _file_’s answer — "we do not make leather in plain". A declaration, the same for everybody, struck through for ever |
| **out**    | the _database_’s answer — "we made it and there are none today". State, different by the minute, may come back          |

`whyNot()` returns one or the other, never a single boolean, because a shop that says the first
about the second tells somebody a thing is discontinued while it is on a lorry.

**The default is always buyable.** No backend, no row, a failed fetch, a count not yet loaded —
every one of them means sell it. A static site has nowhere to keep a count and therefore cannot
have run out of anything; the alternative is a shop that silently stops selling, which fails
totally and in the one direction nobody notices until the takings are zero.

**All three shapes.** Static: nothing is fetched, nothing is tracked. Git and cloud: the rows,
read live — stock was never an artefact, so nothing about it needs a build or a publish, and a
count baked into a page would be wrong by the time anybody read it.

## Keys are identity

A product's `key` (eight hex characters, given once by the admin's writer or `node build/product-keys.mjs`, never edited) is Stripe's lookup key and what every purchase, subscription and credit is attributed by, so a sku may be renamed after it has sold and nothing is lost. A print offer's key is the book's block's; every other format's is made from it (`formatKey`: FNV-1a over key:format). The webhook reads what was bought by the price's lookup key and writes the key with the sku beside it as it read at the time. `platformkit test` refuses an offer with no key or a shared one.

## The checkout and the ledger

`create-checkout-session` makes the Stripe Checkout session: the lines by sku, a print or download line's **variant** (contents, cloth, foil — `variantOf` / `parseVariant`) checked against the offer's choices, the shipping options for the one country the buyer chose (`allowed_countries` is that country alone; each option carries its level as metadata; the phone collected), a paid session's chosen time in the metadata, `metadata.guest` for a cart with no JWT. Checkout returns to `/app?checkout=success&session=…` (a cancel to the page it started from, a path on this site only).

`_shared/ledger.ts` is what a payment writes — purchases, subscriptions, entitlements, a session's credit and its booking, a print order sent to the printer, the order's email once per session — called by the **webhook** with Stripe's objects and by **`confirm-checkout`** on landing (the session retrieved from Stripe, checked to be the buyer's, written through the same upserts), so what was paid for is theirs on landing whether or not the webhook has arrived, and a local run needs no `stripe listen` to see a purchase land (the forwarder is still how renewals, failures and refunds arrive).

`get_my_entitlements` returns the person's classes, live tiers, plan (`plan`, `plan_key`, `plan_next`, `plan_next_at`) and credits; `lib/auth.js` (`memberTiers`, `hasTier`, `tierRank`) reads it.

## The mock

`STRIPE_MOCK=1` in the local `.env` makes `create-checkout-session` complete the purchase on the spot and answer with the success url, the portal cancel a mock subscription at once, and the catalog push a no-op — the ledger written by the same code with Stripe's objects made up (`cs_mock_…`, `sub_mock_…`). Ids the mock made up never reach Stripe: with the mock off, a mock subscription met at a switch is ended in the ledger and the person subscribes for real; a mock customer is replaced; the portal treats one as no billing account. The deploy refuses the mock.

## Memberships: one subscription, switched in place

A subscriber choosing another plan is switched by `create-checkout-session`, never sent to Checkout for a second subscription. **Up** (a higher rank, or another offer of the same tier): now, the rest of the period on the new plan less the rest on the old, invoiced and charged at once (`always_invoice`, `error_if_incomplete`). **Down**: a Stripe subscription schedule of two phases, released once the second has begun; the row remembers it (`next_sku`, `next_at`), the ledger keeps it through the webhook's writes, and pressing the current rung again releases the schedule. There is at most one pending switch.

## Guests

A bag of print and download lines alone checks out with no JWT (`guestCart` in `lib/shipto.js` is the client's side of the rule): no Stripe customer, Checkout asks the email, the ledger writes the purchase and the print order with that email and no user, `confirm-checkout` accepts a guest's session. `claim_guest_purchases`, called from `handle_new_user`, puts a guest's purchases and orders on an account later made with that address and grants the paid class.

## Print orders

On a `print` line the ledger writes a `print_orders` row (the address as Stripe gave it, the format, the contents and so the edition, a linen's cloth and foil, the quantity, the shipping level read back from the rate the buyer chose) and sends it to the printer at once (`_shared/print.ts`: the edition's printer, its product, the files as week-long signed urls; a row whose edition has no such cover, or whose printer has no title yet, fails with a line saying so, for a retry once it is set). The printers' webhook reads the job back — never trusting the body — and moves the row; `print-order` sends again, checks now, or orders a proof. A `download` purchase, or a printed copy whose format includes files, entitles the buyer to every edition of that file through `book-files`.

## The desk's reads

`purchases_select_own` and `bookings_select_party` admit `is_admin()`, as `print_orders_select_own` does, so the admin's Orders, Print orders and Bookings pages read the tables under RLS with the administrator's own session and follow them live (all three are in the realtime publication). Who a row's account is comes from `admin_people(ids)` — a security-definer that answers an administrator with id, name and email for the ids asked, and anyone else with nothing — since profiles are self-select. `packages/kit/build/policies.test.mjs` pins it against the local stack's seed (the read-through where the seed holds purchases and bookings; on a site whose seed holds none, those checks are skipped with a note). It also verifies that a provider can reply in their coaching threads without a membership, while a reader needs a live membership or a paid session with that coach to open one.

## Sessions and credits

A product of kind `session` is bought as it is booked: the webhook grants one credit per unit (an entitlement of kind `product`, key `session:<key>`) and books the time with it; `book-session` spends a credit when the time went meanwhile; cancelling gives it back. A paid session also opens coaching chat with that booking's coach until a week after the session ends. That access is derived from the booking, follows a move, ends on cancellation and is not a `subscribed` entitlement or access to other community places.
