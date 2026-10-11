---
title: Site settings and UI strings
description: The site's name and look, and every word of the interface, editable in one place.
order: 40
sources: [packages/kit/build/strings-io.mjs, packages/movable-types/src/components/admin/NavField.vue, packages/movable-types/src/lib/theme-nav.js, packages/kit/src/lib/nav.js, packages/movable-types/src/content/ui, packages/movable-types/src/components/admin/StringsEditor.vue, packages/kit/src/lib/look.js]
reviewed: 2026-10-09
---

## Site settings

Settings → **Site settings** is one record, `content/site.md`: the site's **name**, **tagline**, default **description** and **share image**, its **public address** (the sitemap and absolute links need it), a social **handle**, and the **look** it wears.

The **look** is a palette — one set of colours the whole design wears, with a night version. A site names its looks in its config; this page picks one. Any page may be viewed in another look for one visit by adding `?look=<name>` to its address, and the admin's live preview offers the same switch without saving.

## The header

The links across the top are the **Header** panel of Site settings — a row per link, dragged by its grip into the order they appear in. Each row asks four things, and asks every one of them as a choice rather than as something to type:

| | |
| --- | --- |
| **What it says** | the word on the link. Left blank, an inherited item keeps the theme's own word, which is translatable |
| **Where it goes** | a list of the places this site actually has — Home, the library and its kinds, the store, the community, the app, and your own pages by name. A module that is off is not in the list, so a link cannot point at a route that would 404. *A path of my own* is last, for somewhere the kit cannot know about |
| **Icon** | the same glyph palette the landing sections use, so one vocabulary serves the whole site |
| **Who sees it** | a rung of the class ladder, and this site's own membership tiers **by their real names** — "Group Coaching and above" rather than `tier:tier-2` |

**Button** marks the one item drawn as the header's button; turning it on for another turns it off for the first, because only one may be.

Underneath, it is still a `nav` list in `content/site.md` — a **label**, an **href**, an optional **icon**, `prefix` (highlights for every path beneath it), `see` and `cta` — so a site may write it by hand, and in cloud mode it saves through the pipe like any other record.

`see` is a rung on the class ladder rather than a rule anybody types: signed out only (`guest`, which is what a "Sign in" item wants), `authenticated`, `paid`, `subscribed`, `tier:<slug>`, or `staff`. A rung is a **minimum**, so an item for `paid` is also shown to a subscriber. An item naming none is shown to everyone, and an item pointing at a route a switched-off module owns is never drawn.

A site that writes none inherits what is below it: a `nav` in `platformkit.config.js`, and below that the theme's own — the library, pricing where a page claims that route, the store while it is on. The most specific that exists is the whole list; they are never merged.

**The panel shows you what you are inheriting** rather than an empty list, which would read as "this site has no header" and be false: the items you would get are drawn greyed, with one button that copies them in to start from. They are the same list the header itself falls back to — the theme's own lives in `lib/theme-nav.js` and is read by the header and the panel alike, so the panel's promise and the page can never disagree.

## The typefaces

**Typefaces** on the same page sets the three faces the whole site is written in: a **heading**
face, a **body** face and a **monospace** face. Each family is drawn in its own letterforms,
because a list of font names set in the admin's own face tells you nothing about any of them — and
above the three, a **specimen** shows the heading, the body and the mono set together at the sizes
they are actually used at. Three names in three lists do not tell you whether they look right
beside one another, which is the only question worth asking.

Two dozen faces are recommended, each with a note. They are not a limit: the search box reaches
every family Google serves, and each result is drawn in itself as you type.

You are never asked for a font stack, a list of weights or a stylesheet address. Those are made by
the build from the one thing you chose. A face left as **Follow the theme** keeps following it, so
it changes if the theme's does — which is different from picking that same family on purpose, and
the list says which is which.

Saving writes the family names into `content/site.md` and the next build writes the stylesheet
link and the three variables into every page's head. Nothing else has to be edited, and the site's
share images are set in the same faces as its pages.

## UI strings: the voice of the product

Every word somebody sees that is not a piece of content — a heading, a button, a tab name, a placeholder, an empty state, a modal's title, a screen reader's label — lives in a markdown file under `content/app/ui/`, one file per **scope**, and is edited under Settings → **UI strings**. The theme ships a default for every scope; a site's file holds only the words it changes, and anything left out shows the default, never a blank.

The scopes:

