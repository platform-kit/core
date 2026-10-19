---
title: Modules
description: The fifteen switches, what each turns on, and what the deploy asks for when it is on.
order: 43
sources:
  [
    packages/kit/build/site-module.test.mjs,
    packages/kit/vite/index.mjs,
    packages/kit/src/lib/modules.js,
    packages/kit/src/lib/router.js,
    packages/kit/build/site.mjs,
    packages/kit/build/site-node.mjs,
    packages/kit/vite/index.mjs,
    packages/kit/build/modules/kit.mjs,
    packages/kit/build/modules/manifest.mjs,
    packages/kit/build/cron.mjs,
    packages/kit/build/modules/kit.mjs,
    packages/kit/build/steps.mjs,
    packages/kit/build/modules-off.test.mjs,
    packages/kit/build/modes.mjs,
    packages/kit/src/lib/router.js,
    packages/kit/build/deploy-checks.mjs,
    packages/kit/build/test.mjs,
    packages/kit/build/source-cli.test.mjs,
    packages/kit/build/runtime-paths.test.mjs,
    packages/movable-types/src/pages/AdminPage.vue,
  ]
reviewed: 2026-10-19
---

## Module switches

Modules are enabled by default. Set a module to `false` in `platformkit.config.js` to disable it; its routes, navigation, admin sections, and build steps are excluded, and the deploy skips that module's environment requirements. Settings required independently of a module, such as the SMTP relay used for authentication email, still apply. A backend site with registered admin models must use row-backed content in production; the build rejects a file-backed bundle for that configuration.

`build/modules-off.test.mjs` disables each module in turn and checks that its steps and required secrets are removed without affecting other modules. It also checks that build steps name a declared module. The instrument depends on the `forms` module's runner, so a site enabling `instrument` must also enable `forms`.

## Content kinds

The four kinds of content are modules too:

| Module     | On, it gives                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `articles` | `/content/articles`, the magazine's lane on the hub, Articles in the admin                         |
| `books`    | `/content/books`, the shelf and the person, the books' lanes, Books (with Companions) in the admin |
| `wiki`     | `/content/wiki`, its lane, Wiki in the admin                                                       |
| `docs`     | `/content/docs`, its lane, Docs in the admin                                                       |

A disabled kind has no route, hub lane, admin view, prerendered page, or sitemap entry.

With only `docs` enabled and no account-dependent modules, the theme serves documentation at `/docs`, or at `/` if no landing page owns the root. It uses a documentation layout with a collapsible sidebar and an on-page contents list; account controls and the content hub are omitted. `/content/docs/...` remains an alias. `sites/docs` uses this configuration.

## The features

Booking authentication has two checks: `coaching.requireAuthToBook` defaults to `true`; when set to `false`, the session's `requires` rule still controls whether a guest may book. A paid guest booking carries the selected time through the configured payment provider's checkout and is fulfilled using the email from its verified checkout result.

