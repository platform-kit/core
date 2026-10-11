<script setup>
/* menubar-end: Search (VueFinder's search modal, with its field and Include subfolders), Folders (the tree), grid · list */
import { SearchIcon, LayoutGridIcon, ListIcon, FolderTreeIcon } from 'lucide-vue-next'
import { useMedia } from './use-media.js'
const { menuAction, checked, crumbs, W } = useMedia()
const B = W.bar
</script>

<template>
  <div class="mr-bar">
    <button type="button" class="ui-btn ui-ghost ui-sm" @click="menuAction('search')"><SearchIcon :size="14" />{{ B.search }}</button>
    <button type="button" class="ui-btn ui-ghost ui-sm" :class="{ 'ui-on': checked('tree-view') }" :title="B.tree" @click="crumbs.toggleTreeView()"><FolderTreeIcon :size="14" />{{ B.tree }}</button>
    <div class="ui-seg mr-view">
      <button type="button" :class="{ 'ui-on': checked('grid-view') }" :title="B.grid" @click="menuAction('grid-view')"><LayoutGridIcon :size="14" /></button>
      <button type="button" :class="{ 'ui-on': checked('list-view') }" :title="B.list" @click="menuAction('list-view')"><ListIcon :size="14" /></button>
    </div>
  </div>
</template>
