<script setup>
/* The close of the teachings round: the books to read, up to three, the one whose
   sentence caught hardest first — cover, title, author, the companion's one-line
   insight — each a link straight into the book. Under them, the round's two doors
   as buttons, the way every other screen offers its choices. */
import ScreenHead from './ScreenHead.vue'
import { coverTint } from '@platform-kit/kit/lib/content.js'
import { capture } from '@platform-kit/kit/lib/analytics.js'
defineProps({ screen: { type: Object, required: true } })
const emit = defineEmits(['answer'])
</script>

<template>
  <div class="qzin qbooks">
    <ScreenHead :eyebrow="screen.eyebrow" :headline="screen.headline" :sub="screen.sub" />
    <div v-if="screen.books && screen.books.length" class="qbk-list">
      <a v-for="(b, n) in screen.books" :key="b.slug" class="qbk" :href="b.href" @click="capture('find_open', { book: b.slug, rank: n + 1, from: 'quiz' })">
        <span class="qbk-n">{{ n + 1 }}</span>
        <span class="qbk-cover" :style="b.cover ? null : { backgroundImage: coverTint(b.slug) }"><img v-if="b.cover" :src="b.cover.src" alt="" /></span>
        <span class="qbk-txt">
          <b class="qbk-title">{{ b.title }}</b>
          <i v-if="b.author" class="qbk-author">{{ b.author }}</i>
          <span v-if="b.insight" class="qbk-insight">{{ b.insight }}</span>
        </span>
        <span class="qbk-go" aria-hidden="true">→</span>
      </a>
    </div>
    <p v-else-if="screen.body" class="qp" v-html="screen.body" />
    <div class="qopts">
      <button v-for="(o, n) in screen.options || []" :key="o.v" class="qopt" @click="emit('answer', o.v)">
        <span class="k">{{ n + 1 }}</span>
        <span class="qoptl">{{ o.label }}</span>
      </button>
    </div>
  </div>
</template>
