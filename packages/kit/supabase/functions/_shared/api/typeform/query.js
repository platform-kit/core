/*
 * The Responses API's arguments, read from a query string into one plan — the filters, the order, the page — and
 * applied to the rows under Node (the test) exactly as the function applies them to the table. Typeform pages by
 * token: `before` and `after` name a response, and the page is the ones before or after it in the order.
 */
export const DEFAULT_PAGE = 25, MAX_PAGE = 1000

export function parseResponsesQuery(q = {}) {
  const errors = []
  const n = (k, def) => { if (q[k] == null || q[k] === '') return def; const v = Number(q[k]); if (!Number.isInteger(v)) errors.push(`${k} is not a whole number`); return v }
  const date = (k) => { if (!q[k]) return null; const d = new Date(q[k]); if (isNaN(d)) errors.push(`${k} is not a date`); return d.toISOString() }
  let pageSize = n('page_size', DEFAULT_PAGE); if (pageSize < 1 || pageSize > MAX_PAGE) errors.push('page_size is 1–' + MAX_PAGE)
  const completed = q.completed == null || q.completed === '' ? 'all' : ['true', 'false', 'all'].includes(String(q.completed)) ? String(q.completed) : (errors.push('completed is true, false or all'), 'all')
  const list = (k) => String(q[k] || '').split(',').map((s) => s.trim()).filter(Boolean)
  let sort = { key: 'submitted_at', dir: 'desc' }
  if (q.sort) { const [k, d] = String(q.sort).split(','); if (!['submitted_at', 'landed_at'].includes(k) || (d && !['asc', 'desc'].includes(d))) errors.push('sort is submitted_at|landed_at,asc|desc'); else sort = { key: k, dir: d || 'desc' } }
  return { errors, pageSize, since: date('since'), until: date('until'), after: q.after || null, before: q.before || null, ids: list('included_response_ids'), completed, sort, query: String(q.query || '').trim().toLowerCase(), fields: list('fields'), answeredFields: list('answered_fields') }
}

/* the plan over rows already shaped { row, answers } — the reference the function's SQL agrees with */
export function applyResponsesQuery(plan, items) {
  const at = (it) => (plan.sort.key === 'landed_at' ? it.row.started_at : it.row.completed_at || it.row.started_at)
  let list = items.filter((it) => {
    if (plan.completed === 'true' && !it.row.completed_at) return false
    if (plan.completed === 'false' && it.row.completed_at) return false
    if (plan.ids.length && !plan.ids.includes(it.row.id)) return false
    const t = at(it)
    if (plan.since && (!t || t < plan.since)) return false
    if (plan.until && (!t || t > plan.until)) return false
    if (plan.answeredFields.length && !plan.answeredFields.every((f) => it.answers.some((a) => a.field === f))) return false
    if (plan.query && !it.answers.some((a) => JSON.stringify(a.value ?? a.file_name ?? '').toLowerCase().includes(plan.query))) return false
    return true
  })
  list.sort((a, b) => { const x = at(a) || '', y = at(b) || ''; return plan.sort.dir === 'asc' ? (x < y ? -1 : x > y ? 1 : 0) : (x < y ? 1 : x > y ? -1 : 0) })
  const total = list.length
  if (plan.after) { const i = list.findIndex((it) => it.row.id === plan.after); if (i >= 0) list = list.slice(i + 1) }
  if (plan.before) { const i = list.findIndex((it) => it.row.id === plan.before); if (i >= 0) list = list.slice(Math.max(0, i - plan.pageSize), i) }
  const page = plan.before ? list : list.slice(0, plan.pageSize)
  if (plan.fields.length) for (const it of page) it.answers = it.answers.filter((a) => plan.fields.includes(a.field))
  return { total_items: total, page_count: Math.ceil(total / plan.pageSize), items: page }
}
