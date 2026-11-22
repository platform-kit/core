<script setup lang="ts">
/*
 * HOME'S COACHING CARD (openspec: community-home): the next session the reader attends, with its time and a way into
 * it; with none booked, a way to book one where a plan of theirs includes sessions; otherwise the site's way to its
 * coaching (## home in the spaces strings: coaching-cta and coaching-href, the Coaching place where no href is set).
 */
import { ref, computed, onMounted } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { user, memberTiers } from 'platformkit/lib/auth.js'
import { supabase } from 'platformkit/lib/supabase.js'
import { ROUTES, navigate } from 'platformkit/lib/router.js'
import { products as PRODUCTS } from '#content'

const emit = defineEmits(['state'])
const W = computed(() => us('spaces').home.main)
const next = ref<any>(null)
const place = ROUTES.feed + '/coaching'

/* a plan of theirs lists a session type: they have sessions to book */
const included = computed(() => (PRODUCTS || []).some((p: any) => p.kind === 'membership' && p.tier && memberTiers.value.includes(p.tier) && (p.sessions || []).length > 0))
const elsewhere = computed(() => String(W.value['coaching-href'] || '').trim() || place)

const when = (v: string) => new Date(v).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
function go(href: string, e?: Event) { if (href.startsWith('/')) { if (e) e.preventDefault(); navigate(href) } }

onMounted(async () => {
  try {
    if (supabase && user.value) {
      const { data } = await supabase.from('bookings').select('uid,title,start_at,end_at,status,user_id')
        .eq('user_id', user.value.id).in('status', ['accepted', 'pending']).gt('end_at', new Date().toISOString())
        .order('start_at', { ascending: true }).limit(1)
      next.value = (data || [])[0] || null
    }
  } catch { next.value = null }
  emit('state', 'ready')
})
</script>

<template>
  <article class="hc">
    <header class="hc-head"><p class="hc-kicker">{{ W['coaching-title'] }}</p></header>
    <template v-if="next">
      <h3 class="hc-title">{{ next.title || W['coaching-next'] }}</h3>
      <p class="hc-line">{{ when(next.start_at) }}</p>
      <div class="hc-foot"><a class="hc-go" :href="place" @click="go(place, $event)">{{ W['coaching-open'] }}</a></div>
    </template>
    <template v-else-if="included">
      <h3 class="hc-title">{{ W['coaching-none'] }}</h3>
      <p class="hc-line">{{ W['coaching-included'] }}</p>
      <div class="hc-foot"><a class="hc-go" :href="place" @click="go(place, $event)">{{ W['coaching-book'] }}</a></div>
    </template>
    <template v-else>
      <h3 class="hc-title">{{ W['coaching-offer'] }}</h3>
      <p class="hc-line">{{ W['coaching-offer-line'] }}</p>
      <div class="hc-foot"><a class="hc-go" :href="elsewhere" @click="go(elsewhere, $event)">{{ W['coaching-cta'] }}</a></div>
    </template>
  </article>
</template>
