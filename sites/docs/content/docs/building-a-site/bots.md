---
title: Bots, tools and commands
description: An agent loop that survives its own function — durable, resumable, cancellable and budgeted — with bots, tools and slash commands declared as markdown, and the kit's own customer-service bot.
order: 56.6
sources:
  [
    packages/kit/src/lib/copilot,
    packages/kit/theme/src/pages/VoicePage.vue,
    packages/kit/theme/src/components/copilot,
    packages/kit/supabase/functions/copilot-speak,
    packages/kit/src/lib/copilot,
    packages/kit/supabase/functions/copilot-llm,
    packages/kit/supabase/schemas/95-copilot.sql,
    packages/kit/build/copilot-db.test.mjs,
    packages/kit/supabase/functions/_shared/copilot,
    packages/kit/build/copilot.test.mjs,
    packages/kit/theme/src/content/skills,
    packages/kit/src/lib/agents/loop.js,
    packages/kit/supabase/functions/_shared/usage-gate.mjs,
    packages/kit/supabase/functions/_shared/usage.ts,
    packages/kit/build/usage.test.mjs,
    packages/kit/src/lib/agents/api.js,
    packages/kit/build/agents.test.mjs,
    packages/kit/build/agents-db.test.mjs,
    packages/kit/build/bots.mjs,
    packages/kit/build/bots-push.mjs,
    packages/kit/build/bots-db.mjs,
    packages/kit/build/bots-db.test.mjs,
    packages/kit/build/models/core/agents.mjs,
    packages/kit/agent,
    packages/kit/supabase/functions/_shared/video/livekit.js,
    packages/kit/build/velite.mjs,
    packages/kit/build/steps/bots.mjs,
    packages/kit/supabase/schemas/96-agents.sql,
    packages/kit/supabase/functions/agent-run/index.ts,
    packages/kit/supabase/functions/_shared/agents/provider.js,
    packages/kit/supabase/functions/_shared/agents/anthropic.js,
    packages/kit/build/anthropic.test.mjs,
    packages/kit/supabase/functions/_shared/agents/tools.js,
    packages/kit/supabase/functions/_shared/choices.js,
    packages/kit/theme/src/components/chat/ChatChoices.vue,
    packages/kit/supabase/schemas/13-search.sql,
    packages/kit/build/search-push.mjs,
    packages/kit/build/search-db.mjs,
    packages/kit/build/steps/search.mjs,
    packages/kit/supabase/functions/_shared/agents/desk-bot.js,
    packages/kit/theme/src/components/spaces/SpaceCommand.vue,
    packages/kit/supabase/functions/social-automation,
    packages/kit/supabase/functions/social-webhook,
    packages/kit/supabase/schemas/99-social.sql,
    packages/kit/build/social-automation.test.mjs,
    packages/kit/build/social-automation-db.test.mjs,
    packages/kit/build/social-automation-admin.test.mjs,
    packages/kit/theme/src/components/admin/social,
  ]
reviewed: 2026-10-27
---

A bot here is not a chat window bolted to a model. It is an **agent**: it can look things up, call
an API, think again, and come back — and it has to survive the fact that the thing running it is an
Edge Function with about two minutes to live.

## The database is the loop

A worker that tried to hold a conversation would be a worker that loses one. So the run is a row
and the worker takes **one step** from it — one model call, or one tool call, or the saying of an
answer — writes down what happened, and asks for itself again if there is more.

Four properties fall out of that, and each is the reason for it:

|                 |                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Resumable**   | A step is a row. A worker that dies mid-step loses that step and nothing else; the next one rebuilds the conversation from the rows and carries on. A deploy in the middle of a run is not an event.                                                                                                                                                                                 |
| **Cancellable** | `cancel_at` is read before every step and again before every tool — a tool is the step that changes the world. A run stops mid-flight, keeps what it did, and says so.                                                                                                                                                                                                               |
| **Safe**        | One run is leased to one worker at a time by a single locking statement. Two workers racing get one run each, and a run named by id is taken only when its lease is free, expired or the asker's own; only the holder renews it, and a worker that finds its step already recorded steps aside. A **lease expires**; a status would not, which is why there is no stuck-row sweeper. |
| **Accountable** | Every call is a row with what it cost, so a bot's spend is a sum rather than a surprise, and a run that would go over its budget stops **before** the call.                                                                                                                                                                                                                          |

### One invocation, as much of the answer as it can

"One step per invocation" is how a step is _recorded_, not how often the worker hands back. A
worker claims a run and then **stays with it** until the run is finished or a wall-clock budget is
spent — around a minute, comfortably inside both the platform's limit for a function and the lease
it holds. An ordinary answer, tools and all, therefore lands in a single invocation and takes as
long as the model takes.

That distinction is worth stating because getting it wrong is invisible in every test and obvious
to every user. A worker that re-asks `agent_claim` for work between steps is asking for a run while
holding the lease on the only one there is, and is correctly told there is nothing to claim — so it
takes exactly one step and hands back, and the run waits for the next minute's cron before its
next. Six steps then take three and a half minutes, of which three are spent waiting, and from the
room it looks as though the bot has hung. The cure is to hold the run by its id rather than ask for
it again, and to hand the "ask for myself again" call to `EdgeRuntime.waitUntil` — an un-awaited
`fetch` is killed when the isolate is torn down after the response, so that call was usually never
made at all and pg_cron was quietly doing all the work.

The decision at the middle of it — cancelled? out of money? out of steps? is the model asking for a
tool? has it finished? — is a **pure function** (`lib/agents/loop.js`). A loop whose decisions live
inside the async function that also does the calling can only be tested by running it, which means
it is only ever tested on the happy path. Here the awkward cases are ordinary inputs, and
`agents.test.mjs` puts them in.

`agents-db.test.mjs` then runs the real worker against the stack: a run that answers, one that calls
a tool, **one whose worker is killed mid-run and is picked up and finished by another**, one
**cancelled after the model has asked for a tool and before it runs** (and the ticket it would have
raised does not exist afterwards), one that stops when its budget is spent, and two workers racing
for the same run.

## Nothing is bought by accident

The provider speaks **OpenAI's chat completions with tools**, because that is the shape everything
speaks — OpenAI, Azure, Groq, Together, Fireworks, OpenRouter, vLLM, llama.cpp, LM Studio, Ollama.
A site changes a base url and a key and keeps its bots.

**More than one provider, tried in order.** A provider with no credits is not a reason for a site
to stop working, so the first is asked and — if it fails for a reason that is _its own_ — the next
is asked instead. What counts as its own: no credits, a bad key, a rate limit, their server down,
not reaching them at all, a model they do not have. What does not: a malformed request, which
fails identically everywhere and would only be two bills and twice the wait.

A fallback uses **its own model**. A bot's `model:` names a model for the provider it was written
for; sending `gpt-4o-mini` to Anthropic is a second failure, not a fallback. Anthropic is not
OpenAI-shaped — its system prompt is a field, a tool call is a content block and a tool's answer
comes back as a _user_ turn — so the translation runs both ways, including replaying a history
that began on the other provider. That part is pure and tested, because it is the part that goes
wrong halfway through a conversation.

Which provider answered is written on the step, and a fallback says so: a site quietly paying a
second vendor is a thing to notice. The cost is counted against **what answered**, not what was
asked for.

**A caller may set a token ceiling** (`maxTokens` on `ask`), and a bot never does — it gets the
4096 it always got, which is an answer-sized reply. It exists for the enrichment, which rides this
same seam and whose write stage asks for sixty thousand: Anthropic _requires_ a ceiling, so the
default would have truncated the reply mid-JSON, failed its schema, been asked again, failed again
and thrown — on a paid call, with nothing in the error saying why. On the OpenAI side it is sent as
`max_completion_tokens`, since the newer models refuse the old name outright.

