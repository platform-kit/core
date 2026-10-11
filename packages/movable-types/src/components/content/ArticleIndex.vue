<script setup>
import { articleIndex } from '@platform-kit/kit/lib/content.js'
const articles = articleIndex()
const img = (a) => a.data.image || (Array.isArray(a.data.media) ? a.data.media.find((m) => m.poster)?.poster : a.data.media?.poster) || null
const badge = (a) => a.data.media ? (Array.isArray(a.data.media) ? 'Playlist' : (a.data.media.type === 'audio' ? 'Audio' : 'Video')) : null
</script>

<template>
  <div class="wrapwide">
    <header>
      <h1>Articles</h1>
      <p class="subtitle">Pieces worth your evening &mdash; some to read, some to press play on.</p>
    </header>
  </div>

  <div class="wrapwide idx">
    <a v-for="(a, i) in articles" :key="a.id" class="card" :class="{ lead: i === 0 }"
       :href="'/content/articles/' + a.id">
      <span class="card-img" :class="{ ph: !img(a) }">
        <img v-if="img(a)" :src="img(a)" alt="" loading="lazy" />
        <span v-if="badge(a)" class="badge">{{ badge(a) }}</span>
      </span>
      <span class="card-body">
        <h2>{{ a.title }}</h2>
        <p>{{ a.description }}</p>
        <span class="date">
          <template v-if="a.date">{{ a.date }}</template>
          <template v-if="a.date && a.readingTime"> &middot; </template>
          <template v-if="a.readingTime">{{ a.readingTime }} min read</template>
        </span>
      </span>
    </a>
  </div>
</template>

<style scoped>
header h1 { font-family: var(--fd); font-optical-sizing: auto; font-weight: 600; letter-spacing: -.016em }
.idx { padding-bottom: 100px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px }
.card { display: flex; flex-direction: column; text-decoration: none; color: var(--ink);
  background: var(--card); border: 1px solid var(--hair); border-radius: 18px; overflow: hidden;
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease }
.card:hover { transform: translateY(-3px); box-shadow: var(--sh); border-color: var(--ink3) }
.card.lead { grid-column: 1 / -1; flex-direction: row }
.card-img { position: relative; display: block; aspect-ratio: 16 / 9; background:
  linear-gradient(150deg, var(--accentbg), var(--wash)); flex: none }
.card.lead .card-img { width: 54%; aspect-ratio: auto; min-height: 300px }
.card-img img { width: 100%; height: 100%; object-fit: cover; display: block }
.badge { position: absolute; left: 14px; top: 14px; font-family: var(--m); font-size: 9.5px;
  letter-spacing: .13em; text-transform: uppercase; color: #F4F6F1; background: #0a0d0bAA;
  backdrop-filter: blur(6px); border-radius: 999px; padding: 4px 10px }
.card-body { display: block; padding: 24px 26px 22px }
.card.lead .card-body { align-self: center; padding: 40px 44px }
.card h2 { font-family: var(--fd); font-optical-sizing: auto; font-weight: 600; font-size: 21px;
  letter-spacing: -.01em; line-height: 1.22; margin: 0 0 8px }
.card.lead h2 { font-size: clamp(28px, 3.2vw, 40px); margin-bottom: 12px }
.card p { font-size: 14.5px; color: var(--ink2); line-height: 1.6; margin: 0 0 14px; max-width: 56ch }
.date { font-family: var(--m); font-size: 10.5px; color: var(--ink3) }
@media (max-width: 980px) { .idx { grid-template-columns: 1fr 1fr } .card.lead { flex-direction: column } .card.lead .card-img { width: 100%; aspect-ratio: 16/9; min-height: 0 } }
@media (max-width: 640px) { .idx { grid-template-columns: 1fr } }
</style>
