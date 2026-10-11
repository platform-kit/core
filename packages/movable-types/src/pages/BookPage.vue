<script setup>
/* A booking type on its own page: /book/<slug>, no site chrome — the booker as the Coaching tab shows it, on the site's
   ground; the site's sign-in where the reader has none (every booking is an account's). Under cal.com's embed
   (?embed=<namespace>…) the page speaks the embed's messages (lib/cal-embed.js), so `Cal("init", { origin })` and
   `Cal("inline", { calLink: "book/<slug>" })` show it on an outside page (scheduling-api). Words: library.md
   `coaching.book-page`. */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { sessions as SESSIONS } from '#content'
import { ROUTES } from '../router.js'
import { setHead } from '@platform-kit/kit/lib/seo.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import { supabase, configured } from '@platform-kit/kit/lib/supabase.js'
import { isSignedIn, authSettled, user, onIdentity } from '@platform-kit/kit/lib/auth.js'
import { sessionOptions } from '@platform-kit/kit/lib/booking.js'
import { calEmbedContext, calEmbedMessenger } from '@platform-kit/kit/lib/cal-embed.js'
import { eventTypeId } from '@platform-kit/kit/supabase/functions/_shared/api/cal/event-type.js'
import SessionBooker from '../instrument/ui/results/SessionBooker.vue'
import SiteMark from '../components/SiteMark.vue'

const props = defineProps({ path: { type: String, required: true } })
const slug = computed(() => props.path.slice(ROUTES.book.length + 1).split('/')[0])
const type = computed(() => (SESSIONS || []).find((s) => s.slug === slug.value && s.published !== false) || null)
const W = (us('library').coaching || {})['book-page'] || {}
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
setHead({ title: type.value ? fill(W.title, { session: type.value.title }) : (W.none || ''), description: type.value ? (type.value.line || '') : '', path: props.path, noindex: true })

/* the reader's bookings, for the allowance the options count */
const rows = ref([])
async function load() { if (!isSignedIn.value || !configured) { rows.value = []; return } const { data } = await supabase.from('bookings').select('uid,event,start_at,status,user_id,made_by').eq('user_id', user.value ? user.value.id : ''); rows.value = data || [] }
onIdentity(load)
const options = computed(() => sessionOptions(rows.value).filter((o) => o.slug === slug.value))
const notMine = computed(() => isSignedIn.value && type.value && !options.value.length)
function openSignIn() { if (window.DLauth) window.DLauth.open({ intent: 'book' }) }

/* inside cal.com's embed: its messages */
const ctx = calEmbedContext()
const cal = calEmbedMessenger(ctx)
let ro = null
onMounted(() => {
  if (ctx && ctx.theme && ['light', 'dark'].includes(ctx.theme)) document.documentElement.setAttribute('data-theme', ctx.theme)
  if (!cal) return
  cal.ready()
  const root = document.querySelector('.bookpage')
  const report = () => cal.size(Math.max(document.documentElement.scrollHeight, root ? root.scrollHeight : 0), document.documentElement.scrollWidth)
  if (root && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(report); ro.observe(root); ro.observe(document.documentElement) }
  report()
})
watch(options, (o) => { if (cal && o.length) setTimeout(() => cal.linkReady(), 0) }, { immediate: true })
onBeforeUnmount(() => { if (ro) ro.disconnect() })
function onBooked(b) { if (cal && b) cal.booked({ ...b, eventTypeId: type.value ? eventTypeId(type.value.slug) : null }) }
function onMoved(b) { if (cal && b) cal.moved({ ...b, eventTypeId: type.value ? eventTypeId(type.value.slug) : null }) }
</script>

<template>
  <div class="bookpage lproot" :class="{ 'bookpage-embed': !!ctx }">
    <header v-if="!ctx" class="bookpage-bar"><a :href="ROUTES.home" class="bookpage-home"><SiteMark class="bookpage-mark" /></a><span class="bookpage-title">{{ type ? fill(W.title, { session: type.title }) : W.none }}</span></header>
    <main class="bookpage-main">
      <p v-if="!type" class="bookpage-note">{{ W.none }}</p>
      <template v-else-if="authSettled && !isSignedIn">
        <div class="bookpage-gate"><h2 class="bookpage-h">{{ fill(W.title, { session: type.title }) }}</h2><p v-if="type.line" class="bookpage-lead">{{ type.line }}</p><p class="bookpage-note">{{ W.signin }}</p><button type="button" class="btn solid" @click="openSignIn">{{ W['signin-button'] }}</button></div>
      </template>
      <p v-else-if="notMine" class="bookpage-note">{{ W['not-included'] }}</p>
      <SessionBooker v-else-if="options.length" :key="slug + ':' + (user ? user.id : '')" :options="options" @booked="onBooked" @moved="onMoved" />
      <p v-else class="bookpage-note">{{ W.loading }}</p>
    </main>
  </div>
</template>

<style scoped>
.bookpage { min-height: 100vh; background: var(--paper); color: var(--ink) }
.bookpage-embed { min-height: 0 }
.bookpage-bar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--hair); font-size: 14px }
.bookpage-home { display: inline-flex; color: var(--ink); text-decoration: none } .bookpage-mark { width: 22px; height: 22px } .bookpage-title { color: var(--ink3) }
.bookpage-main { max-width: 980px; margin: 0 auto; padding: 24px 16px 48px }
.bookpage-gate { max-width: 520px; margin: 48px auto; text-align: center; display: grid; gap: 12px; justify-items: center }
.bookpage-h { font-size: clamp(26px, 4vw, 34px); margin: 0 } .bookpage-lead { color: var(--ink2); margin: 0 }
.bookpage-note { color: var(--ink3); text-align: center; padding: 32px 0; margin: 0 }
</style>
