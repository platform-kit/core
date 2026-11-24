<script setup lang="ts">
/*
 * THE COMMUNITY'S HOME AS AN OVERVIEW (openspec: community-home), where content/community.md home.overview is on.
 *
 * A feed is only as good as the last person who posted in it; a community whose owner is not posting opens on "No posts
 * yet", and the first page a member sees says nothing is here. This opens on the member's own standing instead — the
 * way Circle's Home page and Kajabi's member dashboard do: a greeting over the community's name, then a card for each
 * thing that is theirs (the course they are in, their next session, what they are reading, and whatever a module or
 * the site adds), then the feed beneath, once the community has anything in it.
 *
 * A card decides for itself whether it has something to say: it emits `state` ('ready' or 'empty'), and an empty one
 * takes no room. The kit's own (Coaching, Reading) are drawn here; the rest come from #site homeCards — spaces' home
 * slot, and the site's community.homeCards — ordered with them. Words: ## home in the spaces scope.
 */
import { ref, computed, onMounted, defineAsyncComponent, markRaw } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { user } from 'platformkit/lib/auth.js'
import { supabase } from 'platformkit/lib/supabase.js'
import { moduleOn } from 'platformkit/lib/modules.js'
import { bookShelf } from 'platformkit/lib/content.js'
import { settings } from 'platformkit/lib/spaces/settings.js'
import { homeCards as SITE_CARDS } from '#site'
import HomeCoaching from './HomeCoaching.vue'
import HomeReading from './HomeReading.vue'

const props = defineProps({
  /* the Coaching place is in the community (coachingPlace: sessions on, coaching.where spaces) */
  coaching: { type: Boolean, default: false },
  /* the reader's name as the community shows it */
  name: { type: String, default: '' },
})

const W = computed(() => us('spaces').home.main)
const I = computed(() => us('spaces').index.main)
const C = computed(() => settings())

/* the hour, said as a person would say it, with their first name where we have one */
const first = computed(() => {
  const m: any = (user.value && user.value.user_metadata) || {}
  return String(props.name || m.first_name || m.name || m.full_name || '').trim().split(/\s+/)[0] || ''
})
const greeting = computed(() => {
  const h = new Date().getHours()
  const key = h < 12 ? 'greeting-morning' : h < 18 ? 'greeting-afternoon' : 'greeting-evening'
  const s = String(I.value[key] || '')
  return (first.value ? s.replace('{name}', first.value) : s.replace(/[,\s]*\{name\}/, '')).replace(/[,;:\s]+$/, '')
})

/* EVERY CARD, IN ORDER: the theme's own beside the modules' and the site's */
const cards = computed(() => [
  ...(props.coaching && moduleOn('sessions') ? [{ key: 'coaching', order: 30, component: markRaw(HomeCoaching) }] : []),
  /* Reading is the one card with something to look at: it takes the whole row, under the others */
  ...(bookShelf().length ? [{ key: 'reading', order: 40, full: true, component: markRaw(HomeReading) }] : []),
  ...((SITE_CARDS || []) as any[]).map((x) => ({ key: x.key, order: x.order, full: false, component: markRaw(defineAsyncComponent(x.load)) })),
].sort((a, b) => a.order - b.order))
const small = computed(() => cards.value.filter((c) => !c.full))
const full = computed(() => cards.value.filter((c) => c.full))
const state = ref<Record<string, string>>({})
/* THE SHORT CARDS SHARE A ROW: three across, or two, or one; four make two rows of two */
const across = computed(() => { const n = small.value.filter((c) => state.value[c.key] === 'ready').length; return n === 4 ? 2 : Math.max(1, Math.min(3, n)) })
/* where only two fit across (a narrower screen), an odd card out takes the whole row rather than leaving a hole beside it */
const lastOdd = computed(() => { const r = small.value.filter((c) => state.value[c.key] === 'ready'); return r.length % 2 === 1 ? r[r.length - 1].key : '' })

/* THE FEED BENEATH, once there is anything in it: one row asked for, never an empty state */
const posts = ref(false)
onMounted(async () => {
  if (!supabase || !user.value) return
  try {
    const { data } = await supabase.rpc('network_timeline', { p_before: null, p_limit: 1, p_all_spaces: true })
    posts.value = Array.isArray(data) && data.length > 0
  } catch { posts.value = false }
})
</script>