| Module              | On, it gives                                                                                                                                                                                                                                                                                                                                                                      | The deploy then needs                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `store`             | `/store`, the bag and its drawer, product pages, checkout, the Storefront · Products · Collections admin views, the store's share of the sitemap                                                                                                                                                                                                                                  | The selected payment provider's credentials and webhook setup, when something is for sale; Stripe is the default. See [Payment providers](/content/docs/building-a-site/payment-providers)             |
| `print`             | Books in print: editions generated during deploy only with `PRINT_BUILD=1`, the printed book on the store, Print Products · Print Orders                                                                                                                                                                                                                                          | A printer with keys for every printed format a book sells (the one its block names; at least one for _auto_; Bookvault for premium); `LULU_SANDBOX=1` allowed                                          |
| `memberships`       | Tiers, the store's membership band, the pricing page's buying rows, the billing portal and membership renewals                                                                                                                                                                                                                                                                    | The selected payment provider; see above                                                                                                                                                               |
| `sessions`          | Session records, the Coaching tab's booker, the cal.com functions, Booking types and Bookings in the admin                                                                                                                                                                                                                                                                        | cal.com's webhook secret and API key, when a session is published                                                                                                                                      |
| `coaching`          | The members' chat with the coaches: the Chat tab, the header's chat button, the coach's inbox                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                      |
| `support`           | The support widget on every public page, the staff's inbox, the escalation digest, the chat prompts                                                                                                                                                                                                                                                                               | — (`SUPPORT_EMAIL` is a note, never a refusal)                                                                                                                                                         |
| `social-publishing` | The Social admin for connected accounts, drafts, media, and scheduled deliveries. Register `spaces.deskSources` to show provider conversations in the Spaces Desk. Not available in static deployments. See [Social publishing](/content/docs/building-a-site/social-network)                                                                                                     | Configure provider credentials in Social after deployment                                                                                                                                              |
| `bots`              | Bots, tools, slash commands, and durable agent runs. See [Bots, tools and commands](/content/docs/building-a-site/bots)                                                                                                                                                                                                                                                           | `AGENT_API_KEY` or `OPENAI_API_KEY` for model-backed bots; without either, scripted bots can still respond                                                                                             |
| `copilot`           | An OpenAI-compatible chat-completions endpoint for bots, authorized by a signed grant. Requires `bots`. See [Bots, tools and commands](/content/docs/building-a-site/bots)                                                                                                                                                                                                        | The credentials for the bot's configured model provider; see [Bots, tools and commands](/content/docs/building-a-site/bots)                                                                            |
| `events`            | What is on: events a community attends, each either a date or a repeat, their occurrences expanded over a rolling year, and who says they are coming. A community's home shows these beside what can be booked                                                                                                                                                                    | —                                                                                                                                                                                                      |
| `spaces`            | Spaces: rooms with their own membership, channels read as a stream or a forum, threads, mentions, search, huddles, and the channels the platform writes its own events into                                                                                                                                                                                                       | — (a relay for a huddle is a setting, never a requirement)                                                                                                                                             |
| `space-encryption`  | A channel whose messages the server cannot read: `encrypted: true` on a channel or on the space above it. Its own switch and not part of `spaces`, because it costs a site the things it may want more than secrecy — there is no search of an encrypted channel, no bot in one, and no moderating what nobody can read. Needs `spaces`                                           | —                                                                                                                                                                                                      |
| `network`           | The site's own social network: a page per person, follows, a timeline, posts each to everyone, the people here or a space's members, likes, reposts, blocks, mutes and moderation — and the same served to Bluesky's app and every atproto client (see [The social network](/content/docs/building-a-site/social-network)). Closed to the site's people unless the site federates | `NETWORK_HANDLE_DOMAIN`; `NETWORK_PLC_ROTATION_KEY` where the site federates                                                                                                                           |
| `funnels`           | Funnels, blasts, the audience rules, the hourly runner, Funnels · Blasts in the admin                                                                                                                                                                                                                                                                                             | —                                                                                                                                                                                                      |
| `emails`            | The seven designs, their compile, the send-email function, Emails in the admin                                                                                                                                                                                                                                                                                                    | The mail relay (`SMTP_*`) — needed always, module or not, since auth mail goes through it                                                                                                              |
| `forms`             | Forms: a forms.md document each under `content/forms`, the builder and Responses in the admin, `/form/<slug>`, the `Form` landing section, the embed (`/form.js`), the `form` function and its two tables, the Forms section of Content analytics                                                                                                                                 | — (`FORMS_WEBHOOK_SECRET` optional: the webhooks' signing key, else derived from the service key)                                                                                                      |
| `models`            | Content models: a model each under `content/models`, its entries in the folder beside it; Models and a row per model in the admin; `/c/<key>` pages, `/data/models/<key>.json`, the `Entries` landing section — each as the model says. On unless a site says `models: false`                                                                                                     | —                                                                                                                                                                                                      |
| `instrument`        | A site's own readings: the component `/app` mounts, its tabs, its admin sections. Requires `forms` (the readings run on the same runner): the deploy refuses the instrument on with forms off                                                                                                                                                                                     | —                                                                                                                                                                                                      |
| `recommendations`   | Recommended For You in the library, and the results sheet's Recommendations tab on a site with readings                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                                      |
| `translation`       | Reserved (a coming change)                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                      |
| `tts`               | The spoken books: the person's player and in-browser voice, the `tts` command, the speech test                                                                                                                                                                                                                                                                                    | — (`TTS=1` on the deploy speaks what is missing)                                                                                                                                                       |
| `enrichment`        | The Enrich buttons on the Books grid, the `enrich` command                                                                                                                                                                                                                                                                                                                        | A model API key when a run is started (`OPENAI_API_KEY`, or `REPLICATE_API_TOKEN` for a model on Replicate; `COMPANION_MODEL` picks the model) — never checked by the deploy, which runs no enrichment |
| `push`              | Web push to the staff: Notifications in the admin, the triggers, the push function                                                                                                                                                                                                                                                                                                | The VAPID pair and subject                                                                                                                                                                             |
| `api`               | The content API — Contentful's Delivery, Preview, GraphQL, Sync and Images APIs over every collection and model, the `content` and `images` functions, the API page's keys                                                                                                                                                                                                        | Nothing; the host's rewrites for the bare addresses                                                                                                                                                    |

Some settings are needed whatever the modules: the two Supabase keys, the app's origin, the production database's connection and the shadow database's, the mail relay. See [Environment variables](/content/docs/reference/environment-variables).

## How a switch is read

Every module is a key of `modules` in the config, on unless it says `false`. That reading lives in
**one** place — `lib/modules.js` — and `moduleOn('store')` is how anything asks:

```js
import { moduleOn, anyModuleOn } from '@platform-kit/kit/lib/modules.js'

if (moduleOn('store')) {
  /* … */
}
const needsAnAccount = anyModuleOn(['store', 'memberships', 'coaching'])
```

It exists because of what the obvious version does wrong. Written out by hand, the reading is
`modules.store !== false` — correct, and repeated wherever anybody needed it. Its fault is not
carelessness and no amount of care fixes it:

```js
modules.stor !== false //  undefined !== false   →   TRUE
```

A mistyped name does not switch the module off and does not raise anything. It switches it **on**,
and the feature ships to a site that asked for it to be gone. `moduleOn` knows what the manifests
declare, so it **throws** on a name nobody declares, naming the ones that exist. It throws rather
than answering `false` because answering false would hide a real feature instead of a fake one, and
a module missing with no explanation is far harder to find than a stack trace with the typo in it.
It is the same refusal the build makes for a step gated on a module no manifest declares.

The declared set reaches the browser beside the config: `loadSite` resolves the manifests and the
plugin writes `moduleKeys` into `#site`, so the browser knows exactly what the build knew. Under
Node's own `#site` the same list is exported, so a script refuses a typo too.

**And the hand-written reading is now refused outright.** One reading only helps where it is used,
and it was not used everywhere: thirty-seven `modules.X !== false` reads remained across thirteen
files of the kit and the theme. Each was correct, and each was one typo away from switching a
feature on for a site that had switched it off. They all go through `moduleOn` now, and
`manifests.test.mjs` fails on a raw read anywhere but `lib/modules.js` itself, naming the file and
the line.

It also fails if anything else **binds the name** `moduleOn`, which is not a hypothetical tidiness
rule. `AdminPage.vue` had a local `moduleOn` that took a _view_ key rather than a module id —
`products` is a view, `store` is the module behind it. Two reads converted to the kit's function
silently bound to the local one instead, and the admin stopped loading with a message about a
variable used before initialisation, which names neither module nor switch. The local is `viewOn`
now. A name that means one thing in one file and another thing everywhere else is read by whoever
comes next as the thing it is named after.

In the browser, `modules` comes from `#site` and a component asks through `moduleOn` above. The router (`lib/router.js`) derives the three rules everything else reads: `KINDS_ON` (the four kinds), `ACCOUNTS_ON` (any module that reads an account is on — the header's sign-in follows it), and `DOCS_ONLY` (docs alone, nothing needing an account). The router drops the store's routes, the layout drops its link, the admin drops the views the module owns (`MODULE_OF` in `AdminPage.vue`), and the prerender leaves its pages out. Under Node the build scripts read the same config through `loadSite()`; `platformkit test` runs each kit check behind its module (`KIT_TESTS` in `test.mjs`) — a surface that belongs to a module takes its checks with it, so switching `spaces` off takes the spaces' own suites and the staff desk's with it, a module may own both a section of the admin and a check of its own in `KIT_TESTS`, a module's tables are classified in the one manifest every table appears in (build/declarations.mjs), and a module may own a section of the admin (`MODULE_OF` in `AdminPage.vue`, which is how Community → Community comes and goes with `spaces`), a build step is off with its module (`module` on its record), and `deploy-checks` asks for a setting — and for a step's needs — only when the module that needs it is on.

The demo was verified with each of nine modules off in turn: the site builds, the probe passes, and nothing of the module remains. `platformkit test` runs from a site directory; it uses that site's config and content while resolving kit checks from the workspace.

## Scheduled work belongs to its module

A module that needs recurring database work declares each job beside its other owned resources: a stable `name`, a pg_cron `schedule` and one SQL `command`. Kit declarations live in `build/modules/kit.mjs`; site modules use the same manifest shape, and theme modules may contribute declarations too. Assembly resolves the enabled module set and generates reconciliation SQL after the kit and site row scripts. This is build-time registration: modules do not edit a separate cron list or register jobs dynamically at runtime.

The generated reconciliation remembers only PlatformKit-owned names in `app_settings.platformkit_cron_jobs`. It updates a declared job by its stable name, removes jobs no longer declared by enabled modules, adopts the known legacy declared names on first application, and refuses a same-named job it does not own. Unrelated operator jobs are left alone. Reset and deploy apply the same assembled declaration. For example, memberships declares a renewal job for Hyperswitch subscriptions; it runs every 15 minutes. Stripe subscriptions renew through Stripe's own recurring-billing service.

## A site adds a module of its own

Nothing about a module is the kit's privilege. A site declares one the same way, in its own tree,
and gets everything one of the kit's twenty-four gets — a switch, a row in the deployment matrix,
its route answered and prerendered, its step run in its phase, its variable asked for at deploy —
without editing a single file of the kit or the theme.

`sites/demo` is the worked example, and `build/site-module.test.mjs` holds it to all of it Northlight Press — `sites/demo` — adds `stockists`, the shops that carry its books: a page, a build step that reads `content/stockists`, an admin section and a setting for the wholesaler, none of which the kit has ever heard of.

**The manifest**, anywhere the config points at:

```js
// src/stockists/module.js — Northlight Press adds the shops that carry its books
export default {
  key: 'stockists',
  what: 'the shops that carry the books, and where to find them',
  needs: 'the list is files in the checkout, so there is nothing it needs kept anywhere',
  static: true,
  git: true,
  cloud: true,
  requires: [{ module: 'books', why: 'a stockist carries the books' }],
  owns: {
    routes: ['/stockists'],
    steps: ['stockists'],
    admin: ['stockists'],
    env: ['STOCKISTS_DISTRIBUTOR'],
  },
}
```

**The registration**, in `platformkit.config.js`:

```js
modules: { stockists: true, /* … */ },
build: {
  modules: ['./src/stockists/module.js'],   // the manifests
  steps: ['./src/stockists/step.js'],       // module: 'stockists' on the step gates it
},
routes: [{ path: '/stockists', component: './src/stockists/StockistsPage.vue', module: 'stockists' }],
admin: { sections: './src/stockists/sections.js' },
```

`module` on a route is what makes it the module's rather than merely the site's: with the switch
off the plugin drops it **before the bundle is written**, so the component is never shipped and the
router never learns of the path — stronger than a runtime guard, which would ship it and then
decline to show it.

**How a site's module reaches the deploy.** The manifest's `owns.env` _declares_ the variable; the
step's `needs: { env: [...] }` is what _demands_ it. Both, and for a good reason: the kit cannot
write a condition for a module it has never heard of, so the site says when it is owed by being the
thing that reads it.

**A site must bring its own palette.** The kit ships the design and the theme ships the sections;
neither ships a look. A site that registers none gets a page whose tokens are all empty, and the
landing's button then draws its text in the same colour as its own background. Register one:

```js
looks: { northlight: { css: './src/looks/its own palette' } },
```

## What a module asks of the environment

A manifest's `owns.env` names the variables the module can ask the deploy for. What it does **not**
carry is the condition, and that split is deliberate: a manifest is a fact about a module, and
almost none of these are wanted merely because a module is on.

|                                 | asked for                                                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Selected provider's credentials | only where the content actually has something for sale — a published priced offer, a book in print, a pricing row. The store on with nothing for sale asks for nothing. Stripe is the default; see [Payment providers](/content/docs/building-a-site/payment-providers). |
| LiveKit's                       | only where a session type **records**, or seats more than five. Otherwise the call is made browser to browser and demanding an account would be wrong.                                                                                                                   |
| a printer's                     | only the printers the books' own `print:` blocks name.                                                                                                                                                                                                                   |

"A published priced offer exists" is a fact about the site's **content**, not about the module.
Putting it in the manifest would mean growing the manifest a condition language over content, and
the whole worth of the deploy check is that it asks for nothing a site does not actually use. So
the manifests say what a module _can_ ask for and `deploy-checks.mjs` keeps the judgement of when
each is really owed — and says the reason in the refusal ("for sale: the-kybalion in print"), which
is where you read the condition from in practice.

A **secret may be shared**, unlike everything else a module owns: the mail relay is needed by any of
several modules and a payment provider's credentials may serve several commerce surfaces, so
switching one off takes nothing away while another still needs them. Every other kind of ownership
is exclusive (above).

A handful belong to no module at all — the anon key, the service-role key, the two database urls,
the site's own address. There is no module called "having a database", so those are held as the
deployment's own (`DEPLOYMENT_ENV`) and named as such.

Both directions are held: every variable the deploy can **demand** is either a module's or the
deployment's own, and every variable a module declares is one the deploy can demand — so a new
`need()` cannot go undeclared, and a declaration cannot go stale.

## One thing belongs to one module

A manifest's `owns` names what the module takes away with it when it is switched off — its routes,
its admin sections, its schema files, its functions, its cron jobs, its build steps, its environment
variables. Each of those belongs to **exactly one** module, and the build refuses a set of manifests
where two claim the same one, naming both.

That is not tidiness. Ownership is what a switch acts on: if two modules claim one build step,
switching either off takes the step away and the other module quietly loses a piece of itself — the
very property [switching one module off breaks no other](/content/docs/building-a-site/testing) is
there to prove. And there is no defensible way to resolve it automatically, because
last-one-loaded would make the answer depend on the order a site's config happened to register
things in. Same rule as a landing section registered under a name the theme already has.

## What each module does in each deployment shape

Each module declares this in its own manifest (`build/modules/kit.mjs` for the kit's), and
`build/modes.mjs` reads them into the matrix the code is checked against — not a list kept by hand. **✓** works, **—** absent in that shape, **◑** works apart from the named operation.
See [The three deployment shapes](/content/docs/building-a-site/deployment-modes).

| Module              | static | git | cloud | note                                                            |
| ------------------- | ------ | --- | ----- | --------------------------------------------------------------- |
| `api`               | —      | ✓   | ✓     | the API is Edge Functions                                       |
| `articles`          | ✓      | ✓   | ✓     |                                                                 |
| `books`             | ✓      | ✓   | ✓     |                                                                 |
| `bots`              | —      | ✓   | ✓     | an agent run is rows and a function                             |
| `copilot`           | —      | ✓   | ✓     | a grant, an endpoint and a run — all three need a backend       |
| `coaching`          | —      | ✓   | ✓     | there is nowhere to keep a message                              |
| `docs`              | ✓      | ✓   | ✓     |                                                                 |
| `emails`            | —      | ✓   | ✓     | there is nothing to send with                                   |
| `enrichment`        | —      | ✓   | ✓     | a run is rows, and the book is read through the store           |
| `events`            | —      | ✓   | ✓     | there is nowhere to keep who is coming                          |
| `forms`             | —      | ✓   | ✓     | there is nowhere to keep a response                             |
| `funnels`           | —      | ✓   | ✓     | there is nobody to send to and nowhere to record it             |
| `instrument`        | —      | ✓   | ✓     | an answer is written to an account                              |
| `memberships`       | —      | ✓   | ✓     | there is nowhere to keep a membership                           |
| `models`            | —      | ✓   | ✓     | an entry is edited through the admin, which needs a backend     |
| `network`           | —      | ✓   | ✓     | a post, a follow and an account are rows                        |
| `print`             | —      | ✓   | ✓     | the listing's pictures are drawn by the administrator's browser |
| `push`              | —      | ✓   | ✓     | there is nothing to send a notification from                    |
| `recommendations`   | —      | ✓   | ✓     | it is derived from what an account has read and bought          |
| `sessions`          | —      | ✓   | ✓     | there is nowhere to keep a booking                              |
| `social-publishing` | —      | ✓   | ✓     | accounts, media and delivery records live in the backend        |
| `spaces`            | —      | ✓   | ✓     | there is nowhere to keep a room or who is in it                 |
| `space-encryption`  | —      | ✓   | ✓     | a key lives on a device and the cipher in a row                 |
| `store`             | —      | ✓   | ✓     | there is nowhere to keep an order                               |
| `support`           | —      | ✓   | ✓     | there is nowhere to keep a conversation                         |
| `translation`       | —      | —   | —     | not built                                                       |
| `tts`               | —      | ✓   | ✓     | a recording is kept in a bucket                                 |
| `wiki`              | ✓      | ✓   | ✓     |                                                                 |

A module marked **—** under _static_ is not broken there, it is **absent**: a site with no backend
has nowhere to keep an order or a booking, and switching one on in a site that declares
`deployment: { backend: false }` fails at that commit rather than at a deploy.

## A declaration that asks for a module which is off

Most switches take a feature away and that is the end of it: the route is gone, the step does not run, the deploy stops asking for the secret. Encryption cannot work that way, because the ask is in the CONTENT.

A channel's file says `encrypted: true`. With `space-encryption` off there is no schema to keep a key in and no client to seal with, so the room would be served as plain text — sealed in the repository and readable in the database, and nobody told. That is worse than either a sealed room or an open one. So the spaces compile refuses it, naming both the module and the channel's own file, and the refusal is pinned in `build/modules-off.test.mjs` along with the two directions above.

The same holds for a space that seals every room under it. A compile that was told nothing about the modules — the admin's Edge Function, which has no config to read — refuses nothing: an unanswerable question is not a fault.
