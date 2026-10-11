/*
 * A form is a forms.md document, and this reads one into a model — the settings, the slides,
 * each slide's blocks (free markdown, a field, a div) with the conditions and bindings on them —
 * which is what the runner draws, the builder edits and the build compiles. forms.md itself has no
 * model between its parser and its renderer (a field line becomes HTML in one pass), so this is the
 * kit's own, over the separable parts of the library (packages/kit/vendor/formsmd: the settings, the
 * field grammar, the data blocks, the attributes). Pure: no fs, no DOM, nothing of the site.
 *
 * The language, as forms.md's docs describe it:
 *   #! key = value                        a setting (forms.md's, or the kit's few: published, once,
 *                                         respond, embed-origins, webhook, pass, score)
 *   ---                                   a slide boundary (`slide-delimiter`)
 *   -> start [-> Button]  -> end [-> url] a start slide, an end slide
 *   -> <condition>                        a jump condition: the slide is shown only when it holds
 *   |> 50%  |> 1/3                        page progress   =| center   << disable   >> post
 *   name* = TextInput(| question = … )    a field: the name, `*` required, the kind, its parameters
 *   ::: [{$ a b $} .class] … :::          a div: bound to fields (re-rendered as they change), attributes
 *   {% if a == 'x' %} … {% endif %}       a display condition (nunjucks) round what it wraps
 *   {$ name $}                            a binding: the field's value in the copy
 *   ```data { … } ```                     a data block: values the conditions and bindings may read
 *   [.fmd-text-center] Hello              attributes on a paragraph, a heading, a list, a code block
 *
 * The model:
 *   { settings, kit, data, slides: [{ type: start | body | end, jump, progress, align, post,
 *     disablePrev, button, redirect, head: [raw lines], blocks: [block] }], fields: [field],
 *     warnings: [{ line, message }], errors: [{ line, message }] }
 *   block: { type: 'markdown', md, raw, line, deps, condition }
 *        | { type: 'field', name, kind, type, required, params, attrs, raw, line, deps, condition }
 *        | { type: 'div', attrs, raw, line, blocks, deps, condition }
 * A document with errors is refused by the build and by the admin, each error naming its line.
 */
import { parseSettings, getDefaultSettings } from '../../../vendor/formsmd/settings-parse.js'
import { parseDataBlocks } from '../../../vendor/formsmd/data-blocks-parse.js'
import { parseFieldLine, formFieldPattern, TYPES, TYPE_NAMES } from '../../../vendor/formsmd/field-parse.js'
import { unescape } from '../../../vendor/formsmd/helpers.js'

export const KINDS = Object.values(TYPES).map(([, kind]) => kind)
export const FORMSMD_TYPE = Object.fromEntries(Object.values(TYPES).map(([type, kind]) => [kind, type]))
/* the kit's own settings: what the file says about its life on the site */
export const KIT_SETTINGS = ['published', 'once', 'respond', 'embed-origins', 'webhook', 'pass', 'score', 'paid', 'ticket', 'ticket-title', 'ticket-priority']
/* forms.md's settings that name where the data goes: the kit's backend is where, so a file never sets them */
export const REFUSED_SETTINGS = ['post-url', 'get-url', 'post-sheet-name']
/* forms.md's theming settings: read (the file is theirs) and ignored (the site's design draws the form) */
export const THEME_SETTINGS = ['accent', 'accent-foreground', 'backdrop-opacity', 'background-color', 'background-image', 'brand', 'color', 'color-scheme', 'color-scheme-scope', 'color-scheme-toggle', 'css-prefix', 'favicon', 'font-family', 'font-import-url', 'font-size', 'rounded', 'formsmd-branding', 'footer', 'header', 'cta']

const bool = (v) => /^(true|yes|1|on)$/i.test(v) ? true : /^(false|no|0|off)$/i.test(v) ? false : null
const isUrl = (v) => /^https?:\/\/[^\s]+$/.test(v)

