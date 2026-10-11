/*
 * window.$chatwidget — the page-side object the support widget installs (support-api): what a page calls to drive the
 * chat it is carrying (toggle, toggleBubbleVisibility, popoutChatWindow, setUser, setCustomAttributes,
 * deleteCustomAttribute, setConversationCustomAttributes, setLabel, setLocale, reset, hasLoaded, isOpen) and the
 * events it fires (chatwidget:ready, chatwidget:on-message, chatwidget:error). **window.$chatwoot is an alias of the
 * same object**, and every event is fired under Chatwoot's name too, so a page written for Chatwoot drives this widget
 * with nothing changed. Installed on the site's own pages by the widget, and on another site by the snippet (theme
 * src/support-embed.js → /packs/js/sdk.js).
 *
 * Identity is the account, so `setUser` keeps what it is given as custom attributes on the contact and never makes a
 * name or an address an identity; the attributes reach the desk through the Client API's PATCH once the contact
 * exists (a guest exists from its first line), and are shown on the inbox's contact card.
 */
import { watch } from 'vue'
import { panelOpen, contact, thread, open, close, forget, token, booted } from './api.js'
import { url as supabaseUrl } from '../supabase.js'

let installed = null
const pending = { contact: {}, conversation: {} }
let hidden = false
/* every event under both names — ours first, Chatwoot's beside it — one detail, so a page listening for either hears it */
const fire = (name, detail) => { for (const n of [`chatwidget:${name}`, `chatwoot:${name}`]) { try { window.dispatchEvent(new CustomEvent(n, { detail })) } catch (e) { /* no window */ } } }

/* the custom attributes onto the contact through the Client API (the widget's own door), once there is a contact */
async function flush(inbox) {
  const t = token()
  if (!t || !inbox) return
  const attrs = { ...pending.contact }
  if (!Object.keys(attrs).length) return
  pending.contact = {}
  try { await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/support-api/public/api/v1/inboxes/${encodeURIComponent(inbox)}/contacts/${encodeURIComponent(t)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ custom_attributes: attrs }) }) } catch (e) { fire('error', { error: String(e && e.message || e) }) }
}

/**
 * @param {object} o  { inbox: the site's inbox identifier (its space id), bubble: (visible) => void — the launcher hidden or shown, popout: the url the panel opens on its own }
 */
export function installChatWidget(o = {}) {
  if (installed) return installed
  const api = {
    hasLoaded: true,
    get isOpen() { return panelOpen.value },
    toggle(state) { const want = state === 'open' ? true : state === 'close' ? false : !panelOpen.value; if (want) open(); else close() },
    toggleBubbleVisibility(state) { hidden = state === 'hide' ? true : state === 'show' ? false : !hidden; if (o.bubble) o.bubble(!hidden) },
    popoutChatWindow() { if (o.popout) window.open(o.popout, '_blank', 'noopener') },
    setUser(identifier, attrs = {}) { pending.contact = { ...pending.contact, identifier: identifier == null ? undefined : String(identifier), ...(attrs && typeof attrs === 'object' ? attrs : {}) }; flush(o.inbox) },
    setCustomAttributes(attrs = {}) { pending.contact = { ...pending.contact, ...(attrs && typeof attrs === 'object' ? attrs : {}) }; flush(o.inbox) },
    deleteCustomAttribute(key) { pending.contact = { ...pending.contact, [key]: null }; flush(o.inbox) },
    setConversationCustomAttributes(attrs = {}) { pending.conversation = { ...pending.conversation, ...(attrs || {}) } },
    deleteConversationCustomAttribute(key) { pending.conversation = { ...pending.conversation, [key]: null } },
    setLabel() {}, removeLabel() {}, setLocale() {},
    reset() { forget(); pending.contact = {}; pending.conversation = {} },
  }
  /* the object is ours; Chatwoot's name is the same object, never a copy — a page holding either drives one widget */
  window.$chatwidget = api
  window.$chatwoot = api
  installed = api
  /* the events: ready once the widget has booted, a message whenever the open thread grows */
  const ready = () => fire('ready', {})
  if (booted.value) ready(); else { const stop = watch(booted, (b) => { if (b) { ready(); stop() } }) }
  let seen = 0
  watch(() => thread.messages.length, (n) => { if (n > seen && seen) fire('on-message', { message: thread.messages[n - 1] }); seen = n })
  watch(contact, () => flush(o.inbox))
  return api
}
