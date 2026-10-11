---
title: Sessions and coaching
description: The ways to book a session — on the site's own calendar or cal.com's — a host's hours, where a session happens, the paid session, the members' chat with the coaches, and the coach's inbox.
order: 26
sources:
  [
    packages/kit/supabase/functions/_shared/video,
    packages/kit/supabase/functions/copilot-llm,
    packages/kit/supabase/functions/session-room,
    packages/kit/supabase/functions/livekit-webhook,
    packages/kit/src/lib/room.js,
    packages/movable-types/src/pages/CallPage.vue,
    packages/kit/supabase/functions/_shared/cal.ts,
    packages/kit/supabase/functions/_shared/sessions.ts,
    packages/kit/supabase/functions/_shared/booking.ts,
    packages/kit/supabase/functions/_shared/schedulers,
    packages/kit/supabase/functions/_shared/recurrence.js,
    packages/kit/src/lib/recurrence.js,
    packages/kit/build/times.test.mjs,
    packages/kit/supabase/functions/coach-hours,
    packages/kit/src/lib/hours.js,
    packages/movable-types/src/instrument/ui/results/CoachHours.vue,
    packages/kit/supabase/functions/cal-webhook,
    packages/kit/supabase/functions/book-session,
    packages/kit/supabase/functions/cancel-session,
    packages/kit/supabase/functions/session-slots,
    packages/kit/src/lib/booking.js,
    packages/kit/src/lib/chat,
    packages/movable-types/src/components/chat,
    packages/movable-types/src/components/Bookings.vue,
    packages/kit/supabase/schemas/55-sessions.sql,
    packages/kit/supabase/functions/session-recordings,
    packages/kit/supabase/functions/session-files,
    packages/kit/supabase/functions/_shared/recordings.ts,
    packages/kit/src/lib/recordings.js,
    packages/movable-types/src/instrument/ui/results/CoachingPage.vue,
    packages/kit/supabase/functions/_shared/sessions,
    packages/kit/build/tiers.test.mjs,
    packages/kit/supabase/functions/_shared/sessions/guest-booking.js,
    packages/kit/supabase/functions/create-checkout-session,
    packages/kit/supabase/functions/_shared/ledger.ts,
    packages/kit/supabase/schemas/40-commerce.sql,
    packages/movable-types/src/instrument/ui/results/SessionBooker.vue,
    packages/movable-types/src/content/ui/library.md,
    packages/kit/src/lib/call,
  ]
reviewed: 2026-10-10
---