**Buying is opt-in, and a key is not consent.** A key in the environment means somebody once needed
one for something; it does not mean this site has agreed to spend money on bots. So nothing is
bought until `AGENTS_LIVE=1` is set, deliberately, by whoever pays the bill. Until then every bot
works end to end on the mock, and the answer it gives says which of the several reasons it is
standing in — no key at all, or a key that has not been switched on.

With no key, with `PLATFORMKIT_AGENT_MOCK=1`, or with `AGENTS_LIVE` unset, it answers from a script
the run itself carries, so the whole machine — the loop, the tools, the resuming, the cancelling —
runs deterministically for nothing. **And a run that carries a script is never bought**, whatever
keys are in the environment. Both rules live in the provider rather than in a variable somebody
remembers to set, which is the difference between "we meant not to spend anything" and "we could
not have".

## A bot is a file

A bot may be summoned on `spaces`, `support`, `coaching` — and `voice`, where it is spoken to
rather than typed at. Voice is a surface like any other: the same audience rule, tools, skills,
memory and limits, with only the words arriving as speech and leaving as speech. A bot on that
surface may say how it sounds (`voice:`), and a bot that says how it sounds without declaring
the surface is refused by the compile, naming both — a voice with nowhere to speak is a file
somebody wrote half of. In the admin, that block is edited as fields: choose the speech provider,
choose an endpoint voice and one of the five named visualizers, write the first sentence, and set
the wait and engine timing as numbers. The endpoint's reader-selectable voices are entered as a
list; nobody types the YAML grammar.

`content/bots/<slug>.md` — who it is, which surfaces it may be summoned on, who may summon it (the
same audience grammar as everything else here), what wakes it without being asked, which tools it
may use, what it may spend, and **its body is its prompt**.

```yaml
---
name: Study buddy
surfaces: [spaces]
for: tier-2
hears:
  - mention # answers when somebody names it in a room
  - schedule: { every: week, on: [monday], at: '08:00' }
    in: the-team/general # where it speaks
    ask: What is on this week? # what it is waking up to do
  - event: purchase.paid # wakes where that event already writes
    ask: Say something useful about this order.
tools: [search_site]
limits: { steps: 12, spend: 0.50, minutes: 10 }
---
You are a study buddy for people reading the wisdom classics…
```

A bot may also name a usage offer by its stable key with `billing`. The same server-side gate reserves or verifies usage before paid provider work and attributes completed calls to the verified person the bot serves, whether they use voice, a private conversation or a shared channel. The offer can be a prepaid pack or a metered subscription through the selected payment provider; unbilled bots keep their existing behavior. Readers review balances and manage top-up in the Usage section of `/billing`, not in conversation history. See [Usage billing](/content/docs/running-a-site/selling/usage-billing) for the offer fields and operating rules.

## Social automations

Social is an inbound bot surface, but its automations are **staff tools**, not a public bot chat. An authorized Social publisher creates an account-specific rule from the Automations view in Social. The bot must be published for the Social surface and eligible to answer an anonymous provider author; a platform handle is never treated as an app account. Rules match a case-insensitive whole word or phrase in one selected event type. Provider webhook signature verification and declared read/write capabilities determine which comment and DM routes can be selected; unsupported routes are not polled or guessed.

Each destination is its own response. A public comment reply is visible to everyone on that social platform. A direct message is visible only to its recipient, and an inbound DM can only be answered privately. The UI keeps these labels beside rules, review drafts and delivery history; both remain private to authorized staff inside the app. See [Social automations](/content/docs/running-a-site/marketing/social-automations) for setup and delivery behavior.

New rules wait as drafts for review. Automatic delivery must be explicitly enabled, sends only to the destinations selected by the rule and rechecks the authorizing publisher’s active Social access and current account permissions before each send. Losing that authority pauses the rule. A publisher needs **View results** to inspect the account’s rules and history, and **Publish now** to change rules or send a reviewed reply. The bot receives only the triggering provider interaction and bounded history from that same comment thread or DM conversation; the model cannot select an account, recipient or destination.

## What a bot is given

A bot is handed the conversation it is in, **as a person reads it** — and it is handed it by the
surface, on the run, rather than fetching anything itself. So a bot can only ever have read what
the person who summoned it could read, and what it was told is a matter of record beside what it
did with it.

**A thread is the conversation.** Summoned inside a thread, a bot gets the thread: its opening
message and every reply. Handing it the channel instead gives it everything except the exchange it
is part of, so a follow-up ("which are best for newbs") arrives with no sign of what it follows up
and the bot asks what on earth is meant. Worse, somebody who opened a thread directly has no
channel list loaded at all, so the context is not merely wrong but empty. Outside a thread it is
the channel, and a thread's replies are not folded in — that is a conversation somebody stepped
aside to have, and the channel does not show it either. The decision is `roomFor()` in
`lib/spaces/model.js`, apart from the drawing of it, because it is the part that has been wrong twice.

**As a person reads it, not as the rows hold it.** A platform line — a purchase, somebody joining —
carries its facts on `meta` and has no body at all; a voice note has a transcript; an attachment has
a name. Building a transcript from `body` hands a bot an empty room: a channel of 181 platform
lines read as nothing, and a support thread where a customer sent a photo and said nothing read as
an empty conversation. `saidIn()` is what a line _says_, whatever kind it is, and every surface —
the room, the desk, and the line a person actually sees — goes through it, so what a bot is given
and what a person reads cannot drift apart.

On a desk the speaker is a **side** rather than a person, because a desk has two of them and no
names; `roomAsProse` takes a `who` for that, and what was said stays the one function.

The words that frame it — the line above a channel's transcript, a thread's, a desk's, and what
stands in for an untranscribed voice note — are `## bots / ### context` in the spaces scope, like
every other string.

## The skills a bot already has

A **skill** is something a bot knows; a **tool** is something it can do. A skill's one-line description sits in the prompt from the start, so the bot can tell whether it is relevant; its body does not, and the bot opens it with a tool when it decides it needs it. Twenty skills therefore cost twenty lines, not twenty pages — which is the point, because putting them all in the prompt makes a bot worse at everything as you teach it more.

**The kit ships four, and a site does not have to think of them.** They are the ones that are the same for every business, because they are about not doing harm rather than about policy:

| skill                    | what it stops                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `what-we-sell`           | quoting a price from memory — every figure comes from the catalogue tool, on the spot                                      |
| `when-you-do-not-know`   | a confident, fluent, wrong answer; it says to check, to mark the edge of what is known, and to raise a ticket              |
| `somebody-elses-details` | confirming whether an address has an account, reading out another person's things, accepting an identity claim as identity |
| `somebody-is-upset`      | soothing instead of answering, and staying on a conversation that should have been handed to a person                      |

**A site's own skills are its policy** — what this business refunds, how long it takes, what it will and will not do. The kit would only be guessing at those, so it ships none of them.

A skill in `content/skills/<name>.md` **replaces** a default of the same name outright rather than merging with it: a skill is a piece of prose telling somebody how to behave, and half of one person's advice spliced into half of another's is worse than either.

**The theme's defaults reach a bot with no checkout.** In a checkout `readSkills` walks the theme package's own skills folder; an Edge Function has no such folder, and before this a bot in a cloud-only deployment quietly lost every skill the theme ships. The assembler bundles them as `pipe/theme-skills.json` and the admin function hands them in as data — the same arrangement the theme's strings already have, and for the same reason.

