<script setup lang="ts">
/*
 * HOME'S COACHING CARD (openspec: community-home), in the state the reader is in:
 *   sessions booked     their upcoming sessions (up to three), each with its time, leading to Sessions, and the rest there
 *   coaching, none yet  their plan includes sessions with a coach and nothing is booked: Book a session, to Sessions
 *   no coaching         the site's invitation to its programs and the way to them (coaching-href; Sessions where none)
 * Whether a plan includes sessions is the booking screen's own rule (sessionOptions, SessionBooker's "included in your
 * membership"): a session the reader's tier unlocks and that costs them nothing. Words: ## home in the spaces strings.
 */
import { ref, computed, onMounted } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { user } from 'platformkit/lib/auth.js'
import { supabase } from 'platformkit/lib/supabase.js'
import { ROUTES, navigate } from 'platformkit/lib/router.js'
import { sessionOptions } from 'platformkit/lib/booking.js'

const emit = defineEmits(['state'])
const W = computed(() => us('spaces').home.main)
const upcoming = ref<any[]>([])
const place = ROUTES.feed + '/coaching'
const LIMIT = 3

/* the booking screen's rule: a session the reader's tier gives them, free to them */
const OPEN = ['anyone', 'guest', 'authenticated']
const tiered = (o: any) => o.included || (typeof o.requires === 'string' && !OPEN.includes(o.requires)) || Array.isArray(o.requires)
const coached = computed(() => sessionOptions([], []).some((o: any) => !o.paid && tiered(o)))
const state = computed(() => (upcoming.value.length ? 'booked' : coached.value ? 'coached' : 'offer'))
const offerHref = computed(() => String(W.value['coaching-href'] || '').trim() || place)

const day = (v: string) => new Date(v).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const time = (v: string) => new Date(v).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
function go(href: string, e?: Event) { if (href.startsWith('/')) { if (e) e.preventDefault(); navigate(href) } }

onMounted(async () => {
  try {
    if (supabase && user.value) {
      const { data } = await supabase.from('bookings').select('uid,title,start_at,end_at,status,user_id')
        .eq('user_id', user.value.id).in('status', ['accepted', 'pending']).gt('end_at', new Date().toISOString())
        .order('start_at', { ascending: true }).limit(LIMIT)
      upcoming.value = data || []
    }
  } catch { upcoming.value = [] }
  emit('state', 'ready')
})
</script>

<template>
  <article class="hc hcc">
    <header class="hc-head">
      <p class="hc-kicker">{{ W['coaching-title'] }}</p>
      <a v-if="state === 'booked'" class="hc-more" :href="place" @click="go(place, $event)">{{ W['coaching-all'] }}</a>
    </header>

    <template v-if="state === 'booked'">
      <h3 class="hc-title">{{ upcoming.length === 1 ? W['coaching-next'] : W['coaching-upcoming'] }}</h3>
      <ul class="hcc-list">
        <li v-for="b in upcoming" :key="b.uid">
          <a class="hcc-row" :href="place" @click="go(place, $event)">
            <span class="hcc-date"><b>{{ day(b.start_at) }}</b><em>{{ time(b.start_at) }}</em></span>
            <span class="hcc-what">{{ b.title || W['coaching-session'] }}<small v-if="b.status === 'pending'">{{ W['coaching-pending'] }}</small></span>
          </a>
        </li>
      </ul>
    </template>

    <template v-else-if="state === 'coached'">
      <h3 class="hc-title">{{ W['coaching-none'] }}</h3>
      <p class="hc-line">{{ W['coaching-included'] }}</p>
      <div class="hc-foot"><a class="hc-go" :href="place" @click="go(place, $event)">{{ W['coaching-book'] }}</a></div>
    </template>

    <template v-else>
      <h3 class="hc-title">{{ W['coaching-offer'] }}</h3>
      <p class="hc-line">{{ W['coaching-offer-line'] }}</p>
      <div class="hc-foot"><a class="hc-go" :href="offerHref" @click="go(offerHref, $event)">{{ W['coaching-cta'] }}</a></div>
    </template>
  </article>
</template>

<style scoped>
.hcc-list { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; }
.hcc-list li { margin: 0; padding: 0; border-top: 1px solid var(--hair); }
.hcc-list li:first-child { border-top: 0; }
.hcc-row { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 14px; align-items: baseline; padding: 10px 0; color: var(--ink); text-decoration: none; }
.hcc-row:hover .hcc-what { text-decoration: underline; }
.hcc-date { display: flex; flex-direction: column; gap: 2px; }
.hcc-date b { font-size: 14.5px; font-weight: 600; }
.hcc-date em { font-style: normal; font-size: 13px; color: var(--ink3); font-variant-numeric: tabular-nums; }
.hcc-what { font-size: 15px; line-height: 1.4; min-width: 0; }
.hcc-what small { display: block; margin-top: 2px; font-size: 12.5px; color: var(--ink3); }
</style>
