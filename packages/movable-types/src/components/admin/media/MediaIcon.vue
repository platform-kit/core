<script setup>
/* the explorer's item glyph, Lucide's: a folder, a picture, a file */
import { computed } from 'vue'
import { FolderIcon, ImageIcon, FileIcon, FileTextIcon } from 'lucide-vue-next'
const props = defineProps({ item: { type: Object, default: null }, size: { type: Number, default: 22 } })
const glyph = computed(() => { const it = props.item || {}; if (it.type === 'dir') return FolderIcon; const m = String(it.mime_type || ''); if (m.startsWith('image/')) return ImageIcon; if (m.startsWith('text/')) return FileTextIcon; return FileIcon })
</script>

<template>
  <component :is="glyph" :size="size" class="mr-icon" :class="{ 'mr-icon-dir': item && item.type === 'dir' }" />
</template>
