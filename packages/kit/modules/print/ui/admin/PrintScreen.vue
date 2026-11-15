<script setup lang="ts">
/* the print editions as an admin screen (core:admin-screen): the admin hands it the book in its path and goes where it asks */
import AdminHead from 'platformkit/theme/components/admin/AdminHead.vue'
import { ug } from 'platformkit/lib/strings.js'
import PrintAdmin from './PrintAdmin.vue'
const props = defineProps({ name: { type: String, default: '' } })
const emit = defineEmits<{ navigate: [path: string] }>()
/* the page's name and its line, as the rail and the admin's leads word them */
const TITLE = (ug('admin', 'rail').views || {}).print || 'Print editions'
const LEAD = (ug('admin', 'leads').main || {}).print || ''
</script>

<template>
  <AdminHead :title="TITLE"><template #sub><span v-html="LEAD" /></template></AdminHead>
  <PrintAdmin :book="props.name" @open="emit('navigate', '/print/' + $event)" @back="emit('navigate', '/print')" />
</template>
