/*
 * The logic of a form at run time — conditions, jumps and bindings — evaluated as forms.md
 * evaluates them: with nunjucks, over the data blocks and the answers so far, so an expression in a
 * document means the same thing on the kit's runner as in forms.md's. Pure: given the words, it
 * answers; nothing here touches the DOM or the site (the runner brings the context).
 *
 *   holds("position == 'Other'", ctx)    a display or jump condition, true or false
 *   renderCopy(md, ctx)                  a block's markdown with its `{$ name $}` bindings and any
 *                                        nunjucks tags rendered — still markdown, for the renderer
 *   context(data, answers)               the context: the data blocks under the answers
 *   valueOf(v)                           a value as a binding shows it (a list joined by commas)
 */
import nunjucks from 'nunjucks'

/* one environment, never the global configure: nothing else on the page shares it */
const env = new nunjucks.Environment(null, { autoescape: false, throwOnUndefined: false })

export function context(data, answers) { return { ...(data || {}), ...(answers || {}) } }

export function holds(condition, ctx) {
  const c = String(condition || '').trim()
  if (!c) return true
  try { return env.renderString(`{% if ${c} %}true{% endif %}`, ctx || {}) === 'true' }
  catch (e) { if (typeof console !== 'undefined') console.warn(`[forms] the condition "${c}" could not be read: ${e.message || e}`); return false }
}

/* `{$ name $}` is forms.md's binding; nunjucks's own `{{ name }}` is left as it is (the same thing) */
export function renderCopy(md, ctx) {
  const src = String(md || '').replace(/\{\$\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\$\}/g, '{{ $1 }}')
  try { return env.renderString(src, bindable(ctx || {})) }
  catch (e) { if (typeof console !== 'undefined') console.warn(`[forms] the copy could not be rendered: ${e.message || e}`); return src }
}

/* a value as a binding shows it: forms.md sets a span's innerText to the value, so a list reads "a,b" */
export function valueOf(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object' && v.name) return v.name   /* a file: its name */
  return String(v)
}
const bindable = (ctx) => Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, Array.isArray(v) || (v && typeof v === 'object' && v.name && !Array.isArray(v)) ? valueOf(v) : v]))

/* the next slide from `from` going forward (or back): the first whose jump condition holds, or has none — forms.md's getNextSlide */
export function nextSlide(slides, from, ctx, dir = 1) {
  for (let i = from + dir; i >= 0 && i < slides.length; i += dir) {
    const s = slides[i]
    if (!s.jump || holds(s.jump, ctx)) return i
  }
  return -1
}