Two modules: `sessions` (booking calls) and `coaching` (the members' chat). A coach is anybody holding the **coach** role — and an administrator, who reaches everything. Nothing asks for the name of a role to find out: `is_provider()` in the database, `isCoach` in `_shared/roles.ts` and in `lib/auth.js` are the one answer, and `is_coach(uuid)` asks it about somebody else (which is how `chat_open` knows the person being written to is a coach).

A voice note in the coaching chat arrives with a transcript under it, written down by the browser
while it was recorded.

Copilot voice sessions also use LiveKit: the `copilot-llm` function mints a room token whose signed room configuration dispatches the `copilot` agent and carries its bounded session grant as metadata. This is separate from booking a coaching session; see [Bots, tools and commands](/content/docs/building-a-site/bots).

**A type that happens at a fixed time.** Two kinds of thing are booked and they are not the same.
Most are _whenever suits us_: the host's open hours less what is taken, and the person picks. But a
weekly group call happens at seven on Tuesday whether anybody books or not, and offering that as an
open calendar is both wrong and a great many empty slots. So a type may say `repeats:` in its own
file — the same recurrence grammar as everything else here (`every`, `on`, `at`, `zone`,
`interval`, `until`, `except`) — and then **its occurrences are its bookable times**: the hosts'
hours are not asked, because the time is the point, and an occurrence already full is simply not
offered (one seat for a one-to-one, as many as `seats` says for a group). A host who is busy
cancels the occurrence rather than quietly making it unbookable. It is for a type this site
schedules; cal.com keeps its own calendar, and the compile says so rather than letting it pass.

The wall time wins across a clocks change, as it does everywhere else here: a call at seven in
London is at seven in London in November, which is a different hour in UTC from the one in
September.

A session type may say **when it is bookable by default** (`hours` in its file: a timezone and a
weekday-to-ranges week). A host who sets their own hours replaces it entirely — it is a default and
never a cap — but it means a site deployed from its folder offers times on the first day instead of
an empty calendar until somebody opens the Coaching tab. (Where a site keeps coaching in the community — `coaching.where: spaces` — a member books from their coaching place there, the **Sessions** tab beside **Chat**: the same page, the same booker and the same rules; the sheet's Coaching tab stays only for a host, for their hours, offerings and earnings. Within the community coaching page, **Book a session** is the first, default-selected tab, so `/community/coaching` opens directly to the calendar; upcoming and past sessions follow.)

## Booking types

Sales → **Booking types**: one record per way to book — an _appointment_ of any kind, never only a video call. A title, one line, a price as written, **requires** (`anyone`, `guest`, `authenticated`, a tier slug meaning that tier and every higher rank, or **a list of tier slugs meaning exactly those** — see below), optionally **below** (a tier the option is hidden from and up), how many a **week** or a **month** the option allows (0 = no limit), Published — and **who schedules it**.

Whether sign-in is required to book is controlled by `coaching.requireAuthToBook` in `platformkit.config.js`; it defaults to `true`, so existing sites remain sign-in-only. When a site sets it to `false`, a signed-out visitor may book only a session whose `requires` rule is `anyone` or `guest`. `session-slots` returns availability only for those types without a JWT; provider-specific and member-specific reads remain authenticated. A free guest booking asks for a valid email and records the booking under that address. A paid guest booking goes through Checkout with one paid session and the selected time; fulfillment uses the email returned by Stripe, never a typed email. The same judge still enforces session eligibility and allowances. A slot is not held while Checkout is open. If it is taken before payment completes, the payment remains recorded and its unused credit can be claimed by an account only after that account verifies the same email address. Moving or cancelling a booking remains an account action.

**Scheduled by this site** (the default): the type says its **length** in minutes, its **hosts** (the accounts that give it, by email — the least recently booked free host takes a one-to-one), its **seats** (a group session: how many share one time; 0 is one-to-one), **breathing room** and **minimum notice** of its own on top of the host's, and **where it happens** — a video room on this site (`video`; the room itself comes with the video module), a link (`link`, a URL), in person (`place`, a name and an address), by phone (`phone`, a number to call, or blank to ask the person's at booking), or nowhere in particular (`none`: a consultation, a delivery window). A video room is the one kind with a provider: LiveKit on this site, Cal Video for a cal.com type; the rest need none and are untouched by any of it. The open times are the hosts' own hours less their bookings, computed by the site; a booking is the site's own row from the moment it is made, and a time is never booked twice — two people confirming the same last time are answered _taken_ for the second.

**Scheduled by cal.com**: the type carries the **cal.com address** of the event type instead, and cal.com's availability, invites and video link do the rest. A file with a cal.com url and no `scheduler` key is cal.com's, so every existing type keeps working; `scheduler: native` written outright is the site's whatever else the file holds. A site whose every type is its own needs no cal.com account at all — the demo runs that way.

## A provider's own offerings

A booking type is a file, because what the _business_ sells is part of what the business is. A
**provider's offering** is a row, because the moment the thing being sold belongs to one named
person a file would be a declaration about that person. Where a site has turned them on, the two
appear in one booking surface and each offering says whose it is; everything that follows a booking
is the same. See [Providers and payouts](/content/docs/reference/suppliers).

## Whose time a booking takes

A booking says who its **host** is; a row of `booking_holds` says whose _time it takes_, one per
person. They are not the same thing, and separating them is what lets a collective session take
several people's time at once.

The rule lives in an exclusion constraint on that table — `(user_id, tstzrange(start_at, end_at))`
must not overlap — so a second booking of the same person at the same time is refused by the
database, in the same transaction that would have made it, however two requests raced. It replaced
a column on `bookings` whose partial condition had to restate in three clauses what a live booking
was, and which excused every seated booking: a host running a group call could be booked
one-to-one at the same hour.

A hold exists exactly while the booking holds the time. Booking writes it, moving carries it,
cancelling gives it back — and a group session holds its host **once**, on the first seat, keeping
the hold while any seat remains, because the seats are counted under the advisory lock and what the
hold stops is something _else_ taking that hour.

## A host books for people

A host — any account that gives appointments, and an administrator — can book a session for other people: on the Coaching page's **Settings** tab (**Book for someone**, beside _Your hours_) and from Sales → Bookings (the same booker), choose a type (every published one, whatever the host's own tier), name the invitees by email — accounts or plain addresses, as many as the type seats — pick a time from the host's hours, and book. Nothing is judged, no credit is spent and nothing is charged: it is the host's courtesy (a client who missed a paid call, rebooked without paying again) or the record of a sale made elsewhere. Every invitee is on the booking — it is on their Coaching tab marked _Booked by …_, they get the booked email with the invitation, they enter the room when there is one — and it counts against no one's allowance. A cal.com type is booked the same way through cal.com, as the first invitee.

