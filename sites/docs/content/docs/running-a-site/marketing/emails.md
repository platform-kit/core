---
title: Emails
description: The email designs, the editor, test sends, subjects, and which email goes when.
order: 35
sources:
  [
    packages/kit/build/emails.mjs,
    packages/kit/supabase/functions/_shared/email.ts,
    packages/kit/supabase/functions/_shared/emails/tags.js,
    packages/kit/theme/src/components/admin/EmailsAdmin.vue,
    packages/kit/build/auth-config.mjs,
  ]
reviewed: 2026-10-01
---

Every email the site sends is a **design** built in the admin, compiled at build time, and filled with the real facts when it is sent. Marketing → **Emails** is a rail of the designs, one open in a drag-and-drop editor mounted with the site's colours and fonts. Module: `emails`.

## The designs

| Design                                                       | Sent when                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **order**                                                    | Once per paid checkout — the order's confirmation, with the files' letter when a purchase carries a PDF or EPUB                                                                                                                                                       |
| **shipped**                                                  | The moment a print order turns to shipped, with its tracking                                                                                                                                                                                                          |
| **chat**                                                     | A coaching message the recipient was not there to see (one per unread burst, none while they were on the page in the last two minutes)                                                                                                                                |
| **support**                                                  | The same, for the support chat's contact                                                                                                                                                                                                                              |
| **support-digest**                                           | The staff's escalation: the threads due, one letter per recipient                                                                                                                                                                                                     |
| **confirmation**                                             | Supabase's own send: the address's confirmation and the magic-link sign-in                                                                                                                                                                                            |
| **recovery**                                                 | Supabase's own send: the password reset                                                                                                                                                                                                                               |
| **invitation**                                               | Supabase's recipient-bound invitation to a Social publisher                                                                                                                                                                                                           |
| **campaign**                                                 | The frame every funnel step and blast is piped through: the written email in a block, the unsubscribe link                                                                                                                                                            |
| **session-booked**, **session-moved**, **session-cancelled** | A session the site itself scheduled: to the person and the host alike when it is booked, moved or cancelled, each with a calendar invitation attached (the place in its location; a cancellation withdraws it) — never for a cal.com booking, which has cal.com's own |
| **event-reminder**                                           | To everybody who said they were coming to an event, at the same hours                                                                                                                                                                                                 |
| **provider-terms**                                           | The moment a new version of the providers' terms is published — to every provider still on an earlier one, with the terms themselves in the letter                                                                                                                    |
| **session-reminder**                                         | To the person, at each of the hours before the session the sending rules name (24 and 1 by default)                                                                                                                                                                   |

Each design's **subject** is a line under UI strings → `emails` (`## <kind>`, `### mail`, `subject`); the editor shows the theme's default until the site writes its own. Beside the subjects the file holds the session emails' lines for a place (`## session`: where a video call, a link, an address or a phone number is said) and the policy panel's labels, and nothing else about the emails.

> Where a deployment cannot rebuild ([cloud mode](/content/docs/running-a-site/settings/cloud-mode) with git
> out of the cycle and no deploy hook), **a publish compiles the designs itself** — in the Edge
> Function, with the same browser build of MJML the editor's Test uses — and the mailer reads what it
> wrote. Nothing about editing a design changes.

## What a design may say

A design uses a small set of tags — `{{name}}`, a list of `{{#each lines}}`, a section shown `{{#if ships}}` — and each email has its own list of what it may say, with a sample of each. Shape a real order to those names; never invent a tag in a design. The build refuses a design that will not compile or whose sample leaves a tag unfilled, so a broken design fails a deploy rather than a customer's inbox.

The confirmation, recovery and Social invitation emails are not filled by the site: their link is Supabase's own token, left exactly as written, and the compiled design goes to Supabase whole at deploy. The editor refuses a confirmation, recovery or invitation design whose button does not go to the token.

## Test sends

**Test** in the editor compiles the design as it is, in the browser, fills it with the sample, and shows it; **Send me a test** sends it to your own address through the site's relay. Neither touches a real order.

## Sending

Mail goes over the site's SMTP relay (Mailgun's, or any other). With the relay unset, nothing is sent and the action that would have sent it stands — an order is never lost to a missing email. The deploy demands the relay settings always.

## Marketing mail

Funnel steps and blasts are markdown written in the funnel editor, piped through the `campaign` design with the person's first name and their unsubscribe link. Every link in one is tracked and every open counted, per email; the cards in Funnels and Blasts say sent · opened · clicked. See [Funnels and blasts](/content/docs/running-a-site/marketing/funnels-and-blasts).

## The policy

`content/emails/policy.md` — edited from the Funnels page's _sending rules_ — caps the marketing emails one person gets: **daily**, **weekly**, **monthly**, funnels and blasts together, and whether blasts respect a funnel's cooldown. Transactional mail (an order, a reset, the chats) never counts. The same file holds the support desk's escalation clocks.
