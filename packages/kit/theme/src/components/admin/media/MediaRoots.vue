<script setup>
/* menubar-start: the two roots as the admin's segmented control (VueFinder's storage select is hidden by the skin) */
import { computed } from 'vue'
import { useMedia } from './use-media.js'
const { crumbs, W } = useMedia()
const H = W.head
const ROOTS = [['uploads', H.uploads], ['site', H.site]]
const current = computed(() => (crumbs.currentPath.value && crumbs.currentPath.value.storage) || 'uploads')
</script>

<template>
  <div class="ui-seg mr-roots">
    <button v-for="[k, label] in ROOTS" :key="k" type="button" :class="{ 'ui-on': current === k }" @click="crumbs.goTo(k + '://')">{{ label }}</button>
  </div>
</template>
