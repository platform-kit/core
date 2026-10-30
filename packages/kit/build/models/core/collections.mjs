/*
 * The twelve core collections as models of the registry — the zod each drawer is drawn from (a field's
 * .meta() carries its label, widget, help and whether it is a grid column; describeSchema reads them), the
 * directory, the title field, where uploads go, and the parts the admin server used to carry inside its
 * file endpoint: a product's and a print block's key given once, a book's spine checked, a companion
 * checked against its book and written in the canonical grammar, a page's sections validated against the
 * theme's schemas, an experiment's variants against the pages or ads they name.
 */
import { z } from 'zod'
import matter from 'gray-matter'
import { parseCompanion, serialiseCompanion, validateCompanion, bookChapterTitles } from '../../companion-io.mjs'
import { spineWords, SPINE_MAX } from '../../../src/lib/print-offers.js'
import { printWords, SPINE_EDITION } from '../../print/words.mjs'
import { DUMP, NAME_RE, cleanData, frontmatter, Refusal } from '../util.mjs'

/* an offer's key, a print block's key: eight hex characters, given once, never edited (build/product-keys.mjs) */
const HEX8 = /^[0-9a-f]{8}$/
async function giveKey(store) { const { newKey, usedKeysOf } = await import('../../product-keys.mjs'); return newKey(await usedKeysOf(store)) }
/* a field the form left empty arrives as null; write nothing rather than `key: null` */
const dropNulls = (v) => (Array.isArray(v) ? v.map(dropNulls) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, dropNulls(x)])) : v)

/* an experiment against the things it names: every variant a unique key and an existing page or ad; page
   variants on one route; the winner one of the keys. [{ path, message }], empty when fine. */
async function validateExperiment(data, field, store) {
  const issues = []
  const vs = data[field]
  if (vs == null) return issues
  if (!Array.isArray(vs)) return [{ path: field, message: 'must be a list of variants' }]
  const kind = data.kind === 'ad' ? 'ads' : 'pages'
  const dir = kind === 'ads' ? 'content/ads' : 'content/pages'
  const keys = new Set(), routes = new Set()
  /* a page somebody OWNS: a coach may test one thing against one other thing, and no more. Three
     variants on a page one person is answering for is a test nobody has the traffic to settle. */
  let owned = false
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i] || {}, at = field + '.' + i
    if (!v.key || !String(v.key).trim()) issues.push({ path: at + '.key', message: 'a variant needs a key (A, B, C …)' })
    else if (keys.has(v.key)) issues.push({ path: at + '.key', message: `"${v.key}" is used twice` })
    keys.add(v.key)
    if (!v.item) { issues.push({ path: at + '.item', message: 'choose the ' + (kind === 'ads' ? 'ad' : 'page') + ' this variant shows' }); continue }
    let raw = null
    try { if (NAME_RE.test(String(v.item))) raw = await store.read(dir + '/' + v.item + '.md') } catch { /* missing or bad name */ }
    if (raw == null) { issues.push({ path: at + '.item', message: `no ${kind === 'ads' ? 'ad' : 'page'} called "${v.item}"` }); continue }
    if (kind === 'pages') { const fm = matter(raw).data; routes.add(fm.route || '/'); if (fm.owner) owned = true }
    if (v.weight != null && !(Number(v.weight) >= 0)) issues.push({ path: at + '.weight', message: 'weight must be 0 or more' })
  }
  if (routes.size > 1) issues.push({ path: field, message: 'the pages of one experiment must share a route (' + [...routes].join(', ') + ')' })
  if (owned && vs.length > 2) issues.push({ path: field, message: 'a page somebody owns is tested two ways at a time, not ' + vs.length })
  if (data.winner && !keys.has(data.winner)) issues.push({ path: 'winner', message: `"${data.winner}" is not one of the variants` })
  return issues
}

/* who may open a document — a subset of the class ladder; empty = everyone */
const ACCESS = z.array(z.enum(['guest', 'authenticated', 'paid', 'subscribed']))
  .meta({ label: 'Access', help: 'who can open this — leave empty for everyone. Gated content needs a backend: on a static site, gated text isn\'t published at all.' }).optional()
/*
 * WHO MAY SAY SOMETHING UNDER THIS, and where the conversation lives.
 *
 * The value is a word or a block naming a space and a room (build/comments-push.mjs reads it), and
 * the admin never shows either: it is a select and two pickers, because somebody asked to type
 * `{ allow: members, space: …, channel: … }` will get it wrong and the site will quietly take no
 * comments. The two pickers appear only once somebody may comment at all, and offer the site's own
 * spaces and its FORUM rooms — a stream is not a thread and cannot hold one.
 *
 * Off is the default, everywhere, because a site that has not thought about moderation should not
 * wake up to a comment section.
 */
const COMMENTS = z.any().meta({
  label: 'Comments', widget: 'group', kind: 'group',   /* the kind is what carries `fields` to the client (admin-schemas.mjs); widget alone drops them */
  help: 'off unless you say otherwise; a book is commented on a chapter at a time',
  fields: [
    { key: 'allow', label: 'Who may comment', kind: 'select', choices: [
      { value: 'off', label: 'Nobody — comments are off' },
      { value: 'everyone', label: 'Anybody signed in' },
      { value: 'members', label: 'Members' },
      { value: 'hosts', label: 'Hosts and staff' },
    ] },
    { key: 'space', label: 'Space', kind: 'reference', options: 'comment-spaces', shown: { field: 'allow', is: 'in', value: ['everyone', 'members', 'hosts'] },
      help: 'leave both blank and the conversation stays on this page; name a room and it IS a post there — one thread, two ways in' },
    { key: 'channel', label: 'Room', kind: 'reference', options: 'comment-channels', shown: { field: 'allow', is: 'in', value: ['everyone', 'members', 'hosts'] } },
    /* WHETHER WHAT IS SAID APPEARS AT ONCE. Trust is a standing the site can already answer —
       staff, a live membership, a paid purchase, an author released before — so nothing here reads
       a word anybody wrote. The site's flagged list holds a comment on top of this, whoever
       wrote it, and is edited in Settings → Comments rather than per record. */
    { key: 'approval', label: 'Appears', kind: 'select', shown: { field: 'allow', is: 'in', value: ['everyone', 'members', 'hosts'] }, choices: [
      { value: 'none', label: 'At once' },
      { value: 'trusted', label: 'At once from people we know — the rest wait' },
      { value: 'all', label: 'Everything waits for a moderator' },
    ], help: "blank takes the site's own answer (Settings → Comments)" },
    { key: 'reactions', label: 'Reactions', kind: 'boolean', shown: { field: 'allow', is: 'in', value: ['everyone', 'members', 'hosts'] }, help: 'an emoji on a comment' },
    { key: 'votes', label: 'Voting', kind: 'boolean', shown: { field: 'allow', is: 'in', value: ['everyone', 'members', 'hosts'] },
      help: 'up and down, one per person. Off by default: a score changes what people write as well as what they read' },
  ],
}).optional()

const CHAPTERS = (label) => z.number().int().min(0).meta({ label, half: true, help: 'before the paywall; blank = all' }).optional()

/* the front page's switches and the features, in one place: the parse fills a default for each and
   the fields below draw one control each. Adding a switch means adding it here and there, which is
   two lines and a diff anybody can read. */
const COMMUNITY_HOME = ['greeting', 'facts', 'compose', 'events', 'people']
const COMMUNITY_FEATURES = ['events', 'huddles', 'polls', 'voice', 'files', 'tickets', 'forum', 'moderation']

/*
 * WHAT CAN BE EARNED, AND WHAT AN EVENT MEANS — projected on a publish.
 *
 * Both the achievements and the trait rules come out of the same pass (build/achievements-push.mjs,
 * which takes a store and a database and needs nothing else), so the two models share it. On a
 * checkout the script runs on save; over rows a save is a draft and moves nothing, and the publish
 * is the act — which is the only way either becomes a row where nothing rebuilds.
 *
 * Nothing it writes is anybody's badge. Those are acts, written by the trigger on the event stream,
 * and a projection has no business rewriting somebody's past.
 */
async function onAwardWrite(ctx) {
  if (ctx.store && ctx.store.kind === 'rows') return
  await ctx.script('achievements-push.mjs').catch((e) => console.warn('achievements: not projected — ' + e.message))
}
async function projectedAwards(ctx) {
  const db = ctx.store && ctx.store.kind === 'rows' ? ctx.store.client : null
  if (!db) return
  const { pushAchievements } = await import('../../achievements-push.mjs')
  await pushAchievements({ store: ctx.store, db, quiet: true })
}

/*
 * THE SEARCH INDEX, REBUILT ON A PUBLISH.
 *
 * content_search is what a bot searches, and on a machine it is built from .velite. In a deployment
 * where nothing rebuilds there is no .velite and never will be again, so the index it shipped with
 * is the last one it has: an article published there is invisible to every bot, and nothing says
 * so. build/search-db.mjs rebuilds the collections from the content rows through the same adapter
 * the browser uses (src/lib/entry.js) and writes the index — no filesystem, so a publish can run it.
 *
 * It hangs on all four collections the index is drawn from, because publishing any one of them
 * changes what a search should find.
 */
async function projectedSearch(ctx) {
  const db = ctx.store && ctx.store.kind === 'rows' ? ctx.store.client : null
  if (!db) return
  const { projectSearchFromStore } = await import('../../search-db.mjs')
  await projectSearchFromStore(ctx.store)
}

