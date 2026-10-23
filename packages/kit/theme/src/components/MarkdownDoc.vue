<script setup>
/*
 * A markdown document, rendered in the house style. The source string is passed
 * in — callers import their .md with vite's ?raw — so the page can never drift
 * from the file it claims to show.
 */
import { computed } from 'vue'
import { marked, Marked } from 'marked'
import { sysmark } from './content/marks.js'

const props = defineProps({
  /* raw markdown (about pages, the purpose doc) — parsed here with marked */
  source: { type: String, default: '' },
  /* pre-rendered HTML (Velite documents) — used as-is */
  html: { type: String, default: '' },
  /* the house marks, ==text=={colour}, as the e-book draws them (a course lesson's key ideas) */
  marks: { type: Boolean, default: false },
})
const withMarks = new Marked(sysmark)

/* An editor's markdown formatter keeps splitting hard-wrapped list items with a
   blank line before the indented continuation, which marked then renders as a
   broken list. Rejoin that exact shape before parsing, so the page survives a
   re-mangled save. */
const rendered = computed(() => props.html
  || (props.marks ? withMarks : marked).parse(props.source.replace(/\n[ \t]*\n(?= {1,3}\S)/g, '\n')))
</script>

<template>
  <section class="purpose" v-html="rendered" />
</template>

<style scoped>
/* Reading measure lives on the text blocks, never on the section — a capped
   container squeezed the headings into a three-word stack. */
.purpose :deep(h1) {
  font-size: clamp(23px, 2.6vw, 29px); letter-spacing: -.022em; line-height: 1.2;
  margin: 54px 0 14px; max-width: none; text-wrap: initial;
}
.purpose :deep(h1:first-child) { margin-top: 0 }
.purpose :deep(h1:not(:first-child)) {
  border-top: 1px solid var(--hair); padding-top: 46px;
}
.purpose :deep(h2) {
  font-size: clamp(19px, 2.4vw, 23px); margin: 38px 0 10px;
}

.purpose :deep(p) { color: var(--ink2); line-height: 1.72; margin: 0 0 16px; max-width: 70ch }
.purpose :deep(strong) { color: var(--ink); font-weight: 700 }
.purpose :deep(em) { font-style: italic }

.purpose :deep(ol), .purpose :deep(ul) {
  margin: 0 0 16px; padding-left: 26px; color: var(--ink2); line-height: 1.7;
}
.purpose :deep(li) { margin-bottom: 8px; max-width: 66ch }
/* a loose list wraps each item in a paragraph; those paragraphs are the item */
.purpose :deep(li > p) { margin: 0 }
.purpose :deep(li > p + p) { margin-top: 6px }
.purpose :deep(li::marker) { font-family: var(--m); font-size: 12px; color: var(--accent2) }

.purpose :deep(hr) { border: 0; border-top: 1px solid var(--hair); margin: 44px 0 }

/* a wide table scrolls sideways inside the measure at phone width, never widens the page */
.purpose :deep(table) { display: block; width: max-content; min-width: 0; max-width: 100%; overflow-x: auto; margin: 6px 0 18px; -webkit-overflow-scrolling: touch }
.purpose :deep(td) { color: var(--ink2) }

.purpose :deep(blockquote) {
  margin: 0 0 16px; padding: 2px 0 2px 18px; border-left: 2px solid var(--accent);
  color: var(--ink2);
}
.purpose :deep(code) { font-family: var(--m); font-size: .92em; overflow-wrap: anywhere }
/* a code block scrolls sideways inside its measure, never widens the page (a file tree, a long SQL line) */
.purpose :deep(pre) { overflow-x: auto; background: var(--wash, var(--accentbg)); border: 1px solid var(--hair); border-radius: 12px;
  padding: 14px 18px; margin: 0 0 18px; font-size: 13px; line-height: 1.6; -webkit-overflow-scrolling: touch }
.purpose :deep(pre code) { font-size: inherit; background: none; padding: 0 }

/* links read as accent with a quiet underline — never the browser's raw blue */
.purpose :deep(a) { color: var(--accent2); text-decoration: none;
  box-shadow: inset 0 -1px 0 var(--hair); transition: box-shadow .15s, color .15s }
.purpose :deep(a:hover) { box-shadow: inset 0 -1px 0 var(--accent) }
/* the heading permalink wraps the heading text: it should look like the heading,
   not a link, and only tint on hover */
.purpose :deep(a.anchor) { color: inherit; box-shadow: none; font-weight: inherit }
.purpose :deep(a.anchor:hover) { color: var(--accent2); box-shadow: none }
</style>
