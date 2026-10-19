---
title: The chats and push, internally
description: The coaching chat's tables and policies, the support desk's function and its live channel, the push triggers, and the two queues the staff answer from.
order: 56
sources:
  [
    packages/movable-types/src/components/chat/CoachingPanel.vue,
    packages/movable-types/src/components/spaces/SpaceCoaching.vue,
    packages/kit/src/lib/desk,
    packages/kit/supabase/schemas/72-tickets.sql,
    packages/kit/build/tickets.test.mjs,
    packages/movable-types/src/components/spaces/SpaceTickets.vue,
    packages/movable-types/src/components/spaces/SpaceMyTickets.vue,
    packages/movable-types/src/components/support/SupportTickets.vue,
    packages/kit/supabase/schemas/50-chat.sql,
    packages/kit/supabase/schemas/70-support.sql,
    packages/kit/supabase/schemas/80-push.sql,
    packages/kit/supabase/functions/support,
    packages/kit/supabase/functions/chat-notify,
    packages/kit/supabase/functions/push,
    packages/kit/src/lib/chat,
    packages/kit/src/lib/support,
  ]
reviewed: 2026-10-08
---

The desk's own webhook subscriptions carry a **source**: one made through the Support API is `hand`, and one a deployment ships declared in `platformkit.config.js` is `file` and is replaced on every deploy.

## The coaching chat

`50-chat.sql`: `conversations`, `conversation_members` (each party's `last_read_at`, `last_seen_at`, `notified_at`), `messages` (`kind` text | voice, never edited, withdrawn with `deleted_at`), `message_reactions` (carrying `conversation_id` so a thread's realtime filter works), all in the `supabase_realtime` publication. RLS is the gate: `in_conversation()` and `chat_may_send(conversation)` — a coach (`is_provider()`: anybody holding `provider`, and an administrator, who reaches everything) always sends in their own threads, membership or none; a member while the membership is live (`is_subscribed()`); somebody whose paid session with this thread's coach is still inside its week (`chat_session_with(member, coach)`: a booking a credit was spent on, accepted, until a week after it ends — read from the booking, so a move re-dates it and a cancel ends it, and never a membership anywhere else); a lapsed member reads. `chat_open` and `chat_people` follow the same rule (a session's buyer sees and opens only that session's coach), and `chat_session_coaches()` tells the browser whom it is with. Conversations are opened only through `chat_open(peer)`, which finds the thread between two people in either orientation before making one (a unique index on the unordered pair holds it); `chat_people`, `chat_inbox` (with `awaiting_since`, the peer's `tiers` and `session_chat`), `chat_members(q, lim)` (a coach's paged search) and `chat_unread` are the reads.

Voice notes are MP3s the browser encodes as it records (`lib/chat/recorder.js` on the TTS `Mp3Writer`, nothing trimmed) in the private `chat` bucket as `<conversation>/<message>.mp3`. `lib/chat/model.js` is the pure arithmetic — days, runs, ticks, reactions, previews, `dueOf`, `spanOf`, `sortInbox` — that `chat.test.mjs` pins; `api.js` the reactive store and the channel; `unread.js` the light module the header reads.

**Where coaching lives is the site's choice — the chat and the booking together — and the choice is exclusive.** `coaching.where` in `platformkit.config.js` is `app` (the default) or `spaces` (`coaching.chat`, its former name from when it moved the chat alone, is read the same). With `app` the conversation is the results sheet's own Chat tab at `/app/chat`, sessions are its Coaching tab, and the header carries a chat button beside the community's. With `spaces` those tabs (Coaching for a member: somebody who gives sessions keeps it), that button and the route go away, and both are one place in the community instead — **Coaching** in the person's own column, or a row of its own between Events and Messages in the social layout — with two tabs: **Chat** (where they may write to a coach: a coach, a membership, a paid session's week with its coach, or a line waiting) and **Sessions** (the sheet's own Coaching page without its banner: what is coming, what has been, and the booker, which offers only what they may book with what is left). A reader with nothing to chat about opens straight on Sessions. Somebody who gives sessions has the same place — they may be a member with a coach of their own — and their Sessions also carries the ones they give, their hours, away dates, earnings and Book for someone; the conversations they answer are in their Chat as well as the Clients queue. Who gets the place and which tabs is one pure rule, `coachingPlace` in `lib/community/places.js`, held by `community-nav.test.mjs`; a coach answers from the desk's **Clients** queue exactly as before. Nothing else changes: the same tables, the same policies, the same unread counter, and who may write is still the entitlement, checked in RLS. The two surfaces are one component, `components/chat/CoachingPanel.vue`; its hosts differ only in what surrounds it and whether the open conversation lives in the address (`ChatPage.vue` passes `home`, `SpaceCoaching.vue` does not). Running both was never offered: two inboxes onto one thread is two badges for one unread line, and a member answering in the wrong one.

The away email is `chat-notify`, called by the sender's client after the insert: one per unread burst, none while the recipient was on the page in the last two minutes, none until they have read since the last one. The follow-up after a session: `cal-webhook` puts `followup_at` (five minutes on) and a `followup_body` (a random line from `chat.md`'s `## followup`) on the booking, and pg_cron's `send_booking_followups()` sends it once, from the host to every attendee with an account, in the thread between them.

