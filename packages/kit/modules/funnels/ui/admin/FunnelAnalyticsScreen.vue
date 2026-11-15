<script setup lang="ts">
/* FunnelAnalytics as an admin screen (core:admin-screen): the admin hands it the rest of its path and goes where it asks */
import FunnelAnalytics from '../FunnelAnalytics.vue'
const props = defineProps({ name: { type: String, default: '' } })
const emit = defineEmits<{ navigate: [path: string] }>()
</script>

<template>
  <FunnelAnalytics :kind="props.name.startsWith('blast/') ? 'blast' : 'funnel'" :name="props.name.replace(/^blast\//, '')" @open="emit('navigate', '/funnel-analytics/' + ($event.kind === 'blast' ? 'blast/' : '') + $event.name)" @back="emit('navigate', '/funnel-analytics')" @edit="emit('navigate', ($event.kind === 'blast' ? '/blasts/' : '/funnels/') + $event.name)" />
</template>
