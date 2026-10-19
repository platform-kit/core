import { checkContent, report } from './content-rules.mjs'
import { s } from 'velite'
import { resolve, dirname } from 'node:path'
import { codeToHtml } from 'shiki'
import { renderer as markdownRenderer } from '../src/lib/markdown.js'
import { processCover } from './cover.mjs'
import { resolveAsset } from './assets.mjs'
import { parseCompanionBody } from './companion-io.mjs'
import { parseGroups, mergeUi } from './strings-io.mjs'
import { parseForm } from '../src/lib/forms/parse.js'
import { readModels, DIR as MODELS_DIR } from './model-io.mjs'
import { schemaFor, checkEntry, collectionName, sortEntries } from './models.mjs'
import { loadSite } from './site.mjs'
import { loadTheme } from './theme.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { loadEnv } from 'vite'
import { PRINTER_IDS, FORMATS_PRINTED } from '../supabase/functions/_shared/suppliers/index.js'
import { publicBook, publicPage, publicCompanion } from '../supabase/functions/_shared/gate.js'


/* The spoken books: the repository's own store, audio/books/<slug>/, holds the
   manifest (plain) and the recordings (Git LFS), written by build/tts.mjs, which
   also keeps Supabase Storage (bucket `audio`, public) in step. The manifest is
   read from the store here; the urls point into the bucket at the same
   VITE_SUPABASE_URL the app uses, read the way Vite reads it. */
