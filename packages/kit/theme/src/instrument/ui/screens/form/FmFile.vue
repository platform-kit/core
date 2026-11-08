<script setup lang="ts">
import type { PropType } from 'vue'
/* a file: chosen or dropped, under its size limit, an image alone when `imageonly`; the value is the
   File itself until it is posted (the answer row then names it) */
import { computed, ref } from 'vue'
import FmLabel from './FmLabel.vue'
const props = defineProps({ field: { type: Object as PropType<any>, required: true }, modelValue: { default: null }, ctx: { type: Object as PropType<any>, default: () => ({}) }, words: { type: Object as PropType<any>, default: () => ({}) }, error: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue', 'enter'])
const p = computed(() => props.field.params || {})
const id = computed(() => 'f_' + props.field.name)
const over = ref(false)
const name = computed(() => (props.modelValue && typeof props.modelValue === 'object' ? (props.modelValue as any).name : typeof props.modelValue === 'string' ? (props.modelValue as any).split('/').pop() : ''))
function take(files: any[]) { const f = files && files[0]; if (!f || p.value.disabled !== undefined) return; emit('update:modelValue', f) }
function clear() { emit('update:modelValue', null) }
</script>

<template>
  <div class="ff ff-file" :class="{ 'ff-err': error, over }">
    <FmLabel :field="field" :ctx="ctx" :words="words" :id="id" />
    <!-- @vue-expect-error TS18047, from the conversion: '$event.dataTransfer' is possibly 'null'. --><div class="ff-drop" @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="over = false; take($event.dataTransfer.files)">
      <template v-if="name">
        <span class="ff-fname">{{ name }}</span>
        <label class="ff-flink" :for="id">{{ words['file-change'] }}</label>
        <button type="button" class="ff-flink" @click="clear">{{ words['file-remove'] }}</button>
      </template>
      <template v-else>
        <label class="ff-flink ff-fchoose" :for="id"><strong>{{ words['file-choose'] }}</strong> <span class="ff-fdrag">{{ words['file-drag'] }}</span></label>
      </template>
      <!-- @vue-expect-error TS2322, from the conversion: Type 'string | null' is not assignable to type 'string | undefined'. --><input :id="id" type="file" class="fq-vh" :accept="p.imageonly !== undefined ? 'image/*' : null" :disabled="p.disabled !== undefined" @change="take(($event.target as any).files)" />
    </div>
    <p class="ff-hint">{{ words['file-size-limit'] }}: {{ p.sizelimit }} MB</p>
    <p v-if="error" class="ff-msg" role="alert">{{ error }}</p>
  </div>
</template>