**The index a bot searches is rebuilt on a publish too.** `content_search` is built from `.velite`
on a machine — and in a deployment where nothing rebuilds there is no `.velite` and never will be
again, so the index it shipped with is the last one it has: an article published there is invisible
to every bot that searches, and nothing says so. `build/search-db.mjs` rebuilds the collections from
the content rows through the **same adapter the browser uses** in cloud mode (`src/lib/entry.js`,
which turns a row into the entry velite would have made) and hands them to the same pure
`searchRows` the build uses — one grammar, two sources, and `build/entry.test.mjs` already pins that
adapter against velite field for field. The hook hangs on all four collections the index draws from,
because publishing any one of them changes what a search should find.

**And the bots reach the surface on a publish.** The worker reads the compiled file, but the surface reads rows, because whether this person may summon a bot is a question only the database can answer against their standing. `build/bots-db.mjs` is that projection with no filesystem in it, so the `bots` model's `projected()` runs it the moment somebody publishes, rather than waiting for a deploy a cloud-only deployment never has. A save over rows moves nothing: a save is a draft. See [The three deployment shapes](/content/docs/building-a-site/deployment-modes).

Set `skills: all` on a bot to give it every published skill, which is what a single-bot site wants — and it is how a default nobody knows about yet still reaches the bot. Naming them one by one means a new one is a new one nobody gets.

## How a bot is offered on a desk

Off unless a file says otherwise. A bot that talks to somebody's customers should not switch itself
on because a feature shipped.

```yaml
offer: ask # off (the default) | ask | always
```

|          |                                                                                     |
| -------- | ----------------------------------------------------------------------------------- |
| `off`    | A staff tool. Somebody presses **Ask the bot** and reads a draft before sending it. |
| `ask`    | The bot offers itself **once**, and the person chooses.                             |
| `always` | It answers every message, from the first.                                           |

**A conversation has one handler at a time** — the bot or a person — which is how every desk that
does this models it. An `always` bot is the handler of every thread. An `ask` bot offers itself once
while the person's question is unanswered, and becomes the handler when they choose it; from then on
it answers what they write, rather than making them press again for every message.

That shape is deliberate. The first version of this put a button under every message, and it offered
"get an instant answer" directly beneath an answer it had just given — because a per-message button
asks the person to route their own conversation over and over. Routing is the system's job.

**Being offered to people means answering them.** `answers: draft` is a staff tool's caution and is
absurd for a bot somebody pressed a button to ask: the answer would go to the staff composer while
the person who asked watched nothing happen. An offered bot answers directly.

**An offered bot needs a ceiling.** `limits.per` is required when `offer` is not `off`, and the build
refuses it otherwise — a per-run budget does not stop one person asking two hundred times.

### Offering a choice

An answer whose last lines are a `- ` list ends in buttons, and what the person presses is sent as their own next words:

```
Which copy is it?

- The paperback
- The hardcover
- Read the delivery policy -> /content/docs/refunds
```

It is the grammar a chat prompt already uses (`_shared/choices.js`, shared by the functions, the browser and the build) rather than a shape only a model may write. That matters more than it sounds: a JSON envelope for quick replies is a thing to validate, a thing to draw, a thing for a model to get subtly wrong, and a thing that leaves a bot which has never heard of it unable to offer anything. Here a bot that knows nothing about buttons writes a list, and it renders as a list.

**The cut happens once, on the way into the row.** The worker takes the list off the words and stores the choices apart — `meta.choices` on a room's message, its own column on a desk's — so nothing downstream reparses markdown and no reader is ever shown the grammar. The first cut of this was at render, and the arrow that points a choice at a form read as an arrow and a path the moment the buttons went.

Not every list is an offer. A list with nothing above it is a list — a summary in bullets, a set of steps — and is left in the words, because buttons need something to sit under. So are more than six, longer than seventy characters, or nested deeper than three: over the cap the list stays as a list, which is the honest failure.

**A press is an act.** It posts as that person's own message, in their own name, carrying the words the offer said — never words the client sent — so the transcript reads as it would have if they had typed it, the mention and the notification and the ear all work on it with no new path, and the bot is summoned with it. It is also a row (`bot_choice`: who, which offer, which choice, where), because the one thing a bot's choices are for — knowing which of the ways forward people take — is otherwise a click that vanished.

**Taken is written down, not guessed.** In a room the offer belongs to the room: everybody sees it, and `space_choose` takes it in a single statement, so of two people pressing at the same moment exactly one gets through and the second is told it is gone rather than the bot being summoned twice. On a desk the same holds for the same person in two tabs. A spent set stays under its own answer, faded, with the one that was taken marked — the thread still reads as what was offered and what was taken — and they all go once somebody has asked for a person, who is not to be offered another lap of the assistant.

The desk bot is told when to offer them: when what happens next is genuinely one of a few things, three or four at most. Buttons under a question with one answer are a form somebody has to fill in to be helped.

### After an answer: did that help?

Every bot answer is followed by a check, which is where the way out lives and where every other desk
puts it:

- **Did that help?** → _Yes, thanks_ · _Talk to a person_
- **Anything else I can help you with?** → _Yes, one more thing_ (the box takes focus) · _No, that is
  everything_ (their thread is marked sorted, and writing again reopens it, as any message on a
  resolved thread always has)

The check belongs to an answer the person **watched arrive**, not to every time the panel is opened:
asking "did that help?" again about an answer from last Tuesday is a bot that has lost the thread. So
a first load sets no check, and only a line landing after that does.

### Getting away from it

**Talk to a person** is not a request the bot is asked to honour. It writes a row
(`support_conversations.bot_off_at`), the server checks that row before starting anything, and any
run already thinking is cancelled. Nothing starts a bot on that thread again until a human has it. A
bot you cannot get away from is a bad bot, and a prompt asking it nicely to hand over is not a
mechanism.

A bot's line on a desk is `author: 'agent'` like any other — it is the business answering — but it
carries `bot`, so somebody is told who answered and the widget knows whether a _person_ has replied
yet. Without that it would offer "talk to a person" to somebody a person had already talked to.

## No provider, no bots — anywhere

A bot declared in markdown is **configured**. It is not therefore usable: thinking is bought, and a
deployment with no provider key, or one that has not opted in to spending (`AGENTS_LIVE`), has
nowhere to buy it. A site in that state shows **no bot anywhere** — no mention in a composer, no
slash command, no Ask the bot on a desk, no assistant in the widget.

One fact, in one place. The worker writes it on each invocation (it is the only thing that knows
what keys it has), and the `bots` table's own read policy reads it, so a site with no provider lists
no bots and every affordance drawn from that list disappears by construction — rather than by each
surface remembering to check. `agent_summon` and the ears refuse for the same reason.

Absent means no: a fresh deployment shows nothing until the worker has run once and said otherwise,
which is the safe direction and self-heals within a minute of the sweep.

## Who may use it, and who it may be used for

Two different questions, and a bot's file answers them separately.

**`for:`** — who may **summon** it. Checked against the person who pressed something.

Both of these are **chosen in the admin, never typed**: the field offers the classes (anyone, signed in, has bought something, has a live membership), every role the site has, every membership tier and everything it sells, and writes the grammar itself. The file still reads as one word where it holds one thing.

**`serves:`** — who it may be **run for**. Checked against the run's subject. On a desk those are
different people, and where a bot answers by itself it is the customer's own message that spends the
money — so a gate on the asker would pass every time and protect nothing.

Both are written in one vocabulary: `anyone`, `authenticated` (signed in, and nothing more),
`customer` (has ever paid for anything), `subscribed`, `tier:<slug>`, `role:<name>`,
`bought:<product>`. Unset means anyone the surface already allows, so a site that says nothing
behaves as it always did.

```yaml
serves: [authenticated] # not for people we cannot identify
serves: [customer] # only for people who have bought something
```

`customer` needs no new data: the ledger already grants a `paid` class on every paid purchase, and
on a guest's account when it is claimed.

