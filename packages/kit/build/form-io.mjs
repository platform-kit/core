/*
 * A form's file, read and written for the admin: content/forms/<slug>.md is a forms.md document, read by
 * the kit's parser (src/lib/forms/parse.js) into the model the builder edits, and written back through
 * forms.md's own Composer (packages/kit/vendor/formsmd/composer.js) — so what the builder writes is
 * forms.md's language, and the grammar is never typed. Every part of the model carries the source it
 * came from (a block's `raw`, a slide's `head`, the settings lines, the data blocks): a part the builder
 * did not touch is written back as it was, byte for byte — a hand-written construct the builder has no
 * control for (a data block, a div with attributes, a nunjucks tag) survives a save untouched — and a
 * part it changed (`dirty`) is composed afresh. A document nothing changed in is the file as it was.
 *
 *   readForm(root, name)                 → { raw, model }
 *   serialiseForm(model, raw)            → the document
 *   writeForm(root, name, model, raw)    the file, after the document is parsed again and refused with its errors
 *   composeField(block)                  one field's lines through the Composer (the builder's preview)
 */
import { asStore } from './store/index.mjs'
import { Composer } from '../vendor/formsmd/composer.js'
import { getDefaultSettings } from '../vendor/formsmd/settings-parse.js'
import { parseForm, FORMSMD_TYPE, KIT_SETTINGS } from '../src/lib/forms/parse.js'

export const DIR = 'content/forms'
export const slugOk = (s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(s || ''))
/* the files through the store (or a root, the checkout), async */
export const formNames = (store) => asStore(store).list(DIR)
export async function readForm(store, name) { const raw = await asStore(store).read(DIR + '/' + name + '.md'); return { raw, model: parseForm(raw) } }

/* the parser's lower-case parameter names → the Composer's camelCase ones */
const CAMEL = { labelstyle: 'labelStyle', fieldsize: 'fieldSize', hidelabels: 'hideLabels', hideformtext: 'hideFormText', labelstart: 'labelStart', labelend: 'labelEnd', hidelabelstart: 'hideLabelStart', hidelabelend: 'hideLabelEnd', startat: 'startAt', outof: 'outOf', unitend: 'unitEnd', imageonly: 'imageOnly', sizelimit: 'sizeLimit', currentfile: 'currentFile', availablecountries: 'availableCountries' }
/* what the parser adds that the document did not say: defaults the Composer must not write back */
const DERIVED = { tel: ['placeholder', 'country', 'availablecountries'], rating: ['outof', 'icon'], scale: ['startat', 'outof', 'labelstart', 'labelend'], file: ['sizelimit', 'currentfilename'], date: ['placeholder'], time: ['placeholder'], datetime: ['placeholder'] }
/* the kinds' defaults, so a block the builder made (no `set` from a parse) writes only what differs */
const DEFAULTS = { tel: { country: 'US', availablecountries: [] }, rating: { outof: 5, icon: 'star' }, scale: { startat: 0, outof: 10 }, file: { sizelimit: 10 } }
const NEVER = ['placeholder:tel', 'placeholder:date', 'placeholder:time', 'placeholder:datetime', 'currentfilename:file']

