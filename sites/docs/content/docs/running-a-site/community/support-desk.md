---
title: The support desk
description: The support chat people see, the inbox the staff answer from, the prompts that start conversations, and the emails around it.
order: 32
sources:
  [
    packages/kit/supabase/functions/support,
    packages/kit/src/lib/support,
    packages/kit/theme/src/components/support,
    packages/kit/theme/src/components/SupportAdmin.vue,
  ]
reviewed: 2026-10-09
---

The support desk is a chat on every public page — for a guest and a signed-in person alike — and an inbox for the staff. It is kept entirely apart from the coaching chat: its own conversations, its own words, its own people. A support agent never sees a coaching thread, and a coach's inbox never fills with returns. Module: `support`.

A voice note — a contact's or an agent's — arrives with a transcript under it, written down by
whichever browser recorded it, so the desk can read a thread without playing it.

## What somebody sees

A launcher in the corner of every public page (never on the admin, never in a video call — its bar sits where the launcher would — and never for the staff). Where a page docks a bar along the bottom — the community's, on a phone — the launcher rides above it (the page sets `--pk-dock` to the bar's height). It opens a panel: the person's conversations, one open thread, or the start of a new one. A thread takes text, a voice note, or one file per message (a picture, shown inline; a PDF or text file as a chip; 10 MB). The other side is the site's mark until a person has answered, then that person's initials and name.

**Identity is the account.** A guest types no name and no email into the chat: a typed claim is not an identity, and nothing real may hang off one. A guest is anonymous and remembered by a token in their browser; the panel offers the site's own sign-in to be reachable. Somebody's name and address come from their profile, and the panel offers the confirmation link again to an address that has not answered it. When a guest signs in or up, their conversations move onto the account.

Once per thread, after the person's first real line, a system line says the message is in and a person will answer when they can.

**Messages and tickets are two tabs, not one feed.** A conversation is something the person is having; a ticket is something somebody owes them, and a ticket can outlive the chat it came out of by weeks. So the panel's list has a tab each: their tickets with the state of each in words, one ticket with its timeline and a reply box at the foot, and **Report a problem** for opening one themselves (capped, like everything else a guest may do). What they see of a ticket is the public timeline — what was written to them and what changed — and never the desk's own notes; that filter is applied in the query, not by hiding rows in the page.

## The inbox

Community → **Support** — in the editing admin and on the live site alike, the one rail; a support agent's rail holds Support and Notifications and nothing else. The staff are accounts with the **admin** or the **support** role.

- **Filters:** status (open · pending · resolved), who (guest · reader · customer — a customer is an account with a paid purchase or a live membership), whose (mine · unassigned · all), unread. Sort by longest waiting or by activity.
- **A thread:** the conversation, the contact's card (kind, last seen, last page, orders, and what a page set on the contact through `$chatwidget` or the Client API as key: value lines), a **private note** on the contact that only the staff see, the reply box with **canned replies** above it (edited under UI strings → support, `## canned`), a voice recorder, a file clip. Typing shows both ways.
- **Actions:** assign to me, pending, resolve, reopen; **Export** a transcript; **Delete** a thread (its files first, then the thread). A line may be withdrawn by whoever wrote it; the bubble stays as a placeholder.
- A contact's line on a resolved thread reopens it.

The inbox follows the tables live: a new line lands without a reload, and with **Alert me** on (the browser's own permission, remembered per browser) a contact's line that arrives while the tab is hidden or another thread is open raises a notification and a short tone.

## Who is told, and how

**The staff are never emailed per message.** They are told in the inbox, by the browser alert, and — with the push module on — by a [web push notification](/content/docs/running-a-site/settings/analytics-and-notifications) on a new conversation or a new line.

Email is an **escalation** only: every five minutes the platform looks for threads that are open, unanswered for longer than the policy's _support wait_ (minutes), while no agent has been in the inbox within the _presence_ window, and sends one digest per recipient listing every thread due — the assignee's own to the assignee, the rest to the support address (else every staff address). Only a contact who can be answered by email (a confirmed account) counts; a guest never costs the staff an email. A thread is escalated once. The two clocks are in the emails policy file; the admin's policy panel edits the email counts and leaves the clocks as they are.

**The contact** is emailed about a reply they were not there to see — nothing while they were on the site in the last two minutes, one per unread burst — with a link that opens the panel on the thread. Never a guest, never an unconfirmed address.

## Prompts: conversations that start themselves

A **chat prompt** is a step of a funnel whose channel is _chat_: a line the browser shows as a card above the launcher when its triggers hold — so many seconds on the site, on such a page, so long on it, signed in or not, returning, with something in the cart. Nothing is sent; nothing is a thread until the person replies. A prompt may carry a picture (a gif — shown on the card above the launcher on a wide screen, and on a phone only once the panel is open, where it would otherwise fill the screen) and may end with **choices** — buttons the person picks from, which may nest into follow-ups up to three deep. A prompt is shown once, ever, per person; a thread per prompt per contact is unique. Prompts and the launcher use the same `mayInterrupt()` guard as ads: it blocks reserved work areas plus the site's configured feed, spaces and people routes. If the route changes or becomes ineligible while a prompt or default nudge is being resolved, the result is discarded before it can claim the corner.

One prompt is **the desk's default** (`when: default`): not a trigger but the line the panel rests on at the top of every new conversation. It nudges once per visit with its short _teaser_ line a few seconds after arrival, until the panel is opened or the card put away. Somebody may start as many threads on it as they like.

**A choice may point somewhere.** An arrow at the end of one takes the person to a form or a page, and the choice is still recorded like any other:

```
- My item has not arrived yet.
- Something is not working -> form:report
- Read the refunds policy -> /content/docs/refunds
```

That is the whole of what a desk with no language model needs: a prompt somebody wrote by hand that still collects the four things nobody wants to ask one at a time over three days — see [a form that raises a ticket](/content/docs/running-a-site/marketing/forms).

**And a bot may offer them too, in the same words.** An assistant's answer whose last lines are a list ends in the same buttons — arrows and all — in the widget, in a room, and on a forum post. What somebody presses is sent as their own next words, so the thread reads as a conversation rather than a form being filled in, and the bot is asked again with it. Only the **last** offer can be taken, and only once: an older set stays under its answer, faded, with the one that was taken marked. They go the moment somebody asks for a person. See [what a bot may put in an answer](/content/docs/building-a-site/bots#offering-a-choice).

Prompts are edited in Marketing → Funnels as steps of a funnel, with the triggers as rows (a kind from a list and a control per kind), the choices as a tree, and the teaser as its own field; the funnel's audience is the prompt's (no rules: everyone; rules: matching signed-in people, never a guest). See [Funnels and blasts](/content/docs/running-a-site/marketing/funnels-and-blasts).

## Numbers

The prompts' numbers are on the page of the funnel each belongs to, Marketing → Funnels → **Performance** (a chat step among the funnel's steps, or a funnel of prompts alone): shown, picked, threads begun, people, and every choice by how often it was picked — named by its line, even one since taken down, since the event carries the words. Nothing of the chat is on Content analytics.

## Guards and housekeeping

The anonymous door is rate-limited per address and hour (new guests, new threads, uploads). A nightly job removes files older than the policy's _keep files_ days; the messages stay, their files gone. Under lockdown mode (a developer's switch) a sign-in from the chat is refused and a guest stays a guest.

## Words

UI strings → `support` (the widget, the panel, the inbox, the canned replies, the panel's own page at `/support`); the system lines the functions send (the acknowledgement, the digest's subject) under `emails` → `## support`.
