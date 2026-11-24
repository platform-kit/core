<script setup lang="ts">
/*
 * HOME'S READING CARD (openspec: community-home): three books. The ones the reader is in the middle of, furthest
 * along first; the slots left go to the site's suggestions for this reader (#site/recommendations signals().prescribed — the
 * diagnostics' books on a site that has them), then to the library's own first books, finished ones dropped. The hub's
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

/* THE THREE BOOKS: the ones being read, furthest along first; the slots they leave go to the site's suggestions for this
   reader, then to the library's own first books — so the row is always full, and the heading names what leads it */
const pick = computed(() => {
  void sessionRev.value
  const withProg = (b: any) => ({ ...b, prog: bookProgress(b.slug) })
  const reading = shelf.map(withProg).filter((b: any) => b.prog.opened && b.prog.pct < 100).sort((a: any, b: any) => b.prog.pct - a.prog.pct)
  const sig: any = (() => { try { return signals() } catch { return null } })()
  const named = ((sig && sig.prescribed) || []).map((h: string) => bySlug[String(h).split('/').filter(Boolean).pop() || '']).filter(Boolean)
  const books: any[] = [], seen = new Set<string>()
  const take = (list: any[]) => { for (const b of list) { if (books.length >= LIMIT) return; if (seen.has(b.slug)) continue; seen.add(b.slug); books.push(withProg(b)) } }
  take(reading)
  take(dropFinished(named))
  take(dropFinished(shelf))
  const kind = reading.length ? 'reading' : named.length ? 'suggested' : 'library'
  return { kind, books }
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
/* THE BOOKS ACROSS THE CARD: on a wide card each is a cover with its title, author and progress beside it; on a narrow
   one (a phone) the covers stand side by side with the words under them */
.hr { container-type: inline-size; }
.hr-books { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
.hr-books li { margin: 0; padding: 0; min-width: 0; }
.hr-book { display: flex; flex-direction: row; align-items: flex-start; gap: 16px; color: inherit; text-decoration: none; }
.hr-cover { flex: none; display: block; width: 76px; aspect-ratio: 2 / 3; border-radius: 4px; overflow: hidden; background: color-mix(in srgb, var(--ink) 7%, var(--paper));
  box-shadow: 0 1px 0 color-mix(in srgb, var(--ink) 10%, transparent), 0 10px 22px -12px #0008; transition: transform .25s ease, box-shadow .25s ease; }
.hr-cover img { display: block; width: 100%; height: 100%; object-fit: cover; }
/* an edge, so a white cover does not float on the card */
.hr-cover { position: relative; }
.hr-cover::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 10%, transparent); pointer-events: none; }
.hr-blank { display: flex; align-items: flex-end; height: 100%; padding: 10px; box-sizing: border-box; font-size: 12px; font-weight: 600; color: var(--ink2); }
@media (hover: hover) { .hr-book:hover .hr-cover { transform: translateY(-3px); box-shadow: 0 1px 0 color-mix(in srgb, var(--ink) 10%, transparent), 0 16px 28px -12px #0009; } }
.hr-words { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; padding-top: 4px; }
.hr-words strong { max-width: none; font-size: 15px; line-height: 1.3; font-weight: 600; color: var(--ink); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.hr-book:hover strong { text-decoration: underline; }
.hr-words em { font-style: normal; font-size: 13.5px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hr-prog { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; max-width: 180px; }
@container (max-width: 640px) {
  .hr-books { gap: 14px; }
  .hr-book { flex-direction: column; gap: 10px; }
  .hr-cover { width: 100%; }
  .hr-words { padding-top: 0; }
  .hr-words strong { font-size: 14px; -webkit-line-clamp: 2; }
  .hr-words em { font-size: 12.5px; }
}
</style>