const ENV = { ...loadEnv(process.env.NODE_ENV || 'production', process.cwd(), 'VITE_'), ...process.env }
const AUDIO_BASE = String(ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
async function audioManifest(slug) {
  const file = resolve('audio/books', slug, 'index.json')
  if (!existsSync(file) || !AUDIO_BASE) return null
  return { base: AUDIO_BASE + '/storage/v1/object/public/audio/books/' + slug + '/', manifest: JSON.parse(readFileSync(file, 'utf8')) }
}

/*
 * The content build. Every markdown document under /content (except the string
 * catalogs, which stay with i18next) is validated against a schema here and
 * compiled to typed JSON in .velite — so a bad frontmatter field fails the
 * build instead of silently misbehaving in the UI.
 *
 * The markdown is rendered by the one renderer the browser has too
 * (src/lib/markdown.js: marked, heading ids and anchors, a code block through
 * shiki here — the browser's render of a row in cloud mode is the same html but
 * for the colours inside a <pre>). Reading time and an excerpt are velite's,
 * over the plain text of the document.
 *
 * Embeddings for semantic search are added in a separate post-build step
 * (build/embed-content.mjs), not here, to keep the WASM model out of the
 * config bundle.
 */
const MD = markdownRenderer({ highlight: (code, lang) => codeToHtml(code, { lang: lang || 'text', theme: 'github-light' }) })
/* the body rendered: velite's own s.markdown replaced by the shared renderer (an empty body is a fault, as velite's was) */
const markdown = () => s.custom((i) => i === undefined || typeof i === 'string').transform(async (v, ctx) => {
  const c = v ?? ctx.meta.content
  if (c == null || !c.trim()) { ctx.addIssue({ code: 'custom', message: 'The content is empty' }); return '' }
  return MD.parse(c)
})
const toc = () => s.custom((i) => i === undefined || typeof i === 'string').transform((v, ctx) => MD.toc(v ?? ctx.meta.content ?? ''))

/* who may open a document: a subset of the class ladder guest < authenticated <
   paid < subscribed. Absent/empty means everyone. The rule lives in the markdown. */
const ACCESS = s.array(s.enum(['guest', 'authenticated', 'paid', 'subscribed'])).optional()

/* a cover by address, sized to the object the components render (a wiki page's, a doc's — as a book's) */
const withCover = (then) => async (data) => {
  const d = then(data)
  d.coverSource = data.cover || null   /* for cloud mode's adapter, as the books' */
  if (d.cover) {
    try { const src = await resolveAsset(d.cover, { fromFile: resolve('content', data.path + '.md') }); d.cover = src ? await processCover(src) : null } catch (e) { d.cover = null; console.warn(`[velite] ${d.path}: cover "${data.cover}" did not resolve — kept without a cover. ${e.message}`) }
  }
  return d
}
/* a document's id is its path within its own collection: articles/foo -> foo */
const stripCollection = (dir) => (data) => ({ ...data, id: data.path.replace(dir + '/', '') })

/* the kit's velite config for a site: the kit's collections, the site's own beside them (platformkit.config.js `collections`: a
   module exporting `collections` and optionally `prepare`), the theme's default strings merged under the site's */
export async function kitConfig() {
  const c = await loadSite()
  /* a body as an article's is rendered, and a record with none is simply without one (velite's own s.markdown
     calls an empty body a fault): a landing page's, and a model entry's */
  const optionalBody = s.custom((i) => i === undefined || typeof i === 'string').transform(async (v, ctx) => { const c = v ?? ctx.meta.content; return c && c.trim() ? MD.parse(c) : '' })
  const THEME = await loadTheme(c)
  const site = c.collections ? await import(/* @vite-ignore */ pathToFileURL(resolve(c.root, c.collections)).href) : {}
  const extra = site.collections || {}
  /* the storefront is one file the store needs; with the store off a site has none, and the kit's empty one
     stands in (velite refuses a single collection with no file, so it is read as a list and settled in prepare) */
  /*
   * A SINGLE COLLECTION WITH NO FILE. velite refuses one outright ("no data resolved"), so a
   * collection declared `single: true` makes its file compulsory for every site — which is the
   * opposite of what three of them say about themselves: a site that writes no `community.md`
   * "gets the kit's own", and one that declares no comment kinds "can be embedded nowhere, which
   * is the right default". It was compulsory all the same, and neither the demo nor the docs site
   * could build: only a site with all three files could.
   *
   * So each is single only when there is something to be single about, and prepare settles the
   * absent one into its default — the way the storefront has always been handled with the store off.
   */
  const hasFile = (p) => existsSync(resolve(c.root, 'content', p))
  const storeOn = c.modules.store !== false
  const formsOn = c.modules.forms !== false
  /* a team is a way of sharing a booking type, so it goes with the sessions module */
  const teamsOn = c.modules.sessions !== false
  /* the content models (modules.models, on unless a site says otherwise): a model file that is malformed refuses the
     build here, naming the fault; every published one is a collection of its own, models_<key>, its entries under
     content/models/<key> — and #content/models/<key> to the site */
  const modelsOn = c.modules.models !== false
  const modelSet = modelsOn ? await readModels(c.root) : []
  const modelFaults = modelSet.flatMap((x) => x.errors)
  if (modelFaults.length) throw new Error('content models:\n  ' + modelFaults.join('\n  '))
  const models = modelSet.filter((x) => x.model.published).map((x) => x.model)
  const modelCollections = {}
  for (const m of models) {
    modelCollections[collectionName(m.key)] = {
      name: 'Model_' + m.key.replace(/-/g, '_'),
      pattern: `models/${m.key}/*.md`,
      single: !!m.singleton,
      schema: s.object({
        published: s.boolean().default(true),
        path: s.path(),
        ...schemaFor(m, s),
        ...(m.body ? { body: optionalBody, raw: s.raw() } : {}),
      }).transform((d) => ({ ...d, slug: d.path.split('/').pop() })),
    }
  }
  return {
  root: 'content',
  output: { data: '.velite', assets: 'public/static', base: '/static/', clean: true },
  collections: {
    ...extra,
    ...modelCollections,
    models: { name: 'Model', pattern: 'models/*.md', schema: s.object({ path: s.path() }) },   /* the records themselves, settled in prepare from the parsed set — an empty list with the module off, so #content always has it */
    articles: {
      name: 'Article',
      pattern: 'articles/**/*.md',
      schema: s.object({
        published: s.boolean().default(true),   /* false: kept on disk, edited in the admin, never in the bundle */
        path: s.path(),
        title: s.string(),
        description: s.string().optional(),
        date: s.isodate().optional(),
        author: s.string().optional(),
        image: s.string().optional(),
        /* THE MARK, as a file rather than a component. SiteMark.vue is the one the app draws, and a
           site that replaces it writes Vue; this is the other half — an SVG or a PNG an owner
           uploads, which is what the share-image function sets on the card where it has no Vue to
           render. Absent, the card falls back to the component's own SVG, and then to no mark. */
        mark: s.string().optional(),          /* hero: external URL or /static path */
        share: s.string().optional(),          /* the share image, when not the generated card */
        media: s.any().optional(),             /* one track or a playlist */
        canAccess: ACCESS,
        tags: s.array(s.string()).default([]),
        /* WHETHER PEOPLE MAY SAY SOMETHING UNDER IT, and where the conversation lives. Off unless
           the file says otherwise, because a site that has not thought about moderation should not
           wake up to a comment section. Written as a word (off · everyone · members · hosts), or as
           a block that also names a forum channel — and then the comments ARE a post in that
           channel: one thread, reachable from here and from the board, moderated with everything
           else the community already moderates.
             comments: members
             comments: { allow: members, space: the-practice, channel: the-books } */
        comments: s.any().optional(),
        body: markdown(),                  /* rendered HTML */
        excerpt: s.excerpt({ length: 200 }),
        metadata: s.metadata(),                /* { readingTime, wordCount } */
      }).transform(stripCollection('articles')),
    },

    wiki: {
      name: 'Wiki',
      pattern: 'wiki/**/*.md',
      schema: s.object({
        published: s.boolean().default(true),   /* false: kept on disk, edited in the admin, never in the bundle */
        path: s.path(),
        title: s.string(),
        description: s.string().optional(),
        order: s.number().default(99),
        tags: s.array(s.string()).default([]),
        cover: s.string().optional(),          /* an address (/uploads/…): sized like a book's cover in the transform */
        author: s.string().optional(),
        date: s.isodate().optional(),
        updated: s.isodate().optional(),
        related: s.array(s.string()).default([]),
        media: s.any().optional(),             /* one track or a playlist */
        canAccess: ACCESS,
        /* WHETHER PEOPLE MAY SAY SOMETHING UNDER IT, and where the conversation lives. Off unless
           the file says otherwise, because a site that has not thought about moderation should not
           wake up to a comment section. Written as a word (off · everyone · members · hosts), or as
           a block that also names a forum channel — and then the comments ARE a post in that
           channel: one thread, reachable from here and from the board, moderated with everything
           else the community already moderates.
             comments: members
             comments: { allow: members, space: the-practice, channel: the-books } */
        comments: s.any().optional(),
        body: markdown(),
        raw: s.raw(),
        toc: toc(),
        excerpt: s.excerpt({ length: 200 }),
        metadata: s.metadata(),
      }).transform(withCover(stripCollection('wiki'))),
    },

    docs: {
      name: 'Doc',
      pattern: 'docs/**/*.md',
      schema: s.object({
        published: s.boolean().default(true),   /* false: kept on disk, edited in the admin, never in the bundle */
        path: s.path(),
        title: s.string(),
        description: s.string().optional(),
        order: s.number().default(99),
        tags: s.array(s.string()).default([]),
        cover: s.string().optional(),          /* an address (/uploads/…): sized like a book's cover in the transform */
        author: s.string().optional(),
        date: s.isodate().optional(),
        updated: s.isodate().optional(),
        related: s.array(s.string()).default([]),
        media: s.any().optional(),             /* one track or a playlist */
        canAccess: ACCESS,
        /* WHETHER PEOPLE MAY SAY SOMETHING UNDER IT, and where the conversation lives. Off unless
           the file says otherwise, because a site that has not thought about moderation should not
           wake up to a comment section. Written as a word (off · everyone · members · hosts), or as
           a block that also names a forum channel — and then the comments ARE a post in that
           channel: one thread, reachable from here and from the board, moderated with everything
           else the community already moderates.
             comments: members
             comments: { allow: members, space: the-practice, channel: the-books } */
        comments: s.any().optional(),
        body: markdown(),
        raw: s.raw(),
        toc: toc(),
        excerpt: s.excerpt({ length: 200 }),
        metadata: s.metadata(),
      }).transform(withCover(stripCollection('docs'))),
    },

    /* CTA ads: a call to action shown as a modal / bottom-right card on any
       page and inline at the foot of articles, chosen for each reader by what
       they've viewed and what their results say. The body is the ad text. */
    ads: {
      name: 'Ad',
      pattern: 'ads/*.md',
      schema: s.object({
        published: s.boolean().default(true),   /* false: kept on disk, edited in the admin, never in the bundle */
        path: s.path(),
        title: s.string(),                       /* internal name */
        button: s.string(),                      /* the one required piece: the CTA label */
        href: s.string().optional(),
        headline: s.string().optional(),
        image: s.string().optional(),            /* a URL or /static path, like an article hero */
        media: s.any().optional(),               /* an optional video / audio track */
        placement: s.enum(['modal', 'inline', 'both', 'footer']).default('both'),   /* footer: the close at the foot of a page (SiteClose.vue) */
        priority: s.number().default(0),
        audience: s.array(s.enum(['guest', 'authenticated', 'paid', 'subscribed'])).default([]),
        topics: s.array(s.string()).default([]),  /* canonical topic slugs it speaks to */
        concepts: s.array(s.string()).default([]),
        match: s.enum(['any', 'all']).default('any'),
        minTopicViews: s.number().int().min(0).default(0),
        cooldownHours: s.number().min(0).optional(),
        body: markdown(),
        raw: s.raw(),
      }).transform(stripCollection('ads')),
    },

    /* The store's editorial layer: what it says and shows about each thing it
       sells. Price, currency and availability come live from the Stripe-mirrored
       catalog (joined on `sku`); everything a shopper reads or looks at is
       authored here. The body is the long description; `## ` sections in it
       become the details panels on the product page. */
    products: {
      name: 'Product',
      pattern: 'store/products/*.md',
      schema: s.object({
        published: s.boolean().default(true),   /* false: kept on disk, edited in the admin, never in the bundle */
        path: s.path(),
        title: s.string(),
        subtitle: s.string().optional(),          /* one line under the title */
        /* the offer itself — this file is the source of truth, and Stripe is made to
           match it (build/catalog.mjs → supabase/functions/_shared/catalog.json; the
           checkout function and the deploy push it): `sku` is OUR slug, the product's
           name in Stripe's metadata and the price's lookup key; `price` is in dollars
           (10 or 10.00) and becomes cents on the way to Stripe; a subscription has a
           `period`. A price change makes a new Stripe price under the same key and
           retires the old one; a subscriber stays on what they signed up at. `key` is
           the offer's identity — eight hex characters, assigned once by the admin's
           writer (or build/product-keys.mjs) and never edited: Stripe's lookup key
           and what every purchase, subscription and credit is attributed by, so the
           human `sku` (the slug in URLs and in pricing.md) may be renamed freely. */
        sku: s.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        key: s.string().regex(/^[0-9a-f]{8}$/),
        kind: s.enum(['book', 'good', 'membership', 'session', 'form']),   /* session: a paid call, bought as it is booked (content/sessions names it by sku); form: an answer somebody pays to have looked at, which a form names by sku */
        billing: s.enum(['once', 'subscription']).default('once'),
        period: s.enum(['weekly', 'monthly']).optional(),
        price: s.number().min(0),
        currency: s.string().default('usd'),
        'chat-hours': s.number().optional(),      /* what the offer promises: a coach's reply within this many hours */
        /* WHAT STRIPE ALREADY DOES, AND THIS NEVER PASSED. Four fields, each a parameter rather
           than a mechanism — and each refused at compile where the provider would refuse it at the
           till, because a fault at the build is worth more than a fault in front of a buyer.
             trial: 14                       days before a subscription is first charged
             tax: { automatic: true, registration: true }
             payments: [link, apple_pay]     beyond cards; NOTHING by default, because which
                                             methods a shop accepts changes its fees, how fast it
                                             is paid and how disputes go — not a kit's choice
             adjustable: { min: 1, max: 10 }  the quantity is the buyer's to change in Checkout;
                                             NOT a count of anything, which is why it is not
                                             called quantity — a file may never say how many
                                             there are (declarations.test.mjs refuses it) */
        trial: s.number().int().min(1).max(730).optional(),
        tax: s.object({
          automatic: s.boolean().default(false),     /* Stripe works the rate out from where the buyer is */
          registration: s.boolean().default(false),  /* and asks a business buyer for its VAT/tax number */
        }).optional(),
        payments: s.array(s.string()).default([]),
        adjustable: s.object({
          min: s.number().int().min(1).default(1),
          max: s.number().int().min(1).max(999).default(99),
        }).optional(),
        usage: s.object({
          unit: s.string().min(1),
          rate: s.number().min(0.000001),
          grant: s.number().int().min(1).optional(),
          included: s.number().int().min(0).optional(),
          meter: s.string().regex(/^[a-z][a-z0-9_]{0,99}$/).optional(),
          overagePrice: s.number().min(0.000001).optional(),
          speechCostPerSecond: s.number().min(0).optional(),
        }).optional(),
        sessions: s.array(s.object({ type: s.string(), weekly: s.number().default(0), monthly: s.number().default(0) })).default([]),   /* a membership's sessions included: booking types with how many a week and a month (0 = no limit); a listed type is the tier's whatever the type's own rules say */
        book: s.string().optional(),              /* book slug, for a book unlock */
        /* a membership is a tier: its slug is what every price of it carries as
           metadata `tier` (the webhook keeps it on the subscription — a weekly and a
           monthly price of one tier both count), and its rank its place on the ladder
           — a higher rank includes everything a lower one gets */
        tier: s.string().optional(),
        rank: s.number().optional(),
        image: s.string().optional(),             /* the lead photo (a book falls back to its cover) */
        gallery: s.array(s.string()).default([]), /* more photos, in order */
        collections: s.array(s.string()).default([]),
        /* ONE AXIS OF VARIANTS, and the short way to write the common case. `sizes: [S, M, L]`
           IS `options: [{ name: Size, values: [S, M, L] }]` — build/variants.mjs folds it in, so
           there is one mechanism and a file that only needs sizes never meets the other. */
        sizes: s.array(s.string()).default([]),
        /* THE SHAPES THIS IS SOLD IN. Each option has a name and its values in the order they
           are shown; the variants are the combinations, derived by the build and never written
           down (build/variants.mjs). The order of the options is the order of a variant's key,
           so reordering them changes every cart line — which is why the admin reorders values
           freely and options deliberately. A price, a sku and a weight belong to a VARIANT; the
           offer's own `price` is the base every variant starts from.
             options:
               - name: Size
                 values: [S, M, L]
               - name: Colour
                 values: [{ value: deep-navy, label: Deep Navy }] */
        options: s.array(s.object({
          name: s.string(),
          values: s.array(s.any()).default([]),
        })).default([]),
        /* WHAT A VARIANT COSTS, WHERE IT DIFFERS, keyed by the variant's own key
           ("s.black"): a price in dollars, a sku of its own, a weight, and whether it is sold.
           A combination not named here is sold at the offer's own price. */
        variants: s.record(s.string(), s.any()).default({}),
        /* and the few combinations a shop does NOT sell, named rather than the many it does */
        unsold: s.array(s.string()).default([]),
        /* WHETHER STOCK IS COUNTED, never HOW MANY. A file may say this thing is tracked and
           whether it may be sold past zero; the count itself is a row, because if the database
           were deleted and the repository redeployed the count must not come back as five.
           build/declarations.test.mjs refuses a count in a file by name. */
        tracked: s.boolean().default(false),
        backorder: s.boolean().default(false),
        badge: s.string().optional(),             /* "New" — the best seller's badge is earned, from sales (build/sales.mjs) */
        compare: s.string().optional(),           /* an old price, as written ("$39"), struck through beside the price */
        rating: s.number().min(0).max(5).optional(),   /* stars, as the site knows them — no review system is behind them yet */
        reviews: s.number().int().min(0).optional(),   /* how many, for the line beside the stars */
        featured: s.boolean().default(false),
        order: s.number().default(99),
        tags: s.array(s.string()).default([]),
        /* WHETHER PEOPLE MAY SAY SOMETHING UNDER IT, and where the conversation lives. Off unless
           the file says otherwise, because a site that has not thought about moderation should not
           wake up to a comment section. Written as a word (off · everyone · members · hosts), or as
           a block that also names a forum channel — and then the comments ARE a post in that
           channel: one thread, reachable from here and from the board, moderated with everything
           else the community already moderates.
             comments: members
             comments: { allow: members, space: the-practice, channel: the-books } */
        comments: s.any().optional(),
        body: markdown(),
        raw: s.raw(),
        excerpt: s.excerpt({ length: 160 }),
      }).transform((data) => ({ ...stripCollection('store/products')(data), unit_amount: Math.round(data.price * 100) })),
    },
    /* Landing pages: a route, and a list of sections (a component by name, with
       its props) assembled in that order. A page knows nothing about testing;
       an experiment (below) may name several pages on one route as its
       variants. */
    pages: {
      name: 'Page',
      pattern: 'pages/*.md',
      schema: s.object({
        published: s.boolean().default(true),   /* false: kept on disk, edited in the admin, never in the bundle */
        path: s.path(),
        title: s.string(),
        route: s.string().default('/'),
        seoTitle: s.string().optional(),       /* the browser-tab / search title; blank = the site name */
        description: s.string().optional(),    /* the search / share description */
        image: s.string().optional(),          /* the share image; unset, the generated default card */
        sections: s.array(s.object({ component: s.string(), props: s.any().optional() })).default([]),
        progress: s.boolean().default(false),  /* a thin bar at the top that fills as the page is read */
        /* WHOSE PAGE IT IS, by their username. A coach builds their own page with the same builder
           the site's landing pages are built with, and it stands at /p/<username> — so the page is
           a page like any other and the one thing that differs is who may edit it. A page with no
           owner is the site's, which is nearly all of them. */
        owner: s.string().optional(),
        /* THE SITE'S FOOTER, OR NOT. Chrome by default, because a footer a page has to remember to
           include is a footer half the pages are missing. A page says false where the last thing on
           it IS the end — a landing whose close is the ground the whole page has been walking
           toward does not want a column of links under it. A page whose own sections name a Footer
           gets that one and not both, and needs no flag. */
        footer: s.boolean().default(true),
        body: optionalBody,                     /* a landing page is its sections; a body is rare and never required */
        raw: s.raw(),
      }).transform(stripCollection('pages')),
    },

    /* The ways to book a session (the Coaching tab, Book a session). One file per
       option: what it is, its cal.com url, who gets it — `guest` (anyone with no
       membership), `authenticated` (signed in, no membership), or a membership tier's
       slug (that tier and every higher rank) — and `weekly`, how many a week the
       option allows (0 = no limit), counted from the bookings mirrored from cal.com. */
    /* A space and its channels: the rooms a site HAS, which is part of what the site is and
       therefore a file rather than a row (build/spaces-io.mjs is the grammar; build/spaces.mjs
       compiles the two into one record and build/spaces-push.mjs projects it into the tables).
       The site itself reads the compiled record; these collections exist so a space is content
       like everything else — the admin edits it through the pipe, cloud mode gives it drafts, a
       publish pushes it to the repository, and a malformed one fails the build. */
    /* COMMENTS ON THINGS THIS SITE DOES NOT HAVE.
       Everything of the site's own is projected from its file — an article, a chapter, a product —
       because the site knows what it has. A page on SOMEBODY ELSE'S site is not: an embed on a blog
       with two hundred posts cannot have two hundred rows projected for it.
       So a site may declare a KIND as open: who may read it, who may say something, and which forum
       channel the threads belong in. A thread is then made the first time anybody comments, named
       by the title the embed passed. It is still a declaration — the site says the kind is open,
       and nobody can invent one. A site that declares none can be embedded nowhere, which is the
       right default. */
    comments: {
      name: 'CommentKinds',
      pattern: 'comments.md',
      single: hasFile('comments.md'),
      schema: s.object({
        kinds: s.array(s.object({
          kind: s.string(),
          allow: s.enum(['everyone', 'members', 'hosts']).default('members'),
          access: s.array(s.string()).default([]),
          space: s.string().optional(),
          channel: s.string().optional(),
        })).default([]),
        body: markdown(),
      }),
    },

    /* THE PROVIDER POLICY. Who may sell their own time here, on what footing, and how they are
       paid — and its BODY is the terms they agree to, which is why the browser needs it at all: a
       provider is shown the words before they sign, and a page that had to ask the database for
       them would be a page that could not show them while offline. The four settings are read from
       here by the surfaces and from app_settings by the policies, which is the same distinction
       every other policy in this project keeps: the file is the answer, the row is the enforcement. */
    providers: {
      name: 'ProviderPolicy',
      pattern: 'providers.md',
      single: hasFile('providers.md'),
      schema: s.object({
        offerings: s.union([s.boolean(), s.enum(['on', 'off'])]).default('off'),
        approve: s.union([s.boolean(), s.enum(['on', 'off'])]).default('on'),
        terms: s.string().default(''),
        'payout-delay': s.string().default('30d'),
        connect: s.enum(['managed', 'own']).default('managed'),
        body: markdown(),
      }),
    },

    /* THE COMMUNITY AS A WHOLE — everything about the spaces surface that is not one space.
       What it is called in the site's header and on its own front page, the cover behind that
       page, the six colours its chrome wears, what the front page opens on, and which of its
       features are switched on for this site.

       It is CONTENT and not config, because every one of those is a decision an owner makes about
       how their community feels, and none of them is a decision a developer makes about how the
       code is put together. The admin edits this file like any other; platformkit.config.js keeps
       only what a deployment decides (whether the module is on at all, where coaching is answered,
       which avatar collection is drawn). A site that writes no file gets the kit's own. */
    community: {
      name: 'Community',
      pattern: 'community.md',
      single: hasFile('community.md'),
      schema: s.object({
        /* what it is called wherever it is named: the header, the front page's head, the rail */
        name: s.string().optional(),
        tagline: s.string().optional(),
        /* the picture behind the front page's head. Without one the page draws a mesh of the
           community's own hue, which is a good answer and not a placeholder. */
        cover: s.string().optional(),
        /* the surface's six colours — the rail, the column beside it, its ink, the row somebody is
           standing on, what may be opened, and what is owed. Each optional; each falls through to
           the kit's own, which is a dark chrome that clashes with nothing anybody says in it. */
        colours: s.object({
          rail: s.string().optional(), side: s.string().optional(), ink: s.string().optional(),
          on: s.string().optional(), link: s.string().optional(), badge: s.string().optional(),
          go: s.string().optional(),
        }).default({}),
        /* what the front page opens on, and how much of it is drawn */
        home: s.object({
          /* the feed of what has been said, or the spaces to choose from */
          opens: s.enum(['feed', 'spaces']).default('feed'),
          greeting: s.boolean().default(true),
          facts: s.boolean().default(true),
          compose: s.boolean().default(true),
          events: s.boolean().default(true),
          people: s.boolean().default(true),
        }).default({}),
        /* the features this community runs. Each is a thing a site may simply not want — a book
           club needs no huddles, a support desk needs no polls — and switching one off takes its
           buttons, its places and its keyboard shortcuts with it. */
        features: s.object({
          events: s.boolean().default(true), huddles: s.boolean().default(true),
          polls: s.boolean().default(true), voice: s.boolean().default(true),
          files: s.boolean().default(true), tickets: s.boolean().default(true),
          forum: s.boolean().default(true), moderation: s.boolean().default(true),
        }).default({}),
        body: markdown(),
      }),
    },

    /* A TEAM: a group the site can point work at, so a booking type can be the team's rather than
       one person's. The file declares it and never names a member — who is IN it is rows, because a
       declaration names classes of people and never a person. */
    teams: {
      name: 'Team',
      pattern: teamsOn ? 'teams/*.md' : 'teams/__none__/*.md',
      schema: s.object({
        slug: s.path(),
        name: s.string(),
        published: s.boolean().default(true),
        thumb: s.string().optional(),
        position: s.number().default(99),
        /* who it is for, in the grammar a space's membership uses; absent is invitation only */
        fill: s.union([s.record(s.string(), s.any()), s.array(s.record(s.string(), s.any()))]).default({}),
        about: s.markdown(),
      }).transform((d) => ({ ...d, slug: String(d.slug).replace('teams/', '') })),
    },
    spaces: {
      name: 'Space',
      pattern: 'spaces/*.md',
      schema: s.object({
        slug: s.path(),
        name: s.string(),
        kind: s.enum(['staff', 'community', 'server']).default('community'),
        /* the default for the channels under it; a channel's own value wins */
        encrypted: s.boolean().default(false),
        published: s.boolean().default(true),
        /* whether a reader who is not in it is shown that it exists and what it would take */
        discoverable: s.boolean().default(false),
        /* OUT OF THE WAY, NOT OUT OF REACH: it exists and is used — the place an embedded comment
           thread lands — but an ordinary member never browses to it. Left out of the rail, the
           front page and Find a space; shown to staff, who have to be able to moderate a room
           there is otherwise no way into. What may be READ does not change. */
        hidden: s.boolean().default(false),
        /* the one room a new member should read first, by its slug */
        welcome: s.string().optional(),
        /* the picture behind this space where it is shown whole, and the small one beside its name
           in a list. Both addresses like every other file the site holds; without them the surface
           draws a mesh of the space own hue, which is a good answer and not a placeholder. */
        cover: s.string().optional(),
        thumb: s.string().optional(),
        /* where the space sits in everybody column: the heading it is gathered under and its place */
        group: s.string().optional(),
        position: s.number().default(99),
        /* how far back each kind of person may read here */
        history: s.array(s.record(s.string(), s.any())).default([]),
        /* the headings its rooms are gathered under, in the order they are drawn */
        groups: s.array(s.string()).default([]),
        /* ITS OWN PICTURES: a face on the community's front page, and one in a list. A space with
           neither is drawn from its own name, which is a good answer and not a placeholder. */
        cover: s.string().optional(),
        thumb: s.string().optional(),
        /* the badges this space invents. What they are is declared; who wears one is an act. */
        flair: s.array(s.object({
          slug: s.string(),
          name: s.string(),
          colour: s.string().optional(),
          icon: s.string().optional(),
          note: s.string().optional(),
          inline: s.boolean().default(true),
          position: s.number().optional(),
        })).default([]),
        /* HOW SOMEBODY WHO IS NOT IN IT GETS IN. Absent is none: you are in by the fill rule or
           you are not, which is what a staff space wants. open lets anybody signed in walk in;
           request records the ask and lets them in at once; approve makes them wait for a yes.
           Either of the last two may also ask a form of them and hold them to terms. */
        join: s.object({
          how: s.enum(['none', 'open', 'request', 'approve']).default('none'),
          form: s.string().optional(),
          terms: s.string().optional(),
          question: s.string().optional(),
        }).default({ how: 'none' }),
        /* what fills its membership: role (a list of site roles) · tier · entitlement · bought (a sku).
           Absent or empty is invitation only. A SET of conditions must all hold; a LIST of sets is
           the alternatives — "everyone with a live membership, or anyone who coaches" — and is
           written as a list in the markdown, which is why both shapes are read here. */
        fill: s.union([s.record(s.string(), s.any()), s.array(s.record(s.string(), s.any()))]).default({}),
        /* the roles this space invents: what each is called, what colour it wears, where it ranks,
           and what holding it lets somebody do */
        roles: s.array(s.object({
          slug: s.string(), name: s.string(), colour: s.string().optional(),
          rank: s.number().default(0), can: s.array(s.string()).default([]),
        })).default([]),
        /* the grants that are about somebody's standing rather than their role: a capability and
           who has it — everyone · tier:<slug> · role:<slug> · bought:<sku> (with days) */
        grants: s.array(s.object({
          capability: s.string(), to: s.string().default('everyone'),
          days: s.number().optional(), note: s.string().optional(),
        })).default([]),
        body: markdown(),
      }).transform((d) => ({ ...d, slug: d.slug.replace(/^spaces\//, '') })),
    },
    /* A BOT IS A FILE. Who it is, what it may do, who may summon it and what it may spend — and
       its body is its prompt. The site reads these to know which bots exist and where they may be
       summoned; the worker reads the compiled copy the function carries. */
    /* A COMMAND, A TOOL AND A SKILL ARE CONTENT, so they are collections like everything else:
       schema-checked when the content compiles, and — with their models — editable by a site that
       has no checkout. build/bots.mjs compiles them for the worker; this is the content's own view. */
    commands: {
      name: 'Command',
      pattern: 'commands/*.md',
      schema: s.object({
        slug: s.path(),
        name: s.string().optional(),
        hint: s.string().optional(),
        bot: s.string().optional(),
        run: s.string().optional(),
        surfaces: s.array(s.string()).default(['spaces']),
        for: s.union([s.string(), s.record(s.string(), s.any()), s.array(s.any())]).optional(),
        args: s.array(s.record(s.string(), s.any())).default([]),
        published: s.boolean().default(true),
        body: s.raw(),
      }).transform((d) => ({ ...d, name: d.name || d.slug })),
    },
    tools: {
      name: 'Tool',
      pattern: 'tools/*.md',
      schema: s.object({
        slug: s.path(),
        description: s.string().optional(),
        openapi: s.string().optional(),
        module: s.string().optional(),
        base: s.string().optional(),
        operations: s.array(s.string()).default([]),
        headers: s.record(s.string(), s.string()).optional(),
        parameters: s.record(s.string(), s.any()).optional(),
        auth: s.record(s.string(), s.any()).optional(),
        for: s.union([s.string(), s.record(s.string(), s.any()), s.array(s.any())]).optional(),
        published: s.boolean().default(true),
        body: s.raw(),
      }),
    },
    skills: {
      name: 'Skill',
      pattern: 'skills/*.md',
      schema: s.object({
        slug: s.path(),
        name: s.string().optional(),
        /* the one line a bot reads to decide whether to open it: the whole interface of a skill */
        description: s.string(),
        tools: s.array(s.string()).default([]),
        for: s.union([s.string(), s.record(s.string(), s.any()), s.array(s.any())]).optional(),
        published: s.boolean().default(true),
        body: s.raw(),
      }).transform((d) => ({ ...d, name: d.name || d.slug })),
    },
    bots: {
      name: 'Bot',
      pattern: 'bots/*.md',
      schema: s.object({
        slug: s.path(),
        name: s.string(),
        avatar: s.string().optional(),
        model: s.string().optional(),
        published: s.boolean().default(true),
        /* stable offer identity (the product's eight-hex key), not its renameable sku */
        billing: s.string().regex(/^[0-9a-f]{8}$/).optional(),
        /* where it may be summoned: a room, the support desk, a coaching thread */
        surfaces: s.array(s.string()).default(['spaces']),
        /* who may summon it — the same grammar a space's membership is filled by */
        for: s.union([s.string(), s.record(s.string(), s.any()), s.array(s.any())]).optional(),
        spaces: s.array(s.string()).default([]),
        /* what wakes it without being asked: a mention, a schedule, one of the platform's events */
        hears: s.array(s.any()).default([]),
        tools: s.array(s.string()).default([]),
        limits: s.record(s.string(), s.any()).default({}),
        /* `person+recall` adds what this subject has told THIS bot across every conversation, found
           by meaning rather than by recency. It is the only setting that writes anything down. */
        memory: s.enum(['none', 'thread', 'person', 'person+recall']).default('thread'),
        /* HOW IT SOUNDS, where it is spoken to. Only meaningful with the voice surface, and the
           compile refuses it without one — a bot carrying a voice it will never use is a file
           somebody wrote half of. The thing that listens reads these and holds nothing else. */
        voice: s.object({
          by: s.enum(['browser', 'endpoint']).optional(),
          say: s.string().optional(),            /* the provider's name for a voice */
          /* WHAT THE READER MAY CHOOSE FROM, where the site named an endpoint. The kit cannot
             enumerate somebody else's service and must not pretend to — a list baked into the
             kit would be wrong the week the provider adds a voice — so the site says which of
             its endpoint's voices it is happy to offer, and a site that names none offers none.
             The kit's own ten need no declaring: it ships them. */
          voices: s.array(s.string()).optional(),
          greeting: s.string().optional(),       /* what it says first, before anybody has spoken */
          wait: s.number().min(0).max(10).optional(),   /* seconds before a holding line is spoken */
          /* WHICH SHAPE THE ORB IS. The page has always read this and the schema never carried
             it, so velite dropped it on the way through and every assistant got the default
             whatever its file said — a field that reads as working and silently does nothing. */
          visual: s.enum(['aura', 'wave', 'radial', 'grid', 'bar']).optional(),
          /* HOW THE KIT'S OWN ENGINE IS DRIVEN, and only it — an endpoint has its own settings.
             The solver's steps cost very nearly linear time (measured: one sentence took 329ms at
             two and 1077ms at eight), and ONLY THE OPENING PIECE IS EVER WAITED FOR, because the
             rest are made while it plays. So `opening` is the one worth lowering and `steps` is
             what everything after it keeps. `words` is how short the opening tries to be, and
             `gap` the pause between pieces — a chapter's 0.45s is a drawl in a conversation. */
          steps: s.number().min(1).max(32).optional(),
          opening: s.number().min(1).max(32).optional(),
          words: s.number().min(1).max(60).optional(),
          gap: s.number().min(0).max(2).optional(),
        }).optional(),
        /* the bot whose conduct and tools this one starts from — the kit's own desk bot */
        extends: s.string().optional(),
        body: markdown(),
      }).transform((d) => ({ ...d, slug: d.slug.replace(/^bots\//, '') })),
    },
    /* WHAT IS ON. An event happens and is attended; a booking type is booked. A community shows
       both, so both are records, and neither is the other's special case. */
    events: {
      name: 'Event',
      pattern: 'events/*.md',
      schema: s.object({
        slug: s.path(),
        title: s.string(),
        sub: s.string().optional(),
        cover: s.string().optional(),
        published: s.boolean().default(true),
        order: s.number().default(0),
        /* the community it belongs to, and the room it is talked about in */
        space: s.string().optional(),
        channel: s.string().optional(),
        /* who it is for — the same grammar a space's membership is filled by, so a site has one way
           of saying "members of tier two". A plain string is read as a tier, which is how people
           write it. Absent is everybody. */
        for: s.union([s.string(), s.record(s.string(), s.any()), s.array(s.any())]).optional(),
        /* a declaration names classes of people, never a person: which role hosts it */
        host: s.string().optional(),
        /* where it happens: a huddle in one of this site's rooms, a link, or somewhere real */
        where: s.union([s.string(), s.record(s.string(), s.any())]).optional(),
        capacity: s.number().optional(),
        /* WHAT A PLACE COSTS, where one is sold: `price`, `currency`, and optionally the `sku` and
           `key` the offer is known by. The catalog turns it into an offer like any other, because a
           page that asks for money against a sku the checkout has never heard of is refused at the
           till. The schema left this out, so a priced event compiled with no cost at all and was
           never sold — the offer the catalog means to make was never made. */
        cost: s.record(s.string(), s.any()).optional(),
        /* true or false as it always was, or a block saying HOW the asking works — the answers
           offered, whether a reason is asked for, which answer counts as going (build/events.mjs
           `rsvpOf`). The schema said boolean alone, so an event that used the block never
           reached the bundle at all. */
        rsvp: s.union([s.boolean(), s.record(s.string(), s.any())]).default(true),
        /* one of the two: a moment, or a rule that makes many (lib/recurrence.js reads it) */
        starts: s.string().optional(),
        ends: s.string().optional(),
        zone: s.string().optional(),
        repeats: s.record(s.string(), s.any()).optional(),
        body: markdown(),
      }).transform((d) => ({ ...d, slug: d.slug.replace(/^events\//, '') })),
    },
    channels: {
      name: 'Channel',
      pattern: 'spaces/*/*.md',
      schema: s.object({
        slug: s.path(),
        name: s.string(),
        topic: s.string().optional(),
        mode: s.enum(['stream', 'forum', 'feed']).default('stream'),
        visibility: s.enum(['open', 'private']).default('open'),
        /* READ ONLY ON THE DEVICES OF THE PEOPLE IN IT. A switch and never a key, an algorithm or
           a version: what cipher a room uses is not a site's decision. Unset here, the space's
           answer stands (encryptedOf in spaces-io.mjs is the one resolution). */
        encrypted: s.boolean().optional(),
        published: s.boolean().default(true),
        order: s.number().default(99),
        /* the heading it sits under, one its space declares */
        group: s.string().optional(),
        /* a picture for the room where one is shown whole, and a small one beside its name */
        cover: s.string().optional(),
        thumb: s.string().optional(),
        /* the platform's own events written into this room */
        hears: s.array(s.string()).default([]),
        grants: s.array(s.object({
          capability: s.string(), to: s.string().default('everyone'),
          days: s.number().optional(), note: s.string().optional(),
        })).default([]),
        body: markdown(),
      }).transform((d) => { const p = d.slug.replace(/^spaces\//, ''); const i = p.indexOf('/'); return { ...d, slug: p, space: i > 0 ? p.slice(0, i) : '', channel: i > 0 ? p.slice(i + 1) : p } }),
    },
    sessions: {
      name: 'Session',
      pattern: 'sessions/*.md',
      schema: s.object({
        slug: s.path(),
        title: s.string(),
        sub: s.string().optional(),
        price: s.string().optional(),
        url: s.string().optional(),               /* a cal.com booking page, for a type cal.com schedules */
        scheduler: s.enum(['native', 'cal']).optional(),   /* who schedules it: absent = cal.com when a url is set, else the site's own */
        duration: s.number().default(0),          /* minutes, for a type the site schedules */
        /* WHO GIVES IT. An email is a host on the ordinary terms; a row says how the rota treats
           them — `priority` 0…4 (2 by default), `weight` a percentage (100), `fixed` for somebody
           who comes to EVERY booking whoever else takes it. A type that names a team and no hosts
           takes the team's members on the ordinary terms. */
        hosts: s.array(s.union([s.string(), s.object({ email: s.string(), priority: s.number().optional(), weight: s.number().optional(), fixed: s.boolean().optional() })])).default([]),
        team: s.string().optional(),              /* a team whose members give it, where `hosts` names none */
        /* HOW A BOOKING IS SHARED between them: one host takes it (the rota, which is what a single
           host also is), everybody comes, or each member is given a copy of the type at their own
           address. */
        assign: s.enum(['one', 'round-robin', 'collective', 'managed']).optional(),
        seats: s.number().default(0),             /* a group session: how many share one time; 0 = one-to-one */
        buffer: s.number().default(0),            /* minutes of breathing room around it (the host's own hours add theirs) */
        schedule: s.string().optional(),          /* a host's SET of hours by name; a host who keeps no such set is read at their default */
        /* THE GRID OF TIMES IT SHOWS, and how far ahead it takes bookings. A type that wants its
           calls on the hour says so once here rather than having every host write it into their
           week — and a type that must not be booked eight months out says how far. */
        interval: s.number().optional(),          /* minutes between the starts it offers (15 by default) */
        offset: s.number().optional(),            /* minutes into each stretch of hours the grid begins */
        window: s.union([
          s.number(),                             /* a rolling window: this many days ahead */
          s.object({ from: s.string().optional(), to: s.string().optional() }),   /* or between two dates */
        ]).optional(),
        /* HOW MANY, AND HOW MUCH — the type's own caps, counted over what it already holds. A cap is
           reached, not approached: a day already at its count offers nothing more that day, whoever
           is free. 0 or absent is no cap. */
        /* A RUN OF SESSIONS, booked at once. `repeat` is the READER booking several — six weekly
           sittings, say — which is a different thing from `repeats`, where the TYPE happens at a
           fixed time whether anybody books or not. `count` how many, `every` how far apart, and
           `most` the largest run somebody may ask for (the count by default). */
        repeat: s.object({
          count: s.number(),
          every: s.enum(['week', 'month', 'year']).default('week'),
          most: s.number().optional(),
        }).optional(),
        /* SEVERAL LENGTHS TO CHOOSE FROM. A number is a length in minutes at the type's own price; a
           row is a length with a price of its own, for a type that is paid at the length chosen.
           The FIRST is the default, and `duration` stays what the type is when nobody chooses. */
        lengths: s.array(s.union([s.number(), s.object({ minutes: s.number(), price: s.string().optional(), sku: s.string().optional() })])).optional(),
        /* WHAT THE BOOKING IS CALLED, where the type's own title is not what belongs in a calendar.
           {reader}, {host}, {type} and {length} are filled from the booking itself. */
        name: s.string().optional(),
        /* WHETHER IT WAITS FOR THE HOST'S WORD. `true` always; `'notice'` only inside the minimum
           notice, which is the one most hosts want — a booking three weeks out is fine, one
           tomorrow morning needs a look. A booking that waits is `pending`: it HOLDS the time from
           the moment it is made, because a time somebody is waiting on is not a time to offer
           anybody else. */
        confirm: s.union([s.boolean(), s.literal('notice')]).optional(),
        /* QUESTIONS ON THE WAY IN — a published form's slug. Its runner comes between the time and
           the confirmation, and what they answer is a form response like any other, so the desk
           reads it where it reads every other response. A form that is gone or unpublished asks
           nothing and leaves the type bookable: a booking page that refuses because somebody
           unpublished a questionnaire is worse than one that skips it. */
        form: s.string().optional(),
        /* THE BOOKING PAGE ITSELF — what it shows, what it lets somebody do afterwards, and where
           it sends them. One block, because these are all the same decision said about different
           parts of one page, and having them scattered is how a type ends up hiding the organiser
           but naming them in the confirmation. */
        page: s.object({
          redirect: s.string().optional(),        /* where a booking sends them instead of the confirmation */
          notes: s.boolean().optional(),          /* false: do not ask for anything extra */
          organiser: s.boolean().optional(),      /* false: do not say whose session it is */
          details: s.boolean().optional(),        /* false: do not show the length, the place, the price */
          zone: s.boolean().optional(),           /* false: lock the times to the site's zone, no picker */
          cancel: s.union([s.boolean(), s.literal('notice')]).optional(),      /* false: never; 'notice': not inside the notice */
          reschedule: s.union([s.boolean(), s.literal('notice')]).optional(),  /* the same, for moving */
          past: s.boolean().optional(),           /* true: a past or cancelled booking may still be moved */
          account: s.boolean().optional(),        /* true: only somebody signed in may book it */
          hidden: s.boolean().optional(),         /* true: off every list; reachable by its own address alone */
          /* A GROUP SESSION'S OWN TWO. How many seats are left is a nudge and a warning at once, and
             some hosts want neither; who else is coming is somebody else's name on somebody else's
             screen, so it is off unless the host says. */
          seatsLeft: s.boolean().optional(),
          attendees: s.boolean().optional(),
        }).optional(),
        limits: s.object({
          day: s.number().optional(), week: s.number().optional(), month: s.number().optional(), year: s.number().optional(),
          minutesDay: s.number().optional(), minutesWeek: s.number().optional(),
        }).optional(),
        /* When it is bookable, before any host has set their own — so a site deployed from its folder
           offers times on the first day rather than none. A host who sets theirs replaces it: this is
           the default, never a cap. The shape is the one the hours are kept in: a weekday (0 = Sunday)
           to a list of [from, to] in 24-hour time. */
        hours: s.object({
          timezone: s.string().default('UTC'),
          weekly: s.record(s.string(), s.array(s.array(s.string()))).default({}),
        }).optional(),
        /* A TYPE THAT HAPPENS AT A FIXED TIME. Most things are booked "whenever suits us" — the
           host's open hours less what is taken. But a weekly group call happens at seven on Tuesday
           whether anybody books or not, and offering it as an open calendar is both wrong and a lot
           of empty slots. With `repeats`, the type's OCCURRENCES are its bookable times and the
           hours are not asked. The grammar is the one everything else that recurs here uses
           (src/lib/recurrence.js): every / on / at / zone / lasts / interval / until / count / except. */
        repeats: s.record(s.string(), s.any()).optional(),
        notice: s.number().default(24),           /* hours ahead a reader must book, move or cancel */
        where: s.enum(['video', 'link', 'place', 'phone', 'none']).default('none'),   /* where it happens */
        link: s.string().optional(),              /* where: link — the url */
        place: s.string().optional(),             /* where: place — its name */
        address: s.string().optional(),           /*               — its address */
        phone: s.string().optional(),             /* where: phone — the number to call; blank asks the reader for theirs */
        record: s.boolean().default(false),       /* where: video — record the session */
        /* WHO GETS IT: anyone | guest | authenticated | a tier slug | A LIST OF TIER SLUGS.
           A single slug is the shorthand that has always meant "that tier and every higher rank".
           A LIST means exactly those tiers and implies no ladder at all — which is how a space's
           fill already reads one, and is the way to say "tier-1, tier-2 and tier-3" without
           claiming anything about which of them outranks which. */
        requires: s.union([s.string(), s.array(s.string())]).default('guest'),
        below: s.string().optional(),             /* a tier slug: hidden from that tier and up */
        sku: s.string().optional(),               /* a paid session: the offer (a product of kind session) a booking is paid under */
        weekly: s.number().default(0),    /* how many a week the option allows; 0 = unlimited */
        monthly: s.number().default(0),   /* how many a month (30 days) */
        order: s.number().default(99),
        published: s.boolean().default(true),
        raw: s.raw(),
      }).transform((d) => ({ ...d, slug: d.slug.replace(/^sessions\//, '') })),
    },

    /* the site itself: its name, the default description and share image, the
       public address (canonical links and the sitemap), and the social handle.
       One file, edited in the admin under Site. */
    site: {
      name: 'Site',
      pattern: 'site.md',
      single: true,
      schema: s.object({
        name: s.string(),
        tagline: s.string().optional(),
        description: s.string().optional(),
        url: s.string().optional(),
        image: s.string().optional(),
        twitter: s.string().optional(),
        look: s.enum(Object.keys(c.looks).length ? Object.keys(c.looks) : [(c.themeLook && c.themeLook.name) || 'default']).optional(),   /* one of the site's looks (platformkit.config.js); lib/look.js */
        /* THE COLOURS THIS SITE CHANGED, over the look's own. A key is the token
           ("--accent") or the scope and the token ("landing --ink"); a value is a colour for the
           day, or { light, dark } for both. Every one of them is offered in Site settings, read
           from the look's own stylesheet rather than a list — see build/tokens.mjs. Absent means
           the look's own, which is why putting one back is deleting the key. */
        tokens: s.record(s.string(), s.any()).default({}),
        /* THE THREE FACES. A family from the kit's list (build/fonts.mjs), chosen in Site
           settings — never a typed stack: the stack, the weights and the stylesheet url are a
           grammar for the build, and the decision an editor is making is which face. A slot left
           unset is the theme's own, so a site that names none keeps exactly the type it has. */
        fonts: s.object({
          heading: s.string().optional(),
          body: s.string().optional(),
          mono: s.string().optional(),
        }).optional(),
        /* THE LINKS ACROSS THE TOP. Chrome, like the foot of the page below it, and written in the
           same record for the same reason: an administrator edits it. It is the most specific of
           three layers — the theme's own by rule, then the config's `nav`, then this — and the most
           specific that exists is the WHOLE list. Merging was considered and rejected: a merged list
           has no answer to "remove the third item", which is what prompted this.
           An item says what it is called (`label`, a site's own words, markdown like every other
           word on the site — or `key`, naming one of the theme's strings so a built-in stays
           translatable), where it goes, optionally a glyph, optionally whether it highlights for
           everything beneath it, and optionally who sees it. `see` is a rung on the class ladder
           (a MINIMUM, so paid also shows to a subscriber), `guest` (the one exact state, for a Sign
           in item), `tier:<slug>`, or `staff`. At most one item is the call to action. */
        nav: s.array(s.object({
          label: s.string().optional(),
          key: s.string().optional(),
          href: s.string(),
          icon: s.string().optional(),
          prefix: s.boolean().default(false),
          see: s.string().optional(),
          cta: s.boolean().default(false),
        })).optional(),
        /* THE FOOT OF EVERY PAGE. It is chrome, like the header: the same on the store, an
           article, the reader and the landing, so it is the SITE's and not a page's — a footer a
           page had to remember to include is a footer half the pages are missing. The shape is the
           Footer section's, because it IS that section; a page that wants a different one in a
           different place still puts the section in its own markdown, and the layout then draws
           none. Absent, the site simply has no footer, which is what a docs site wants. */
        footer: s.object({
          layout: s.enum(['columns', 'mega', 'minimal']).default('columns'),
          about: s.string().optional(),
          columns: s.array(s.object({ title: s.string(), links: s.array(s.object({ label: s.string(), href: s.string() })).default([]) })).default([]),
          capture: s.record(s.string(), s.any()).default({}),
          social: s.array(s.object({ label: s.string(), href: s.string() })).default([]),
          legal: s.string().optional(),
          small: s.array(s.object({ label: s.string(), href: s.string() })).default([]),
          call: s.record(s.string(), s.any()).default({}),
        }).optional(),
        raw: s.raw(),
      }),
    },

    /* A book's companion: per chapter a summary, an essence and a quiz; for
       the book an insight line and a premise statement in the diagnostic's
       format. One file per book, chapters matched to the book by title. The
       grammar is parsed by build/companion-io.mjs, which the admin and the
       generation script share. */
    companions: {
      name: 'Companion',
      pattern: 'companions/*.md',
      schema: s.object({
        published: s.boolean().default(true),   /* false: kept on disk, edited in the admin, never in the bundle */
        path: s.path(),
        book: s.string(),
        insight: s.string(),
        /* the premise — a statement in an instrument's own format, its area and level — is the instrument's
           (a site's readings ask it); a site with no instrument writes none. An area key as the diagnostic
           files declare them; a premise whose area is not published (or no longer exists) is simply left
           out of the teachings test (data/premises.js), never a failed build */
        statement: s.string().optional(),
        statementArea: s.string().optional(),
        statementLevel: s.enum(['L1', 'L2', 'L3']).optional(),
        generated: s.any().optional(),
        raw: s.raw(),
      }).transform(async (data) => {
        const { chapters } = parseCompanionBody(data.raw.replace(/^---[\s\S]*?\n---\n?/, ''))
        const out = []
        for (const c of chapters) out.push({
          title: c.title, summaryMd: c.summaryMd, summary: c.summaryMd ? await MD.parse(c.summaryMd) : '',
          essence: c.essence, quiz: c.quiz, words: c.summaryMd.split(/\s+/).filter(Boolean).length,
        })
        const words = out.reduce((n, c) => n + c.words, 0)
        /* the body is READ here and not kept: `chapters` is what it parses to, and nothing reads a
           companion's raw markdown (`entry.js` never emitted it either). Returning it too put 764 KB of
           the same words a second time into the chunk every reader of any page loads. */
        const { raw: _body, ...rest } = data
        return { ...rest, id: data.book, chapters: out, summaryWords: words, summaryReadingTime: words ? Math.max(1, Math.round(words / 200)) : 0 }
      }),
    },

    /* Experiments: an A/B test is its own record. It names its kind (pages on
       one route, or ads), its variants — each a key, the page or ad it shows,
       and a weight — its goal, and its verdict. A visitor is dealt a variant at
       random by weight and keeps it; once the experiment ends (`ends`, or two
       weeks after its first exposure) everyone gets the winner: `winner` if an
       editor declared one, else the best conversion rate. `active: false`
       pauses it — everyone sees the first variant. The goal is a path whose
       pageview counts as a conversion; for an ad experiment a blank goal means
       a click on the ad. The body is notes for the team. */
    /* AN ACHIEVEMENT: a thing somebody can do that is worth saying out loud, with a page of its
       own. The rule is an analytics event and what it takes — which is how it stays general: the
       site already records what people do, and nothing here invents a second way of noticing. */
    achievements: {
      name: 'Achievement',
      pattern: 'achievements/*.md',
      schema: s.object({
        published: s.boolean().default(true),
        path: s.path(),
        title: s.string(),
        sub: s.string().optional(),               /* one line, on the badge and under the title */
        icon: s.string().optional(),              /* a glyph name, for the small badge */
        colour: s.string().optional(),
        cover: s.image().optional(),
        /* who may open its page; empty is everyone */
        canAccess: s.array(s.enum(['guest', 'authenticated', 'paid', 'subscribed'])).default([]),
        /* whether it appears on a public profile at all: some are the site's own note */
        shown: s.boolean().default(true),
        order: s.number().default(99),
        /* WHAT EARNS IT. The event is the analytics event type; "where" the props that must agree
           (a subset, so a rule may say nothing about props); "count" how many it takes; "distinct"
           a prop whose DIFFERENT values are counted rather than the rows — eleven books, not one
           book eleven times. */
        when: s.object({
          event: s.string(),
          where: s.record(s.string(), s.any()).default({}),
          count: s.number().default(1),
          distinct: s.string().optional(),
        }),
        /* an audio or video playlist on the page, the same shape an article's media takes */
        media: s.any().optional(),
        body: markdown(),
        raw: s.raw(),
      }).transform(stripCollection('achievements')),
    },
    /* WHAT THE SITE TAKES AN EVENT TO MEAN ABOUT SOMEBODY. One file, because a trait is one line
       and fifty of them in fifty files is a directory nobody reads. */
    traits: {
      name: 'Traits',
      pattern: 'traits.md',
      single: hasFile('traits.md'),
      schema: s.object({
        /* which roles may look at what the site believes about people; an administrator always may */
        visible: s.array(s.string()).default(['admin']),
        rules: s.array(s.object({
          id: s.string(),
          event: s.string(),
          where: s.record(s.string(), s.any()).default({}),
          key: s.string(),
          /* the value, or "prop:<name>" to take it from the event — one rule for every topic */
          value: s.string(),
        })).default([]),
        body: markdown().optional(),
        raw: s.raw(),
      }),
    },
    experiments: {
      name: 'Experiment',
      pattern: 'experiments/*.md',
      schema: s.object({
        path: s.path(),
        title: s.string(),
        kind: s.enum(['page', 'ad']).default('page'),
        active: s.boolean().default(true),
        goal: s.string().optional(),
        ends: s.isodate().optional(),
        winner: s.string().optional(),
        variants: s.array(s.object({
          key: s.string(),
          item: s.string(),                      /* a page or ad id (its file name) */
          weight: s.number().min(0).default(1),
        })).default([]),
        body: markdown(),
        raw: s.raw(),
      }).transform(stripCollection('experiments')),
    },

    /* the storefront itself: its hero (copy, buttons, image, colour scheme) and
       what it shows in what order — one file, so the front of the store is
       arranged in the admin, not in code */
    storefront: {
      name: 'Storefront',
      pattern: 'store/storefront.md',
      single: storeOn,
      schema: s.object({
        heroEyebrow: s.string().optional(),
        heroTitle: s.string(),
        heroSubtitle: s.string().optional(),
        heroImage: s.string().optional(),
        heroTheme: s.enum(['dark', 'light']).optional(),   /* kept for old files; the hero wears the site's ground now */
        heroCta: s.string().optional(),           /* the primary button */
        heroHref: s.string().optional(),
        heroCta2: s.string().optional(),          /* the quiet second button */
        heroHref2: s.string().optional(),
        collections: s.array(s.string()).default([]), /* the tiles, in order (empty = all) */
        featured: s.array(s.string()).default([]),    /* the rail, product ids in order (empty = the flagged ones) */
        shelves: s.array(s.string()).default([]),     /* the collection shelves, in order (empty = all) */
        showMembership: s.boolean().default(true),
        heroBooks: s.array(s.string()).default([]),   /* books shown as printed books in the hero, by slug */
        showEditions: s.boolean().default(true),      /* the band saying what an edition is (words: home.editions) */
        showCollections: s.boolean().default(true),   /* the "shop by collection" tiles */
        showFeatured: s.boolean().default(true),      /* the featured rail */
        showOnline: s.boolean().default(true),        /* the book online as a way to have it: off, the store is the printed books alone */
        /* where the store ships and what it charges (src/lib/shipping.js): a whitelist of
           countries or a blacklist, a default price with per-country overrides, and the
           methods a buyer may choose (the printer's levels; the first is the default) */
        shipping: s.object({
          countries: s.array(s.string().regex(/^[A-Za-z]{2}$/)).optional(),
          exclude: s.array(s.string().regex(/^[A-Za-z]{2}$/)).optional(),
          default: s.number().min(0),
          overrides: s.record(s.string(), s.number().min(0)).optional(),
          methods: s.array(s.object({ level: s.string(), label: s.string(), plus: s.number().min(0).optional(), days: s.string().optional() })).optional(),
        }).optional(),
      }),
    },
    /*
     * A FURTHER PRICE LIST. The offer’s own prices are a list too — the base one, compiled from
     * the product files — so this is not a second mechanism beside them, it is more of the same
     * one. A shop with one currency and no sales never writes one of these and never meets the
     * word; a shop with four currencies and a members’ rate adds files and nothing about the
     * first shop changes.
     */
    prices: {
      name: 'PriceList',
      pattern: 'store/prices/*.md',
      schema: s.object({
        published: s.boolean().default(true),
        path: s.path(),
        title: s.string(),
        /*
         * WHAT KIND OF STATEMENT THIS IS, which is the whole of how a shop says what it means.
         *
         *   override — the price IS this, for whoever matches. A market, a wholesale rate, a
         *              members’ rate. Written as amounts, per sku and shape.
         *   sale     — this much OFF, for whoever matches. Written as `percent` or `off`, never
         *              as a price: it comes off whatever that person’s own price is, so 20% off
         *              gives a member 20% off THEIR rate; and it cannot rot when the product is
         *              re-priced, which an absolute "now $14" silently does.
         */
        kind: s.enum(['sale', 'override']).default('override'),
        status: s.enum(['active', 'draft']).default('active'),
        currency: s.string().default('usd'),
        /* when it is open; neither means always */
        starts: s.isodate().optional(),
        ends: s.isodate().optional(),
        /* a tie between two equally specific lists goes to the higher priority */
        priority: s.number().default(0),
        /* WHO IT IS FOR, as rules rather than a word: every one must hold. The attributes are
           the documented ones — `customer.tiers`, `customer.class`, `item_total`,
           `shipping_address.country` — so a cart-total break and a country price are this same
           mechanism rather than two more features. */
        rules: s.array(s.object({
          attribute: s.string(),
          operator: s.enum(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte']).default('eq'),
          value: s.any(),
        })).default([]),
        /* WHAT THE PRICE IS, per sku and shape, in whole money, optionally banded by quantity.
           Always an amount: a list is a price, never a discount. A percentage or a flat amount
           off is a PROMOTION (content/store/promotions), which applies on top of this. */
        prices: s.array(s.object({
          sku: s.string(),
          variant: s.string().default(''),
          amount: s.number(),
          min_quantity: s.number().optional(),
          max_quantity: s.number().optional(),
        })).default([]),
        body: markdown(),
        raw: s.raw(),
      }).transform(stripCollection('store/prices')),
    },

    /*
     * A DISCOUNT. Separate from the price lists because the two cannot say each other’s thing:
     * a list says "for these people it costs X", a promotion says "take Y off". Medusa keeps
     * them as separate modules for the same reason.
     */
    promotions: {
      name: 'Promotion',
      pattern: 'store/promotions/*.md',
      schema: s.object({
        published: s.boolean().default(true),
        path: s.path(),
        title: s.string(),
        kind: s.enum(['standard', 'buyget']).default('standard'),
        status: s.enum(['active', 'draft', 'inactive']).default('active'),
        /* HOW MUCH COMES OFF, and of what */
        method: s.enum(['percentage', 'fixed']).default('percentage'),
        value: s.number(),
        /* WHAT IT COMES OFF: the lines, the order as a whole, or the shipping. An order-level
           discount is what "£10 off orders over £50" needs, and per-item discounts cannot say it. */
        target: s.enum(['items', 'order', 'shipping']).default('items'),
        /* AND HOW IT IS SPREAD, which a flat amount is meaningless without:
             each   — the value off every line it touches
             across — one value, split between them by each line’s share of the total
             once   — the value off a single line */
        allocation: s.enum(['each', 'across', 'once']).default('each'),
        /* how many units of a line it reaches; absent means all of them */
        max_quantity: s.number().optional(),
        /* what it touches; nothing listed means the whole shop */
        applies: s.array(s.object({ sku: s.string(), variant: s.string().default('') })).default([]),
        starts: s.isodate().optional(),
        ends: s.isodate().optional(),
        /* WHO IT IS FOR. Every rule must hold; none means everybody. This is the ONLY thing that
           decides whether a member gets a public discount — it is never inferred. */
        rules: s.array(s.object({
          attribute: s.string(),
          operator: s.enum(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte']).default('eq'),
          value: s.any(),
        })).default([]),
        /* what it may spend before it stops, and how much it has: a campaign budget */
        budget: s.object({
          kind: s.enum(['spend', 'usage']).default('usage'),
          limit: s.number(),
        }).optional(),
        body: markdown(),
        raw: s.raw(),
      }).transform(stripCollection('store/promotions')),
    },

    collections: {
      name: 'Collection',
      pattern: 'store/collections/*.md',
      schema: s.object({
        published: s.boolean().default(true),   /* false: kept on disk, edited in the admin, never in the bundle */
        path: s.path(),
        title: s.string(),
        subtitle: s.string().optional(),
        image: s.string().optional(),             /* the tile / hero image */
        order: s.number().default(99),
        featured: s.boolean().default(false),
        products: s.array(s.string()).default([]), /* a curated order, by product id */
        body: markdown(),
        raw: s.raw(),
      }).transform(stripCollection('store/collections')),
    },

    books: {
      name: 'Book',
      pattern: 'books/*.md',
      schema: s.object({
        published: s.boolean().default(true),   /* false: kept on disk, edited in the admin, never in the bundle */
        path: s.path(),
        title: s.string(),
        author: s.string().optional(),
        /* a path relative to the book's own markdown, e.g. ./the-kybalion.jpg;
           resized, compressed to webp and hashed into public/static below, so it
           becomes { src, width, height, aspectRatio, blurDataURL } for the UI. */
        cover: s.string().optional(),
        share: s.string().optional(),          /* the share image, when not the generated card */
        description: s.string().optional(),
        introduction: s.string().optional(),   /* markdown: the thesis of the whole book, shown before chapter one in both modes */
        introduced: s.any().optional(),        /* provenance from build/introduce.mjs */
        date: s.isodate().optional(),
        year: s.number().int().optional(),     /* when the book first appeared; the colophon's "first published 1931" */
        difficulty: s.enum(['beginner', 'intermediate', 'advanced']).optional(),  /* reader level */
        canAccess: ACCESS,
        /* the print block: what puts the book on sale in print and as files (src/lib/print-offers.js
           derives the store's page and the catalog's offers; build/print.mjs sets the editions).
           `key` is the offers' identity, given once by the writer or build/product-keys.mjs;
           `rights` must say on what footing the text is printed and sold before the build will
           set it. `formats` says what is sold — hardcover (linen, foil on the spine, a jacket),
           casewrap (the cover printed on the boards), softcover (perfect bound), pdf, epub — each
           with its own `price` as written or `markup`, so many dollars over what the printer
           charges to make one copy (rounded up to the next $5), one or the other; a hardcover's
           `cloth` and `foil` as lists let the buyer choose. `contents` lists what the buyer may
           have in the book (the first is the default); `includes` the files that come with a
           printed copy; `ebook` whether the page mentions the book online. `cloth` and
           `foil` at the top are the defaults, and the cover's palette either way. */
        print: s.object({
          key: s.string().regex(/^[0-9a-f]{8}$/).optional(),
          ebook: s.boolean().default(true),
          main: s.enum(['online', 'softcover', 'hardcover', 'premium', 'casewrap', 'pdf', 'epub']).optional(),   /* the offer the page opens on; the rest behind "see other formats" */
          contents: s.union([s.string(), s.array(s.enum(['both', 'full', 'summary', 'parts']))]).default(['parts']),
          formats: s.record(s.enum(['softcover', 'hardcover', 'premium', 'casewrap', 'pdf', 'epub']), s.union([s.number(), s.object({
            price: s.number().min(0).optional(),
            markup: s.number().min(0).optional(),
            cloth: s.union([s.string(), s.array(s.enum(['navy', 'gray', 'red', 'black', 'tan', 'forest']))]).optional(),
            foil: s.union([s.string(), s.array(s.enum(['gold', 'black', 'white']))]).optional(),
          }).refine((f) => (f.price != null) !== (f.markup != null), { message: 'a format has a price or a markup, one of the two' })])).default({}),
          includes: s.array(s.enum(['pdf', 'epub'])).default([]),
          files: s.array(s.object({ title: s.string().optional(), file: s.string() })).default([]),   /* extra downloads, under content/books/files/<slug>/ */
          cloth: s.enum(['navy', 'gray', 'red', 'black', 'tan', 'forest']).default('black'),
          foil: s.enum(['gold', 'black', 'white']).default('gold'),
          trim: s.enum(['6x9', '5x8']).default('6x9'),
          paper: s.enum(['cream', 'white']).default('cream'),
          spine: s.string().max(40).optional(),    /* a shorter title for the spine and its foil, when the title is long */
          note: s.string().optional(),             /* A Note on This Edition: the publisher's page before the text, written whole */
          blurb: s.string().optional(),            /* the back of the jacket: written for it, under the insight */
          flap: s.string().optional(),             /* the front flap: the book and its author */
          package: s.string().optional(),          /* (old blocks) Lulu's product code — now providers.lulu.package */
          /* who prints each format: lulu | mixam | bookvault, or auto — the cheapest with keys */
          /* the choices are the printers themselves (PRINTER_IDS), never a list written here: a
             fourth printer is one file and its name in that list, and a schema that enumerated them
             again would refuse a book that named it. */
          printers: s.record(s.enum(FORMATS_PRINTED), s.enum([...PRINTER_IDS, 'auto'])).optional(),
          /* each printer's own options, as its module names them (build/print/block.mjs checks them) */
          providers: s.record(s.enum(PRINTER_IDS), s.record(s.string(), s.union([s.string(), s.number(), s.boolean()]))).optional(),
          rights: s.string().optional(),
          /* per contents, the id of the edition a printed proof was read and passed at: an edition is sold only once proofed */
          proofed: s.record(s.enum(['parts', 'full', 'summary', 'both']), s.string().regex(/^[0-9a-f]{16}$/)).optional(),
          currency: s.string().default('usd'),
        }).optional(),
        /* freemium: how many chapters each class may read before the paywall.
           Unset = the whole book for that class. */
        guestChapters: s.number().int().min(0).optional(),
        authenticatedChapters: s.number().int().min(0).optional(),
        paidChapters: s.number().int().min(0).optional(),
        subscribedChapters: s.number().int().min(0).optional(),
        tags: s.array(s.string()).default([]),
        book_id: s.string().optional(),        /* stable friendly id, for topic pins */
        /* which canonical topic slots this book serves — slugs from app/ui/topics.md.
           The reverse of a topic's optional `books:` pin; either side links the two. */
        topics: s.array(s.string()).default([]),
        /* coarse browse themes — slugs from app/ui/concepts.md — the dropdown filters by */
        concepts: s.array(s.string()).default([]),
        /* WHETHER PEOPLE MAY SAY SOMETHING UNDER IT, and where the conversation lives. Off unless
           the file says otherwise, because a site that has not thought about moderation should not
           wake up to a comment section. Written as a word (off · everyone · members · hosts), or as
           a block that also names a forum channel — and then the comments ARE a post in that
           channel: one thread, reachable from here and from the board, moderated with everything
           else the community already moderates.
             comments: members
             comments: { allow: members, space: the-practice, channel: the-books } */
        comments: s.any().optional(),
        raw: s.raw(),                          /* the reader splits this into chapters */
        metadata: s.metadata(),
      }).transform(async (data) => {
        const out = { ...data, slug: data.path.replace('books/', '') }
        /* how many `# ` chapters the reader will split this into — the same split
           it does at read time — so reading progress can be shown wherever a book
           is listed, without shipping the whole text to those surfaces */
        out.chapters = data.raw.split(/^(?=# )/m).filter((s) => s.trim()).length
        /* The spoken book, when build/tts.mjs has made one: its manifest maps a
           chapter title to the recording of the text and of the summary. Read
           here into `audio` (title → { full, summary } as urls), so the reader
           shows a player exactly where a recording exists and nothing where
           none does. */
        out.audio = null
        try {
          const found = await audioManifest(out.slug)
          if (found) {
            const audio = {}
            for (const [title, e] of Object.entries(found.manifest.chapters || {})) {
              const a = {}
              if (e.full && e.full.file) a.full = { src: found.base + e.full.file, seconds: e.full.seconds || null }
              if (e.summary && e.summary.file) a.summary = { src: found.base + e.summary.file, seconds: e.summary.seconds || null }
              if (a.full || a.summary) audio[title] = a
            }
            if (Object.keys(audio).length) out.audio = audio
          }
        } catch (e) { console.warn(`[velite] ${out.slug}: audio manifest unreadable — book kept without audio. ${e.message}`) }
        /* A cover that won't resolve must not take the whole book down with it:
           degrade to no cover (the shelf renders a generated one) and warn loudly,
           rather than throwing and dropping the book from the build entirely. */
        out.coverSource = data.cover || null   /* which picture the cover was made from, so cloud mode's adapter knows when it has changed */
        if (data.cover) {
          try {
            /* the cover by its address (/uploads/…, /…, the bucket's); the old way beside the file still resolves */
            const src = await resolveAsset(data.cover, { fromFile: resolve('content', data.path + '.md') })
            if (!src) throw new Error('no file at that address')
            out.cover = await processCover(src)
          } catch (e) {
            out.cover = null
            console.warn(`[velite] ${out.slug}: cover "${data.cover}" did not resolve — book kept without a cover. ${e.message}`)
          }
        }
        return out
      }),
    },

    /* Forms: a forms.md document each (content/forms/<slug>.md — its settings, slides, fields, conditions
       and bindings in forms.md's own language), read into the kit's model (src/lib/forms/parse.js) for the
       runner, the builder and the function. A document the parser refuses fails the build naming its line;
       `#! published = false` keeps it off the site. With the module off the collection is empty. */
    forms: {
      name: 'Form',
      pattern: formsOn ? 'forms/*.md' : 'forms/__none__/*.md',
      schema: s.object({
        path: s.path(),
        raw: s.raw(),
      }).transform((data, { meta }) => {
        const model = parseForm(data.raw)
        if (model.errors.length) throw new Error(model.errors.map((e) => (e.line ? `line ${e.line}: ` : '') + e.message).join('; '))
        const slug = data.path.replace('forms/', '')
        /* the source lines a block keeps for the builder are not the site's to carry */
        const lean = (b) => { const { raw, ...rest } = b; if (rest.blocks) rest.blocks = rest.blocks.map(lean); return rest }
        const slides = model.slides.map((sl) => { const { raw, head, ...rest } = sl; return { ...rest, blocks: sl.blocks.map(lean) } })
        return { slug, id: slug, title: model.title || slug, published: model.kit.published !== false, warnings: model.warnings, model: { settings: model.settings, kit: model.kit, data: model.data, title: model.title, slides, fields: model.fields.map((f) => ({ name: f.name, kind: f.kind, required: f.required, slide: f.slide, question: f.params.question })) } }
      }),
    },

    /* app UI strings: every reader-facing label, caption, button, prompt and
       explainer paragraph that used to be hardcoded in the components, moved out
       so it is editable in one place. Same `## group / ### key / field` shape as
       the results copy; one file per surface, the `scope` frontmatter says which.
       This is separate from the results-interpretation copy above and never
       touches it. */
    ui: {
      name: 'UIStrings',
      pattern: 'app/ui/**/*.md',
      schema: s.object({
        scope: s.string(),
        title: s.string().optional(),
        raw: s.raw(),
      }).transform((data) => ({ ...data, groups: parseGroups(data.raw) })),   /* the kit's parser; merged over the theme's defaults in prepare */
    },

  },

  /* Nothing unpublished reaches the bundle. Every collection above carries
     `published` (default true); an entry with `published: false` stays on disk
     for the admin (which reads the files, not this output) and is dropped here,
     before .velite is written — so the site, the search index, the prerender, the
     sitemap and the share images never see it. A companion goes with its book. */
  prepare: async (collections) => {
    for (const key of Object.keys(collections)) {
      const c = collections[key]
      if (Array.isArray(c)) collections[key] = c.filter((e) => !e || e.published !== false)
    }
    /* the UI strings: the site's over the theme's defaults, by key — a word the site leaves out is the theme's */
    collections.ui = mergeUi(collections.ui, THEME.strings)
    /* and the three that need no file: an absent one is its default, never an empty list */
    const settle = (key, empty) => { if (Array.isArray(collections[key])) collections[key] = collections[key][0] || empty }
    settle('comments', { kinds: [] })
    settle('community', {})
    settle('traits', { visible: ['admin'], rules: [] })
    if (!storeOn) collections.storefront = (Array.isArray(collections.storefront) && collections.storefront[0]) || { heroTitle: '', collections: [], featured: [], shelves: [], heroBooks: [], showMembership: false, showEditions: false, showCollections: false, showFeatured: false, showOnline: false }
    const live = new Set((collections.books || []).map((b) => b.slug || b.id))
    if (Array.isArray(collections.companions)) collections.companions = collections.companions.filter((c) => live.has(c.book))
    /* WHAT IS PUBLISHED IS WHAT A GUEST MAY READ (_shared/gate.js). Everything velite writes reaches the bundle,
       the pre-rendered pages and both search indexes, so the gated part of a record stops here: a locked
       chapter keeps its title and teaser, a gated page its hero and excerpt, a locked chapter's companion its
       title. A reader with access fetches the rest from reader-content, which reads the source (content-json,
       or the rows), never this. Print, the spoken books and enrichment read the source too. */
    const bySlug = new Map((collections.books || []).map((b) => [b.slug || b.id, b]))
    if (Array.isArray(collections.companions)) collections.companions = collections.companions.map((c) => publicCompanion(c, bySlug.get(c.book)))
    if (Array.isArray(collections.books)) collections.books = collections.books.map(publicBook)
    for (const key of ['articles', 'wiki', 'docs']) if (Array.isArray(collections[key])) collections[key] = collections[key].map(publicPage)
    /* a static site has no server to send the rest to anyone, so its gated text is not published at all: said
       here, by name, rather than discovered by a reader who paid */
    if (c.deployment && c.deployment.backend === false) {
      const held = [
        ...(collections.books || []).filter((b) => typeof b.gatedFrom === 'number').map((b) => `books/${b.slug} (from chapter ${b.gatedFrom + 1})`),
        ...['articles', 'wiki', 'docs'].flatMap((k) => (collections[k] || []).filter((e) => e && e.gated).map((e) => `${k}/${e.id}`)),
      ]
      if (held.length) console.log(`[gate] a static site publishes no gated text — ${held.length} record(s) left out past their free part: ${held.join(', ')}`)
    }
    /* the content models: the parsed records in place of the files, each model's entries in its order and checked —
       required, the rules, unique, a reference that exists, shown-when honoured — with the models scope's words;
       a failing entry refuses the build with its file, its field and the line */
    collections.models = modelsOn ? models : []
    if (modelsOn) {
      const scope = (collections.ui || []).find((u) => u && u.scope === 'models')
      const words = scope ? scope.groups : {}
      const refs = Object.fromEntries(models.map((m) => [m.key, new Set((Array.isArray(collections[collectionName(m.key)]) ? collections[collectionName(m.key)] : [collections[collectionName(m.key)]].filter(Boolean)).map((e) => e.slug))]))
      const faults = []
      for (const m of models) {
        const key = collectionName(m.key)
        const list = Array.isArray(collections[key]) ? collections[key] : collections[key] ? [collections[key]] : []
        for (const e of list) for (const err of checkEntry(m, e, { siblings: list.filter((o) => o !== e), refs, words })) faults.push(`${MODELS_DIR}/${m.key}/${e.slug}.md: ${err.message}`)
        if (Array.isArray(collections[key])) collections[key] = sortEntries(collections[key], m)
      }
      if (faults.length) throw new Error('content models:\n  ' + faults.join('\n  '))
    }
    if (site.prepare) await site.prepare(collections)
    /* A DECLARATION THAT CONTRADICTS ITSELF STOPS THE BUILD. velite refuses a record of the wrong
       SHAPE and exits 0 — it is dropped and the site is built without it — and the deploy runs
       `npm run build` and no tests, so neither a refused record nor an incoherent one would be
       noticed before production. These rules throw, which exits 1, which is the only thing that
       actually makes an invalid declaration undeployable. The site's own collections module may
       add rules and switch kit ones off (build/content-rules.mjs says how). */
    const faults = checkContent(collections, { rules: site.rules, rulesOff: site.rulesOff })
    if (faults.length) throw new Error(report(faults))
  },
  }
}
