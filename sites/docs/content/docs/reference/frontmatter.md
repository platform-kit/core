---
title: Frontmatter by collection
description: Every field of every shared content record, as the files hold them and the admin edits them.
order: 83
sources:
  [
    packages/kit/build/velite.mjs,
    packages/kit/build/funnel-io.mjs,
    packages/kit/build/quiz-io.mjs,
    packages/kit/build/models/core/agents.mjs,
    packages/kit/build/statement-keys.mjs,
    packages/kit/build/docs-check.mjs,
  ]
reviewed: 2026-10-21
---

Every shared record is a markdown file with a frontmatter block; the admin edits the fields as a form. `published` (boolean, default true) is on every collection and is omitted below. A field marked _build_ is written by the build, not by a person. Site-defined model records use the keys declared by that model's `fields` list; those vary by site and are not shared collection fields. This page covers shared content fields; the repository-level purpose and feature overviews are tracked separately and do not define a site's content models.

## Articles — `content/articles/**/*.md`

| Field         | Type                                              | Notes                                         |
| ------------- | ------------------------------------------------- | --------------------------------------------- |
| `title`       | string                                            | required                                      |
| `description` | string                                            | search and share                              |
| `date`        | date                                              | ordering, newest first                        |
| `author`      | string                                            |                                               |
| `image`       | url or `/static` path                             | the hero; with one, the header floats over it |
| `share`       | path                                              | the share image, when not the generated card  |
| `media`       | one track or a playlist                           | `{ src, poster?, title? }`                    |
| `canAccess`   | list of guest · authenticated · paid · subscribed | the access level                              |
| `tags`        | string[]                                          |                                               |

## Wiki and docs — `content/wiki/**/*.md`, `content/docs/**/*.md`

