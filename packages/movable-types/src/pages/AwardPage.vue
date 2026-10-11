<script setup>
/*
 * AN ACHIEVEMENT'S OWN PAGE, at /a/<slug>.
 *
 * It is a page anybody may read, earned or not. A page nobody can open before they have earned it
 * is a page nobody knows to try for, and the point of saying a thing is worth doing is that people
 * hear it said. Where the file puts a bar on it (`canAccess`), the body waits behind the usual
 * gate and the title does not — the same rule an article follows.
 *
 * What is on it: the badge, the title and its line, whether the reader has it (and when), the
 * markdown body, and any audio or video the file names — through MediaBlock, like everything else
 * that plays on this site.
 *
 * Words from the `awards` scope.
 */
import { computed, ref, watch } from 'vue'
import { route, ROUTES } from '@platform-kit/kit/lib/router.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { mine, loadMine, awardOf } from '@platform-kit/kit/lib/awards.js'
import { userClass } from '@platform-kit/kit/lib/auth.js'
import { allowedBy, requiredBy } from '@platform-kit/kit/lib/access.js'
import { setHead } from '@platform-kit/kit/lib/seo.js'
import SiteLayout from '../layouts/SiteLayout.vue'
import MarkdownDoc from '../components/MarkdownDoc.vue'
import MediaBlock from '../components/content/MediaBlock.vue'
import Gate from '../components/Gate.vue'
import SiteClose from '../components/SiteClose.vue'
import AwardBadge from '../components/AwardBadge.vue'

const W = computed(() => us('awards').page.main)
const slug = computed(() => decodeURIComponent((route.value || '').slice(ROUTES.awards.length + 1).split('/')[0]))
const a = computed(() => awardOf(slug.value))
const held = computed(() => (mine.value || []).find((x) => x.slug === slug.value) || null)
const allowed = computed(() => allowedBy(a.value && a.value.canAccess, userClass.value))

loadMine()
watch(a, (x) => { if (x) setHead({ title: x.title, description: x.sub || '' }) }, { immediate: true })
const when = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
</script>

<template>
  <SiteLayout>
    <article v-if="a" class="aw">
      <header class="aw-head">
        <AwardBadge :award="a" :size="96" :held="!!held" />
        <h1>{{ a.title }}</h1>
        <p v-if="a.sub" class="aw-sub">{{ a.sub }}</p>
        <p v-if="held" class="aw-held">{{ (W.held || '').replace('{when}', when(held.awarded_at)) }}</p>
        <p v-else class="aw-not">{{ W['not-held'] }}</p>
      </header>

      <div v-if="a.media && allowed" class="aw-media"><MediaBlock :media="a.media" /></div>
      <div v-if="allowed" class="aw-body"><MarkdownDoc :html="a.body" /></div>
      <Gate v-else kind="doc" :required="requiredBy(a.canAccess)" />
    </article>

    <div v-else class="aw-none">
      <h1>{{ W['none-title'] }}</h1>
      <p>{{ W['none-line'] }}</p>
    </div>
    <SiteClose />
  </SiteLayout>
</template>

<style scoped>
.aw { max-width: 640px; margin: 0 auto; padding: 60px 24px 40px }
.aw-head { margin: 0 0 32px; padding: 0; border: 0; text-align: center }
.aw-head h1 { margin: 22px 0 0; font-family: var(--fd); font-size: clamp(30px, 4.4vw, 44px); font-weight: 700;
  letter-spacing: -.022em; line-height: 1.08; color: var(--ink) }
.aw-sub { margin: 10px 0 0; font-size: 17px; line-height: 1.55; color: var(--ink2) }
.aw-held { margin: 16px 0 0; font-family: var(--m); font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--accent2) }
.aw-not { margin: 16px 0 0; font-family: var(--m); font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--ink3) }
.aw-media { margin: 0 0 30px }
.aw-body :deep(p) { font-size: 17.5px; line-height: 1.75; color: var(--ink2); margin: 0 0 20px }
.aw-none { max-width: 560px; margin: 0 auto; padding: 80px 24px; text-align: center }
.aw-none h1 { margin: 0 0 8px; font-family: var(--fd); font-size: 30px; font-weight: 700; color: var(--ink) }
.aw-none p { margin: 0; font-size: 15px; color: var(--ink3) }
@media (max-width: 560px) { .aw { padding: 40px 18px 30px } }
</style>
