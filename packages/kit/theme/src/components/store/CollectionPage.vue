<script setup>
/*
 * One collection: its banner, its introduction, and every piece in it. A draft
 * from the admin's live preview arrives through inject in place of the
 * compiled collection.
 */
import { computed, inject, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { collection, resolveCollection } from 'platformkit/lib/storefront.js'
import { contentView } from 'platformkit/lib/analytics.js'
import { ROUTES } from '../../router.js'
import ProductCard from './ProductCard.vue'

const props = defineProps({ id: { type: String, required: true } })
const T = us('store')
const HD = T.page.head
const CU = T.collection.ui
const preview = inject('dl-preview', null)
const c = computed(() => (preview ? (preview.value ? resolveCollection(preview.value) : null) : collection(props.id)))
watch(c, (v) => { if (v && !preview) { contentView({ kind: 'collection', id: v.id, title: v.title }) } }, { immediate: true })
</script>

<template>
  <div v-if="c" class="cp wrapwide">
    <nav class="cp-crumb" aria-label="">
      <a :href="ROUTES.store">{{ HD.title }}</a><span>/</span><a :href="ROUTES.store + '/collections'">{{ CU['index-title'] }}</a>
    </nav>
    <header class="cp-head" :class="{ 'has-art': c.image || c.covers.length }">
      <div class="cp-copy">
        <span class="cp-eyebrow">{{ CU.eyebrow }}</span>
        <h1>{{ c.title }}</h1>
        <p v-if="c.subtitle" class="cp-subtitle">{{ c.subtitle }}</p>
        <div v-if="c.body" class="cp-intro" v-html="c.body" />
        <span class="cp-n">{{ c.items.length }} {{ c.items.length === 1 ? CU.piece : CU.pieces }}</span>
      </div>
      <div v-if="c.image" class="cp-art"><img :src="c.image" alt="" loading="eager" decoding="async" /></div>
      <div v-else-if="c.covers.length" class="cp-art cp-shelf">
        <img v-for="(im, i) in c.covers" :key="i" :src="im.src" alt="" loading="eager" decoding="async" />
      </div>
    </header>
    <div v-if="c.items.length" class="cp-grid">
      <ProductCard v-for="(p, i) in c.items" :key="p.id" :product="p" :eager="i < 4" />
    </div>
    <p v-else class="cp-empty">{{ CU.empty }}</p>
  </div>
  <div v-else class="cp wrapwide cp-missing">
    <h1>{{ HD['not-found'] }}</h1>
    <a class="cp-back" :href="ROUTES.store">{{ HD['not-found-cta'] }}</a>
  </div>
</template>

<style scoped>
.cp { padding-block: 22px clamp(56px, 8vw, 110px) }   /* the gutter is .wrapwide's */
.cp-crumb { display: flex; gap: 10px; font-family: var(--m); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); margin-bottom: 26px }
.cp-crumb a { color: inherit; text-decoration: none } .cp-crumb a:hover { color: var(--ink) }
.cp-head { display: grid; grid-template-columns: 1fr; gap: clamp(24px, 4vw, 56px); align-items: center; margin-bottom: clamp(32px, 4vw, 56px) }
.cp-head.has-art { grid-template-columns: minmax(0, 6fr) minmax(0, 6fr) }
.cp-eyebrow { display: block; font-family: var(--m); font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--accent2); margin-bottom: 14px }
.cp-head h1 { font-family: var(--fd); font-weight: 600; font-size: clamp(38px, 5.4vw, 68px); line-height: 1; letter-spacing: -.035em; margin: 0 0 16px; text-wrap: balance }
.cp-subtitle { font-size: 18px; line-height: 1.5; color: var(--ink2); max-width: 46ch; margin: 0 0 14px }
.cp-intro { color: var(--ink2); font-size: 15.5px; line-height: 1.6; max-width: 56ch }
.cp-intro :deep(p) { margin: 0 0 10px }
.cp-n { display: inline-block; margin-top: 8px; font-family: var(--m); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
.cp-art { border-radius: 22px; overflow: hidden; aspect-ratio: 16 / 10; background: color-mix(in srgb, var(--ink) 6%, var(--paper)); box-shadow: 0 40px 90px -50px #000a }
.cp-art > img { width: 100%; height: 100%; object-fit: cover; display: block }
.cp-shelf { display: flex; align-items: flex-end; justify-content: center; padding: 7% 8% 0 }
.cp-shelf img { width: 30%; aspect-ratio: 4 / 5; object-fit: cover; border-radius: 6px 6px 0 0; box-shadow: 0 16px 30px -12px #0009 }
.cp-shelf img:nth-child(1) { transform: translate(6%, 6%) rotate(-3deg) }
.cp-shelf img:nth-child(2) { z-index: 1; transform: translateY(-2%) }
.cp-shelf img:nth-child(3) { transform: translate(-6%, 6%) rotate(3deg) }
.cp-grid { display: grid; gap: 26px 20px; grid-template-columns: repeat(4, minmax(0, 1fr)) }
.cp-empty { color: var(--ink3) }
.cp-missing { padding-top: 80px; text-align: center }
.cp-missing h1 { font-family: var(--fd); font-weight: 600; font-size: 30px; margin: 0 0 12px }
.cp-back { color: var(--accent2) }
@media (max-width: 1000px) { .cp-head.has-art { grid-template-columns: 1fr } .cp-art { order: -1; max-height: 320px } .cp-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) } }
@media (max-width: 640px) { .cp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px } }
</style>