`title`, `description`, `order` (number, default 99; within its folder), `tags`, `cover` (an address, as a book's), `author`, `date`, `updated`, `related` (ids), `media`, `canAccess`. A folder is a section titled by its name.

## Books — `content/books/*.md`

| Field                                                                          | Type                                                                                   | Notes                                                                |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `title`, `author`, `description`                                               | string                                                                                 |                                                                      |
| `cover`                                                                        | an address: `/uploads/<path>` (the library's Uploads), `/<path>` (`public/`), or a url | `/uploads/books/the-kybalion.png`                                    |
| `share`                                                                        | path                                                                                   | the share image                                                      |
| `introduction`                                                                 | markdown                                                                               | the page before chapter one                                          |
| `introduced`                                                                   | _build_                                                                                | the introduction's provenance                                        |
| `date`                                                                         | date                                                                                   |                                                                      |
| `year`                                                                         | integer                                                                                | when the book first appeared — the colophon's "first published 1931" |
| `difficulty`                                                                   | beginner · intermediate · advanced                                                     |                                                                      |
| `guestChapters`, `authenticatedChapters`, `paidChapters`, `subscribedChapters` | integer                                                                                | the free chapters per class; unset = the whole book                  |
| `tags`, `topics`, `concepts`                                                   | string[]                                                                               | concepts: the library's themes; topics: the recommendation slots     |
| `book_id`                                                                      | string                                                                                 | a stable friendly id, for pins                                       |
| `print`                                                                        | block                                                                                  | see below                                                            |
| `chapters`, `audio`                                                            | _build_                                                                                | the chapter count; the spoken book's manifest                        |

The body is the text, split into chapters at `# ` headings, with `==marks=={colour}` as the editorial highlights.

### The print block

| Field                          | Type                                                  | Notes                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                          | 8 hex                                                 | the offers' identity, given once                                                                                                             |
| `ebook`                        | boolean (true)                                        | the page mentions the book online                                                                                                            |
| `main`                         | online · softcover · hardcover · premium · pdf · epub | the offer the page opens on                                                                                                                  |
| `contents`                     | list of parts · full · summary · both                 | the first is the default                                                                                                                     |
| `formats.<f>`                  | number, or `{ price?, markup?, cloth?, foil? }`       | softcover · hardcover · premium · pdf · epub; cloth and foil may be lists (the buyer's choice)                                               |
| `includes`                     | list of pdf · epub                                    | the files that come with a printed copy                                                                                                      |
| `files[]`                      | `{ title?, file }`                                    | extra downloads under `content/books/files/<slug>/`                                                                                          |
| `cloth`                        | navy · gray · red · black · tan · forest (black)      | the linen's default and every cover's palette                                                                                                |
| `foil`                         | gold · black · white (gold)                           |                                                                                                                                              |
| `trim`                         | 6x9 · 5x8 (6x9)                                       |                                                                                                                                              |
| `paper`                        | cream · white (cream)                                 |                                                                                                                                              |
| `spine`                        | string ≤ 40                                           | a shorter title for the foil (25 characters after the edition line)                                                                          |
| `note`, `blurb`, `flap`        | markdown                                              | the publisher's page; the jacket's back; the front flap                                                                                      |
| `printers.<format>`            | lulu · mixam · bookvault · auto                       | who makes each printed format                                                                                                                |
| `providers.<printer>.<option>` | as the printer names them                             | Lulu's `style`, `package`; Mixam's `lamination`, `jacket`; Bookvault's paper, cloth, foil positions, ribbon, bands, endpapers, sprayed edges |
| `rights`                       | string                                                | on what footing the text is printed and sold; required to set or sell                                                                        |
| `proofed.<contents>`           | 16 hex                                                | the edition a proof was read at; written by Mark proofed                                                                                     |
| `currency`                     | string (usd)                                          |                                                                                                                                              |

## Companions — `content/companions/*.md`

`book` (slug, required), `insight` (one or two lines), `statement` + `statementArea` + `statementLevel` (a premise, optional), `generated` (_build_: model, date, per-chapter hashes). The body: `# Chapter title` per chapter, each with `## Summary`, `## Essence` (a `- ` list) and `## Quiz` (numbered questions, four `- [ ]` options, one `- [x]`, an optional `> why`).

## Ads — `content/ads/*.md`

| Field                                | Type                                              | Notes                   |
| ------------------------------------ | ------------------------------------------------- | ----------------------- |
| `title`                              | string                                            | internal                |
| `button`                             | string                                            | required: the CTA label |
| `href`, `headline`, `image`, `media` |                                                   |                         |
| `placement`                          | modal · inline · both · footer (both)             |                         |
| `priority`                           | number (0)                                        |                         |
| `audience`                           | list of guest · authenticated · paid · subscribed | empty = everyone        |
| `topics`, `concepts`                 | string[]                                          |                         |
| `match`                              | any · all (any)                                   |                         |
| `minTopicViews`                      | integer (0)                                       |                         |
| `cooldownHours`                      | number                                            |                         |

## Products — `content/store/products/*.md`

`title`, `subtitle`, `sku` (slug), `key` (8 hex), `kind` (book · good · membership · session · form — a form names the sku it is paid for with `#! paid = <sku>`), `billing` (once · subscription), `period` (weekly · monthly), `price` (dollars), `currency` (usd), `chat-hours`, `sessions` (a membership's sessions included: rows of `type`, `weekly`, `monthly`), `book` (for an unlock), `tier`, `rank`, `image`, `gallery`, `collections`, `badge`, `featured`, `order`, `tags`, `compare` (an old price as written, struck through beside the price), `rating` (0–5), `reviews` (how many, said beside the stars on a card and a Spotlight) and
`comments` (whether the page takes them). The body's `## ` sections are the product page's details.

An optional `usage` block names a billable unit and its provider-cost rate. One-time offers may
also set `grant` (prepaid whole units); subscriptions may set `included`, a unique `meter` event
name, and `overagePrice` per unit. A subscription may also set `incrementalCharge` to collect each
full currency threshold as a separate charge, with the period-end remainder collected once.
`speechCostPerSecond` declares endpoint speech cost when used.
The offer's stable `key` remains the billing identity across changes to its sku or price.

**What Stripe already does, declared per offer.** Four parameters, each off unless a file asks:
`trial` (whole days before a subscription is first charged — refused on a one-off at build, because
Stripe would refuse it at the till); `tax` (`{ automatic, registration }` — whether Stripe works the
rate out from where the buyer is, and whether a business buyer is asked for its VAT or tax number);
`payments` (the methods accepted beyond cards, from `card`, `link`, `apple_pay`, `google_pay`,
`cashapp`, `amazon_pay`, `alipay`, `wechat_pay` — **nothing by default**, because which methods a
shop accepts changes its fees, how fast it is paid and how disputes go, which is a business's
decision and not a kit's); and `adjustable` (`{ min, max }` — the quantity is the buyer's to change
in Checkout). It is `adjustable` and not `quantity` on purpose: a content file may never carry a
count of anything, since stock is a row, and the check that holds that rule refuses a field whose
name reads like one.

Across a cart of several offers: a trial is the subscription's own, since a subscription session is
one offer; tax is on if **any** offer asks, because the alternative silently under-collects on a
mixed cart; the payment methods are the **intersection**, so a cart never offers a method one of its
offers refuses. And a trial is **once per person per tier** — a weekly and a monthly offer of one
tier share one, so cancelling and rejoining grants nothing.

**The shapes it is sold in.** `options` is a list of `{ name, values }` — a value is a string, or
`{ value, label }` where the two differ — and every combination is a variant, in the options’
declared order. `sizes` is the short way to write one Size option and IS that option, so a shop
that only needs sizes need not learn the longer form. `variants` is a map keyed by the variant
(`leather.lined`) holding what differs for that one — `price`, `sku`, `weight`; anything it does
not say is the offer's. `unsold` lists the combinations the shop does not sell, the few rather
than the many it does; those are shown and unbuyable, never hidden.

**Where the shapes came from.** An option may carry `from`, the id of the supplier whose
catalogue it was taken from, and a value may carry `gone` — the supplier no longer makes it.
Neither is ever typed: _Read the catalogue again_ on the product writes both. A `gone` value is
kept rather than deleted, so every combination holding it goes off sale at once while a basket
or an unfulfilled order naming it still reads as the words the buyer chose.

**Who makes it.** `supplier` names one of the shop's suppliers
([Suppliers](/content/docs/reference/suppliers)); blank is something the shop makes or holds
itself. A garment (`kind: apparel`) also carries `blueprint`, the product type's id **from
that supplier's catalogue** — a file naming one the supplier does not sell is refused at the
build, at the save and at the till — and `design` (`{ artwork, area, scale, x, y }`: an
address in the library, and where it sits on the garment). `mockups` and `supplier_ref` are
written by the refresh and never by hand. See
[Selling garments](/content/docs/running-a-site/selling/garments).

`tracked` says the stock is counted and `backorder` that it may be sold past zero. **Neither says
how many** — that is a row, not a file. A count in a file would come back as whatever the file
said every time the repository was redeployed, which is the wrong answer every time; the build
refuses a content field called `stock`, `quantity`, `available` or their like by name.

> **The declared order of the options is the key.** `leather.lined` is Cover then Ruling because
> that is the order they are written in, so reordering them rewrites every variant key and
> orphans anything already in a basket. A value's slug is its identity and its label is not, so a
> label may be reworded freely after a sale. Neither is ever typed in the admin: the editor shows
> the options as rows and the variants as a table.

## Price lists — `content/store/prices/*.md`

`title`, `published`, `kind` (`override` · `sale`), `status` (`active` · `draft`), `currency`,
`starts` and `ends` (a window; neither means always), `priority`, `rules` (rows of `attribute`,
`operator` — eq · ne · in · gt · gte · lt · lte — and `value`; **every one must hold**) and
`prices` (rows of `sku`, `variant`, `amount` in whole money, optionally `min_quantity` /
`max_quantity`).

**A price list is a price, never a discount.** It says what a thing costs for some people, in
some market: a wholesale rate, a members’ rate, a country priced tax-inclusive. A product’s own
price is a list too — the **base** one — so a shop with one currency never writes one of these.

|            |                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `override` | the price **is** this, and it always wins. It may be **dearer** than the shop’s own price — a market that costs more costs more. Nothing is struck through. |
| `sale`     | a lower price, taken only where it **is** lower than the shop’s own, with the shop’s struck through beside it.                                              |

Where several apply: the one matching the most rules wins, and the cheapest settles an equal
pair. For "20% off", see promotions below — that is a different record and a different question.

## Promotions — `content/store/promotions/*.md`

`title`, `published`, `status` (`active` · `draft` · `inactive`), `kind` (`standard`; `buyget`
is reserved), `starts`, `ends`, and `rules` as above.

What comes off, and of what:

|                |                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `method`       | `percentage` or `fixed`, with `value` — per cent, or an amount in whole money                            |
| `target`       | `items` (the lines), `order` (the whole order), or `shipping` (the delivery)                             |
| `allocation`   | `each` · `across` · `once` — only for `items`                                                            |
| `max_quantity` | how many units of a line it reaches; absent means all of them                                            |
| `applies`      | rows of `sku` and optional `variant`; nothing listed means the whole shop                                |
| `budget`       | `kind` (`spend` · `usage`) and `limit` — what it may spend, or how often it may be used, before it stops |

> **`allocation` is what makes a flat amount mean anything.** "£10 off" is three different
> instructions: `each` takes £10 off every line it touches, `across` takes £10 once and splits it
> between them by each line’s share of the total, and `once` takes it off a single line. A
> percentage is unambiguous and ignores it.

> **A discount comes off whatever that person pays.** 20% off gives a member 20% off _their_
> rate and a stranger 20% off the shop’s. Writing "$14" as a price instead could say neither, and
> would be wrong the moment the product was re-priced.

> **Who gets it is yours to say.** No rules reaches everybody, members included. For a
> first-order discount, `customer.class ne subscribed` — and a member then keeps their own rate.
> That one line is the whole policy; nothing is inferred from how specific anything looks.

## Collections — `content/store/collections/*.md`

`title`, `subtitle`, `image`, `order`, `featured`, `products` (ids in order).

## The storefront — `content/store/storefront.md`

`heroEyebrow`, `heroTitle` (required), `heroSubtitle`, `heroImage`, `heroTheme` (kept for old files; the hero wears the site's ground now), `heroCta`, `heroHref`, `heroCta2`, `heroHref2`, `collections`, `featured`, `shelves`, `heroBooks`, `showMembership`, `showEditions`, `showCollections`, `showFeatured`, `showOnline`, `shipping` (`countries` | `exclude`, `default`, `overrides`, `methods[] { level, label, plus?, days? }`).

## Pages — `content/pages/*.md`

`title`, `route` (`/`), `seoTitle`, `description`, `image`, `progress` (a thin reading-progress bar along the top of the page), `owner` (a username: a coach's own page, which stands at `/p/<that username>` and which only they may edit — see [A person's own page](/content/docs/running-a-site/community/people-and-profiles)), `footer` (default true — false where the last thing on the page IS the end, as on a landing whose close is the ground the whole page has been walking toward), `sections[] { component, props }`; a body is optional and rare. A Hero's props carry `visual { kind: none | image | video | frame | phone | laptop | <a stage the site registers>, image, alt, video, poster }` and, for a stage, its words under `stage`. Every section's props take the look fields — `tone`, `glow`, `ground`, `spacing`, `width`, `reveal`, `anchor` — besides its own, which are its schema's (the [catalogue](/content/docs/running-a-site/content/pages)).

## Achievements — `content/achievements/*.md`

`title`, `sub`, `icon` (a glyph name), `colour`, `cover`, `canAccess` (who may read its body), `shown` (default true; false keeps it off every profile), `order`, `media` (an audio or video playlist, as an article's), `published` — and `when`, which is what earns it: `event` (an analytics event type), `where` (the props that must agree, a subset), `count` (how many, default 1) and `distinct` (a prop whose DIFFERENT values are counted rather than the rows — eleven books, not one book eleven times). The body is its page, at `/a/<slug>`. See [Achievements and traits](/content/docs/running-a-site/community/achievements-and-traits).

## Traits — `content/traits.md`

`visible` (the roles that may look at what the site believes about people; an administrator always may) and `rules`: rows of `id`, `event`, `where`, `key` and `value` — the value as written, or `prop:<name>` to take it from the event itself, which is how one rule covers every topic a library has. The body is prose for whoever reads the file. A trait is never shown to another member, and never to the person it is about. **The file is optional** — without one the site believes nothing about anybody.

## Teams — `content/teams/*.md`

`name`, `published`, `position`, `thumb`, and `fill` — who is in it, in the grammar a space's
membership uses (`role` · `tier` · `entitlement` · `bought` · `booking`, with the same windows;
a list of sets means any of them). The body is the line a surface shows beside the name.

**The file never names a member.** A declaration names classes of people and never a person, so who
is in a team is rows — `team_members`, each saying whether the rule swept them in, they were
invited, or they were put there by hand. The sweep removes only what it put there.

## Sessions — `content/sessions/*.md`

`title`, `sub`, `price` (as written), `scheduler` (`native` · `cal`; absent: `cal` when a `url` is set, else `native`), `url` (cal.com, for a cal.com type), `duration` (minutes), `hosts` (emails — or rows of `{ email, priority 0…4 (2), weight, a percentage (100), fixed: at every booking }` where the rota needs telling), `team` (a team whose members give it, where `hosts` names none), `assign` (`round-robin` one of them in turn, the default · `collective` every host together, the intersection of their hours · `managed` a copy per member at their own address and hours), `seats` (0 = one-to-one), `buffer` (minutes), `notice` (hours, default 24), `repeat` (booked as a run: `count` how many, `every` week · month · year, `most` the largest anybody may ask for — not `repeats`, and never both), `lengths` (a list — a number of minutes, or `{ minutes, price, sku }`; the first is the default and must equal `duration`), `name` (what the booking is called: `{reader}` · `{host}` · `{type}` · `{length}`), `confirm` (`true` the host confirms every booking · `"notice"` only inside the minimum notice · absent or false, booking it is enough; one that waits is `pending` and holds its time), `form` (a published form's slug, run between choosing a time and confirming; the answers reach the host with the booking, and a form that is gone or unpublished asks nothing), `page` (the booking page itself: `redirect` where a booking sends them, `notes` · `organiser` · `details` · `zone` whether that part is shown — every one on unless turned off — `cancel` and `reschedule` each `true` · `false` · `"notice"`, `past` whether a past or cancelled one may still be moved, `account` only somebody signed in, `hidden` off every list and reachable by its own address alone, `seatsLeft` and `attendees` what a group tells somebody), `interval` (minutes between the starts it offers, 15 when blank), `offset` (minutes into each stretch of hours the grid begins; less than the interval), `window` (a number of days ahead, or `{ from, to }` as days), `limits` (`day` · `week` · `month` · `year` how many of this type may be booked, and `minutesDay` · `minutesWeek` how long they add up to; counted across every host, absent or 0 is no cap), `schedule` (the NAME of a set of hours each host keeps — every host of the type is then read at their own set of that name, and a host who keeps no such set at their default; absent: everybody's default), `repeats` (a type that happens at a FIXED time rather than whenever suits: the recurrence grammar — `every`, `on`, `at`, `zone`, `lasts`, `interval`, `until`, `count`, `except` — whose occurrences are then its bookable times, the hosts' hours not asked; for a type this site schedules), `hours` (when it is bookable BY DEFAULT: `{ timezone, weekly }`, a weekday — 0 is Sunday — to a list of `[from, to]` in 24-hour time; a host who sets their own replaces it), `where` (`video` · `link` · `place` · `phone` · `none`), `link`, `place`, `address`, `phone`, `record` (a video room's: the room recorded into the recordings bucket), `requires` (anyone · guest · authenticated · a tier slug, meaning that tier and every higher rank · **a list of tier slugs**, meaning exactly those and implying no ladder; default guest), `below` (a tier slug), `sku` (a paid session's offer), `weekly`, `monthly` (0 = no limit), `order`.

## Spaces — `content/spaces/<slug>.md`

### `content/bots/*.md` — a bot

`name`, `avatar`, `model` (the kit's default where absent), `published`, `surfaces` (spaces · support · coaching · social — Social runs only through an authorized account automation for verified provider events; the provider author is anonymous to the app), `for` (who may summon it — the same grammar a space's `fill` takes), `serves` (who it may be RUN FOR, checked against the run's subject rather than the asker — on a desk those are different people, and where a bot answers by itself there is no asker at all), `spaces` (where it may be summoned, by slug), `hears` (what wakes it without being asked: `mention`, `schedule:` with a repeat, `event:` one of the platform's own), `skills` (what it knows it could look up — only each one's description is in its prompt; `all` is every published skill), `tools` (the kit's builtins by name, or a tool the site declares), `answers` (draft · directly — on a desk or in a coaching thread a bot drafts for a person by default, because there it would be speaking in somebody else's name), `endings` (what it says when it stops, over the words in the spaces scope), `limits` (`steps`, `spend` in whole money, `minutes`, `tools`, and `per` — a ceiling per person over a rolling window: `minute`, `hour`, `day`, `week`, `month`, every one given must hold, required when `offer` is not `off`), `memory` (none · thread · person · person+recall — the last adding what this subject has TOLD this bot, found by meaning, and the only one that writes anything down), `voice` (`say`, `voices` — the voices of its endpoint the site is happy to offer the reader, since the kit cannot enumerate somebody else's service and a list baked in would be wrong the week the provider adds one; its own ten need no declaring — `greeting`, `wait`, `visual` — aura · wave · radial · grid · bar, the shape of the orb — and, for the kit's own in-browser engine alone, `steps` (the solver's steps, 8 by default), `opening` (the steps the FIRST piece gets, 3 — it is the only piece anybody waits for, since the rest are made while it plays, so it is the only one worth making cheaply), `words` (how short the opening piece tries to be, 12 — cut at a clause and never mid-phrase) and `gap` (the pause between pieces, 0.12s against a chapter's 0.45s). How it sounds where it is spoken to; declaring it without the voice surface is refused, naming both) and `extends` (`desk` to start from the kit's own customer-service bot). **The body is the prompt.**

### `content/tools/*.md` — an ability

`description` (what the model reads to decide when to use it), `published`, `for`, and then either an OpenAPI spec or a module. For a spec: `openapi` (a path in this site or a url, read when the site builds so a bad one fails the build rather than a run), `operations` (which of them are allowed; blank is all), `base` (where the spec says nothing), `headers` (static, non-secret HTTP headers such as `User-Agent`) and `auth` (`header`, `env` — the variable a secret is in — and `prefix`; never the secret itself). For a module the site ships: `module` and `parameters`.

### `content/skills/*.md` — something a bot knows

`name`, `description` — **the whole interface**: it is all a bot sees until it opens the skill, so it says _when to use this_ rather than summarising what it says, and the compile refuses a skill without one — `tools` (offered only once the skill is opened), `for` and `published`. **The body is the instructions**, and it is not in any prompt until the bot opens it.

### `content/commands/*.md` — a slash command

`name`, `hint`, `surfaces`, `for`, and either `bot:` (with the body as what to ask it) or `run:` (a tool, with no model at all). `args` are **fields, never a syntax**: each a `name`, a `kind` (text · number · span · choice · person · channel · boolean), a `label`, an optional `default` and, for a choice, its `choices`. A kind no control can draw is refused by the compile.

### `content/events/*.md` — an event

`title`, `sub`, `cover`, `published`, `order`, `space` (which community it belongs to, by slug), `channel` (the room it is talked about in), `for` (who it is for — a tier's slug, or the same list-of-ways-in a space's `fill` takes; absent is everybody), `host` (the ROLE that hosts it — a declaration names classes of people, never a person), `where` (`room` for a huddle on this site, a url, or a place as words), `capacity`, `rsvp` (true or false, or a block saying how the asking works — `answers` the answers offered, `reason` whether one is asked for, `list` which answer counts as going), and when it is: either `starts`/`ends` for a one-off or `repeats` for one that happens again — `every` (day · week · month · year), `on` (`weekdays` · `weekends` · days of the week · `{nth, day}` · `{date}` · `{date, month}`), `at` (wall clock), `zone`, `lasts` (a span: `90m`, `2h`), `interval`, `until` or `count`, and `except` (days it does not happen). The body is what the event is. Its occurrences are expanded over a rolling year into the calendar tables and are never edited by hand, and `cost` (`price`, `currency`, and optionally `sku` and `key`) where a place is sold — the catalog turns it into an offer like any other, so the checkout knows the sku the page is asking money against.

### `content/spaces/*.md` — a space

`name`, `kind` (staff · community · server), `published`, `encrypted` (the default for the channels under it — see the channel below), `fill` (who is a member: `role` — a list of site roles — · `tier` · `entitlement` · `bought`, an offer's sku; absent or empty is invitation only. Written as a list of these, **any one is enough** — `- entitlement: subscribed` / `- role: [admin, support]` means a live membership OR anyone on staff — while the keys of one set must all match and **a key given several values matches any of them** — `tier: [inner, outer]` is either of those tiers, and nothing about a ladder is implied), `discoverable` (whether somebody who is not in it is shown that it exists and what it would take; a staff space never is), `hidden` (it exists and is used — the room an embedded comment thread lands in — but is left out of the rail, the front page and Find a space for an ordinary member; staff see it, and what may be read does not change), `welcome` (the one room a new member should read first, by its slug), `groups` (the headings its rooms are gathered under, in the order they are drawn), `cover` and `thumb` (its own pictures: a face on the community's front page and one in a list; a space with neither is drawn from its own name), `group` and `position` (the heading IT sits under in everybody's column, and its place among the other spaces — the site's own arrangement, not a person's), `history` (how far back each kind of person may read: rows of a who — `role` · `tier` · `entitlement`, or none, meaning everybody — and `days`, 0 being no limit; the most generous matching rule wins, and the staff are never limited by it), `roles` (rows of `slug`, `name`, `colour`, `rank` and `can` — the capabilities holding it grants), `flair` (the badges this space invents: rows of `slug`, `name`, `icon` — a glyph from the surface's own set — `colour`, `note` and `inline`, false where it shows on the card alone. What the badges are is declared; who wears one is an act and is never in a file), `join` (how somebody not in it gets in: `how` — `none`, the default, · `open` · `request` · `approve` — with an optional `question`, a `form` of this site answered before the ask is made, and `terms` they agree to; both are conditions of the ask, checked in the database and not by the page), `grants` (rows of `capability` — `voice` · `file` · `mention-channel` · `moderate` · `invite` · `announce` — and `to`: `everyone` · `tier:<slug>` · `role:<slug>` · `bought:<sku>`, the last taking `days`, with an optional `note`; a file never names a person). The body is what the place is, shown wherever somebody is offered or invited to it.

### `content/comments.md` — comments on things this site does not have

`kinds`, a list of `{ kind, allow, access, space, channel }` — `allow` is everyone · members · hosts — the kinds that are OPEN, meaning a thread under one is made the first time somebody comments rather than projected in advance. That is how an embed on somebody else's blog works: the site says the kind is open and on what terms, and the embed names the page. Everything of the site's own is projected from its own file and belongs nowhere near here. A site that declares none can be embedded nowhere, which is the right default — and **the file is optional**, so declaring none means not writing it.

### `content/community.md` — the community as a whole

Everything about the spaces surface that is not one space, and **content rather than config**, because every one of these is a decision an owner makes about how the place feels: `name` and `tagline` (what it is called wherever it is named), `cover` (the picture behind its front page; without one the page draws a mesh of the community's own hue, which is an answer and not a placeholder), `colours` (`rail`, `side`, `ink`, `on`, `link`, `badge`, `go` — the surface's chrome; each optional, each falling through to the kit's own, so a file that names one colour changes one colour), `home` (`opens`: feed · spaces, and `greeting`, `facts`, `compose`, `events`, `people` — which parts of the front page are drawn) and `features` (`events`, `huddles`, `polls`, `voice`, `files`, `tickets`, `forum`, `moderation` — switching one off takes its buttons, its places and its keyboard shortcuts with it). The body is what the community is. **The file is optional**: a site that writes none gets the kit’s own name, colours and features.

## Channels — `content/spaces/<slug>/<channel>.md`

`name`, `topic`, `mode` (stream · forum · feed — a feed only with the network module on), `visibility` (open · private), `encrypted` (end-to-end: readable only on the devices of the people in the room, so the site cannot search it, the staff cannot read a reported message, no bot may join it, and a new member reads nothing sent before they joined — the channel's own answer wins over its space's, and it cannot be taken back once the room has used it), `published`, `order`, `group` (a heading its space declares), `cover` and `thumb`, `hears` (the platform's own events written into this room: `purchase.paid`, `subscription.started`, `print.failed`, `account.new`, `support.escalated`) and `grants` (as above, applying to this room alone). The body is the room's own description; the channel's space is its folder.

## Experiments — `content/experiments/*.md`

`kind` (page · ad), `variants` — `variants[]` { key, item, weight }`, `goal`(a path),`ends`(date),`winner`(a key),`active`; notes in the body.

## The site — `content/site.md`

`name` (required), `tagline`, `description`, `url`, `image`, `mark` (an SVG or PNG logo for the share card — with none, the theme draws its own), `twitter`, `fonts` (the three typefaces — `heading`, `body`, `mono`, each a family from the kit's list; a slot left unset is the theme's own, and the build writes the stylesheet link and the tokens from them, so no site edits its `index.html` to change a face), `tokens` (the colours this site changed, over the look's own: keyed by the look's selector and the token — `"--accent"`, `".lproot --ink"` — with a colour for the day or `{ light, dark }` for both; anything absent is the look's own. Every one of them is offered in Site settings), `look` (one of the config's looks).

`nav` is **the links across the top**, and it is the most specific of three layers: the theme’s own by rule (the library, pricing where a page claims that route, the store while the module is on), then a `nav` in `platformkit.config.js`, then this. The most specific that EXISTS is the whole list — they are never merged, because a merged list has no answer to “remove the third item”. An item takes `label` (its words, a site’s own — or `key`, naming one of the theme’s strings so a built-in stays translatable), `href`, `icon` (a glyph by name), `prefix` (highlights for every path beneath it), `see` (who sees it) and `cta` (at most one, drawn as the header’s button rather than a link). Order on the page is the order written.

`see` is a rung on the class ladder the rest of the platform uses — `authenticated`, `paid`, `subscribed` — and is a **minimum**, so an item asking for `paid` is also shown to a subscriber. `guest` is the one exact state, which is what a “Sign in” item wants; `tier:<slug>` is that membership tier or a higher rank; `staff` is an administrator or a support agent. An item naming none is shown to everyone, and an item pointing at a route a module has switched off is never drawn, whichever layer wrote it.
`footer` is **the foot of every page**, because a footer a page has to remember to include is a footer half the pages are missing. It takes the Footer section's own shape — `layout` (columns · mega · minimal), `about`, `columns[] { title, links[] { label, href } }`, `capture`, `social[] { label, href }`, `legal` (`{year}` is the year), `small[]`, `call` — and a site that writes none has none, which is what a docs site wants. A page turns it off with `footer: false`, and a page whose own sections name a Footer draws that one instead.

## The provider policy — `content/providers.md`

`offerings` (on · off — may providers offer anything of their own), `approve` (on · off — does a new offering wait for a person before it can be bought), `terms` (the current version; the file's **body** is the wording), `payout-delay` (a span — nothing is payable until this long after the money was collected), `connect` (managed · own — who onboards the provider's account). Everything ships as the cautious answer. A version anybody has signed is frozen: change the body and the version together, or the projection refuses it. See [providers and payouts](/content/docs/reference/suppliers).

## Funnels, blasts, the policy — `content/funnels/*.md`, `content/blasts/*.md`, `content/emails/policy.md`

A funnel: `title`, `published`, `design` (campaign), `cooldown` (a span), `audience` (the rules), `goal` (optional: a path on the site beginning with `/`, the page somebody reaching means the email worked — counted by the funnel analytics), then a `# ` step each with `id` (_build_), `after` (a span), `subject`, the body — or `channel: chat`, `when`, `teaser`, `image`, a closing `- ` list of choices. A blast: `title`, `subject`, `design`, `audience`, `respect-cooldown`, `goal` (the same), `status`, `sent_at`, `sent`. The policy: `daily`, `weekly`, `monthly`, `blasts-respect-cooldown`, `support-wait`, `support-presence`, `support-keep-files`, `recordings-keep` (days; 0 forever), `session-reminders` (a list of hours before a native session; absent = 24 and 1, empty = none).

The audience rules: `inactive`, `signed-up`, `since-purchase`, `since-session` (a span, `7d+`, or `none`); `subscription`, `interest`, `level`, `bought`, `not-bought` (lists); `answered` (`area.key = answer`); `verified` (boolean).

## Content models — `content/models/<key>.md` and `content/models/<key>/*.md`

A model's record: `key`, `name`, `singular`, `published`, `title` (a field key), `slug` (`title` or a text field), `singleton`, `body` (`true` or a label), `access` (the class ladder), `order` (`{ by, dir }`), `deliver` (`pages`, `json`, `section`), `fields` (each `key`, `kind`, `label`, `help`, `default`, `required`, `unique`, `grid`, `shown`, `rules`, and the kind's own: `options`, `model`, `many`, `of`, `fields`). An entry's frontmatter is the model's fields, `published` (default true), and whatever a model no longer has (kept, ignored); the body when the model has one. Written by the builder and the drawer; see [Content models internals](/content/docs/building-a-site/content-models-internals).

## Forms — `content/forms/*.md`

A forms.md document, no frontmatter of the kit's own: its `#! key = value` lines are the settings — forms.md's (`title`, `page`, `page-progress`, `slide-controls`, `restart-button`, `submit-button-text`, `autofocus`, `button-alignment`…) and the kit's: `published`, `once`, `respond` (anyone · authenticated), `embed-origins`, `webhook`, `pass`, `score` (`field: answer, …`). `post-url`, `get-url` and `post-sheet-name` are refused. See [Forms internals](/content/docs/building-a-site/forms-internals).

## UI strings — `content/app/ui/<scope>.md`

`scope` in the frontmatter; the body as `## group` / `### key` / `field: value`.

## Tests (a site with an instrument) — `content/app/tests/**`

A diagnostic: `area`, `title`, `order`, `published`, `timing`, `display { truth, mode }`, `round { per, order, choice, fast }`, `blank { skip, place, per }`, `levels` (a record keyed by level id, each with a `name` and an optional `plain` — the words THIS area uses for the three levels, where the glossary's own are not right for it), `spec` (kept verbatim), `movements` (block YAML), and the body's `## <movement>` / `### tier n` / `- (R) (B) (!) (D) statement {#key}`. Each statement key keeps saved answers attached to that statement if its wording or position changes. For a hand-written file, `node build/statement-keys.mjs` adds missing keys; `--dry` previews the change, while `--all` deliberately replaces every key and makes existing answers stop matching.

The personality test: `kind`, `title`, `intro { headline, body }`, `prompt` (the one line asked above every pair) and the body's `## <n> <Name>` + `- statement`.

The word test: `kind`, `title`, `timing`, `voice`, `intro { headline, headlineNoMic, body, bodyMic, bodyTail }` — two headlines and two bodies because the screen says something different where there is a microphone and where there is not — then a record per round of the test, each a `label` and a `prompt`: `recall` (say the word that comes), `again` (the same words a second time) and `lookback` (what the reader makes of it afterwards, which also carries its `options`). The body is `## words` + `- word | orig: X | why: Y`.
