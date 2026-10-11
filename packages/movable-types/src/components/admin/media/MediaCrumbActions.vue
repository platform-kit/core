<script setup>
/* breadcrumb-actions: Up one level and Refresh, beside the path */
import { ArrowUpIcon, RefreshCwIcon } from 'lucide-vue-next'
import { useMedia } from './use-media.js'
const { crumbs, W } = useMedia()
const B = W.bar
</script>

<template>
  <div class="mr-crumbs">
    <button type="button" class="ui-btn ui-ghost ui-sm" :title="B.up" @click="crumbs.goUp()"><ArrowUpIcon :size="14" /></button>
    <button type="button" class="ui-btn ui-ghost ui-sm" :title="B.refresh" @click="crumbs.refresh()"><RefreshCwIcon :size="14" /></button>
  </div>
</template>
