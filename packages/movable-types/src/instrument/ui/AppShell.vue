<script setup>
/* The /app page when the site registers no instrument of its own (platformkit.config.js
   instrumentComponent): the results sheet alone — the kit's tabs (accomplishments, coaching, chat)
   and any the site adds — with nothing to start. A site with rounds to run wraps the sheet in its
   own component, as a site with one does. */
import ResultsSheet from './results/ResultsSheet.vue'
import './instrument.css'
</script>

<template>
  <!-- the instrument's read mode, as the site's instrument renders the sheet (instrument.css: .qz.qzread) -->
  <div class="qz qzread">
    <div class="qzstage"><div><ResultsSheet /></div></div>
  </div>
</template>
