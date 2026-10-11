/*
 * One toast at a time, for the whole site: a title, a line, a way to dismiss,
 * and at most one action — { label, run } — for the thing the reader can do
 * about it. toast({ title, body, dismiss, action, kind, ms }) shows it (ms 0
 * keeps it until dismissed; kind 'lock' | 'warn' | 'ok' | 'note' picks the icon);
 * SiteToast.vue draws it. The words come from whoever calls, out of the
 * strings files — nothing here is reader-facing on its own.
 */
import { ref } from 'vue'

export const current = ref(null)
let timer = null

export function toast(t) {
  clearTimeout(timer)
  current.value = { title: t.title || '', body: t.body || '', dismiss: t.dismiss || '', action: t.action || null, kind: t.kind || 'note', at: Date.now() }
  const ms = t.ms == null ? 8000 : t.ms
  if (ms > 0) timer = setTimeout(hide, ms)
}
export function hide() { clearTimeout(timer); current.value = null }
/* the action, then the toast goes */
export async function act() { const a = current.value && current.value.action; hide(); if (a && a.run) await a.run() }