/* the kit's settings off the `#!` lines: parsed, validated, and the refused ones named */
function kitSettings(lines) {
  const kit = { published: true, once: false, respond: 'anyone', embedOrigins: [], webhook: '', pass: null, score: {}, paid: '', ticket: '', ticketTitle: '', ticketPriority: '' }
  const errors = []
  lines.forEach((raw, i) => {
    const t = raw.trim()
    if (!t.startsWith('#!')) return
    const eq = t.indexOf('=')
    if (eq < 0) return
    const key = t.slice(2, eq).trim(), value = t.slice(eq + 1).trim()
    const line = i + 1
    if (REFUSED_SETTINGS.includes(key)) { errors.push({ line, message: `"${key}" is set by the kit — every answer goes to the site's own backend; remove the line` }); return }
    if (!KIT_SETTINGS.includes(key) || value === '') return
    if (key === 'published' || key === 'once') { const b = bool(value); if (b === null) errors.push({ line, message: `"${key}" is true or false` }); else kit[key] = b }
    else if (key === 'respond') { if (!['anyone', 'authenticated'].includes(value)) errors.push({ line, message: '"respond" is anyone or authenticated' }); else kit.respond = value }
    /* WHAT IT COSTS TO ANSWER: an offer's sku, which the store already knows how to sell. The form
       says what it is worth and nothing about money — no price, no currency, no Stripe — because a
       thing that is sold is a product file and there is one place that is true. */
    else if (key === 'paid') kit.paid = value
    /* THIS ANSWER IS A PIECE OF WORK. A desk that spends its first three replies asking what
       version, what was tried and how urgent it is, is doing work a form could have done — so a
       form may BE the way a ticket is raised. `ticket` is on, or the category to file it under;
       `ticket-title` names the field whose answer titles it (else the form's own title), and
       `ticket-priority` the field whose answer sets the priority, where one asks. */
    else if (key === 'ticket') kit.ticket = value === 'false' ? '' : (value === 'true' ? 'yes' : value)
    else if (key === 'ticket-title') kit.ticketTitle = value
    else if (key === 'ticket-priority') kit.ticketPriority = value
    else if (key === 'embed-origins') { const list = value.split(',').map((s) => s.trim()).filter(Boolean); const bad = list.find((o) => !/^https?:\/\/[^\s/]+$/.test(o)); if (bad) errors.push({ line, message: `"embed-origins" lists origins (https://example.com), not "${bad}"` }); else kit.embedOrigins = list }
    else if (key === 'webhook') { if (!isUrl(value)) errors.push({ line, message: '"webhook" is a url' }); else kit.webhook = value }
    else if (key === 'pass') { if (!/^\d+$/.test(value)) errors.push({ line, message: '"pass" is a whole number of right answers' }); else kit.pass = Number(value) }
    else if (key === 'score') {
      for (const pair of value.split(',')) {
        const p = pair.trim(); if (!p) continue
        const c = p.indexOf(':')
        if (c < 0) { errors.push({ line, message: `"score" is field: answer pairs, not "${p}"` }); continue }
        const f = p.slice(0, c).trim(), a = p.slice(c + 1).trim()
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(f)) { errors.push({ line, message: `"score" names a field, not "${f}"` }); continue }
        kit.score[f] = a
      }
    }
  })
  return { kit, errors }
}

/* forms.md's own settings parse, its console warnings caught as ours */
function withWarnings(fn) {
  const out = []
  const orig = console.warn
  console.warn = (m) => out.push(String(m))
  try { return { result: fn(), warnings: out } } finally { console.warn = orig }
}

