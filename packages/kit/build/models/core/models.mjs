/* The content models themselves: a record each under content/models (build/model-io.mjs) — the grammar; the builder is the
   editor. The record: data the model as the builder holds it. A save writes the file through the writer and is refused
   with its faults; `check` runs every entry against a draft; a delete is refused while entries exist; a field renamed is
   carried into every entry, a model renamed moves its folder. The dev server watches the files and lets velite start over. */
import { z } from 'zod'
import { Refusal } from '../util.mjs'
import { readModel, writeModel, readModels, entryNames, modelNames, publishedModels, renameField, renameModel, keyOk, fieldKeyOk, DIR } from '../../model-io.mjs'
import { modelWords, readEntries, validateEntry } from '../../models.mjs'

async function failing(ctx, model) {
  const words = await modelWords(ctx.store, ctx.theme ? { theme: ctx.theme } : {})
  const entries = await readEntries(ctx.store, model.key)
  const refs = {}
  for (const m of await publishedModels(ctx.store)) refs[m.key] = new Set(await entryNames(ctx.store, m.key))
  const out = []
  for (const e of entries) { const r = validateEntry(model, e.data, { siblings: entries.filter((o) => o !== e).map((o) => o.data), refs, words }, z); if (!r.ok) out.push({ slug: e.slug, messages: r.errors.map((x) => x.message) }) }
  return out
}
const clean = (m) => { const { model, errors } = readModel(writeModel(m), m.key); if (errors.length) throw new Refusal(422, errors.join('\n'), { errors }); return model }

export default {
  key: 'models', name: 'Models', dir: DIR, title: 'name', module: 'models', editor: 'ModelBuilder', creates: true,
  names: (ctx) => modelNames(ctx.store),
  read: async (name, ctx) => { const x = (await readModels(ctx.store)).find((m) => m.name === name); if (!x) throw new Refusal(404, 'no such model'); return { data: x.model, content: '', errors: x.errors, entries: (await entryNames(ctx.store, name)).length } },
  list: async (ctx) => { const out = []; for (const x of await readModels(ctx.store)) out.push({ name: x.name, key: x.name, data: x.model || {}, title: x.model ? x.model.name : x.name, published: x.model ? x.model.published : false, fields: x.model ? x.model.fields.length : 0, entries: (await entryNames(ctx.store, x.name)).length, deliver: x.model ? Object.keys(x.model.deliver).filter((k) => x.model.deliver[k]) : [], errors: x.errors }); return out },
  grammar: {
    parse: (text, ctx) => { const { model, errors } = readModel(text, ctx.name); return { data: model, content: '', errors } },
    serialise: (rec, ctx) => { if (!rec.data || !keyOk(rec.data.key) || rec.data.key !== ctx.name) throw new Refusal(400, 'a key is lower-case letters, digits and hyphens, and the file\'s name'); return writeModel(clean(rec.data)) },
  },
  /* a save that changes a kind or a rule under entries asks first: { check: true } answers the failing entries instead of writing */
  preflight: async (rec, ctx) => { const f = await failing(ctx, clean(rec.data)); return f.length ? { failing: f } : null },
  beforeRemove: async (name, ctx) => { const n = (await entryNames(ctx.store, name)).length; if (n) throw new Refusal(409, 'entries', { entries: n }) },
  actions: {
    check: async ({ model }, ctx) => ({ failing: await failing(ctx, clean(model)) }),
    'rename-field': async ({ key, from, to }, ctx) => { if (!keyOk(String(key || '')) || !fieldKeyOk(String(from || '')) || !fieldKeyOk(String(to || ''))) throw new Refusal(400, 'bad key'); return { ok: true, carried: await renameField(ctx.store, key, from, to) } },
    'rename-model': async ({ from, to }, ctx) => { from = String(from || ''); if (!keyOk(from) || !(await modelNames(ctx.store)).includes(from)) throw new Refusal(404, 'no such model'); return { ok: true, carried: await renameModel(ctx.store, from, String(to || '')) } },
  },
  options: {
    /* a model's entries by slug and title, for the reference selects — options?key=model:<key> is answered by the pipe's prefix rule */
  },
}
