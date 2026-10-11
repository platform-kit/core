/*
 * Web push for the staff, the browser's side: the service worker (public/sw.js, registered here
 * only when someone opts in — nothing else on the site needs one), the subscription the browser
 * makes against the deployment's public VAPID key (VITE_VAPID_PUBLIC_KEY), and the row it is
 * kept in (push_subscriptions, the staff's own under RLS) with the topics this browser wants.
 * The sending is the push function's, asked by the database as things happen.
 */
import { ref } from 'vue'
import { supabase, configured } from './supabase.js'
import { session } from './auth.js'

export const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''
export const TOPICS = ['support-new', 'support-message', 'users', 'purchases', 'subscriptions', 'bookings']
export const STAFF_TOPICS = ['support-new', 'support-message']
export const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!KEY && configured
export const permission = ref(typeof Notification !== 'undefined' ? Notification.permission : 'default')

const uid = () => (session.value && session.value.user && session.value.user.id) || null
const b64ToBytes = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')); return Uint8Array.from(b, (c) => c.charCodeAt(0)) }
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function registration() { return navigator.serviceWorker.register('/sw.js', { scope: '/' }) }

/* this browser's subscription, if it has one */
export async function current() {
  if (!supported()) return null
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}
/* this browser's row, if it has one */
export async function mine() {
  const sub = await current()
  if (!sub) return null
  const { data } = await supabase.from('push_subscriptions').select('*').eq('endpoint', sub.endpoint).maybeSingle()
  return data || null
}
/* every browser of the signed-in staff member */
export async function devices() {
  if (!uid()) return []
  const { data } = await supabase.from('push_subscriptions').select('id, endpoint, topics, ua, created_at, last_sent_at, failures').eq('user_id', uid()).order('created_at')
  return data || []
}

/* opt this browser in: the permission, the worker, the subscription, the row */
export async function enable(topics) {
  if (!supported() || !uid()) throw new Error('unsupported')
  const p = await Notification.requestPermission()
  permission.value = p
  if (p !== 'granted') throw new Error('denied')
  const reg = await registration()
  await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(KEY) }))
  const j = sub.toJSON()
  const row = { user_id: uid(), endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, topics, ua: navigator.userAgent.slice(0, 200) }
  const { error } = await supabase.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' })
  if (error) throw error
  return row
}
export async function setTopics(topics) {
  const sub = await current()
  if (!sub) return
  await supabase.from('push_subscriptions').update({ topics }).eq('endpoint', sub.endpoint)
}
/* opt this browser out: the row, then the subscription */
export async function disable() {
  const sub = await current()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  try { await sub.unsubscribe() } catch (e) { /* already gone */ }
}
export async function forget(id) { await supabase.from('push_subscriptions').delete().eq('id', id) }
/* one to my own browsers, to see what it looks like */
export async function test() {
  const { data, error } = await supabase.functions.invoke('push', { body: { action: 'test' } })
  if (error) throw error
  return data
}
