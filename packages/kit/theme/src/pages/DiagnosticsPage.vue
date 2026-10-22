<script setup>
import { headForKey } from 'platformkit/lib/seo.js'
headForKey('app', '/app')
import SiteLayout from '../layouts/SiteLayout.vue'
import { Instrument as SiteInstrument } from '#site/instrument'   /* the site's instrument (its engine round the theme's screens), else the theme's own */
import AppShell from '../instrument/ui/AppShell.vue'
const Instrument = SiteInstrument || AppShell
import { ROUTES } from '../router.js'

/* A sheet id or url here swaps the statement bank at run time, so wording can be
   changed without a release. Unset, the built-in 105 are used. The round always
   starts on the built-in bank either way — the sheet lands in time for the next
   one rather than making anyone wait. */
const SHEET = import.meta.env.VITE_BANK_SHEET || ''
</script>

<template>
  <SiteLayout transparent :current="ROUTES.diagnostics">
    <div class="dxfull">
      <Instrument :sheet="SHEET" />
    </div>
  </SiteLayout>
</template>

<style scoped>
/* The instrument owns the whole viewport: full width, full height, no card
   chrome of its own, and its ground runs up under the header, which sits on it
   transparently (SiteLayout's ontop, as on the landing) so the two read as one
   surface. The component wraps .qz in its own div, so the whole chain down to
   the stage is pinned to 100%; the header's height is padding at the top. */
.dxfull { height: 100vh }
.dxfull :deep(> div), .dxfull > * { height: 100% }
.dxfull :deep(.qz) { height: 100%; min-height: 0; margin: 0; border: 0; border-radius: 0; padding-top: var(--headh) }
.dxfull :deep(.qzstage) { overflow-y: auto; min-height: 0 }
.dxfull :deep(.qz.qzread .qzstage) { min-height: 0 }
</style>
