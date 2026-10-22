<script setup>
import { md } from './md.js'
/* the last word, and the button */
/*
 * Slots for a look's skin (src/lib/look.js): the default slot (the whole close). Each wraps a whole block and
 * hands the skin the same data the default markup uses, so a look can rebuild that
 * block and leave the rest — the page's markdown names the section once either way.
 */
defineProps({
  heading: { type: String, default: '' },
  cta: { type: String, default: 'Get started' },
  href: { type: String, default: '/app' },
})
</script>

<template>
  <div class="lpwrap">
    <slot :heading="heading" :cta="cta" :href="href" :md="md">
    <section class="lpclose lprv" id="lpstart" align="center">
      <h2 class="lpk" v-html="md(heading)"></h2>
      <a :href="href" class="lpbtn lpk lpk-pop" style="--k: .45s"><span v-html="md(cta)"></span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg>
      </a>
    </section>
    </slot>
  </div>
</template>
