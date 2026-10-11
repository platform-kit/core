/*
 * What the Forms API (Typeform's) says about a form beyond the contract the `form` function checks a post against:
 * the fields with their words and choices, the slides in order with their jump conditions (as rows where the rows can
 * say them) and their free markdown, the start and end slides. Pure — build/forms.mjs writes it into forms.json for
 * every document at build time, and in cloud mode the functions make it again from a row's text (the same parser,
 * the same shape), so a form written through the API answers the moment it is saved.
 */
import { rowsOf } from './condition.js'

/**
 * @param {object} model  parseForm's model
 * @param {string} name   the form's slug
 * @param {object} [times] { updated, created } ISO strings, or nothing (a form with no file)
 */
export function apiShape(model, name, times = {}) {
  const walk = (blocks, fn) => { for (const b of blocks || []) { fn(b); if (b.blocks) walk(b.blocks, fn) } }
  const field = (b) => { const p = b.params || {}; return { name: b.name, kind: b.kind, required: !!b.required, question: p.question || '', description: p.description || '', placeholder: p.placeholder || '', multiple: !!p.multiple,
    choices: (p.choices || p.options || []).map((c) => ({ value: c.value, label: c.label || c.value, image: c.image || '' })), outof: p.outof || null, startat: p.startat ?? null, labelstart: p.labelstart || '', labelend: p.labelend || '', min: p.min ?? null, max: p.max ?? null, step: p.step ?? null, multiline: !!p.multiline } }
  const slides = model.slides.map((s, i) => { const items = []; walk(s.blocks, (b) => { if (b.type === 'field') items.push({ field: b.name }); else if (b.type === 'markdown' && b.md && b.md.trim()) items.push({ md: b.md.trim() }) }); return { index: i, type: s.type, jump: s.jump || '', jumpRows: s.jump ? rowsOf(s.jump) : [], button: s.button || '', redirect: s.redirect || '', items } })
  return { slug: name, title: model.title || name, description: model.settings['meta-description'] || '', fields: model.fields.map(field), slides, updated_at: times.updated || null, created_at: times.created || times.updated || null }
}
