/*
 * Typeform's Insights summary from what the admin already computes (admin_forms: started, finished, per-slide reach,
 * per-field distributions): `{ fields: [{ id, ref, title, type, views, dropoffs }], form: { platforms, summary } }`.
 */
export function summaryOf(definition: { id?: any; type?: string; title?: any; workspace?: { href: string; }; theme?: { href: string; }; settings?: { language: string; progress_bar: string; meta: { allow_indexing: boolean; description: any; }; hide_navigation: boolean; is_public: boolean; is_trial: boolean; show_progress_bar: boolean; show_typeform_branding: boolean; are_uploads_public: boolean; show_time_to_complete: boolean; show_number_of_submissions: boolean; show_cookie_consent: boolean; show_question_number: boolean; show_key_hint_on_choices: boolean; autosave_progress: boolean; free_form_navigation: boolean; use_lead_qualification: boolean; pro_subdomain_enabled: boolean; capabilities: { e2e_encryption: { enabled: boolean; modifiable: boolean; }; }; }; welcome_screens?: { id: string; ref: string; title: string; properties: { show_button: boolean; button_text: any; description: string|undefined; }; }[]; thankyou_screens?: { id: string; ref: string; title: string; type: string; properties: { redirect_url?: any; show_button: boolean; share_icons: boolean; button_mode: string; button_text: any; }; }[]; fields: any; logic?: any; created_at?: any; last_updated_at?: any; published_at?: any; _links?: { display: string; responses: string; }; }, stats: { started: any; finished: any; slides: any; average_seconds: any; }) {
  const started = Number(stats?.started || 0), finished = Number(stats?.finished || 0)
  const reach = stats?.slides || []   /* [{ slide, reached }] */
  const flat: any = []
  const walk = (list: any, slide: number) => { for (const f of list || []) { if (f.type === 'group') walk(f.properties.fields, Number(String(f.id).replace('group-', ''))); else if (f.type !== 'statement') flat.push({ f, slide }) } }
  walk(definition.fields, 0)
  const views = (slide: number) => { const r = reach.find((x: { slide: any; }) => Number(x.slide) === slide); return r ? Number(r.reached) : started }
  const fields = flat.map(({ f, slide }: any, i: number) => { const v = views(slide); const next = flat[i + 1] ? views(flat[i + 1].slide) : finished; return { id: f.id, ref: f.ref, title: f.title, type: f.type, views: v, dropoffs: Math.max(0, v - next) } })
  const rate = started ? Math.round((finished / started) * 10000) / 100 : 0
  return { fields, form: { platforms: [{ platform: 'other', responses_count: finished, total_visits: started, unique_visits: started, completion_rate: rate, average_time: Number(stats?.average_seconds || 0) }], summary: { responses_count: finished, total_visits: started, unique_visits: started, completion_rate: rate, average_time: Number(stats?.average_seconds || 0) } } }
}
