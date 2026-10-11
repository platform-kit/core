---
title: Accounts and roles
description: How people sign in, what a confirmed address gates, who is staff, and the test accounts a development copy comes with.
order: 41
sources: [packages/kit/build/who-can.test.mjs, packages/kit/build/signed-in-as.test.mjs, packages/kit/src/lib/auth.js, packages/kit/supabase/functions/_shared/permissions.js, packages/kit/build/permissions.test.mjs, packages/kit/build/permissions-db.test.mjs, packages/kit/build/site-permissions-node.mjs, packages/kit/src/lib/identity.js, packages/kit/build/identity-probe.mjs, packages/kit/src/lib/provider.js, packages/kit/src/lib/lockdown.js, packages/movable-types/src/components/AuthModal.vue, packages/kit/supabase/seed.sql, packages/kit/supabase/schemas/10-foundation.sql, packages/kit/src/lib/auth-notices.js, packages/kit/supabase/functions/_shared/roles.ts, packages/movable-types/src/components/admin/PeopleAdmin.vue, packages/kit/build/dev-account.mjs]
reviewed: 2026-10-02
---

## Who can do what, checked

Nine kinds of person are seeded, and until `build/who-can.test.mjs` four had never been signed in
as by any test and three had never been signed in as at all — a **provider** (somebody who sells
their time here), an **editor** (content but not the admin) and a **buyer** (owns a book, holds no
membership). Those three are where a privilege bug lives, because each is near a boundary: almost
staff, almost an administrator, almost a member.

The matrix asks what each of them can **do**, not what they can see. A hidden button is not a
closed door — the `is_staff()` leak was exactly that shape, with nothing in the interface offering
an analyst the support desk and the desk answering them anyway. So every cell is an attempt made
as that person through PostgREST, and the answer is what the database said.

And every capability must have somebody who CAN. A matrix of nothing but denials would pass
against a site that refused everybody, which is broken rather than secure.

Putting the old leak back fails it three times over, naming the provider, the editor and the
analyst.

## And the same question asked of the pages

The matrix above asks the database. `build/signed-in-as.test.mjs` asks the **site**, because the two
can disagree in both directions and each way costs something different. A door open with its button
hidden is a leak: nothing offers it, so nobody notices, and it is reachable by typing the address.
A door shut with its button shown is a person clicking something that then refuses them — less
dangerous, more insulting, and invisible to a policy test, because there the policy is right and it
is the page that is wrong.

So each kind of person signs in through a real browser, and what is asserted is the set of admin
sections they can reach **by address** rather than by link. The admin is one shell of many sections,
and somebody who asks for a section they may not have is diverted to the first section they may:
never shown the one they asked for, never an empty frame, never a blank page. The section actually
shown is read off the page, so the whole property is one assertion per person rather than a list of
forbidden strings:

| | reaches |
| --- | --- |
| no role | told plainly, at every address |
| provider | Pages · Notifications |
| editor | Articles · Notifications |
| analyst | Analytics · Notifications |
| support | Support · Notifications |
| administrator | every section |

A provider's **Pages** is the one record they own and nothing else. They were always allowed it —
the rail has always offered it — but the shell loaded the collections only for somebody who may
edit every kind of content, so the view rendered nothing and a diversion sent them to the browser's
notification settings instead. What they reach there is fenced on the server, not filtered in the
page: the request carries the one collection and the one field, and the pipe answers for exactly
the records whose owner is their username. Every verb of that fence is asked twice in
`build/admin-fence.test.mjs` — once for a record that is theirs and once for one that is not.

And each of them then **does** the thing their role is for — the editor given the articles, the
analyst a figure, the desk the people who have written in — because a section that rendered its
title and nothing else would pass every check above. Whoever they are, they are still somebody, so
the library is opened as them too.

Widening the shell's support gate from the support role to any staff member fails it three times,
naming the provider, the editor and the analyst.

## Signing in