## What it costs, per person

A per-run budget stops one answer running away. It does nothing about the same person asking two
hundred times, and identity is not a spend control either — one signed-in paying customer in a loop
costs what a thousand strangers would.

```yaml
limits:
  spend: 0.20 # one run
  per:
    minute: 0.10 # every window given must hold
    day: 2
    month: 20
```

`minute`, `hour`, `day`, `week`, `month` — rolling, not calendar, because "you may ask again on the
1st" is not a thing anybody wants to be told. Counted against the account, or against the contact
for somebody who has none, so a guest is counted too. Checked **before** the run exists, so a
refusal buys nothing. An unknown window is a build error, because a ceiling that silently never
applies is the worst way for a spend control to fail.

## A bot that answers by itself

`hears: [{ event: support-message, ask: "…" }]` and a customer's own message starts a run. Nobody
summoned it, so `asked_by` is null and `for:` has nothing to ask about — **`serves:` is the whole of
the gate**, and the ceiling matters far more than for a summon, because the loop can now be somebody
typing quickly rather than somebody clicking.

One run per bot per conversation at a time, so a fast typist starts one and not five. And set
`answers: directly` or the bot will write a draft nobody is there to send.

## What a run may use

A tool's and a skill's own `for:` is checked against the asker, and anything they may not have is
**withheld, never refused**: absent from the tool list, absent from the prompt. A model told "you may
not" spends steps arguing, apologising, or describing what it would have done — which leaks the
thing the gate exists to hide. The tool list and the skills line are filtered in the same breath,
because a skill named in the prompt whose tool was withheld is a model reaching for nothing.

A run nobody asked for has no asker, so anything with an audience is withheld from it.

## Whose data a run is about

Two questions look like one, and on a support desk they have different answers.

**Who asked** is `asked_by` — `auth.uid()`, whoever pressed the button. It decides whether somebody
may summon this bot, whose run it is to see, and who may cancel it. **Who it is about** is the
run's **subject**, and it is not the same thing:

| surface                | the subject                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------ |
| a room                 | whoever asked — a room is many people, and a bot summoned there answers its summoner |
| a support conversation | its contact, and their account if they have one                                      |
| a coaching thread      | the other member of the conversation — the one who is not the asker                  |

On a one-to-one surface a bot drafts a reply for one party to send to the other, so the person
asking and the person being answered about are different people. That was got wrong: every personal
tool filtered on `asked_by`, so on a desk `about_me` returned the _support agent's_ purchases,
`about_me` their membership, and the bot wrote a draft to the customer about them.

**A tool about a person is given the run, not the person.** `agent_subject(run)` resolves it in SQL,
and each fact is its own function — `agent_orders(run)`, `agent_membership(run)`, `agent_tickets(run)`,
`agent_raise_ticket(run, …)`, `agent_recall(run)`. The Edge Function holds no user id, so there is
none to pass wrongly; `ctxOf` carries where a run is and no identity at all. The obvious fix was to
pass the subject instead of the asker, and the next personal tool anybody wrote would have reached
for whatever was in scope. There is now nothing in scope, and `agents.test.mjs` fails if a personal
tool so much as mentions an asker.

`null` from one of those functions means **there is nobody to ask about** — a guest with no account —
and the bot says so in its own words (`## bots / ### words`). An empty result means this person has
none. They are different answers and the difference matters to whoever is waiting.

Each is `SECURITY DEFINER` over somebody's purchases, so each is the service role's alone, revoked
from `PUBLIC`, `anon` and `authenticated` by name — naming the roles you want is not a fence.

Raising a ticket is the one of them that _writes_, and it needs a word about who is allowed to.
`support_ticket_open` admits the staff and nobody else — which is right, and which silently
included the bot: under the service key `auth.uid()` is null, so `is_staff()` is false and every
ticket a bot raised came back `not-staff`. "Hand it to a person" did nothing at all, and nothing
said so. The bot's own path (`agent_raise_ticket`, the service role's alone, taking its contact
from the run) now declares itself for its own transaction — `app.bot_ticket`, the way
`space_poll_close` declares itself — and the opener admits that one caller by name. `agents-db.test.mjs`
raises one on a guest's thread and asserts it exists, belongs to the contact, and carries no account.

### A bot sees only what that person's own screen could show them

The first cut of this resolved the subject and then wrote `where user_id = …`. Better than being
handed the wrong person, but the filter still lived in a function body somebody could get wrong, and
"this function is careful" is not a boundary.

The boundary is the **shape**. A bot's facts come from the same functions the person's own client
calls — `about_me()`, `get_my_entitlements()`, `support_tickets_mine()` — and every one of them
**takes no argument**. There is no parameter anywhere in the chain that names a person. The only
thing that steers them is `auth.uid()`, and the only thing that sets it is `agent_become(run)`,
which derives the subject from the run. A bot cannot ask about somebody else: not because the code
declines to, but because there is nowhere to put their id.

It also means one implementation of "what may this person see" instead of two. A policy change for
people reaches bots the same day, and a bot can never drift into seeing more than the account it is
answering for.

**What it is not.** Postgres refuses `SET ROLE` inside a `SECURITY DEFINER` function, so the reads
are not literally executed as the subject and a raw table read there would still bypass RLS. That is
why nothing in the agent functions reads a table directly. If a fact is wanted that has no
user-facing function, write one — for people and bots together — rather than adding a query
beside the others. `about_me()` is that: the person's own question, which had no function because a
client reads those tables directly under RLS, written once for both.

A guest is the one case with no account to become. Their tickets hang off a contact rather than a
user, so that is answered directly, filtered to the single contact the run is about; orders and
membership return "there is nobody to ask about", which the bot says in its own words.

### Speaking to one

`/app/voice/<bot>` currently uses the browser tier: the browser's own recogniser listens,
`copilot-llm` thinks, and the kit's own engine speaks. It needs a signed-in session to mint the
conversation grant and save the transcript, but no LiveKit server or speech-provider account. The
browser recogniser may send audio to its browser vendor; the site discloses that before listening.
A one-to-one conversation has no second peer, so the browser tier does not join a media room.

A page has no grant, so there is exactly one route that takes a **session** instead:
`copilot-llm/start`. It is handed the bot's name and answers with a grant for that bot, that
person and a few minutes, carrying the bot's own ceilings so nothing downstream can raise them.
From that point the page holds nothing wider, and a worker handed the same grant never sees the
session at all.

**Barge-in is not an error path.** Speech from the person at any point — while it is thinking,
while it is talking — cancels what is being said, drops the answer being waited for and returns
the turn. The test of a voice assistant is what happens in the half-second after somebody talks
over it; without that it is a kiosk that happens to use a microphone. The turn itself is a state
machine in `lib/copilot/converse.js`, with no browser in it, so that behaviour is pinned rather
than hoped for.

The kit's bot-content compiler check and deployed-function check follow their respective module
switches. The grant, voice-flow, and browser-independent checks still run when those modules are
off.

**A sentence is in one place at a time.** The big line under the orb is the LIVE one: the words as
they are being spoken, caught from the recogniser before it has committed to them, and then that
same sentence held there while the model thinks — a question with no answer yet is the one thing
somebody needs in front of them. The moment the answer arrives the big line goes dark and the pair
drops into the transcript beneath, each bubble sliding in from its own side of the column, the
whole thing scrolling itself to the newest line. Nothing is ever shown twice: a sentence in two
places at once reads as a bug, and the eye does not know which copy to follow.

The transcript is open by default, because a spoken answer is gone the moment it is made, and it is
**also the accessible form of the whole surface**. It can be put away, but nothing is lost by
leaving it up.

