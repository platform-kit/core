<!--
  WHERE TO FIND OUR BOOKS — a page of the press's own, not one the theme ships.

  Registered in platformkit.config.js as { path: '/stockists', component: …, module: 'stockists' },
  and the `module` is what ties it to the switch: with the module off the plugin drops the route
  before the bundle is written, so the component is never shipped and the router never learns of
  the path.

  Its copy is in content/app/ui/stockists.md, like every other reader-facing string here.
-->
<template>
  <SiteLayout>
    <div class="pageshell stk">
      <header class="stk-head">
        <h1>{{ W.head.title }}</h1>
        <p class="stk-sub">{{ W.head.sub }}</p>
      </header>

      <ul v-if="shops.length" class="stk-list">
        <li v-for="s in shops" :key="s.slug" class="stk-shop">
          <a class="stk-name" :href="s.url" rel="noopener">{{ s.name }}</a>
          <p class="stk-where">{{ s.where }}</p>
          <p v-if="s.note" class="stk-note">{{ s.note }}</p>
        </li>
      </ul>
      <div v-else class="stk-empty">
        <h2>{{ W.empty.title }}</h2>
        <p>{{ W.empty.body }}</p>
      </div>

      <footer class="stk-order">
        <p class="stk-line">{{ W.order.line }}</p>
        <p v-if="distributor" class="stk-dist">
          <span class="stk-label">{{ W.order.label }}</span>
          <strong>{{ distributor }}</strong>
        </p>
        <p v-else class="stk-dist"><em>{{ W.order.none }}</em></p>
      </footer>
    </div>
  </SiteLayout>
</template>

<script setup>
import { computed } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import SiteLayout from '@platform-kit/movable-types/layouts/SiteLayout.vue'
import stockists from '../../.velite/stockists.json'

const W = computed(() => us('stockists').page)
const shops = computed(() => stockists.shops || [])
const distributor = computed(() => stockists.distributor)
</script>

<style scoped>
.stk { max-width: 48rem; margin: 0 auto; padding: 3.5rem 1rem 4rem; }
.stk-head h1 { margin: 0 0 .4rem; }
.stk-sub { margin: 0 0 2.5rem; opacity: .75; max-width: 34rem; }
.stk-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 1.75rem; }
.stk-shop { display: grid; gap: .2rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--hair); }
.stk-shop:last-child { border-bottom: 0; }
.stk-name { font-size: 1.15rem; font-weight: 600; text-decoration: none; color: inherit; }
.stk-name:hover { color: var(--accent); }
.stk-where { margin: 0; font-size: .82rem; text-transform: uppercase; letter-spacing: .07em; opacity: .55; }
.stk-note { margin: .35rem 0 0; opacity: .8; }
.stk-empty h2 { margin: 0 0 .35rem; font-size: 1.1rem; }
.stk-empty p { margin: 0; opacity: .75; }
.stk-order { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--hair); }
.stk-line { margin: 0 0 .6rem; }
.stk-dist { margin: 0; display: flex; gap: .5rem; align-items: baseline; flex-wrap: wrap; }
.stk-label { font-size: .75rem; text-transform: uppercase; letter-spacing: .08em; opacity: .55; }
</style>