The sign-in modal is one form for somebody new or returning: it tries to sign in, and when that is refused it creates the account with the same two fields. So a new account has a session at once, and an existing account with the wrong password is told the same way as any wrong password. Google sign-in and a magic-link sign-in are available when the deployment enables them. A feature can open the modal to resume an action after sign-in: password authentication continues in place, while email and Google redirects carry the same-origin return address; an external target is rejected in favour of the site.

**Forgot your password?** under the password field sends a reset email (the `recovery` design); the link comes back to the site and the modal opens on a new-password form.

## The confirmed address

Confirmation is the site's own. At sign-up a magic link goes to the address; a profile is marked **verified** only by a token that came from that link or from a provider (Google sign-ins arrive verified). What waits for it: the results of a site's readings, and being reachable from the support desk. The sign-in itself never waits for it — a quiz must be open to somebody whose link is still in the post.

## Classes and access

For every rule that asks who somebody is, there are four classes: **guest**, **authenticated** (signed in), **paid** (has bought something — an unlock, a copy, a file), **subscribed** (a live membership, and, for a week, someone who bought a paid session). A book's free chapters, an article's access level, an ad's audience, the chat's gate and the content API's paywall all read these — one rule, `_shared/access.js`, shared by the app and the functions.

A purchase made as a guest (a printed copy or a file, bought with no account) moves onto the account when one is made with the same address, so the buyer's files and orders are there when they sign in.

## Staff roles

A person holds a **set** of roles (`profiles.roles`), and somebody holds none. There are five, and anybody may hold any combination of them — somebody who coaches and also writes the articles holds `provider` and `editor`, and is not thereby made an administrator:

| Role | What it reaches |
| --- | --- |
| `admin` | everything |
| `provider` | the coaching chat, their own hours and bookings, and the community as a coach |
| `editor` | every content collection, the media library, the words, and publishing (not the Spaces page, which grants capabilities to named people) |
| `support` | the support desk and its notifications |
| `analyst` | the dashboards — and writes nothing anywhere |

What a role reaches is always asked as a **named capability**, never as a comparison against a role's name: `is_admin()`, `is_staff()`, `is_provider()`, `may_edit_content()` and `may_see_figures()` in the database, and the same names from `_shared/roles.ts` in an Edge Function and `lib/auth.js` in the browser. So what a role means can be changed in one place, and a policy that compares a role's name is a fault.

Nobody grants themselves a role: the profile guard refuses the column to every client write, exactly as it refuses the Stripe id and the verified address. An administrator gives one on **People → People**, from that person's own page — and the last `admin` cannot be taken away, so nobody can lock everybody out. `set_roles(user, roles)` is the one way in, and it is administrators only.

## People → People is every account, not only the staff

The page lists **everybody with an account here**, searched by name, address or username and narrowed by what the site already knows: on the staff, providers, members, anybody who has bought something, or an address that never answered its confirmation. It pages, because a site with twenty thousand people is not one page.

Opening somebody shows what the site holds about them and nothing it had to ask for:

| | |
| --- | --- |
| what they may do | every role, as a switch — the only thing this page changes |
| what they hold | every live entitlement, with what grants it |
| what they have bought | every purchase and refund, newest first, with what it cost |
| what they pay | the live subscription, its status, its period, and a pending step-down |
| what they have booked | their bookings, past and to come |
| their invoices | a link out to the payment processor |
| what we have noticed | [the traits](/content/docs/running-a-site/community/achievements-and-traits) the declaration names, for the staff it names |

**Nothing else on it is editable.** It is a page for seeing who somebody is; changing their address, their name or their membership from behind their back is not a thing this admin does. And their invoices are a link rather than a copy: this database has never held a card or a bank detail, and `admin_person` returns none.

`admin_everybody(q, narrow, limit, offset)` and `admin_person(id)` answer an administrator and return `null` to anybody else — a policy, not a hidden rail.

### What each of them sees of the admin

