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
import site, { homeCards as SITE_CARDS } from '#site'
import { isSignedIn } from 'platformkit/lib/auth.js'
import { products } from 'platformkit/lib/storefront.js'
import { subscribe, checkout, money } from 'platformkit/lib/commerce.js'
import HomeCoaching from './HomeCoaching.vue'
import HomeReading from './HomeReading.vue'

const props = defineProps({
  /* the Coaching place is in the community (coachingPlace: sessions on, coaching.where spaces) */
  coaching: { type: Boolean, default: false },
  /* the reader's name as the community shows it */
  name: { type: String, default: '' },
  /* SOMEBODY WHO MAY NOT ENTER (SpacesPage gateHome): the same Home, every card as it is before anything is begun, the
     community's tagline at its head with the way in — the price, Join, and Sign in for a member — and the posts kept for
     members. The cards ask nothing of an account they cannot see. */
  gate: { type: Boolean, default: false },
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
  ...((SITE_CARDS || []) as any[]).map((x) => ({ key: x.key, order: x.order, full: !!x.full, component: markRaw(defineAsyncComponent(x.load)) })),
].sort((a, b) => a.order - b.order))
const small = computed(() => cards.value.filter((c) => !c.full))
const full = computed(() => cards.value.filter((c) => c.full))
const state = ref<Record<string, string>>({})
/* THE SHORT CARDS SHARE A ROW: three across, or two, or one; four make two rows of two */
const across = computed(() => { const n = small.value.filter((c) => state.value[c.key] === 'ready').length; return n === 4 ? 2 : Math.max(1, Math.min(3, n)) })
/* where only two fit across (a narrower screen), an odd card out takes the whole row rather than leaving a hole beside it */
const lastOdd = computed(() => { const r = small.value.filter((c) => state.value[c.key] === 'ready'); return r.length % 2 === 1 ? r[r.length - 1].key : '' })

/* THE WAY IN, at the gate: the offer the site sells the community by (network.access.join), its price, Join — buying it
   as the join card does — and Sign in for somebody who already is a member. Words: ## access in the network strings. */
const A = computed(() => us('network').access.main)
const joinSku = (site.network && site.network.access && site.network.access.join) || ''
const offer = computed(() => (joinSku ? products.value.find((p: { sku: string }) => p.sku === joinSku) || null : null))
const price = computed(() => {
  const o = offer.value
  if (!o || o.unit_amount == null) return ''
  const p = money(o.unit_amount, o.currency).replace(/[.,]00(?=\D*$)/, '')
  const key = o.interval === 'week' ? 'price-week' : o.interval === 'month' ? 'price-month' : 'price-once'
  return String(A.value[key] || '').replace('{price}', p)
})
const busy = ref(false)
async function join() {
  if (!isSignedIn.value) { if ((window as any).DLauth) (window as any).DLauth.open({ intent: 'buy' }); return }
  if (!offer.value) return
  busy.value = true
  try { if (offer.value.recurring) await subscribe(offer.value.sku); else await checkout([{ sku: offer.value.sku, quantity: 1 }]) } finally { busy.value = false }
}
function signIn() { if ((window as any).DLauth) (window as any).DLauth.open() }

/* THE FEED BENEATH, once there is anything in it: one row asked for, never an empty state */
const posts = ref(false)
onMounted(async () => {
  if (props.gate || !supabase || !user.value) return
  try {
    const { data } = await supabase.rpc('network_timeline', { p_before: null, p_limit: 1, p_all_spaces: true })
    posts.value = Array.isArray(data) && data.length > 0
  } catch { posts.value = false }
})
</script>

