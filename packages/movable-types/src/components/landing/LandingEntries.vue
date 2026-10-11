<script setup>
/*
 * Entries: a content model's published entries on a landing page — as cards or a list, as many as the section
 * says, in the model's order, each linking to its page when the model has pages — under an optional eyebrow,
 * heading and lead of the page's own. The model is chosen in the page builder from those with the section
 * delivery on; one the site no longer has leaves the section quiet.
 */
/* Slots for a look's skin: `head` (the words above) and `entries` (the cards or the list). */
import { computed } from 'vue'
import * as CONTENT from '#content'
import { ROUTES } from '../../router.js'
import { us } from '@platform-kit/kit/lib/strings.js'
const props = defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  model: { type: String, default: '' },
  layout: { type: String, default: 'cards' },   /* cards | list */
  limit: { type: Number, default: 0 },          /* 0 = every entry */
})
const W = (us('models').pages || {}).index || {}
const MODELS = CONTENT.models || []
const model = computed(() => MODELS.find((m) => m.key === props.model && m.deliver && m.deliver.section) || null)
const entries = computed(() => { if (!model.value) return []; const c = CONTENT['models_' + model.value.key.replace(/-/g, '_')]; const list = Array.isArray(c) ? c : c ? [c] : []; return props.limit > 0 ? list.slice(0, props.limit) : list })
const titleOf = (e) => String(e[model.value.title] || e.slug)
const summaryField = computed(() => (model.value ? model.value.fields.find((f) => f.kind === 'long-text' || f.kind === 'markdown') : null))
const summaryOf = (e) => (summaryField.value && e[summaryField.value.key] ? String(e[summaryField.value.key]).replace(/[#*_>`]/g, '').split('\n').find((l) => l.trim()) || '' : '')
const imageField = computed(() => (model.value ? model.value.fields.find((f) => f.kind === 'image') : null))
const imageOf = (e) => { const v = imageField.value && e[imageField.value.key]; return v && typeof v === 'object' ? v.src : v || '' }
const hrefOf = (e) => (model.value.deliver.pages ? `${ROUTES.entries}/${model.value.key}/${e.slug}` : null)
const indexHref = computed(() => (model.value && model.value.deliver.pages ? `${ROUTES.entries}/${model.value.key}` : null))
</script>

<template>
  <section class="lpsec lpentries lprv">
    <div class="lpwrap">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead">
        <div v-if="eyebrow || heading || lead" class="lpen-head">
          <span v-if="eyebrow" class="lpeyebrow">{{ eyebrow }}</span>
          <h2 v-if="heading" class="lph2">{{ heading }}</h2>
          <p v-if="lead" class="lplead">{{ lead }}</p>
        </div>
      </slot>
      <slot name="entries" :model="model" :entries="entries" :title-of="titleOf" :summary-of="summaryOf" :image-of="imageOf" :href-of="hrefOf">
        <template v-if="model">
          <p v-if="!entries.length" class="lpen-empty">{{ W.empty }}</p>
          <div v-else-if="layout === 'list'" class="lpen-list">
            <component :is="hrefOf(e) ? 'a' : 'div'" v-for="e in entries" :key="e.slug" class="lpen-row" :href="hrefOf(e)">
              <span v-if="imageOf(e)" class="lpen-thumb"><img :src="imageOf(e)" alt="" /></span>
              <span class="lpen-text"><b class="lpen-title">{{ titleOf(e) }}</b><span v-if="summaryOf(e)" class="lpen-sum">{{ summaryOf(e) }}</span></span>
            </component>
          </div>
          <div v-else class="lpen-cards">
            <component :is="hrefOf(e) ? 'a' : 'div'" v-for="(e, i) in entries" :key="e.slug" class="lpcard lpen-card lpk" :style="{ '--k': (0.1 + i * 0.12) + 's' }" :href="hrefOf(e)">
              <span v-if="imageOf(e)" class="lpen-pic"><img :src="imageOf(e)" alt="" /></span>
              <b class="lpen-title">{{ titleOf(e) }}</b>
              <span v-if="summaryOf(e)" class="lpen-sum">{{ summaryOf(e) }}</span>
            </component>
          </div>
          <p v-if="indexHref && limit > 0" class="lpen-all"><a :href="indexHref">{{ W.all.replace('{name}', model.name) }} →</a></p>
        </template>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpentries { padding: 56px 0 }
.lpentries:first-child { padding-top: calc(var(--headh, 72px) + 40px) }
.lpen-head { max-width: 720px; margin: 0 0 28px }
.lpen-empty { color: var(--ink2) }
.lpen-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px }
.lpen-card { display: flex; flex-direction: column; gap: 8px; padding: 20px 20px 18px; border-radius: 16px; text-decoration: none; color: inherit; min-height: 150px }
a.lpen-card:hover { transform: translateY(-3px); box-shadow: var(--shhi) }
.lpen-pic { display: block; aspect-ratio: 3 / 2; border-radius: 10px; overflow: hidden; margin-bottom: 6px; background: var(--wash) } .lpen-pic img { width: 100%; height: 100%; object-fit: cover; display: block }
.lpen-title { font-family: var(--fd); font-weight: 600; font-size: 20px; letter-spacing: -.015em; line-height: 1.2 }
.lpen-sum { font-size: 15px; line-height: 1.5; color: var(--ink2) }
.lpen-list { display: flex; flex-direction: column }
.lpen-row { display: flex; gap: 16px; align-items: flex-start; padding: 16px 0; border-bottom: 1px solid var(--hair); text-decoration: none; color: inherit }
.lpen-row:hover .lpen-title { text-decoration: underline; text-underline-offset: 4px }
.lpen-thumb { flex: none; width: 64px; aspect-ratio: 1; border-radius: 8px; overflow: hidden; background: var(--wash) } .lpen-thumb img { width: 100%; height: 100%; object-fit: cover; display: block }
.lpen-text { display: flex; flex-direction: column; gap: 4px; min-width: 0 }
.lpen-all { margin: 22px 0 0 } .lpen-all a { font-family: var(--m); font-size: 12.5px; letter-spacing: .04em; color: var(--ink2); text-decoration: none } .lpen-all a:hover { color: var(--ink) }
</style>
