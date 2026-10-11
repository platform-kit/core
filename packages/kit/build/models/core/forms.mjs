/* The forms: a forms.md document each under content/forms, read by the kit's parser into the model the builder edits
   and written back through forms.md's Composer (build/form-io.mjs) — the grammar; the builder is the editor; a save
   compiles the forms beside the functions (build/forms.mjs). The record: data { title, published }, content the
   document, parsed the builder's model. */
import { Refusal } from '../util.mjs'
import { parseForm } from '../../../src/lib/forms/parse.js'
import { serialiseForm, DIR, slugOk } from '../../form-io.mjs'

export default {
  key: 'forms', name: 'Forms', dir: DIR, title: 'title', module: 'forms', editor: 'FormBuilder', creates: true,
  grammar: {
    parse: (text) => { const model = parseForm(text); return { data: { title: model.title || '', published: model.kit.published !== false }, content: text, parsed: model } },
    /* the model as the builder holds it (raw parts kept, dirty parts composed), parsed again and refused with its errors */
    serialise: (rec, ctx) => {
      if (!rec.parsed || typeof rec.parsed !== 'object') throw new Refusal(400, 'no model')
      const text = serialiseForm(rec.parsed, ctx.current)
      const back = parseForm(text)
      if (back.errors.length) throw new Refusal(422, back.errors.map((e) => `${e.line ? 'line ' + e.line + ': ' : ''}${e.message}`).join('\n'))
      return text
    },
  },
  summary: (rec) => { const m = rec.parsed; return { title: m.title || rec.name, published: m.kit.published !== false, once: m.kit.once, page: m.settings.page, fields: m.fields.length, quiz: Object.keys(m.kit.score).length, slides: m.slides.length, warnings: m.warnings, errors: m.errors, bytes: rec.content.length } },
  after: (rec, ctx) => ctx.script('forms.mjs'),
  afterRemove: (name, ctx) => ctx.script('forms.mjs'),
  actions: {
    /* a new form from a starter document: a start slide, one question, the end */
    create: async ({ name, title }, ctx) => {
      name = String(name || '')
      if (!slugOk(name)) throw new Refusal(400, 'the name is lower-case words joined by hyphens')
      const file = DIR + '/' + name + '.md'
      if (await ctx.store.exists(file)) throw new Refusal(409, 'a form of that name exists')
      title = String(title || name).replace(/\n/g, ' ').trim()
      const doc = `#! title = ${title}\n#! page-progress = show\n\n-> start\n\n# ${title}\n\n---\n\nname* = TextInput(\n\t| question = What should we call you?\n)\n\n---\n\n-> end\n\n# Thank you\n`
      await ctx.store.write(file, doc, { collection: 'forms', slug: name, data: { title }, body: doc })
      await ctx.script('forms.mjs')
      return { ok: true, name }
    },
  },
}
