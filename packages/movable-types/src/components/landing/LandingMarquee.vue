<script setup>
/* the moving line between the hero and the rest: benefits and qualifiers taking turns, from the
   page's markdown (the arrays are zipped, so keep them the same length). The default slot lets a
   look's skin replace the band. */
import { onMounted } from 'vue'
const props = defineProps({
  benefits: { type: Array, default: () => ['Read anywhere', 'Keep your place', 'Learn by chapter', 'Ask a coach'] },
  qualifiers: { type: Array, default: () => ['Free to start', 'No credit card', 'Cancel anytime', 'Private & secure'] },
})
/* filled twice, so the -50% loop is seamless; the effects module animates it */
onMounted(() => {
  const mq = document.getElementById('lpmq'); if (!mq) return
  const parts = []
  for (let i = 0; i < Math.min(props.benefits.length, props.qualifiers.length); i++) parts.push('<span>' + props.benefits[i] + '</span>', '<span class="lpmqq">' + props.qualifiers[i] + '</span>')
  const html = parts.join(''); mq.innerHTML = html + html
})
</script>

<template>
  <slot :benefits="benefits" :qualifiers="qualifiers">
    <div class="lpmq" aria-hidden="true"><div class="lpmqi" id="lpmq"></div></div>
  </slot>
</template>
