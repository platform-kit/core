/*
 * The one content pipe. Every markdown file the admin edits is a model of one registry — the kit's core
 * models (build/models/core: the twelve collections, forms, funnels, blasts, the policy, emails, the strings
 * scopes, the models themselves, print), a site's own (platformkit.config.js admin.models: a module exporting
 * `models`), and every published custom model (a record with none of the parts below) — and goes through the
 * same pipe: read by its model's grammar, checked by its fields and checks, written back by the grammar, then
 * its hook. A model record:
 *
 *   key, name, dir, ext ('md'), title, module, single, body, bodyLabel, nested, assets, builder, variants,
 *   count(names)  the number the rail shows, where the records are a tree and their length would mislead
 *   fields      a zod object over the frontmatter (the drawer's form, the write's first check), or null
 *   grammar     { parse(text, ctx) → { data, content, parsed }, serialise(rec, ctx) → text }; the default is
 *               frontmatter + body through gray-matter, written as the admin always wrote it
 *   editor      the theme component that draws the record when a form from its fields is not enough
 *   names(ctx)  the records' names (default: the .md files under dir); file(name, ctx) → the path
 *   summary(rec, ctx)   extra fields for the grid's row
 *   prepare(rec, ctx)   before the checks: a key given once, empty values dropped
 *   opened(rec, ctx)    a record as the editor opens it: a value the file leaves out but the build infers, shown as the build reads it
 *   checks      [(rec, ctx) → [{ path, message }]] beyond the fields
 *   after(rec, ctx)     once the write has landed: a compile, a copy beside the functions
 *   beforeRemove(name, ctx) / afterRemove(name, ctx)
 *   actions     { <name>: (payload, ctx) → result | { stream, type, size } }   named operations
 *   options     { <key>: (ctx) → [{ value, label }] }   option lists a select draws from
 *
 *   registry(root)             every model, keys unique, each normalised
 *   list / read / write / remove / rename / runAction / optionList   the pipe
 *   describe(model)            the client's shape (fields through describeSchema)
 *
 * Every path is relative to the site's root and goes through the store (build/store: the checkout, or the
 * rows of cloud mode) — nothing here or in a model opens the disk itself; `ctx.store` is what a model reads
 * and writes with, `ctx.root` the site's root for what needs one (a script). The pipe is the same file in
 * the dev server and in the `admin` function.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gitStore, collectionOf } from '../store/index.mjs'
import matter from 'gray-matter'
import { describeSchema } from '../admin-schemas.mjs'
import { loadSite } from '../site.mjs'
import { CORE } from './core/index.mjs'
import { customModels } from './custom.mjs'

export * from './util.mjs'
import { NAME_RE, DUMP, normDates, compact, cleanData, frontmatter, script, Refusal } from './util.mjs'

/* ---- the records ---- */
export function normalise(m, from) {
  if (!m || typeof m !== 'object' || !m.key) throw new Error(`${from}: a model needs a key`)
  return { name: m.key, ext: 'md', title: 'title', body: false, bodyLabel: 'Body', nested: false, single: null, assets: null, fields: null, grammar: frontmatter, checks: [], actions: {}, options: {}, ...m, from }
}
let SITE_MODELS = null
/* opts: site (the config, read from root otherwise), siteModels (the site's models given, as the function gives them), store */
export async function registry(root = process.cwd(), { site, siteModels, store } = {}) {
  const c = site || await loadSite(root)
  const out = [], seen = new Map()
  const add = (m, from) => { const r = normalise(m, from); if (seen.has(r.key)) throw new Error(`${from}: model ${r.key} is already declared by ${seen.get(r.key)}`); if (r.module && c.modules && c.modules[r.module] === false) return; seen.set(r.key, from); out.push(r) }
  for (const m of CORE) add(m, 'the kit')
  if (siteModels) for (const m of siteModels) add(m, 'the site')
  else if (c.admin && c.admin.models) {
    if (!SITE_MODELS) SITE_MODELS = (await import(pathToFileURL(path.resolve(c.root, c.admin.models)).href)).models || []
    for (const m of SITE_MODELS) add(m, `the site (${c.admin.models})`)
  }
  for (const m of await customModels(store || gitStore(c.root))) add(m, 'a custom model')
  return out
}
export const byKey = (models, key) => models.find((m) => m.key === key) || null

