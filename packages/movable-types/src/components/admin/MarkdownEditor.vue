<script setup>
/*
 * The body editor for the content admin — TipTap, editing markdown. The
 * tiptap-markdown extension parses the incoming markdown and serialises it back
 * out on every change, so the file on disk stays markdown while the author gets a
 * rich WYSIWYG surface. Dev-only (it rides in AdminPage), so its weight never
 * reaches a production build.
 */
import pipe from '../../lib/admin/api.js'
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import HardBreak from '@tiptap/extension-hard-break'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import { Markdown } from 'tiptap-markdown'
import SystemHighlight from './SystemHighlight.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import { useMediaPick } from '../../lib/admin/media-pick.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  compact: { type: Boolean, default: false },   /* drawer: show only the essentials */
  /* prose: no headings, rules, code blocks or images — for a passage that lives inside a
     larger grammar (a companion's summary, where a `# ` line would begin a new chapter);
     the shortcuts for them are off too, not just the buttons */
  prose: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

let syncing = false
const editor = useEditor({
  content: props.modelValue,
  extensions: [
    StarterKit.configure({ heading: props.prose ? false : { levels: [1, 2, 3, 4] }, codeBlock: props.prose ? false : {}, horizontalRule: props.prose ? false : {}, hardBreak: false }),
    /* a hard break goes back out as two trailing spaces — the form the books use —
       rather than tiptap-markdown's backslash, so verse round-trips as written */
    HardBreak.extend({ addStorage() { return { markdown: { serialize(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) if (parent.child(i).type !== node.type) { state.write('  \n'); return }
    }, parse: {} } } } }),
    Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }),
    ...(props.prose ? [] : [Image.configure({ inline: false })]),
    SystemHighlight,
    Typography,
    Placeholder.configure({ placeholder: props.prose ? 'Write…  markdown shortcuts work (**bold**, - list)' : 'Write the body…  markdown shortcuts work (**bold**, # heading, - list)' }),
    Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true, linkify: true, breaks: true }),
  ],
  onUpdate: ({ editor }) => {
    syncing = true
    emit('update:modelValue', editor.storage.markdown.getMarkdown())
    syncing = false
  },
})

/* outside change (switching documents) → reset the editor content */
watch(() => props.modelValue, (val) => {
  if (syncing || !editor.value) return
  if (val !== editor.value.storage.markdown.getMarkdown()) editor.value.commands.setContent(val || '', false)
})

/* dev only: the tests read the live editor to check the markdown round trip */
if (import.meta.env.DEV && typeof window !== 'undefined') window.__dlEditor = editor
onBeforeUnmount(() => editor.value && editor.value.destroy())

function setLink() {
  const prev = editor.value.getAttributes('link').href || ''
  const url = window.prompt('Link URL', prev)
  if (url === null) return
  if (url === '') editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
  else editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}
/* the image button offers two ways in — a file uploaded to content/uploads, or one chosen from the library — and
   inserts the picture by its address; no URL typing */
const MF = us('media').page.field
const { choose } = useMediaPick()
const fileInput = ref(null), imgMenu = ref(false)
function addImage() { imgMenu.value = !imgMenu.value }
function uploadImage() { imgMenu.value = false; fileInput.value && fileInput.value.click() }
async function libraryImage() { imgMenu.value = false; const url = await choose('image'); if (url) editor.value.chain().focus().setImage({ src: url }).run() }
async function onPickImage(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  try {
    const j = await pipe.uploadImage(file)
    editor.value.chain().focus().setImage({ src: j.path }).run()
  } catch (err) { window.alert(MF.failed.replace('{error}', err.message || err)) }
}

/* ---- system-highlight bubble menu: apply / recolour / clear ==text=={colour}
   over a selection, or on the mark the cursor sits in. Colours mirror the reader's
   element code (see SystemHighlight.js / BookReader.vue). ---- */
