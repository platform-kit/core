/*
 * Content types, from what the admin knows about every model — the registry's description of a model's fields (name,
 * type, widget, kind, choices, sub-fields) turned into Contentful's content types, once, for the build's index and the
 * function alike (plain JavaScript: no environment, no imports). A field added in the builder is here on the next read.
 *
 *   string · string/text/url/email → Symbol (Text for a long text); image → Link to Asset; date/datetime → Date;
 *   select naming a model (`options: books`, `model:teachers`, or kind reference) → Link to Entry; select → Symbol with
 *   an `in` validation of its choices; number → Number; boolean → Boolean; list/multiselect/tags → Array of Symbol (an
 *   `in` validation when the choices are fixed); markdown → RichText, with the markdown beside it as `<field>Markdown`;
 *   group → Object; rows (a list of groups) → Array of Object; raw → Object. `published` is the status, never a field;
 *   a model with a body gets `body` (RichText) and `bodyMarkdown`.
 */
import { typeIdOf } from './ids.js'

const modelKeyOf = (options, models) => {
  if (!options) return null
  const o = String(options)
  const key = o.startsWith('model:') ? 'models/' + o.slice(6) : o
  return models.some((m) => m.key === key && m.fields) ? key : null
}
const title = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

/* one described field → Contentful's field records (two for markdown), or none for a status field */
export function fieldsOf(f, models) {
  if (f.name === 'published') return []
  const base = { id: f.name, name: f.label || title(f.name), localized: false, required: !!f.required, disabled: false, omitted: false, validations: [] }
  const choices = (f.choices || []).map((c) => (c && typeof c === 'object' ? c.value : c)).filter((v) => v != null)
  const kind = f.kind || ''
  const ref = kind === 'reference' ? (f.of ? 'models/' + String(f.of).replace(/^models\//, '') : modelKeyOf(f.options, models)) : (f.widget === 'select' ? modelKeyOf(f.options, models) : null)
  if (kind === 'markdown') return [{ ...base, type: 'RichText' }, { ...base, id: f.name + 'Markdown', name: base.name + ' (markdown)', type: 'Text' }]
  if (kind === 'image' || f.widget === 'image') return [{ ...base, type: 'Link', linkType: 'Asset' }]
  if (ref) {
    const m = models.find((x) => x.key === ref)
    const link = { type: 'Link', linkType: 'Entry', validations: [{ linkContentType: [typeIdOf(m)] }] }
    return kind === 'reference' && f.multiple ? [{ ...base, type: 'Array', items: link }] : [{ ...base, ...link }]
  }
  if (kind === 'list' && f.of === 'group') return [{ ...base, type: 'Array', items: { type: 'Object' } }]
  if (f.type === 'boolean') return [{ ...base, type: 'Boolean' }]
  if (f.type === 'number') return [{ ...base, type: f.integer ? 'Integer' : 'Number' }]
  if (f.widget === 'date' || f.widget === 'datetime' || kind === 'date' || kind === 'datetime') return [{ ...base, type: 'Date' }]
  if (f.type === 'enum' || f.widget === 'select') return [{ ...base, type: 'Symbol', validations: choices.length ? [{ in: choices }] : [] }]
  if (f.type === 'multienum' || f.type === 'list' || f.widget === 'multiselect' || f.widget === 'list' || kind === 'tags' || kind === 'multi-select') {
    if (kind === 'list' && f.of === 'group') return [{ ...base, type: 'Array', items: { type: 'Object' } }]
    return [{ ...base, type: 'Array', items: { type: 'Symbol', validations: choices.length ? [{ in: choices }] : [] } }]
  }
  if (kind === 'group' || f.type === 'raw' || f.type === 'object' || f.widget === 'rows') return [{ ...base, type: 'Object' }]
  if (f.widget === 'text' || kind === 'long-text' || kind === 'long text') return [{ ...base, type: 'Text' }]
  return [{ ...base, type: 'Symbol' }]
}

/* every content type of a site: the models with fields, in the registry's order */
export function contentTypes(models, { space = '', now = new Date().toISOString() } = {}) {
  return models.filter((m) => m.fields && m.fields.length).map((m) => {
    const fields = m.fields.flatMap((f) => fieldsOf(f, models))
    if (m.body) fields.push({ id: 'body', name: m.bodyLabel || 'Body', type: 'RichText', localized: false, required: false, disabled: false, omitted: false, validations: [] }, { id: 'bodyMarkdown', name: (m.bodyLabel || 'Body') + ' (markdown)', type: 'Text', localized: false, required: false, disabled: false, omitted: false, validations: [] })
    const id = typeIdOf(m)
    const display = ['title', 'name', 'label'].find((k) => fields.some((f) => f.id === k)) || (fields.find((f) => f.type === 'Symbol') || {}).id || null
    return {
      sys: { space: { sys: { type: 'Link', linkType: 'Space', id: space } }, id, type: 'ContentType', createdAt: now, updatedAt: now, environment: { sys: { id: 'master', type: 'Link', linkType: 'Environment' } }, revision: 1 },
      displayField: display, name: m.model && m.model.name ? m.model.name : (m.name || title(id)), description: m.description || '', fields,
      _model: m.key,   /* the registry's key, for the index; stripped before it is served */
    }
  })
}