## The support desk

`70-support.sql`: `support_contacts` (somebody by `user_id`; a guest by the sha256 of a random contact token the widget keeps in raw localStorage, `dl.support.token` — outside the synced store on purpose, since a guest's token must be neither thrown away at sign-out nor synced across devices), `support_conversations` (`status`, `assignee_id`, `source`, `prompt_id`, the read, typing and notified stamps, `listen_key`, `acknowledged_at`, `escalated_at`), `support_messages` (`author` contact | agent | system; `kind` text | voice | file; never edited), `support_agents_seen`.

**A contact never touches RLS**: everything of theirs goes through the `support` function (no JWT required; the service role inside) — `hello`, `start`, `send`, `messages`, `read`, `upload`, `purge`, and for the staff `notify` — or through the Chatwoot-shaped Client API of the `support-api` function over the same helpers (`_shared/support.ts`: the resolution, the guards, the threads, the acknowledgement), so a contact who arrives either way is the same guest; every insert and change of a thread tells the desk's webhooks (`support_webhooks`, the `support_api_notify` triggers — [the Support API](/content/docs/building-a-site/support-api)). The JWT wins: a session beside a token links the guest contact to the account, or merges it into the account's own, once, and the widget drops the token. The staff read and answer under RLS — **`is_support()`**, an administrator or the `support` role, and not the wider `is_staff()` the rest of the team is read by: an analyst holding only the figures, or a provider selling here, is not somebody who should read other people's conversations, and until it was narrowed they could ([Accounts and roles](/content/docs/running-a-site/settings/accounts-and-roles)). The tickets in `72-tickets.sql` ask the same. A reply is an insert as `author: agent`; the thread's `status`, `assignee_id`, `agent_read_at`, `agent_typing_at` and the contact's `notes` are the only columns a client may change (the guard trigger holds it). `support_inbox()`, `support_unread_staff()`, `support_agents()`, `support_search(q)` are the reads. The bump trigger reopens a resolved thread on a contact's line and stamps the moments each side wrote. The page-side object the widget installs is `window.$chatwidget` (`lib/support/chat-widget.js`), with `window.$chatwoot` an alias of the same object and every event fired under both names. Under the snippet the widget knows where the site is (`setSiteBase` in `lib/support/api.js`, from `run`'s `baseUrl` or the script's origin), so a path of the site's — a prompt's picture, an upload — is fetched from the site rather than from the page carrying it.

**Live for the contact**: a contact has no row-level identity, so `postgres_changes` cannot reach them; every thread carries a secret `listen_key` (144 bits, handed to its owner with the thread), the database broadcasts a wake-up on `support:<key>` whenever a line lands or the thread moves (`support_wake`, `realtime.send` from triggers), and the widget, subscribed to that topic, fetches what is new through the function. The broadcast carries no words. Polling stays underneath as the fallback.

Files go to the private `support` bucket as `<conversation>/<message>.<ext>`; a contact's through the function, read by a url it signs for an hour; the staff's under RLS. Guards: per address and hour the function caps new guests, new threads and uploads (`LIMITS`) — the address the platform's proxy wrote (`addressOf` in `_shared/doors.ts`), never the first `x-forwarded-for` entry, which is the caller's own. The escalation (`run_support_escalation`, every five minutes, `{ action: 'escalate' }`) and the retention (`run_support_retention`, nightly) are pg_cron jobs asking the function. The prompts' events (`support_prompt` with the prompt's line, `support_choice` with the choice's words, `support_start`) are written through `capture()` and read by `admin_support(days)`, which names each prompt by the line the event carried.

A voice note in either chat carries a **transcript** as its body, written down by the browser while
it was recorded — see [Spaces](/content/docs/building-a-site/social-network) for how that works and where it
does not.

## The staff's queues

The chats above have different people — a guest with no account, a member with a membership — and that is why they are separate. The people _answering_ them are one person, so the shape is one: a shared **Desk** in the person's own column of the spaces surface: the built-in **Support**, **Clients** and **Comments** queues, plus any site-registered sources such as **Social**, each shown to staff allowed to answer it. The [Spaces](/content/docs/building-a-site/social-network) page describes them from the staff's side. What matters here is what they do not do.

**A space is not a queue.** What waits in one is a mention or an unanswered direct message, and each of those is a place of the person's own — Mentions and DMs. A room is not a queue and a member of staff is not handed one as though it were, provider systems such as Social instead enter as explicit adapters, not as rooms or member DMs.

It is not a merge. `lib/desk/` holds one shape, three built-in adapters (`support.js`, `coaching.js` and `comments.js`) and any site-registered adapters exposed through `#site/desk` — `support.js` reads `support_inbox()` and writes through the `support` function, because a contact is not a row-level principal and never will be while a guest has no account; `coaching.js` reads `chat_inbox()` and writes under the coaching policies. A site opts a Social provider adapter in through `spaces.deskSources`; without that registration, Social Admin remains the fallback. **A queue is written in the same box a room is.** For support and coaching, the desk mounts the rooms' own composer with the same formatting and attachment controls. Social comments and messages use the provider's supported text operations instead; they do not inherit media or voice-note capabilities the provider does not offer. What each adapter does with them is its own: a file goes to the private
bucket the system holding that conversation keeps (`support` or `chat`), under the message's own
id, before the row is written, so a row never points at nothing and a refused insert takes the
object with it. Each hands the surface its own attachments as well as its words — a path in the private `support` bucket signed for the hour, a path of the site's passed as it is, a recording's `audio_path` — since a row handed over without them draws a word where a picture should be and nothing fails. No support or coaching conversation table moved and no access policy was relaxed. Social conversations are read and answered through the Social Edge Function, not copied into Spaces, coaching or support tables; `desk_done` adds `social` for each staff member's private finished mark. Comment and DM histories retain provider author names, handles and HTTPS avatars; when the payload omits them, `social.js` uses the account-declared read-only `profiles.read` operation and labels incomplete profile details without hiding the conversation. `index.js` unions the built-in adapters enabled by their modules with the adapters exposed through `#site/desk`; site registrations are opt-in, and `shape.js` is the arithmetic — what is owed, the order, the badge, and what being finished with one means — pinned by `desk.test.mjs`; `desk-db.test.mjs` proves the built-in sources against the local stack, and `desk-social.test.mjs` covers the registered Social adapter, each answered where it lives and none of it visible to somebody.

The one thing the desk needed that did not exist for finishing with a conversation is a place to keep the three status-less sources — coaching, space and Social — with `desk_done`, one row per staff member per conversation, theirs alone and nothing the other party ever sees. The support desk keeps none of these rows, because it has a real status. The other thing the desk needed was the policy's wait in the browser: `build/funnels.mjs` writes the two desk clocks to `.velite/desk-policy.json` beside the prompts, so the badge and the escalation read one number.

**Anonymous sign-in was considered and rejected** for making the desk RLS-native. It would let a support conversation be a channel, and the trade is bad: every visitor who opens the widget becomes a user row that never expires without a sweep, every policy in the system has to start considering `is_anonymous` or it leaks, rate limiting moves out of our function into the platform's, and the Chatwoot `source_id` contract has to re-map onto an anon user id. A working, tested security model traded for tidiness — and it buys nothing for the staff's own surface, which is the part that actually hurt.

## Tickets: the work, as against the conversation

A chat and a ticket are not the same thing and neither contains the other. A chat is a
conversation: it starts when somebody writes in, it wanders, and it goes quiet. A ticket is a piece
of **work**: it has a state, somebody owns it, and it is not finished until it is finished. The two
come apart constantly, which is why every serious desk keeps both —

- a ticket **outlives** its chat: the parcel is lost, the thread goes quiet for three weeks, the
  carrier finally answers, and the work was open the whole time;
- a chat **covers several** tickets: somebody asks about a refund and, while they are there, about
  a missing chapter — one conversation, two pieces of work;
- a ticket has **no chat at all**: the staff notice something themselves and write it down.

So `72-tickets.sql`: `support_tickets` (a number people can say out loud, a title, a body, a
contact that may be null, a state, a priority, a due date, and `waiting_since` — the same idea the
chat inbox uses, so one set of words says what is owed across the whole desk),
`support_ticket_assignees` (**one or more**, a row each, because two people working a ticket
together is ordinary and a second column named `assignee_2` is how that ends up otherwise),
`support_ticket_events` and `support_ticket_links`.

**The timeline is one table**, not a comments table beside an audit table, because what a ticket
shows is one column of things that happened: somebody wrote, somebody assigned it, somebody changed
its state. Splitting them makes the surface stitch two lists back together in the right order,
which is the sort of thing that is always slightly wrong. A line on it may be **internal** — the one
thing on a ticket the customer never sees, and the reason a desk can think out loud.

**The link to a conversation is many to many** and optional on both sides. Raising a ticket out of a
chat is a button in the queue's own header; the chat then shows the numbers it produced.

Every write goes through a function rather than a policy, because each is several rows that must
agree: a status change is both a column and a line on the timeline, and a surface that writes one
without the other leaves a ticket whose history does not explain its state. One trigger keeps the
three derived moments true — when anything happened, when the contact last wrote without an answer,
and when the desk first answered — so no surface has to remember to.

**Two surfaces.** The staff get the desk's list in their own column of the spaces surface: narrowed
by chosen chips, ordered by urgency rather than by what moved last, with a pane that shows one whole
— who it is about, who is on it, the timeline, and the conversations it touches. A person gets
**their own tickets and nothing else**: state and replies, no urgencies, no assignees, and never
the internal notes — which are left behind in the database by the read they come through, so no
mistake in a template can show somebody the team thinking out loud about them.

**A ticket is open or it is resolved**, and that is the whole state machine. It had five — open ·
doing · waiting · resolved · closed — and three of those were a guess about how one particular
business works: "In hand" and "With them" assume a queue with a handover in it, and a ticket here
may be a SaaS bug or a coaching question as easily as a lost parcel. What "With them" was reaching
for survives as what it always was — a **fact, not a state**: `waiting_since` is set when the
contact speaks and cleared when the desk answers, so the desk can narrow to _Awaiting a reply_ and
sort by who has been waiting longest without anybody having to remember to press a button. Urgency
is three, because three is what people can hold: low, medium, high.

The old words are still _accepted_ by the table, so no row written before this became unwritable and
no deploy had to rewrite a table; `lib/desk/shape.js` says what each one means now
(`statusOfTicket`, `priorityOf`) and every surface reads through it. Nothing new is written with one.

## Tickets: the work, as against the conversation

A chat and a ticket are not the same thing and neither contains the other. A chat is a
conversation: it starts when somebody writes in, it wanders, and it goes quiet. A ticket is a piece
of **work**: it has a state, somebody owns it, and it is not finished until it is finished. The two
come apart constantly, which is why every serious desk keeps both —

- a ticket **outlives** its chat: the parcel is lost, the thread goes quiet for three weeks, the
  carrier finally answers, and the work was open the whole time;
- a chat **covers several** tickets: somebody asks about a refund and, while they are there, about
  a missing chapter — one conversation, two pieces of work;
- a ticket has **no chat at all**: the staff notice something themselves and write it down.

So `72-tickets.sql`: `support_tickets` (a number people can say out loud, a title, a body, a
contact that may be null, a state, a priority, a due date, and `waiting_since` — the same idea the
chat inbox uses, so one set of words says what is owed across the whole desk),
`support_ticket_assignees` (**one or more**, a row each, because two people working a ticket
together is ordinary and a second column named `assignee_2` is how that ends up otherwise),
`support_ticket_events` and `support_ticket_links`.

**The timeline is one table**, not a comments table beside an audit table, because what a ticket
shows is one column of things that happened: somebody wrote, somebody assigned it, somebody changed
its state. Splitting them makes the surface stitch two lists back together in the right order,
which is the sort of thing that is always slightly wrong. A line on it may be **internal** — the one
thing on a ticket the customer never sees, and the reason a desk can think out loud.

**The link to a conversation is many to many** and optional on both sides. Raising a ticket out of a
chat is a button in the queue's own header; the chat then shows the numbers it produced.

Every write goes through a function rather than a policy, because each is several rows that must
agree: a status change is both a column and a line on the timeline, and a surface that writes one
without the other leaves a ticket whose history does not explain its state. One trigger keeps the
three derived moments true — when anything happened, when the contact last wrote without an answer,
and when the desk first answered — so no surface has to remember to.

**Two surfaces.** The staff get the desk's list in their own column of the spaces surface: narrowed
by chosen chips, ordered by urgency rather than by what moved last, with a pane that shows one whole
— who it is about, who is on it, the timeline, and the conversations it touches. A person gets
**their own tickets and nothing else**: state and replies, no urgencies, no assignees, and never
the internal notes — which are left behind in the database by the read they come through, so no
mistake in a template can show somebody the team thinking out loud about them.

**A ticket is open or it is resolved**, and that is the whole state machine. It had five — open ·
doing · waiting · resolved · closed — and three of those were a guess about how one particular
business works: "In hand" and "With them" assume a queue with a handover in it, and a ticket here
may be a SaaS bug or a coaching question as easily as a lost parcel. What "With them" was reaching
for survives as what it always was — a **fact, not a state**: `waiting_since` is set when the
contact speaks and cleared when the desk answers, so the desk can narrow to _Awaiting a reply_ and
sort by who has been waiting longest without anybody having to remember to press a button. Urgency
is three, because three is what people can hold: low, medium, high.

The old words are still _accepted_ by the table, so no row written before this became unwritable and
no deploy had to rewrite a table; `lib/desk/shape.js` says what each one means now
(`statusOfTicket`, `priorityOf`) and every surface reads through it. Nothing new is written with one.

## Tickets: the work, as against the conversation

A chat and a ticket are not the same thing and neither contains the other. A chat is a
conversation: it starts when somebody writes in, it wanders, and it goes quiet. A ticket is a piece
of **work**: it has a state, somebody owns it, and it is not finished until it is finished. The two
come apart constantly, which is why every serious desk keeps both —

- a ticket **outlives** its chat: the parcel is lost, the thread goes quiet for three weeks, the
  carrier finally answers, and the work was open the whole time;
- a chat **covers several** tickets: somebody asks about a refund and, while they are there, about
  a missing chapter — one conversation, two pieces of work;
- a ticket has **no chat at all**: the staff notice something themselves and write it down.

So `72-tickets.sql`: `support_tickets` (a number people can say out loud, a title, a body, a
contact that may be null, a state, a priority, a due date, and `waiting_since` — the same idea the
chat inbox uses, so one set of words says what is owed across the whole desk),
`support_ticket_assignees` (**one or more**, a row each, because two people working a ticket
together is ordinary and a second column named `assignee_2` is how that ends up otherwise),
`support_ticket_events` and `support_ticket_links`.

**The timeline is one table**, not a comments table beside an audit table, because what a ticket
shows is one column of things that happened: somebody wrote, somebody assigned it, somebody changed
its state. Splitting them makes the surface stitch two lists back together in the right order,
which is the sort of thing that is always slightly wrong. A line on it may be **internal** — the one
thing on a ticket the customer never sees, and the reason a desk can think out loud.

**The link to a conversation is many to many** and optional on both sides. Raising a ticket out of a
chat is a button in the queue's own header; the chat then shows the numbers it produced.

Every write goes through a function rather than a policy, because each is several rows that must
agree: a status change is both a column and a line on the timeline, and a surface that writes one
without the other leaves a ticket whose history does not explain its state. One trigger keeps the
three derived moments true — when anything happened, when the contact last wrote without an answer,
and when the desk first answered — so no surface has to remember to.

**Two surfaces.** The staff get the desk's list in their own column of the spaces surface: narrowed
by chosen chips, ordered by urgency rather than by what moved last, with a pane that shows one whole
— who it is about, who is on it, the timeline, and the conversations it touches. A person gets
**their own tickets and nothing else**: state and replies, no urgencies, no assignees, and never
the internal notes — which are left behind in the database by the read they come through, so no
mistake in a template can show somebody the team thinking out loud about them.

**A ticket is open or it is resolved**, and that is the whole state machine. It had five — open ·
doing · waiting · resolved · closed — and three of those were a guess about how one particular
business works: "In hand" and "With them" assume a queue with a handover in it, and a ticket here
may be a SaaS bug or a coaching question as easily as a lost parcel. What "With them" was reaching
for survives as what it always was — a **fact, not a state**: `waiting_since` is set when the
contact speaks and cleared when the desk answers, so the desk can narrow to _Awaiting a reply_ and
sort by who has been waiting longest without anybody having to remember to press a button. Urgency
is three, because three is what people can hold: low, medium, high.

The old words are still _accepted_ by the table, so no row written before this became unwritable and
no deploy had to rewrite a table; `lib/desk/shape.js` says what each one means now
(`statusOfTicket`, `priorityOf`) and every surface reads through it. Nothing new is written with one.

## Push for the staff

`80-push.sql`: `push_subscriptions` (the push service's endpoint and the keys the browser made, the topics; the staff's own under RLS) and the triggers — on `support_messages` (a contact's first line in a thread is `support-new`, the rest `support-message`), `profiles`, `purchases` (paid), `subscriptions`, `bookings` (accepted) — each asking the `push` function over pg_net (`push_notify(topic, data)`: the topic and the facts, never the words). The function words each from the `emails` scope's `## push`, checks the role against the topic, sends to every browser holding it (`npm:web-push`) — except for a **member topic** (`space-mention`, and `space-mention-sealed` for the same message out of an end-to-end encrypted room — the same facts, who and which room, and no words, because there are none to have; a topic of its own rather than an `if` in the function, so the sentence lives in the strings with every other one), which is addressed to one person rather than to a desk: the database has already decided who may have it, so the call names the recipient and it reaches that person’s browsers alone, whatever their role, drops a subscription the push service says is gone (404, 410). The service worker is `public/sw.js`, for push alone, and it holds a support notification back when a focused tab is already on the admin. `lib/push.js` is the browser's side; `node build/vapid.mjs` prints a pair once per deployment.
