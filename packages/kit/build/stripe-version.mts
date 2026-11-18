/*
 * THE STRIPE API VERSION the kit calls at, read from where it is written: `STRIPE_API_VERSION` in the edge
 * functions' lib.ts (openspec: stripe-current-api). The build's own checks and the tests that call Stripe
 * directly use this, so nothing names a second version.
 */
import { readFileSync } from 'node:fs'

const LIB = new URL('../supabase/functions/_shared/lib.ts', import.meta.url)
const found = readFileSync(LIB, 'utf8').match(/export const STRIPE_API_VERSION = '([^']+)'/)?.[1]
if (!found) throw new Error('supabase/functions/_shared/lib.ts names no STRIPE_API_VERSION')
export const STRIPE_API_VERSION: string = found

/* a version's date, which is how Stripe's versions order: `2026-10-28.endive` → `2026-10-28` */
export const versionDate = (v: string | null | undefined) => String(v ?? '').slice(0, 10)
export const olderThanKit = (v: string | null | undefined) => !!v && versionDate(v) < versionDate(STRIPE_API_VERSION)
