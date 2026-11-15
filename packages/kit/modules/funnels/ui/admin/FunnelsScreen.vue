<script setup lang="ts">
/* FunnelsAdmin as an admin screen (core:admin-screen): the admin hands it the rest of its path and goes where it asks */
import FunnelsAdmin from './FunnelsAdmin.vue'
const props = defineProps({ name: { type: String, default: '' } })
const emit = defineEmits<{ navigate: [path: string] }>()
</script>

<template>
  <FunnelsAdmin :name="props.name" @open="emit('navigate', '/funnels/' + $event)" @back="emit('navigate', '/funnels')" @analytics="emit('navigate', '/funnel-analytics/' + $event)" />
</template>
