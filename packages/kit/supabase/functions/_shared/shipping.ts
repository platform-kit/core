/* the store's shipping rules, as the catalog carries them (src/lib/shipping.js is the rule; this
   reads its output): where it ships, what it charges a country by method */
import { of, onRefresh } from './compiled.ts'
export type Method = { level: string; label: string; plus: number; min_days: number | null; max_days: number | null }
export type Rules = { countries: string[]; default: number; overrides: Record<string, number>; methods: Method[] }
export let RULES: Rules = { countries: [], default: 0, overrides: {}, methods: [] }
onRefresh(() => { RULES = of<Record<string, any>>('catalog').shipping ?? { countries: [], default: 0, overrides: {}, methods: [] } })
export const shipsTo = (country: string) => RULES.countries.includes(String(country || '').toUpperCase())
export function ratesFor(country: string): Array<Method & { amount: number }> {
  const c = String(country || '').toUpperCase()
  if (!shipsTo(c)) return []
  const base = RULES.overrides[c] != null ? RULES.overrides[c] : RULES.default
  return RULES.methods.map((m) => ({ ...m, amount: base + (m.plus || 0) }))
}