**Typing is the other way in, not a fallback.** Somebody mutes the microphone because they are not
alone, and a surface that then has no way to say anything has simply stopped working; Firefox has no
recogniser at all and used to get a wall where the page should be. So a box appears whenever there
is no voice — muted, refused, or a browser that cannot listen — and what is typed goes in exactly
where a spoken sentence does. Nothing downstream knows which it was. A refused microphone no longer
replaces the page either: it says so once and the conversation stands, because the answer, the
voice and the record all work without it.

**The conversations are kept, and there is a drawer of them.** Two tables, both state and both the
person's own: `copilot_threads` is a conversation with one assistant, `copilot_lines` are the lines
in it. Unlike `copilot_memory` — which the platform writes, because a client that could write it
could put words in somebody's mouth for the assistant to recall later — these are written by the
person under their own session: the worst a forged line can do is lie to the person who forged it,
in their own transcript. A line must still go in a conversation that is theirs, not merely under
their own name, or the row is refused. **The title is never typed**: it is the first thing they
said, trimmed to a line, so a list never shows "Untitled" and a thread nobody spoke in is never
listed at all. Every line is kept as it is said rather than at the end, because a conversation has
no end — the tab is closed, the laptop is shut — and a transcript written on the way out is a
transcript that is usually not written.

It is a drawer rather than a column. This surface is one thing in the middle of an empty room, and
a sidebar standing permanently beside it would make the orb a panel in an app; it opens when it is
asked for and shuts itself the moment a conversation is chosen, because what somebody wants after
choosing one is the conversation.

### How an assistant is heard

One shape, two providers, chosen the way the video rooms already choose one:

- **`browser`** — the kit's own Supertonic engine, in the page. The same worker, cached weights and
  mp3 writer this project already ships for the audiobooks, asked for one sentence at a time
  instead of a chapter. **No account, no key, no audio leaving the machine.** The default.
- **`endpoint`** — an OpenAI-shaped `/v1/audio/speech` the site names, for a better or a
  particular voice. **The key never reaches the browser**: the site names the endpoint and the
  platform's own function calls it, which is the only reason this is a provider rather than a url
  in the config.

A site that declares neither gets the browser one, exactly as a video room with no LiveKit account
is still a video room. A business should not have to buy an account to find out whether it wants
the feature.

**It streams, and that is not an optimisation.** Waiting for a whole sentence to be synthesised
before any of it is heard is the difference between a conversation and a form being submitted. So
`copilot-speak` hands the upstream's `response.body` **straight back and never collects it** — a
proxy that awaits the whole response produces correct audio and a silence before every turn, which
is the feature thrown away while still appearing to work. The default format is **PCM**, because
raw frames queue into the browser's audio graph as they land while compressed audio needs a decode
per chunk, and because PCM is trivially analysable, which the visualizer wants anyway.

Interrupting cancels the reader, so the rest stops being **sent** rather than merely not played —
an abandoned answer that keeps arriving is still being paid for and still arriving when the next
one starts.

The settings are `COPILOT_TTS_URL` (the base, or the speech path outright — both are ordinary
things to paste), `COPILOT_TTS_KEY`, and optionally `COPILOT_TTS_MODEL` and `COPILOT_TTS_VOICE`. A
deployment that names none gets a plain `no-endpoint` and the page speaks for itself: the fallback
is the designed path, not a rescue.

An utterance is **one sentence, and the last one wins**: a conversation is not a chapter, so when
somebody interrupts, what was being said stops and what is being said now takes its place. Every
utterance carries an id and `cancel` abandons it — and an answer from the endpoint that arrives
after it was interrupted is thrown away rather than spoken over.