export const COLLECTIONS = {
  books: {
    name: 'Books', dir: 'content/books', body: true, title: 'title',
    projected: projectedSearch,
    assets: { dir: 'content/uploads/books' },   /* where an upload for a record lands; the field holds its address */
    bodyLabel: 'Chapters',
    fields: z.object({
      title: z.string().min(1).meta({ label: 'Title', grid: true }),
      author: z.string().meta({ label: 'Author', grid: true }).optional(),
      difficulty: z.enum(['beginner', 'intermediate', 'advanced']).meta({ label: 'Difficulty', grid: true, help: 'the reader level this book suits' }).optional(),
      canAccess: ACCESS,
      comments: COMMENTS,
      print: z.any().meta({ label: 'In print', widget: 'print', help: 'the printed editions and files, edited on their own page' }).optional(),
      guestChapters: CHAPTERS('Free chapters — guest'),
      authenticatedChapters: CHAPTERS('Free chapters — signed in'),
      paidChapters: CHAPTERS('Free chapters — paid'),
      subscribedChapters: CHAPTERS('Free chapters — member'),
      description: z.string().meta({ label: 'Description', widget: 'text' }).optional(),
      introduction: z.string().meta({ label: 'Introduction', widget: 'text', help: 'markdown — the thesis of the whole book, shown before the first chapter in the full text and the summary; written by build/introduce.mjs, edited here' }).optional(),
      cover: z.string().meta({ label: 'Cover image', widget: 'image', help: 'the shelves, the reader and the print draw it; a file in the library' }).optional(),
      share: z.string().meta({ label: 'Share image', widget: 'image', help: 'what a link to this book shows on social networks and in chats; blank uses the card the build draws from the cover, author and title' }).optional(),
      date: z.string().meta({ label: 'Date', widget: 'date' }).optional(),
      book_id: z.string().meta({ label: 'Book id' }).optional(),
      published: z.boolean().meta({ label: 'Published', grid: true }).optional(),
      fullText: z.boolean().meta({ label: 'Publish the full text', help: 'off: only the summaries are published, and the text is sent to nobody; keep the text here only while its summaries are written' }).optional(),
      tags: z.array(z.string()).meta({ label: 'Tags', widget: 'tags', options: 'tags', help: 'what this is about — chosen from the site\'s list under Tags' }).optional(),
      categories: z.array(z.string()).meta({ label: 'Categories' }).optional(),
      topics: z.array(z.string()).meta({ label: 'Topics', grid: true, widget: 'multiselect', options: 'topics', help: 'the recommendation categories this book serves' }).optional(),
      concepts: z.array(z.string()).meta({ label: 'Concepts', widget: 'multiselect', options: 'concepts', help: 'the coarse browse themes' }).optional(),
    }),
  },

  /* a book's companion — summaries, essences, quizzes, the insight and the
     premise statement. The body is edited by chapter like the book itself. */
  companions: {
    name: 'Companions', dir: 'content/companions', body: true, title: 'book',
    assets: { dir: 'content/uploads/companions' },   /* where an upload for a record lands; the field holds its address */
    bodyLabel: 'Companion',   /* edited by CompanionEditor.vue: the book's chapters, each a summary, an essence and a quiz */
    fields: z.object({
      published: z.boolean().meta({ label: 'Published', grid: true, help: 'off = kept in the backend, but not live' }).optional(),
      book: z.string().min(1).meta({ label: 'Book', grid: true, widget: 'select', options: 'books', help: 'the book this companion belongs to' }),
      insight: z.string().min(1).meta({ label: 'Insight', widget: 'text', grid: true, help: 'one or two lines: what the reader can do or see on the far side of the book — shown wherever it is recommended' }),
      /* the premise: one sentence, asked in the teachings (books) test and nowhere else. Its
         area and level are for that test alone — the area is the switch (the sentence is asked
         only while that diagnostic area is published) and the level is kept with the answer;
         neither has anything to do with where the book is recommended (that is the book's
         own `topics`, set in Recommendations) */
      statement: z.string().min(1).meta({ label: 'Premise', widget: 'text', help: 'one sentence, first person, present tense, that someone who has integrated the book can say without flinching — asked in the teachings quiz; a flinch recommends the book, none means it is already theirs' }),
      statementArea: z.string().min(1).meta({ label: 'Premise area', grid: true, widget: 'select', options: 'areas', help: 'teachings quiz only: the premise is asked while this diagnostic area is published. Where the book is recommended is set in Recommendations, not here' }),
      statementLevel: z.enum(['L1', 'L2', 'L3']).meta({ label: 'Premise level', grid: true, help: 'teachings quiz only: how far along the path the sentence sits — L1 material fact · L2 between selves · L3 Spirit' }),
      /* `generated` (model, date, per-chapter hashes) is not modelled: it rides through untouched */
    }),
  },

  articles: {
    name: 'Articles', dir: 'content/articles', body: true, title: 'title',
    projected: projectedSearch,
    assets: { dir: 'content/uploads/articles' },   /* where an upload for a record lands; the field holds its address */
    bodyLabel: 'Article body (markdown)',
    fields: z.object({
      published: z.boolean().meta({ label: 'Published', grid: true, help: 'off = kept in the backend, but not live' }).optional(),
      title: z.string().min(1).meta({ label: 'Title', grid: true }),
      description: z.string().meta({ label: 'Description / subtitle', widget: 'text' }).optional(),
      author: z.string().meta({ label: 'Author', grid: true }).optional(),
      date: z.string().meta({ label: 'Date', grid: true, widget: 'date' }).optional(),
      image: z.string().meta({ label: 'Cover image', widget: 'image' }).optional(),
      share: z.string().meta({ label: 'Share image', widget: 'image', help: 'what a link to this piece shows on social networks and in chats; blank uses the card the build draws from the title over the cover' }).optional(),
      tags: z.array(z.string()).meta({ label: 'Tags', grid: true, widget: 'tags', options: 'tags', help: 'what this is about — chosen from the site\'s list under Tags' }).optional(),
      media: z.any().meta({ label: 'Media', widget: 'media', help: 'one track plays inline; two or more become a playlist' }).optional(),
      canAccess: ACCESS,
      comments: COMMENTS,
    }),
  },

  wiki: {
    name: 'Wiki', dir: 'content/wiki', body: true, nested: true, title: 'title',
    projected: projectedSearch,
    assets: { dir: 'content/uploads/wiki' },   /* where an upload for a record lands; the field holds its address */
    bodyLabel: 'Page body (markdown)',
    fields: z.object({
      published: z.boolean().meta({ label: 'Published', grid: true, help: 'off = kept in the backend, but not live' }).optional(),
      title: z.string().min(1).meta({ label: 'Title', grid: true }),
      description: z.string().meta({ label: 'Description', widget: 'text' }).optional(),
      order: z.number().meta({ label: 'Order', grid: true }).optional(),
      author: z.string().meta({ label: 'Author', grid: true }).optional(),
      date: z.string().meta({ label: 'Date', widget: 'date' }).optional(),
      updated: z.string().meta({ label: 'Updated', widget: 'date' }).optional(),
      cover: z.string().meta({ label: 'Cover image', widget: 'image' }).optional(),
      tags: z.array(z.string()).meta({ label: 'Tags', grid: true, widget: 'tags', options: 'tags', help: 'what this is about — chosen from the site\'s list under Tags' }).optional(),
      related: z.array(z.string()).meta({ label: 'Related (slugs)' }).optional(),
      media: z.any().meta({ label: 'Media', widget: 'media', help: 'one track plays inline; two or more become a playlist' }).optional(),
      canAccess: ACCESS,
      comments: COMMENTS,
    }),
  },

  ads: {
    name: 'Ads', dir: 'content/ads', body: true, title: 'title',
    assets: { dir: 'content/uploads/ads' },   /* where an upload for a record lands; the field holds its address */
    bodyLabel: 'Ad text (markdown) — reader-facing copy under the headline in the modal and inline card; the footer shows the headline and button only',
    fields: z.object({
      published: z.boolean().meta({ label: 'Published', grid: true, help: 'off = kept in the backend, never shown; the one switch an ad has' }).optional(),
      title: z.string().min(1).meta({ label: 'Name (internal)', grid: true }),
      button: z.string().min(1).meta({ label: 'Button text', grid: true }),
      href: z.string().meta({ label: 'Button link', help: 'a path like /store, or a full URL' }).optional(),
      headline: z.string().meta({ label: 'Headline' }).optional(),
      image: z.string().meta({ label: 'Image', widget: 'image' }).optional(),
      media: z.any().meta({ label: 'Video', widget: 'media', help: 'an optional video or audio track' }).optional(),
      placement: z.enum(['modal', 'inline', 'both', 'footer']).meta({ label: 'Placement', grid: true, help: 'modal = popup / corner card on any page; inline = the card at the foot of articles; both = modal and inline; footer = the closing section under a page (headline, button, link)' }).optional(),
      priority: z.number().int().meta({ label: 'Priority', help: 'higher wins when several match' }).optional(),
      audience: z.array(z.enum(['guest', 'authenticated', 'paid', 'subscribed'])).meta({ label: 'Audience', grid: true, help: 'who should see it — empty = everyone' }).optional(),
      topics: z.array(z.string()).meta({ label: 'Topics', widget: 'multiselect', options: 'topics', help: 'show to readers whose results or reading point here' }).optional(),
      concepts: z.array(z.string()).meta({ label: 'Concepts', widget: 'multiselect', options: 'concepts' }).optional(),
      match: z.enum(['any', 'all']).meta({ label: 'Topic match', help: 'any listed topic, or all of them' }).optional(),
      minTopicViews: z.number().int().min(0).meta({ label: 'Min. matching views', help: 'only once the reader has opened this many matching pieces' }).optional(),
      cooldownHours: z.number().min(0).meta({ label: 'Cooldown (hours)', help: 'how long to wait before showing it to the same reader again' }).optional(),
    }),
  },

  /*
   * A FURTHER PRICE LIST. The shop’s own prices are a list too, compiled from the products, so
   * this edits the OTHER ones: a sale, a members’ rate, a second currency. Nobody types a rule
   * as a string — an attribute is chosen, an operator is chosen, and a value is a field.
   */
  prices: {
    name: 'Price lists', dir: 'content/store/prices', body: true, title: 'title',
    bodyLabel: 'What this list is for (markdown) — for whoever reads it next, never shown to a buyer',
    fields: z.object({
      published: z.boolean().meta({ label: 'Published', grid: true, help: 'off = kept, not applied' }).optional(),
      title: z.string().min(1).meta({ label: 'Title', grid: true }),
      kind: z.enum(['sale', 'override']).meta({ label: 'Kind', grid: true, help: 'an override IS the price and always wins; a sale is a lower price, taken only where it is lower, with the usual one struck through' }).default('override'),
      status: z.enum(['active', 'draft']).meta({ label: 'Status', grid: true }).default('active'),
      currency: z.string().meta({ label: 'Currency', help: 'usd, gbp, eur — a list prices in one' }).default('usd'),
      starts: z.string().meta({ label: 'Starts', kind: 'datetime', half: true, help: 'leave empty for “already”' }).optional(),
      ends: z.string().meta({ label: 'Ends', kind: 'datetime', half: true, help: 'leave empty for “until it is unpublished”' }).optional(),
      priority: z.number().meta({ label: 'Priority', half: true, help: 'which wins where two lists are equally specific' }).optional(),
      /* WHO IT IS FOR. Every rule must hold; a list with none is for everybody. */
      rules: z.array(z.object({
        attribute: z.enum(['customer.class', 'customer.tiers', 'item_total', 'shipping_address.country']).meta({ label: 'What' }),
        operator: z.enum(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte']).meta({ label: 'Is' }).default('eq'),
        value: z.string().meta({ label: 'This' }),
      })).meta({ label: 'Who it is for', widget: 'rows', kind: 'list', of: 'group', fields: [{ key: 'attribute', label: 'What', kind: 'select', choices: [{ value: 'customer.class', label: 'The customer is' }, { value: 'customer.tiers', label: 'Their membership' }, { value: 'item_total', label: 'The basket total (pence)' }, { value: 'shipping_address.country', label: 'Shipping to' }] }, { key: 'operator', label: 'Is', kind: 'select', choices: [{ value: 'eq', label: 'exactly' }, { value: 'ne', label: 'not' }, { value: 'in', label: 'one of' }, { value: 'gte', label: 'at least' }, { value: 'gt', label: 'more than' }, { value: 'lte', label: 'at most' }, { value: 'lt', label: 'less than' }] }, { key: 'value', label: 'This', kind: 'text' }], help: 'every rule must hold; none means everybody' }).optional(),
      prices: z.array(z.object({
        sku: z.string().meta({ label: 'Product', kind: 'reference', options: 'products' }),
        variant: z.string().meta({ label: 'Shape', help: 'empty for a product sold one way' }).optional(),
        amount: z.number().meta({ label: 'Price' }),
        min_quantity: z.number().meta({ label: 'From qty' }).optional(),
        max_quantity: z.number().meta({ label: 'To qty' }).optional(),
      })).meta({ label: 'Prices', widget: 'rows', kind: 'list', of: 'group', fields: [{ key: 'sku', label: 'Product', kind: 'reference', options: 'products' }, { key: 'variant', label: 'Shape', kind: 'text', help: 'empty for a product sold one way' }, { key: 'amount', label: 'Price', kind: 'number' }, { key: 'min_quantity', label: 'From qty', kind: 'number' }, { key: 'max_quantity', label: 'To qty', kind: 'number' }] }).optional(),
    }),
  },

  /*
   * A DISCOUNT. Its own record, because a discount and a price answer different questions and
   * neither can be written as the other — the same split Medusa keeps between its pricing and
   * promotion modules.
   */
  promotions: {
    name: 'Promotions', dir: 'content/store/promotions', body: true, title: 'title',
    bodyLabel: 'What this is for (markdown) — for whoever reads it next, never shown to a buyer',
    fields: z.object({
      published: z.boolean().meta({ label: 'Published', grid: true }).optional(),
      title: z.string().min(1).meta({ label: 'Title', grid: true }),
      status: z.enum(['active', 'draft', 'inactive']).meta({ label: 'Status', grid: true }).default('active'),
      kind: z.enum(['standard', 'buyget']).meta({ label: 'Kind', help: 'buy-get is reserved' }).default('standard'),
      method: z.enum(['percentage', 'fixed']).meta({ label: 'How', grid: true, half: true, help: 'a share of the price, or an amount of money' }).default('percentage'),
      value: z.number().meta({ label: 'How much', grid: true, half: true, help: 'per cent, or an amount in whole money' }),
      target: z.enum(['items', 'order', 'shipping']).meta({ label: 'Off what', grid: true, half: true, help: 'the lines, the order as a whole, or the delivery' }).default('items'),
      /* a flat amount is meaningless without this, which is why it is not optional in spirit */
      allocation: z.enum(['each', 'across', 'once']).meta({ label: 'Spread', half: true, help: 'each line, split between them, or once', shown: { field: 'target', value: 'items' } }).default('each'),
      max_quantity: z.number().meta({ label: 'At most this many units', shown: { field: 'target', value: 'items' } }).optional(),
      applies: z.array(z.object({
        sku: z.string().meta({ label: 'Product', kind: 'reference', options: 'products' }),
        variant: z.string().meta({ label: 'Shape' }).optional(),
      })).meta({ label: 'What it applies to', widget: 'rows', kind: 'list', of: 'group', fields: [{ key: 'sku', label: 'Product', kind: 'reference', options: 'products' }, { key: 'variant', label: 'Shape', kind: 'text', help: 'empty for every shape' }], help: 'nothing listed = the whole shop', shown: { field: 'target', value: 'items' } }).optional(),
      starts: z.string().meta({ label: 'Starts', kind: 'datetime', half: true }).optional(),
      ends: z.string().meta({ label: 'Ends', kind: 'datetime', half: true }).optional(),
      rules: z.array(z.object({
        attribute: z.enum(['customer.class', 'customer.tiers', 'item_total', 'shipping_address.country']).meta({ label: 'What' }),
        operator: z.enum(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte']).meta({ label: 'Is' }).default('eq'),
        value: z.string().meta({ label: 'This' }),
      })).meta({ label: 'Who it is for', widget: 'rows', kind: 'list', of: 'group', fields: [{ key: 'attribute', label: 'What', kind: 'select', choices: [{ value: 'customer.class', label: 'The customer is' }, { value: 'customer.tiers', label: 'Their membership' }, { value: 'item_total', label: 'The basket total (pence)' }, { value: 'shipping_address.country', label: 'Shipping to' }] }, { key: 'operator', label: 'Is', kind: 'select', choices: [{ value: 'eq', label: 'exactly' }, { value: 'ne', label: 'not' }, { value: 'in', label: 'one of' }, { value: 'gte', label: 'at least' }, { value: 'gt', label: 'more than' }, { value: 'lte', label: 'at most' }, { value: 'lt', label: 'less than' }] }, { key: 'value', label: 'This', kind: 'text' }], help: 'every rule must hold; none means everybody — this is the only thing that decides whether a member gets it' }).optional(),
      budget: z.object({
        kind: z.enum(['spend', 'usage']).meta({ label: 'Limit by' }).default('usage'),
        limit: z.number().meta({ label: 'Limit' }),
      }).meta({ label: 'Budget', widget: 'group', kind: 'group', fields: [{ key: 'kind', label: 'Limit by', kind: 'select', choices: [{ value: 'usage', label: 'How many times it is used' }, { value: 'spend', label: 'How much it gives away' }] }, { key: 'limit', label: 'Limit', kind: 'number', help: 'times, or money in pence' }], help: 'what it may spend, or how many times it may be used, before it stops' }).optional(),
    }),
  },

  products: {
    name: 'Products', dir: 'content/store/products', body: true, title: 'title',
    assets: { dir: 'content/uploads/products' },   /* where an upload for a record lands; the field holds its address */
    /* a product is in the search index like everything else (search-rows.js), and it carries
       Subjects, so what somebody bought is part of what they are interested in. Without this the
       index kept whatever the last BUILD saw, and on the shape that never builds again a product's
       tags were frozen at its last deploy. */
    projected: projectedSearch,
    options: {
      /*
       * EVERY PRODUCT, FOR THE FIELDS THAT POINT AT ONE. A price list, a promotion and a paid
       * form all name a product by sku, and without this the control offered an empty list and
       * read “Choose…” beside a value the file plainly held — an editor could not pick one and
       * could not see the one that was there. `optionList` answers an empty list for a key no
       * model provides, which is right for a theme field a site has no module for and is not
       * right here.
       */
      products: async (ctx) => {
        const out = []
        for (const f of await ctx.store.list('content/store/products').catch(() => [])) {
          /* `list` answers names WITHOUT the extension, so a read needs it back */
          const raw = await ctx.store.read('content/store/products/' + f.replace(/[.]md$/, '') + '.md')
          if (!raw) continue
          const { data } = ctx.matter(raw)
          if (!data || !data.sku) continue
          out.push({ value: String(data.sku), label: String(data.title || data.sku) })
        }
        return out.sort((a, b) => a.label.localeCompare(b.label))
      },
      /*
       * EVERY SUPPLIER THE SHOP HAS — the kit's and the site's own, from the one registry. The
       * list says which publish a catalogue, so the editor's Refresh can say "this supplier
       * publishes none" instead of appearing to do nothing.
       */
      suppliers: async (ctx) => {
        const { suppliersFor } = await import('../../suppliers.mjs')
        return (await suppliersFor(ctx)).map((x) => ({ value: x.id, label: x.name, catalogue: !!x.catalogue }))
      },
      /*
       * EVERY PRODUCT TYPE A SUPPLIER SELLS. This is the whole reason a blueprint cannot be
       * typed: the control has a list, the list is the supplier's own, and the file keeps an id.
       * A supplier that publishes no catalogue offers none, so a shop pointing a garment at a
       * book printer is given an empty list rather than a text box.
       */
      blueprints: async (ctx) => {
        const { suppliersFor } = await import('../../suppliers.mjs')
        const out = []
        for (const x of await suppliersFor(ctx)) {
          if (typeof x.types !== 'function') continue
          const types = await x.types().catch(() => [])
          for (const t of types) out.push({ value: t.id, label: t.title + ' \u00b7 ' + x.name, supplier: x.id })
        }
        return out
      },
      /* and where a design may go on it, which is the chosen type's own answer */
      'print-areas': async (ctx) => {
        const { suppliersFor } = await import('../../suppliers.mjs')
        const seen = new Set()
        for (const x of await suppliersFor(ctx)) {
          if (typeof x.types !== 'function') continue
          for (const t of await x.types().catch(() => [])) for (const a2 of t.areas || []) seen.add(a2)
        }
        return [...seen].map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))
      },
    },
    /* a count is state and never reaches the file, whatever the form sends */
    prepare: (rec) => { if (rec.data && rec.data.stock !== undefined) { const { stock, ...rest } = rec.data; return { ...rec, data: rest } } return rec },
    bodyLabel: 'Description (markdown) — each `## ` section becomes a details panel',
    fields: z.object({
      published: z.boolean().meta({ label: 'Published', grid: true, help: 'off = kept in the backend, but not live' }).optional(),
      title: z.string().min(1).meta({ label: 'Title', grid: true }),
      key: z.string().regex(/^[0-9a-f]{8}$/).meta({ label: 'Key', grid: true, readonly: true, help: 'the offer\'s identity, assigned on first save and never changed — what every purchase is attributed by; rename the sku freely, never this' }).optional(),
      subtitle: z.string().meta({ label: 'Subtitle', help: 'one line under the title' }).optional(),
      sku: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).meta({ label: 'SKU', grid: true, help: 'this offer\'s own slug (group-coaching-monthly); Stripe is made to match it on deploy and at checkout — never change it once sold' }),
      kind: z.enum(['book', 'good', 'membership', 'session', 'form']).meta({ label: 'Kind', grid: true, help: 'session = a paid call, bought as it is booked; form = an answer somebody pays to have looked at, which a form names by sku' }),
      billing: z.enum(['once', 'subscription']).meta({ label: 'Billing', grid: true, help: 'once = bought outright; subscription = charged every period' }).optional(),
      period: z.enum(['weekly', 'monthly']).meta({ label: 'Period', help: 'for a subscription: how often it is charged' }).optional(),
      price: z.number().min(0).meta({ label: 'Price', grid: true, help: 'in dollars — 10 or 10.00; Stripe gets cents' }),
      currency: z.string().meta({ label: 'Currency', help: 'usd unless said otherwise' }).optional(),
      sessions: z.array(z.object({ type: z.string(), weekly: z.number().int().optional(), monthly: z.number().int().optional() })).meta({ label: 'Sessions included', widget: 'rows', kind: 'list', of: 'group', fields: [{ key: 'type', label: 'Booking type', kind: 'reference', options: 'sessions' }, { key: 'weekly', label: 'A week', kind: 'number' }, { key: 'monthly', label: 'A month', kind: 'number' }], help: 'what this tier may book, with how many a week and a month (0 is no limit): a listed type is the tier\'s under these counts whatever the type\'s own rules say, a paid one included', shown: { field: 'kind', is: 'is', value: 'membership' } }).optional(),
      'chat-hours': z.number().int().min(1).meta({ label: 'Chat reply within (hours)', help: 'what this offer promises: a coach replies within this many hours — the inbox shows a coach what is due' }).optional(),
      /* WHAT STRIPE ALREADY DOES, as fields. Each is a control that fits what it is — days as a
         number, the methods from the one list, the bounds as numbers — and never a placeholder
         teaching a syntax. The trial is shown only on a subscription, since the catalogue refuses
         one on a one-off; the bounds only once the quantity is the buyer's. */
      trial: z.number().int().min(1).max(730).meta({ label: 'Free trial (days)', help: 'days before the first charge; the tier is live throughout, and one trial per person per tier — a weekly and a monthly of one tier share it', shown: { field: 'billing', is: 'is', value: 'subscription' } }).optional(),
      tax: z.object({
        automatic: z.boolean().meta({ label: 'Work out tax automatically', help: 'Stripe calculates the rate from where the buyer is. It must be switched on in Stripe too — unconfigured it quietly returns no tax rather than failing' }).optional(),
        registration: z.boolean().meta({ label: 'Ask a business for its tax number', help: 'so a VAT-registered buyer is not charged tax they would reclaim' }).optional(),
      }).meta({ label: 'Tax', widget: 'group', kind: 'group', fields: [
        { key: 'automatic', label: 'Work out tax automatically', kind: 'boolean', help: 'Stripe calculates the rate from where the buyer is. It must be switched on in Stripe too — unconfigured it quietly returns no tax rather than failing' },
        { key: 'registration', label: 'Ask a business for its tax number', kind: 'boolean', help: 'so a VAT-registered buyer is not charged tax they would reclaim' },
      ] }).optional(),
      payments: z.array(z.enum(['card', 'link', 'apple_pay', 'google_pay', 'cashapp', 'amazon_pay', 'alipay', 'wechat_pay'])).meta({ label: 'Payment methods accepted', widget: 'multiselect', help: 'beyond cards. Left empty, Stripe offers whatever the account has on by default. In a cart of several offers only the methods EVERY offer accepts are shown' }).optional(),
      adjustable: z.object({
        min: z.number().int().min(1).meta({ label: 'Fewest' }).optional(),
        max: z.number().int().min(1).max(999).meta({ label: 'Most' }).optional(),
      }).meta({ label: 'The buyer may change the quantity', widget: 'group', kind: 'group', fields: [
        { key: 'min', label: 'Fewest', kind: 'number' },
        { key: 'max', label: 'Most', kind: 'number' },
      ], help: 'set these and the quantity becomes editable on the payment page, within these bounds. Not a count of stock — how many are left is tracked separately' }).optional(),
      usage: z.object({
        unit: z.string().trim().min(1).meta({ label: 'Unit name', help: 'the site’s word for one unit, shown to the reader' }),
        rate: z.number().min(0.000001).meta({ label: 'Serving cost per unit (USD)', help: 'provider cost in US dollars represented by one whole unit; used to convert measured serving cost into usage' }),
        grant: z.number().int().min(1).meta({ label: 'Units granted', help: 'whole units granted when this one-time offer is paid' }).optional(),
        included: z.number().int().min(0).meta({ label: 'Units included per period', help: 'whole units included in each paid subscription period; usage beyond this is metered' }).optional(),
        meter: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/).meta({ label: 'Stripe meter event', help: 'a stable lower-case name for the Stripe meter that receives overage usage' }).optional(),
        overagePrice: z.number().min(0.000001).meta({ label: 'Overage price per unit', help: 'in this offer’s currency; Stripe charges this for each unit above the included allowance' }).optional(),
        speechCostPerSecond: z.number().min(0).meta({ label: 'Endpoint speech cost per second (USD)', help: 'server-side cost rate for endpoint text-to-speech; browser speech costs the site nothing' }).optional(),
      }).meta({ label: 'Usage', widget: 'group', kind: 'group', fields: [
        { key: 'unit', label: 'Unit name', kind: 'text' },
        { key: 'rate', label: 'Serving cost per unit (USD)', kind: 'number' },
        { key: 'grant', label: 'Units granted', kind: 'number', shown: { field: 'billing', is: 'is', value: 'once' } },
        { key: 'included', label: 'Units included per period', kind: 'number', shown: { field: 'billing', is: 'is', value: 'subscription' } },
        { key: 'meter', label: 'Stripe meter event', kind: 'text', shown: { field: 'billing', is: 'is', value: 'subscription' } },
        { key: 'overagePrice', label: 'Overage price per unit', kind: 'number', shown: { field: 'billing', is: 'is', value: 'subscription' } },
        { key: 'speechCostPerSecond', label: 'Endpoint speech cost per second (USD)', kind: 'number' },
      ], help: 'optional; enables usage billing for this offer' }).optional(),
      book: z.string().meta({ label: 'Book slug', help: 'for a book unlock: which book it opens' }).optional(),
      tier: z.string().meta({ label: 'Tier', help: 'for a membership: its slug (tier-1, tier-2 …); every price of a tier carries it, so a weekly and a monthly of one tier both count; sessions name it in "requires"' }).optional(),
      rank: z.number().int().meta({ label: 'Tier rank', help: 'for a membership: 1, 2, … — a higher rank includes everything below it' }).optional(),
      image: z.string().meta({ label: 'Lead image', widget: 'image', help: 'a book falls back to its cover' }).optional(),
      gallery: z.array(z.string()).meta({ label: 'Gallery', widget: 'list', help: 'more image paths, in order' }).optional(),
      collections: z.array(z.string()).meta({ label: 'Collections', widget: 'list', grid: true, help: 'collection ids' }).optional(),
      /* THE SHAPES IT IS SOLD IN. `sizes` is kept and IS one Size option (build/variants.mjs
         folds it in), so a shop that only needs sizes never meets the longer form; the editor
         shows both through one control, which also draws the derived variants as a table. */
      /*
       * WHO MAKES IT. A shop that sells a thing somebody else makes names them here, and where
       * that supplier publishes a catalogue, Refresh takes the axes from it rather than asking
       * anybody to type the colours a blueprint already knows. The field offers its choices from
       * the registry (`options: 'suppliers'`), so no model, form or page names a supplier.
       */
      supplier: z.string().meta({ label: 'Made by', kind: 'reference', options: 'suppliers', grid: true, help: 'leave blank for something the shop makes or holds itself' }).optional(),
      /*
       * A GARMENT. The product type is the SUPPLIER'S fact and is never typed — the control
       * offers the list its catalogue publishes and the file keeps the id, so a typo cannot
       * become an order (refused at the build, at the save and at the till alike).
       */
      blueprint: z.number().int().meta({ label: 'Product type', kind: 'reference', options: 'blueprints', shown: { field: 'kind', value: 'apparel' }, help: 'from the supplier\u2019s own catalogue \u2014 one it does not sell cannot be chosen' }).optional(),
      design: z.object({
        artwork: z.string().meta({ label: 'Design', widget: 'image' }).optional(),
        area: z.string().meta({ label: 'Where it goes', widget: 'select', options: 'print-areas' }).optional(),
        scale: z.number().meta({ label: 'Scale', half: true }).optional(),
        x: z.number().meta({ label: 'Across', half: true }).optional(),
        y: z.number().meta({ label: 'Down', half: true }).optional(),
      }).meta({ label: 'The design', widget: 'group', kind: 'group', fields: [
        { key: 'artwork', label: 'Design', kind: 'image', help: 'uploaded through the library, or chosen from it \u2014 there is no second uploader' },
        { key: 'area', label: 'Where it goes', kind: 'select', choices: [{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }, { value: 'sleeve', label: 'Sleeve' }] },
        { key: 'scale', label: 'Scale', kind: 'number', half: true },
        { key: 'x', label: 'Across', kind: 'number', half: true },
        { key: 'y', label: 'Down', kind: 'number', half: true },
      ], shown: { field: 'kind', value: 'apparel' }, help: 'the design, and where it sits on the garment' }).optional(),
      /* what the supplier rendered, one per colourway — written by Refresh, never by hand */
      mockups: z.record(z.string(), z.string()).meta({ label: 'Mockups', widget: 'none' }).optional(),
      supplier_ref: z.string().meta({ label: 'The supplier\u2019s own id', widget: 'none' }).optional(),
      sizes: z.array(z.string()).meta({ label: 'Sizes', widget: 'list', help: 'S, M, L … — the short way to write one Size option' }).optional(),
      options: z.array(z.object({
        name: z.string().meta({ label: 'Name' }),
        values: z.array(z.any()).meta({ label: 'Values' }).optional(),
        /* WHOSE AXIS THIS IS. Absent is the shop's own, typed here; a supplier's id means the
           supplier publishes it and Refresh owns it — a value it drops is marked rather than
           deleted, so a cart line naming that variant still reads. Never typed: it is written by
           the refresh. */
        from: z.string().meta({ label: 'Supplied by', widget: 'none' }).optional(),
      })).meta({ label: 'Options', widget: 'options', help: 'the shapes this is sold in — a name and its values. The order of the options is the order of a variant\'s key, so reordering them changes every cart line already placed.' }).optional(),
      variants: z.record(z.string(), z.any()).meta({ label: 'Variants', widget: 'none', help: 'derived from the options; a price, a sku or a weight per combination where it differs' }).optional(),
      unsold: z.array(z.string()).meta({ label: 'Not sold', widget: 'none', help: 'combinations this shop does not sell — shown struck through rather than hidden' }).optional(),
      /* WHETHER stock is counted — never HOW MANY. The count is a row (public.inventory); a file
         that could say five would reset to five on every redeploy. */
      tracked: z.boolean().meta({ label: 'Count the stock', help: 'How many are left is kept in the shop, not in this file' }).optional(),
      /*
       * HOW MANY ARE LEFT, SHOWN AND SET WHERE THE EDITOR IS — and never written to the file.
       *
       * The count is state; the file says only that it is counted. But an editor still has to
       * set it, and sending them somewhere else to do it is how a shop ends up with a stock
       * page nobody opens. So the drawer draws it: the control reads the rows as the signed-in
       * administrator (RLS lets anyone read a count and `inventory_set` refuses anyone who is
       * not an admin) and never goes through the file at all.
       *
       * `prepare` strips it before every save, so the one thing that must never happen —
       * a count in a file — cannot, whatever the form sends.
       */
      stock: z.any().meta({ label: 'In stock', widget: 'stock', shown: { field: 'tracked', value: true } }).optional(),
      backorder: z.boolean().meta({ label: 'Sell past zero', help: 'Keep taking orders when there are none left', shown: { field: 'tracked', value: true } }).optional(),
      badge: z.string().meta({ label: 'Badge', help: 'New … (Bestseller is never typed: the store gives it to the book that sold most)' }).optional(),
      compare: z.string().meta({ label: 'Old price, as written', half: true, help: 'struck through beside the price ("$39")' }).optional(),
      rating: z.number().min(0).max(5).meta({ label: 'Rating (0–5)', half: true }).optional(),
      reviews: z.number().int().min(0).meta({ label: 'Reviews (how many)', half: true }).optional(),
      featured: z.boolean().meta({ label: 'Featured', grid: true }).optional(),
      order: z.number().int().meta({ label: 'Order', grid: true }).optional(),
      tags: z.array(z.string()).meta({ label: 'Tags', widget: 'tags', options: 'tags', help: 'what this is about — chosen from the site\'s list under Tags' }).optional(),
    }),
  },
  pages: {
    name: 'Pages', dir: 'content/pages', body: false, title: 'title',
    assets: { dir: 'content/uploads/pages' },   /* where an upload for a record lands; the field holds its address */
    builder: 'sections',   /* the page builder edits this field in the main area */
    fields: z.object({
      published: z.boolean().meta({ label: 'Published', grid: true, help: 'off = kept in the backend, but not live' }).optional(),
      title: z.string().min(1).meta({ label: 'Title (internal)', grid: true }),
      route: z.string().meta({ label: 'Route', grid: true, help: '/ for the home page, or /some-slug' }).optional(),
      seoTitle: z.string().meta({ label: 'Search title', help: 'the browser tab and search result; blank = the site name' }).optional(),
      description: z.string().meta({ label: 'Description', widget: 'text', help: 'search and share description (about 150 characters)' }).optional(),
      image: z.string().meta({ label: 'Share image', widget: 'image', help: 'shown when the page is shared; blank = the site default' }).optional(),
      progress: z.boolean().meta({ label: 'Reading progress bar', help: 'a thin bar at the top of the page that fills as it is read' }).optional(),
      /* WHOSE PAGE IT IS. A coach builds their own with this same builder, and it stands at
         /p/<username>. It is read-only here: the field is what the pipe fences on, so a coach who
         could edit it could give themselves somebody else's page. */
      owner: z.string().meta({ label: 'Whose page', grid: true, readOnly: true, help: 'a coach\'s own page, at /p/<their username>' }).optional(),
      sections: z.any().meta({ label: 'Sections', widget: 'builder' }).optional(),   /* validated against src/components/landing/schemas.js on save */
    }),
  },
  /* AN ACHIEVEMENT: what somebody can do here that is worth saying out loud, and the page that
     says it. The rule is an analytics event — the site already records what people do — so the
     form asks for that event and what it takes, and nothing about books or readings or anything
     else this kit does not know about. */
  achievements: {
    name: 'Achievements', dir: 'content/achievements', body: true, title: 'title',
    after: async (rec, ctx) => { await onAwardWrite(ctx) },
    afterRemove: async (name, ctx) => { await onAwardWrite(ctx) },
    projected: projectedAwards,
    assets: { dir: 'content/uploads/achievements' },
    bodyLabel: 'The page — what this is, and why it is worth doing',
    fields: z.object({
      published: z.boolean().meta({ label: 'Published', grid: true, help: 'off = kept in the backend; nobody can earn it' }).optional(),
      title: z.string().min(1).meta({ label: 'Title', grid: true }),
      sub: z.string().meta({ label: 'One line', help: 'under the title, and on the badge' }).optional(),
      icon: z.string().meta({ label: 'Glyph', half: true, widget: 'glyph' }).optional(),
      colour: z.string().meta({ label: 'Colour', half: true, widget: 'colour' }).optional(),
      cover: z.string().meta({ label: 'Picture', widget: 'image', help: 'instead of the glyph, where it has one' }).optional(),
      when: z.any().meta({ label: 'What earns it', widget: 'award-rule' }).optional(),
      canAccess: ACCESS,
      shown: z.boolean().meta({ label: 'On a profile', grid: true, help: 'off = the site\'s own note, never on anybody\'s page' }).optional(),
      order: z.number().int().meta({ label: 'Order', grid: true }).optional(),
      media: z.any().meta({ label: 'Audio or video', widget: 'media' }).optional(),
    }),
  },
  /*
   * WHAT THE SITE WRITES ABOUT — the tags a piece of content may carry, kept as one record
   * because a vocabulary is a list and fifty files would be a directory nobody reads.
   *
   * It is a DECLARATION, so it lives under content/: a file in a checkout, a row of public.content
   * in cloud mode, read and written through the store like everything else here. It is never a
   * table of its own, and the difference is what lets an editor add a tag on a deployment with
   * no checkout — a publish rather than a migration.
   *
   * `free` is the switch. Off (the default) a writer picks from this list and cannot invent one, so
   * two spellings of one tag are not possible. On, a writer may type one, and it JOINS this
   * list rather than living beside it — so the list stays the whole truth about what tags
   * exist, and a typo is something an administrator can find here and correct.
   */
  tags: {
    name: 'Tags', dir: 'content', single: 'tags', body: true, title: 'title',
    bodyLabel: 'What these are for',
    options: {
      /* every field that offers tags draws from here, so there is one list and no second copy */
      /*
       * The list, and whether a writer may add to it. The switch rides WITH the list rather than
       * being asked for separately, because two round trips that can disagree about one answer is
       * how a field ends up offering to take a tag the server will then refuse.
       */
      tags: async (ctx) => {
        const { readTags } = await import('../../tags.mjs')
        const rec = await readTags(ctx.store)
        const out = rec.tags.map((v) => ({ value: v, label: v }))
        if (rec.free) out.push({ value: '__free__', label: '__free__' })
        return out
      },
    },
    fields: z.object({
      title: z.string().meta({ label: 'Title (internal)' }).optional(),
      free: z.boolean().meta({ label: 'Let writers type a new tag', help: 'off, they choose from the list below; on, a tag they type is added to it' }).optional(),
      tags: z.array(z.string()).meta({ label: 'Tags', widget: 'list', help: 'what a piece of content can be about' }).optional(),
    }),
  },
  /* WHAT THE SITE TAKES AN EVENT TO MEAN ABOUT SOMEBODY: one record, because a trait is one line
     and fifty of them in fifty files is a directory nobody reads. */
  traits: {
    name: 'Traits', dir: 'content', single: 'traits', body: true, title: 'title',
    after: async (rec, ctx) => { await onAwardWrite(ctx) },
    afterRemove: async (name, ctx) => { await onAwardWrite(ctx) },
    projected: projectedAwards,
    bodyLabel: 'What these are for, and the rules about them',
    fields: z.object({
      title: z.string().meta({ label: 'Title (internal)' }).optional(),
      visible: z.array(z.string()).meta({ label: 'Who may look', widget: 'list', help: 'roles besides an administrator, who always may' }).optional(),
      rules: z.any().meta({ label: 'Rules', widget: 'rows' }).optional(),
    }),
  },
  /* THE COMMUNITY SURFACE, as its owner arranges it: what it is called, the picture behind its
     front page, the six colours the chrome wears, what that page opens on, and which of its
     features this site runs. It is content (content/community.md) rather than configuration
     because every one of these is a thing the person running the site changes their mind about,
     and none of them needs a deploy.

     The file keeps its three groups nested — colours, home, features — and the editor asks for each
     part of them with a control that fits it, which is the rule everywhere here: nobody is shown a
     block of YAML and asked to type it. The grammar below is what makes both true at once. */
  community: {
    name: 'Community', dir: 'content', single: 'community', body: true, title: 'name',
    assets: { dir: 'content/uploads/community' },
    bodyLabel: 'What this place is — shown where the community is introduced',
    grammar: {
      parse: (text) => {
        const fm = matter(text)
        const d = fm.data || {}
        const flat = { ...d }
        delete flat.colours; delete flat.home; delete flat.features
        /* THE DEFAULTS ARE FILLED IN, because a switch drawn off for a thing that is ON is a lie
           the editor tells — and the next save would make it true. What the file leaves out is what
           the surface does by default (velite's own defaults), so that is what the form shows. */
        for (const k of COMMUNITY_HOME) flat['home_' + k] = (d.home || {})[k] !== false
        flat.home_opens = (d.home || {}).opens || 'feed'
        for (const k of COMMUNITY_FEATURES) flat['feature_' + k] = (d.features || {})[k] !== false
        for (const [k, v] of Object.entries(d.colours || {})) flat['colour_' + k] = v
        return { data: flat, content: fm.content.replace(/^\n/, '') }
      },
      serialise: (rec) => {
        const d = { ...(rec.data || {}) }
        const colours = {}, home = {}, features = {}
        for (const k of Object.keys(d)) {
          if (k.startsWith('colour_')) { if (d[k] !== '' && d[k] != null) colours[k.slice(7)] = d[k]; delete d[k] }
          else if (k.startsWith('home_')) { if (d[k] != null) home[k.slice(5)] = d[k]; delete d[k] }
          else if (k.startsWith('feature_')) { if (d[k] != null) features[k.slice(8)] = d[k]; delete d[k] }
        }
        if (Object.keys(colours).length) d.colours = colours
        if (Object.keys(home).length) d.home = home
        if (Object.keys(features).length) d.features = features
        return matter.stringify('\n' + String(rec.content || '').replace(/^\n+/, ''), cleanData(d), DUMP)
      },
    },
    fields: z.object({
      name: z.string().meta({ label: 'What it is called', help: 'the header, the front page, the rail' }).optional(),
      tagline: z.string().meta({ label: 'One line under the name' }).optional(),
      cover: z.string().meta({ label: 'The picture behind the front page', widget: 'image', help: 'without one the page draws a mesh of its own colour, which is a good answer' }).optional(),
      /* the chrome's six colours, each its own swatch */
      colour_rail: z.string().meta({ label: 'The rail', widget: 'colour', half: true }).optional(),
      colour_side: z.string().meta({ label: 'The column beside it', widget: 'colour', half: true }).optional(),
      colour_ink: z.string().meta({ label: 'Its ink', widget: 'colour', half: true }).optional(),
      colour_on: z.string().meta({ label: 'The row you are on', widget: 'colour', half: true }).optional(),
      colour_link: z.string().meta({ label: 'What may be opened', widget: 'colour', half: true }).optional(),
      colour_badge: z.string().meta({ label: 'What is owed', widget: 'colour', half: true }).optional(),
      /* the front page */
      home_opens: z.enum(['feed', 'spaces']).meta({ label: 'The front page opens on', help: 'what has been said, or the spaces to choose from' }).optional(),
      home_greeting: z.boolean().meta({ label: 'Greet them by name' }).optional(),
      home_facts: z.boolean().meta({ label: 'Show how many people and rooms' }).optional(),
      home_compose: z.boolean().meta({ label: 'A box to say something' }).optional(),
      home_events: z.boolean().meta({ label: 'What is on' }).optional(),
      home_people: z.boolean().meta({ label: 'Who is here' }).optional(),
      /* and what this community runs at all */
      feature_events: z.boolean().meta({ label: 'Events' }).optional(),
      feature_huddles: z.boolean().meta({ label: 'Huddles' }).optional(),
      feature_polls: z.boolean().meta({ label: 'Polls' }).optional(),
      feature_voice: z.boolean().meta({ label: 'Voice notes' }).optional(),
      feature_files: z.boolean().meta({ label: 'Files' }).optional(),
      feature_tickets: z.boolean().meta({ label: 'Tickets' }).optional(),
      feature_forum: z.boolean().meta({ label: 'Forum rooms' }).optional(),
      feature_moderation: z.boolean().meta({ label: 'Moderation' }).optional(),
    }),
  },
  /* an A/B test: its own record, pointing at the pages or ads it compares */
  experiments: {
    name: 'Experiments', dir: 'content/experiments', body: true, title: 'title',
    assets: { dir: 'content/uploads/experiments' },   /* where an upload for a record lands; the field holds its address */
    bodyLabel: 'Notes — what the test is asking, for the team',
    variants: 'variants',   /* the variants editor edits this field in the main area */
    fields: z.object({
      title: z.string().min(1).meta({ label: 'Title', grid: true }),
      kind: z.enum(['page', 'ad']).meta({ label: 'Kind', grid: true, help: 'pages on one route, or ads' }),
      active: z.boolean().meta({ label: 'Active', grid: true, help: 'off = paused: everyone sees the first variant' }).optional(),
      goal: z.string().meta({ label: 'Goal path', help: 'a visit to this path counts as a conversion; pages default to /app, an ad with no goal counts a click on it' }).optional(),
      ends: z.string().meta({ label: 'Ends', widget: 'date', help: 'blank = two weeks after the first visitor' }).optional(),
      winner: z.string().meta({ label: 'Winner', help: 'a variant key — declaring one ends the test' }).optional(),
      variants: z.any().meta({ label: 'Variants', widget: 'variants' }).optional(),   /* checked against the pages / ads on save */
    }),
  },
  /* (the tests' own frontmatter — timing, display — is edited in the quiz editors) */
  sessions: {
    name: 'Booking types', dir: 'content/sessions', body: true, title: 'title',
    assets: { dir: 'content/uploads/sessions' },   /* where an upload for a record lands; the field holds its address */
    fields: z.object({
      title: z.string().min(1).meta({ label: 'Title', grid: true }),
      sub: z.string().meta({ label: 'One line' }).optional(),
      price: z.string().meta({ label: 'Price, as written (e.g. $555 / hour, Included)' }).optional(),
      scheduler: z.enum(['native', 'cal']).meta({ label: 'Scheduled by', grid: true, widget: 'select', choices: [{ value: 'native', label: 'This site' }, { value: 'cal', label: 'cal.com' }], help: 'this site: the hosts\' own hours and the site\'s own bookings; cal.com: its event type does the scheduling. Blank is this site — or cal.com when a booking link is set' }).optional(),
      url: z.string().meta({ label: 'Booking link (cal.com)', help: 'the event type\'s page, https://cal.com/<username>/<event-type>', shown: { field: 'scheduler', is: 'is-not', value: 'native' } }).optional(),
      duration: z.number().int().meta({ label: 'Length (minutes)', grid: true, shown: { field: 'scheduler', is: 'is-not', value: 'cal' } }).optional(),
      /* HOW A BOOKING IS SHARED. One host taking it IS the rota with one name in it, so there is one
         path through the code and one word for it here. */
      assign: z.enum(['one', 'round-robin', 'collective', 'managed']).meta({ label: 'Who takes a booking', grid: true, widget: 'select', choices: [{ value: 'round-robin', label: 'One of the hosts, in turn' }, { value: 'collective', label: 'Every host, together' }, { value: 'managed', label: 'Each host gets their own copy' }], help: 'in turn: the free host whose turn it is. Together: only times every host keeps, and everybody comes. Their own copy: the type appears on each host\'s page at their own address and their own hours', shown: { field: 'scheduler', is: 'is-not', value: 'cal' } }).optional(),
      /* A TEAM'S MEMBERS ARE ROWS, so this names the team and the scheduler asks who is in it at the
         time — never a list of people written into a file. */
      team: z.string().meta({ label: 'Given by a team', kind: 'reference', options: 'teams', help: 'its members give it, and who they are can change without this being edited; naming hosts below overrides it', shown: { field: 'scheduler', is: 'is-not', value: 'cal' } }).optional(),
      hosts: z.array(z.union([z.string(), z.object({ email: z.string(), priority: z.number().optional(), weight: z.number().optional(), fixed: z.boolean().optional() })])).meta({
        label: 'Hosts', widget: 'rows', kind: 'list', of: 'group',
        fields: [
          { key: 'email', label: 'Host', kind: 'reference', options: 'hosts' },
          { key: 'priority', label: 'Priority', kind: 'select', choices: [{ value: 0, label: 'Lowest' }, { value: 1, label: 'Low' }, { value: 2, label: 'Ordinary' }, { value: 3, label: 'High' }, { value: 4, label: 'Highest' }] },
          { key: 'weight', label: 'Share (%)', kind: 'number' },
          { key: 'fixed', label: 'At every booking', kind: 'boolean' },
        ],
        help: 'the accounts that give it. Priority is asked first, then the share — a host at 200% takes twice as many — then whoever was booked least recently. Somebody at every booking comes whoever else takes it',
        shown: { field: 'scheduler', is: 'is-not', value: 'cal' },
      }).optional(),
      seats: z.number().int().meta({ label: 'Seats', help: 'a group session: how many share one time; 0 is one-to-one', shown: { field: 'scheduler', is: 'is-not', value: 'cal' } }).optional(),
      buffer: z.number().int().meta({ label: 'Breathing room (minutes)', help: 'around this session, on top of the host\'s own', shown: { field: 'scheduler', is: 'is-not', value: 'cal' } }).optional(),
      schedule: z.string().meta({ label: 'Read the hosts at this set of hours', help: 'the name of a set each host keeps (Evenings); a host who keeps no such set is read at their usual hours. Blank: everybody\'s usual hours', shown: { field: 'scheduler', is: 'is-not', value: 'cal' } }).optional(),
      notice: z.number().int().meta({ label: 'Minimum notice (hours)', help: 'a reader books, moves or cancels at least this far ahead; 24 when blank', shown: { field: 'scheduler', is: 'is-not', value: 'cal' } }).optional(),
      /* THE GRID OF TIMES IT SHOWS, and how far ahead it takes bookings — the type's, so a host need
         not write it into their own week. */
      interval: z.number().int().meta({ label: 'Times every', grid: true, help: 'minutes between the starts it offers — 30 shows 9:00, 9:30, 10:00. 15 when blank', shown: { field: 'scheduler', is: 'is-not', value: 'cal' } }).optional(),
      offset: z.number().int().meta({ label: 'Starting at', help: 'minutes into each stretch of hours the grid begins — 5 turns 9:00 into 9:05, so there is a moment between calls. Less than the interval', shown: { field: 'scheduler', is: 'is-not', value: 'cal' } }).optional(),
      window: z.union([z.number(), z.object({ from: z.string().optional(), to: z.string().optional() })]).meta({
        label: 'How far ahead it can be booked', widget: 'group', kind: 'group',
        fields: [{ key: 'from', label: 'Not before', kind: 'date' }, { key: 'to', label: 'Not after', kind: 'date' }],
        help: 'between two dates — or a plain number of days for a rolling window. Blank: as far ahead as the hosts keep hours',
        shown: { field: 'scheduler', is: 'is-not', value: 'cal' },
      }).optional(),
      /* SEVERAL LENGTHS. The first is the default and must be the type's own length, so a type with
         one length and a type with none behave the same. A price and a sku per row are for a type
         paid at the length chosen. */
      lengths: z.array(z.object({ minutes: z.number().int(), price: z.string().optional(), sku: z.string().optional() })).meta({
        label: 'Lengths to choose from', widget: 'rows', kind: 'list', of: 'group',
        fields: [
          { key: 'minutes', label: 'Minutes', kind: 'number' },
          { key: 'price', label: 'Price, as written', kind: 'text' },
          { key: 'sku', label: 'Paid as', kind: 'reference', options: 'products' },
        ],
        help: 'the first is the default and must match the length above. Leave empty for a type of one length',
        shown: { field: 'scheduler', is: 'is-not', value: 'cal' },
      }).optional(),
      name: z.string().meta({ label: 'What the booking is called', help: 'where the title is not what belongs in a calendar — {reader}, {host}, {type} and {length} are filled in. Blank uses the title', shown: { field: 'scheduler', is: 'is-not', value: 'cal' } }).optional(),
      confirm: z.union([z.boolean(), z.literal('notice')]).meta({ label: 'You confirm it', grid: true, widget: 'select', choices: [{ value: false, label: 'No — booking it is enough' }, { value: 'notice', label: 'Only inside the minimum notice' }, { value: true, label: 'Always' }], help: 'a booking then waits for your yes. It holds the time from the moment it is made, so nobody else is offered it while you decide', shown: { field: 'scheduler', is: 'is-not', value: 'cal' } }).optional(),
      /* QUESTIONS ON THE WAY IN. What they answer is a form response like any other, so the desk
         reads it where it reads every other response — and a form that is gone or unpublished asks
         nothing rather than making the type unbookable. */
      form: z.string().meta({ label: 'Ask these questions first', kind: 'reference', options: 'forms', help: 'a form, run between choosing a time and confirming; the answers go to the host with the booking. Blank asks nothing', shown: { field: 'scheduler', is: 'is-not', value: 'cal' } }).optional(),
      /* THE BOOKING PAGE ITSELF — what it shows, what it lets somebody do afterwards, and where it
         sends them. One group, because these are the same decision said about different parts of
         one page; scattered, they are how a type ends up hiding the organiser and then naming them
         in the confirmation. Every switch defaults to yes, so a type that says nothing behaves as
         every type did before there was a block at all. */
      page: z.object({
        redirect: z.string().optional(), notes: z.boolean().optional(), organiser: z.boolean().optional(),
        details: z.boolean().optional(), zone: z.boolean().optional(),
        cancel: z.union([z.boolean(), z.literal('notice')]).optional(),
        reschedule: z.union([z.boolean(), z.literal('notice')]).optional(),
        past: z.boolean().optional(), account: z.boolean().optional(), hidden: z.boolean().optional(),
      }).meta({
        label: 'The booking page', widget: 'group', kind: 'group',
        fields: [
          { key: 'redirect', label: 'Send them to', kind: 'text', help: 'a url or a path on this site, instead of the confirmation' },
          { key: 'notes', label: 'Ask if there is anything else', kind: 'boolean', help: 'on unless turned off' },
          { key: 'organiser', label: 'Say whose session it is', kind: 'boolean', help: 'on unless turned off' },
          { key: 'details', label: 'Show the length, the place and the price', kind: 'boolean', help: 'on unless turned off' },
          { key: 'zone', label: 'Let them change the time zone', kind: 'boolean', help: 'off locks every time to the site\'s own' },
          { key: 'cancel', label: 'They may cancel', kind: 'select', choices: [{ value: true, label: 'Any time' }, { value: 'notice', label: 'Until the minimum notice' }, { value: false, label: 'Never' }] },
          { key: 'reschedule', label: 'They may move it', kind: 'select', choices: [{ value: true, label: 'Any time' }, { value: 'notice', label: 'Until the minimum notice' }, { value: false, label: 'Never' }] },
          { key: 'past', label: 'A past or cancelled one may still be moved', kind: 'boolean' },
          { key: 'account', label: 'Only somebody signed in may book it', kind: 'boolean' },
          { key: 'hidden', label: 'Off every list', kind: 'boolean', help: 'reachable by its own address alone — a link you give out' },
          { key: 'seatsLeft', label: 'Say how many seats are left', kind: 'boolean', help: 'a group session only — a nudge and a warning at once, and not every host wants either' },
          { key: 'attendees', label: 'Say who else is coming', kind: 'boolean', help: 'a group session only — somebody else\'s name on somebody else\'s screen, so it is off unless you say' },
        ],
        shown: { field: 'scheduler', is: 'is-not', value: 'cal' },
      }).optional(),
      /* A CAP IS REACHED, NOT APPROACHED: a day already at its count offers nothing more that day,
         whoever is free. Blank or 0 is no cap. */
      limits: z.object({
        day: z.number().int().optional(), week: z.number().int().optional(), month: z.number().int().optional(), year: z.number().int().optional(),
        minutesDay: z.number().int().optional(), minutesWeek: z.number().int().optional(),
      }).meta({
        label: 'How many of these, and how much of them', widget: 'group', kind: 'group',
        fields: [
          { key: 'day', label: 'A day', kind: 'number' }, { key: 'week', label: 'A week', kind: 'number' },
          { key: 'month', label: 'A month', kind: 'number' }, { key: 'year', label: 'A year', kind: 'number' },
          { key: 'minutesDay', label: 'Minutes a day', kind: 'number' }, { key: 'minutesWeek', label: 'Minutes a week', kind: 'number' },
        ],
        help: 'of THIS type, across every host — how many can be booked, and how long they add up to. Blank is no cap',
        shown: { field: 'scheduler', is: 'is-not', value: 'cal' },
      }).optional(),
      where: z.enum(['video', 'link', 'place', 'phone', 'none']).meta({ label: 'Where it happens', widget: 'select', choices: [{ value: 'video', label: 'A video room on this site' }, { value: 'link', label: 'A link' }, { value: 'place', label: 'In person' }, { value: 'phone', label: 'By phone' }, { value: 'none', label: 'Nowhere in particular' }], shown: { field: 'scheduler', is: 'is-not', value: 'cal' } }).optional(),
      link: z.string().meta({ label: 'The link', shown: [{ field: 'scheduler', is: 'is-not', value: 'cal' }, { field: 'where', is: 'is', value: 'link' }] }).optional(),
      place: z.string().meta({ label: 'The place\'s name', shown: [{ field: 'scheduler', is: 'is-not', value: 'cal' }, { field: 'where', is: 'is', value: 'place' }] }).optional(),
      address: z.string().meta({ label: 'The address', shown: [{ field: 'scheduler', is: 'is-not', value: 'cal' }, { field: 'where', is: 'is', value: 'place' }] }).optional(),
      phone: z.string().meta({ label: 'The number to call', help: 'blank asks the reader for theirs at booking', shown: [{ field: 'scheduler', is: 'is-not', value: 'cal' }, { field: 'where', is: 'is', value: 'phone' }] }).optional(),
      record: z.boolean().meta({ label: 'Record the session', shown: [{ field: 'scheduler', is: 'is-not', value: 'cal' }, { field: 'where', is: 'is', value: 'video' }] }).optional(),
      requires: z.union([z.string(), z.array(z.string())]).meta({ label: 'Who gets it', grid: true, help: 'anyone; guest = anyone without a membership; authenticated = signed in without one; a membership tier slug (that tier and every higher rank); or a list of tier slugs, which means exactly those and implies no ladder' }).optional(),
      below: z.string().meta({ label: 'Hidden from', help: 'a membership tier slug: not shown to that tier or any higher — for an option a tier gets included elsewhere' }).optional(),
      sku: z.string().meta({ label: 'Paid as', help: 'for a paid session: the sku of the product (kind session) it is bought under as it is booked; blank = included' }).optional(),
      monthly: z.number().int().meta({ label: 'Per month', grid: true, help: 'how many bookings of this in 30 days; 0 = no monthly limit' }).optional(),
      weekly: z.number().int().meta({ label: 'Per week', grid: true, help: 'how many bookings of this a week; 0 = no limit' }).optional(),
      order: z.number().int().meta({ label: 'Order', grid: true }).optional(),
      published: z.boolean().meta({ label: 'Published', grid: true }).optional(),
    }),
  },
  site: {
    name: 'Site settings', dir: 'content', body: false, title: 'name', single: 'site',
    assets: { dir: 'content/uploads/site' },   /* where an upload for a record lands; the field holds its address */
    options: {
      /* WHERE A HEADER LINK MAY GO. The sections a module answers, not every page under them: a
         select holding eight hundred articles is not a select. A module that is off contributes
         nothing, so a site cannot link at a route that would 404. The site's own landing pages
         come after, and "a path of my own" is the editor's escape, offered last by the control. */
      'nav-links': async (ctx) => {
        const out = []
        const at = new Set()
        const add = (value, label, group) => { if (at.has(value)) return; at.add(value); out.push({ value, label, group }) }
        const { default: SITE } = await import('#site').catch(() => ({ default: null })).then((m) => ({ default: m.default ?? m }))
        const M = (SITE && SITE.modules) || {}
        const on = (k) => M[k] !== false
        add('/', 'Home', 'The site')
        if (on('articles') || on('books') || on('wiki') || on('docs')) add('/content', 'Library', 'The site')
        if (on('articles')) add('/content/articles', 'Articles', 'The site')
        if (on('books')) add('/content/books', 'Books', 'The site')
        if (on('wiki')) add('/content/wiki', 'Wiki', 'The site')
        if (on('docs')) add('/content/docs', 'Docs', 'The site')
        if (on('store')) { add('/store', 'Store', 'The site'); add('/store/collections', 'Collections', 'The site') }
        if (on('spaces')) add('/community', 'Community', 'The site')
        if (on('instrument')) add('/app', 'The app', 'The site')
        /* the site's own landing pages, by their route — read through the store, which is what a
           model option is handed; cloud mode answers the rows the same way */
        try {
          for (const f of await ctx.store.list('content/pages')) {
            const { data } = ctx.matter(await ctx.store.read('content/pages/' + f + '.md') || '')
            if (data && data.route) add(data.route, data.title || data.route, 'Your pages')
          }
        } catch { /* a site with no pages */ }
        return out
      },
      /* WHO SEES IT. The rungs of the one access ladder, plus this site's own tiers by name, so
         nobody has to know that a tier is written `tier:inner`. Never a typed field. */
      'nav-see': async (ctx) => {
        const out = [
          { value: '', label: 'Everyone' },
          { value: 'guest', label: 'Signed out only' },
          { value: 'authenticated', label: 'Signed in' },
          { value: 'paid', label: 'Has bought something' },
          { value: 'subscribed', label: 'Subscribed' },
          { value: 'staff', label: 'Staff' },
        ]
        try {
          const seen = new Set()
          for (const f of await ctx.store.list('content/store/products')) {
            const { data } = ctx.matter(await ctx.store.read('content/store/products/' + f + '.md') || '')
            const t = data && data.tier
            if (t && !seen.has(t)) { seen.add(t); out.push({ value: 'tier:' + t, label: (data.title || t) + ' and above' }) }
          }
        } catch { /* a site with no store */ }
        return out
      },
    },
    fields: z.object({
      name: z.string().min(1).meta({ label: 'Site name', grid: true, help: 'appears after every page title' }),
      tagline: z.string().meta({ label: 'Tagline', help: 'the home page title: "Name — tagline"' }).optional(),
      description: z.string().meta({ label: 'Default description', widget: 'text', help: 'used wherever a page has none' }).optional(),
      url: z.string().meta({ label: 'Public address', help: 'https://… — canonical links and the sitemap; blank until the site is live' }).optional(),
      image: z.string().meta({ label: 'Default share image', widget: 'image', help: '1200×630 works everywhere' }).optional(),
      mark: z.string().meta({ label: 'Mark', widget: 'image', help: 'the small logo on a share card — an SVG or a PNG. Left empty, the theme draws its own.' }).optional(),
      twitter: z.string().meta({ label: 'X / Twitter handle', help: '@name, for share cards' }).optional(),
      /* THE HEADER. A list, in the order it is shown; drawn by NavField.vue, which asks for each
         part with a control that fits it — never a typed href, never a typed rung. Absent, the
         site inherits: its config's nav, else the theme's own (navOf in build/site.mjs). */
      nav: z.array(z.object({
        label: z.string().optional(),
        key: z.string().optional(),
        href: z.string(),
        icon: z.string().optional(),
        prefix: z.boolean().optional(),
        see: z.string().optional(),
        cta: z.boolean().optional(),
      })).meta({ label: 'Header', widget: 'nav', help: 'the links across the top, in this order. Left empty, the site shows what it inherits.' }).optional(),
      fonts: z.object({ heading: z.string().optional(), body: z.string().optional(), mono: z.string().optional() }).meta({ label: 'Typefaces', widget: 'fonts', help: 'the three faces the whole site is set in — chosen from the kit\'s list, never typed. A face left as the theme\'s follows the theme.' }).optional(),
      tokens: z.record(z.string(), z.any()).meta({ label: 'Colours', widget: 'tokens', help: 'every colour the look names — change what you like, and put any of them back. A colour nobody changed is not stored, so retuning the look reaches this site too.' }).optional(),
      look: z.enum(['classic']).meta({ label: 'Look', help: 'the visual design the whole site wears; one for now — a new one is added in src/looks (see AGENTS.md). The page builder\'s preview can show any of them without saving.' }).optional(),
    }),
  },
  storefront: {
    name: 'Storefront', dir: 'content/store', body: false, title: 'heroTitle', single: 'storefront',
    assets: { dir: 'content/uploads/storefront' },   /* where an upload for a record lands; the field holds its address */
    fields: z.object({
      heroEyebrow: z.string().meta({ label: 'Hero eyebrow' }).optional(),
      heroTitle: z.string().min(1).meta({ label: 'Hero title', grid: true }),
      heroSubtitle: z.string().meta({ label: 'Hero subtitle', widget: 'text' }).optional(),
      heroImage: z.string().meta({ label: 'Hero image', widget: 'image' }).optional(),
      heroCta: z.string().meta({ label: 'Primary button' }).optional(),
      heroHref: z.string().meta({ label: 'Primary button link', help: '#collections, /store/collections/books, a product page …' }).optional(),
      heroCta2: z.string().meta({ label: 'Second button' }).optional(),
      heroHref2: z.string().meta({ label: 'Second button link' }).optional(),
      collections: z.array(z.string()).meta({ label: 'Collection tiles', widget: 'list', help: 'collection ids in order — empty shows all' }).optional(),
      featured: z.array(z.string()).meta({ label: 'Featured rail', widget: 'list', help: 'product ids in order — empty shows the ones marked featured' }).optional(),
      shelves: z.array(z.string()).meta({ label: 'Shelves', widget: 'list', help: 'collections shown as shelves, in order — empty shows all' }).optional(),
      showMembership: z.boolean().meta({ label: 'Show the membership band', grid: true }).optional(),
      heroBooks: z.array(z.string()).meta({ label: 'Books in the hero', widget: 'list', help: 'book slugs, shown as printed books beside the words — up to three' }).optional(),
      showEditions: z.boolean().meta({ label: 'Show the "what an edition is" band', grid: true }).optional(),
      showCollections: z.boolean().meta({ label: 'Show the collection tiles', grid: true }).optional(),
      showFeatured: z.boolean().meta({ label: 'Show the featured rail', grid: true }).optional(),
      showOnline: z.boolean().meta({ label: 'Offer the book online', grid: true, help: 'off, the store is the printed books alone: a book\'s page is its print page, and no page mentions reading it online' }).optional(),
      shipping: z.any().meta({ label: 'Shipping', widget: 'raw', help: '{ countries: [US, CA, …] or exclude: […], default: 15, overrides: { US: 5 }, methods: [{ level: MAIL, label: Standard, days: "5-10" }, { level: PRIORITY_MAIL, label: Priority, plus: 6, days: "3-6" }] } — a whitelist or a blacklist of countries, a flat price with per-country overrides, and the printer\'s shipping levels as the buyer\'s choices' }).optional(),
    }),
  },
  collections: {
    name: 'Collections', dir: 'content/store/collections', body: true, title: 'title',
    assets: { dir: 'content/uploads/collections' },   /* where an upload for a record lands; the field holds its address */
    bodyLabel: 'Introduction (markdown) — shown at the top of the collection page',
    fields: z.object({
      published: z.boolean().meta({ label: 'Published', grid: true, help: 'off = kept in the backend, but not live' }).optional(),
      title: z.string().min(1).meta({ label: 'Title', grid: true }),
      subtitle: z.string().meta({ label: 'Subtitle' }).optional(),
      image: z.string().meta({ label: 'Image', widget: 'image' }).optional(),
      order: z.number().int().meta({ label: 'Order', grid: true }).optional(),
      featured: z.boolean().meta({ label: 'Featured', grid: true, help: 'the storefront hero' }).optional(),
      products: z.array(z.string()).meta({ label: 'Products', widget: 'list', help: 'product ids, in the order to show them' }).optional(),
    }),
  },

  docs: {
    name: 'Docs', dir: 'content/docs', body: true, nested: true, title: 'title',
    projected: projectedSearch,
    assets: { dir: 'content/uploads/docs' },   /* where an upload for a record lands; the field holds its address */
    bodyLabel: 'Page body (markdown)',
    fields: z.object({
      published: z.boolean().meta({ label: 'Published', grid: true, help: 'off = kept in the backend, but not live' }).optional(),
      title: z.string().min(1).meta({ label: 'Title', grid: true }),
      description: z.string().meta({ label: 'Description', widget: 'text' }).optional(),
      order: z.number().meta({ label: 'Order', grid: true }).optional(),
      author: z.string().meta({ label: 'Author', grid: true }).optional(),
      date: z.string().meta({ label: 'Date', widget: 'date' }).optional(),
      updated: z.string().meta({ label: 'Updated', widget: 'date' }).optional(),
      cover: z.string().meta({ label: 'Cover image', widget: 'image' }).optional(),
      tags: z.array(z.string()).meta({ label: 'Tags', grid: true, widget: 'tags', options: 'tags', help: 'what this is about — chosen from the site\'s list under Tags' }).optional(),
      related: z.array(z.string()).meta({ label: 'Related (slugs)' }).optional(),
      media: z.any().meta({ label: 'Media', widget: 'media', help: 'one track plays inline; two or more become a playlist' }).optional(),
      canAccess: ACCESS,
      comments: COMMENTS,
    }),
  },
}

