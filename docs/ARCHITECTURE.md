# PlatformKit architecture

PlatformKit is a TypeScript framework, in the spirit of Laravel Spark, for running a whole online business from one codebase. This document covers its design philosophy, how its layers are organized and interact, how concerns are separated, how features are modularized, how sites extend it, and the features it ships. For the platform overview and deployment shapes, see [PLATFORMKIT.md](PLATFORMKIT.md).

## Design philosophy

- **A framework, not a site.** The kit holds only general mechanics. Each site owns its content, configuration and code, and nothing site-specific goes into the kit.
- **Modules you can switch off.** Each business feature is a module, and turning one off removes its backend too: its tables, functions and pages.
- **Content is files.** Pages, products, courses and forms are Markdown and frontmatter in the site's repository, so they are checked when the site is built.
- **The database enforces the rules.** Permissions, prices and money logic live in Postgres functions and row-level security, so a faulty page cannot get around them.
- **Every change is specified.** Behaviour is written as OpenSpec requirements (`openspec/specs/`), each with a test that proves it on a real, throwaway stack.
- **The vendor's standard path first.** Stripe, Supabase and the AT Protocol are used the way their own documentation recommends, rather than through hand-rolled workarounds.

## Layers and how they interact

There are five layers. Each depends only on the layers below it, and the module switches at the top decide what exists in every layer beneath.

### 1. The site (owned by the site)

- `platformkit.config.ts` names the site, chooses the theme and turns modules on or off.
- Content is Markdown with frontmatter: pages, products, courses, forms and emails.
- Anything the kit does not provide, the site adds itself: its own module, a supplier, tables in `db/`, a palette and wording.
- The site depends on the kit, never the reverse.

### 2. The build (the `platformkit` CLI turns a site into an app)

- It reads the configuration and resolves which modules are on. Every later step follows from that list.
- **Content:** Velite compiles the Markdown into typed collections, validated against the kit's models in `packages/kit/build/models`. An invalid entry is caught here, not in production.
- **Data:** the assembler (`packages/kit/build/assemble.mts`) builds the site's `supabase/` tree from the kit's data layer and the site's own. It includes the core, the modules that are on, and the glue between pairs of modules that are both on. The tree is generated on every run and is never edited by hand or committed.
- **Front end:** Vite bundles the theme with the compiled content, catalog, emails and interface strings.

### 3. The front end (what readers and admins see)

- `packages/kit/theme/` holds the Vue pages, admin screens and page sections. It displays; it does not decide.
- `packages/kit/src/lib/` holds the logic for each area, such as cart, prices, access, chat and courses. Pages call it; it never renders markup.
- It talks to the database directly, under the database's rules. It reads tables and calls SQL functions with types generated from the schema, so a schema change breaks the build rather than a page.

### 4. The database (the authority)

- The schema is a declaration, not a migration history. One numbered file covers each area in dependency order: foundation (10), then content, forms, commerce (40–44), courses, chat and sessions, email, support, spaces and network (90s), and social.
- Row-level security and SQL functions hold the rules: who can see what, what something costs, and whether a purchase counts. The front end and the functions both go through them, and neither can bypass them.
- The database also starts work itself: cron jobs and `pg_net` requests call edge functions, as in the federation queue.

### 5. Edge functions (the door to outside services)

- These are Deno functions in `packages/kit/supabase/functions/`, one per job: checkout, payment webhooks, images, email, print, video rooms, Matrix, the AT Protocol and AI.
- They exist for anything that needs a secret key or a third-party service.
- Shared code lives in `_shared` and uses the same generated database types as the front end.
- Each vendor sits behind an interface. Payments, for example, go through the payment-provider interface (`packages/kit/src/payment-provider.mts`) with Stripe or Hyperswitch behind it, so changing vendors does not touch the layers above.

### One request end to end: a reader buys something

1. The theme calls `src/lib/cart`.
2. The cart calls the checkout edge function.
3. The function asks the database what the basket costs. Prices and promotion rules are applied in SQL; nothing from the browser is trusted.
4. The function opens a Stripe session.
5. Stripe's webhook reaches another function, which records the order through the database's own functions.
6. The reader's library updates because the database's rules now say they own the item.

## Separation of concerns

### By owner

- **The kit** (`packages/kit`) owns the mechanics.
- **The theme** (`packages/kit/theme`) owns everything a person sees.
- **The site** owns what it is: its configuration, content, wording, look and any code of its own.
- Dependencies run one way: site → theme → kit.

### By layer

- **Content** is files, validated by zod models.
- **Rules** live in the database, as row-level security and SQL functions for prices, access and orders.
- **Display** is the Vue theme, which decides nothing.
- **Outside services** are edge functions, the only code that holds secrets.

### Inside the front end

`theme/` draws and `src/lib/` thinks: a page holds no business logic, and a lib file holds no markup.

### One source for each type

The database schema generates the types used by the front end and the functions (`database.types.ts`). The content models generate both the content types and the admin's editing forms.

## Modularization

- **Each feature is a module.** The kit ships about two dozen, including store, print, courses, spaces, sessions and emails. Each declares a manifest in `packages/kit/build/modules/kit.mts` saying:
  - what it is;
  - whether it works in each deployment shape (static, git, cloud);
  - which other modules it requires, and why;
  - what it owns: routes, build steps, admin sections, secrets, schema files and functions.
- **Ownership is exclusive and checked.** A schema file or function that no module owns is refused by name, so nothing is left unaccounted for.
- **Switching a module off removes everything it owns:** its pages, its admin entry, its build step, its tables and its functions. The assembler does not copy any of them into the site's backend.
- **Glue between modules is a separate file,** for example `packages/kit/supabase/schemas/glue/courses+spaces.sql`. It is installed only when both modules are on. Neither module needs to know about the other, and turning either one off removes the link cleanly.
- **Dependencies are declared by the dependent.** A module that needs another says so in its own manifest, so the module it needs never has to know who uses it.

## Extensibility

- **A site can add its own module without touching the kit.** The demo's `sites/demo/src/stockists/module.ts` is the proof: one manifest gives it a config switch, a route, a build step, an admin section and a deploy-time secret, and switching it off removes all of them, exactly as for a kit module.
- **Its own data.** A site's `db/` adds schemas, rows, functions and seed data. These are assembled after the kit's, so they can build on the kit's tables.
- **Admin screens from models.** A site declares a content model and an admin section (its label and icon), and the admin draws the editing grid and form from the model's fields. A custom component is needed only when a generated form is not enough.
- **Vendors behind interfaces.** A site can plug in its own store supplier (as the demo does with `sites/demo/build/suppliers.mts`) or a different payment provider without changing checkout.
- **The theme, piece by piece or whole.** A site can override any single page or component (`overrides`), replace the theme (`theme`), change the default interface strings, or add a palette (a "look").
- **Content kinds and page sections.** A site registers its own content kinds and sections alongside the theme's.

## Key features

- **Publishing:** pages, a library, search and documentation.
- **Commerce:** a store, inventory, price rules and promotions, orders, and print-on-demand editions.
- **Memberships:** subscriptions and tiers, and full courses.
- **Bookings:** one-to-one sessions and video calls, providers and teams.
- **Community:**
  - spaces;
  - chat, including end-to-end encrypted chat over Matrix;
  - comments, reactions and achievements;
  - federation with Bluesky over the AT Protocol.
- **Engagement:** forms and workbooks, email marketing, push notifications, events and analytics.
- **Support:** a help desk and tickets.
- **AI:** a copilot and assistants.
- **Platform:** a public API with rate limits.

The full, current feature list is in [FEATURES.md](FEATURES.md).
