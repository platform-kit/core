/*
 * THE FIVE SHAPES, as drawing and nothing else.
 *
 * Lifted out of the component on purpose. A shape that lives inside a `.vue` can only be looked
 * at by mounting an app, and a thing that is hard to look at is a thing that gets reported
 * without being looked at — which this project has a rule against for exactly that reason. Here
 * it is a function over a 2D context, so all twenty combinations of shape and state can be drawn
 * side by side in a headless browser and read.
 *
 * It also puts the arithmetic where the rest of this project keeps it: `lib` decides, the
 * component shows.
 *
 * WHOSE TURN IT IS, IN FOUR SIGNALS AT ONCE, because colour alone cannot carry it — not for
 * somebody colour-blind, not on a monochrome display, not at the edge of vision:
 *
 *   DIRECTION  the person draws INWARD, the assistant OUTWARD. The signal that survives
 *              everything else, including being printed in grey.
 *   WEIGHT     the person is an outline; the assistant is filled.
 *   SCALE      the assistant occupies more room than the person ever does.
 *   COLOUR     the person is ink, the assistant the look's accent. The fourth signal, never the
 *              only one.
 */
export const SHAPES = ['aura', 'wave', 'radial', 'grid', 'bar']

/* `paint` is { accent, ink, soft } read off the element, so no colour is decided here */
export function paintShape(ctx, { shape = 'aura', state = 'listening', w, h, level = 0, live = null, at = 0, paint = {}, still = false }) {
  const them = live === 'them'
  const me = live === 'me'
  const out = them ? 1 : me ? -1 : 0
  const filled = them
  const scale = them ? 1 : me ? 0.66 : 0.8
  /*
   * NOBODY IS SPEAKING is not a reason to be invisible. The idle and thinking states used the
   * look's accent BACKGROUND token, which is a tint meant to sit behind text — as a stroke on a
   * dark ground it came out as nothing at all, and the state a person spends the most time
   * looking at was the one they could not see. The colour roles only have to tell the two
   * speakers apart, and while neither is speaking there is nothing to tell apart, so the idle
   * shape takes the neutral ink and is legible.
   */
  const colour = them ? paint.accent : me ? paint.ink : (paint.ink || paint.soft)
  const L = still ? 0.35 : level
  /*
   * CONNECTING AND THINKING BOTH HAVE NOBODY SPEAKING, so neither has a voice to draw and without
   * this they look the same — which is useless, because they mean different things to the person
   * waiting: one is "not yet", the other is "any moment". They are told apart by RHYTHM and by
   * COMPLETENESS, not by colour:
   *   connecting  slow, and deliberately INCOMPLETE — part of the shape is missing, which is what
   *               "not joined up yet" looks like
   *   thinking    quicker, whole, and turning over
   */
  const pace = state === 'connecting' ? 0.45 : state === 'thinking' ? 1.6 : 1
  const whole = state === 'connecting' ? 0.6 : 1
  at = at * pace
  ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineCap = 'round'
  const props = { shape }

  ctx.strokeStyle = paint; ctx.fillStyle = paint; ctx.lineCap = 'round'
  const cx = w / 2, cy = h / 2
  const span = Math.min(w, h)

  if (props.shape === 'wave') {
    ctx.lineWidth = filled ? 3 : 1.5
    const amp = h * 0.34 * L * scale
    ctx.beginPath()
    for (let x = 0; x <= w * whole; x += 2) {
      const t = x / w
      /* inward: the wave collapses toward the centre line; outward: it opens from it */
      const envelope = out >= 0 ? Math.sin(t * Math.PI) : 1 - Math.sin(t * Math.PI) * 0.6
      const y = cy + Math.sin(t * 12 + at / 180 * (out || 1)) * amp * envelope
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    if (filled) { ctx.lineTo(w, cy); ctx.lineTo(0, cy); ctx.closePath(); ctx.globalAlpha = 0.45; ctx.fill(); ctx.globalAlpha = 1 }
    ctx.stroke()
  } else if (props.shape === 'bar') {
    /* the box is w wide and the bars have to fit in it: with gap = w/n the last bar's x plus its
       own width ran past the edge, so every bar was drawn a quarter of a gap too far right and
       the final one was cut in half */
    const n = 32, gap = w / (n + 1)
    for (let i = 0; i < Math.ceil(n * whole); i++) {
      const t = i / (n - 1)
      const envelope = 0.4 + 0.6 * Math.sin(t * Math.PI)
      const bar = Math.max(2, h * 0.78 * L * scale * envelope * (0.55 + 0.45 * Math.sin(at / 150 + i * 0.7)))
      const x = gap * 0.5 + i * gap + gap * 0.25, bw = Math.max(2, gap * 0.5)
      /* the assistant's bars open from the centre; the person's rise from the floor, inward */
      if (out >= 0) ctx.fillRect(x, cy - bar / 2, bw, bar)
      else { ctx.globalAlpha = 0.9; ctx.fillRect(x, h - bar, bw, bar); ctx.globalAlpha = 1 }
    }
  } else if (props.shape === 'grid') {
    const n = 6, step = span / (n + 1)
    for (let r = 0; r < Math.ceil(n * whole); r++) for (let c = 0; c < n; c++) {
      const d = Math.hypot(r - (n - 1) / 2, c - (n - 1) / 2) / n
      /* the ripple runs out from the centre for the assistant and in from the edges for the person */
      const phase = out >= 0 ? at / 200 - d * 6 : at / 200 + d * 6
      /* THE FLOOR IS 0.08 OF NOTHING ON A DARK GROUND. A state nobody can see is a state that is
         not being shown, and the grid was the one shape where connecting and thinking vanished
         into a dark background entirely — the arithmetic was right and the pixels were blank. */
      const a = Math.max(0.3, L * scale * (out >= 0 ? 1 - d : d + 0.2) * (0.6 + 0.4 * Math.sin(phase)))
      ctx.globalAlpha = Math.min(1, a)
      const s = step * 0.4 * (filled ? 1 : 0.7)
      const x = cx + (c - (n - 1) / 2) * step - s / 2, y = cy + (r - (n - 1) / 2) * step - s / 2
      filled ? ctx.fillRect(x, y, s, s) : ctx.strokeRect(x, y, s, s)
    }
    ctx.globalAlpha = 1
  } else if (props.shape === 'radial') {
    const n = Math.ceil(48 * whole), base = span * 0.22 * (them ? 1 : 0.8)
    ctx.lineWidth = filled ? 3 : 1.5
    for (let i = 0; i < n; i++) {
      const a = (i / Math.ceil(48 * whole)) * Math.PI * 2 * whole
      const reach = span * 0.22 * L * scale * (0.5 + 0.5 * Math.sin(at / 160 + i * 0.5))
      /* spokes grow outward from the ring, or inward toward the middle */
      const r0 = out >= 0 ? base : base - reach
      const r1 = out >= 0 ? base + reach : base
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
      ctx.stroke()
    }
  } else {
    /*
     * AURA — AND IT IS AN AURA AT REST, WHICH IS MOST OF THE TIME.
     *
     * The bloom used to be drawn only while the ASSISTANT was speaking; every other state got a
     * ring that grew and shrank. That is backwards: a surface is idle, listening or thinking far
     * more of the time than it is talking, so the one face nobody designed was the one almost
     * everybody saw — and when the speech endpoint failed and nothing ever spoke, the bloom was
     * never drawn at all and the whole shape was "a ring that scales".
     *
     * So the bloom is unconditional. What the four signals change is its SIZE, its COLOUR, its
     * WEIGHT and which way it moves — never whether it exists:
     *
     *   the assistant   wide, in the accent, with a solid core, breathing OUTWARD
     *   the person      tighter, in ink, hollow, with a ring that closes INWARD as they get
     *                   louder — the direction signal, now drawn over a bloom rather than alone
     *   neither         between the two, turning slowly over, whole when thinking and broken
     *                   when still connecting
     */
    /*
     * THE WHOLE THING FITS IN THE BOX. These numbers are not taste: the outermost disc is
     * `open × (1 + halo × spread)` and the loudest moment multiplies `open` again, so a halo of
     * four at 0.62 reached 0.82 of the span as a RADIUS and the bloom was clipped into a square
     * by the edge of the canvas. Kept under 0.46 of the span at full level, with the breathing
     * on top of that.
     */
    const base = span * 0.15 * scale
    const breathe = still ? 0 : Math.sin(at / 900) * 0.035          /* alive while nothing happens */
    const open = base * (1 + breathe) * (filled ? (1 + 0.55 * L) : (1 + 0.18 * L))

    /* THE BLOOM: soft discs out from the middle, faintest furthest, always there */
    const halo = 3
    for (let i = halo; i >= 1; i--) {
      const spread = 0.3
      const r = open * (1 + i * spread) + (still ? 0 : Math.sin(at / 420 + i * 1.3) * open * 0.025)
      ctx.globalAlpha = (filled ? 0.13 : 0.07) * (halo + 1 - i) / halo * (0.55 + 0.45 * L)
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
    }

    if (filled) {
      /* a solid middle, because the assistant is the one that is GIVING something out */
      ctx.globalAlpha = 1
      ctx.beginPath(); ctx.arc(cx, cy, open * (0.72 + 0.2 * L), 0, Math.PI * 2); ctx.fill()
    } else {
      /* a quiet middle, so the shape has a body and the ring is not a wire on nothing */
      ctx.globalAlpha = 0.16 + 0.18 * L
      ctx.beginPath(); ctx.arc(cx, cy, open * 0.72, 0, Math.PI * 2); ctx.fill()
      /* and the ring: louder draws it IN, which is the signal that survives everything else */
      const ring = open * (1.85 - 0.55 * L)
      ctx.globalAlpha = 0.9
      ctx.lineWidth = 2.2
      ctx.beginPath(); ctx.arc(cx, cy, ring, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * whole); ctx.stroke()
      /* a second, fainter ring turning the other way: at rest this is the whole animation, and
         without it "thinking" and "listening" are the same picture */
      ctx.globalAlpha = 0.3
      ctx.lineWidth = 1.2
      const turn = still ? 0 : at / 1800
      ctx.beginPath(); ctx.arc(cx, cy, ring * 1.3, turn, turn + Math.PI * 2 * whole * 0.72); ctx.stroke()
      ctx.globalAlpha = 1
    }
  }
}