/* ---- the parts the server carried, on their models ---- */
/*
 * A PRODUCT TYPE IS THE SUPPLIER'S FACT, AND THE SAVE REFUSES AN INVENTED ONE — by name, with the
 * ones it does sell. The same function the build and the till use (build/kinds/apparel.js), so
 * all three refuse the same file for the same reason and in the same words; a check written three
 * times is three checks that drift.
 */
COLLECTIONS.products.checks = [async (rec, ctx) => {
  const kind = String(rec.data.kind || '')
  if (kind !== 'apparel' && !rec.data.blueprint) return []
  const { checkBlueprint, checkValues } = await import('../../kinds/apparel.js')
  const { suppliersFor } = await import('../../suppliers.mjs')
  const id = String(rec.data.supplier || '')
  const x = id ? (await suppliersFor(ctx)).find((y) => y.id === id) : null
  if (!x) return [{ path: 'supplier', message: 'a product type comes from a supplier\u2019s catalogue, so this has to name one' }]
  if (typeof x.catalogue !== 'function') return [{ path: 'supplier', message: x.name + ' publishes no catalogue, so it cannot say which product types it sells' }]
  const types = typeof x.types === 'function' ? await x.types().catch(() => null) : null
  const bad = checkBlueprint(rec.data, types)
  if (bad) return [{ path: 'blueprint', message: bad }]
  const axes = await x.catalogue({ blueprint: rec.data.blueprint }).catch(() => null)
  const wrong = checkValues(rec.data.options, axes)
  return wrong ? [{ path: 'options', message: wrong }] : []
}]

