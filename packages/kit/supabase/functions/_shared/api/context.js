/*
 * The context the doors share over one index — the maps every shaping needs (models by key, types by model, records by
 * id, assets by id and address), the caller's footing (preview, gated, locale), where the images door is, and the Rich
 * Text memo: a markdown field is converted once per record version and kept, so a book's eighty chapters cost one
 * conversion and never one per request. Plain JavaScript; the converter is richtext.js, shared by the function and
 * the build's test.
 */
import { richTextFromMarkdown } from './richtext.js'
import { entryId, assetId } from './ids.js'
import { stripMarks } from './entry.js'

const memo = new Map()
const MEMO_MAX = 5000
export async function richText(md, key, ctx) {
  if (key && memo.has(key)) return memo.get(key)
  let doc
  try { doc = richTextFromMarkdown(stripMarks(md), ctx) } catch { doc = { nodeType: 'document', data: {}, content: [{ nodeType: 'paragraph', data: {}, content: [{ nodeType: 'text', value: String(md || ''), marks: [], data: {} }] }] } }
  if (key) { if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value); memo.set(key, doc) }
  return doc
}

/* `index`: { space, site, locales, models, types, records, assets }; `records` here are the door's — the published
   ones, or under a preview key the drafts and every entry */
export function makeContext(index, { preview = false, gated = false, locale = null, imagesBase = '' } = {}) {
  const allLocales = locale === '*'
  const code = !locale || locale === '*' ? (index.locales.find((l) => l.default) || index.locales[0] || { code: 'en' }).code : locale
  const records = index.records.filter((r) => r.typeId && (preview || r.published))
  const ctx = {
    space: index.space, site: index.site, locales: index.locales, models: index.models, types: index.types.map(({ _model, ...t }) => t),
    modelsByKey: new Map(index.models.map((m) => [m.key, m])), typesByModel: new Map(index.types.map((t) => [t._model, t])),
    records, recordsById: new Map(records.map((r) => [entryId(r.typeId, r.path), r])),
    assets: [...index.assets], assetsByAddress: new Map(index.assets.map((a) => [a.address, a])), assetsById: new Map(index.assets.map((a) => [assetId(a.address), a])),
    preview, gated, locale: code, allLocales, imagesBase, rich: (md, key) => richText(md, key, ctx),
  }
  return ctx
}
