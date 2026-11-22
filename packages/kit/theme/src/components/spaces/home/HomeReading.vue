<script setup lang="ts">
/*
 * HOME'S READING CARD (openspec: community-home): up to three books. The ones the reader is in the middle of, furthest
 * along first; else the site's suggestions for this reader (#site/recommendations signals().prescribed — the
 * diagnostics' books on a site that has them); else the library's own first books, finished ones dropped. The hub's
 * ranking is not run here: it loads an embedding model, and a front page should not pay for that.
 */
import { computed, onMounted } from 'vue'
import { us, bookShelf, bookProgress, dropFinished } from 'platformkit/lib/content.js'
import { ROUTES, navigate } from 'platformkit/lib/router.js'
import { sessionRev, initRecords, hydrate } from 'platformkit/lib/records.js'
import { isSignedIn } from 'platformkit/lib/auth.js'
import { signals } from '#site/recommendations'

const emit = defineEmits(['state'])
const W = computed(() => us('spaces').home.main)
const LIMIT = 3
const shelf = bookShelf()
const bySlug: any = Object.fromEntries(shelf.map((b: any) => [b.slug, b]))
const library = (ROUTES as any).content ? (ROUTES as any).content + '/books' : '/content/books'
const hrefOf = (slug: string) => library + '/' + slug

/* the site's knowledge of the reader arrives with their records: read again on each revision */
initRecords()
if (isSignedIn.value) hydrate()

const pick = computed(() => {
  void sessionRev.value
  const reading = shelf.map((b: any) => ({ ...b, prog: bookProgress(b.slug) })).filter((b: any) => b.prog.opened && b.prog.pct < 100)
    .sort((a: any, b: any) => b.prog.pct - a.prog.pct)
  if (reading.length) return { kind: 'reading', books: reading.slice(0, LIMIT) }
  const sig: any = (() => { try { return signals() } catch { return null } })()
  const named = ((sig && sig.prescribed) || []).map((h: string) => bySlug[String(h).split('/').filter(Boolean).pop() || '']).filter(Boolean)
  if (named.length) return { kind: 'suggested', books: dropFinished(named).slice(0, LIMIT).map((b: any) => ({ ...b, prog: bookProgress(b.slug) })) }
  return { kind: 'library', books: dropFinished(shelf).slice(0, LIMIT).map((b: any) => ({ ...b, prog: bookProgress(b.slug) })) }
})
const title = computed(() => W.value['reading-' + pick.value.kind])
function go(href: string, e: Event) { e.preventDefault(); navigate(href) }
onMounted(() => emit('state', pick.value.books.length ? 'ready' : 'empty'))
</script>

<template>
  <article class="hc hr">
    <header class="hc-head">
      <p class="hc-kicker">{{ W['reading-title'] }}</p>
      <a class="hc-more" :href="library" @click="go(library, $event)">{{ W['reading-all'] }}</a>
    </header>
    <h3 class="hc-title">{{ title }}</h3>
    <ul class="hr-books">
      <li v-for="b in pick.books" :key="b.slug">
        <a class="hr-book" :href="hrefOf(b.slug)" @click="go(hrefOf(b.slug), $event)">
          <span class="hr-cover">
            <img v-if="b.cover" :src="b.cover.src" :alt="''" loading="lazy" />
            <span v-else class="hr-blank">{{ b.title }}</span>
          </span>
          <span class="hr-words">
            <strong>{{ b.title }}</strong>
            <em v-if="b.author">{{ b.author }}</em>
            <span v-if="b.prog.opened" class="hr-prog">
              <span class="hc-bar"><span :style="{ width: b.prog.pct + '%' }" /></span>
              <span class="hc-meta">{{ String(W['reading-pct']).replace('{n}', b.prog.pct) }}</span>
            </span>
          </span>
        </a>
      </li>
    </ul>
  </article>
</template>

<style scoped>
.hr-books { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.hr-books li { margin: 0; padding: 0; min-width: 0; }
.hr-book { display: flex; flex-direction: column; gap: 12px; color: inherit; text-decoration: none; }
.hr-cover { display: block; aspect-ratio: 2 / 3; border-radius: 4px 8px 8px 4px; overflow: hidden; background: color-mix(in srgb, var(--ink) 7%, var(--paper));
  box-shadow: 0 1px 0 color-mix(in srgb, var(--ink) 10%, transparent), 0 10px 24px -14px #0008; transition: transform .25s ease, box-shadow .25s ease; }
.hr-cover img { display: block; width: 100%; height: 100%; object-fit: cover; }
.hr-blank { display: flex; align-items: flex-end; height: 100%; padding: 12px; box-sizing: border-box; font-size: 13px; font-weight: 600; color: var(--ink2); }
@media (hover: hover) { .hr-book:hover .hr-cover { transform: translateY(-3px); box-shadow: 0 1px 0 color-mix(in srgb, var(--ink) 10%, transparent), 0 16px 30px -14px #0009; } }
.hr-words { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.hr-words strong { font-size: 14.5px; line-height: 1.3; font-weight: 600; color: var(--ink); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.hr-book:hover strong { text-decoration: underline; }
.hr-words em { font-style: normal; font-size: 13px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hr-prog { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; }
/* where the card spans the row, the covers stay a book's size rather than growing with it */
:global(.ch-wide) .hr-books { grid-template-columns: repeat(3, minmax(0, 150px)); gap: 28px; }
@media (max-width: 420px) { .hr-books { gap: 12px; } }
</style>