<template>
  <div class="cmh">
    <header class="cmh-band">
      <img v-if="C.cover" class="cmh-cover" :src="C.cover" alt="" aria-hidden="true" />
      <div class="cmh-band-in">
        <template v-if="gate">
          <h1 class="cmh-hello">{{ C.tagline || C.name }}</h1>
          <div class="cmh-door">
            <button v-if="offer || !isSignedIn" type="button" class="cmh-join" :disabled="busy" @click="join">{{ A.join }}<span v-if="price"> · {{ price }}</span></button>
            <span v-if="!isSignedIn" class="cmh-member">{{ W['gate-member'] }} <button type="button" class="cmh-signin" @click="signIn">{{ W['gate-signin'] }}</button></span>
          </div>
        </template>
        <template v-else>
          <h1 class="cmh-hello">{{ greeting }}</h1>
          <p v-if="C.tagline" class="cmh-tagline">{{ C.tagline }}</p>
        </template>
      </div>
    </header>

    <div class="cmh-grid" :style="{ '--across': across }">
      <div v-for="c in small" v-show="state[c.key] === 'ready'" :key="c.key" class="cmh-cell" :class="{ 'cmh-odd': c.key === lastOdd }">
        <component :is="c.component" @state="(s: string) => (state[c.key] = s)" />
      </div>
    </div>
    <div v-for="c in full" v-show="state[c.key] === 'ready'" :key="c.key" class="cmh-cell cmh-full">
      <component :is="c.component" @state="(s: string) => (state[c.key] = s)" />
    </div>

    <!-- at the gate, the posts are the members': the card says so, and draws none -->
    <section v-if="gate" class="hc cmh-posts">
      <header class="hc-head"><p class="hc-kicker">{{ W['posts-kicker'] }}</p></header>
      <h2 class="hc-title">{{ W.posts }}</h2>
      <p class="hc-line">{{ W['posts-gate'] }}<template v-if="!isSignedIn && W['posts-gate-signin']">{{ ' ' }}<button type="button" class="cmh-signin" @click="signIn">{{ W['posts-gate-signin'] }}</button></template></p>
    </section>
    <!-- THE POSTS, a card like the others: its label and heading, the field to write in, then the posts as its rows -->
    <section v-if="posts" class="hc cmh-posts">
      <header class="hc-head"><p class="hc-kicker">{{ W['posts-kicker'] }}</p></header>
      <h2 class="hc-title">{{ W.posts }}</h2>
      <div class="cmh-feed"><slot /></div>
    </section>
  </div>
</template>

<style scoped>
/* QUIET BY DESIGN: one greeting, outlined cards on the page's own ground, one weight of label. The cards hold the
   member's things; nothing around them competes. Every rule says what it wants, since the site styles bare elements
   (an h1 is capped at 16ch there, which broke the greeting over two lines). */
.cmh { max-width: var(--pl-max, 1040px); margin: 0 auto; padding: var(--pl-top, 44px) var(--pl-x, 32px) var(--pl-bottom, 72px); box-sizing: border-box; }
.cmh-band { position: relative; overflow: hidden; margin: 0 0 30px; padding: 0; border: 0; background: none; }
.cmh-cover { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .18; pointer-events: none; }
.cmh-band-in { position: relative; }
.cmh-hello { max-width: none; text-wrap: pretty; margin: 0; font-family: var(--fd, inherit); font-size: var(--pl-title, 34px); line-height: 1.15; letter-spacing: -.02em; font-weight: 600; color: var(--ink); }
.cmh-door { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-top: 18px; }
.cmh-join { font: inherit; font-size: 15px; font-weight: 700; padding: 11px 26px; border: 0; border-radius: 999px; background: var(--ink); color: var(--paper); cursor: pointer; }
.cmh-join span { font-weight: 500; opacity: .85; }
.cmh-join:hover { opacity: .9; }
.cmh-join:disabled { opacity: .6; cursor: default; }
.cmh-member { font-size: 14.5px; color: var(--ink3); }
.cmh-signin { font: inherit; font-size: 14.5px; font-weight: 600; padding: 0; border: 0; background: none; color: var(--ink); text-decoration: underline; cursor: pointer; }
.cmh-tagline { max-width: none; margin: 8px 0 0; font-size: 16.5px; line-height: 1.5; color: var(--ink3); }
.cmh-grid { display: grid; grid-template-columns: repeat(var(--across, 2), minmax(0, 1fr)); gap: var(--pl-gap, 16px); }
.cmh-cell { min-width: 0; display: flex; }
.cmh-cell > :deep(*) { flex: 1; }
.cmh-full { margin-top: var(--pl-gap, 16px); }
/* named under .cmh: the cards' shared rule (.cmh .hc, below) sets margin: 0 and would otherwise win */
.cmh > .cmh-posts { margin-top: var(--pl-gap, 16px); }
/* the feed inside the card: no ground or frame of its own, the field to write in on the paper so it reads as a field, and the
   posts as the card's rows — their edges on the card's, a hairline between them, the last without one */
