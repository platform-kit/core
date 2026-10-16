<script setup>
import { computed, useSlots } from 'vue'
import AuthModal from '../components/AuthModal.vue'
import SiteMark from '../components/SiteMark.vue'
import { ROUTES } from '../router.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { site as SITE_RAW } from '#content'

const props = defineProps({
  pending: { type: Boolean, default: false },
  copy: {
    type: Object,
    default: null,
    validator: (value) => value === null || ['eyebrow', 'title', 'description'].every((key) => typeof value[key] === 'string'),
  },
})

const slots = useSlots()
const hasAside = computed(() => Boolean(props.copy || slots.art))
const W = us('auth').page.main
const SITE = Array.isArray(SITE_RAW) ? SITE_RAW[0] : SITE_RAW
const SITE_NAME = SITE?.name || 'Site'
</script>

<template>
  <main class="signin-page" :class="{ 'has-aside': hasAside }">
    <section class="signin-main">
      <a class="signin-brand" :href="ROUTES.home" :aria-label="W['home-aria'].replace('{site}', SITE_NAME)">
        <SiteMark :size="30" />
        <span>{{ SITE_NAME }}</span>
      </a>

      <section class="signin-form-area" :aria-label="W['form-label']">
        <div v-if="props.pending" class="signin-pending" role="status">
          <span class="signin-spinner" aria-hidden="true"></span>
          <span>{{ W.pending }}</span>
        </div>
        <AuthModal v-else inline />
      </section>

      <footer class="signin-footer">
        <a :href="ROUTES.home">{{ W['back-home'] }}</a>
      </footer>
    </section>

    <aside v-if="hasAside" class="signin-aside">
      <div class="signin-aside-inner">
        <div v-if="$slots.art" class="signin-art">
          <slot name="art" />
        </div>
        <div v-if="props.copy" class="signin-aside-copy">
          <p v-if="props.copy.eyebrow" class="signin-aside-eyebrow">{{ props.copy.eyebrow }}</p>
          <h1>{{ props.copy.title }}</h1>
          <p v-if="props.copy.description">{{ props.copy.description }}</p>
        </div>
      </div>
    </aside>
  </main>
</template>

<style scoped>
.signin-page { min-height: 100vh; min-height: 100dvh; display: grid; grid-template-columns: minmax(0, 1fr); background: var(--paper); color: var(--ink) }
.signin-page.has-aside { grid-template-columns: minmax(440px, 1.02fr) minmax(420px, .98fr) }
.signin-main { min-height: 100vh; min-height: 100dvh; box-sizing: border-box; display: flex; flex-direction: column; padding: 34px clamp(30px, 5.5vw, 82px) 24px }
.signin-brand { display: inline-flex; align-items: center; align-self: flex-start; gap: 11px; color: var(--ink); text-decoration: none; font-family: var(--fd); font-size: 16px; font-weight: 600; letter-spacing: -.01em }
.signin-brand svg { flex: 0 0 auto }
.signin-form-area { width: min(100%, 440px); margin: auto; padding: 54px 0 }
.signin-form-area :deep(.au-veil.au-veil-inline) { width: 100% }
.signin-form-area :deep(.au-card.au-card-inline) { width: 100%; box-sizing: border-box }
.signin-form-area :deep(.au-h) { font-size: clamp(30px, 3vw, 36px); letter-spacing: -.035em; margin-bottom: 10px }
.signin-form-area :deep(.au-subtitle) { max-width: none; margin-bottom: 30px; font-size: 15px }
.signin-form-area :deep(.au-form) { gap: 18px }
.signin-form-area :deep(.au-f span) { font-size: 11px; margin-bottom: 8px }
.signin-form-area :deep(.au-f input) { min-height: 50px; border-radius: 10px; padding: 12px 14px }
.signin-form-area :deep(.au-submit) { width: 100%; min-height: 52px; margin-top: 4px; border-radius: 10px; font-size: 15px }
.signin-form-area :deep(.au-note) { text-align: left; margin-top: 18px; font-size: 13px; line-height: 1.55 }
.signin-form-area :deep(.au-forgot) { font-size: 12px }
.signin-form-area :deep(.au-google) { min-height: 48px }
.signin-form-area :deep(.au-tabs) { margin-bottom: 20px }
.signin-pending { min-height: 250px; display: flex; align-items: center; justify-content: center; gap: 12px; color: var(--ink2); font-size: 14px }
.signin-spinner { width: 18px; height: 18px; border: 2px solid var(--hair); border-top-color: var(--accent2); border-radius: 50%; animation: signin-spin .8s linear infinite }
.signin-footer { display: flex; justify-content: space-between; align-items: center; color: var(--ink3); font-size: 12.5px }
.signin-footer a { color: inherit; text-decoration: none }
.signin-footer a:hover { color: var(--ink); text-decoration: underline; text-underline-offset: 3px }
.signin-aside { min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: clamp(36px, 6vw, 88px); box-sizing: border-box; color: var(--paper); background: radial-gradient(ellipse at 74% 24%, color-mix(in srgb, var(--accent2) 28%, transparent), transparent 42%), linear-gradient(145deg, var(--ink), color-mix(in srgb, var(--ink) 86%, var(--accent2))) }
.signin-aside-inner { position: relative; z-index: 1; width: min(100%, 620px); margin: 0 auto }
.signin-art { width: 100%; margin: 0 auto clamp(30px, 5vw, 56px); display: flex; justify-content: center }
.signin-art :deep(img),.signin-art :deep(svg) { display: block; max-width: 100%; height: auto }
.signin-aside-copy { max-width: 480px }
.signin-aside-eyebrow { margin: 0 0 15px; color: color-mix(in srgb, var(--paper) 68%, transparent); font: 600 10px/1.3 var(--m); letter-spacing: .16em; text-transform: uppercase }
.signin-aside-copy h1 { margin: 0; font-family: var(--fd); font-size: clamp(32px, 4vw, 50px); font-weight: 500; line-height: 1.05; letter-spacing: -.035em; text-wrap: balance }
.signin-aside-copy > p:last-child { max-width: 36ch; margin: 17px 0 0; color: color-mix(in srgb, var(--paper) 74%, transparent); font-size: 15px; line-height: 1.65 }
@keyframes signin-spin { to { transform: rotate(360deg) } }
@media (max-width: 900px) {
  .signin-page.has-aside { grid-template-columns: minmax(0, 1fr) minmax(330px, .85fr) }
  .signin-main { padding-inline: clamp(24px, 4vw, 42px) }
  .signin-aside { padding-inline: clamp(26px, 4vw, 46px) }
}
@media (max-width: 720px) {
  .signin-page { display: flex; flex-direction: column }
  .signin-main { min-height: 100svh; padding: 24px clamp(22px, 6vw, 38px) 20px }
  .signin-form-area { padding: 50px 0; }
  .signin-aside { min-height: 0; padding: 32px clamp(24px, 7vw, 42px) 38px }
  .signin-aside-copy h1 { font-size: 34px }
  .signin-aside-copy > p:last-child { font-size: 14px }
  .signin-art { margin-bottom: 25px }
}
@media (prefers-reduced-motion: reduce) {
  .signin-spinner { animation: none }
}
</style>