**The optional LiveKit worker is wired to the reader voice page as a step-up transport.**
When `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are all set,
`copilot-llm/start` returns a room token with explicit dispatch for the `copilot` worker and the
signed conversation grant as job metadata. The page joins that room and sends each identified text
turn on `copilot.input`; the worker accepts turns from that participant, calls the same
OpenAI-shaped completion endpoint with the grant, and returns assistant text on `copilot.output`.
The worker runs in text-only mode and opts out of the Agents SDK's inference-backed defaults with
`vad: null` and `turnHandling.turnDetection: null`; without those explicit values the SDK
auto-provisions Silero VAD and an inference turn detector. It does not configure STT or TTS. The
page feeds the returned text into its existing conversation and speech path, so the browser remains
the voice output and LiveKit Inference is not used. With all three settings absent, `/app/voice` keeps
the direct browser-to-endpoint path; a partial LiveKit configuration is refused rather than treated
as a successful fallback. Self-hosted and hosted LiveKit use the same three settings. Self-hosting
adds server compute and network operations; a hosted account has that provider's usage charges.
Model and any configured speech endpoint usage remain separately billable.

**The first word is the only one anybody waits for, and the kit's own voice is tuned for that.**
The audiobook engine packs sentences together up to 300 characters and speaks every piece at eight
solver steps, which is right for a chapter — it is made before anybody presses play. In a
conversation it was the difference between an assistant and a form. Measured on an M2 Max: a
four-sentence answer came out as ONE 219-character piece and took **3.7 seconds** before a word was
heard, because the browser TTS worker only handed over the finished mp3.

Two things changed and both are measured rather than argued. The browser TTS worker now hands over **each piece
the moment it exists**, as float samples the page queues straight into its audio graph — no encode,
no decode, no waiting for the last piece to make the first audible; the mp3 is still assembled and
still arrives at the end, so nothing that caches recordings changed. And the answer is **cut for a
fast start**: the opening piece is the first sentence, or its first clause where that sentence runs
past a dozen words, and everything after it is packed as before. Never mid-phrase — "whichever is
shorter" taken literally cuts a noun phrase in half and the voice drops as though it had finished,
so where there is no clause boundary to stop at the whole sentence is spoken and the start is
simply slower.

Neither of those alters a single sample, and together they are most of the saving:

| answer                | before  | after   | first word sooner by     |
| --------------------- | ------- | ------- | ------------------------ |
| "Yes, that is right." | 632ms   | 615ms   | — (one piece either way) |
| one long sentence     | 1,963ms | 779ms   | 2.5×                     |
| four sentences        | 4,136ms | 1,185ms | 3.5×                     |

There is a third lever and it is **off by default**. The solver's steps cost very nearly linear
time (one sentence: 329ms at two steps, 576ms at four, 1,077ms at eight), and since only the
opening piece is ever waited for, making just that one cheaply takes the four-sentence answer to
about 500ms. But it is the one change here that alters how the voice SOUNDS, and a voice that
arrives sooner and sounds worse is a bad trade for a kit whose claim is that the free voice is
good enough — so `opening` defaults to the same value as `steps`, and a site that would rather
have the speed sets `opening: 3` itself.

A bot's `voice:` block sets any of it — `steps`, `opening`, `words` (how short the opening tries
to be) and `gap` (the pause between pieces; a chapter's 0.45s is a drawl in a conversation, so a
conversation uses 0.12s). `visual` picks the shape of the orb. The defaults live in `TALK` in
`lib/copilot/chunk.js` beside the measurements that chose them.

**What the reader decides is behind a cog, and it is four things.** Which voice (the kit's own ten
where the kit is speaking; where the site named an endpoint, only the voices that site said it
would offer — a row with nothing in it is not shown at all), what **language** (the model reads
thirty-one, and the choice drives the recogniser as well as the voice, so it is one setting rather
than two), which **shape** the orb is — the five are offered as five little drawings rather than
as a list of words, because a shape is a look and nobody picks a look from a dropdown — how
**fast**, and **how they are heard**. The site sets the default with `voice.visual`; a reader who
changes it keeps their own. They live in that browser rather than in the
account, because they describe a DEVICE as much as a person: the laptop in a shared office wants
push-to-talk and the same person's phone at home does not, and a preference that needs a sign-in
to express is a preference nobody sets.

**Push and hold to talk is not a lesser mode.** An always-open microphone is the better
conversation and the worse room-mate — in an office, on a train, in a house with other people in
it, "this page is listening" is a thing somebody reasonably does not want — and for some people
holding is simply the easier control. So it STOPS the recogniser rather than muting it: nothing is
listened to between presses. Holding also interrupts, so cutting in costs one gesture rather than
two. The microphone button carries both jobs, since there are two ways of being heard and only one
microphone: where the microphone is open it mutes, and where it is held it is the way in.

**The aura turns, and turns faster while there is a voice.** Amplitude on its own is a pulse: the
ring swells and shrinks on the spot and reads as a meter. What a voice looks like is motion round
the ring. Each strand turns at its own rate and every other one turns the opposite way, so they
shear past each other and the crossings travel instead of sitting still — a single shared rotation
would turn the whole picture like a wheel, which is a duller thing entirely. The phase is
integrated rather than taken from the clock, because multiplying time by a speed that changes
makes the picture jump as the speed moves. Measured: about 0.13 radians a second at rest and 0.64
with a voice.

**Reduced motion leaves a still, legible shape.** `VoiceVisual.vue` paints the selected shape once at rest when `prefers-reduced-motion` is set, while the spoken state remains available to assistive technology; the call surface also removes its glow, transcript, drawer and control transitions. Thinking and connecting remain distinct states without requiring movement.

**The shape follows the SOUND, not the turn.** The visualizer used to choose what it drew from
the state — the assistant's level while speaking, the microphone's while listening. That is right
only as long as the state and the audio agree, and they disagree constantly: a reply plays on
after the turn has come back, an interruption returns the turn mid-sentence, and a phase that
never advanced leaves a whole reply unaccounted for. Measured in the running page, the assistant's
level tracked its own voice perfectly — 0.34, 1.00, 0.55, 0.02, 0.76, 1.00 — while the phase sat
at `listening`, so every one of those numbers was thrown away and the orb drew the silent
microphone instead. Every part was correct and the junction was not. Now the assistant's audio
counts whenever there is any of it, and the microphone is never drawn while it is audible — it is
hearing the reply through the speakers, and an orb wobbling to its own echo lies twice.

**And loudness is the envelope of the waveform, not a mean over the spectrum.** Speech puts nearly
all its energy in the bottom fifth of the frequency range, so averaging across every bin divides
it by the silent rest and lands on a small, steady figure; stacked with the analyser's smoothing
and the smoothing in `frame`, it sat at 0.300 — dead flat — for a whole reply. A voice's envelope
is how far the waveform swings from centre right now, which rises and falls with every syllable.

**An assistant must not answer itself, and on the web there is only one way to stop it.**
On speakers the microphone hears the reply, the recogniser transcribes it, the machine takes it
for the person, and the assistant answers itself forever. Two attempts at this failed for the
same reason: they read the recogniser's results and discarded the ones that looked like echo.
That cannot work, and the reason is a fact about the platform rather than a bug — **`SpeechRecognition`
opens its own microphone capture inside the browser**. The stream a page asks for with
`echoCancellation: true` is a second, separate stream; our constraint does not touch what the
recogniser hears, and by the time a result arrives it has already heard the speakers.

So the only control that works is the one it offers: **while the assistant is audible the
recogniser is stopped**. Half-duplex, which is what every agent built on the Web Speech API does,
because there is nothing else to do.

That would cost barge-in, so barge-in is taken from the stream we DO control — the one with echo
cancellation, used for the levels — and it cannot use a fixed threshold either, for the same
reason the first attempt failed: **the echo is loud**. On a laptop it clears any threshold worth
having, so the leak satisfied the test for "somebody is really talking" and let itself through.
How loud a room's leak is depends on the room, so `lib/copilot/echo.js` **learns it**: whatever
the microphone reads while the assistant talks is the leak, tracked as a slow envelope, and a
person has to be clearly over it. Measured: a 0.35 leak settles the bar at 0.48 and a 0.55 leak
at 0.76, while on headphones the bar stays at its floor and a quiet word interrupts. The envelope
is slow enough that somebody talking over the top does not teach it that interruptions are normal.
A last line needs no microphone at all: a sentence that matches what the assistant just said is
the assistant, whatever any level claims.

**A voice that STOPS working falls back, which is not the same promise as one that was never
configured.** The second was handled from the start; the first is the one that actually happens — a
key expires, an account runs out of credit, a provider has a bad hour. The endpoint then answered
502 to every utterance, the speaker resolved with nothing, and the assistant was **silent**: no
error, no fallback, no sign anything was wrong. It now falls back to the kit's own voice on the
first failure and stays fallen, because retrying a dead endpoint costs a round-trip per sentence
to learn the same thing. "An assistant that sounds ordinary is better than one that says nothing"
has to hold at run time or it is a comment rather than a promise.

**The engine is built as the page opens, not at the first answer.** `warmSpeech` has already put
the weights and the default voice in the browser's cache by the time anybody reaches a voice page
— but it deliberately stops there: no worker and no sessions, because a reader browsing articles
may never ask to hear anything and the sessions hold about a gigabyte. A page whose whole purpose
is being spoken to reverses that calculation, so it starts the engine on mount — and only where
the kit's own voice is the one that will speak, since a deployment with a working endpoint should
not hold a gigabyte it has no use for. Where the download has not happened, the surface says so
with its progress, because several minutes of silence is indistinguishable from broken.

**Which of the two providers speaks is the site's decision and never the reader's.** There was
briefly a control on the page for it, and it was wrong: nobody using an assistant has any way to
know what "studio voice" or "this device" would mean for them, and the answer does not change
from one visit to the next. It is `voice.by` in the file, once. What the reader DOES get is the
only question about the voice that is theirs — **whether it speaks at all**. Off means no speech
is made rather than speech made and muted: nothing is synthesised in the page and nothing is
asked of an endpoint the site is paying for, and the answer is still written down, which is what
the transcript was always for.

### A bot that is spoken to

`copilot-llm` is a **door, not an engine**. Every decision — which bot answers, what it may reach,
what it may spend, when it stops — belongs to the loop above and is untouched: the same run rows,
the same lease and cancel, the same tools with their permission checks, the same per-person
ceiling. Nothing about the thinking is written twice, because a second copy is a second place for
each rule to be got wrong.

Three things the loop's existing door cannot do, which is the whole reason this one exists:

- **Shape.** A voice front end speaks OpenAI chat-completions and nothing else without custom code;
  the loop is invoked by a database RPC and has no HTTP shape at all.
- **Caller.** `agent_summon` begins `if auth.uid() is null` — a person. Here the caller is a worker
  outside the deployment holding a grant, so it comes through the service-role door
  `copilot_turn`, exactly as enrichment comes through `agent_job`. That function makes every check
  `agent_summon` makes, against the subject the grant names rather than against the caller.
- **Answer.** `post()` writes an answer _into_ a surface's table and the client reads the row.
  Nothing returns one on the response, and a spoken turn needs one.

A client may send `system`, `tools`, `model`, `max_tokens` and `temperature`; all of them are
**ignored**, because the bot's file decides them. Ignored rather than refused, since every OpenAI
SDK sends some by default and refusing would make the door unusable with the libraries it exists to
serve — but no client can supply a prompt, name a tool, choose a model or raise a limit.

The response is **server-sent events from the first commit**, even while the answer is written in
one piece: that shape is what lets a spoken preamble and token streaming land later without the
worker changing, and the worker is the part that is hard to redeploy.

The OpenAI shape is a **choice, not a necessity** — the worker could speak a protocol of ours
through a custom LLM class. It is worth one adapter to keep the worker a stock plugin that knows
nothing about any site, and to let anything else that speaks OpenAI reach the same bot.

### What a spoken conversation may do

The thing that listens to a voice conversation runs **outside** the deployment — a worker in a room
with somebody's microphone. It is not given a session. It is given a **grant**
(`_shared/copilot/grant.js`): a signed token naming one bot, one person, one room, the ceilings it
may not exceed and when it dies.

Not the person's JWT, which is the thing not to hand a third-party process — a JWT is every door
that person can open, for as long as it lives. A grant is one door and a short clock (thirty
minutes), so a worker that leaks one leaks that and no more. The ceilings are _in_ it rather than
looked up, so a worker can only present what it was given, never ask for more.

Signed rather than stored because the endpoint verifies it on every turn and a lookup per turn is a
round trip in the middle of somebody speaking: HMAC over the service role key, the same way the
unsubscribe link derives its own. A bad signature and a tampered field give the same answer on
purpose — saying which was wrong tells somebody trying things which half to keep.

### Where what it recalls is kept

`person+recall` is the only setting that writes anything down, and what it writes is
`copilot_memory`: what somebody said, which assistant they told, and a 384-wide vector of it.

**State, never a projection.** If the database were deleted and the repository redeployed this must
not come back — it is what a person said, not something a file declares. So it is theirs: they read
their own and nobody else's, they delete their own, and **no client may write to it at all**. There
is deliberately no insert policy and no update policy, because a client that could write here could
put words in somebody's mouth that the assistant would later recall as theirs.

The vectors are **gte-small's**, made by `Supabase.ai` inside the edge runtime — free, no provider
key, no egress, and it works on a reset local stack, which is what lets a deployment with no model
provider at all still have an assistant that remembers. They are **not** the browser's vectors: the
site's own search is ternlight, also 384 wide, a different model, and the two must never be
compared.

Recall is a nearest-neighbour read over that person's rows for that bot, capped by count **and by a
distance floor**. The floor is the part worth keeping: a nearest neighbour is always _something_, and
recalling an unrelated remark is worse than recalling nothing, because the assistant then sounds as
though it misremembers.

On the spoken page, the conversation drawer has a **What I remember** view for bots using
`person+recall`. It lists only the signed-in person's memories for that assistant, newest first;
each can be forgotten there. The table's own-row read and delete policies are the boundary — the
browser never writes a memory, and forgetting it removes it from the next recall.

### What a bot remembers

`memory` in a bot's file, and it now does something:

- `none` — the question and nothing else.
- `thread` — the conversation it is in, which is what the surface hands it. The default.
- `person` — and what this **subject** has asked before, across conversations, oldest first so the
  live conversation sits nearest the question.
- `person+recall` — and what they have **told** this bot, across every conversation, found by
  meaning rather than by recency. The only setting that writes anything down, which is why it is
  its own word rather than a flag on `person`: remembering somebody is something a file asks for
  on purpose, and something they can ask to have deleted.

The set is decided, like the builtins — `MEMORIES` in `lib/agents/loop.js` is the one list, and
the compile reads it rather than keeping a second copy, because two lists of one decided set is how
one of them falls behind.

`person` is the subject's history and never the asker's. A desk bot recalling what a support agent
had asked about other customers would be the same leak as looking up their orders, wearing a
different hat — which is why the recall is resolved from the run and why it is off unless a file
asks for it.

## Where an answer goes, and whose name it is in

In a room a bot speaks **as itself**: its line carries its name and a bot mark, everybody can see a
bot said it, and posting is the whole point of summoning one. On a desk it would be speaking **as
the person on the desk, to a customer**, in a thread that then reads as answered — so by default it
does not speak at all. It hands back a **draft**: the answer lands in the composer with a note over
it, and a human sends it, rewrites it or throws it away.

A bot may say `answers: directly` in its own file and take the desk over — a bot that _is_ the
coach, or a front line nobody is staffing. That is a decision somebody writes down, in a file, in a
pull request; it is never what happens because nobody thought about it.

A run that could not deliver its answer keeps it — the row holds what it said — but the failure is
written down as a step. A bot that silently says nothing is indistinguishable from a bot that is
broken.

## Edited as fields, never as its grammar

A bot's file holds three structures — what wakes it, what it may spend, and whether it knows every
skill — and the admin drew all three as raw JSON: a textarea whose placeholder said `JSON`, and an
input showing `[object Object]`. That is the rule this project has about structured data, broken on
its own machinery: people cannot be relied on to type structured text and must never be asked to.

So the drawer asks for each part with the control that fits it. **What wakes it** is rows — a kind
picked from a list (somebody names it in a room · on a schedule · something happens on the site) and
then only what that kind needs: a schedule asks how often, on which days, at what time, where it
speaks and what it is waking up to do; an event asks which one, in the platform's own words. **What
it may spend** is numbers, the per-run budget beside the per-person ceilings. **Skills** is a
question rather than a list, because `all` is a real answer and means every published skill
_including the one written next month_ — a multiselect handed `all` drew the word "null".

The file is unchanged either way: the grammar takes the block apart on the way in and puts it back
on the way out, writing only what differs from nothing, and `agents.test.mjs` holds the round trip.

## Waking without being asked

A bot may say what wakes it, and a trigger that the system would not act on is refused by the
compile rather than quietly ignored — a file that says `hears: schedule` and means nothing is worse
than one that says nothing.

**mention** — somebody names it in a room, and what it is asked is what they wrote.

A mention is heard by the **database** — `trg_agent_hear_mention` on `space_messages` finds the first bot a message names and summons it — and not by the client that wrote the line. Every refusal `agent_summon` already makes is still made: the bot must be published and live, offered on this surface, its audience must admit that person, and they must be able to read the room. What moved is _where the asking is noticed_, not _who may ask_.

It used to be the browser's job, and that works for exactly one client: a line written by anything else — the [Matrix surface](/content/docs/building-a-site/matrix-api), a bridge, a script holding a key — landed as a perfectly good row that no bot ever heard, and nothing anywhere said so. The desk never had the problem because the desk has always had a trigger. The browser no longer asks, on purpose: two paths that both summon would summon twice, and a bot answering a question twice is worse than one that does not answer.

**schedule** — the recurrence grammar the rest of the platform uses (`every`, `on`, `at`, `zone`,
`interval`, `until`, `except`; see [What is on](/content/docs/building-a-site/social-network#what-is-on-events-and-what-can-be-booked)), plus `in:`
— the room it speaks in, `<space>/<channel>` — and `ask:`, what it is waking up to do. Both are
required: a schedule with neither is a run that happens every Monday and goes nowhere.

**event** — one of the platform's own (`purchase.paid`, `subscription.started`, `account.new`,
`print.failed`, `support.escalated`), plus `ask:`. It wakes in the room that event already writes
into, with the facts on the run as its context — so a bot that comments on orders is three lines in
a file and no code at all. An event nobody declared a bot for costs nothing: the same loop that
writes the line looks for one and finds none.

The clock is kept **on the bot**, not worked out from its runs, and the rule is _the last
occurrence between the last firing and now_. Two things follow, and both are what you want: a run
that was cancelled or failed still counts as that Monday having happened, so nothing is sent
twice — and a site that was down for a week says good morning **once** when it comes back, not
seven times over the next half hour. A bot that has never fired has its clock started at now
rather than replaying every occurrence since the file was written.

Two cron jobs carry it: one asks what the clock is owed every five minutes, and one sweeps up any
run whose worker died. Both do nothing at all when there is nothing waiting.

## When it stops, and what it says

A run that ends without an answer says so where it was asked — cancelled, out of money, out of
steps, out of time, nothing to add, or it failed. **Those words are markdown**, like every other
user-facing string: `## bots / ### endings` in the spaces scope, the site's over the theme's,
and a bot's own `endings:` over both. The compile resolves them per bot and writes them onto the
bot the worker carries, because the worker is Deno and cannot read the content. The loop itself
keeps no English at all: with no words it says nothing, which is the right failure — a bot that
has lost its words should go quiet rather than start speaking English at somebody's customers.

