/* A custom content model's entries as a model of the registry: the record a person built (content/models/<key>.md),
   its fields as the drawer's zod, the entry check (required, the rules, unique, references, shown-when) as its one
   check, uploads beside the entries, a rename allowed — and none of the parts a core model carries. */
import { z } from 'zod'
import { publishedModels, entryNames } from '../model-io.mjs'
import { schemaFor, modelWords, readEntries, checkEntry } from '../models.mjs'

export async function customModels(store: any) {
  return (await publishedModels(store)).map((m: any) => ({
    key: 'models/' + m.key, name: m.name, dir: 'content/models/' + m.key, body: !!m.body, bodyLabel: m.body || 'Body', title: m.title, model: m,
    single: m.singleton ? m.key : null, renames: true, module: 'models',
    assets: { dir: 'content/uploads/models/' + m.key },   /* where an upload for an entry lands; the field holds its address */
    fields: z.object({ published: z.boolean().meta({ label: 'Published', grid: true }).optional(), ...schemaFor(m, z, { admin: true }) }),
    checks: [async (rec: any, ctx: any) => {
      const words = await modelWords(ctx.store, ctx.theme ? { theme: ctx.theme } : {})
      const siblings = (await readEntries(ctx.store, m.key)).filter((e) => e.slug !== ctx.name).map((e) => e.data)
      const refs: any = {}
      for (const x of await publishedModels(ctx.store)) refs[(x as any).key] = new Set(await entryNames(ctx.store, (x as any).key))
      return checkEntry(m, rec.data, { siblings, refs, words }).map((e: any) => ({ path: e.field, message: e.message }))
    }],
  }))
}
