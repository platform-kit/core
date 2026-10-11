/*
 * Typeform's Insights summary from what the admin already computes (admin_forms: started, finished, per-slide reach,
 * per-field distributions): `{ fields: [{ id, ref, title, type, views, dropoffs }], form: { platforms, summary } }`.
 */
export function summaryOf(definition, stats) {
  const started = Number(stats?.started || 0), finished = Number(stats?.finished || 0)
  const reach = stats?.slides || []   /* [{ slide, reached }] */
  const flat = []
  const walk = (list, slide) => { for (const f of list || []) { if (f.type === 'group') walk(f.properties.fields, Number(String(f.id).replace('group-', ''))); else if (f.type !== 'statement') flat.push({ f, slide }) } }
  walk(definition.fields, 0)
  const views = (slide) => { const r = reach.find((x) => Number(x.slide) === slide); return r ? Number(r.reached) : started }
  const fields = flat.map(({ f, slide }, i) => { const v = views(slide); const next = flat[i + 1] ? views(flat[i + 1].slide) : finished; return { id: f.id, ref: f.ref, title: f.title, type: f.type, views: v, dropoffs: Math.max(0, v - next) } })
  const rate = started ? Math.round((finished / started) * 10000) / 100 : 0
  return { fields, form: { platforms: [{ platform: 'other', responses_count: finished, total_visits: started, unique_visits: started, completion_rate: rate, average_time: Number(stats?.average_seconds || 0) }], summary: { responses_count: finished, total_visits: started, unique_visits: started, completion_rate: rate, average_time: Number(stats?.average_seconds || 0) } } }
}
