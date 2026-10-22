<script setup>
/*
 * THE NETWORK'S OWN NAVIGATION — what every social app has down its left side: Home, Explore,
 * Notifications (with the count of what is new), the reader's own profile, the spaces when the site
 * has them, and the big Post button. On a phone the same places become a bar along the bottom and
 * the Post button floats above it. Words from network.md (shell).
 */
import { computed } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { ROUTES } from 'platformkit/lib/router.js'
import { moduleOn } from 'platformkit/lib/modules.js'
import { user, isSignedIn } from 'platformkit/lib/auth.js'
import { net } from 'platformkit/lib/network/api.js'
import { unread } from 'platformkit/lib/network/nav.js'

const props = defineProps({ view: { type: String, default: 'home' } })
const emit = defineEmits(['compose'])
const S = computed(() => us('network').shell.main)
const SPACES = moduleOn('spaces')
const me = computed(() => (user.value ? net.people[user.value.id] || null : null))
const profileHref = computed(() => (me.value && me.value.username && me.value.page ? ROUTES.people + '/' + me.value.username : ROUTES.account))
const count = computed(() => (unread.value > 99 ? '99+' : unread.value))
const items = computed(() => [
  { key: 'home', href: ROUTES.feed, label: S.value.home },
  { key: 'explore', href: ROUTES.feed + '/explore', label: S.value.explore },
  { key: 'notes', href: ROUTES.feed + '/notifications', label: S.value.notifications, badge: isSignedIn.value && unread.value ? count.value : '' },
  ...(SPACES ? [{ key: 'spaces', href: ROUTES.spaces, label: S.value.spaces }] : []),
  ...(isSignedIn.value ? [{ key: 'profile', href: profileHref.value, label: S.value.profile }] : []),
])
</script>

<template>
  <nav class="nr" :aria-label="S.label">
    <a v-for="it in items" :key="it.key" :href="it.href" class="nr-i" :class="{ on: view === it.key }" :aria-current="view === it.key ? 'page' : null">
      <span class="nr-ic" aria-hidden="true">
        <svg v-if="it.key === 'home'" viewBox="0 0 24 24" width="24" height="24" :fill="view === 'home' ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 10.5 12 3.5l8.5 7V20a.5.5 0 0 1-.5.5h-5v-6h-6v6H4a.5.5 0 0 1-.5-.5z" /></svg>
        <svg v-else-if="it.key === 'explore'" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" :stroke-width="view === 'explore' ? 2.6 : 1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
        <svg v-else-if="it.key === 'notes'" viewBox="0 0 24 24" width="24" height="24" :fill="view === 'notes' ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 10a6 6 0 0 1 12 0v4l1.5 3h-15L6 14zM9.5 19.5a2.5 2.5 0 0 0 5 0" /></svg>
        <svg v-else-if="it.key === 'spaces'" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></svg>
        <svg v-else viewBox="0 0 24 24" width="24" height="24" :fill="view === 'profile' ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 20.5a8 8 0 0 1 16 0" stroke-linecap="round" /></svg>
        <em v-if="it.badge" class="nr-badge">{{ it.badge }}</em>
      </span>
      <span class="nr-label">{{ it.label }}</span>
    </a>
    <button v-if="isSignedIn && net.access.write" type="button" class="nr-post" :aria-label="S['new-post']" @click="emit('compose')">
      <svg class="nr-post-ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      <span>{{ S.post }}</span>
    </button>
  </nav>
</template>

<style scoped>
/* the same frame as the community's navigation (SocialNav): one curve, the accent on the place you are */
.nr { --e: cubic-bezier(.2, .8, .2, 1); display: flex; flex-direction: column; gap: 4px; position: sticky; top: 18px }
.nr-i { display: flex; align-items: center; gap: 16px; width: 100%; box-sizing: border-box; padding: 11px 18px 11px 12px; border-radius: 999px;
  font-size: 18px; color: var(--ink); text-decoration: none; transition: background .25s var(--e), color .25s var(--e) }
.nr-i .nr-ic { transition: transform .3s var(--e) }
.nr-i:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.nr-i:hover .nr-ic { transform: scale(1.08) }
.nr-i:active .nr-ic { transform: scale(.94) }
.nr-i.on { font-weight: 700; background: color-mix(in srgb, var(--accent) 9%, transparent) }
.nr-i.on .nr-ic { color: var(--accent) }
.nr-i:focus-visible, .nr-post:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
.nr-ic { position: relative; display: grid; place-items: center; line-height: 0 }
.nr-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.nr-badge { position: absolute; top: -6px; right: -9px; min-width: 18px; padding: 0 5px; border-radius: 999px; border: 2px solid var(--bg, var(--paper));
  background: var(--accent); color: var(--paper); font-style: normal; font-size: 11px; font-weight: 700; line-height: 16px; text-align: center; animation: nr-pop .4s var(--e) }
@keyframes nr-pop { from { transform: scale(.4); opacity: 0 } }
.nr-post { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 16px; width: 100%; max-width: 230px; padding: 14px 20px;
  border: 0; border-radius: 999px; color: var(--paper); font: inherit; font-size: 17px; font-weight: 700; cursor: pointer;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 82%, #fff) 0%, var(--accent) 60%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .28), 0 10px 24px -12px color-mix(in srgb, var(--accent) 85%, transparent), 0 2px 4px -2px color-mix(in srgb, var(--accent) 50%, transparent);
  transition: transform .25s var(--e), filter .25s var(--e) }
.nr-post:hover { transform: translateY(-1px); filter: brightness(1.05) }
.nr-post:active { transform: scale(.97) }
.nr-post-ic { display: none }

/* A NARROW DESK (the page's own breakpoint): the icons alone, the Post button a round one */
@media (max-width: 1320px) {
  .nr { align-items: center }
  .nr-label { display: none }
  .nr-i { width: auto; padding: 12px }
  .nr-post { width: 56px; height: 56px; padding: 0 }
  .nr-post span { display: none }
  .nr-post-ic { display: block }
}
/* A PHONE: the places along the bottom, the Post button floating over the corner */
@media (max-width: 700px) {
  .nr { position: fixed; top: auto; left: 0; right: 0; bottom: 0; z-index: 40; flex-direction: row; justify-content: space-around; gap: 0;
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom)); border-top: 1px solid var(--hair);
    background: color-mix(in srgb, var(--paper) 86%, transparent); backdrop-filter: blur(18px) saturate(1.6); -webkit-backdrop-filter: blur(18px) saturate(1.6) }
  .nr-i { padding: 10px; color: var(--ink3) }
  .nr-i.on { color: var(--accent) }
  .nr-post { position: fixed; right: 18px; bottom: calc(76px + env(safe-area-inset-bottom)); margin: 0; width: 56px; height: 56px }
}
@media (prefers-reduced-motion: reduce) { .nr-i, .nr-i .nr-ic, .nr-post, .nr-badge { transition: none; animation: none } }
</style>