/* ---- the pipe ---- */
/* a record's file, relative to the root: <dir>/<name>.<ext>, the name kept under its dir */
export function fileOf(model, name, root) {
  if (model.file) return model.file(name, { root })
  if (!name || !NAME_RE.test(name)) throw new Refusal(400, 'bad name')
  const file = path.posix.join(model.dir, name + '.' + model.ext)
  if (!file.startsWith(model.dir + '/')) throw new Refusal(400, 'bad path')
  return file
}
export async function namesOf(model, root, store) {
  const st = store || gitStore(root)
  if (model.names) return model.names({ root, store: st })
  if (model.single) return [model.single]
  return (await st.list(model.dir, { ext: model.ext, deep: true })).filter(() => model.ext === 'md')
}
/* what a model is handed: the store it reads and writes with, the root and a script runner for what needs a machine */
const ctxOf = (model, root, extra) => { const store = extra.store || gitStore(root); return { root, model, store, path, matter, script: (n, a, env) => (store.kind === 'git' ? script(n, a, root, env) : Promise.resolve({ skipped: 'the deploy runs it' })), ...extra, store } }   /* a script needs a machine: over the rows it waits for the deploy */

export async function read(model, name, root, extra = {}) {
  const ctx = ctxOf(model, root, { name, ...extra })
  if (model.read) return { name, ...(await model.read(name, ctx)) }
  const file = fileOf(model, name, root)
  const text = await ctx.store.read(file)
  if (text == null) throw new Refusal(404, 'no such file')
  const rec = { name, ...(await model.grammar.parse(text, { ...ctx, file })) }
  return model.opened ? (await model.opened(rec, ctx)) || rec : rec
}
export async function list(model, root, extra = {}) {
  const ctx = ctxOf(model, root, extra)
  if (model.list) return model.list(ctx)
  const items = []
  /* cloud mode: a row with a draft wears the mark (the checkout has none) */
  const drafted = new Set(ctx.store.kind === 'rows' ? (await ctx.store.drafts()).map((d) => d.path) : [])
  for (const name of await namesOf(model, root, ctx.store)) {
    const rec = await read(model, name, root, extra)
    const content = String(rec.content || '')
    items.push({ name, data: rec.data || {}, words: content.trim().split(/\s+/).filter(Boolean).length, headings: (content.match(/^# /gm) || []).length, ...(drafted.has(fileOf(model, name, root)) ? { draft: true } : {}), ...(model.summary ? model.summary(rec, ctx) : {}) })
  }
  return items
}
/* what waits to be published (cloud mode): every draft with the model it belongs to */
export async function drafts(models, root, extra = {}) {
  const store = extra.store || gitStore(root)
  if (store.kind !== 'rows') return []
  const out = []
  for (const d of await store.drafts()) {
    /* the deepest directory the path is under, a collection before a single record (the site's own dir is content/, over every other) */
    const m = models.filter((x) => d.path.startsWith(x.dir + '/')).sort((x, y) => (y.single ? 0 : 1) - (x.single ? 0 : 1) || y.dir.length - x.dir.length)[0]
    out.push({ ...d, col: m ? m.key : null, label: m ? m.name : d.collection, name: m ? d.path.slice(m.dir.length + 1).replace(new RegExp('\\.' + m.ext + '$'), '') : d.slug })
  }
  return out
}
/* a draft's checks before it goes live: the fields and the model's checks over the record as the admin reads it */
async function checkDraft(model, name, root, extra) {
  const ctx = ctxOf(model, root, { name, ...extra })
  const rec = await read(model, name, root, extra)
  if (model.fields) { const r = model.fields.safeParse(compact(rec.data)); if (!r.success) throw new Refusal(422, 'validation', { issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })), name }) }
  for (const check of model.checks) { const issues = await check({ name, data: compact(rec.data), content: rec.content || '', parsed: rec.parsed }, ctx); if (issues && issues.length) throw new Refusal(422, 'validation', { issues, name }) }
}
/* one record published (cloud mode): its draft made the live version, pending for the push — after its checks;
   a draft removal needs none */
/*
 * A MODEL WHOSE DECLARATION HAS A PROJECTION says so with `projected`, and it runs HERE — after the
 * publish, never after a write.
 *
 * Over a checkout the two are the same moment and `after` does it. Over rows they are not: a write
 * is a draft nobody should see, so projecting there would put an unpublished team, or an unsigned
 * set of terms, live the instant somebody typed it. A publish is the moment the declaration changed.
 *
 * It is separate from `after` for the other half of the same reason: `after` runs scripts, which
 * need a machine, and a projection is a handful of database writes that does not. A deployment with
 * git out of the cycle and no deploy hook never builds again, and everything it declares would
 * otherwise never reach a row.
 */
/*
 * WHAT A PUBLISH HAS TO COMPILE, where nothing is going to build.
 *
 * Some of what the Edge Functions read is not content but a COMPILE of it — the catalog above all:
 * what is for sale, the booking types, the tiers. On a machine the build writes it as a file beside
 * the functions and the deploy ships it, which is right; an Edge Function that recompiled the
 * catalog per request would read a hundred records to answer one question.
 *
 * Cloud mode with the repository out of the cycle and no deploy hook never builds again, so the file
 * it shipped with is the last one it will ever have. There a publish compiles what it changed into
 * `public.compiled`, and the functions read that row over their file (_shared/compiled.ts).
 *
 * It is written on every cloud publish, not only where nothing rebuilds: a row that agrees with the
 * file costs nothing and means the deployment never has to know which shape it is.
 */
export const FEEDS = {
  products: 'catalog', collections: 'catalog', storefront: 'catalog', sessions: 'catalog', books: 'catalog', teams: 'catalog',
  forms: 'forms',
  funnels: 'funnels', blasts: 'funnels', policy: 'funnels',
  emails: 'emails',
}
const COMPILE = {
  /* the theme's scopes come from the caller: in a function there is no manifest on a disk to read,
     and without them the checkout would lose its words and a spine its edition line */
  catalog: async (store, made, extra = {}) => (await import('../catalog.mjs')).compileCatalog({ store, theme: extra.theme || null, brand: extra.brand || null }),
  forms: async (store) => {
    const { compileForms } = await import('../forms.mjs')
    const { forms, faults } = await compileForms(store)
    if (faults.length) throw new Error(faults.join('; '))
    return forms
  },
  /* the funnels lean on the catalog for a book's skus, so they are compiled after it and given what
     it made rather than reading a file neither of them has */
  funnels: async (store, made) => (await import('../funnels.mjs')).compileFunnels({ store, write: false, offers: (made.catalog || {}).offers || null }),
  /* a design is compiled the way the admin's own Test compiles one — @templatical/renderer and
     MJML's browser build, neither of which is a Node package. The kit's fallbacks are bundled
     beside the pipe, since there is no package directory to read in a function. */
  emails: async (store, made, extra = {}) => {
    const { KINDS } = await import('../../supabase/functions/_shared/emails/tags.js')
    const { compileDesigns } = await import('../emails-compile.mjs')
    let kit = {}
    try { kit = (await import('../../kit-designs.json', { with: { type: 'json' } })).default } catch { /* on a machine the build reads the package */ }
    const { designs, faults } = await compileDesigns({ store, kinds: KINDS, kitDesign: (k) => kit[k] || null, ...(extra.compileDesign ? { compile: extra.compileDesign } : {}) })
    if (faults.length) throw new Error(faults.join('; '))
    return designs
  },
}
async function recompile(keys, root, extra) {
  const store = extra.store
  if (!store || store.kind !== 'rows' || !store.client) return   /* a checkout builds; this is for rows */
  const want = [...new Set(keys.map((k) => FEEDS[k]).filter(Boolean))]
  /* the catalog first where both are wanted: the funnels read what it made */
  const made = {}
  for (const name of want.sort((a, b) => (a === 'catalog' ? -1 : b === 'catalog' ? 1 : 0))) {
    try {
      const data = await COMPILE[name](store, made, extra)
      made[name] = data
      const { error } = await store.client.from('compiled').upsert({ path: name, data, updated_at: new Date().toISOString(), updated_by: extra.by || null }, { onConflict: 'path' })
      if (error) throw new Error(error.message)
    } catch (e) {
      /* a compile that refuses says why and the publish stands: the records are live either way, and
         an artefact nobody could compile is one the old file still answers for */
      console.warn('compiled: ' + name + ' — ' + (e && e.message ? e.message : e))
    }
  }
}

const projected = async (model, root, extra) => {
  if (!model || !model.projected) return
  try { await model.projected(ctxOf(model, root, extra)) }
  catch (e) { console.warn((model.key || 'a model') + ': not projected — ' + (e && e.message ? e.message : e)) }
}

export async function publish(model, name, root, extra = {}) {
  const store = extra.store || gitStore(root)
  if (!store.publish) return { ok: true, published: [] }
  const file = fileOf(model, name, root)
  const d = (await store.drafts()).find((x) => x.path === file)
  if (!d) throw new Refusal(404, 'nothing drafted here')
  if (!d.removed) await checkDraft(model, name, root, extra)
  const out = await store.publish([file])
  await projected(model, root, extra)
  await recompile([model.key], root, extra)
  return { ok: true, published: out }
}
/* every draft published: each edit checked against its model first (a removal, or a draft of no model, goes as it is) */
export async function publishAll(models, root, extra = {}) {
  const store = extra.store || gitStore(root)
  if (!store.publish) return { ok: true, published: [] }
  for (const d of await drafts(models, root, extra)) {
    if (d.removed || !d.col) continue
    await checkDraft(byKey(models, d.col), d.name, root, extra)
  }
  const was = await drafts(models, root, extra)
  const out = await store.publish('all')
  /* one projection per kind that was in the publish, not one per record */
  const keys = [...new Set(was.map((x) => x.col).filter(Boolean))]
  for (const key of keys) await projected(byKey(models, key), root, extra)
  await recompile(keys, root, extra)
  return { ok: true, published: out }
}
/* a draft removal called off */
export async function keep(models, path, root, extra = {}) {
  const store = extra.store || gitStore(root)
  if (store.keep) await store.keep(path)
  return { ok: true }
}
/* a write: prepare → the fields → the checks → the grammar → the file → the hook; refused before anything is written */
export async function write(model, name, rec, root, { create = false, ...extra } = {}) {
  const ctx = ctxOf(model, root, { name, create, ...extra })
  let record = { name, data: compact(rec.data), content: rec.content || '', parsed: rec.parsed }
  if (model.prepare) record = (await model.prepare(record, ctx)) || record
  /*
   * THE TAG VOCABULARY, ON EVERY SAVE THAT CARRIES TAGS.
   *
   * Here rather than on each collection because it is the same answer for all of them, and five
   * copies of one rule is how four of them end up agreeing and the fifth does not. Free tagging on:
   * a tag the writer typed joins the list, so the list stays the whole truth about what tags exist.
   * Off: a tag the list does not hold is refused outright rather than quietly dropped — the field
   * offered a closed list, so a value outside it is a bug somewhere, not a new tag, and saying so
   * is how it gets found. Either way what is written is normalised, so one tag has one spelling.
   *
   * The record for the vocabulary itself is skipped: its own `tags` field IS the list.
   */
  if (model.key !== 'tags' && Array.isArray(record.data && record.data.tags)) {
    const { learnTags } = await import('../tags.mjs')
    const r = await learnTags(ctx.store, record.data.tags)
    if (r.refused.length) {
      throw new Refusal(422, 'validation', { issues: [{ path: 'tags',
        message: (r.refused.length === 1 ? 'there is no tag ' : 'there are no tags ') + r.refused.map((v) => `"${v}"`).join(', ') + ' — add it under Tags, or let writers add their own there' }] })
    }
    record = { ...record, data: { ...record.data, tags: r.values } }
  }
  if (model.fields) {
    const r = model.fields.safeParse(record.data)
    if (!r.success) throw new Refusal(422, 'validation', { issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
  }
  for (const check of model.checks) { const issues = await check(record, ctx); if (issues && issues.length) throw new Refusal(422, 'validation', { issues }) }
  /* a save asked to look first (check: true): the model's preflight answers what would go wrong, and nothing is written */
  if (extra.check && model.preflight) { const r = await model.preflight(record, ctx); if (r) return { ok: false, ...r } }
  const file = fileOf(model, name, root)
  const current = await ctx.store.read(file)
  const exists = current != null
  if (create && exists) throw new Refusal(409, 'a file with that name already exists')
  if (!create && !exists && !model.creates) throw new Refusal(404, 'no such file')
  const text = await model.grammar.serialise(record, { ...ctx, file, current })
  await ctx.store.write(file, text, { ...collectionOf(file), data: record.data, body: record.content, published: record.data && record.data.published !== false, by: ctx.by })
  const after = model.after ? await model.after(record, { ...ctx, file }) : undefined
  return { ok: true, name, ...(after && typeof after === 'object' ? after : {}) }
}
export async function remove(model, name, root, extra = {}) {
  const ctx = ctxOf(model, root, { name, ...extra })
  if (model.beforeRemove) await model.beforeRemove(name, ctx)
  const file = fileOf(model, name, root)
  if (!(await ctx.store.exists(file))) throw new Refusal(404, 'no such file')
  await ctx.store.remove(file)
  if (model.afterRemove) await model.afterRemove(name, ctx)
  return { ok: true }
}
export async function rename(model, name, to, root, extra = {}) {
  if (!model.renames) throw new Refusal(400, 'this kind of record is not renamed')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(to))) throw new Refusal(400, 'a slug is lower-case words joined by hyphens')
  const ctx = ctxOf(model, root, extra)
  const from = fileOf(model, name, root), dest = fileOf(model, String(to), root)
  if (await ctx.store.exists(dest)) throw new Refusal(409, 'an entry with that slug exists')
  await ctx.store.rename(from, dest)
  return { ok: true, name: String(to) }
}
export async function runAction(model, action, payload, root, extra = {}) {
  const fn = model.actions[action]
  if (!fn) throw new Refusal(400, `${model.key} has no action "${action}"`)
  return fn(payload || {}, ctxOf(model, root, extra))
}
export async function optionList(models, key, root, extra = {}) {
  for (const m of models) if (m.options[key]) return m.options[key](ctxOf(m, root, extra))
  return []   /* a list no model of this site provides (the theme's `topics` on a site with no instrument): the field simply offers nothing */
}
/* the client's shape: the nav, the grid and the drawer are drawn from this */
export async function describe(model, root, store) {
  let count = 1
  /* the rail's number. A model whose records are a tree says its own — the spaces' number is its
     spaces, not the rooms under them, and "4" beside Spaces would say four spaces to anybody. */
  if (!model.single) { try { const names = await namesOf(model, root, store); count = model.count ? model.count(names) : names.length } catch { count = 0 } }
  return {
    key: model.key, label: model.name, dir: model.dir, body: !!model.body, bodyLabel: model.bodyLabel, nested: !!model.nested, title: model.title,
    assets: !!model.assets, single: model.single, builder: model.builder || null, variants: model.variants || null, editor: model.editor || null,
    model: model.model ? { key: model.model.key, name: model.model.name, singular: model.model.singular, slug: model.model.slug, deliver: model.model.deliver, order: model.model.order } : null,
    core: model.from === 'the kit' || (model.from || '').startsWith('the site'), custom: !!model.model,
    fields: model.fields ? describeSchema(model.fields) : [],
    count,
  }
}
