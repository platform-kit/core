<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { supabase } from 'platformkit/lib/supabase.js'
import { isSignedIn, user } from 'platformkit/lib/auth.js'
import { us } from 'platformkit/lib/content.js'
import { alertFor, mayShowUsageAlert } from 'platformkit/lib/usage-alert.js'
import { route, ROUTES } from '../router.js'
import { products } from '#content'
import { hasPublishedMeteredUsagePlan } from '../lib/usage-eligibility.js'
import LandingAnnouncement from './landing/LandingAnnouncement.vue'
/*
 * A usage payment that needs the customer, said on every page until it is settled: the page builder's
 * Announcement strip in its red alert tone, linking to Billing → Usage, where the recovery controls are.
 *
 * Its × lasts one page view — the strip is keyed by the route, so the next page brings it back — and
 * it stays off the pages lib/usage-alert.js names. It asks the usage function once when the app opens
 * and again when somebody signs in; the Usage view tells it when the answer changes. A site with no
 * published metered plan never asks.
 */
const W = computed(() => ((us('usage').page || {}).alert || {}))
const relevant = hasPublishedMeteredUsagePlan(products)
const attention = ref(null)

async function ask() {
  if (!relevant || !isSignedIn.value) { attention.value = null; return }
  try {
    const { data, error } = await supabase.functions.invoke('usage-topup', { body: { action: 'attention' } })
    attention.value = error ? null : alertFor(data?.attention)
  } catch (e) {
    attention.value = null   /* the banner is a convenience: a failed question shows nothing */
  }
}
const follow = (event) => { attention.value = alertFor(event.detail) }

onMounted(() => { void ask(); window.addEventListener('pk:usage-attention', follow) })
onBeforeUnmount(() => window.removeEventListener('pk:usage-attention', follow))
watch(() => user.value && user.value.id, () => { void ask() })

const shown = computed(() => !!attention.value && isSignedIn.value && mayShowUsageAlert(route.value))
</script>
<template>
  <LandingAnnouncement
    v-if="shown"
    :key="route"
    tone="alert"
    :remember="false"
    :badge="W.badge"
    :text="W[attention]"
    :cta="W.link"
    :href="ROUTES.billing + '#usage'"
  />
</template>
