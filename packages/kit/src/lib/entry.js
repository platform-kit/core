/*
 * A row of public.content → the entry the components read: the one adapter of cloud mode, the shape velite
 * gives each collection (build/velite.mjs) made in the browser from the row's frontmatter and body — the
 * defaults filled, the id or slug from the path, the body rendered by the shared renderer (lib/markdown.js),
 * the excerpt, the toc and the reading time over it, the grammars the kit keeps pure (the strings' groups,
 * a companion's chapters, a form's model) parsed the same way. What the browser cannot make — a book's cover
 * as the build sized it, its recordings — is kept from the bundle's entry of the same slug; a cover saved in
 * cloud mode is the bucket's url and stands as one. `build/entry.test.mjs` pins the adapter against velite
 * over the demo's files, field for field.
 *
 *   toEntry(collection, row, ctx) → the entry, or null for a row the site does not carry
 *   ctx: { render(md) → html, toc(md), bundle: { [collection]: the built entries }, models: the model records }
 */
import { plain, metadata } from './markdown.js'
import { parseGroups, mergeGroups, stringsHead } from './strings-groups.js'
import { parseCompanionBody } from './companion-body.js'
import { parseForm } from './forms/parse.js'
import { defaultsOf } from './models/entry.js'

const ACCESS = ['guest', 'authenticated', 'paid', 'subscribed']
/* the frontmatter fields each schema names (build/velite.mjs): velite drops the rest, so the adapter does too */
const KEYS = {
  articles: ['published', 'title', 'description', 'date', 'author', 'image', 'share', 'media', 'canAccess', 'tags', 'comments'],
  wiki: ['published', 'title', 'description', 'order', 'tags', 'cover', 'author', 'date', 'updated', 'related', 'media', 'canAccess', 'comments'],
  docs: ['published', 'title', 'description', 'order', 'tags', 'cover', 'author', 'date', 'updated', 'related', 'media', 'canAccess', 'comments'],
  ads: ['published', 'title', 'button', 'href', 'headline', 'image', 'media', 'placement', 'priority', 'audience', 'topics', 'concepts', 'match', 'minTopicViews', 'cooldownHours'],
  products: ['published', 'title', 'subtitle', 'sku', 'key', 'kind', 'billing', 'period', 'price', 'currency', 'trial', 'payments', 'chat-hours', 'sessions', 'book', 'tier', 'rank', 'image', 'gallery', 'collections', 'sizes', 'options', 'variants', 'unsold', 'tracked', 'backorder', 'badge', 'compare', 'rating', 'reviews', 'featured', 'order', 'tags', 'comments'],
  prices: ['published', 'title', 'kind', 'status', 'currency', 'starts', 'ends', 'priority', 'rules', 'prices'],
  promotions: ['published', 'title', 'kind', 'status', 'method', 'value', 'target', 'allocation', 'max_quantity', 'applies', 'starts', 'ends', 'rules', 'budget'],
  pages: ['published', 'title', 'route', 'seoTitle', 'description', 'image', 'sections', 'progress', 'footer', 'owner'],
  sessions: ['title', 'sub', 'price', 'url', 'scheduler', 'repeats', 'duration', 'hosts', 'team', 'assign', 'seats', 'buffer', 'schedule', 'interval', 'offset', 'window', 'repeat', 'lengths', 'name', 'confirm', 'form', 'page', 'limits', 'hours', 'notice', 'where', 'link', 'place', 'address', 'phone', 'record', 'requires', 'below', 'sku', 'weekly', 'monthly', 'order', 'published'],
  site: ['name', 'tagline', 'description', 'url', 'image', 'twitter', 'look', 'tokens', 'fonts', 'nav', 'footer'],
  companions: ['published', 'book', 'insight', 'statement', 'statementArea', 'statementLevel', 'generated', 'quizzed', 'summaryWords', 'gatedFrom'],
  achievements: ['published', 'title', 'sub', 'icon', 'colour', 'cover', 'canAccess', 'shown', 'order', 'when', 'media'],
  experiments: ['title', 'kind', 'active', 'goal', 'ends', 'winner', 'variants'],
  storefront: ['heroEyebrow', 'heroTitle', 'heroSubtitle', 'heroImage', 'heroTheme', 'heroCta', 'heroHref', 'heroCta2', 'heroHref2', 'collections', 'featured', 'shelves', 'showMembership', 'heroBooks', 'showEditions', 'showCollections', 'showFeatured', 'showOnline', 'shipping'],
  collections: ['published', 'title', 'subtitle', 'image', 'order', 'featured', 'products'],
  books: ['published', 'title', 'author', 'cover', 'share', 'description', 'introduction', 'introduced', 'date', 'year', 'difficulty', 'canAccess', 'print', 'guestChapters', 'authenticatedChapters', 'paidChapters', 'subscribedChapters', 'tags', 'book_id', 'topics', 'concepts', 'comments', 'gatedFrom'],
}
const pick = (d, keys) => { const o = {}; for (const k of keys) if (d[k] !== undefined) o[k] = d[k]; return o }
/*
 * A DATE, AS VELITE WRITES IT — a full ISO instant, always.
 *
 * YAML gives an unquoted `date: 2026-08-20` as a Date and a quoted `date: '2026-08-20'` as a
 * string, and velite's isodate normalises both to the same instant. Passing the string through as
 * it was written meant the adapter and the build disagreed about one article for as long as
 * somebody had quoted its date — a difference nothing would ever have explained at the surface.
 * A string that is not a date is left exactly as it is.
 */
