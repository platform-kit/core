/*
 * What a session records on arrival, and nothing more: the UTM tags on the landing address, the device
 * class, the browser and system families (families only, never versions), the time zone and the language.
 * Pure — takes what it needs as arguments, so the build's test can run it on fixed addresses and user agents
 * and the browser hands it its own. No IP, no screen, no plugins, no fingerprint: a dashboard reads channels,
 * campaigns, devices and hours from this and needs nothing finer. The channel a session belongs to is decided
 * once, in the database (channel_of in 30-analytics.sql), from the referrer and these tags.
 */
const UTM = ['source', 'medium', 'campaign', 'term', 'content']

/* the five tags off an address (a search string or a whole url); absent → no `utm` at all */
export function utmOf(address) {
  let q = ''
  try { q = new URL(String(address || ''), 'http://x').search } catch (e) { q = String(address || '') }
  const p = new URLSearchParams(q.startsWith('?') ? q : '?' + q)
  const out = {}
  for (const k of UTM) { const v = (p.get('utm_' + k) || '').trim().slice(0, 120); if (v) out[k] = v.toLowerCase() }
  return Object.keys(out).length ? out : null
}

/* the browser family, from the user agent — the six most people use, then `other` */
export function browserOf(ua) {
  const s = String(ua || '')
  if (/Edg(e|A|iOS)?\//.test(s)) return 'edge'
  if (/SamsungBrowser\//.test(s)) return 'samsung'
  if (/OPR\/|Opera/.test(s)) return 'opera'
  if (/Firefox\/|FxiOS\//.test(s)) return 'firefox'
  if (/CriOS\/|Chrome\/|Chromium\//.test(s)) return 'chrome'
  if (/Safari\//.test(s) && /Version\//.test(s)) return 'safari'
  if (/Safari\//.test(s) && /(iPhone|iPad|Macintosh)/.test(s)) return 'safari'
  return 'other'
}

/* the system family */
export function osOf(ua) {
  const s = String(ua || '')
  if (/iPhone|iPad|iPod/.test(s)) return 'ios'
  if (/Android/.test(s)) return 'android'
  if (/Windows/.test(s)) return 'windows'
  if (/Macintosh|Mac OS X/.test(s)) return 'mac'
  if (/CrOS/.test(s)) return 'chromeos'
  if (/Linux|X11/.test(s)) return 'linux'
  return 'other'
}

/* the device class: a coarse pointer (a touch screen) is a phone, or a tablet when it is wide or says so */
export function deviceOf(ua, { coarse = null, width = null } = {}) {
  const s = String(ua || '')
  const tablet = /iPad|Tablet|PlayBook|Silk/.test(s) || (/Android/.test(s) && !/Mobile/.test(s)) || (/Macintosh/.test(s) && coarse === true)
  if (tablet) return 'tablet'
  const phone = /iPhone|iPod|Android.*Mobile|Windows Phone|Mobile/.test(s) || (coarse === true && (width == null || width < 900))
  if (phone) return 'phone'
  if (coarse === true) return 'tablet'
  return 'desktop'
}

/* everything at once, from a browser's own facts (or a test's) */
export function arrival({ address, ua, coarse, width, tz, lang } = {}) {
  const out = { device: deviceOf(ua, { coarse, width }), browser: browserOf(ua), os: osOf(ua) }
  const utm = utmOf(address)
  if (utm) out.utm = utm
  if (tz) out.tz = String(tz).slice(0, 64)
  if (lang) out.lang = String(lang).slice(0, 16)
  return out
}

/* the browser's own facts */
export function arrivalHere() {
  if (typeof window === 'undefined') return {}
  let coarse = null, tz = '', lang = ''
  try { coarse = window.matchMedia('(pointer: coarse)').matches } catch (e) { /* none */ }
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch (e) { /* none */ }
  try { lang = navigator.language || '' } catch (e) { /* none */ }
  return arrival({ address: location.href, ua: navigator.userAgent, coarse, width: window.innerWidth, tz, lang })
}