COLLECTIONS.products.prepare = async (rec, ctx) => { if (!HEX8.test(String(rec.data.key || ''))) rec.data.key = await giveKey(ctx.store); return rec }

/*
 * REFRESH THE AXES FROM THE SUPPLIER'S CATALOGUE.
 *
 * Not a live fetch at the till and not a second kind of option: the catalogue is read now, the
 * rows are written into the file marked `from`, and everything afterwards reads them as it reads
 * a row somebody typed. What comes back is a report — what arrived, what the catalogue dropped —
 * because a shop that is no longer selling a colour has to be TOLD, and a value that went is
 * marked rather than deleted so a cart line or an unfulfilled order naming that variant still
 * reads as the words the buyer chose (`reconcileOptions` in _shared/variants.js has the why).
 */
COLLECTIONS.products.actions = {
  refresh: async (payload, ctx) => {
    const name = String(payload.name || '')
    if (!name) throw new Refusal(400, 'which product')
    const path = 'content/store/products/' + name + '.md'
    const raw = await ctx.store.read(path)
    if (!raw) throw new Refusal(404, 'no such product')
    const { data, content } = frontmatter.parse(raw)
    const id = String(data.supplier || '')
    if (!id) throw new Refusal(400, 'this product names no supplier, so there is no catalogue to read')
    const { suppliersFor } = await import('../../suppliers.mjs')
    const x = (await suppliersFor(ctx)).find((y) => y.id === id)
    if (!x) throw new Refusal(404, 'no supplier called ' + id)
    /* MOST SUPPLIERS PUBLISH NONE, and saying so is the right answer rather than silence: a
       printer makes what it is sent and has no opinion about colours. */
    if (typeof x.catalogue !== 'function') throw new Refusal(400, x.name + ' publishes no catalogue — its axes are the shop\u2019s own')
    const { reconcileOptions } = await import('../../variants.mjs')
    const fetched = await x.catalogue({ blueprint: data.blueprint, ...(data.variants || {}) }, { sku: data.sku })
    const { options, gone, added, changed } = reconcileOptions(data.options || [], fetched || [], { from: id })
    /*
     * AND THE PICTURES, asked for at the same moment. They are addresses, so a card, a gallery or
     * a picker shows one without fetching anything — and because this is the ADMIN rather than a
     * build, it works the same in git mode and in cloud mode, where nothing builds at all. A shop
     * that adds a colour in cloud mode has its mockup without a deploy.
     */
    let mockups = data.mockups || null
    if (typeof x.mockups === 'function') {
      const got = await x.mockups({ blueprint: data.blueprint, artwork: (data.design || {}).artwork, ref: data.supplier_ref }).catch(() => null)
      if (got && Object.keys(got).length) mockups = got
    }
    const samePics = JSON.stringify(mockups || null) === JSON.stringify(data.mockups || null)
    /* written through the model's own grammar, so a file that documents itself keeps its
       comments and only the rows that moved change */
    if (changed || !samePics) await ctx.store.write(path, frontmatter.serialise({ data: { ...data, options, ...(mockups ? { mockups } : {}) }, content }, { current: raw }))
    return { ok: true, changed: changed || !samePics, gone, added, options, mockups, supplier: { id, name: x.name } }
  },
}
COLLECTIONS.books.prepare = async (rec) => {
  const d = rec.data
  if (d.print && typeof d.print === 'object' && !HEX8.test(String(d.print.key || ''))) d.print = { key: await giveKey(ctx.store), ...d.print }
  /* a book's print switched off: the block goes, and its key with it (a sale already made keeps its key on the ledger) */
  if (d.print && typeof d.print === 'object' && d.print.on === false) delete d.print
  if (d.print && typeof d.print === 'object') { delete d.print.on; for (const k of Object.keys(d.print)) if (d.print[k] === '' || d.print[k] == null) delete d.print[k] }
  return rec
}
COLLECTIONS.books.checks = [async (rec, ctx) => {
  const d = rec.data
  if (!(d.print && typeof d.print === 'object')) return []
  /* the spine's foil holds so many characters of title and edition line together */
  const sp = spineWords(d.title, d.print.spine,
    SPINE_EDITION(await printWords(ctx.store || ctx.root, ctx.theme ? { theme: ctx.theme } : {})))
  return sp.fits ? [] : [{ path: 'print.spine', message: `the spine holds ${SPINE_MAX} characters of "${sp.title}" and "${sp.edition}" together — give the print block a spine title of ${sp.room} or fewer` }]
}]
/* a companion: its chapters against the book's, its quizzes for shape; then the body is rewritten in the canonical
   grammar (an editor's \[x\] escapes, a why: line, spacing) so the file reads the same way every time */