## A tier says what it includes

### Tiers are not a ladder unless you ask for one

A single slug in `requires` is a shorthand: _that tier and every higher rank_. It is convenient and it is an assumption — it says the tiers are ordered and that a higher one includes a lower one, which is true of some sites and not others.

A **list** says exactly which tiers, and the ranks are never consulted:

```yaml
requires: [tier-1, tier-2, tier-3] # these three, whatever outranks what
requires: tier-2 # tier-2 and every higher rank
```

A space's `fill` has always read a list this way, so it is one grammar and not two. Every tier named must be one a membership declares, and a class (`anyone`, `guest`, `authenticated`) inside a list is refused at the compile — a list is tiers alone.

The rule itself is one function, `_shared/sessions/admits.js`, asked by both the app's picker and the judge the functions run before anything is booked: two sides of a gate that disagree are not a gate. `build/tiers.test.mjs` pins it.

A membership product may carry **Sessions included**: rows of a booking type with how many a week and a month (0 is no limit), edited on the product's drawer as rows — a type from the list and two numbers. Somebody whose live tier lists a type may book it under those counts whatever the type's own `requires` and counts say — a paid type included, no credit asked — so one type serves every tier at its own quota; a tier that lists nothing leaves the types' own rules to decide, as before. The judge and the Coaching tab's options read the tier first, the type second.

## A run of sessions

A type may be booked as a **run** — six weekly sittings, say, all at once. (That is `repeat`, the
reader choosing how many; `repeats` is the other thing, where the type happens at a fixed time
whether anybody books or not. A type cannot be both.) It says how many, how far apart — a week, a
month, a year — and the most anybody may ask for.

**A run is offered only where every one of its sessions is free.** Offering the first and finding
out at the sixth that the host is away is the worst way to learn it, so the whole run is checked
before a start is shown, and the calendar changes as the number does. The dates walk in wall time:
a nine o'clock session is at nine after the clocks change, and the last day of a month becomes the
28th in February.

**Every session is its own booking** — its own row, its own hold, its own invitation — sharing the
first one's uid. If one of them cannot be made, none is: somebody who asked for six and got four has
a worse problem than one told to pick again.

Moving one leaves the rest where they are. Cancelling **asks** — just this one, or the whole run —
because cancelling one of six and being left with five is sometimes exactly what somebody means and
sometimes the opposite. The whole run means the ones still to come; a run half attended is half
attended.

## A group session, and several lengths

A type with **seats** is a group: several people share one time. Two switches on its page decide
what somebody is told — **how many seats are left** (a nudge and a warning at once, and not every
host wants either) and **who else is coming** (somebody else's name on somebody else's screen, so it
is off unless you say). Who else is coming is names only: a list of who is in the room should not
also be a list of how to write to them. A seat given up is only that seat — the hour stays held
while anybody is still in it.

A type may offer **several lengths**. The first is the default and must be the type's own length, so
a type with one length and a type with none behave the same. Each may carry a price and a sku of its
own, for a type paid at the length chosen. The calendar is asked at the length being chosen, because
a ninety-minute session fits in fewer places than an hour and showing the hour's times would offer
what cannot be booked. A length the type does not offer falls back to its default rather than
booking whatever was asked for.

And a type may say **what the booking is called**, where its title is not what belongs in a calendar
beside four other things: `{reader}`, `{host}`, `{type}` and `{length}` are filled from the
booking itself.

## When you confirm it yourself

A type may wait for the host's word: **always**, or **only inside the minimum notice** — a booking
three weeks out is fine, one tomorrow morning needs a look, which is the setting most people want
and the one nobody thinks to build.

