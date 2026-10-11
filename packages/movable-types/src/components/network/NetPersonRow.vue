<script setup>
/*
 * ONE PERSON IN A LIST — Who to follow, a search's answers: their face, name and handle (each a way
 * to their page when it is open), a line about them where there is room, and Follow beside them.
 * Following is the reader's own act, written as them; the database refuses one it should not take.
 * Words from network.md (shell).
 */
import { computed, ref } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { ROUTES } from '@platform-kit/kit/lib/router.js'
import { isSignedIn } from '@platform-kit/kit/lib/auth.js'
import { net, follow } from '@platform-kit/kit/lib/network/api.js'
import site from '#site'
import { showsFollowing } from '@platform-kit/kit/lib/community/places.js'
const FOLLOWING = showsFollowing((site.community || {}).hide)
import SpaceAvatar from '../spaces/SpaceAvatar.vue'

const props = defineProps({
  id: { type: String, required: true },
  about: { type: Boolean, default: false },
})
const emit = defineEmits(['followed'])
const S = computed(() => us('network').shell.main)
const person = computed(() => net.people[props.id] || null)
const name = computed(() => (person.value && (person.value.name || person.value.username)) || '')
const href = computed(() => (person.value && person.value.page && person.value.username ? ROUTES.people + '/' + person.value.username : ''))
const on = ref(false)
const busy = ref(false)
async function toggle() {
  if (!isSignedIn.value) { if (window.DLauth) window.DLauth.open(); return }
  busy.value = true
  try { await follow(props.id, !on.value); on.value = !on.value; emit('followed', on.value) } catch { /* the database said no */ } finally { busy.value = false }
}
</script>

<template>
  <div v-if="person" class="npr">
    <component :is="href ? 'a' : 'span'" :href="href || undefined" class="npr-face"><SpaceAvatar :person="person" :name="name" :size="40" /></component>
    <component :is="href ? 'a' : 'span'" :href="href || undefined" class="npr-who">
      <b>{{ name }}</b>
      <span v-if="person.username">@{{ person.username }}</span>
      <em v-if="about && person.about">{{ person.about }}</em>
    </component>
    <button v-if="FOLLOWING && net.access.write" type="button" class="npr-go" :class="{ on }" :disabled="busy" :aria-pressed="on" @click="toggle">{{ on ? S.following : S.follow }}</button>
  </div>
</template>

<style scoped>
.npr { display: flex; align-items: center; gap: 10px; padding: 10px 16px }
.npr-face { flex: none; line-height: 0; text-decoration: none }
.npr-who { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; text-decoration: none; color: inherit }
.npr-who b { font-size: 15px; font-weight: 700; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
a.npr-who:hover b { text-decoration: underline }
.npr-who span { font-size: 13.5px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.npr-who em { font-style: normal; margin-top: 2px; font-size: 13.5px; line-height: 1.4; color: var(--ink2);
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical }
.npr-go { flex: none; font: inherit; font-size: 13.5px; font-weight: 700; padding: 7px 16px; border: 0; border-radius: 999px;
  background: var(--ink); color: var(--paper); cursor: pointer; transition: background .2s cubic-bezier(.2, .8, .2, 1), color .2s cubic-bezier(.2, .8, .2, 1) }
.npr-go.on { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 1px var(--hair) }
.npr-go:disabled { opacity: .6; cursor: default }
@media (prefers-reduced-motion: reduce) { .npr-go { transition: none } }
</style>
