<script setup>
import { masteryOf } from 'platformkit/lib/mastery.js'
import Trophy from '../Trophy.vue'
import Book3D from '../Book3D.vue'
import { bookShelf, bookProgress, coverTint, us } from 'platformkit/lib/content.js'
const books = bookShelf().map((b) => ({ ...b, prog: bookProgress(b.slug) }))
const S = us('library').shelf.page
const P = us('library').progress.label
const TR = us('library').trophy.tier
</script>

<template>
  <div class="wrap">
    <header>
      <h1>{{ S.heading }}</h1>
      <p class="subtitle">{{ S.subtitle }}</p>
    </header>
  </div>

  <div class="wrap shelfwrap">
    <a v-for="b in books" :key="b.slug" class="slot" :href="'/content/books/' + b.slug">
      <!-- a real cover speaks for itself; the generated one carries the words -->
      <span class="cover" :class="{ 'has-img': b.cover }"
            :style="b.cover ? null : { backgroundImage: coverTint(b.slug) }">
        <Book3D v-if="b.cover" class="cover-img" :slug="b.slug" :art="b.cover.src" :alt="b.title + ' cover'" :title="b.title" :author="b.author" mode="still" />
        <span v-else class="cover-text">
          <span class="cover-title">{{ b.title }}</span>
          <span class="cover-author" v-if="b.author">{{ b.author }}</span>
          <span class="cover-open">{{ S.open }} &rarr;</span>
        </span>
      </span>
      <span class="slot-caption">
        <b>{{ b.title }}</b>
        <span v-if="b.author">{{ b.author }}</span>
        <span v-if="b.prog.opened" class="cover-prog" :aria-label="b.prog.pct + '% ' + P['aria-read']">
          <span class="cover-prog-fill" :style="{ width: b.prog.pct + '%' }" />
        </span>
        <span v-if="b.prog.opened" class="slot-prog">{{ b.prog.pct === 100 ? P.finished : b.prog.pct + '% ' + P.read }}</span>
        <span v-if="masteryOf(b.slug).tier" class="slot-trophy" :class="'is-' + masteryOf(b.slug).tier"><Trophy :tier="masteryOf(b.slug).tier" :size="18" />{{ TR[masteryOf(b.slug).tier] }}</span>
      </span>
    </a>
    <p v-if="!books.length" class="tabintro">{{ S.empty }}</p>
  </div>
</template>

<style scoped>
.shelfwrap { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 18px; padding-bottom: 80px }
@media (max-width: 640px) { .shelfwrap { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 12px } }   /* two to a row on a phone, never one tall book after another */
.slot { display: block; text-decoration: none; color: var(--ink) }
.cover { position: relative; display: flex; aspect-ratio: 2 / 3;
  border-radius: 8px 14px 14px 8px; overflow: hidden; text-decoration: none;
  background: linear-gradient(165deg, var(--accent2), var(--accent)); color: #F6FBF6;
  box-shadow: inset 6px 0 0 #00000022, var(--sh); transition: transform .18s ease }
/* with a real cover the slot is a stage for the book as an object: no box, room for the tilt */
.cover.has-img { aspect-ratio: auto; overflow: visible; background: none; box-shadow: none; border-radius: 0; padding: 3% 9% 7% 1%; display: block }
.slot:hover .cover { transform: translateY(-4px) }
.cover-img { display: block }
.cover-text { display: flex; flex-direction: column; flex: 1; justify-content: space-between; padding: 24px 22px }
.slot-caption { display: block; padding: 12px 4px 0 }
.slot-trophy { display: inline-flex !important; align-items: center; gap: 5px; margin-top: 6px; font-family: var(--m); font-size: 10px; letter-spacing: .08em; text-transform: uppercase }
.slot-trophy.is-bronze { color: #a3612c !important } .slot-trophy.is-silver { color: #7c8593 !important } .slot-trophy.is-gold { color: #b8811c !important }
.slot-caption b { display: block; font-size: 15.5px; letter-spacing: -.01em }
.slot-caption span { display: block; font-family: var(--m); font-size: 10px; letter-spacing: .1em;
  text-transform: uppercase; color: var(--ink3); margin-top: 3px }
.cover:hover { transform: translateY(-4px) }
.cover-title { font-size: 20px; font-weight: 700; line-height: 1.25; letter-spacing: -.015em }
.cover-author { font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; opacity: .8; margin-top: 10px }
.cover-open { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; margin-top: 26px; opacity: .9 }
/* reading progress: a thin bar hugging the foot of the cover, and a word in the caption */
.cover-prog { display: block !important; margin-top: 8px !important; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--ink) 14%, transparent); overflow: hidden }
.cover-prog-fill { display: block; height: 100%; background: var(--accent); transition: width .3s ease }
.slot-prog { font-family: var(--m); font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--accent); margin-top: 5px }
</style>