A booking that waits is **pending**, and it **holds the time from the moment it is made**: a time
somebody is waiting on is not a time to offer anybody else. The person is told the time is held —
never that it is booked, because telling them so and then declining is the worst version of this —
and the host is told somebody is waiting on them, with the answers if the type asked any. Nothing
goes into anybody's calendar until it is confirmed.

The host says yes or no from the row on their Coaching tab. **Yes** is the booking being made: the
invitation, the room and the week of chat all follow from it. **No** frees the time, tells the
reader, and leaves a paid credit **unspent** — they did not get the session, so nobody should have
to ask for the credit back. A booking already answered cannot be answered again, so two taps on Yes
send one letter.

A booking **still waiting at its own start time is declined** by the same job that sends the
reminders. Nobody said yes and the hour has come; leaving it pending would hold that time for ever
and leave the person waiting for an answer that is never coming.

Three designs go with it under Marketing → Emails: **Time held** to the person, **Waiting on you**
to the host, **Declined** to the person.

## Questions on the way in

A type may ask a **form**'s questions between choosing a time and confirming — after the time rather
than before, because somebody who cannot find an hour that suits should not have answered anything
first. What they answer is a form response like any other, so it is in the forms section with every
other response, and the booking simply remembers which one.

The **host** sees the answers where they are already looking: on the booking under Sales → Bookings,
each question as it was asked and in the order it was asked, and again in the booked email — the
host's copy only, since the person wrote them and does not need them read back.

A response is checked to be **theirs** and of **this type's form** before it is written down. A
response id is a thing anybody can type, and a booking carrying somebody else's answers would show
the host the wrong person's.

A form that is **gone or unpublished asks nothing** and the type books as it always did. A booking
page that refuses because somebody unpublished a questionnaire is worse than one that skips it.

## The booking page itself

One block on the type says what its page shows and what it lets somebody do afterwards. Every switch
defaults to yes, so a type that says nothing behaves exactly as every type did before there was one.

- **Send them to** — a path on this site or a url of their own, instead of the confirmation. The
  confirmation is drawn first either way, so a redirect that fails leaves them somewhere sensible.
- **Ask if there is anything else** · **Say whose session it is** · **Show the length, the place and
  the price** · **Let them change the time zone** — off hides that part of the page. With the zone
  locked, every time is shown in the site's own.
- **They may cancel** and **They may move it** — any time, until the minimum notice, or never. A
  refusal names which: "this one cannot be cancelled here" is a different thing from "too soon", and
  the row does not draw a button the function would refuse.
- **A past or cancelled one may still be moved** — for a session somebody missed.
- **Only somebody signed in may book it.**
- **Off every list** — reachable by its own address alone, a link you give out. It is not
  unpublished: it books exactly as any other does, for anybody with the link who passes its gate.

A **host is not held to these**: they are the person's page's switches, and a host cancels or moves
a session they are giving whenever they need to.

## What a type limits

A type says its own **grid** and its own **window**, so a host need not write either into their week:

- **Times every** — the minutes between the starts it offers. 30 shows 9:00, 9:30, 10:00; blank is 15.
- **Starting at** — how far into each stretch of hours the grid begins. 5 turns 9:00 into 9:05, so
  there is a moment between calls. It must be less than the interval.
- **How far ahead it can be booked** — between two dates, or a rolling number of days. Blank means as
  far ahead as the hosts keep hours.

And its own **caps**, counted across every host: how many of this type can be booked in a day, a
week, a month or a year, and how many minutes of it a day or a week add up to. A cap is **reached,
not approached**: a week already at its count offers nothing more that week, whoever is free, and
the week after is untouched. A host's own set of hours carries the same two for everything they
give — sessions a day and sessions a week — so a type's cap and a person's cap both hold.

**An empty month says why.** A calendar with nothing in it and no word looks broken, and what the
reader should do next depends entirely on which of these it is: this opens for booking on a date,
this stopped taking bookings on a date, this can be booked up to a date (turn back a month), nobody
has set their hours for it yet, the hosts keep no hours in common (for a type everybody comes to),
or every time this month is taken. A booking that arrives a moment too late is told the same way —
which cap it met, not "that time has gone", because those lead to opposite next moves.

The calendar and its time list stack when the available picker width is too narrow to use both comfortably, and remain reachable on short screens. The coaching tabs wrap their labels on phones so every action stays inside the available width. If availability cannot be loaded, the reader sees the existing booking error rather than an empty calendar; the underlying failure is logged, and a retry asks for availability again without changing the booking.

