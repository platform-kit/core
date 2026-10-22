---
title: The admin, in one tour
description: Where everything is edited, how a change becomes live, and what the rail's groups hold.
order: 10
sources:
  [
    packages/kit/theme/src/pages/AdminPage.vue,
    packages/kit/theme/src/components/admin/PaymentsAdmin.vue,
    packages/kit/theme/src/components/admin/PeopleAdmin.vue,
    packages/kit/build/admin-server.mjs,
    packages/kit/theme/src/components/Orders.vue,
    packages/kit/theme/src/components/Bookings.vue,
  ]
reviewed: 2026-10-14
---

## Two admins, one address

The platform has two things at `/admin`, and which one you get depends on where the site is running.

**The editing admin (the CMS)** runs on a _development copy_ of the site — the one a developer starts with `npm run dev` on their machine or in the project's devcontainer. It is the full editor: every collection, the page builder, the strings, the email designer, the print editions. It writes to the site's `content/` folder as files. Nothing you do there touches the live site until those files are committed and deployed.

**The production desk** is the same shell on the live site — the rail and the page beside it — holding only what reads live data: Dashboard (Analytics, Content analytics), Settings (Notifications, API, Payments), Community (Support), Social (for administrators and accepted Social publishers), Marketing and Forms (their analytics), Sales (orders, print orders, bookings) and People; no content, since there is no content pipe in a production build (cloud mode has the whole CMS). A support agent sees Notifications and Support and nothing else, wherever they open it; an invited Social publisher sees Social only, and only after acceptance; somebody else who is not on the staff finds an empty rail and a note that the desk is the team's.

So the day-to-day division is: _answering, watching and being told_ happen on the live site; _writing, arranging and pricing_ happen on the development copy and go live with a deploy. If you are an editor without a development setup, ask a developer for one — the devcontainer makes it a one-step affair — or send them the change.

> **Sales** holds what is sold and what was sold. **Price lists** and **Promotions** sit
> between the products and the printed editions: a price list says what a thing costs for
> some people, a promotion says what comes off. They are separate screens because they are
> separate questions — see [Commerce internals](/content/docs/building-a-site/commerce-internals).

## Signing in

Both admins use the site's ordinary sign-in. What you can see depends on the **roles** your account holds — a person holds a set of them, and the rail is the sections whose capability they meet:

- **admin** — everything.
- **editor** — Content (the pages among it), the ads and experiments, the media library, the words, and publishing.
- **coach** — Pages, and in it exactly one page: their own, at `/p/<their username>`. Not an editor, and the server refuses every other record rather than hiding it (see [A person's own page](/content/docs/running-a-site/community/people-and-profiles)).
- **analyst** — the Dashboard, and the analytics page inside Marketing, Forms and Sales. Nothing that names a buyer, and no writing anywhere.
- **support** — the Support inbox, and the support topics of Notifications.
- **coach** — Notifications. Their work is the coaching chat and their hours, which are in the app and not in the admin.
- everyone else is refused.

A Social publisher is not a profile role: accepting an invitation allows entry to Social, but grants no publishing actions. An administrator assigns create, edit, schedule, approve, publish-now and results access separately for each connected account; account management is a separate site-wide grant. Somebody may hold several: a person who coaches and also writes the articles holds `coach` and `editor`, which does not make them an administrator. The admin opens where they work — the figures for anybody who may see them, the desk for an agent, the first kind of content for somebody who writes.

Roles are given on **People → People**, from the person's own page — and the last administrator cannot have it taken away. That page is also every account the site has, with what it already knows about each (see [accounts and roles](/content/docs/running-a-site/settings/accounts-and-roles)). The rail is a convenience and never the fence — an address typed by hand answers nothing either, because the reads behind each section ask the same capability.

## The rail

The editing admin is a rail of groups down the left, folding to icons if you like, and the selected view on the right. The groups:

| Group          | Views                                                                                                                     | What they are                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**  | Analytics · Content analytics                                                                                             | The whole site's numbers; what gets read, for how long and how far, by piece, kind, topic and tag — and under it the finder and the support prompts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Content**    | Models · Media · Publishing (cloud mode) · Articles · Books (with Companions) · Wiki · Docs · Pages, then a row per model | The content models' builder first (see below), then the file library ([Media](/content/docs/running-a-site/content/media)), then — in [cloud mode](/content/docs/running-a-site/settings/cloud-mode) alone, where a save is a draft — Publishing, the drafts and where a publish goes (a git-mode admin has no such row), then the reading library and the landing pages; the builder lists the kit's and the site's own models as _core_, their fields read-only, and each published model's entries as a grid and a drawer of its own (the models module; see [Content models](/content/docs/running-a-site/content/content-models))                                                                                                                                                                                                                           |
| **Store**      | Storefront · Products · Collections · Prices · Promotions · Print editions · Booking types                                | What is for sale: the store's front, the offers and their shapes, the price lists, the discounts, the printed editions and the ways to book                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Sales**      | Orders · Print orders · Bookings · Payouts                                                                                | And what was sold. **Orders**: every purchase that is not a printed copy (unlocks, downloads, goods, memberships, paid sessions), live, with the buyer, the product and variant, the amount, the status and a link when it also made a print order; **Print orders**: the copies at the printer; **Bookings**: every session cal.com mirrored, upcoming then past, with the attendee, the coach, the status (and a refusal's reason), the join link while upcoming, and after the call its recording — ours, in the site's own storage — to watch, download or read as a transcript, or _Pending_ / _Failed_ with **Fetch again** while it is on its way. The three read under RLS as an administrator and follow the rows as they land; **Payouts**: what the business owes the people it pays (see [Providers and payouts](/content/docs/reference/suppliers)) |
| **Marketing**  | Emails (with Blasts) · Funnels (with Performance) · Ads · Experiments                                                     | Reaching people: the email designs and the one-off sends beside them as a tab; the drip campaigns and their audiences, with what they and the blasts did as the tab beside them; calls to action; A/B tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Forms**      | Forms · Responses · Form analytics                                                                                        | The forms and their builder; every response as it came in; per form, who started, finished, dropped off where, and what they answered (the forms module)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Community**  | Support · Comments (with Policy) · Community (with Spaces) · Network                                                      | People reaching the desk, or each other: the support inbox; the comment queue with the rules it is judged by as a tab; the community and the rooms in it; and the social network's reports and suspensions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **People**     | People · Teams · Providers                                                                                                | Everyone with an account — narrowed by what the site knows about them, and one person's whole picture: their roles as switches (the one thing the page changes, the last administrator refused), what they hold, what they bought, what they pay, what they booked — the teams they are in, and whoever sells through the site                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Social**     | Calendar · Drafts · Posts · Comments · Analytics · Inbox · Explore · Accounts · Settings                                  | Its connected-channels icon marks the publishing workspace; account-specific grants govern post actions and results, while provider settings and publisher invitations are administrator-only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Settings**   | Site settings · UI strings · Notifications · API · Payments                                                               | The site's public identity and interface copy; this browser's push and the account's other browsers; the API keys and content webhooks; and, for administrators, the selected payment provider, its declared profile capabilities and the relevant provider dashboard or control-center link. Secret credentials remain server-side.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Developers** | Supabase Studio · API reference                                                                                           | What is under the site rather than in it. The Studio is the local stack's own interface and appears on a developer's machine alone; the API reference is the site's own page and is there in development and in production both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

The Social group sits directly after People and before Settings. Its connected-channels mark distinguishes the publishing workspace; its Conversations queue in Spaces is separate and appears only on a site that registers that optional source.

**What is grouped with what.** People are not a setting, so they have a group; what is for sale
(Store) is not what was sold (Sales), which was one heading of thirteen rows; a landing page is
content, not marketing; and "Engagement" meant two different things — reaching people, which is
Marketing, and people reaching each other or the desk, which is Community.

**A page with parts has tabs.** Where one subject was kept on two screens it is one page now:
Comments carries the queue and the policy, Community the place and its rooms, Emails the designs
and the blasts, Funnels the campaigns and how they performed, Books the books and their companions. The tabs sit under the page's title, which
names the subject whichever tab is open.

**Every page is drawn the same way**, and it is the same three things in the same order:

1. **the head** — the page's name and one line saying what it is for, and nothing else;
2. **the bar** — the tabs, where the page has any, and everything the page can be _done to_: its
   filters, its date ranges, its New button;
3. **the page**.

That one line is a word like any other: it comes from the admin's own strings, under the page's
key (`leads` in the `admin` scope), so a site can reword any page in its own
`content/app/ui/admin.md` without touching a component. A section a site registers itself works
the same way — the registration says where the page sits, which module it belongs to and what
draws it, and never what it is called. The line used to be the file count and the content path —
"10 files in `content/store/products`" — which told an editor where the developer keeps things
and nothing about the page; a model the strings do not name now falls back to a plain count.

It is worth saying because it was not always so. The same heading used to sit anywhere between 26
and 152 pixels down the page, in seven sizes, three weights and two typefaces, depending on which
screen you were on; and the controls lived in the head on some pages and under it on others, so
the top of every page was arranged differently from the one before it — and on a tabbed page the
head rearranged itself as you moved between tabs. One component draws all of it now
(`AdminHead`), which is why a page cannot drift again without somebody deciding to.

A site with its own extras (a Quizzes or Recommendations view under an App group of its own, say) adds them to the rail; a module switched off — a feature, or one of the four kinds of content — takes its views away. Most of those extras look and behave exactly like the rows above them — the demo's Stockists is a grid of shops with a drawer of fields, New and Delete, and nothing about it says it was added by the site rather than shipped with the platform. A few are screens of their own, because a form would not do: Quizzes is one.

## How a record is edited

Most collections open as a **grid** — a sortable, filterable table of every record, published or not — and a record opens in a **drawer** on the right: a form of its fields above the body. The body is a markdown editor (a rich-text editor for prose; it writes markdown behind the scenes, and you never see the markdown unless you want to). Books open by chapter instead — see [Books](/content/docs/running-a-site/content/books).

Three things every form has:

- **Published.** The switch at the top. Off, the record stays here but leaves the site entirely: no page, no search result, no share image, no place in any list. New records start published unless you say otherwise.
- **Save.** The sticky bar at the foot shows when the form is dirty. Saving writes the file; the development site reloads within a moment.
- **Live preview.** Where a record has a page, the editor shows it beside the form as you type, in the site's own layout, and — when the site has more than one look — a switch to see it in each without saving.

Fields that are structured (a span of days, a rule, a list of choices, a trigger) are always edited as _controls_ — a number and a unit, a row per item, a select — never as text you have to get the format of right. If you ever find yourself typing a syntax into a box, something is wrong; tell a developer.

## Uploads and pictures

A picture for a book, an article, an ad, a landing section, a model's entry or a prompt is either a web address, a file uploaded through the field's own button (it goes into the library under the collection's folder — `content/uploads/books/`, say — and the field takes its address), or one chosen from the library with **Choose from the library**, the field taking its address the same way. **Content → Media** is the library itself — every picture and file the site uses, to browse, upload, arrange and address; see [Media](/content/docs/running-a-site/content/media). No file sits beside a record's own file. Every page's _share image_ — what a link shows on social — is drawn by the build from the page itself unless you set one; see [Publishing basics](/content/docs/running-a-site/publishing-basics).

## Going live

Content is files. A change made in the admin is a change to a file in the project; going live is committing those files and deploying (a developer's action, or an automatic one on push). The deploy builds every page, draws the share images, compiles the emails and funnels, sets any new print editions, and publishes. Nothing about a deploy needs you to redo what you did in the admin.
