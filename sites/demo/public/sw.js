/*
 * The site's service worker, for web push alone: a notification the push function sent —
 * { title, body, url, tag, topic } — is shown, unless it is about the support desk and a desk is
 * open and focused in this browser already (the inbox is telling them itself); a click opens or
 * focuses the page it points at. No caching, no offline: nothing else lives here.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let n = {}
  try { n = e.data ? e.data.json() : {} } catch (err) { n = { title: e.data ? e.data.text() : '' } }
  const show = async () => {
    if (String(n.topic || '').startsWith('support')) {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (all.some((c) => c.focused && /\/admin(\/|$)/.test(new URL(c.url).pathname))) return
    }
    await self.registration.showNotification(n.title || 'PlatformKit Demo', { body: n.body || '', tag: n.tag || undefined, data: { url: n.url || '/admin' }, icon: '/icons/icon-192.png', badge: '/icons/icon-48.png', renotify: !!n.tag })
  }
  e.waitUntil(show())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL((e.notification.data && e.notification.data.url) || '/admin', self.location.origin).href
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const same = all.find((c) => c.url === url) || all.find((c) => /\/admin(\/|$)/.test(new URL(c.url).pathname))
    if (same) { await same.focus(); if (same.url !== url && 'navigate' in same) await same.navigate(url); return }
    await self.clients.openWindow(url)
  })())
})