| Scope | What it words |
| --- | --- |
| `library` | The hub, the shelf, the person (the player, the generate button, the cover page), the article page, the print words, coaching's booker and the booking page (`coaching.book-page`) |
| `pages` | Index pages and their SEO titles |
| `site-directory` | The workspace development-only site directory heading, supporting line, preview description and open-site link |
| `store` | The storefront, the product page and its gallery preview labels, the bag, checkout's return, the handoff page a Store API cart lands on (`cart.handoff`) |
| `network` | The social network: `## nav` (the header's Home button), `## access` (the join card where the site sells its network: what it says, the price by period, the button, the line for somebody who may read but not post, and an optional link to other plans), `## shell` (the network's own navigation and Post button, Explore and its search, Who to follow, the reader's spaces, the post window, Copy link, and the social layout's places: Messages, Events, Work, More and Chat), `## timeline` (the timeline, its Following and Discover tabs, the empty states — Following's with its way to Explore, `empty-find`, and Discover's own — the signed-out state, the spaces one may pin, and `pin-home` / `unpin-home` on a space's own header), `## composer` and `## audience` (writing a post — `write`, the one line it folds to, `media` and why a file is refused, `media-many`, `media-kind`, `media-big`, `media-long` — and who can see it — Everyone, People here, a space's members — the chip's menu with the line under each choice, and why an answer's choice is narrower), `## post` (a post's actions, its menu, a removed or missing post), `## media` (a carousel's counter and arrows, a video's sound button), `## foryou` (the For You grid: its empty and failed states, opening a tile, stepping between tiles, the way to the conversation), `## person` (following somebody, the counts, messaging them or saying they are not taking messages, muting, blocking and reporting them), `## report`, `## notes` (each kind of notification — the network's, folded when several people did the same, and with the spaces on a mention, a thread reply and an event coming up — the filter tabs, what each empty filter will hold, and the line when the list will not load), `## thread`, `## admin` (Community → Network: reports and suspensions) `## apps` (the account page's Other apps card: the server's address, the handle, app passwords) and `## join` (joining and leaving the wider network, on a site that federates) |
| `social` | Social publishing: the calendar, post editor, connected accounts, provider setup and publisher access |
| `auth` | The sign-in modal, the forgot-password flow, the intents (quiz, buy, support, book) |
| `gate` | The gates: results, chat, an article's access |
| `awards` | An achievement's own page and the gallery on a profile (see [Achievements and traits](/content/docs/running-a-site/community/achievements-and-traits)) |
| `account` | A person's own settings at `/p` — the face picker, what they are called, the address their page has — and somebody else's page (see [A person's own page](/content/docs/running-a-site/community/people-and-profiles)) |
| `chat` | The coaching chat, the follow-up lines, the refusals, the inbox |
| `support` | The support widget, the panel, the inbox, the canned replies |
| `comments` | The one page responsible for every comment on the site — the narrowings, and what a moderator may do to a held one (the person's own thread is `library` `## comments`) |
| `spaces` | The spaces surface, worded the way people know from other community products (Events, Past, RSVP, Members, Request to join, Delete — a site that wants another voice overrides by key): the one nav (the person’s own places, every space by name, and the way to find one), a channel and its messages, the composer and its mention picker, a thread, search and the notification settings — and `## events`, what the platform’s own lines in an operations channel say, one record per event, and `## call`, a huddle — its tiles, its two controls, and what it says when a call cannot be made, `## chrome` (the switcher, the sections, the search bar) and `## bar` (the composer’s own row of actions, including what it says when a file cannot be sent), `## calendar` (what is on: today and tomorrow, how long until something starts, going and maybe, what can be booked) and `## tickets` (the work: its states in the desk’s words and again in the customer’s, the priorities, what happened to one, and raising one), `## rail` (the person's own places, including `feed` and `feed-notes` where the network is one place with the spaces, `my-tickets` for a customer's own tickets and `browse-spaces` at the foot of the social layout's spaces), `## channel` (a room's own words, including a feed channel's — `feed-older`, `feed-empty-title`, `feed-empty-line`, the box at the top `feed-write`, and the bar under a post `feed-like`, `feed-comment`, `feed-share`, `feed-copied`, `feed-write-comment`), and `## feed` (Threads, Mentions and Saved — and the two titles that become Notifications' tabs where the site has no network) and `## dms` (every direct message in one list, whichever space it is in, and `pinned` under a member's coaching place at its top, `pinned-sessions` where it holds their sessions alone), `## coaching` (the coaching place's two tabs, `chat` and `sessions`), and `## desk` — the staff's one list, including registered provider sources such as Social: what each source is called, what kind of person is waiting, the one set of words for what is owed, and finishing with one — and the community's own four — `## index` (the community's front page: the greeting by the hour, what is waiting, the filters, the cards, and for a guest `guest-title`, `guest-line` and `guest-signin`), `## directory` (who else is here, and the invitation link somebody may make), `## discover` (the spaces somebody could be in and what each would take) and `## moderation` (the queue, the four acts, the reasons a report may give, and the line saying no machine decides any of it) — and `## admin`, Community → Community: the declaration (a space and its rooms, its roles and what each may do, and what a room hears) and the acts beside it (the people, what was said, a capability given to one person), the grants said back in words, and the three words somebody says about themselves (a space role's name is not here: it is the space's own file) |
| `teams` | Teams: `## members`, the panel in a team’s drawer that says who is actually in it — how each person came to be there, removing one, and the search that adds another — and `## mine`, what somebody sees of their own teams on their account |
| `emails` | The email subjects, the push notifications' words, the system lines the functions send — and `## push`, a record per notification topic, `space-mention` among them |
| `analytics` | The dashboard's words |
| `orders` | Orders, Print orders and Bookings in the admin, and what Print editions says about a listing's pictures |
| `admin` | The admin's own chrome: `## rail` — the name of every group in the rail and of every page in it — and `## chrome`, the tag beside the mark, the collapse's title and the heading over the local stack's link. A page whose own scope already names it (People, Payouts, Media, Publishing) keeps that name and is not repeated here |
| `people` | People → People: the page, and what each role reaches, said in one line per role |
| `payouts` | Sales → Payouts: who is owed something, what stands in the way of paying them, and the rules that decide what anybody earns |
| `push` | The Notifications page |
| `copilot` | Speaking to an assistant: the four states it shows, and what it says when it cannot listen or cannot be reached |
| `api` | The API page: its head naming the APIs, the keys (content, forms, scheduling, storefront, support), the webhooks list (`### webhooks`: the heading, the empty state, the columns); the reference page at `/api` (`## reference`) |
| `media` | Content → Media and the picker every file field opens: the page's head, the picker's buttons, the fields' Upload · Replace · Choose from the library · Remove (see [Media](/content/docs/running-a-site/content/media)) |
| `publishing` | Content → Publishing, in cloud mode alone: the drafts, the repository the publishes go to — shown rather than asked for where the repository declares it — and the pushes (see [Cloud mode](/content/docs/running-a-site/settings/cloud-mode)) |
| `cta` | The ad card |
| `forms` | The forms: a form's buttons and messages, the end slide's default words, the builder's labels (the Forms API's webhooks, Typeform's embed snippet among them), the Responses view |
| `sections` | The landing sections' own few words: Next and Previous, Close, Show and Hide, Play, a compare cell's Included / Not included, the email field's states (placeholder, button, sending, done, invalid, error), *Step {n}*, *Read* |
| `models` | The content models: the builder's labels, the kinds' and rules' names and messages, the drawer's words, the pages' *Nothing here yet.* / *All {name}* / *Back to {name}*, the Entries section's layouts |
| `quiz`, `sheet` | The runner and the results sheet (a site with an instrument) |

A site with an instrument adds scopes of its own — `glossary` (the levels, the areas, the channels, the types), `topics`, `concepts`, `patterns` — with no default.

### The shape of a strings file

Each file is groups, keys and fields:

```
## group
### key
field: value
another-field: value
```

The editor shows this as sections and forms — you never type the shape. Two things the shape needs, which the editor keeps for you: each value is one line, and every name is unique within its group (a repeated name silently overwrites the earlier one).

### Words that are worded once

On a site with levels, they are named in exactly one place — `glossary` → `## levels` — one record per level with a field for every way it is ever said: the short label, the long form, the "working at" line, the noun phrase, the location ("in …"), the chip, the recommendation slot, the stage name. Every table, chart, sentence and admin grid reads that record. Never write one of those words anywhere else. The stage names (Autopilot, Rising Agency, Self-Mastery, Conscious Co-Creation) are canonical and user-facing; a level is never called a tier. Landing pages are the exception and keep their own language.

## Long-form site copy

The header's link labels, the call-to-action button, the footer, the landing's fine print — the words that are neither content nor a component's chrome — are the language catalog under `content/strings/<lang>/`, edited as a file (the `nav` block: the link keys the config names; `cta` and `cta-in`).
