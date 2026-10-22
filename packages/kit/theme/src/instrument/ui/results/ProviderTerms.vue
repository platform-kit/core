<script setup>
/*
 * THE ASK: new terms to agree to before anything new goes on sale.
 *
 * It is CLOSABLE, on purpose and against the first instinct. An inescapable full-screen modal over
 * somebody's own earnings, bookings and page — none of which failing to sign touches — would be a
 * lie about what is at stake, and a person cornered into agreeing has not agreed to anything. So it
 * says exactly what not signing costs (one thing), shows the whole wording rather than a link to it,
 * and lets them close it and come back. The gate is in the database, where it cannot be dismissed.
 *
 * It IS teleported to the body, and has to be: the sheet's tab panel carries a transform, which makes
 * it the containing block for position: fixed — a veil inside it covers the panel and not the page.
 * What teleporting costs is the instrument's colours, which live on .qz; so the veil maps the site's
 * own tokens into those names, the way Bookings.vue maps them the other way for the booker on the desk.
 *
 * Words: library.md coaching.terms.
 */
import { ref, computed, watch } from 'vue'
import { us } from '../strings.js'
import { supabase } from 'platformkit/lib/supabase.js'
import { user } from 'platformkit/lib/auth.js'
import { marked } from 'marked'

const props = defineProps({ standing: { type: Object, default: null }, open: { type: Boolean, default: false } })
const emit = defineEmits(['close', 'signed'])
const T = us('library').coaching.terms || {}
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

const saving = ref(false), error = ref('')
const terms = computed(() => (props.standing && props.standing.terms) || null)
/* somebody who has never signed anything is being asked for the first time, not told of a change */
const first = computed(() => !(terms.value && terms.value.signed_before))
/* the wording as html. It is v-html, and that is safe for exactly one reason worth stating: these
   words are the SITE OPERATOR'S, written in content/providers.md and projected by the build — never
   a reader's, never a provider's. Nothing a person types reaches this. */
const body = computed(() => { try { return marked.parse(String((terms.value && terms.value.body) || ''), { gfm: true }) } catch (e) { return '' } })

async function agree() {
  if (!terms.value || !user.value) return
  saving.value = true; error.value = ''
  try {
    const { error: e } = await supabase.from('provider_terms_signed').insert({ user_id: user.value.id, version: terms.value.version })
    if (e && !/duplicate|unique/i.test(e.message)) throw e
    emit('signed')
    emit('close')
  } catch (e) { error.value = e.message || T.error } finally { saving.value = false }
}
watch(() => props.open, (v) => { if (v) error.value = '' })
</script>

<template>
  <Teleport to="body">
    <Transition name="pt-fade">
      <div v-if="open && terms" class="pt-veil" role="dialog" aria-modal="true" @click.self="emit('close')">
        <div class="pt-card">
          <h2 class="pt-h">{{ T.title }}</h2>
          <p class="pt-lead">{{ first ? T['lead-first'] : T.lead }}</p>
          <p class="pt-ver">
            {{ fill(T.version, { v: terms.version }) }}
            <span v-if="terms.signed_before"> · {{ fill(T.was, { v: terms.signed_before }) }}</span>
          </p>
          <div class="pt-body" v-html="body"></div>
          <div class="pt-acts">
            <button type="button" class="pt-primary" :disabled="saving" @click="agree">{{ saving ? T.agreeing : T.agree }}</button>
            <button type="button" class="pt-later" @click="emit('close')">{{ T.later }}</button>
          </div>
          <em v-if="error" class="pt-err">{{ error }}</em>
        </div>
      </div>
      </Transition>
  </Teleport>
</template>

<style scoped>
/* the instrument's names, given the site's values: teleported out of .qz, none of them resolve */
.pt-veil { position: fixed; inset: 0; --qink: var(--ink); --qink2: var(--ink2); --qink3: var(--ink3); --qhair: var(--hair); --qcard: var(--card); z-index: 90; display: flex; align-items: center; justify-content: center; padding: 24px 16px;
  /* a scrim is a shadow, not a colour of the theme: mixed from the ink it went PALE in dark mode,
     where the ink is nearly white, and lit the page up instead of dimming it */
  background: rgb(0 0 0 / .5); backdrop-filter: blur(3px) }
.pt-card { width: min(640px, 100%); max-height: min(86vh, 900px); display: flex; flex-direction: column;
  /* OPAQUE, unlike a card on the page: the site's card colour is translucent by design, and a dialog
     you can read the page through is a dialog nobody reads */
  background: var(--paper, #fff); color: var(--qink); border: 1px solid var(--qhair); border-radius: 18px; padding: 26px 26px 22px;
  box-shadow: 0 30px 80px -40px #000000aa }
.pt-h { font-family: var(--fd); font-weight: 600; font-size: 24px; letter-spacing: -.015em; margin: 0 0 10px }
.pt-lead { font-size: 14.5px; line-height: 1.55; color: var(--qink2); margin: 0 0 10px }
.pt-ver { font-family: var(--m); font-size: 11.5px; color: var(--qink3); margin: 0 0 14px }
/* the wording itself, scrolling inside the card: it is what is being agreed to, so it is here and
   not behind a link */
.pt-body { flex: 1; overflow: auto; font-size: 14.5px; line-height: 1.6; color: var(--qink2);
  padding: 16px 18px; border: 1px solid var(--qhair); border-radius: 12px; background: color-mix(in srgb, var(--qink) 3%, transparent) }
.pt-body :deep(h1), .pt-body :deep(h2), .pt-body :deep(h3) { font-family: var(--fd); font-size: 16px; font-weight: 600; color: var(--qink); margin: 18px 0 6px }
.pt-body :deep(h1:first-child), .pt-body :deep(h2:first-child) { margin-top: 0 }
.pt-body :deep(p) { margin: 0 0 12px }
.pt-body :deep(ul), .pt-body :deep(ol) { margin: 0 0 12px; padding-left: 20px }
.pt-body :deep(li) { margin: 0 0 5px }
.pt-acts { display: flex; align-items: center; gap: 12px; margin-top: 18px }
.pt-primary { font: inherit; font-size: 14px; padding: 11px 22px; border: 0; border-radius: 999px; background: var(--qink); color: var(--qcard); cursor: pointer }
.pt-primary[disabled] { opacity: .5; cursor: default }
.pt-later { font: inherit; font-size: 13.5px; padding: 11px 6px; background: none; border: 0; color: var(--qink3); text-decoration: underline; cursor: pointer }
.pt-err { display: block; font-style: normal; font-size: 12.5px; color: var(--c3, #fc5151); margin-top: 10px }
.pt-fade-enter-active, .pt-fade-leave-active { transition: opacity .25s }
.pt-fade-enter-active .pt-card, .pt-fade-leave-active .pt-card { transition: transform .28s cubic-bezier(.2,.8,.2,1) }
.pt-fade-enter-from, .pt-fade-leave-to { opacity: 0 }
.pt-fade-enter-from .pt-card, .pt-fade-leave-to .pt-card { transform: translateY(12px) scale(.98) }
@media (prefers-reduced-motion: reduce) { .pt-fade-enter-active, .pt-fade-leave-active, .pt-fade-enter-active .pt-card, .pt-fade-leave-active .pt-card { transition: none } }
</style>
