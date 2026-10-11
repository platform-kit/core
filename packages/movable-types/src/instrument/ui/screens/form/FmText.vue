<script setup>
/* text, email, url, tel, password, number, date, time, datetime — one component, the input by kind.
   A text input with `multiline` is a textarea; a tel input has the country's calling code beside it
   (forms.md's phone tables: the placeholder and the code by country); a number its unit. */
import { ref, computed, onMounted } from 'vue'
import { placeholdersAndCallingCodes, getPhoneNumberPlaceholder } from '@platform-kit/kit/vendor/formsmd/phone-numbers.js'
import FmLabel from './FmLabel.vue'
const props = defineProps({ field: { type: Object, required: true }, modelValue: { default: '' }, ctx: { type: Object, default: () => ({}) }, words: { type: Object, default: () => ({}) }, error: { type: String, default: '' }, autofocus: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue', 'enter'])
const p = computed(() => props.field.params || {})
const kind = computed(() => props.field.kind)
const id = computed(() => 'f_' + props.field.name)
const type = computed(() => ({ text: 'text', email: 'email', url: 'url', tel: 'tel', password: 'password', number: 'number', date: 'date', time: 'time', datetime: 'datetime-local' })[kind.value] || 'text')
const multiline = computed(() => kind.value === 'text' && p.value.multiline !== undefined)
const placeholder = computed(() => p.value.placeholder || (kind.value === 'number' ? props.words['number-placeholder'] : props.words['text-placeholder']) || '')
/* a tel value is "CC +code number" on the way out, as forms.md posts it; the two halves are edited apart */
const country = ref((p.value.country || 'US').toUpperCase())
const countries = computed(() => { const a = (p.value.availablecountries || []).map((c) => c.trim().toUpperCase()).filter((c) => placeholdersAndCallingCodes[c]); if (!a.includes(country.value)) a.unshift(country.value); return a.length ? a : Object.keys(placeholdersAndCallingCodes) })
const number = ref('')
if (kind.value === 'tel' && props.modelValue) { const m = /^([A-Z]{2}) (\+\d+) ?(.*)$/.exec(String(props.modelValue)); if (m) { country.value = m[1]; number.value = m[3] } else number.value = String(props.modelValue) }
function telOut() { emit('update:modelValue', number.value ? `${country.value} ${placeholdersAndCallingCodes[country.value].callingCode} ${number.value}` : '') }
const input = ref(null)
onMounted(() => { if (props.autofocus && input.value) setTimeout(() => input.value.focus(), 60) })
function grow(e) { const t = e.target; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px' }
</script>

<template>
  <div class="ff" :class="['ff-' + kind, { 'ff-err': error }]">
    <FmLabel :field="field" :ctx="ctx" :words="words" :id="id" />
    <template v-if="kind === 'tel'">
      <div class="ff-telrow">
        <label class="fq-vh" :for="id + '_cc'">{{ words['country-calling-code'] }}</label>
        <select :id="id + '_cc'" v-model="country" class="qwordin ff-cc" :disabled="p.disabled !== undefined" @change="telOut">
          <option v-for="c in countries" :key="c" :value="c">{{ c }} {{ placeholdersAndCallingCodes[c].callingCode }}</option>
        </select>
        <input ref="input" :id="id" v-model="number" type="tel" class="qwordin ff-in" :placeholder="getPhoneNumberPlaceholder(country)" :aria-label="words['phone-number']" :disabled="p.disabled !== undefined" autocomplete="tel-national" @input="telOut" @keydown.enter.prevent="emit('enter')" />
      </div>
    </template>
    <textarea v-else-if="multiline" ref="input" :id="id" :value="modelValue" class="qwordin ff-in ff-area" rows="3" :placeholder="placeholder" :maxlength="p.maxlength || null" :disabled="p.disabled !== undefined" @input="(e) => { grow(e); emit('update:modelValue', e.target.value) }" @keydown.enter.exact.prevent="emit('enter')" />
    <div v-else class="ff-inwrap" :class="{ 'ff-unit': p.unit || p.unitend }">
      <span v-if="p.unit" class="ff-unitl">{{ p.unit }}</span>
      <input ref="input" :id="id" :value="modelValue" :type="type" class="qwordin ff-in" :placeholder="placeholder" :maxlength="p.maxlength || null" :pattern="p.pattern || null" :min="p.min ?? null" :max="p.max ?? null" :step="p.step ?? null" :disabled="p.disabled !== undefined" :autocomplete="kind === 'email' ? 'email' : kind === 'password' ? 'current-password' : 'on'" @input="(e) => emit('update:modelValue', e.target.value)" @keydown.enter.prevent="emit('enter')" />
      <span v-if="p.unitend" class="ff-unitr">{{ p.unitend }}</span>
    </div>
    <p v-if="multiline && !error" class="ff-hint"><kbd>Shift</kbd> + <kbd>Enter</kbd> {{ words['textarea-new-line'] }}</p>
    <p v-if="error" class="ff-msg" role="alert">{{ error }}</p>
  </div>
</template>
