<script setup>
import { onMounted } from 'vue'
import bitterRegular from '../../assets/print-fonts/Bitter-400-normal.ttf?url'
import bitterItalic from '../../assets/print-fonts/Bitter-400-italic.ttf?url'
import bitterBold from '../../assets/print-fonts/Bitter-700-normal.ttf?url'
import frauncesSemibold from '../../assets/print-fonts/Fraunces-600-normal.ttf?url'
import plexMono from '../../assets/print-fonts/IBMPlexMono-400-normal.ttf?url'

defineProps({
  title: { type: String, default: '' },
  html: { type: String, default: '' },
  page: { type: Number, default: 0 },
  number: { type: Number, default: null },
  chapterWord: { type: String, default: '' },
  previewLabel: { type: String, default: '' },
  zoom: { type: Boolean, default: false },
})

let printFontsPromise
onMounted(() => {
  if (!printFontsPromise) {
    printFontsPromise = Promise.all([
    new FontFace('Print Bitter', `url("${bitterRegular}")`, { weight: '400' }).load(),
    new FontFace('Print Bitter', `url("${bitterItalic}")`, { weight: '400', style: 'italic' }).load(),
    new FontFace('Print Bitter', `url("${bitterBold}")`, { weight: '700' }).load(),
    new FontFace('Print Fraunces', `url("${frauncesSemibold}")`, { weight: '600' }).load(),
    new FontFace('Print Plex Mono', `url("${plexMono}")`, { weight: '400' }).load(),
    ]).then((faces) => faces.forEach((face) => document.fonts.add(face)))
  }
  return printFontsPromise
})
</script>

<template>
  <article class="print-preview" :class="{ 'print-preview-zoom': zoom }">
    <div class="print-preview-content">
      <header class="print-preview-chapter">{{ number == null ? '' : `${chapterWord} ${number}` }}</header>
      <h2>{{ title }}</h2>
      <div class="print-preview-text" v-html="html" />
    </div>
    <span v-if="previewLabel" class="print-preview-notice">{{ previewLabel }}</span>
  </article>
</template>

<style scoped>
.print-preview {
  position: relative;
  box-sizing: border-box;
  width: auto;
  height: 100%;
  overflow: hidden;
  aspect-ratio: 2 / 3;
  container-type: inline-size;
  color: #1b1a17;
  background: #fff;
  border: 1px solid #dcd7cc;
  box-shadow: 0 0 38px #0000001a;
  text-align: left;
}
.print-preview-content {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  overflow: hidden;
  padding: 8.9cqw 11.67cqw 8.9cqw 15cqw;
}
.print-preview-chapter {
  margin-top: 17.8cqw;
  margin-bottom: 2cqw;
  min-height: 2.09cqw;
  color: #7a766d;
  font-family: "Print Plex Mono", monospace;
  font-size: 1.74cqw;
  letter-spacing: .14em;
  line-height: 1.2;
  text-transform: uppercase;
}
.print-preview-notice {
  position: absolute;
  right: 2cqw;
  bottom: 1.5cqw;
  color: #7a766d;
  font-family: "Print Plex Mono", monospace;
  font-size: 1.2cqw;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.print-preview h2 {
  margin: 0 0 8.33cqw;
  color: #1b1a17;
  font-family: "Print Fraunces", serif;
  font-size: 5.56cqw;
  font-weight: 600;
  line-height: 1.15;
  hyphens: none;
}
.print-preview-text {
  overflow: hidden;
  color: #1b1a17;
  font-family: "Print Bitter", serif;
  font-size: 2.43cqw;
  line-height: 1.68;
  text-align: justify;
  hyphens: auto;
}
.print-preview-text :deep(p) { margin: 0 0 .68em; text-indent: 1.4em }
.print-preview-text :deep(h2),
.print-preview-text :deep(h3) {
  margin: 1.4em 0 .6em;
  color: #1b1a17;
  font-family: "Print Fraunces", serif;
  font-size: 3.01cqw;
  font-weight: 600;
  line-height: 1.25;
  text-align: left;
}
.print-preview-text :deep(blockquote) {
  margin: 1.1em 1.6em;
  color: #4a4741;
  font-size: .95em;
}
.print-preview-text :deep(ul),
.print-preview-text :deep(ol) { padding-left: 1.25em; text-indent: 0 }
.print-preview-text :deep(strong) { font-weight: 700 }
.print-preview-text :deep(mark) {
  padding: 0 .04em;
  color: inherit;
  background: #fbeeb6;
  border-radius: 2.5pt;
}
.print-preview-zoom {
  width: min(620px, 56vh, 84vw);
  height: auto;
  max-height: 84vh;
  flex: none;
}
.print-preview-zoom .print-preview-content { overflow: hidden }
</style>
