/*
 * The records a site's content is, as the build and the function both read them (plain JavaScript): a record is one
 * markdown file (or one row) of a model with fields — its model key, its path within the model's directory (the entry's
 * identity), its frontmatter as `data`, its markdown `body`, whether it is published, and its times. `modelOfPath` says
 * which model a file belongs to from its path alone (the longest directory that claims it; a single model claims exactly
 * its own file), so a file under content/ and a row of public.content map the same way.
 */
export const isRecordModel = (m) => !!(m && m.fields && m.fields.length && m.dir)

/* the model a content path belongs to, of the models with fields, or null */
export function modelOfPath(models, rel) {
  const p = String(rel || '').replace(/^\.?\//, '')
  if (!p.endsWith('.md')) return null
  let best = null
  for (const m of models) {
    if (!isRecordModel(m)) continue
    const dir = String(m.dir).replace(/\/$/, '')
    if (m.single) { if (p === dir + '/' + m.key.replace(/^.*\//, '') + '.md') return m; continue }
    if (!p.startsWith(dir + '/')) continue
    const rest = p.slice(dir.length + 1)
    if (!m.nested && rest.includes('/')) continue
    if (!best || dir.length > String(best.dir).length) best = m
  }
  /* a single model's own file never belongs to a collection under the same directory (content/site.md is the site's) */
  if (best && models.some((m) => isRecordModel(m) && m.single && p === String(m.dir).replace(/\/$/, '') + '/' + m.key.replace(/^.*\//, '') + '.md')) return null
  return best
}
/* the entry's path within its model: the file's path less the directory and the extension */
export const pathWithin = (m, rel) => (m.single ? m.key.replace(/^.*\//, '') : String(rel).replace(/^\.?\//, '').slice(String(m.dir).replace(/\/$/, '').length + 1).replace(/\.md$/, ''))

export const isPublished = (data) => !(data && data.published === false)
