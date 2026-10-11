---
title: Funnels and blasts
description: Drip campaigns, one-off sends, the audience rules, the policy, chat prompts, and what comes back.
order: 36
sources: [packages/kit/build/funnels.mjs, packages/kit/build/funnel-io.mjs, packages/kit/supabase/functions/_shared/emails/rules.js, packages/kit/supabase/functions/funnels-run, packages/kit/supabase/functions/email-blast, packages/movable-types/src/components/admin/FunnelsAdmin.vue, packages/movable-types/src/components/admin/BlastsAdmin.vue, packages/movable-types/src/components/admin/AudienceEditor.vue]
reviewed: 2026-10-01
---

Marketing mail is markdown, targeted by what the account knows, under a cooldown. Marketing → **Funnels**, and the **Blasts** tab of Marketing → Emails. Module: `funnels` (and `emails` to send).

## A funnel

A funnel is a sequence of emails sent to an audience over days. Its record: a title, Published, the **design** it is piped through (`campaign` by default), a **cooldown** (the least gap between two of *its* emails to one person), the **audience** (the rules), an optional **goal** — a path on the site, the page somebody reaching means the email worked, which the funnel's analytics count — and its **steps**.

The editor is one view at a time:

- **Audience** — the rules an audience has, each with its own control, and *Add a rule* for the rest; beside them *who matches now* — a count, never the list. Among them **Holds the role** and **May**, which are the same two things a bot is gated on, in the same words: one vocabulary, so "the coaches" is sayable to an email audience as well as to a bot.
- **Emails** — the steps in order. An email step has **after** (how long after the previous step it goes — after entering the funnel, for the first; a number and a unit), a **subject**, and the email's body in the editor. A **chat** step has triggers instead (see below).
- **Settings** — the title, the design, the cooldown, the goal, Published, and *Preview a run*: what the runner would send for this funnel right now; *Analytics* at the top opens the funnel's own page under Marketing → Funnels → Performance.

Every hour the platform takes each published funnel's audience, each person's place in it, the step due, the cooldowns (the policy's counts and the funnel's own gap), sends what is due through the campaign design, and moves them on. Someone who stops matching stays where they are until they match again. Every step has an identity written into the file on its first save, and the log is keyed on it: a person gets a given email **once, ever** — however the funnel is renamed or its steps reordered.

## A blast

One email, sent once, to an audience: **Email** (subject and body) · **Audience** (the rules) · **Send** (a count, a confirmation, the record). A blast goes to its audience less anyone on hold and anyone the log already shows it went to, so a send cut short is finished by pressing again. A sent blast is the record and is never edited.

## The audience rules

Every rule given must hold; a list means any of; the opted-out are never included. The rules, in the words the form uses:

| Rule | Reads |
| --- | --- |
| **inactive** | how long since the last event or answer (`7 days or more`) |
| **since sign-up**, **since purchase**, **since session** | the profile's age; the last paid purchase; the last coaching session attended (or *none*) |
| **subscription** | the live membership tier, or none |
| **interest** | content read or a diagnostic area taken |
| **level** | where a site's readings placed them (a site with an instrument) |
| **answered** | a specific statement as answered |
| **bought**, **not bought** | a product, by sku or a book's slug — had it, or never had it |
| **verified** | the address has answered its confirmation |

## The policy

Behind *sending rules* on the Funnels page: the most marketing emails one person gets a day, a week and a month — funnels and blasts together — and whether blasts respect a funnel's cooldown. Transactional mail never counts. The same panel holds two settings that are not marketing — how long a coaching call's recording is kept (*Keep a call's recording for … days*, 0 forever) and when somebody is reminded of a session the site scheduled (*Remind before a session*: a list of hours, each its own field to add or remove; 24 and 1 by default, none when the list is empty; see [Sessions and coaching](/content/docs/running-a-site/bookings/sessions-and-coaching)); the support desk's clocks stay in the file.

## Chat prompts

A funnel step may be a **chat prompt** instead of an email: its channel is *chat*, it has **triggers** rather than a delay and a subject — rows, each a kind from a list (on the site for so long, on a page matching a path, on the page for so long, signed in or not, returning, something in the cart) with a control per kind — and its body is the line it says. It may end with **choices**, edited as a tree of rows with follow-ups, and carry a **teaser** (the short line shown above the launcher before the panel opens) and a picture. The browser shows it when every trigger holds; nothing is sent; it becomes a thread only when the person replies. A prompt is outside the email sequence — the runner never sees it — and the funnel's audience is its audience (no rules: everyone; rules: matching signed-in people, never a guest). See [The support desk](/content/docs/running-a-site/community/support-desk).

## What comes back

Every link in a marketing email and its open pixel are tracked under random tokens that name nothing; the unsubscribe link is left plain but for the send it was in, so an opt-out is credited to its email. The cards on Funnels and on Emails → Blasts say **sent · opened · clicked** per email (a click marks the email opened but is not another open); the whole reading — the journey step by step, who waits between steps, what was clicked, when it is opened, unsubscribes and what a click led to — is Marketing → Funnels → **Performance** (see [Analytics](/content/docs/running-a-site/settings/analytics-and-notifications)). A blast may name a **goal** too, on its Audience view.

## Two warnings

Never send a blast or run a funnel for real from a development copy against real addresses: the relay is the real one. And never key anything on a funnel's or blast's file name — the identities are in the files.
