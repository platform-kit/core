<script setup>
/*
 * Accomplishments: the trophies the reader has WON — gold first, then silver,
 * then bronze — each saying how many chapters are theirs, what the next trophy
 * takes and, for a whole book, when it became so. A book not yet won is not
 * shown: a wall of empty cups is a list of things not done. With nothing won the
 * page says so once, with the way to the library. A book opens on its cover.
 * No heading over them: the tab already names the page. Words from
 * `trophy.page` in content/app/ui/library.md.
 */
import { computed } from 'vue'
import Trophy from '../../../components/Trophy.vue'
import { us } from '../strings.js'
import { books as BOOKS } from '#content'
import { companions } from '@platform-kit/kit/lib/companions.js'
import { masteryOf, masteryRev } from '@platform-kit/kit/lib/mastery.js'
const T = us('library').trophy
const P = T.page || {}
const order = { gold: 0, silver: 1, bronze: 2 }
const fill = (s, v) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (v[k] == null ? '' : v[k]))
const when = (ms) => { try { return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) } catch (e) { return '' } }
const rows = computed(() => {
  void masteryRev.value
  return companions().map((c) => {
    const b = (BOOKS || []).find((x) => x.slug === c.book)
    const m = masteryOf(c.book)
    /* the next trophy and the chapters it takes: bronze for the first, silver at half, gold for all */
    const next = !m.tier ? ['bronze', 1] : m.tier === 'bronze' ? ['silver', Math.ceil(m.total / 2)] : m.tier === 'silver' ? ['gold', m.total] : null
    return b && m.total ? { slug: c.book, title: b.title, author: b.author, cover: b.cover && (typeof b.cover === 'string' ? b.cover : b.cover.src), ...m, next } : null
  }).filter(Boolean).sort((a, b) => (a.tier ? order[a.tier] : 3) - (b.tier ? order[b.tier] : 3) || (b.done / b.total) - (a.done / a.total) || a.title.localeCompare(b.title))
})
const won = computed(() => rows.value.filter((r) => r.tier))
</script>

<template>
  <div class="tp">
    <div v-if="!won.length" class="tp-empty">
      <Trophy tier="none" :size="56" still />
      <p>{{ P.empty }}</p>
      <a href="/content/books" class="tp-cta">{{ P['empty-cta'] }}</a>
    </div>

    <div v-else class="tp-list">
      <a v-for="r in won" :key="r.slug" class="tp-row" :class="[r.tier ? 'is-' + r.tier : 'is-none']" :href="'/content/books/' + r.slug">
        <Trophy :tier="r.tier || 'none'" :size="52" :still="!r.tier" />
        <span class="tp-text">
          <b>{{ r.title }}</b>
          <i v-if="r.author">{{ r.author }}</i>
          <span class="tp-line">
            <span class="tp-tier">{{ r.tier ? T.tier[r.tier] : P['none-yet'] }}</span>
            <span class="tp-prog">{{ fill(P.progress, { done: r.done, total: r.total }) }}<template v-if="r.next"> · {{ fill(P.next, { tier: T.tier[r.next[0]], n: r.next[1] }) }}</template></span>
            <span v-if="r.mastered" class="tp-when">{{ fill(P.mastered, { date: when(r.mastered) }) }}</span>
          </span>
          <span class="tp-bar" aria-hidden="true"><i :style="{ width: Math.round((r.done / r.total) * 100) + '%' }"></i></span>
        </span>
      </a>
    </div>
  </div>
</template>

<style scoped>
/* nothing won yet: one quiet block, centred, the way in under it */
.tp-empty { display: flex; flex-direction: column; align-items: center; gap: 14px; margin: var(--s3, 26px) auto var(--s4, 40px); padding: 36px 24px;
  max-width: 460px; text-align: center; color: var(--qink3) }
.tp-empty p { margin: 0; max-width: 34ch; font-size: 15px; line-height: 1.5 }
.tp-cta { display: inline-block; font-size: 13.5px; font-weight: 600; color: var(--qink); text-decoration: none; border: 1px solid var(--qhair); border-radius: 999px; padding: 8px 16px }
.tp-cta:hover { border-color: var(--qink2) }
.tp-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px }
.tp-row { display: flex; align-items: center; gap: 16px; padding: 16px 18px; text-decoration: none; color: inherit; background: var(--qcard); border: 1px solid var(--qhair); border-radius: 16px;
  transition: transform .2s ease, box-shadow .2s ease }
.tp-row:hover { transform: translateY(-2px); box-shadow: 0 10px 24px -16px #0006 }
.tp-text { display: flex; flex-direction: column; min-width: 0; flex: 1 }
.tp-text b { font-family: var(--fd); font-size: 16px; font-weight: 600; line-height: 1.2; color: var(--qink) }
.tp-text i { font-style: normal; font-family: var(--m); font-size: 10.5px; color: var(--qink3); margin-top: 2px }
.tp-line { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 8px; font-family: var(--m); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--qink3) }
.tp-tier { font-weight: 600 }
.is-gold .tp-tier { color: #b8811c } .is-silver .tp-tier { color: #7c8593 } .is-bronze .tp-tier { color: #a3612c }
.tp-bar { display: block; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--qink) 10%, transparent); margin-top: 10px; overflow: hidden }
.tp-bar i { display: block; height: 100%; border-radius: 2px; background: var(--qink3) }
.is-gold .tp-bar i { background: #e2b33a } .is-silver .tp-bar i { background: #a9b2bf } .is-bronze .tp-bar i { background: #c47d3f }
@media (max-width: 700px) { .tp-list { grid-template-columns: 1fr } }
</style>