**The room hears the ending; whoever asked hears the reason.** A customer has no use for a status
code, but the person who pressed the button is usually the one who can fix it, and the commonest
failures are all theirs: no credits, a bad key, a rate limit, a model that is not theirs to call.
So the surface shows them the provider's own sentence, taken out of whatever JSON it arrived in,
and the room is told only what the bot says.

## Skills: what a bot knows

A tool is something a bot can **do**; a skill is something it **knows**. `content/skills/<name>.md`
— a one-line `description`, optionally the `tools` it brings and who it is `for`, and a body that
is the instructions.

**Only the description is in the prompt.** That is the whole mechanism, and it is the difference
between a skill and more prompt: a bot with twenty skills carries twenty _lines_ into every call,
sees which one is relevant, and opens it with a tool (`open_skill`) when it needs it. Put the
bodies in the prompt instead and the bot gets worse at everything as you teach it more — which is
the opposite of what a skill is for. The refunds skill shipped here is 159 characters in the
prompt and 1,756 behind the tool.

The description is therefore the **whole interface**: it is all the bot sees until it opens the
skill, so it should say _when to use this_, not summarise what it says. A skill without one is
refused by the compile, because it would never be opened.

**A skill may bring tools**, and they are offered only once it has been opened — so the refunds
skill can carry the refund tool, and a bot that never opens it is never offered it. Which skills a
run has opened is read off its own steps, so a run resumed on another machine knows exactly what
the one before it had open. A tool the model names but was not offered is refused as if it did not
exist.