const FENCE = /^\s*(```|~~~)/
const DIV = /^\s*:::/
const IF = /^\s*\{%-?\s*if\s+(.*?)\s*-?%\}\s*$/
const ELIF = /^\s*\{%-?\s*elif\s+(.*?)\s*-?%\}\s*$/
const ELSE = /^\s*\{%-?\s*else\s*-?%\}\s*$/
const ENDIF = /^\s*\{%-?\s*endif\s*-?%\}\s*$/
const IF_OPEN = /\{%-?\s*if\s/
/* a paragraph that begins like a field but does not close: named rather than shown as prose */
/* where a field line STARTS, from the one list of kinds (field-parse.js): it was written out here
   as well, and a kind added to one list and not the other is a field the language accepts and the
   reader never draws — which is exactly what happened the first time a kind was added. */
const FIELD_START = new RegExp('^\\s*(?:\\[[^\\]]*\\]\\s*)?[a-zA-Z_$][a-zA-Z0-9_$]*\\s*\\*?\\s*=\\s*(' + TYPE_NAMES.join('|') + ')\\s*\\(', 'i')
/* the names a piece of copy binds: {$ name $} spans, and the bare names in {{ }} / {% %} */
export function depsOf(text) {
  const out = new Set()
  for (const m of String(text).matchAll(/\{\$\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\$\}/g)) out.add(m[1])
  return [...out]
}
/* the attributes of a div or a block: `{$ a b $}` are its bindings, `#id`, `.class` and `k="v"` its attributes */
export function splitAttrs(attrs) {
  let a = String(attrs || '').replace(/\s\s+/g, ' ')
  const deps = []
  a = a.replace(/\{\$(.*?)\$\}/g, (m, inner) => { for (const d of inner.trim().split(/\s+/)) if (d) deps.push(d); return '' }).trim()
  const id = (a.match(/(?:^|\s)#([^\s]+)/) || [])[1] || ''
  const classes = [...a.matchAll(/(?:^|\s)\.([^\s]+)/g)].map((m) => m[1])
  const other = a.split(/\s+(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/).filter((x) => x && !x.startsWith('#') && !x.startsWith('.'))
  return { deps, id, classes, other, raw: String(attrs || '').trim() }
}

/* a slide's head: the directive lines, as parseSlide reads them; the rest is the content */
function parseSlideHead(lines, startLine, isForm, warnings) {
  const s = { type: 'body', jump: '', progress: '', align: '', post: false, disablePrev: false, button: '', redirect: '', head: [], content: [], contentLine: startLine }
  let inFence = false
  lines.forEach((raw, i) => {
    const line = unescape(raw)
    const t = line.trim()
    if (FENCE.test(raw)) inFence = !inFence
    if (!inFence && t.startsWith('->')) {
      const rest = t.slice(2).trim()
      if (/^start$/i.test(rest)) { s.type = 'start'; s.button = '' }
      else if (/^start\s*->/i.test(rest)) { s.type = 'start'; s.button = rest.slice(5).trim().slice(2).trim() }
      else if (/^end$/i.test(rest)) s.type = 'end'
      else if (/^end\s*->/i.test(rest)) { s.type = 'end'; s.redirect = rest.slice(3).trim().slice(2).trim() }
      else if (rest) s.jump = rest.replace(/"/g, "'")
      s.head.push(raw); return
    }
    if (!inFence && t.startsWith('|>')) {
      const v = t.slice(2).trim()
      if (/^[0-9.]+%$/.test(v)) s.progress = v
      else if (/^[0-9]+\s*\/\s*[0-9]+$/.test(v)) { const [a, b] = v.split('/').map((x) => Number(x.trim())); s.progress = b ? (100 * a / b).toFixed(2).replace(/\.?0+$/, '') + '%' : '' }
      else warnings.push({ line: startLine + i, message: `"${v}" is not a valid percentage or fraction (25%, 1/3)` })
      s.head.push(raw); return
    }
    if (!inFence && (t.startsWith('=|') || t.startsWith('|='))) {
      const v = t.slice(2).trim().toLowerCase()
      if (['start', 'center', 'end', 'stretch'].includes(v)) s.align = v
      s.head.push(raw); return
    }
    if (!inFence && /^\s*<<\s*disable\s*$/i.test(line)) { s.disablePrev = true; s.head.push(raw); return }
    if (!inFence && /^\s*>>\s*post\s*$/i.test(line)) { if (isForm) s.post = true; else warnings.push({ line: startLine + i, message: '">> POST" works only for forms and on slides with a form field' }); s.head.push(raw); return }
    s.content.push(raw)
  })
  return s
}

/* the content of a slide (or of a div) into blocks */
function parseBlocks(lines, startLine, delimiter, out) {
  const blocks = []
  const n = lines.length
  let i = 0
  let md = null   /* the open markdown block, extended by the next prose paragraph */
  const closeMd = () => { md = null }
  const pushMd = (chunk, line) => {
    if (md) { md.md += '\n\n' + chunk; md.raw += '\n\n' + chunk; md.deps = depsOf(md.md) }
    else { md = { type: 'markdown', md: chunk, raw: chunk, line, deps: depsOf(chunk), condition: '' }; blocks.push(md) }
  }
  while (i < n) {
    const raw = lines[i]
    if (!raw.trim()) { i++; continue }
    /* a fenced code block, whole */
    if (FENCE.test(raw)) {
      const fence = raw.match(FENCE)[1]
      let j = i + 1
      while (j < n && !(lines[j].trim().startsWith(fence) && lines[j].trim().length <= fence.length + 1)) j++
      pushMd(lines.slice(i, Math.min(j + 1, n)).join('\n'), startLine + i)
      i = j + 1; continue
    }
    /* a div: ::: [attrs] … ::: (nesting is not supported, as in forms.md) */
    if (DIV.test(raw)) {
      const open = raw.trim().slice(3).trim()
      let attrs = '', first = open
      const am = open.match(/^\[(.*?)\](.*)$/s)
      if (am) { attrs = am[1]; first = am[2].trim() }
      let j = i, inner = [], closedOnSame = false
      if (first.includes(':::')) { inner = [first.slice(0, first.indexOf(':::')).trim()]; closedOnSame = true }
      else {
        if (first) inner.push(first)
        j = i + 1
        while (j < n && !lines[j].includes(':::')) { inner.push(lines[j]); j++ }
        if (j < n) { const before = lines[j].slice(0, lines[j].indexOf(':::')); if (before.trim()) inner.push(before) }
      }
      const end = closedOnSame ? i : Math.min(j, n - 1)
      const a = splitAttrs(attrs)
      const innerBlocks = parseBlocks(inner, startLine + i + (first ? 0 : 1), delimiter, out)
      for (const b of innerBlocks) if (a.deps.length) b.deps = [...new Set([...(b.deps || []), ...a.deps])]
      closeMd()
      const divRaw = lines.slice(i, end + 1).join('\n')
      /* a bind div with nothing else on it and one block inside stands as that block, carrying the whole div as its
         source (so a rewrite keeps the wrapper); with several blocks, or attributes of its own, it is a div block */
      if (!(a.id || a.classes.length || a.other.length) && innerBlocks.length === 1) { const b = innerBlocks[0]; b.raw = divRaw; b.line = startLine + i; b.wrapped = true; blocks.push(b) }
      else blocks.push({ type: 'div', attrs: a, raw: divRaw, line: startLine + i, blocks: innerBlocks, deps: a.deps, condition: '' })
      i = end + 1; continue
    }
    /* a display condition: {% if … %} … {% endif %}, with else and elif */
    const ifm = raw.match(IF)
    if (ifm) {
      let depth = 0, j = i + 1
      const branches = [{ cond: ifm[1], lines: [], line: startLine + i }]
      for (; j < n; j++) {
        const l = lines[j]
        if (IF.test(l)) depth++
        else if (ENDIF.test(l)) { if (depth === 0) break; depth-- }
        else if (depth === 0 && ELSE.test(l)) { branches.push({ cond: null, lines: [], line: startLine + j }); continue }
        else if (depth === 0 && ELIF.test(l)) { branches.push({ cond: l.match(ELIF)[1], lines: [], line: startLine + j }); continue }
        branches[branches.length - 1].lines.push(l)
      }
      if (j >= n) { out.errors.push({ line: startLine + i, message: '"{% if %}" has no "{% endif %}"' }); i = n; continue }
      closeMd()
      const seen = []
      const group = []
      branches.forEach((br) => {
        const not = seen.map((c) => `not (${c})`)
        const cond = br.cond === null ? not.join(' and ') : [...not, `(${br.cond})`].join(' and ')
        if (br.cond !== null) seen.push(br.cond)
        for (const b of parseBlocks(br.lines, br.line + 1, delimiter, out)) { b.condition = b.condition ? `(${cond}) and (${b.condition})` : cond; group.push(b) }
      })
      const ifRaw = lines.slice(i, j + 1).join('\n')
      /* one block under the condition stands as that block with the whole `{% if %}` as its source; several are a group */
      if (group.length === 1) { group[0].raw = ifRaw; group[0].line = startLine + i; blocks.push(group[0]) }
      else blocks.push({ type: 'div', attrs: { deps: [], id: '', classes: [], other: [], raw: '' }, raw: ifRaw, line: startLine + i, blocks: group, deps: [], condition: '' })
      i = j + 1; continue
    }
    /* a paragraph: up to the next blank line or the next construct — and a field closed on one line
       ends at that line when the next begins another field (forms.md would run the two together, since a
       paragraph is a paragraph; this is the one place the kit reads more generously than it) */
    let j = i
    while (j < n && lines[j].trim() && !(j > i && (FENCE.test(lines[j]) || DIV.test(lines[j]) || IF.test(lines[j]) || (FIELD_START.test(lines[j]) && /\)\s*$/.test(lines[j - 1]))))) j++
    const para = lines.slice(i, j).join('\n')
    let text = para, attrs = ''
    const am = para.match(/^\s*\[(.*?)\]\s*([\s\S]*)$/)
    if (am && FIELD_START.test(para)) { attrs = am[1]; text = am[2] }
    const field = parseFieldLine(text, delimiter)
    if (field) {
      const a = splitAttrs(attrs)
      for (const w of field.warnings) out.warnings.push({ line: startLine + i, message: w })
      closeMd()
      blocks.push({ type: 'field', name: field.name, kind: field.kind, ftype: field.type, required: field.required, params: field.params, set: field.set, attrs: a, raw: para, line: startLine + i, deps: a.deps, condition: '' })
    } else if (FIELD_START.test(para)) {
      out.errors.push({ line: startLine + i, message: `the field does not close: a field is "name = ${(para.match(FIELD_START)[1] || '').replace(/input$/i, 'Input')}( … )" with its parameters between the brackets` })
    } else pushMd(para, startLine + i)
    i = j
  }
  return blocks
}

const walk = (blocks, fn) => { for (const b of blocks) { fn(b); if (b.blocks) walk(b.blocks, fn) } }

/* the document → the model */
export function parseForm(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n')
  const lines = src.split('\n')
  const out = { warnings: [], errors: [] }
  /* the kit's settings first, off the same lines; then forms.md's own parse of the rest (the kit's keys
     taken out so it does not warn about them) */
  const { kit, errors } = kitSettings(lines)
  out.errors.push(...errors)
  const own = lines.map((l) => { const t = l.trim(); if (!t.startsWith('#!')) return l; const k = t.slice(2, t.indexOf('=') < 0 ? undefined : t.indexOf('=')).trim(); return KIT_SETTINGS.includes(k) || REFUSED_SETTINGS.includes(k) ? '' : l })
  const sp = withWarnings(() => parseSettings(own.join('\n')))
  for (const w of sp.warnings) out.warnings.push({ line: 0, message: w.replace(/^\[SETTINGS\]\s*/, '') })
  const settings = { ...getDefaultSettings(), ...sp.result.settings }
  /* the data blocks: parsed by forms.md's function, blanked in place so the line numbers hold */
  const dp = withWarnings(() => parseDataBlocks(src))
  for (const w of dp.warnings) out.warnings.push({ line: 0, message: w.replace(/^\[DATA\]\s*/, '') })
  const data = dp.result.data
  const dataBlocks = [...src.matchAll(/```\s*data\s*(.*?)\s*```|~~~\s*data\s*(.*?)\s*~~~/gis)].map((m) => m[0])
  const settingsLines = lines.filter((l) => l.trim().startsWith('#!'))
  const blanked = lines.map((l) => (l.trim().startsWith('#!') ? '' : l))
  const withoutData = blanked.join('\n').replace(/```\s*data\s*(.*?)\s*```/gis, (m) => m.replace(/[^\n]/g, '')).replace(/~~~\s*data\s*(.*?)\s*~~~/gis, (m) => m.replace(/[^\n]/g, '')).split('\n')
  const isForm = settings.page === 'form-slides'
  const delim = settings['form-delimiter'] || '|'
  const slideDelim = settings['slide-delimiter'] || '---'
  /* the slides: split on the delimiter as a line of its own (never inside a code fence) */
  const groups = [{ start: 0, lines: [] }]
  if (settings.page !== 'single') {
    let inFence = false
    withoutData.forEach((l, i) => {
      if (FENCE.test(l)) inFence = !inFence
      if (!inFence && l.trim() === slideDelim) { groups.push({ start: i + 1, lines: [] }); return }
      groups[groups.length - 1].lines.push(l)
    })
  } else groups[0].lines = withoutData
  const slides = groups.map((g, gi) => {
    const s = parseSlideHead(g.lines, g.start + 1, isForm, out.warnings)
    if (gi === 0 && s.jump) { out.warnings.push({ line: g.start + 1, message: 'the first slide cannot have a jump condition' }); s.jump = '' }
    if (s.type === 'start') s.jump = ''
    s.blocks = parseBlocks(s.content, g.start + 1, delim, out)
    s.raw = g.lines.join('\n')
    delete s.content
    return s
  })
  /* forms.md keeps the start slides first, the body slides after, and one end slide (the last) */
  const starts = slides.filter((s) => s.type === 'start'), bodies = slides.filter((s) => s.type === 'body'), ends = slides.filter((s) => s.type === 'end')
  const ordered = [...starts, ...bodies, ...(ends.length ? [ends[ends.length - 1]] : [])]
  /* the fields, flat, with their slide; a name given twice is an error */
  const fields = []
  ordered.forEach((s, si) => walk(s.blocks, (b) => { if (b.type === 'field') { const dup = fields.find((f) => f.name === b.name); if (dup) out.errors.push({ line: b.line, message: `"${b.name}" is already a field (line ${dup.line})` }); fields.push({ ...b, slide: si }) } }))
  for (const f of Object.keys(kit.score)) if (!fields.some((x) => x.name === f)) out.errors.push({ line: 0, message: `"score" names "${f}", which is not a field` })
  if (kit.pass != null && !Object.keys(kit.score).length) out.warnings.push({ line: 0, message: '"pass" is set but "score" names no right answers' })
  const title = settings.title || ''
  /* a paid form is answered by somebody the site can charge and come back to */
  if (kit.paid && kit.respond !== 'authenticated') kit.respond = 'authenticated'
  return { settings, kit, data, title, slides: ordered, fields, head: { settingsLines, dataBlocks }, warnings: out.warnings, errors: out.errors }
}

/*
 * The fields as the function checks them: name, kind, required, and for a choice its values — and
 * the LABEL, the question as it was actually asked.
 *
 * The label is here and not only in the document because anything that reads an answer back needs
 * it: a booking's answers on the desk, the same answers in the host's letter. A field's key is not
 * a question, and `working_on` in front of somebody who has to act on the answer is a small daily
 * insult to whoever writes the forms.
 */
export function fieldContract(model) {
  return model.fields.map((f) => ({ name: f.name, /* THE QUESTION AS IT WAS ASKED, carried here and not only in the document because anything that
     reads an answer BACK needs it — a booking's answers on the desk, the same answers in the host's
     letter. A field's key is not a question, and `working_on` in front of somebody who has to act
     on the answer is a small daily insult to whoever wrote the form. ('...' is forms.md's own
     placeholder for a field that was never given one.) */
    question: (f.params && f.params.question && f.params.question !== '...' ? f.params.question : '') || f.name, kind: f.kind, required: !!f.required, multiple: !!(f.params && f.params.multiple), values: f.kind === 'choice' || f.kind === 'picture' ? (f.params.choices || []).map((c) => c.value) : f.kind === 'select' ? (f.params.options || []).map((o) => o.value) : undefined, slide: f.slide }))
}
