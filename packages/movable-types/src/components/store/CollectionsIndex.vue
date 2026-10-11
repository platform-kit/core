<script setup>
/*
 * /store/collections — every collection, as a tile you can walk into.
 */
import { watch } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { collections } from '@platform-kit/kit/lib/storefront.js'
import { ROUTES } from '../../router.js'

const T = us('store')
const HD = T.page.head
const CU = T.collection.ui
</script>

<template>
  <div class="ci wrapwide">
    <nav class="ci-crumb" aria-label=""><a :href="ROUTES.store">{{ HD.title }}</a><span>/</span><span class="cur">{{ CU['index-title'] }}</span></nav>
    <header class="ci-head">
      <h1>{{ CU['index-title'] }}</h1>
      <p v-if="CU['index-subtitle']">{{ CU['index-subtitle'] }}</p>
    </header>
    <div class="ci-tiles">
      <a v-for="c in collections" :key="c.id" class="ci-tile" :href="c.href">
        <div class="ci-media">
          <img v-if="c.image" :src="c.image" alt="" loading="lazy" decoding="async" />
          <div v-else class="ci-shelf">
            <img v-for="(im, i) in c.covers" :key="i" :src="im.src" alt="" loading="lazy" decoding="async"
                 :style="im.blur ? { backgroundImage: 'url(' + im.blur + ')', backgroundSize: 'cover' } : null" />
          </div>
        </div>
        <div class="ci-body">
          <h2>{{ c.title }}</h2>
          <p v-if="c.subtitle">{{ c.subtitle }}</p>
          <span class="ci-n">{{ c.items.length }} {{ c.items.length === 1 ? CU.piece : CU.pieces }} →</span>
        </div>
      </a>
    </div>
  </div>
</template>

<style scoped>
.ci { padding-block: 22px clamp(56px, 8vw, 110px) }   /* the gutter is .wrapwide's */
.ci-crumb { display: flex; gap: 10px; font-family: var(--m); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); margin-bottom: 26px }
.ci-crumb a { color: inherit; text-decoration: none } .ci-crumb a:hover { color: var(--ink) } .ci-crumb .cur { color: var(--ink2) }
.ci-head { margin-bottom: clamp(28px, 4vw, 48px) }
.ci-head h1 { font-family: var(--fd); font-weight: 600; font-size: clamp(38px, 5.4vw, 68px); line-height: 1; letter-spacing: -.035em; margin: 0 0 12px }
.ci-head p { font-size: 18px; color: var(--ink2); max-width: 50ch; margin: 0 }
.ci-tiles { display: grid; gap: 22px; grid-template-columns: repeat(2, minmax(0, 1fr)) }
.ci-tile { display: block; color: inherit; text-decoration: none; border-radius: 22px; overflow: hidden; background: var(--card); border: 1px solid var(--hair);
  transition: transform .25s cubic-bezier(.2, .8, .2, 1), box-shadow .25s }
.ci-tile:hover { transform: translateY(-3px); box-shadow: 0 30px 60px -40px #000b }
.ci-media { aspect-ratio: 16 / 9; overflow: hidden; background: color-mix(in srgb, var(--ink) 6%, var(--paper)) }
.ci-media > img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .9s cubic-bezier(.2, .8, .2, 1) }
.ci-tile:hover .ci-media > img { transform: scale(1.04) }
.ci-shelf { height: 100%; display: flex; align-items: flex-end; justify-content: center; padding: 8% 10% 0 }
.ci-shelf img { width: 30%; aspect-ratio: 4 / 5; object-fit: cover; border-radius: 6px 6px 0 0; box-shadow: 0 16px 30px -12px #0009 }
.ci-shelf img:nth-child(1) { transform: translate(6%, 6%) rotate(-3deg) }
.ci-shelf img:nth-child(2) { z-index: 1; transform: translateY(-2%) }
.ci-shelf img:nth-child(3) { transform: translate(-6%, 6%) rotate(3deg) }
.ci-body { padding: 20px 22px 22px }
.ci-body h2 { font-family: var(--fd); font-weight: 600; font-size: 26px; letter-spacing: -.02em; margin: 0 0 6px }
.ci-body p { margin: 0 0 12px; color: var(--ink2); font-size: 15px }
.ci-n { font-family: var(--m); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
@media (max-width: 720px) { .ci-tiles { grid-template-columns: 1fr } }
</style>
