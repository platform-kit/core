<!--
  COURSES AS A PLACE OF THE COMMUNITY (courses.where: community; openspec: courses): the same list, course and lesson
  as the standalone pages, drawn in the community's frame at <community>/courses, the way a site's own registered
  place is. `rest` is what follows the place's address, as the community hands every place it.
-->
<template>
  <CoursesView :base="COURSES_BASE" :path="rest" place />
</template>

<script setup>
import { COURSES_BASE } from 'platformkit/lib/router.js'
import CoursesView from './CoursesView.vue'

defineProps({ rest: { type: String, default: '' } })
</script>
