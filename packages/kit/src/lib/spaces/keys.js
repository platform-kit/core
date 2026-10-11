/*
 * THE KEYBOARD MAP.
 *
 * What a key press MEANS is a pure function of the event, and it lives here rather than in a
 * listener so that "does ⌘⇧A open the unread" is a test rather than a thing somebody tries. The
 * page does the acting; this only ever says what was asked for.
 *
 * Two rules that are the whole of the difficulty:
 *
 *   TYPING IS NOT A SHORTCUT. While somebody is in a text box, a bare letter is a letter. Only a
 *   combination reaches the map there, and Escape, which everywhere means "close this".
 *
 *   THE PLATFORM'S OWN KEYS ARE NOT OURS. ⌘C, ⌘V, ⌘Z, ⌘A, ⌘F and the rest keep meaning what they
 *   mean; every shortcut here carries Shift as well, which is the convention Slack, Linear and the
 *   browser's own devtools settled on for exactly this reason.
 */

/* the map, in the order a sheet should list it. `mod` is ⌘ on a Mac and Ctrl elsewhere. */
export const KEYS = [
  { command: 'unreads', mod: true, shift: true, key: 'a' },
  { command: 'threads', mod: true, shift: true, key: 't' },
  { command: 'mentions', mod: true, shift: true, key: 'm' },
  { command: 'saved', mod: true, shift: true, key: 's' },
  { command: 'dms', mod: true, shift: true, key: 'd' },
  { command: 'home', mod: true, shift: true, key: 'h' },
  { command: 'search', mod: true, key: 'k' },
  /* moving between rooms: the arrows with alt, as every list in every app does */
  { command: 'prev-room', alt: true, key: 'arrowup' },
  { command: 'next-room', alt: true, key: 'arrowdown' },
  { command: 'prev-unread', alt: true, shift: true, key: 'arrowup' },
  { command: 'next-unread', alt: true, shift: true, key: 'arrowdown' },
  { command: 'close', key: 'escape' },
  { command: 'help', key: '?' },
]

/* is the thing being typed into a place where a letter is a letter */
export const isTyping = (el) => {
  if (!el) return false
  const tag = String(el.tagName || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true
}

/*
 * What this press asks for, or null. `typing` says the caret is in a text box, in which case a
 * bare key means nothing — with Escape the one exception, because "close this" is what a person
 * expects of it wherever they are.
 */
export function commandOf(e, { typing = false } = {}) {
  if (!e) return null
  const key = String(e.key || '').toLowerCase()
  const mod = !!(e.metaKey || e.ctrlKey)
  for (const k of KEYS) {
    if (k.key !== key) continue
    if (!!k.mod !== mod) continue
    if (!!k.alt !== !!e.altKey) continue
    /* a shortcut that does not ask for shift must not fire with it, or ⌘⇧K would also be ⌘K */
    if (!!k.shift !== !!e.shiftKey) continue
    if (typing && !k.mod && !k.alt && key !== 'escape') return null
    return k.command
  }
  return null
}

/* how to write a shortcut for a person to read, in the symbols their machine uses */
export function sayKey(k, { mac = true } = {}) {
  const out = []
  if (k.mod) out.push(mac ? '⌘' : 'Ctrl')
  if (k.alt) out.push(mac ? '⌥' : 'Alt')
  if (k.shift) out.push(mac ? '⇧' : 'Shift')
  const NAMED = { arrowup: '↑', arrowdown: '↓', escape: 'Esc', '?': '?' }
  out.push(NAMED[k.key] || k.key.toUpperCase())
  return out.join(mac ? '' : '+')
}

/* the next room to move to, in the order the rail shows them, wrapping at either end. `only` is
   the rule for which rooms count — every one, or only those with something waiting. */
export function stepRoom(rooms, currentId, step, { only = null } = {}) {
  const list = (only ? rooms.filter(only) : rooms).filter(Boolean)
  if (!list.length) return null
  const at = list.findIndex((r) => r.id === currentId)
  if (at < 0) return list[step > 0 ? 0 : list.length - 1].id
  return list[(at + step + list.length) % list.length].id
}
