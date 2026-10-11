/*
 * WHAT LIGHTS UP WHEN NOBODY IS SPEAKING.
 *
 * The thing I had wrong about these shapes for three attempts: their non-speaking states are not
 * a level mapped onto a shape with a floor under it. They are CHOREOGRAPHY — a list of which
 * elements are lit, stepped at a fixed interval. Connecting traces a path, listening blinks the
 * middle against nothing, thinking sweeps. That is why the originals read as deliberate and a
 * shape driven by a floor reads as a thing idling.
 *
 * The sequences follow LiveKit's components-js (Apache 2.0) — the same patterns, written for a
 * canvas rather than for a row of divs. Their aura is NOT here and never will be: it carries its
 * own Polyform Non-Resale licence, which forbids use in anything sold.
 *
 * Pure: a state and a count in, a list of lit indices out. No timers, no DOM, no audio.
 */

/* a pair closing in from both ends — what "joining up" looks like on a row */
export function connectingRow(n) {
  const out = []
  for (let x = 0; x < n; x++) out.push([x, n - 1 - x])
  return out
}

/* the middle, then nothing: a slow blink rather than a shimmer */
export function listeningRow(n) {
  return [[Math.floor(n / 2)], []]
}

/* across and back, which is the only one of these that reads as effort */
export function thinkingRow(n) {
  const out = []
  for (let x = 0; x < n; x++) out.push([x])
  for (let x = n - 1; x >= 0; x--) out.push([x])
  return out
}

/* two opposite spokes turning: the same step on a ring rather than a row */
export function connectingRing(n) {
  const half = Math.floor(n / 2)
  const out = []
  for (let x = 0; x < n; x++) out.push([x, (x + half) % n])
  return out
}

/*
 * EVENLY SPACED GROUPS, so what turns is a pattern rather than one mark. The spacing is the
 * largest divisor that leaves a group worth seeing — their trick, and it is a good one: it keeps
 * the figure symmetrical for any number of spokes instead of only for the convenient ones.
 */
export function listeningRing(n) {
  const gcdUnder = (max) => {
    const gcd = (a, b) => (b ? gcd(b, a % b) : a)
    for (let i = max; i >= 1; i--) if (gcd(n, i) === i) return i
    return 1
  }
  const parts = n > 8 ? n / gcdUnder(4) : gcdUnder(2)
  return Array.from({ length: parts }, (_, i) =>
    Array.from({ length: Math.floor(n / parts) }, (_, j) => j * parts + i))
}

/* the ring of a square, traced: the grid's way of saying "joining up" */
export function connectingSquare(rows, cols, radius) {
  const mid = Math.floor(rows / 2)
  const x0 = Math.max(0, mid - radius), y0 = Math.max(0, mid - radius)
  const x1 = cols - 1 - x0, y1 = Math.min(rows - 1, mid + radius)
  const out = []
  for (let x = x0; x <= x1; x++) out.push([x, y0])
  for (let y = y0 + 1; y <= y1; y++) out.push([x1, y])
  for (let x = x1 - 1; x >= x0; x--) out.push([x, y1])
  for (let y = y1 - 1; y > y0; y--) out.push([x0, y])
  return out.map((c) => [c])
}

/*
 * THE WHOLE CHOREOGRAPHY, by shape and state. `speaking` is null and that is the point: there is
 * nothing to choreograph when there is a voice, because the voice is the choreography.
 */
export function stepsOf(shape, state, n, rows = 6) {
  if (state === 'speaking') return null
  const ring = shape === 'radial'
  const grid = shape === 'grid'
  if (state === 'connecting') {
    return grid ? connectingSquare(rows, rows, Math.floor(rows / 2) - 1) : ring ? connectingRing(n) : connectingRow(n)
  }
  if (state === 'thinking') return grid ? thinkingRow(rows).map((s) => s) : ring ? listeningRing(n) : listeningRow(n)
  return ring ? listeningRing(n) : listeningRow(n)
}

/* which step the clock is on; the sequence repeats for ever */
export function stepAt(seq, at, every = 100) {
  if (!seq || !seq.length) return null
  return seq[Math.floor(at / every) % seq.length]
}

/*
 * HOW BRIGHT EACH ELEMENT IS RIGHT NOW. Lit or not while a sequence is running; the band's own
 * loudness while somebody is speaking. An unlit element is NOT invisible — it sits at a tenth,
 * as theirs do, so the shape is always a whole shape and the lighting is what moves.
 */
export const DIM = 0.1
export function litness(i, { step = null, bands = null, floor = DIM } = {}) {
  if (step) return step.includes(i) ? 1 : floor
  if (bands && bands.length) return Math.max(floor, bands[i % bands.length])
  return floor
}
