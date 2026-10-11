<script setup>
/* toolbar-items: labelled buttons on VueFinder's own actions — New folder, Upload, and on a selection its count, Rename
   (one), Move to…, Copy to… (VueFinder's clipboard: copy, then paste into the folder chosen in its modal), Download
   (one file, by its served address), Delete, Clear */
import { computed } from 'vue'
import { FolderPlusIcon, UploadIcon, PencilIcon, FolderInputIcon, CopyIcon, DownloadIcon, Trash2Icon, XIcon } from 'lucide-vue-next'
import { useMedia } from './use-media.js'
const { menuAction, selection, usedBy, W } = useMedia()
const A = W.actions, F = W.file
/* a file in use — any record names it — is neither renamed, moved nor deleted from here */
const inUse = computed(() => selection.value.some((i) => usedBy(i).length))
const n = computed(() => selection.value.length)
const one = computed(() => (n.value === 1 ? selection.value[0] : null))
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
function copyTo() { menuAction('copy'); menuAction('paste') }
function download() { const f = one.value; if (!f || f.type === 'dir' || !f.url) return; const a = document.createElement('a'); a.href = f.url; a.download = f.basename || ''; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove() }
</script>

<template>
  <div class="mr-tools">
    <button type="button" class="ui-btn ui-sm" @click="menuAction('new-folder')"><FolderPlusIcon :size="14" />{{ A['new-folder'] }}</button>
    <button type="button" class="ui-btn ui-sm ui-primary" @click="menuAction('upload')"><UploadIcon :size="14" />{{ A.upload }}</button>
    <template v-if="n">
      <span class="mr-sep" />
      <span class="mr-count">{{ n === 1 ? A['selected-one'] : fill(A.selected, { n }) }}</span>
      <button v-if="one" type="button" class="ui-btn ui-ghost ui-sm" :disabled="inUse" :title="inUse ? F['in-use'] : ''" @click="menuAction('rename')"><PencilIcon :size="14" />{{ A.rename }}</button>
      <button type="button" class="ui-btn ui-ghost ui-sm" :disabled="inUse" :title="inUse ? F['in-use'] : ''" @click="menuAction('move')"><FolderInputIcon :size="14" />{{ A.move }}</button>
      <button type="button" class="ui-btn ui-ghost ui-sm" @click="copyTo"><CopyIcon :size="14" />{{ A.copy }}</button>
      <button v-if="one && one.type !== 'dir'" type="button" class="ui-btn ui-ghost ui-sm" @click="download"><DownloadIcon :size="14" />{{ A.download }}</button>
      <button type="button" class="ui-btn ui-ghost ui-sm ui-danger" :disabled="inUse" :title="inUse ? F['in-use'] : ''" @click="menuAction('delete')"><Trash2Icon :size="14" />{{ A.delete }}</button>
      <button type="button" class="ui-btn ui-ghost ui-sm" :title="A.clear" @click="menuAction('deselect')"><XIcon :size="14" /></button>
    </template>
  </div>
</template>
