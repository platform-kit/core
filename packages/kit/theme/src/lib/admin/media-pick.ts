/*
 * The picker every file field opens: one reactive request the host (MediaPicker.vue, mounted once by the admin) shows
 * as the library in a modal, answered with the chosen file or nothing. A field asks with `pick({ pictures })` and
 * takes the served address (`url`: /uploads/…, /…, or the bucket's own in cloud mode) — never a path relative to a
 * record. `useMediaPick()` is the composable the fields call; `pickState` is the host's side.
 */
import { shallowRef } from 'vue'

export const pickState = shallowRef<any>(null)   /* { pictures, resolve } while a request is open */

export function pickMedia({ pictures = true } = {}) {
  if (pickState.value) (pickState.value as any).resolve(null)   /* a second ask closes the first with nothing */
  return new Promise((resolve) => { pickState.value = { pictures, resolve } })
}
/* the host answers */
export function answerPick(file: any) { const s: any = pickState.value; pickState.value = null; if (s) s.resolve(file || null) }

export function useMediaPick() {
  /* `kind`: 'image' (pictures only) or 'file' (anything) — the address of the chosen file, or '' when closed */
  const choose = async (kind = 'image') => { const f: any = await pickMedia({ pictures: kind !== 'file' }); return f ? f.url : '' }
  return { choose, pickMedia }
}