const day = (d) => {
  if (d == null) return undefined
  if (d instanceof Date) return d.toISOString()
  const s = String(d)
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(s)) return s
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? s : t.toISOString()
}
const str = (v) => (v == null ? undefined : String(v))
const num = (v, d) => (v == null || v === '' ? d : Number(v))
const bool = (v, d) => (v == null ? d : !!v)
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])
const opt = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o }

/* the fields velite's schemas share: `published` and the frontmatter as it is, typed where velite types it */
function document(d, { dates = ['date', 'updated'], access = true } = {}) {
  const out = { ...d, published: bool(d.published, true) }
  for (const k of dates) if (k in out) out[k] = day(out[k])
  if (access) out.canAccess = d.canAccess == null ? undefined : arr(d.canAccess).filter((x) => ACCESS.includes(x))
  if ('tags' in out || true) out.tags = arr(d.tags).map(String)
  return out
}
/* a rendered body with velite's derived fields: the html, the excerpt, the reading time — and the toc where the collection has one */
function rendered(md, ctx, { length = 200, toc = false, raw = false, optional = false } = {}) {
  const body = optional && !(md || '').trim() ? '' : ctx.render(md || '')
  const text = plain(body)
  const out = { body, excerpt: text.slice(0, length), metadata: metadata(text) }
  if (toc) out.toc = ctx.toc(md || '')
  if (raw) out.raw = md || ''
  return out
}
const id = (path, dir) => String(path || '').replace(/\.md$/, '').replace(dir + '/', '')
/* a cover by its address: the build's sized object while the address is the one it was sized from (velite records
   `coverSource`); else the address as a picture (/uploads/…, the bucket's url — served as it is; a 2:3 guess for the
   shape until the build sizes it); a relative path beside the record (the old way) waits for the deploy */