COLLECTIONS.companions.checks = [async (rec, ctx) => {
  const parsed = parseCompanion(matter.stringify('\n' + rec.content, rec.data, DUMP))
  let titles = null
  const book = await ctx.store.read('content/books/' + String(rec.data.book || '') + '.md')
  if (book != null) titles = bookChapterTitles(matter(book).content)
  const issues = validateCompanion(parsed, titles)
  if (!titles) issues.unshift({ path: 'book', message: 'no book called "' + rec.data.book + '"' })
  if (!issues.length) rec.content = matter(serialiseCompanion({ data: {}, chapters: parsed.chapters })).content
  return issues
},
/*
 * THE PREMISE'S AREA, CHECKED THROUGH THE STORE so that it is checked in both modes.
 *
 * The field offers its choices from `options: 'areas'`, which the pipe answers with
 * areaListOf(store) — but offering a list is not validating against one, and what validated was the
 * sync areaKeys(), which walks the diagnostics directory with readdirSync. In an Edge Function that
 * returns [] and the check passed anything: a companion could name an area no topic declares, its
 * premise would simply never be asked, and nothing anywhere would say why. It was the one entry in
 * FS_DEBT.
 *
 * areaKeys stays sync because zod schemas are built from it and a schema cannot await. A check can,
 * so the validation lives here rather than the list being made async underneath the schemas.
 */
async (rec, ctx) => {
  const area = String((rec.data || {}).statementArea || '').trim()
  if (!area) return []
  const { areaListOf } = await import('../../quiz-io.mjs')
  const areas = await areaListOf(ctx && ctx.store ? ctx.store : undefined)
  /* a site with no diagnostics at all has nothing to check against, and "not one of none" would be
     a worse thing to say to somebody than nothing */
  if (!areas.length) return []
  if (areas.some((a2) => a2.key === area)) return []
  return [{ path: 'statementArea', message: '"' + area + '" is not an area any topic declares — ' + areas.map((a2) => a2.key).join(', ') }]
}]
/* a page's sections, against the schemas that drew the builder's forms (the theme's, the site's merged) */
COLLECTIONS.pages.prepare = (rec) => { rec.data.sections = dropNulls(rec.data.sections); return rec }
/* a booking type's scheduler as the build infers it when the file leaves it out (cal.com with a cal.com url, else this site),
   shown so the editor folds the right fields; written back only when it says something the file would not */
COLLECTIONS.sessions.opened = (rec) => { if (!rec.data.scheduler) rec.data.scheduler = rec.data.url ? 'cal' : 'native'; return rec }
COLLECTIONS.sessions.prepare = (rec) => { if (rec.data.scheduler === (rec.data.url ? 'cal' : 'native')) delete rec.data.scheduler; return rec }
COLLECTIONS.pages.checks = [(rec, ctx) => (ctx.validateSections ? ctx.validateSections(rec.data.sections) : [])]
COLLECTIONS.experiments.checks = [(rec, ctx) => validateExperiment(rec.data, 'variants', ctx.store)]
COLLECTIONS.books.actions = {}   /* the enrichment runs are the server's own (a child process at a time, its log kept) */

export const COLLECTION_MODELS = Object.entries(COLLECTIONS).map(([key, m]) => ({ key, ...m }))
