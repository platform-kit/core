<script setup>
/*
 * A content model's pages — the plain delivery: /c/<key> is the index (the model's name, every published entry
 * by its title with its summary, in the model's order), /c/<key>/<slug> the entry (the title, then every field
 * with a value in the model's order, each with its label; an image shown, markdown and the body rendered, a
 * reference linked to its page when its model has pages, a list as rows, a group as its sub-fields; the body
 * under them), both in the site's design on the content ground. The detail is gated by the model's access as
 * the library gates a book. The words are the models scope's `pages`; the model's own words — its name, its
 * labels — are the model file's. A site that wants more than plain draws its own over the same data.
 */
import { computed, watch } from 'vue'
import { marked } from 'marked'
import SiteLayout from '../layouts/SiteLayout.vue'
import MarkdownDoc from '../components/MarkdownDoc.vue'
import Gate from '../components/Gate.vue'
import SiteClose from '../components/SiteClose.vue'
import * as CONTENT from '#content'
import { ROUTES } from '../router.js'
import { setHead } from '@platform-kit/kit/lib/seo.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import { can, entrySubject } from '@platform-kit/kit/lib/auth.js'
import { allowedBy, requiredBy } from '@platform-kit/kit/lib/access.js'
import { contentView } from '@platform-kit/kit/lib/analytics.js'

const props = defineProps({ path: { type: String, required: true } })
const W = us('models').pages || {}, WI = W.index || {}, WE = W.entry || {}
const MODELS = CONTENT.models || []
const parsed = computed(() => { const [key, ...rest] = props.path.slice(ROUTES.entries.length + 1).split('/'); return { key, slug: rest.join('/') } })
const model = computed(() => MODELS.find((m) => m.key === parsed.value.key && m.deliver && m.deliver.pages) || null)
const listOf = (key) => { const c = CONTENT['models_' + String(key).replace(/-/g, '_')]; return Array.isArray(c) ? c : c ? [c] : [] }
const entries = computed(() => (model.value ? listOf(model.value.key) : []))
/* the count in the model's own words: "3 authors", never "3 entries" */
const counted = computed(() => {
  const n = entries.value.length
  const one = (model.value.singular || model.value.name || '').toLowerCase()
  const many = (model.value.name || '').toLowerCase()
  return n === 1
    ? String(WI['count-one'] || '').replace('{thing}', one)
    : String(WI.count || '').replace('{n}', n).replace('{things}', many)
})
const entry = computed(() => (parsed.value.slug ? entries.value.find((e) => e.slug === parsed.value.slug) || null : null))
const titleOf = (m, e) => String(e[m.title] || e.slug)
/* the summary: the model's first long-text or markdown field */
const summaryField = (m) => m.fields.find((f) => f.kind === 'long-text' || f.kind === 'markdown')
const summaryOf = (m, e) => { const f = summaryField(m); return f && e[f.key] ? String(e[f.key]).replace(/[#*_>`]/g, '').split('\n').find((l) => l.trim()) || '' : '' }
const dateField = (m) => m.fields.find((f) => f.kind === 'date' || f.kind === 'datetime')
const imageField = (m) => m.fields.find((f) => f.kind === 'image')
/* a model's own bar, asked of the ability */
const allowed = computed(() => !model.value || can('read', entrySubject({ kind: 'entries', slug: model.value.key, canAccess: model.value.access })))
/* a reference: the other model's entry, and its page when that model has pages */
const refOf = (f, slug) => { const m = MODELS.find((x) => x.key === f.model); const e = m && listOf(m.key).find((x) => x.slug === slug); return { title: e ? titleOf(m, e) : slug, href: m && e && m.deliver && m.deliver.pages ? `${ROUTES.entries}/${m.key}/${e.slug}` : null } }
const src = (v) => (v && typeof v === 'object' ? v.src : v)
const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)
const shown = computed(() => (entry.value && model.value ? model.value.fields.filter((f) => f.key !== model.value.title && !empty(entry.value[f.key])) : []))
const md = (s) => marked.parse(String(s || ''))
const when = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || '')); if (!m) return s; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) + (m[4] ? `, ${m[4]}:${m[5]}` : '') }
watch([model, entry], ([m, e]) => {
  if (!m) { setHead({ title: '', path: props.path, noindex: true }); return }
  if (e) { setHead({ title: titleOf(m, e), description: summaryOf(m, e), image: imageField(m) ? src(e[imageField(m).key]) || '' : '', path: props.path, type: 'article' }); contentView({ kind: 'entry', id: m.key + '/' + e.slug, title: titleOf(m, e) }) }
  else setHead({ title: m.name, description: '', path: props.path })
}, { immediate: true })
</script>

