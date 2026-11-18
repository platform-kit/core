<script setup lang="ts">
/* the desk as an admin screen (core:admin-screen): the admin hands it the conversation in its path and goes where it asks */
import SupportAdmin from './SupportAdmin.vue'
const props = defineProps({ name: { type: String, default: '' } })
const emit = defineEmits<{ navigate: [path: string] }>()
</script>

<template>
  <SupportAdmin :name="props.name" @open="emit('navigate', '/support/' + $event)" />
</template>
