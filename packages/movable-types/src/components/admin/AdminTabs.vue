<script setup>
/*
 * THE TABS OF A PAGE, which stand where its title would be.
 *
 * A subject the admin keeps in two or three places is one page: the comments and the policy they
 * are judged by, the community and the rooms in it, the email designs and what was sent through
 * them. The rail shows one row for the subject and the tabs are how you move inside it — and
 * because the tab row IS the heading, there is no title above repeating the first tab's name.
 */
defineProps({
  /* the view keys in the set, in order */
  tabs: { type: Array, required: true },
  /* which one is open */
  on: { type: String, default: '' },
  /* how a key is named and counted — the shell's own, so no label is written twice */
  label: { type: Function, required: true },
  count: { type: Function, default: () => null },
})
defineEmits(['pick'])
</script>

<template>
  <div class="ui-pagetabs" role="tablist">
    <button
      v-for="k in tabs" :key="k" type="button" role="tab"
      :class="{ on: on === k }" :aria-selected="on === k"
      @click="$emit('pick', k)"
    >{{ label(k) }}<span v-if="count(k) != null" class="ui-tabcount">{{ count(k) }}</span></button>
  </div>
</template>