.cmh-feed { margin: 4px -22px -22px; }
.cmh-feed :deep(.sp-net-in), .cmh-feed :deep(.fd-main) { background: transparent; border: 0; min-height: 0; }
.cmh-feed :deep(.nc) { padding: 4px 22px 16px; border-bottom: 1px solid var(--hair); }
.cmh-feed :deep(.np) { padding-left: calc(22px + (var(--np-depth, 0) * 28px)); padding-right: 22px; }
.cmh-feed :deep(.np-row) { padding-left: 0; padding-right: 0; }
.cmh-feed :deep(.fd-list > :last-child), .cmh-feed :deep(.np:last-child) { border-bottom: 0; border-radius: 0 0 var(--pl-r, 16px) var(--pl-r, 16px); }
@media (max-width: 1100px) { .cmh-grid { grid-template-columns: repeat(min(var(--across, 2), 2), minmax(0, 1fr)); } .cmh-odd { grid-column: 1 / -1; } }
@media (max-width: 760px) {
  .cmh-band { margin-bottom: 22px; }
  .cmh-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>

<!-- THE PARTS EVERY CARD SHARES, unscoped so a module's card and a site's look like the kit's: written under .cmh so they
     reach nothing outside Home -->
<style>
.cmh .hc { position: relative; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; min-height: 100%; margin: 0; padding: 20px 22px 22px;
  border: 1px solid var(--hair); border-radius: var(--pl-r, 16px); background: var(--pl-card, var(--paper)); box-shadow: var(--pl-shadow, none); color: var(--ink); }
.cmh .hc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 4px; padding: 0; border: 0; background: none; }
.cmh .hc-kicker { max-width: none; margin: 0; font-family: inherit; font-size: 13.5px; letter-spacing: 0; text-transform: none; color: var(--ink3); font-weight: 500; }
.cmh .hc-more { font-size: 13.5px; color: var(--ink3); text-decoration: none; white-space: nowrap; }
.cmh .hc-more:hover { color: var(--ink); text-decoration: underline; }
.cmh .hc-title { max-width: none; text-wrap: pretty; margin: 0; font-size: 19px; line-height: 1.3; font-weight: 700; letter-spacing: -.005em; color: var(--ink); }
.cmh .hc-line { max-width: none; margin: 0; font-size: 15px; line-height: 1.55; color: var(--ink2); }
.cmh .hc-foot { margin-top: auto; padding-top: 8px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.cmh .hc-go { display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 16px; border: 1px solid color-mix(in srgb, var(--ink) 18%, transparent); border-radius: 999px;
  background: transparent; color: var(--ink); font: inherit; font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer; transition: background .15s, border-color .15s; }
.cmh .hc-go:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); border-color: color-mix(in srgb, var(--ink) 30%, transparent); }
.cmh .hc-link { font-size: 14.5px; color: var(--ink); font-weight: 600; text-decoration: none; }
.cmh .hc-link:hover { text-decoration: underline; }
.cmh .hc-bar { display: block; height: 4px; border-radius: 4px; background: color-mix(in srgb, var(--ink) 9%, transparent); overflow: hidden; }
.cmh .hc-bar > span { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
.cmh .hc-meta { max-width: none; margin: 0; font-family: inherit; font-size: 13px; color: var(--ink3); font-variant-numeric: tabular-nums; }
</style>
