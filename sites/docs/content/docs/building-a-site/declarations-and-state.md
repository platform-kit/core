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
reviewed: 2026-10-27
---

Use this rule to decide whether information belongs in a content file or in the database:

> **If the database were deleted and the repository redeployed, should this come back?**

**Yes:** it is a **declaration**. Store site content in a file under `content/`; store deployment
settings in `platformkit.config.js`. A database may hold a **projection** generated from a
declaration. Projections flow from the declaration to the database and are not edited directly.

**No:** it is **state** created while the site runs, such as a purchase or a message. Store it in
the database, not in a content file.

**Neither:** it is **derived data**, produced from declarations or state and safe to recreate. A
projection has a content source and must be restored from that source; a derived table can be
empty after a reset and is rebuilt when needed. Examples include a fill-rule membership, the search
index, and `print.json`. `public.compiled` is a special derived table containing compiled catalog,
form, and funnel data for deployments that do not rebuild on publish. The declarations checks keep
session-bound code from depending on that table.

## Example: encrypted-channel device keys

`space_devices`, `space_one_time_keys`, `space_to_device`, and `space_key_backups` hold device
encryption keys and related session data. They are state: deleting the database requires readers to
set up their devices again, and existing encrypted messages may no longer be readable. They must
not be stored in the repository, where deployment could expose them or restore stale keys.

## Declarations define rules; state records individual actions

Content files may define a rule such as “everyone with the inner tier” or “moderators.” They should
not name individual users. The database records which people actually joined a room and what they
did there.

Tables that link people to records include a `source` field. For example, a membership may come from
`fill`, `invite`, or `manual`; a grant or webhook subscription may come from `file` or `hand`.
Projection updates remove only rows owned by the declaration, preserving rows created manually.

> A promotion's usage limit is a declaration; the number of redemptions is state in
> `promotion_usage`. Keeping the count in a file would reset it on redeploy.

## Publishing declarations

In cloud mode, each content file has a `public.content` row with a live version and a draft. The
admin edits the draft. Publishing makes it live and pushes the change to the repository in one
commit.

Modules do not need separate synchronization paths. Admin editors update declaration files through
the content pipe; build or publish steps update their projections, such as a supported payment
provider's catalog or the search index. An admin editor must not write directly to a projected
table.

## Table classification and checks

`build/declarations.mjs` classifies each kit table as projected, state, or derived. A projected
table names the content path that produces it. `build/declarations.test.mjs` checks:

1. Each table appears in exactly one classification.
2. Projected tables do not grant writes to signed-in clients.
3. Kit and theme client code does not write to projected tables.
4. Each projected table names a path produced by a content collection, or a content folder that a build script reads itself and `build/content-kinds.mjs` records with no collection. Courses are read that way, so a lesson's text never reaches the browser before it is open.
5. The script that writes each projected table runs on a reset (`build/reset-seed.mjs`, the steps `platformkit migrate reset` and the end-to-end run share). A projection nothing restores is an empty table after a reset, and an empty table does not fail.

Pending entries document an in-progress transition to file-backed declarations. Each names the
change that will complete it; an entry whose change is no longer active fails the check. The
spaces declarations now live under `content/spaces`; see [Spaces and channels](/content/docs/building-a-site/social-network).

Secrets are not declarations or state records. Keep them in environment variables, never in content
files or the classification lists.

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
| Courses    | a course, its sections and lessons, its cohorts and how it is released                                            | enrollments, lessons finished, what each person was told, certificates                                                                                        |
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
