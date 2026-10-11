/* The #site/avatar contract: which collections a person's drawn face may come from, and which one
   somebody who has chosen nothing gets. Under Node this module answers directly; the Vite plugin
   serves the same names, so a build script and the browser draw the same face.

   THE DEFAULT IS NOT A FACE. Somebody who has not picked an avatar is given `patchwork`: a pattern,
   drawn from their own address. Every anthropomorphic collection assigns a person a face with a
   presentation — a hairstyle, a jaw, a beard — and a face nobody chose can say something about
   somebody that is not true of them. A pattern says nothing and is still theirs alone.

   The three below are what a picker offers, and the whole of what the bundle carries: DiceBear 10
   ships each style as a definition of its own, so naming three costs three and not thirty. */
import { Style } from '@dicebear/core'
import patchwork from '@dicebear/styles/patchwork.json' with { type: 'json' }
import bigSmile from '@dicebear/styles/big-smile.json' with { type: 'json' }
import personas from '@dicebear/styles/personas.json' with { type: 'json' }
import identicon from '@dicebear/styles/identicon.json' with { type: 'json' }

/* slug → style. The slug is what a profile stores, so it never changes once it is out. */
export const STYLES = {
  patchwork: new Style(patchwork),
  'big-smile': new Style(bigSmile),
  // personas: new Style(personas),
}
/* THE DEFINITIONS THEMSELVES, so a picker can ask what a style offers. DiceBear's Style wraps its
   definition behind a non-enumerable property, and a designer needs the parts by name: the
   components (the hair, the eyes, the mouth) and the colour palettes. Reading the JSON we already
   imported costs nothing and cannot drift from what is drawn, because it IS what is drawn. */
export const DEFS = { patchwork, 'big-smile': bigSmile, personas }
export const STYLE = STYLES.patchwork
/* a bot with no picture of its own gets a mark, never a face: a bot has no face to mis-state */
export const BOT_STYLE = new Style(identicon)
/* the framing and the grounds: DiceBear 10 frames each style itself, so nothing is scaled
   (a scale over 1 crops a head at the top, and a square is rounded by whatever draws it). The six pastels are DiceBear's own — a
   person gets the same one every time, which is what makes a wall of faces scannable from further
   away than a face is legible. A site passing its own options replaces these outright. */
export const OPTIONS = { backgroundColor: ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf', 'c7f0d8'] }