```yaml
---
name: refunds-and-returns
description: What to do when somebody asks about a refund. Open this before saying anything about money going back.
tools: [issue_refund]
for: anyone
---
Read this before answering anything about a refund…
```

A bot names them (`skills: [refunds-and-returns]`, or `skills: all`).

## Tools are declared, and there are three kinds

### Five tools, not seven

A tool's name and description are **prompt**, not documentation: they are what a model reads to
decide whether this is the thing to reach for. `whats_on` was opaque, and "What something costs on
this site" reads like it wants one thing — which is part of why a bot went and read a price off a
landing page instead of asking.

|                |                                              |
| -------------- | -------------------------------------------- |
| `search_site`  | what the site has published                  |
| `catalog`      | everything sold and what it costs            |
| `about_me`     | this person's orders, membership and tickets |
| `get_events`   | what is happening and when                   |
| `raise_ticket` | hand it to a person                          |

It was seven. `my_orders`, `my_membership` and `my_tickets` were one question asked three ways —
three round trips for "tell me about this person", three descriptions to choose between, and three
places for the same mistake to live, which is exactly what happened: all three filtered on the asker
rather than the subject and all three were wrong identically. And `price_of` was a _category_ tool
over the catalog, with no principle saying where such tools stop — why not `shipping_of`,
`availability_of`, `tiers_of`.

What is deliberately still separate is the one **action**. Reads of the same subject collapse;
acting on the world does not, because per-tool audiences buy least privilege — a bot can have
`about_me` without `raise_ticket`.

`agents.test.mjs` asserts the exact set rather than a count, so a sixth tool is a decision somebody
makes on purpose.

**What a phrase is searched by.** `catalog` matches an asker's phrase against a thing's sku, title,
kind and tier, and where the whole phrase matches nothing it tries the phrase's words — so "what do
memberships cost" finds the memberships rather than answering that the site sells nothing. The words
of the _question_ are dropped first, or "what" matches a book called _What It Is and How To Use It_
and somebody asking about prices is shown paperbacks. Which words those are is a **string**:
`## bots / ### words / asking` in the spaces scope, the theme's list with the site's over it. A list
the kit compiled in would be English for every site in every language.

**OpenAPI** — `content/tools/<name>.md` naming a spec (a file or a url) with an allow-list of
operations. Anything with an API becomes a tool without a line of code. The spec is read **at
compile time**, so a bad one fails the build rather than a run.

**Code** — a module the site ships (`module:` pointing at its own file), for the ability nobody
could have anticipated.

**A tool answers for somebody.** One that touches a person's own things is marked `personal`, is
told who it is answering for — taken from the run's row, never from anything the model said — and
filters by them; with nobody asking, it refuses. A bot can reach exactly what the person who
summoned it could reach. That filtering is written out rather than left to a client pretending to be
them, because there is no honest way to make that client. A tool needing the desk's own reach says
`needs: desk` and is only offered where that is true.

## The kit's own bot

Every site that sells something has the same first hundred conversations: where is my order, what
does this cost, what does my membership include, can I have a refund. So the kit ships **the desk
bot**, off, and a site either turns it on, **extends** it (`extends: desk` — the kit's conduct and
tools come first, the site's words after, which is how a site says "and we are closed in August"
without rewriting it), or ignores it entirely.

Its prompt is about **conduct, not about the business**: what the business is, it looks up. A prompt
stuffed with facts is a prompt that goes stale, and a bot that states a refund policy from memory
will one day state the wrong one. It is told when to stop and fetch a person — something that needs
doing rather than explaining, a request for money back, somebody upset — and what it may never do:
promise a refund, a discount or a date, or ask for anything it would not ask for in public.

## Commands

`content/commands/<name>.md` — a slash command, whose **arguments are fields and never a syntax**.
A command either asks a bot (with a prompt, which is its body) or runs a tool directly, and carries
the same audience grammar, so `/summarise` can be for the staff and `/refund` for the desk. A
command offered on a surface its bot does not work on is refused by the compile, as is an argument
of a kind no control can draw.

```yaml
---
name: summarise
hint: Catch up on what has been said here
bot: scribe
surfaces: [spaces]
for: authenticated
args:
  - { name: since, kind: span, label: How far back, default: 1d }
---
Read what was said in this room since {since} and write a short catch-up…
```

In the composer, `/` at the start of an empty line offers the commands this person may run here;
choosing one opens its arguments as **controls** — a span as a number and a unit, a choice as a
list, a person picked from the room, a boolean as a switch. Nobody is asked to remember that
`/summarise 2d` means two days, and nothing can be mistyped into meaning something else.

**The prompt is resolved by the worker, never sent.** The compile writes two files: the browser's
copy carries the name, the hint and each argument's shape — everything needed to draw a form and
nothing else — and the worker's copy carries the prompt. So a client cannot send its own words under
a command's name, and changing what a command does is an edit to a file in a pull request.

What the room has been saying goes **with** the run, written onto the row, rather than being fetched
by the bot on its own account: a bot can then only ever have read what the person who summoned it
could read, and what it was given is a matter of record beside what it did with it.

## What is deliberately not here

No app directory. Outside agents reach us through the APIs we already wear — the Chatwoot-shaped
desk API, or an inbound webhook with a scoped key — which is one page of documentation rather than a
marketplace to run.

## A bot cannot be put in an encrypted room

A room with `encrypted: true` is one the site cannot read — see
[Encrypted channels](/content/docs/building-a-site/encrypted-channels). A bot would have to read it
in order to answer in it, so it is refused: the admin does not offer a sealed room when a schedule's
`in:` is being chosen, and the compile refuses one written by hand, naming the room.

Both ask the same function (`sealedRooms` in `build/spaces-io.mjs`), so the form and the build
cannot come to different conclusions about the same room. Leaving the room in the list and refusing
the save would teach the rule by failing somebody; leaving it out teaches it by the room simply not
being one of the choices.
