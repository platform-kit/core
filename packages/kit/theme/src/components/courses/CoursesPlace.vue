<!--
  COURSES IN THE COMMUNITY (openspec: courses): the Courses row of the community's navigation, wherever the site has a
  community — the same library, overview and player as the pages at /courses, drawn in the community's frame at
  <community>/courses, the way Events are both. `rest` is what follows the place's address, as the community hands
  every place it.
-->
<template>
  <CoursesView :base="COURSES_PLACE_BASE" :path="rest" place />
</template>

<script setup>
import { COURSES_PLACE_BASE } from 'platformkit/lib/router.js'
import CoursesView from './CoursesView.vue'

defineProps({ rest: { type: String, default: '' } })
</script>