The rail is the sections whose capability the person meets, and the admin opens where they work — the figures for anybody who may see them, the desk for an agent, the first kind of content for somebody who writes. An address typed by hand is no way round it: the reads behind every section ask the same capability.

| Role | The rail |
| --- | --- |
| `admin` | all of it |
| `provider` | Notifications |
| `editor` | Content, Marketing, the media library, the words, Notifications |
| `support` | Support, Notifications |
| `analyst` | the Dashboard, and the analytics pages inside Marketing, Forms and Sales |

## What to call the person who delivers what the site sells

The kit calls the role **`provider`**, and nobody ever sees that word. It is an identifier — a role, a column, a policy — and it is deliberately not a job: the person delivering what a site sells may be a coach, a healer, a therapist, a consultant or a tutor, and the kit has no way of knowing which.

What somebody sees is decided in two places, and the second beats the first.

**The site's word** is one record, `## role / ### provider` in the `people` scope:

```markdown
## role

### provider

name: Coach
plural: Coaches
a: a coach
your: your coach
work: Coaching
session: session
```

The theme's strings contain no English word for the role at all — they say `{provider}`, `{providers}`, `{a-provider}`, `{your-provider}`, `{work}` and `{session}` — and the strings merge fills them in from that record before anything reads them. So a practice that calls them Therapists edits one record and every sentence in the app follows, including ones nobody thought about.

It is done in the merge rather than in the components on purpose: the alternative is every surface remembering to call a helper, one of them forgetting, and somebody being shown the word `{a-provider}`.

**A person's own title** is `profiles.title`, up to forty characters, and it wins wherever a surface names *them* rather than the class. A practice of five can then have four Therapists and one Supervisor without the site changing its word. A component asks `titleOf(person)` from `lib/provider.js`, which falls back to the site's word for anybody who has not set one.

So: the class belongs to the site, the title belongs to the person, and the identifier belongs to the kit.

<Callout>
`coach` was what `provider` used to be called. A profile written before the rename may still hold it, so the capability reads accept either and `data.sql` carries people across; nothing new is ever written with the old word. It is dropped by a change of its own once the backfill has run everywhere.
</Callout>

## When somebody arrives, and when they leave

Signing out reloads the page. That is deliberate: it throws the local document away, so nothing of the person who was here survives in memory, and it is the last word on the subject.

Signing **in** does not reload, so every part of the app that holds something belonging to a person has to be told. It is told once, by one broadcast:

```js
import { onIdentity } from '@platform-kit/kit/lib/auth.js'

const off = onIdentity((id) => {
  discardWhateverTheLastPersonHad()
  if (id) loadWhatThisPersonHas()
})
```

`id` is the signed-in reader, or `null` for a guest. Three rules decide when it fires, and they are pinned by `build/identity.test.mjs`:

- **A change of person is a change of id, and nothing else.** A refreshed token, a revisited tab and a re-read of entitlements all arrive with the same id and tell nobody. Guest is an id too, so guest to person and person to guest are both changes.
- **The reads come first.** It fires once the role and the entitlements have answered, so a module asking what this person may see asks it of a role already in hand. This is why it exists at all rather than a watcher on whether somebody is signed in — that is true the instant the session object exists, which is too early to ask anything about them.
- **A late answer for somebody who has gone is dropped.** Signing in twice quickly leaves an in-flight read that must not announce a person who has already left.

Each registered function is called detached and its failure swallowed, so one module's trouble never stops the next being told and none of them can fail a sign-in. The returned function unregisters, which a component should call when it unmounts.

There is a second list, `beforeSignOut`, and it is for one thing: work that must **drain** before the session ends, such as pushing an outbox. It is not for clearing what is on screen.

### Two halves, and both of them register

A surface is made of a **module** — the spaces, the chats, the support widget, the desk, the records — and the **page** that shows it. Each holds its own half of what a person may see, and each registers for itself:

| the module registers | the page registers |
| --- | --- |
| `spaces/api.js`, `chat/api.js`, `support/api.js`, `desk/index.js`: throw away what belonged to whoever was here, then load what belongs to whoever is here now | `SpacesPage`'s `hydrate()`: the reads that are the page's own — the members, what is being kept, the queues, the DMs, what is scheduled |
| the two `audio.js` caches: a recording somebody was allowed to hear is not a recording the next person is | `ContentHub`: the view a guest was given is not the view a member wants |
| `records.js`: the answers in the account's rows, which are not the blank session this browser had | |
| `support/prompts.js`: which desk prompt holds is an audience question, and an audience is about a person | |

Both halves matter and neither is redundant: with one of them deafened the page still comes right, and that is exactly how a fault here hides for months. What settles it is the probe — see [Testing](/content/docs/building-a-site/testing#who-is-here-told-once), which asks whether signing in on a page gives you the page reloading it gives, and was itself checked by deafening both halves of the spaces surface and watching it fail.

## Start over

At the foot of the Diagnostics page (a site with an instrument) **Start over** removes every answer and reading, locally and from the account. Books, highlights and trophies are not answers and stay.

## The test accounts

A development copy's database is seeded so every surface can be tried without making anything by hand. All at `example.com`, all with the password `password123` — and each with the **same id on every reset**, derived from its address, so a reset does not sign every open tab out from under whoever was working in it:

| Account | Who |
| --- | --- |
| `admin@` | an administrator, with two afternoons of hours |
| `coach@` | a coach and nothing else, with hours set (weekday mornings in Amsterdam, a day's notice) — the host of the demo's booking types |
| `support@` | a support agent |
| `editor@` | an editor: writes the content, sells nothing, sees no figures |
| `analyst@` | an analyst: reads the dashboards and writes nothing |
| `writer@` | `provider` and `editor` at once, so that neither can be seen leaking into the other |
| `member@`, `member2@` | members on two tiers, live |
| `buyer@` | a customer with a shipped paperback |
| `free@` | somebody with nothing |

A person may write **one line about themselves** (`profiles.about`, at most 280 characters, kept by a check constraint rather than by the browser). They write it on their own card in a space and nowhere else; it is shown to anybody in a space with them, through that space's own reads, and is never disclosed by selecting `profiles`, which is self-select and stays that way.

A role at the **site's** level (above) says what somebody may run. A role in a **space** is a different thing entirely: a record the space owns, with its own name and colour, invented by the site rather than named by the kit — and somebody holds several of them at once. What a space role lets somebody do is a grant, never the role itself. The two never meet: nothing in a space reads `profiles.roles` except the rule that fills a space by one (`fill: role: [coach, admin]`).

Plus a coaching thread each way, a line awaiting the admin, a group call next week, a session the site itself scheduled a week after, and a one-on-one two weeks ago with its recording, a book unlocked online, three support threads (a guest's, a person's, a resolved one), and a morning in the staff space — a conversation with a thread, two mentions (one of them unanswered, so the staff's desk lists a channel beside the support threads and the coaching one), a reaction, and one line the shop wrote itself. The **rooms** are not in the seed: a space and its channels are part of what the site is, so they are files under `content/spaces` and the reset projects them before asking for the conversation. Nothing is replayed through an event hook: a site's past sales are history. Resetting the database (`npm run db:reset`) puts all of it back and wipes anything made since, including any account you signed up locally. Never put a real address in the seed or the repository.

## Lockdown

`LOCKDOWN_MODE` is a developer's switch for a site that is not yet open: it closes the app to everyone but the staff — a signed-in person is signed out the moment their role is known and told why, the sign-in modal refuses to let one in or make an account — and the support chat refuses or undoes a sign-in at once (a guest stays a guest, and the desk still sees them). The staff are untouched, so the site can be worked on while it is closed.

## What a profile holds

Besides the address and the roles: a **username** (their own page at `/p/<username>`, lower case and unique, and only where they took one), a **display name** (what everybody sees; absent, the part of their address before the @), a **first and last name** (for a letter, an invoice, or a list that shows a first name and a last initial), their own **picture**, the **style** and **seed** a drawn face comes from where they picked one (absent, a pattern — never a face, and never an initial), a short **about**, a **public profile** switch that is off until they turn it on, and **notification preferences** as a set of switches rather than one word.

A profile is private by default: a directory of everybody who ever signed up, indexed, is not a thing to publish on somebody's behalf.

All of it is theirs to edit, at `/p` — see [A person's own page](/content/docs/running-a-site/community/people-and-profiles), which also says why the default face is a pattern.

## What may be done, in one place

Four vocabularies used to answer "may this person do this": the class ladder (`guest < authenticated < paid < subscribed`), the role booleans, the ranked membership tiers, and a space's capabilities. They are one ability now, built with [CASL](https://casl.js.org) in `supabase/functions/_shared/permissions.js` — plain JavaScript over `@casl/ability` and the ladder, so the same rules answer in the browser, in a build script and in an Edge Function.

The direction is one way and stays that way: the database says what is true, `lib/auth.js` settles it into an **identity** (signed in, confirmed, the rung, the roles, the tiers, the products), the identity builds the **ability**, and everything else asks the ability — `can('read', entrySubject(entry))`, `can('book', session)`, `can('answer', 'SupportConversation')`. No ref is computed back out of it.

**A site overrules it by registration**, as it registers its instrument or its sections: `permissions` in `platformkit.config.js` names a module exporting `rules(identity, { can, cannot })`, run after the kit's own. `cannot` is the common case — everything the kit allows, except this — and a rule may be narrowed by a condition rather than revoked whole. A site that registers none gets the kit's rules, which is every site today.

**A rule that already exists is asked, never rewritten.** Two of the four had an authority already: a space's capabilities are `space_may()`'s answer in the database, and who a booking type is for is `admits()` in `_shared/sessions/admits.js` — the one rule the app's picker and the functions' judge both ask. The ability matches their verdicts rather than restating them, because a gate whose two sides disagree is not a gate. The first draft of the rules did restate the booking one and got three of its cases wrong (`guest` means no membership, `authenticated` means signed in *and* no membership, and a list of tiers means exactly those with no ladder implied); `permissions.test.mjs` now checks all seven `requires` shapes against every identity.

**The two are compared, because two places that must agree and are never compared will drift.** `permissions-db.test.mjs` asks both the same question for every account the seed has: what the ability answers, and what the database actually admits when that person selects from the table. A difference either way is a fault — the ability saying yes where the database refuses is a door that does not open; the ability saying no where the database admits is worse, because then the interface is the only thing standing between somebody and the data, which is what a policy exists not to be. A difference may be *declared*, with its reason, and a declared one prints on every run so it cannot become furniture; one that has been fixed and left on the list fails too.

**It found a privilege leak on its first run, and the leak is closed.** `is_staff()` was `cardinality(roles) > 0` — anybody holding any granular role at all — and the support desk's policies were written against it, so an **analyst**, granted nothing but the figures, and a **provider**, an outside seller with a storefront here, could each read every support conversation, every contact and every ticket. Nobody had granted that; it is what "staff" widened to as roles were added one at a time.

The desk asks `is_support()` now — `roles && ARRAY['admin', 'support']`, the two roles who answer people — and the 35 policies and helpers of `70-support.sql` and `72-tickets.sql` ask it in place of `is_staff()`. `is_staff()` keeps its old meaning and its old callers: the staff room, moderation, the bots, the events and spaces, where "anybody on the team" is the right reading. Nothing else changed, and the check that found it now agrees with the database for every account the seed has, with nothing declared.

**It is not enforcement, and must not be read as any.** The database enforces access with its own policies and security-definer functions and goes on doing so; an ability built in a browser is a convenience for the browser and nothing a policy may trust. What this moved is where a rule is *written*. `permissions.test.mjs` pins the part that matters most: for every shape of account, the ability answers exactly what the ladder answered before it — a parity check taken before anything was rewired, so a difference is a bug and not a decision.
