<script setup>
/* The site's mark — the small emblem beside the name in the header, the admin, the share cards and
   the support chat. The theme's is a plain circle-and-dot; a site draws its own by overriding this
   component by name (platformkit.config.js overrides: { SiteMark: './src/components/SiteMark.vue' }),
   keeping the props: the size in pixels, and the stroke (a colour, or currentColor). */
defineProps({ size: { type: Number, default: 26 }, stroke: { type: String, default: 'var(--accent)' } })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 26 26" aria-hidden="true">
    <circle cx="13" cy="13" r="10" fill="none" :stroke="stroke" stroke-width="1.6" />
    <circle cx="13" cy="13" r="3.2" :fill="stroke" />
  </svg>
</template>
