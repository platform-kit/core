<script setup>
import { computed } from 'vue'
import { md } from './md.js'
import { articles as ARTICLES } from '#content'
import { ROUTES } from '../../router.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import SectionHead from './SectionHead.vue'
/*
 * Articles: the latest writing, from the site's own articles — as many as the page says, newest
 * first, a tag to keep to when the page names one — as cards (the cover, the title, a line, the
 * date), or as a list; and one featured large when the layout says so. Each links to its page.
 * The words above and the button are the page's; "Read" is the sections' strings.
 *
 * Slots for a look's skin: `head` and `articles`.
 */
const props = defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  layout: { type: String, default: 'cards' },   /* cards | list | featured */
  limit: { type: Number, default: 3 },
  tag: { type: String, default: '' },
  cta: { type: String, default: '' }, href: { type: String, default: '' },
})
const W = (us('sections').articles || {}).card || {}
const items = computed(() => {
  const all = (ARTICLES || []).filter((a) => a.published !== false && (!props.tag || (a.tags || []).includes(props.tag)))
  all.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  return all.slice(0, Math.max(1, props.limit))
})
const when = (d) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d)) } catch (e) { return '' } }
const link = (a) => `${ROUTES.content}/articles/${a.id}`
const line = (a) => a.description || ''
</script>

<template>
  <section class="lpsec lparticles" :class="'lparticles-' + layout">
    <div class="lpwrap">
      <div class="lpar-top">
        <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead class="lpar-head" :eyebrow="eyebrow" :heading="heading" :lead="lead" /></slot>
        <a v-if="cta" :href="href || ROUTES.content + '/articles'" class="lpar-more lprv" v-html="md(cta)"></a>
      </div>
      <slot name="articles" :items="items" :md="md">
        <!-- a list -->
        <div v-if="layout === 'list' && items.length" class="lpar-list lprv lpd1">
          <a v-for="(a, i) in items" :key="a.id" :href="link(a)" class="lpar-row lpk" :style="{ '--k': (0.1 + i * 0.06) + 's' }">
            <span class="lpar-date lpnum">{{ when(a.date) }}</span>
            <span class="lpar-roww"><h4>{{ a.title }}</h4><p v-if="line(a)">{{ line(a) }}</p></span>
            <span class="lpar-read">{{ W.read }} →</span>
          </a>
        </div>
        <!-- cards, the first large when featured -->
        <div v-else-if="items.length" class="lpar-grid" :class="{ 'lpar-feat': layout === 'featured' }">
          <a v-for="(a, i) in items" :key="a.id" :href="link(a)" class="lpcard lpar lplift lprv" :class="{ 'lpar-big': layout === 'featured' && i === 0, ['lpd' + Math.min(3, i % 4)]: i % 4 }">
            <span class="lpar-cover"><img v-if="a.image" :src="a.image" :alt="a.title" loading="lazy" decoding="async" /></span>
            <span class="lpar-words">
              <span class="lpar-meta"><span v-if="a.date" class="lpnum">{{ when(a.date) }}</span><span v-if="a.tags && a.tags.length" class="lpar-tag">{{ a.tags[0] }}</span></span>
              <h4>{{ a.title }}</h4>
              <p v-if="line(a)">{{ line(a) }}</p>
            </span>
          </a>
        </div>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpar-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px }
.lpar-top :deep(.lpshead) { margin-bottom: 36px }
.lpar-more { margin-bottom: 40px; font-size: 14.5px; font-weight: 600; color: var(--accent2); text-decoration: none; white-space: nowrap }
.lpar-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px }
.lpar { display: flex; flex-direction: column; overflow: hidden; color: inherit; text-decoration: none }
.lpar-cover { display: block; aspect-ratio: 16 / 10; background: var(--wash); overflow: hidden }
.lpar-cover img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .6s cubic-bezier(.2,.8,.2,1) }
.lpar:hover .lpar-cover img { transform: scale(1.03) }
.lpar-words { display: flex; flex-direction: column; gap: 8px; padding: 18px 20px 20px }
.lpar-meta { display: flex; gap: 10px; align-items: center; font-family: var(--m); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3) }
.lpar-tag { color: var(--accent2) }
.lpar h4 { font-size: 18px; letter-spacing: -.01em; line-height: 1.25 }
.lpar p { margin: 0; font-size: 14.5px; line-height: 1.5; color: var(--ink2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden }
/* featured: the first across the row */
.lpar-feat .lpar-big { grid-column: 1 / -1; flex-direction: row }
.lpar-feat .lpar:not(.lpar-big) { flex-direction: row }
.lpar-feat .lpar:not(.lpar-big) .lpar-cover { width: 44%; aspect-ratio: auto; flex: none }
.lpar-feat .lpar:not(.lpar-big) .lpar-words { justify-content: center }
.lpar-feat .lpar-big .lpar-cover { width: 55%; aspect-ratio: 16 / 9; flex: none }
.lpar-feat .lpar-big .lpar-words { justify-content: center; padding: 32px } .lpar-feat .lpar-big h4 { font-size: 28px }
/* the list */
.lpar-list { display: flex; flex-direction: column; border-top: 1px solid var(--hair) }
.lpar-row { display: grid; grid-template-columns: 130px minmax(0, 1fr) auto; gap: 24px; align-items: center; padding: 18px 4px; border-bottom: 1px solid var(--hair); color: inherit; text-decoration: none; transition: background .15s }
.lpar-row:hover { background: var(--wash) }
.lpar-date { font-family: var(--m); font-size: 11.5px; letter-spacing: .06em; color: var(--ink3); text-transform: uppercase }
.lpar-roww h4 { font-size: 18px; margin-bottom: 3px } .lpar-roww p { margin: 0; font-size: 14.5px; color: var(--ink2) }
.lpar-read { font-size: 14px; font-weight: 600; color: var(--accent2); white-space: nowrap }
@media (max-width: 980px) { .lpar-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lpar-feat .lpar, .lpar-feat .lpar-big { flex-direction: column } .lpar-feat .lpar .lpar-cover, .lpar-feat .lpar-big .lpar-cover { width: 100%; aspect-ratio: 16 / 9 } }
@media (max-width: 600px) { .lpar-grid { grid-template-columns: 1fr } .lpar-top { flex-direction: column; align-items: flex-start } .lpar-more { margin-bottom: 24px } .lpar-row { grid-template-columns: 1fr; gap: 6px } .lpar-read { display: none } }
</style>
