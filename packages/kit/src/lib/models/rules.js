/*
 * The kinds a content model's field may be, and the rules a field may carry — the one list, shared by the
 * build (the check on every entry), the admin (the builder's rule rows, the drawer's per-field check) and
 * the docs. The rules are Laravel's, run by validatorjs (the Laravel port); a rule is kept as a row
 * `{ rule, params }` in the model file and in the builder, and turned into validatorjs's string only here,
 * in `ruleString`, the moment it is run — the string is never shown and never typed.
 *
 *   KINDS                       kind → { group, base }   base: what a value of the kind is (string · number · boolean · array · object)
 *   RULES                       rule → { params, kinds } params: the shape of what the rule takes; kinds: which it applies to
 *   rulesFor(kind)              the rules a field of that kind may carry
 *   ruleString(row)             validatorjs's form of one row ('min:3', 'regex:/^a/', 'in:a,b')
 *   checkRules(value, rows, words, ctx) → [message]  every row run against the value, each failure worded from `words`
 *   fill(text, ctx)             {field} {n} {min} {max} {list} {value} in a message
 *
 * `starts_with` and `ends_with` are Laravel's and not in validatorjs 3.22; they are registered here, once.
 */
import Validator from 'validatorjs'
import en from 'validatorjs/src/lang/en.js'
/* validatorjs loads its language with a dynamic require the browser cannot follow; the messages are set here
   outright (they are never shown — every failure is worded from the models scope) so a rule runs anywhere */
if (!Validator.getMessages('en')) Validator.setMessages('en', en)

export const GROUPS = ['text', 'choices', 'media', 'structure']
export const KINDS = {
  text: { group: 'text', base: 'string' },
  'long-text': { group: 'text', base: 'string' },
  markdown: { group: 'text', base: 'string' },
  number: { group: 'text', base: 'number' },
  boolean: { group: 'text', base: 'boolean' },
  date: { group: 'text', base: 'string' },
  datetime: { group: 'text', base: 'string' },
  url: { group: 'text', base: 'string' },
  email: { group: 'text', base: 'string' },
  select: { group: 'choices', base: 'string' },
  'multi-select': { group: 'choices', base: 'array' },
  tags: { group: 'choices', base: 'array' },
  reference: { group: 'choices', base: 'string' },   /* an array when `many` */
  image: { group: 'media', base: 'string' },
  file: { group: 'media', base: 'string' },
  group: { group: 'structure', base: 'object' },
  list: { group: 'structure', base: 'array' },
}
export const KIND_KEYS = Object.keys(KINDS)
/* the kinds a group's sub-field or a list's row may be: one level of structure, never two */
export const LEAF_KINDS = KIND_KEYS.filter((k) => KINDS[k].group !== 'structure')

const STR = ['text', 'long-text', 'markdown', 'url', 'email', 'select']
const NUM = ['number']
const DATE = ['date', 'datetime']
const ARR = ['multi-select', 'tags', 'list']
/* params: n (one number) · range (two numbers) · list (values) · pattern (a regular expression) · date · text (a string) · none */
export const RULES = {
  min: { params: 'n', kinds: [...STR, ...NUM, ...ARR] },
  max: { params: 'n', kinds: [...STR, ...NUM, ...ARR] },
  between: { params: 'range', kinds: [...STR, ...NUM, ...ARR] },
  size: { params: 'n', kinds: [...STR, ...NUM, ...ARR] },
  in: { params: 'list', kinds: [...STR, ...NUM] },
  not_in: { params: 'list', kinds: [...STR, ...NUM] },
  regex: { params: 'pattern', kinds: STR },
  alpha: { params: 'none', kinds: STR },
  alpha_num: { params: 'none', kinds: STR },
  alpha_dash: { params: 'none', kinds: STR },
  numeric: { params: 'none', kinds: STR },
  integer: { params: 'none', kinds: [...STR, ...NUM] },
  digits: { params: 'n', kinds: [...STR, ...NUM] },
  url: { params: 'none', kinds: STR },
  email: { params: 'none', kinds: STR },
  date: { params: 'none', kinds: [...STR, ...DATE] },
  after: { params: 'date', kinds: DATE },
  before: { params: 'date', kinds: DATE },
  starts_with: { params: 'text', kinds: STR },
  ends_with: { params: 'text', kinds: STR },
}
export const RULE_KEYS = Object.keys(RULES)
export const rulesFor = (kind) => RULE_KEYS.filter((r) => RULES[r].kinds.includes(kind))

Validator.register('starts_with', (value, req) => typeof value === 'string' && value.startsWith(String(req)), '')
Validator.register('ends_with', (value, req) => typeof value === 'string' && value.endsWith(String(req)), '')

/* validatorjs's form of one row. The pattern is the row's `params` as written, wrapped in slashes; a list
   joins its values with commas (validatorjs's own separator, so a value may not hold one); a date rule names a
   second input (validatorjs compares fields, not literals), which checkRules supplies as `_p`. */
export function ruleString(row) {
  const r = RULES[row.rule]
  if (!r) return null
  const p = row.params
  if (r.params === 'none') return row.rule
  if (r.params === 'range') return `${row.rule}:${p[0]},${p[1]}`
  if (r.params === 'list') return `${row.rule}:${(Array.isArray(p) ? p : [p]).join(',')}`
  if (r.params === 'pattern') return `${row.rule}:/${p}/`
  if (r.params === 'date') return `${row.rule}:_p`
  return `${row.rule}:${p}`
}
/* a row's parameters as the message says them */
export function paramsOf(row) {
  const r = RULES[row.rule]
  if (!r) return {}
  const p = row.params
  if (r.params === 'range') return { min: p[0], max: p[1] }
  if (r.params === 'list') return { list: (Array.isArray(p) ? p : [p]).join(', ') }
  if (r.params === 'none') return {}
  return { n: p, value: p }
}
export const fill = (text, ctx) => String(text || '').replace(/\{(\w+)\}/g, (_, k) => (ctx[k] === undefined ? '' : String(ctx[k])))

/* every row run against the value, one validatorjs run each so the failing rule is known; an empty value
   passes every rule (required is its own check). `words` is the `rules` group of the models scope:
   words[rule].message with {field} and the parameters. */
export function checkRules(value, rows, words = {}, ctx = {}) {
  const out = []
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return out
  for (const row of rows || []) {
    const s = ruleString(row)
    if (!s) continue
    const v = new Validator({ v: value, _p: RULES[row.rule].params === 'date' ? row.params : undefined }, { v: [s] })
    if (v.passes()) continue
    const w = words[row.rule] || {}
    out.push(fill(w.message || `{field}: ${row.rule}`, { ...ctx, ...paramsOf(row) }))
  }
  return out
}