const HL_COLORS = [
  { k: 'sun', name: 'Higher truth', hex: '#E1A200' },
  { k: 'ember', name: 'Spirit', hex: '#DD802F' },
  { k: 'sky', name: 'Mind', hex: '#EFAE7A' },
  { k: 'leaf', name: 'Earth', hex: '#4CA646' },
  { k: 'ocean', name: 'Emotions', hex: '#1785A0' },
]
const isHl = (k) => editor.value && editor.value.isActive('systemHighlight', { color: k })
const anyHl = () => editor.value && editor.value.isActive('systemHighlight')
function shouldShowHl({ editor: e, from, to }) {
  return from !== to || e.isActive('systemHighlight')   /* a real selection, or sitting inside a mark */
}
function applyHl(k) {
  const chain = editor.value.chain().focus()
  if (editor.value.state.selection.empty && anyHl()) chain.extendMarkRange('systemHighlight')
  if (isHl(k)) chain.unsetMark('systemHighlight')
  else chain.setMark('systemHighlight', { color: k, raw: '' })
  chain.run()
}
function clearHl() {
  editor.value.chain().focus().extendMarkRange('systemHighlight').unsetMark('systemHighlight').run()
}

/* clean line icons (lucide) */
const ICONS = {
  bold: '<path d="M14 12a4 4 0 0 0 0-8H6v8"/><path d="M15 20a4 4 0 0 0 0-8H6v8Z"/>',
  italic: '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>',
  strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  h1: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/>',
  h2: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>',
  h3: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  ordered: '<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  quote: '<path d="M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2-1 3-3 4"/><path d="M19 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2-1 3-3 4"/>',
  codeblock: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>',
  rule: '<line x1="5" y1="12" x2="19" y2="12"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
}
const svg = (name) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`

const TOOLS = [
  { icon: 'bold', title: 'Bold', compact: true, active: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { icon: 'italic', title: 'Italic', compact: true, active: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  { icon: 'strike', title: 'Strikethrough', active: (e) => e.isActive('strike'), run: (e) => e.chain().focus().toggleStrike().run() },
  { icon: 'code', title: 'Inline code', active: (e) => e.isActive('code'), run: (e) => e.chain().focus().toggleCode().run() },
  { sep: true },
  { icon: 'h1', title: 'Heading 1', compact: true, active: (e) => e.isActive('heading', { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { icon: 'h2', title: 'Heading 2', compact: true, active: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { icon: 'h3', title: 'Heading 3', active: (e) => e.isActive('heading', { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { sep: true },
  { icon: 'list', title: 'Bullet list', compact: true, active: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { icon: 'ordered', title: 'Numbered list', compact: true, active: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { icon: 'quote', title: 'Quote', compact: true, active: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { icon: 'codeblock', title: 'Code block', active: (e) => e.isActive('codeBlock'), run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { icon: 'rule', title: 'Divider', run: (e) => e.chain().focus().setHorizontalRule().run() },
  { sep: true },
  { icon: 'link', title: 'Link', active: (e) => e.isActive('link'), run: () => setLink() },
  { icon: 'image', title: 'Image', run: () => addImage() },
  { sep: true, end: true },
  { icon: 'undo', title: 'Undo', run: (e) => e.chain().focus().undo().run(), disabled: (e) => !e.can().undo() },
  { icon: 'redo', title: 'Redo', run: (e) => e.chain().focus().redo().run(), disabled: (e) => !e.can().redo() },
]
const PROSE = new Set(['bold', 'italic', 'strike', 'list', 'ordered', 'quote', 'link', 'undo', 'redo'])
const tools = computed(() => {
  const list = props.compact ? TOOLS.filter((t) => t.compact) : TOOLS
  if (!props.prose) return list
  /* the prose set, with no separator left standing beside another or at an end */
  const out = list.filter((t) => t.sep || PROSE.has(t.icon))
  return out.filter((t, i) => !t.sep || (i > 0 && i < out.length - 1 && !out[i - 1].sep))
})
</script>

<template>
  <div class="md" v-if="editor">
    <div class="md-bar">
      <template v-for="(t, i) in tools" :key="i">
        <span v-if="t.sep" class="md-sep" :class="{ 'md-sep-end': t.end }" />
        <span v-else-if="t.icon === 'image'" class="md-imgwrap">
          <button type="button" class="md-btn" :class="{ on: imgMenu }" :title="t.title" @click="t.run(editor)" v-html="svg(t.icon)" />
          <span v-if="imgMenu" class="md-imgmenu" @mouseleave="imgMenu = false">
            <button type="button" @click="uploadImage">{{ MF['upload-image'] }}</button>
            <button type="button" @click="libraryImage">{{ MF.choose }}</button>
          </span>
        </span>
        <button v-else type="button" class="md-btn" :class="{ on: t.active && t.active(editor) }"
                :disabled="t.disabled && t.disabled(editor)" :title="t.title"
                @click="t.run(editor)" v-html="svg(t.icon)" />
      </template>
    </div>
    <input ref="fileInput" type="file" accept="image/*" hidden @change="onPickImage" />
    <bubble-menu :editor="editor" :should-show="shouldShowHl" :tippy-options="{ duration: 120, maxWidth: 'none' }">
      <div class="md-hl">
        <span class="md-hl-label">Mark</span>
        <button v-for="c in HL_COLORS" :key="c.k" type="button" class="md-hl-sw" :class="{ on: isHl(c.k) }"
                :style="{ '--sw': c.hex }" :title="c.name" @click="applyHl(c.k)" />
        <span class="md-hl-sep" />
        <button type="button" class="md-hl-clear" :disabled="!anyHl()" title="Remove highlight" @click="clearHl">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </bubble-menu>
    <EditorContent class="md-body" :editor="editor" />
  </div>
</template>

<style scoped>
.md { border: 1px solid var(--hair); border-radius: 12px; overflow: hidden; background: var(--paper); display: flex; flex-direction: column; min-height: 0 }
.md-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; padding: 7px 8px; border-bottom: 1px solid var(--hair);
  background: var(--wash); position: sticky; top: 0; z-index: 2 }
.md-sep { width: 1px; align-self: stretch; margin: 3px 5px; background: var(--hair) }
.md-sep-end { margin-left: auto; background: none }
.md-imgwrap { position: relative; display: inline-flex }
.md-imgmenu { position: absolute; top: 100%; left: 0; z-index: 5; margin-top: 4px; min-width: 190px; display: flex; flex-direction: column; padding: 4px; background: var(--paper); border: 1px solid var(--hair); border-radius: 9px; box-shadow: 0 10px 30px #0003 }
.md-imgmenu button { font: inherit; font-size: 13px; text-align: left; color: var(--ink); background: none; border: 0; border-radius: 6px; padding: 7px 10px; cursor: pointer; white-space: nowrap }
.md-imgmenu button:hover { background: var(--hair2) }
.md-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0;
  color: var(--ink2); background: none; border: 0; border-radius: 8px; cursor: pointer; transition: background .12s, color .12s }
.md-btn:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink) }
.md-btn.on { background: color-mix(in srgb, var(--accent2) 15%, transparent); color: var(--accent2) }
.md-btn:disabled { opacity: .3; cursor: default; background: none }
.md-btn :deep(svg) { display: block }
.md-body { overflow-y: auto; flex: 1 }
.md-body :deep(.ProseMirror) { padding: 20px 24px; min-height: 240px; outline: none; color: var(--ink); font-size: 16px; line-height: 1.7 }
.md-body :deep(.ProseMirror > * + *) { margin-top: .8em }
/* the app's global h1/p max-widths (atlas.css, for article layout) would clamp the
   editor's lines — headings especially wrap absurdly narrow. Let them run full width. */
.md-body :deep(.ProseMirror h1), .md-body :deep(.ProseMirror h2),
.md-body :deep(.ProseMirror h3), .md-body :deep(.ProseMirror p) { max-width: none }
.md-body :deep(.ProseMirror h1) { font-family: var(--fd); font-weight: 600; font-size: 1.7em; letter-spacing: -.02em; line-height: 1.15 }
.md-body :deep(.ProseMirror h2) { font-family: var(--fd); font-weight: 600; font-size: 1.35em; letter-spacing: -.01em }
.md-body :deep(.ProseMirror h3) { font-family: var(--fd); font-weight: 600; font-size: 1.15em }
.md-body :deep(.ProseMirror p) { margin: 0 }
.md-body :deep(.ProseMirror ul), .md-body :deep(.ProseMirror ol) { padding-left: 1.4em }
.md-body :deep(.ProseMirror li p) { margin: 0 }
.md-body :deep(.ProseMirror blockquote) { border-left: 3px solid var(--accent); margin: 0; padding-left: 16px; color: var(--ink2); font-style: italic }
.md-body :deep(.ProseMirror a) { color: var(--accent2); text-decoration: underline; text-underline-offset: 2px }
.md-body :deep(.ProseMirror code) { font-family: var(--m); font-size: .88em; background: var(--wash); border: 1px solid var(--hair); border-radius: 5px; padding: 1px 5px }
.md-body :deep(.ProseMirror pre) { font-family: var(--m); font-size: 13px; background: var(--wash); border: 1px solid var(--hair); border-radius: 10px; padding: 12px 14px; overflow-x: auto }
.md-body :deep(.ProseMirror pre code) { background: none; border: 0; padding: 0 }
.md-body :deep(.ProseMirror img) { max-width: 100%; border-radius: 8px }
/* system marks (==text=={colour}) — the reader's element colour code, as a wavy underline */
.md-body :deep(.ProseMirror .sys-hl) { text-decoration: underline wavy; text-decoration-thickness: 1.5px; text-underline-offset: 3px }
.md-body :deep(.ProseMirror .sys-hl[data-sys-hl="sun"]) { text-decoration-color: #E1A200 }
.md-body :deep(.ProseMirror .sys-hl[data-sys-hl="leaf"]) { text-decoration-color: #4CA646 }
.md-body :deep(.ProseMirror .sys-hl[data-sys-hl="sky"]) { text-decoration-color: #EFAE7A }
.md-body :deep(.ProseMirror .sys-hl[data-sys-hl="ocean"]) { text-decoration-color: #1785A0 }
.md-body :deep(.ProseMirror .sys-hl[data-sys-hl="ember"]) { text-decoration-color: #DD802F }
.md-body :deep(.ProseMirror hr) { border: 0; border-top: 1px solid var(--hair); margin: 1.2em 0 }
.md-body :deep(.ProseMirror p.is-editor-empty:first-child::before) { content: attr(data-placeholder); float: left; height: 0; color: var(--ink3); pointer-events: none }
/* the system-highlight bubble menu */
.md-hl { display: flex; align-items: center; gap: 5px; padding: 5px 7px; background: var(--paper);
  border: 1px solid var(--hair); border-radius: 11px; box-shadow: 0 8px 26px -10px #00000055 }
.md-hl-label { font-family: var(--m); font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); padding: 0 3px 0 1px }
.md-hl-sw { width: 20px; height: 20px; padding: 0; border-radius: 50%; cursor: pointer;
  background: var(--sw); border: 2px solid transparent; box-shadow: inset 0 0 0 1.5px var(--paper); transition: transform .1s }
.md-hl-sw:hover { transform: scale(1.12) }
.md-hl-sw.on { border-color: color-mix(in srgb, var(--sw) 60%, var(--ink)); box-shadow: none }
.md-hl-sep { width: 1px; align-self: stretch; margin: 2px 2px; background: var(--hair) }
.md-hl-clear { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0;
  color: var(--ink3); background: none; border: 0; border-radius: 7px; cursor: pointer }
.md-hl-clear:hover:not(:disabled) { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink) }
.md-hl-clear:disabled { opacity: .3; cursor: default }
</style>