<template>
  <SiteLayout :current="ROUTES.content" :transparent="true">
    <div class="contentground under">
      <!-- the index -->
      <div v-if="model && !entry" class="wrap ep">
        <header class="ep-head"><h1>{{ model.name }}</h1><p class="subtitle">{{ counted }}</p></header>
        <p v-if="!entries.length" class="ep-empty">{{ WI.empty }}</p>
        <ul v-else class="ep-list">
          <li v-for="e in entries" :key="e.slug" class="ep-item">
            <a :href="`${ROUTES.entries}/${model.key}/${e.slug}`" class="ep-link">
              <span v-if="imageField(model) && src(e[imageField(model).key])" class="ep-thumb"><img :src="src(e[imageField(model).key])" alt="" /></span>
              <span class="ep-text">
                <span class="ep-title">{{ titleOf(model, e) }}</span>
                <span v-if="dateField(model) && e[dateField(model).key]" class="ep-date">{{ when(e[dateField(model).key]) }}</span>
                <span v-if="summaryOf(model, e)" class="ep-sum">{{ summaryOf(model, e) }}</span>
              </span>
            </a>
          </li>
        </ul>
      </div>

      <!-- the entry -->
      <div v-else-if="model && entry" class="wrap ep">
        <header class="ep-head ep-one">
          <a :href="`${ROUTES.entries}/${model.key}`" class="ep-back">← {{ WE.back.replace('{name}', model.name) }}</a>
          <h1>{{ titleOf(model, entry) }}</h1>
        </header>
        <template v-if="allowed">
          <dl v-if="shown.length" class="ep-fields">
            <template v-for="f in shown" :key="f.key">
              <dt>{{ f.label }}</dt>
              <dd>
                <img v-if="f.kind === 'image'" :src="src(entry[f.key])" :alt="f.label" class="ep-img" />
                <a v-else-if="f.kind === 'file'" :href="src(entry[f.key])" download>{{ f.label }}</a>
                <MarkdownDoc v-else-if="f.kind === 'markdown'" :html="md(entry[f.key])" class="ep-md" />
                <span v-else-if="f.kind === 'boolean'">{{ entry[f.key] ? WE.yes : WE.no }}</span>
                <span v-else-if="f.kind === 'date' || f.kind === 'datetime'">{{ when(entry[f.key]) }}</span>
                <a v-else-if="f.kind === 'url'" :href="entry[f.key]" rel="noopener">{{ entry[f.key] }}</a>
                <a v-else-if="f.kind === 'email'" :href="'mailto:' + entry[f.key]">{{ entry[f.key] }}</a>
                <span v-else-if="f.kind === 'select'">{{ (f.options.find((o) => o.value === entry[f.key]) || {}).label || entry[f.key] }}</span>
                <span v-else-if="f.kind === 'multi-select'">{{ entry[f.key].map((v) => (f.options.find((o) => o.value === v) || {}).label || v).join(', ') }}</span>
                <span v-else-if="f.kind === 'tags'" class="ep-tags"><span v-for="t in entry[f.key]" :key="t" class="ep-tag">{{ t }}</span></span>
                <span v-else-if="f.kind === 'reference'" class="ep-refs"><template v-for="(s, i) in (Array.isArray(entry[f.key]) ? entry[f.key] : [entry[f.key]])" :key="s"><span v-if="i">, </span><a v-if="refOf(f, s).href" :href="refOf(f, s).href">{{ refOf(f, s).title }}</a><span v-else>{{ refOf(f, s).title }}</span></template></span>
                <dl v-else-if="f.kind === 'group'" class="ep-group"><template v-for="g in f.fields.filter((g) => !empty(entry[f.key][g.key]))" :key="g.key"><dt>{{ g.label }}</dt><dd>{{ g.kind === 'boolean' ? (entry[f.key][g.key] ? WE.yes : WE.no) : Array.isArray(entry[f.key][g.key]) ? entry[f.key][g.key].join(', ') : entry[f.key][g.key] }}</dd></template></dl>
                <ul v-else-if="f.kind === 'list'" class="ep-rows">
                  <li v-for="(row, i) in entry[f.key]" :key="i">
                    <dl v-if="f.of === 'group'" class="ep-group"><template v-for="g in f.fields.filter((g) => !empty(row[g.key]))" :key="g.key"><dt>{{ g.label }}</dt><dd>{{ g.kind === 'boolean' ? (row[g.key] ? WE.yes : WE.no) : Array.isArray(row[g.key]) ? row[g.key].join(', ') : row[g.key] }}</dd></template></dl>
                    <a v-else-if="f.of === 'reference' && refOf(f, row).href" :href="refOf(f, row).href">{{ refOf(f, row).title }}</a>
                    <a v-else-if="f.of === 'url'" :href="row" rel="noopener">{{ row }}</a>
                    <span v-else>{{ f.of === 'reference' ? refOf(f, row).title : Array.isArray(row) ? row.join(', ') : row }}</span>
                  </li>
                </ul>
                <span v-else>{{ entry[f.key] }}</span>
              </dd>
            </template>
          </dl>
          <div v-if="entry.body" class="ep-body"><MarkdownDoc :html="entry.body" /></div>
        </template>
        <Gate v-else kind="doc" :required="requiredBy(model.access)" />
        <SiteClose />
      </div>

      <div v-else class="wrap ep"><header class="ep-head"><h1>{{ WI.empty }}</h1></header></div>
    </div>
  </SiteLayout>
