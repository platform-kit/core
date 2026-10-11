<script setup>
/* a picture inside a device: a browser window (three dots, the site's host in the bar), a phone, or a
   laptop — the frames drawn from the tokens, the picture cropped to the screen */
import { site as SITE_RAW } from '#content'
defineProps({ kind: { type: String, default: 'browser' }, image: { type: String, default: '' }, alt: { type: String, default: '' }, video: { type: String, default: '' } })
const host = (() => { try { return new URL(((Array.isArray(SITE_RAW) ? SITE_RAW[0] : SITE_RAW) || {}).url).host } catch (e) { return '' } })()
</script>
<template>
  <div class="lpdev" :class="'lpdev-' + kind">
    <template v-if="kind === 'phone'">
      <span class="lpdev-notch"></span>
      <span class="lpdev-screen"><video v-if="video" :src="video" autoplay muted loop playsinline></video><img v-else-if="image" :src="image" :alt="alt" decoding="async" /></span>
    </template>
    <template v-else-if="kind === 'laptop'">
      <span class="lpdev-lid"><span class="lpdev-screen"><video v-if="video" :src="video" autoplay muted loop playsinline></video><img v-else-if="image" :src="image" :alt="alt" decoding="async" /></span></span>
      <span class="lpdev-base"><i></i></span>
    </template>
    <template v-else>
      <span class="lpdev-bar"><span class="lpdots"><i></i><i></i><i></i></span><span v-if="host" class="lpdev-addr">{{ host }}</span></span>
      <span class="lpdev-screen"><video v-if="video" :src="video" autoplay muted loop playsinline></video><img v-else-if="image" :src="image" :alt="alt" decoding="async" /></span>
    </template>
  </div>
</template>
<style scoped>
.lpdev { display: block; position: relative }
.lpdev-screen { display: block; overflow: hidden; background: var(--wash) } .lpdev-screen img, .lpdev-screen video { display: block; width: 100%; height: 100%; object-fit: cover }
/* browser */
.lpdev-browser { border-radius: 14px; overflow: hidden; background: var(--card2, var(--card)); border: 1px solid var(--hair); box-shadow: inset 0 1px 0 var(--edge, #ffffff66), var(--sh) }
.lpdev-bar { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-bottom: 1px solid var(--hair); background: var(--wash) }
.lpdots { display: flex; gap: 5px } .lpdots i { width: 8px; height: 8px; border-radius: 50%; background: var(--hair); display: block }
.lpdev-addr { flex: 1; margin-left: 4px; padding: 4px 10px; border-radius: 6px; background: var(--card); border: 1px solid var(--hair); font-family: var(--m); font-size: 10.5px; color: var(--ink3) }
.lpdev-browser .lpdev-screen img { height: auto }
/* phone */
.lpdev-phone { width: min(100%, 300px); margin: 0 auto; aspect-ratio: 9 / 19; border-radius: 44px; padding: 12px; background: var(--ink); box-shadow: var(--shhi), inset 0 0 0 2px color-mix(in srgb, var(--paper) 18%, transparent) }
.lpdev-phone .lpdev-screen { width: 100%; height: 100%; border-radius: 34px; background: #000 }
.lpdev-notch { position: absolute; left: 50%; top: 22px; width: 36%; height: 26px; border-radius: 999px; background: var(--ink); transform: translateX(-50%); z-index: 2 }
/* laptop */
.lpdev-laptop { width: 100%; padding-bottom: 6% }
.lpdev-lid { display: block; padding: 2.2%; border-radius: 16px 16px 4px 4px; background: var(--ink); box-shadow: var(--shhi) }
.lpdev-lid .lpdev-screen { aspect-ratio: 16 / 10; border-radius: 8px; background: #000 }
.lpdev-base { position: absolute; left: -4%; right: -4%; bottom: 0; height: calc(6% + 2px); border-radius: 0 0 14px 14px; background: color-mix(in srgb, var(--ink) 85%, var(--paper)) }
.lpdev-base i { position: absolute; left: 50%; top: 0; width: 18%; height: 30%; border-radius: 0 0 8px 8px; background: color-mix(in srgb, var(--ink) 70%, var(--paper)); transform: translateX(-50%) }
</style>
