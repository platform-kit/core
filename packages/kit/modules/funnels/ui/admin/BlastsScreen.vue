<script setup lang="ts">
/* BlastsAdmin as an admin screen (core:admin-screen): the admin hands it the rest of its path and goes where it asks */
import BlastsAdmin from './BlastsAdmin.vue'
const props = defineProps({ name: { type: String, default: '' } })
const emit = defineEmits<{ navigate: [path: string] }>()
</script>

<template>
  <BlastsAdmin :name="props.name" @open="emit('navigate', '/blasts/' + $event)" @back="emit('navigate', '/blasts')" @analytics="emit('navigate', '/funnel-analytics/blast/' + $event)" />
</template>
