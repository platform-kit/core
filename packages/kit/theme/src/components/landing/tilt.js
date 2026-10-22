/*
 * v-tilt: a card that turns toward the pointer — a few degrees of rotateX/rotateY from where the
 * pointer is on it, back to flat when it leaves; a highlight follows (--mx/--my for a ::before to
 * read). Pointer devices only (a touch never tilts), still under reduced motion. One directive for
 * every card the page builder offers a tilt on.
 */
const rm = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const fine = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches
export const vTilt = {
  mounted(el, { value }) {
    if (value === false || rm() || !fine()) return
    const max = typeof value === 'number' ? value : 7
    el.classList.add('lptilted')
    const move = (e) => { const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; el.style.setProperty('--rx', (-y * max) + 'deg'); el.style.setProperty('--ry', (x * max) + 'deg'); el.style.setProperty('--mx', ((x + .5) * 100) + '%'); el.style.setProperty('--my', ((y + .5) * 100) + '%') }
    const leave = () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg') }
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave)
    el.__tilt = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave) }
  },
  unmounted(el) { el.__tilt && el.__tilt() },
}