<template>
  <div class="ch">
    <header class="ch-band">
      <img v-if="C.cover" class="ch-cover" :src="C.cover" alt="" aria-hidden="true" />
      <div class="ch-band-in">
        <p v-if="C.name" class="ch-kicker">{{ C.name }}</p>
        <h1 class="ch-hello">{{ greeting }}</h1>
        <p v-if="C.tagline" class="ch-tagline">{{ C.tagline }}</p>
      </div>
    </header>

    <div class="ch-grid" :style="{ '--across': across }">
      <div v-for="c in small" v-show="state[c.key] === 'ready'" :key="c.key" class="ch-cell" :class="{ 'ch-odd': c.key === lastOdd }">
        <component :is="c.component" @state="(s: string) => (state[c.key] = s)" />
      </div>
    </div>
    <div v-for="c in full" v-show="state[c.key] === 'ready'" :key="c.key" class="ch-cell ch-full">
      <component :is="c.component" @state="(s: string) => (state[c.key] = s)" />
    </div>

    <section v-if="posts" class="ch-posts">
      <h2 class="ch-posts-title">{{ W.posts }}</h2>
      <slot />
    </section>
  </div>
</template>

<style scoped>
.ch { max-width: 1040px; margin: 0 auto; padding: 40px 32px 72px; box-sizing: border-box; }
.ch-band { position: relative; overflow: hidden; margin: 0 0 28px; padding: 0; border: 0; background: none; }
.ch-cover { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .18; pointer-events: none; }
.ch-band-in { position: relative; }
.ch-kicker { margin: 0 0 10px; font-family: var(--m); font-size: 11.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); }
.ch-hello { margin: 0; font-size: clamp(30px, 4vw, 42px); line-height: 1.1; letter-spacing: -.01em; font-weight: 700; color: var(--ink); }
.ch-tagline { margin: 10px 0 0; font-size: 17px; line-height: 1.5; color: var(--ink2); max-width: 40em; }
.ch-grid { display: grid; grid-template-columns: repeat(var(--across, 2), minmax(0, 1fr)); gap: 18px; }
.ch-cell { min-width: 0; display: flex; }
.ch-cell > :deep(*) { flex: 1; }
.ch-full { margin-top: 18px; }
.ch-posts { margin-top: 44px; }
.ch-posts-title { margin: 0 0 12px; font-size: 13px; font-family: var(--m); letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); font-weight: 500; }
@media (max-width: 1100px) { .ch-grid { grid-template-columns: repeat(min(var(--across, 2), 2), minmax(0, 1fr)); } .ch-odd { grid-column: 1 / -1; } }
@media (max-width: 760px) {
  .ch { padding: 26px 16px 56px; }
  .ch-grid { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .ch-full { margin-top: 14px; }
}
</style>

<!-- THE PARTS EVERY CARD SHARES, unscoped so a module's card and a site's look like the kit's: written under .ch so they
     reach nothing outside Home -->
<style>
.ch .hc { position: relative; display: flex; flex-direction: column; gap: 14px; box-sizing: border-box; min-height: 100%; margin: 0; padding: 22px 22px 20px;
  border: 1px solid var(--hair); border-radius: 18px; background: color-mix(in srgb, var(--ink) 2.5%, var(--paper)); color: var(--ink); }
.ch .hc-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0; padding: 0; border: 0; }
.ch .hc-kicker { margin: 0; font-family: var(--m); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); font-weight: 500; }
.ch .hc-more { font-size: 13.5px; color: var(--ink2); text-decoration: none; white-space: nowrap; }
.ch .hc-more:hover { color: var(--ink); text-decoration: underline; }
.ch .hc-title { margin: 0; font-size: 21px; line-height: 1.25; font-weight: 700; letter-spacing: -.005em; color: var(--ink); }
.ch .hc-line { margin: 0; font-size: 15px; line-height: 1.5; color: var(--ink2); }
.ch .hc-foot { margin-top: auto; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.ch .hc-go { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 18px; border: 0; border-radius: 999px; background: var(--ink); color: var(--paper);
  font: inherit; font-size: 14.5px; font-weight: 600; text-decoration: none; cursor: pointer; }
.ch .hc-go:hover { opacity: .9; }
.ch .hc-link { font-size: 14.5px; color: var(--ink); font-weight: 600; text-decoration: none; }
.ch .hc-link:hover { text-decoration: underline; }
.ch .hc-bar { display: block; height: 6px; border-radius: 6px; background: color-mix(in srgb, var(--ink) 9%, transparent); overflow: hidden; }
.ch .hc-bar > span { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
.ch .hc-meta { margin: 0; font-family: var(--m); font-size: 12px; color: var(--ink3); font-variant-numeric: tabular-nums; }
</style>