## How a type is shared between its hosts

A booking type names its hosts, or names a **team** whose members give it (`team:` — and then who
gives it follows the rows, so somebody joining gives it from that moment and nothing is edited).
`assign:` says what happens when it is booked:

|                                             |                                                              |
| ------------------------------------------- | ------------------------------------------------------------ |
| **One of the hosts, in turn** (the default) | the free host whose turn it is takes it                      |
| **Every host, together**                    | only times every host keeps are offered, and everybody comes |
| **Each host gets their own copy**           | the type appears on each host's own page, at their own hours |

**Whose turn it is** is asked in one order, and it is cal.com's: among the hosts free at that time,
the highest **priority**; among those, the one furthest below their **share** (a percentage — a host
at 200% takes twice as many, so twelve bookings there stands level with six at 100%); among those,
the one booked **least recently**; and if two are still level, one at random. Only **confirmed**
bookings count, so a cancelled booking leaves the turn exactly where it was. A host joining a rota
that has been running is credited their share of what it has done so far, at their own weight — a
fact about when they joined, written down once rather than recomputed, because recomputing it later
would move it. Somebody marked **at every booking** comes whoever else takes it, and a time they do
not keep is no time at all.

**Every host, together** offers the intersection: only the times all of them keep. One booking is
made and the time is taken from every one of them at once, so none can be double-booked at that
hour. Where the hosts share no hours the calendar is honestly empty.

**Each host gets their own copy** is one file and N members. Nothing is written per member: the copy
is computed where it is read, from the file and the rows that say who is in the team. It lives at
the type and their username (`/p/<username>`, and the booking address `<type>@<username>`), on
**their** hours, and nobody can edit it — the length, the price, where it happens and who may book
are the business's. A member joining gains theirs the moment the row exists; a member leaving stops
theirs being bookable, and the bookings already made against it stand, because those are rows and
rows do not vanish when a rule changes.

A host booking for somebody asks for **their own** times rather than the union — a time only a
colleague keeps is no use to them.

## A host's hours

A host — any account that gives appointments; an administrator today — sets when people may book them on their Coaching page's **Settings** tab, under **Your hours**: the time zone, the week as seven rows (a switch per day, its ranges as from · to pickers, up to four a day), breathing room **before** and **after** a session, minimum notice, at most so many sessions a day and so many a week, and **days off and exceptions** (a date, off all day or its own ranges instead of the week's). A host with no hours set is told so on the tab, and no native type offers them. The hours are theirs alone: somebody learns of them only through the open times, and the desk reads them without editing. Until an external calendar is synced, a host blocks outside meetings as exceptions.

**A host keeps as many sets of hours as they like** — _mornings for discovery calls, evenings for clients_ — each with a name, one of them theirs by default. The panel edits one at a time, picked from the row at the top; **Make this the usual one** moves the star, **Remove this set** takes one away (never the last), and every day off belongs to the set it was written on. A host who keeps one set never sees the row: their first set is simply their hours.

A booking type asks for a set **by name** (`schedule: Evenings` in its file, edited on the type): every host of that type is then read at their own set of that name, and any host who keeps no such set is read at their default — so the type need not know what each host calls things. A type that asks for no set uses each host's default. Where both the host's set and the type say a breathing room or a notice, **the wider holds**: a type asking for more room than the host keeps gets it, and a type asking for less never takes the host's away.

## When you are away

A stretch of days nobody can book you — a holiday, a course, a week ill — set on the Coaching page's Settings tab
under **When you are away**. It is kept apart from your hours because it is not a change to how you
work: your week is still your week and comes back by itself when you do. (A single day off is an
exception on a set of hours; this is for the stretch.)

You may name a **cover**: somebody else who gives appointments. Their own times stand in for the
days you are gone, so somebody is not turned away from a practice that has somebody free — and the
booking goes to them, because a cover who is offered but not bookable is worse than no cover at all.
They stand in for those days and no others. With no cover, the days are simply closed.

**What is already booked in those days stands.** Being away later is not a reason to cancel what
somebody has already been promised; cancel the ones you mean to, one at a time.

## From outside the app

The sessions are also served to anything written for **cal.com's API** — the same event types, open times, bookings and webhooks at `https://<domain>/api/scheduling/v2/…` under a key of kind Scheduling from Settings → API, every booking judged as the app judges it — and a booking page at `/book/<slug>` shows the booker on its own, which cal.com's own embed can place on another site (see [the Scheduling API](/content/docs/building-a-site/scheduling-api)).