function composerParams(block) {
  const p = { ...(block.params || {}) }
  const out = {}
  const kind = block.kind
  for (const [k, v] of Object.entries(p)) {
    if (k === 'question' && v === '...') continue
    if (DERIVED[kind] && DERIVED[kind].includes(k)) {
      if (NEVER.includes(k + ':' + kind)) continue
      if (Array.isArray(block.set) ? !block.set.includes(k) : (DEFAULTS[kind] && k in DEFAULTS[kind] && JSON.stringify(DEFAULTS[kind][k]) === JSON.stringify(v)) || v === undefined || v === '') continue
    }
    if (k === 'choices' || k === 'options') { out[k] = (v || []).map((c) => { const o = { label: c.label }; if (c.value !== c.label) o.value = c.value; if (kind === 'picture') o.image = c.image || ''; return o }); continue }
    if (k === 'availablecountries') { out.availableCountries = Array.isArray(v) ? v : String(v).split(',').map((x) => x.trim()).filter(Boolean); continue }
    out[CAMEL[k] || k] = v
  }
  if (kind === 'picture') out.choices = (out.choices || []).map((c) => ({ ...c, image: c.image || '' }))
  if (block.required) out.required = true
  const a = block.attrs || {}
  if (a.id) out.id = a.id
  if (a.classes && a.classes.length) out.classNames = a.classes
  if (a.other && a.other.length) out.attrs = a.other.map((x) => { const m = /^([^=]+)=["']?(.*?)["']?$/.exec(x); return m ? { name: m[1], value: m[2] } : { name: x, value: '' } })
  if (block.condition) out.displayCondition = { dependencies: block.deps && block.deps.length ? block.deps : depsIn(block.condition), condition: block.condition }
  return out
}
/* the names a condition reads, for a display condition the builder wrote without naming them */
const depsIn = (cond) => [...new Set([...String(cond).matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b(?=\s*(?:==|!=|>=|<=|>|<|\bin\b|\band\b|\bor\b|$))/g)].map((m) => m[1]).filter((n) => !['and', 'or', 'not', 'in', 'true', 'false', 'none'].includes(n)))]

/* one field's lines, through the Composer (a fresh instance: it appends to its own template) */
export function composeField(block, formDelimiter = '|') {
  const c = new Composer({})
  c.settings.formDelimiter = formDelimiter
  const type = FORMSMD_TYPE[block.kind]
  if (!type || typeof c[type] !== 'function') throw new Error(`no such kind: ${block.kind}`)
  return c[type](block.name, composerParams(block)).replace(/^\n+|\n+$/g, '')
}

/* a slide's directive lines, from its fields */
function composeHead(slide) {
  const out = []
  if (slide.type === 'start') out.push(slide.button ? `-> start -> ${slide.button}` : '-> start')
  else if (slide.type === 'end') out.push(slide.redirect ? `-> end -> ${slide.redirect}` : '-> end')
  else if (slide.jump) out.push(`-> ${slide.jump}`)
  if (slide.progress) out.push(`|> ${slide.progress}`)
  if (slide.align) out.push(`=| ${slide.align}`)
  if (slide.post) out.push('>> post')
  if (slide.disablePrev) out.push('<< disable')
  return out
}

/* the `#!` lines: the original ones kept (a theming line the builder never shows stays as written), a changed key
   replaced in place, a new key appended, a key set to null dropped */
function composeSettings(lines, changes) {
  const out = []
  const seen = new Set()
  for (const l of lines) {
    const t = l.trim(); const eq = t.indexOf('=')
    const key = eq < 0 ? '' : t.slice(2, eq).trim()
    if (key && changes && key in changes) { seen.add(key); if (changes[key] != null && changes[key] !== '') out.push(`#! ${key} = ${changes[key]}`); continue }
    out.push(l)
  }
  for (const [key, v] of Object.entries(changes || {})) if (!seen.has(key) && v != null && v !== '') out.push(`#! ${key} = ${v}`)
  return out
}
/* the kit's settings as `#!` values (a default is written as nothing) */
export function kitSettingLines(kit) {
  const k = kit || {}
  return {
    published: k.published === false ? 'false' : null,
    once: k.once ? 'true' : null,
    respond: k.respond && k.respond !== 'anyone' ? k.respond : null,
    'embed-origins': k.embedOrigins && k.embedOrigins.length ? k.embedOrigins.join(', ') : null,
    webhook: k.webhook || null,
    pass: k.pass != null ? String(k.pass) : null,
    score: k.score && Object.keys(k.score).length ? Object.entries(k.score).map(([f, a]) => `${f}: ${a}`).join(', ') : null,
  }
}
/* forms.md's own settings the builder edits, as `#!` values: only the ones that differ from the defaults are written */
export function formsmdSettingLines(settings) {
  const d = getDefaultSettings(), out = {}
  for (const k of ['title', 'meta-description', 'page', 'page-progress', 'slide-controls', 'restart-button', 'submit-button-text', 'autofocus', 'button-alignment', 'placeholders', 'dir', 'field-size', 'label-style', 'form-style']) {
    const v = settings && settings[k]
    out[k] = v == null || v === '' || v === d[k] ? null : String(v)
  }
  return out
}

const blockText = (b, delim) => {
  if (b.type === 'field') return b.dirty || b.raw == null ? composeField(b, delim) : b.raw
  return b.raw != null ? b.raw : b.type === 'markdown' ? String(b.md || '').trim() : ''
}
/* a block with a condition of its own that the builder set (no raw): wrapped as the Composer wraps a field */
const wrapCondition = (b, text) => (b.type !== 'field' && b.condition && b.dirty ? `::: [{$ ${(b.deps && b.deps.length ? b.deps : depsIn(b.condition)).join(' ')} $}]\n{% if ${b.condition} %}\n${text}\n{% endif %}\n:::` : text)

export function serialiseForm(model, raw) {
  const dirty = model.dirty || model.settingsChanges || model.slides.some((s) => s.dirty || s.headDirty || (s.blocks || []).some((b) => b.dirty || b.raw == null))
  if (!dirty && raw != null && !model.slidesChanged) return raw
  const delim = (model.settings && model.settings['form-delimiter']) || '|'
  const parts = []
  const settings = composeSettings((model.head && model.head.settingsLines) || [], model.settingsChanges)
  if (settings.length) parts.push(settings.join('\n'))
  for (const d of (model.head && model.head.dataBlocks) || []) parts.push(d)
  model.slides.forEach((s, i) => {
    const head = s.headDirty || !s.head ? composeHead(s) : s.head
    const body = (s.blocks || []).map((b) => wrapCondition(b, blockText(b, delim))).filter(Boolean)
    const chunk = [head.join('\n'), body.join('\n\n')].filter(Boolean).join('\n\n')
    parts.push(i === 0 ? chunk : '---\n' + chunk)
  })
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n'
}

export async function writeForm(store, name, model, raw) {
  if (!slugOk(name)) throw new Error('the name is lower-case words joined by hyphens')
  const doc = serialiseForm(model, raw)
  const check = parseForm(doc)
  if (check.errors.length) throw new Error(check.errors.map((e) => (e.line ? `line ${e.line}: ` : '') + e.message).join('; '))
  await asStore(store).write(DIR + '/' + name + '.md', doc, { collection: 'forms', slug: name, data: { title: check.title || name }, body: doc, published: check.kit.published !== false })
  return { doc, model: check }
}
