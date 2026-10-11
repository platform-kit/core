---
title: Declarations and state
description: The one question that decides where anything lives, the manifest every table appears in, and the checks that make the wrong answer impossible.
order: 42
sources:
  [
    packages/kit/build/declarations.mjs,
    packages/kit/build/declarations.test.mjs,
    packages/kit/build/cloud-config.mjs,
    packages/kit/build/webhooks-config.mjs,
    packages/kit/build/webhooks-push.mjs,
    packages/kit/build/webhooks.test.mjs,
  ]
reviewed: 2026-10-09
---

A site is meant to be a folder: markdown and `platformkit.config.js`, deployable as it stands, with
the cloud CMS an implementation detail. One question decides where anything lives.

> **If the database were deleted and the repository redeployed, should this come back?**

**Yes** — it is a **declaration**, and it is a file under `content/` (or, for things that are about
the deployment rather than the site's content, a field of `platformkit.config.js`). The database may
hold a **projection** of it, and that projection is one-way: written by the build or a service role
from the compiled collection, never edited, never merged, never consulted about what the site is.

**No** — it is **state**, and it lives in the database and nowhere else.

**Neither** — it is **derived**: a cache of what is already here. A projection has a source under
`content/` and a script that makes the database agree with it, and it must be there after a reset.
A derived table need not be: an empty one is a correct state and whatever reads it has an answer
without it. `public.compiled` is the one the kit ships — the compiled catalog, forms and funnels for
a deployment that cannot rebuild to ship them as files — and `build/declarations.mjs` holds it in a
third list, `DERIVED`, with the rule that makes a cache safe: nothing with a session may read or
write it, because nothing with a session may depend on a table the site is free to empty.

There is a third answer that looks like a fourth category and is not: **derived**. A membership made
by a fill rule, the search index, `print.json`, a projected row — none of them are authored, and
whatever writes them owns them. What makes them safe is that nobody edits them.

## The clearest case of state there is

A device's keys are the sharpest example the kit has of the question at the top of this page, because
the answer sounds wrong until you say it out loud.

`space_devices`, `space_one_time_keys`, `space_to_device` and `space_key_backups` hold what an
encrypted channel needs. **If the database were deleted and the repository redeployed, should they
come back?** No — and not merely "no, they are state": they _must not_. A device is an act, somebody
signing a client in on a laptop. Drop them and every reader sets a device up again and every message
already sealed becomes unreadable, which is the guarantee WORKING rather than the guarantee failing.

There is no file anywhere that could bring a private key back, because there is no file anywhere that
ever had one. A declaration that could restore them would be a declaration that could read every
room — which is the thing being refused.

## A declaration names classes of people; only the database names a person

A file may say _everyone with the inner tier_, _whoever bought the guild pass_, _moderators_. It can
never say _Ada_: there are no real people in the repository. Putting somebody in a room is an act,
and acts are rows.

That is why every table tying a person to something carries a **source** — `fill · invite · manual`
for a membership, `file · hand` for a grant or a webhook subscription — and why a projection only
ever deletes what a file owns. The thing somebody did by hand always survives the next deploy.

> **A budget is the clearest case of the split there is.** The limit — "this discount may be
> used two hundred times" — is a declaration and lives in the file. How many of those two
> hundred are gone is state and lives in `promotion_usage`, because a file that said `used:`
> would reset a half-spent campaign to full every time the repository was redeployed.

## One loop, and no module builds a second

Because a declaration is a file under `content/`, cloud mode's own machinery already carries it: the
file is a row of `public.content` holding a live version and a draft, the admin edits the draft, and
publishing makes it live and pushes to the repository as one commit. Markdown → database → git, and
round again.

So a module writes no synchronisation path of its own. The only thing it writes is the projection —
the same shape as `catalog.json` → Stripe, or the search index. **An admin surface never writes a
projected table**: it writes the file, through the pipe, as a record of the admin's own registry.

## The manifest, and why it is not a document

A rule written in prose is obeyed until somebody is in a hurry. `build/declarations.mjs` lists every
table the kit declares as either projected — with the content path it comes from — or state, and
`build/declarations.test.mjs` runs four checks in `platformkit test`:

1. **Every table appears in exactly one list.** A new table with no entry fails the build. This is
   the forcing function; the rest are consequences.
2. **A projected table grants no write to a signed-in role.** Not _should not_ — _does not_: its
   policies are read-only for clients and the projection is written with the service role. The
   mistake becomes impossible rather than discouraged.
3. **No client code writes one**, by a grep of the kit's and the theme's source.
4. **Every projected table names a content path a collection actually produces**, because a
   projection with no source is a table pretending to be a declaration.

A fifth state, `pending`, is a declaration that is not a file _yet_: it names the change that will
move it, the checks step over it, and every run prints it so the debt is loud. An entry naming a
change that is not live fails. The five spaces tables were the first entries and are no longer
pending: a space, its rooms, its roles and the grants a site ships are files under `content/spaces`
(see [Spaces and channels](/content/docs/building-a-site/social-network)).

Secrets are in neither list, on purpose. A secret is an environment variable; it has never been a
declaration or state, and naming it here would invite somebody to put one in a file.

## Where the line falls

|            | Declaration                                                                                                       | State                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library    | every article, book, companion, page                                                                              | what was read, and how far                                                                                                                                    |
| Store      | offers, collections, the storefront, print blocks                                                                 | purchases, subscriptions, entitlements, orders, carts                                                                                                         |
| Sessions   | the types, and the hours they are bookable at by default                                                          | bookings, paid-Checkout fulfillment claims (the private `booking_checkout_fulfilments` table), a coach's own hours and overrides                              |
| Emails     | designs, funnels, blasts, the policy                                                                              | the log, the links, the events, a person's place in a funnel                                                                                                  |
| Support    | the desk's prompts, canned replies, the policy                                                                    | contacts, conversations, messages                                                                                                                             |
| Social     | provider applications, connections, posts and account-scoped automations                                          | publisher grants, verified inbound events, response deliveries and their outcomes                                                                             |
| Spaces     | spaces, channels, roles, grants, what a room hears, whether a space is discoverable, its headings and its welcome | memberships, roles held, messages, counters, a grant given to one person, an invitation and who used it, every act of moderation, what the desk finished with |
| Network    | nothing — no file declares a post, a follow or somebody's page                                                    | posts, likes, reposts, follows, blocks, mutes, pinned spaces, every act of moderation, an identity on the wider network, app passwords and sessions           |
| Instrument | the three tests, the bank, the results copy                                                                       | answers, results, signals                                                                                                                                     |
| API        | the subscriptions a deployment ships                                                                              | the keys' hashes, the subscriptions people make                                                                                                               |

`booking_checkout_fulfilments` is state rather than a content declaration: it is a private claim keyed by Stripe Checkout Session id, with the booking outcome. The resulting `bookings` row also retains that id under a unique index, so replaying the payment event cannot create a second booking.

Social automations are state rather than content declarations: `social_automations` records the
publisher's rule for one connected account, `social_inbound_events` records verified provider
activity, and `social_automation_responses` keeps each public reply or private message and its
delivery outcome separate.

## Two things a deployment declares rather than clicks

**Where cloud mode publishes.** `cloud: { repo, branch }` in `platformkit.config.js`, written to
`_shared/cloud.json` by `build/cloud-config.mjs`. A fresh deployment already knows where it
publishes, and the admin shows it rather than asking for it. The **token** is a secret and stays in
`app_settings` — it is the one thing that page still asks for.

**The webhook subscriptions it ships wired.** `webhooks: [...]` in `platformkit.config.js`, each
naming a kind (`content · form · scheduling · support`), its address, and — where that kind keeps
one — a **secret by the name of an environment variable**, `env:SOME_NAME`. A bare value is refused,
so a secret cannot reach the repository by accident. `build/webhooks-config.mjs` writes
`_shared/webhooks.json` (with the variable's _name_, never its value) and `build/webhooks-push.mjs`
makes them real at deploy time: a subscription that stays is updated rather than remade, so what it
has done survives; one the file no longer names is removed; one somebody made through the API is
`source: 'hand'` and is never touched.

The four subscription tables were written by four modules and do not agree on what a subscription
looks like — one calls the address `subscriber_url`, two keep a secret and two do not, each has its
own word for what it is subscribed to. Rather than making them agree, the shape each wants is said
once, in `KINDS`.