const coverOf = (d, was) => (!d.cover ? undefined : was.cover && was.coverSource === d.cover ? was.cover : /^(https?:)?\//.test(d.cover) ? { src: d.cover, width: 640, height: 960, aspectRatio: 2 / 3, blurDataURL: '' } : was.cover || null)

export function toEntry(collection, row, ctx) {
  const d = KEYS[collection] ? pick(row.data || {}, KEYS[collection]) : (row.data || {}), md = row.body || '', path = String(row.path || '').replace(/^content\//, '').replace(/\.md$/, '')
  const bundle = (c) => (ctx.bundle && ctx.bundle[c]) || []
  switch (collection) {
    case 'articles': {
      const e = { ...document(d), path, ...rendered(md, ctx), id: id(path, 'articles') }
      delete e.toc; return opt(e)
    }
    case 'wiki': case 'docs': {
      const e = { ...document(d), order: num(d.order, 99), related: arr(d.related), path, ...rendered(md, ctx, { toc: true, raw: true }), id: id(path, collection) }
      e.cover = coverOf(d, bundle(collection).find((x) => x.id === e.id) || {})
      return opt(e)
    }
    case 'ads': {
      const e = { ...document(d, { access: false }), placement: d.placement || 'both', priority: num(d.priority, 0), audience: arr(d.audience), topics: arr(d.topics), concepts: arr(d.concepts), match: d.match || 'any', minTopicViews: num(d.minTopicViews, 0), path, body: ctx.render(md), raw: md, id: id(path, 'ads') }
      delete e.tags; delete e.canAccess; return opt(e)
    }
    case 'products': {
      const e = { ...document(d, { access: false }), billing: d.billing || 'once', currency: d.currency || 'usd', payments: arr(d.payments), sessions: arr(d.sessions).map((r) => ({ type: String((r && r.type) || ''), weekly: num(r && r.weekly, 0), monthly: num(r && r.monthly, 0) })), gallery: arr(d.gallery), collections: arr(d.collections), sizes: arr(d.sizes), options: arr(d.options).map((o) => ({ name: String((o && o.name) || ''), values: arr(o && o.values) })), variants: (d.variants && typeof d.variants === 'object') ? d.variants : {}, unsold: arr(d.unsold), tracked: bool(d.tracked, false), backorder: bool(d.backorder, false), featured: bool(d.featured, false), order: num(d.order, 99), price: num(d.price, 0), path, ...rendered(md, ctx, { length: 160, raw: true }), id: id(path, 'store/products') }
      e.unit_amount = Math.round(e.price * 100); delete e.metadata; delete e.canAccess; return opt(e)
    }
    case 'prices': {
      const rules = (items) => arr(items).map((r) => opt({ attribute: r.attribute, operator: r.operator || 'eq', value: r.value }))
      return opt({
        published: bool(d.published, true), path, title: d.title, kind: d.kind || 'override', status: d.status || 'active',
        currency: d.currency || 'usd', starts: day(d.starts), ends: day(d.ends), priority: num(d.priority, 0), rules: rules(d.rules),
        prices: arr(d.prices).map((p) => opt({
          sku: p.sku, variant: p.variant || '', amount: num(p.amount, 0),
          min_quantity: num(p.min_quantity), max_quantity: num(p.max_quantity),
        })),
        body: ctx.render(md), raw: md, id: id(path, 'store/prices'),
      })
    }
    case 'promotions': {
      const rules = (items) => arr(items).map((r) => opt({ attribute: r.attribute, operator: r.operator || 'eq', value: r.value }))
      return opt({
        published: bool(d.published, true), path, title: d.title, kind: d.kind || 'standard', status: d.status || 'active',
        method: d.method || 'percentage', value: d.value, target: d.target || 'items', allocation: d.allocation || 'each',
        max_quantity: num(d.max_quantity), applies: arr(d.applies).map((a) => opt({ sku: a.sku, variant: a.variant || '' })),
        starts: day(d.starts), ends: day(d.ends), rules: rules(d.rules),
        budget: d.budget ? opt({ kind: d.budget.kind || 'usage', limit: d.budget.limit }) : undefined,
        body: ctx.render(md), raw: md, id: id(path, 'store/promotions'),
      })
    }
    case 'pages': {
      const e = { ...document(d, { access: false }), route: d.route || '/', sections: arr(d.sections), progress: bool(d.progress, false), footer: bool(d.footer, true), ...(d.owner ? { owner: String(d.owner) } : {}), path, body: (md || '').trim() ? ctx.render(md) : '', raw: md, id: id(path, 'pages') }
      delete e.tags; delete e.canAccess; return opt(e)
    }
    case 'achievements': {
      /* what earns it is a record of its own, defaulted the way velite defaults it: a rule with no
         count takes one event, and one with no where matches on the type alone */
      const w = (d.when && typeof d.when === 'object') ? d.when : {}
      const e = { ...document(d, { access: false }), canAccess: arr(d.canAccess), shown: bool(d.shown, true), order: num(d.order, 99),
        when: { event: String(w.event || ''), where: (w.where && typeof w.where === 'object') ? w.where : {}, count: num(w.count, 1), ...(w.distinct ? { distinct: String(w.distinct) } : {}) },
        path, body: ctx.render(md), raw: md, id: id(path, 'achievements') }
      delete e.tags; return opt(e)
    }
    case 'experiments': {
      const e = { ...d, kind: d.kind || 'page', active: bool(d.active, true), ends: day(d.ends), variants: arr(d.variants).map((v) => ({ ...v, weight: num(v.weight, 1) })), path, body: ctx.render(md), raw: md, id: id(path, 'experiments') }
      return opt(e)
    }
    case 'collections': {
      const e = { ...document(d, { access: false }), order: num(d.order, 99), featured: bool(d.featured, false), products: arr(d.products), path, body: ctx.render(md), raw: md, id: id(path, 'store/collections') }
      delete e.tags; delete e.canAccess; return opt(e)
    }
    /* the two blocks velite gives a default INSIDE — a run's `every`, a set of hours' zone and week —
       are filled here too, or a type that leaves one out would read differently in the browser */
    case 'sessions': return opt({ ...d, slug: id(path, 'sessions'), repeats: d.repeats || null, duration: num(d.duration, 0), hosts: arr(d.hosts), seats: num(d.seats, 0), buffer: num(d.buffer, 0), notice: num(d.notice, 24), where: d.where || 'none', record: bool(d.record, false), requires: d.requires || 'guest', weekly: num(d.weekly, 0), monthly: num(d.monthly, 0), order: num(d.order, 99), published: bool(d.published, true),
      repeat: d.repeat ? { ...d.repeat, count: num(d.repeat.count, 0), every: d.repeat.every || 'week' } : undefined,
      hours: d.hours ? { ...d.hours, timezone: d.hours.timezone || 'UTC', weekly: d.hours.weekly || {} } : undefined,
      raw: md })
    /* the footer's own defaults are velite's, so the adapter fills the same ones or the two
       disagree on a site that wrote only the columns */
    /* tokens: the colours this site changed over the look's own, defaulting to none — velite's
       default is {} and a row that has never been edited has no key at all */
    /* fonts: the three faces the site chose, each optional — a slot left unset is the theme's own,
       so the adapter keeps the key off rather than filling it with a name nobody picked */
    /* nav: the header an administrator wrote, each item with velite's own defaults filled — a row
       that says only a label and a path still comes back with prefix and cta false, or the adapter
       and velite disagree on a site that wrote the short form */
    case 'site': return opt({ ...d, tokens: d.tokens || {}, nav: d.nav ? arr(d.nav).map((l) => opt({
      label: l.label, key: l.key, href: l.href, icon: l.icon,
      prefix: bool(l.prefix, false), see: l.see, cta: bool(l.cta, false),
    })) : undefined, fonts: d.fonts ? opt({
      heading: d.fonts.heading, body: d.fonts.body, mono: d.fonts.mono,
    }) : undefined, footer: d.footer ? opt({
      layout: d.footer.layout || 'columns', about: d.footer.about, legal: d.footer.legal,
      columns: arr(d.footer.columns).map((c) => ({ title: c.title, links: arr(c.links) })),
      capture: d.footer.capture || {}, social: arr(d.footer.social), small: arr(d.footer.small), call: d.footer.call || {},
    }) : undefined, raw: md })
    case 'storefront': return opt({ ...d, collections: arr(d.collections), featured: arr(d.featured), shelves: arr(d.shelves), showMembership: bool(d.showMembership, true), heroBooks: arr(d.heroBooks), showEditions: bool(d.showEditions, true), showCollections: bool(d.showCollections, true), showFeatured: bool(d.showFeatured, true), showOnline: bool(d.showOnline, true) })
    case 'companions': {
      const { chapters } = parseCompanionBody(md)
      const out = chapters.map((c) => ({ title: c.title, summaryMd: c.summaryMd, summary: c.summaryMd ? ctx.render(c.summaryMd) : '', essence: c.essence, quiz: c.quiz, words: c.summaryMd.split(/\s+/).filter(Boolean).length }))
      /* a row reader-content cut for a guest (_shared/gate.js) names its quizzed chapters and its whole length,
         so mastery and the summary's reading time are counted over the whole book, not the free chapters */
      const quizzed = new Set(arr(d.quizzed))
      if (typeof d.gatedFrom === 'number') out.forEach((c, i) => { if (i >= d.gatedFrom) out[i] = { title: c.title, gated: true, hasQuiz: quizzed.has(c.title) } })
      const words = typeof d.summaryWords === 'number' ? d.summaryWords : out.reduce((n, c) => n + c.words, 0)
      const rest = { ...d }; delete rest.quizzed; delete rest.gatedFrom
      /* no `raw`: the body is what `chapters` was parsed from, and velite does not keep it either */
      return opt({ ...rest, published: bool(d.published, true), path, id: d.book, chapters: out, summaryWords: words, summaryReadingTime: words ? Math.max(1, Math.round(words / 200)) : 0 })
    }
    case 'books': {
      const slug = id(path, 'books')
      const was = bundle('books').find((b) => b.slug === slug) || {}
      const raw = md
      const e = { ...document(d, { dates: ['date'] }), tags: arr(d.tags), topics: arr(d.topics), concepts: arr(d.concepts), path, raw, metadata: metadata(raw), slug, chapters: raw.split(/^(?=# )/m).filter((s) => s.trim()).length, audio: was.audio || null }
      if (typeof d.gatedFrom === 'number') e.gatedFrom = d.gatedFrom   /* a row reader-content cut for a guest: where the reader asks for the rest */
      if (d.print) e.print = { ebook: true, contents: ['parts'], formats: {}, includes: [], files: [], cloth: 'black', foil: 'gold', trim: '6x9', paper: 'cream', currency: 'usd', ...d.print }
      e.cover = coverOf(d, was)
      return opt(e)
    }
    case 'forms': {
      const model = parseForm(row.text || '')
      if (model.errors.length) return null
      const slug = id(path, 'forms')
      const lean = (b) => { const { raw, ...rest } = b; if (rest.blocks) rest.blocks = rest.blocks.map(lean); return rest }
      const slides = model.slides.map((sl) => { const { raw, head, ...rest } = sl; return { ...rest, blocks: sl.blocks.map(lean) } })
      return { slug, id: slug, title: model.title || slug, published: model.kit.published !== false, warnings: model.warnings, model: { settings: model.settings, kit: model.kit, data: model.data, title: model.title, slides, fields: model.fields.map((f) => ({ name: f.name, kind: f.kind, required: f.required, slide: f.slide, question: f.params.question })) } }
    }
    case 'ui': {
      /* the site's words over the bundle's scope (the theme's defaults with the site's as built): a field the row leaves out stays the default */
      const h = stringsHead(row.text || '')
      const scope = h.scope || d.scope
      if (!scope) return null
      const was = bundle('ui').find((u) => u && u.scope === scope)
      return opt({ scope, title: h.title || str(d.title), raw: md, groups: mergeGroups(was && was.groups, parseGroups(row.text || '')) })
    }
    default: {
      /* a content model's entry: models_<key>, its defaults from the record the bundle carries */
      const m = /^models_(.+)$/.exec(collection)
      if (!m) return null
      const model = (ctx.models || bundle('models')).find((x) => x && x.key === m[1].replace(/_/g, '-')) || (ctx.models || bundle('models')).find((x) => x && x.key.replace(/-/g, '_') === m[1])
      if (!model) return null
      const e = { ...defaultsOf(model), ...d, published: bool(d.published, true), path, slug: path.split('/').pop() }
      if (model.body) { e.body = (md || '').trim() ? ctx.render(md) : ''; e.raw = md }
      return opt(e)
    }
  }
}
/* the collection a row's `collection` and `slug` name in the bundle: velite's `models_<key>` for a model's entry,
   `tests` and the rest as they are; the model records themselves are not adapted (a new model waits for the deploy) */
export function targetOf(row) {
  if (row.collection === 'models') { const i = String(row.slug || '').indexOf('/'); return i > 0 ? 'models_' + row.slug.slice(0, i).replace(/-/g, '_') : null }
  if (row.collection === 'uploads' || row.collection === 'strings' || row.collection === 'tests' || !row.collection) return null
  return row.collection
}
/* where a collection's files live, for a draft the admin previews before it is a row (the store's collectionOf, the other way) */
export function pathOf(collection, name) {
  const dir = { products: 'content/store/products', collections: 'content/store/collections', ui: 'content/app/ui', storefront: 'content/store', site: 'content' }[collection] || ('content/' + collection.replace(/^models_/, 'models/').replace(/_/g, '-'))
  return collection === 'site' ? 'content/site.md' : collection === 'storefront' ? 'content/store/storefront.md' : dir + '/' + name + '.md'
}
