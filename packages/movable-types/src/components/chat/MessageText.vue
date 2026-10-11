<script setup>
/*
 * A message's words, drawn from the parts the parser cut (lib/chat/markup.js): bold, italic,
 * struck, code, bullets, a quotation, a link, and — where the surface passes them — the people the
 * line names. Every part is a real element and nothing here is html a person typed, which is why
 * the parser returns parts in the first place.
 *
 * One component for every chat surface in the product, so a line written in a room and the same
 * line answered from the desk are the same line.
 */
import MessagePart from './MessagePart.vue'
defineProps({
  blocks: { type: Array, default: () => [] },   /* what messageBlocks() / lineBlocks() returned */
  me: { type: String, default: '' },            /* so a mention of the reader can be marked */
})
</script>

<template>
  <span class="mk">
    <template v-for="(b, bi) in blocks" :key="bi">
      <ul v-if="b.kind === 'ul'" class="mk-ul">
        <li v-for="(line, li) in b.lines" :key="li"><MessagePart v-for="(p, i) in line" :key="i" :part="p" :me="me" /></li>
      </ul>
      <blockquote v-else-if="b.kind === 'quote'" class="mk-quote">
        <template v-for="(line, li) in b.lines" :key="li"><br v-if="li" /><MessagePart v-for="(p, i) in line" :key="i" :part="p" :me="me" /></template>
      </blockquote>
      <span v-else class="mk-p">
        <template v-for="(line, li) in b.lines" :key="li"><br v-if="li" /><MessagePart v-for="(p, i) in line" :key="i" :part="p" :me="me" /></template>
      </span>
    </template>
  </span>
</template>

<style scoped>
/* the site's global stylesheet owns bare ul, li and blockquote — every rule here is on a class */
.mk { display: block }
.mk-p { display: block }
.mk-ul { list-style: none; margin: 2px 0; padding: 0; max-width: none }
.mk-ul li { position: relative; margin: 1px 0; padding-left: 15px; max-width: none }
/* the bullet is drawn rather than a list marker, so it keeps the line's own colour and size */
.mk-ul li::before { content: '•'; position: absolute; left: 3px; color: var(--ink3) }
.mk-quote { display: block; margin: 3px 0; padding: 1px 0 1px 10px; max-width: none; border: 0;
  border-left: 2px solid color-mix(in srgb, var(--ink) 18%, transparent); color: var(--ink2); font-style: normal }
</style>
