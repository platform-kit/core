<script setup>
/*
 * A landing page, assembled from its markdown: the sections it names, in
 * order, each with its props. The root page and any other page route land
 * here. Where an experiment names several pages on the route as its variants,
 * the experiments module decides which one this visitor sees. A draft from the
 * admin's live preview arrives through inject in place of the compiled page.
 */
import { computed, inject, watch, nextTick, onBeforeUnmount, watchEffect } from 'vue'
import SiteLayout from '../layouts/SiteLayout.vue'
import { ROUTES } from '../router.js'
import { pages as PAGES } from '#content'
import { SECTIONS, resolve } from '../components/landing/index.js'
import { look } from '@platform-kit/kit/lib/look.js'
import { initLanding } from '../components/landingEffects.js'
import { choosePage, expose } from '@platform-kit/kit/lib/experiments.js'
import { headForPage } from '@platform-kit/kit/lib/seo.js'
import ScrollProgress from '../components/landing/ScrollProgress.vue'
import { siteFooterOff } from '@platform-kit/kit/lib/chrome.js'

const props = defineProps({ path: { type: String, default: '/' } })
const preview = inject('dl-preview', null)
const page = computed(() => (preview ? preview.value : choosePage(PAGES.filter((p) => p.route === props.path))))
/* each section as the current look renders it; the key carries the look so a
   change of look remounts the sections (and restarts the effects below) */
const sections = computed(() => ((page.value && page.value.sections) || []).map((s, i) => {
  const comp = resolve(s.component, look.value)
  if (!SECTIONS[s.component] && import.meta.env.DEV) console.warn('[pages] unknown section', s.component)
  /* a section's tone and anchor are the page's to set and the ground's to draw: stamped on the section's root, never handed to it as props */
  const { tone, anchor, glow, ground, spacing, width, reveal, ...props } = s.props || {}
  const or = (v, none) => (v && v !== none ? v : undefined)
  return comp ? { key: look.value + ':' + i + ':' + s.component, comp, props, tone: or(tone, 'paper'), anchor: anchor || undefined, glow: or(glow, 'none'), ground: or(ground, 'none'), spacing: or(spacing, 'normal'), width: or(width, 'normal'), reveal: or(reveal, 'none') } : null
}).filter(Boolean))

/* the effects read the DOM the sections just produced, so they wait a tick;
   a page change (another variant in the preview) restarts them */
let teardown = null
watch([page, look], async ([p]) => {
  if (teardown) { teardown(); teardown = null }
  if (!preview) headForPage(p)
  if (!p) return
  await nextTick()
  teardown = initLanding()
  if (!preview) expose(p)
}, { immediate: true, flush: 'post' })
onBeforeUnmount(() => { if (teardown) teardown() })

/* THE LAYOUT DRAWS THE SITE'S FOOTER unless this page says otherwise — because its markdown says
   footer: false, or because its own sections name a Footer and it would otherwise end in two. Read
   from the page's OWN sections, not the rendered ones, which carry only a resolved component; and
   it follows the page rather than the mount, so switching variants in the preview cannot leave the
   flag saying the wrong thing. */
watchEffect(() => {
  const pg = page.value || {}
  siteFooterOff.value = pg.footer === false
    || ((pg.sections || []).some((x) => String((x && x.component) || '') === 'Footer'))
})
onBeforeUnmount(() => { siteFooterOff.value = false })
</script>

<template>
  <SiteLayout transparent :current="ROUTES.home">
    <section data-tab="landing" class="lpsection lpsectionfull">
      <div class="lproot lpfull">
        <div class="lpbg"></div>
        <div class="lpblobs"><span class="lpblob lpb1"></span><span class="lpblob lpb2"></span><span class="lpblob lpb3"></span></div>
        <div class="lpgrain"></div>
        <component v-for="(s, i) in sections" :is="s.comp" :key="s.key" v-bind="s.props" :data-tone="s.tone" :data-glow="s.glow" :data-ground="s.ground" :data-spacing="s.spacing" :data-width="s.width" :data-reveal="s.reveal" :id="s.anchor" :data-section="preview ? i : undefined" />
        <!-- the page's own extras: a thin progress bar as it is read -->
        <ScrollProgress v-if="page && page.progress" />
      </div>
    </section>
  </SiteLayout>
</template>