## What was booked

Sales → **Bookings** lists every session — the site's own (tagged _This site_, with where it happens) and cal.com's mirrored — upcoming first, then past — with the attendee (and whether they have an account), the coach, the booking type, how long, the status (upcoming, ended, cancelled, rescheduled, no-show, or refused with why), whether a credit paid for it, the join link while it is upcoming, and the recording once the call has left one. It is an administrator's view of every coach's bookings; a coach's own Coaching tab still shows only the sessions they give.

## A call's recording is ours

When a Cal Video call ends and cal.com says its recording is ready, the site pulls the file into its own private storage at once — asking cal.com for a fresh link (the one in the webhook expires within the hour) and streaming the file into the `recordings` bucket under the booking, the transcript beside it — and remembers where it is. A pull that does not land yet (the recording still being made, a hiccup) is tried again every ten minutes for a day; the row says _pending_ meanwhile, and _failed_ with the reason after, where Sales → Bookings offers **Fetch again**. A call on Zoom or Meet leaves its recording with that provider, and the row shows nothing.

The recording is watched on the site, never on cal.com: the attendee and the coach get **Watch the recording** on the Coaching tab's past sessions (a player in the row; **Transcript** beside it), and an administrator gets **Watch**, **Download** and **Transcript** on the desk — each from a url signed for an hour, given only to someone the booking's own rules already let see it. Nothing is public. How long a recording is kept is `recordings-keep` in the sending policy (Marketing → Funnels → Sending rules: _Keep a call's recording for … days_; 0 keeps them forever): a nightly run removes older files, and the row says it was kept that long.

On the local stack the demo's `.env` carries a placeholder API key and a webhook secret so the kit's test can stand in for cal.com — its documented endpoints and a signed `RECORDING_READY` — end to end; only cal.com's live answer waits for a real call.

One setting to make once on the Supabase project: the `recordings` bucket allows 2 GB per file, and the project's own upload limit (Dashboard → Storage → Settings) must allow that too, or a long call's pull is refused and the row says so — the deploy notes it.

## A video room on the site

A type whose place is **a video room on this site** gets one on [LiveKit](https://livekit.io) where the site has an account — open source, LiveKit Cloud or a server of your own (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) — and, where it has none, **browser to browser**: the people in the call talk to each other directly and the site carries only the signalling. That needs no account and nothing to configure, and the difference is stated rather than hidden — such a call is **not recorded** and carries **five people in total**, everyone counted the same. The deploy asks for an account only for a type whose own content says otherwise (one that records, or seats more than five) and allows every other without a word.

Two people who cannot reach each other directly need a **relay**. Supabase has no TURN service and nothing in this stack can relay media — no Supabase-only deployment of anything relays WebRTC, because a relay is a box — so the kit never depends on one: give it `WEBRTC_TURN_URL` with `WEBRTC_TURN_SECRET` (a coturn you run, or anything that speaks the standard, whose credentials the function mints per person and per call) or a long-term username and password, or register your own module to answer for you. With none, every call that does not need relaying still happens, which is most of them, and the rest say plainly why they cannot. The booking's **Join** opens the site's own call page, `/app/call/<uid>`: a lobby that shows the person their camera, lets them choose a microphone and a camera and says whether the call is recorded, then the call — every person a tile with their name, the one speaking marked, a shared screen shown large — with mute, camera, share screen and leave; the host may also end the call for everyone. Only someone on the booking is let in, from fifteen minutes before its start until an hour after its end (too early says when it opens; a stranger is told it is not theirs), and the host enters with the room's controls: the credentials are minted by the site for that person and that booking alone, never a link anyone could forward. The call's start (the first person in) and end (the room emptied, or the host ending it) are written on the booking by the room's own notifications, the host's first line following five minutes after the end as it does for every session.

**Record the session** on the type records the room as one film that lands straight in the site's private `recordings` bucket under the booking — through Supabase Storage's S3 endpoint (`STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY` from the project's Storage → S3 access keys), no pull — and the row, the Coaching tab and the desk show it exactly as a cal.com recording, kept by the same policy. A room's call has no transcript (LiveKit records; it does not transcribe).

Locally, with no LiveKit keys, the rooms run on a LiveKit server in Docker (`docker run --name lk-dev -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --keys "devkey: secretsecretsecretsecretsecretsecret" --node-ip 127.0.0.1`; point its webhook at the served `livekit-webhook` for the start and the end to land) and a recording is a fixture film the mock puts in the bucket — the whole chain with no account. The deploy refuses `LIVEKIT_MOCK`.

## The site's own emails around a session

For a session the site schedules, the site sends its own mail — four designs under Marketing → Emails: **booked** to the person and the host when the booking is made, **moved** and **cancelled** to both, and a **reminder** to the person at each of the hours before the session the sending rules name (24 and 1 by default; edited on the Funnels page under _Sending rules_, a field per hour). Every one carries a calendar invitation the person's mail client offers to add — the place in its location, the link as its url, a move updating it, a cancellation withdrawing it — and says the time in each person's own zone. None of it carries a cal.com link; a cal.com booking has cal.com's own emails. The host's first line after the session goes five minutes after its end time, as it does after a cal.com call.

## Booking happens in the app

People book on the Coaching tab of the app, never on cal.com's own page: a month of open days, the day's times, one confirm step — the same screen whoever schedules the type. On a phone the offering summary and time-zone control are compact so every date in the month is visible without scrolling; the times and remaining actions stay reachable in the page's scroll area. For a type the site schedules the app computes the times from the hosts' hours; for a cal.com type it asks cal.com and books through it (hide the event types on cal.com so its pages are not a way around the rules). Upcoming sessions are moved and cancelled from the row: a native session by the person up to the type's minimum notice (_That time is too close — pick one at least {n} hours ahead_) and by its host at any time, who may also mark a no-show after the time; a cal.com session under cal.com's rules (it must allow rescheduling on the event type).

**The judge** is one rule: may this person book this event type now — their tier, the week's or month's allowance by the app's own count, and, for a paid session, a credit. A booking that arrives some other way (made on cal.com directly) is judged after the fact by the webhook and cancelled if refused, the reason sent to the attendee's chat.

## A paid session

A session record may name a **sku** — a product of kind `session`, billed once. It is paid as it is booked: the picker sends the chosen time with the checkout, the payment grants one credit and books the time with it. If the time went meanwhile, the credit stays and the picker says "Paid — pick a time". Cancelling gives the credit back (a refund is a person's decision in Stripe). A paid session comes with **a week of chat** with that session's coach, from the booking until a week after the session ends. It is read from the booking itself, so moving the session moves the week and cancelling it ends it — and it is not a membership: it opens that one conversation and nothing else in the community.

## Wiring cal.com

In cal.com → Settings → Developer → Webhooks, subscribe the site's `cal-webhook` function to every trigger with the secret the deploy holds. The coach's cal.com email must be the address they sign in to the site with, or their bookings link by email only. A paid session's event type must carry no price of its own on cal.com.

## The coaching chat

The Chat tab of the app (`/app/chat`): a member's conversations with the coaches, one thread per member per coach, and a coach's inbox of every member who has written. Text with the three marks every composer here offers, voice notes and attachments — a picture shown as the message, anything else a chip, ten megabytes at most, named for its own message in the private bucket and fetched back through the signed-in client — emoji reactions, reply-to, sending · sent · read ticks, unread badges, and an email when the other side is away. A message wears the same marks every other chat surface here offers (bold, italic, struck, code, bullets, a quotation, a link), cut by one parser and drawn by one component. A coach always sends; a member sends while the membership is live and reads after it lapses.

**After a session, the coach writes first.** When cal.com says a meeting ended, a follow-up line (one of several, drawn at random, editable under UI strings → chat) is sent from the host to every attendee five minutes on, in the thread between them, once.

## The coach's inbox

The inbox says what is owed. Each thread waiting on the coach carries a badge — "Reply due in 4h", "Overdue by 2h" (red, and it pulses), or "Awaiting your reply" when the member has no promised time — from the reply time the member's highest tier promises (`chat-hours` on the product). The order control sorts by activity, by newest thread, or by longest wait. A member sees none of this.

**New message** lets a coach open a thread to any member by name or email.

## Words

The chat's words are UI strings → `chat` (the follow-up lines under `## followup`, the refusal lines under `## refusal`); the booker's under `library` → `coaching.booker`; the gate's under `gate` → `## chat`.