</template>

<style scoped>
.contentground.under { padding-top: var(--headh, 74px) }   /* under the transparent header, as the library stands */
.ep { padding-bottom: 40px }
.ep-head { padding: 56px 0 30px }
.ep-head h1 { max-width: none }
.ep-one { display: flex; flex-direction: column; gap: 14px; align-items: flex-start }
.ep-back { font-family: var(--m); font-size: 12px; letter-spacing: .04em; color: var(--ink3); text-decoration: none } .ep-back:hover { color: var(--ink) }
.ep-empty { padding: 30px 0; color: var(--ink2) }
.ep-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column }
.ep-item { border-bottom: 1px solid var(--hair) }
.ep-link { display: flex; gap: 20px; align-items: flex-start; padding: 22px 0; color: inherit; text-decoration: none }
.ep-link:hover .ep-title { text-decoration: underline; text-underline-offset: 4px }
.ep-thumb { flex: none; width: 88px; aspect-ratio: 1; border-radius: 10px; overflow: hidden; background: var(--wash) } .ep-thumb img { width: 100%; height: 100%; object-fit: cover; display: block }
.ep-text { display: flex; flex-direction: column; gap: 5px; min-width: 0 }
.ep-title { font-family: var(--fd); font-weight: 600; font-size: 22px; letter-spacing: -.015em; line-height: 1.2 }
.ep-date { font-family: var(--m); font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3) }
.ep-sum { font-size: 16px; color: var(--ink2); line-height: 1.5; max-width: 66ch }
.ep-fields { display: grid; grid-template-columns: minmax(120px, 200px) minmax(0, 1fr); gap: 14px 28px; margin: 0; padding: 0 0 28px; font-size: 16.5px; line-height: 1.55 }
.ep-fields > dt { font-family: var(--m); font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); padding-top: 4px }
.ep-fields > dd { margin: 0; min-width: 0 }
.ep-img { display: block; max-width: 100%; border-radius: 12px }
.ep-md :deep(p:last-child) { margin-bottom: 0 } .ep-md :deep(section.purpose), .ep-body :deep(section.purpose) { padding-top: 0 } .ep-md :deep(section.purpose > :first-child), .ep-body :deep(section.purpose > :first-child) { margin-top: 0 }
.ep-tags { display: flex; flex-wrap: wrap; gap: 6px } .ep-tag { font-size: 13px; border: 1px solid var(--hair); border-radius: 999px; padding: 2px 10px; color: var(--ink2) }
.ep-group { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 16px; margin: 0 } .ep-group dt { color: var(--ink3); font-size: 14px } .ep-group dd { margin: 0 }
.ep-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px } .ep-rows > li { padding: 10px 14px; border: 1px solid var(--hair); border-radius: 10px }
.ep-body { max-width: 68ch; padding-top: 8px; border-top: 1px solid var(--hair); margin-top: 8px; padding-bottom: 30px }
@media (max-width: 640px) { .ep-fields { grid-template-columns: 1fr; gap: 4px 0 } .ep-fields > dd { margin-bottom: 12px } .ep-link { gap: 14px } .ep-thumb { width: 64px } }
</style>
