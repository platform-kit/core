/*
 * Where the store ships and what it charges — one rule, shared by the storefront (the
 * country the buyer chooses, the price they see) and the checkout function (the rates the
 * session offers), from the storefront's `shipping` settings:
 *
 *   shipping:
 *     countries: [US, CA, GB]        # a whitelist of ISO codes — or
 *     exclude: [RU, KP]              # everywhere Stripe ships but these
 *     default: 15                    # dollars, anywhere not overridden
 *     overrides: { US: 5, CA: 10 }   # per country
 *     methods:                       # the ways to send it; the first is the default
 *       - level: MAIL            label: Standard   days: 5-10
 *       - level: PRIORITY_MAIL   label: Priority   plus: 6   days: 3-6
 *
 * `level` is the printer's shipping level for a printed book (MAIL · PRIORITY_MAIL · GROUND ·
 * EXPEDITED · EXPRESS); `plus` is dollars over the country's price for that method. A method
 * with no `plus` costs the country's price. Pure: no environment, no imports.
 */

/* every country Stripe Checkout can ship to (its allowed_countries enum) */
export const STRIPE_COUNTRIES = 'AC AD AE AF AG AI AL AM AO AQ AR AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CV CW CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IS IT JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MK ML MM MN MO MQ MR MS MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PY QA RE RO RS RU RW SA SB SC SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SZ TA TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VN VU WF WS XK YE YT ZA ZM ZW ZZ'.split(' ')
/* the ways a book may ship, in our words — each printer maps them to its own (printers/*.js `levels`);
   a storefront from before names Lulu's, which are read as ours */
export const LEVELS = ['standard', 'priority', 'express']
const LEGACY = { MAIL: 'standard', GROUND: 'standard', GROUND_HD: 'standard', GROUND_BUS: 'standard', PRIORITY_MAIL: 'priority', EXPEDITED: 'express', EXPRESS: 'express' }
export const levelOf = (v) => { const c = String(v || '').trim(); return LEVELS.includes(c.toLowerCase()) ? c.toLowerCase() : LEGACY[c.toUpperCase()] || c }

/* the settings as written → { countries, default, overrides, methods }, every amount in cents;
   `issues` names what is wrong */
export function shippingRules(s = {}) {
  const issues = []
  const code = (c) => String(c || '').trim().toUpperCase()
  const list = (v) => (Array.isArray(v) ? v.map(code).filter(Boolean) : [])
  let countries
  if (list(s.countries).length) countries = list(s.countries).filter((c) => STRIPE_COUNTRIES.includes(c))
  else { const ex = new Set(list(s.exclude)); countries = STRIPE_COUNTRIES.filter((c) => c !== 'ZZ' && !ex.has(c)) }
  for (const c of list(s.countries)) if (!STRIPE_COUNTRIES.includes(c)) issues.push(`"${c}" is not a country code Checkout ships to`)
  const cents = (v) => Math.round(Number(v) * 100)
  if (!(Number(s.default) >= 0)) issues.push('shipping needs a default price')
  const overrides = {}
  for (const [c, v] of Object.entries(s.overrides || {})) { if (!(Number(v) >= 0)) issues.push(`the override for ${c} is not a price`); else overrides[code(c)] = cents(v) }
  const methods = (Array.isArray(s.methods) && s.methods.length ? s.methods : [{ level: 'standard', label: 'Standard' }]).map((m, i) => {
    const level = levelOf(m.level || 'standard')
    if (!LEVELS.includes(level)) issues.push(`method ${i + 1}: level "${m.level}" is not one of ours (${LEVELS.join(' · ')})`)
    const d = /^(\d+)\s*-\s*(\d+)$/.exec(String(m.days || ''))
    return { level, label: String(m.label || level), plus: m.plus != null ? cents(m.plus) : 0, min_days: d ? Number(d[1]) : null, max_days: d ? Number(d[2]) : null }
  })
  return { countries, default: cents(s.default), overrides, methods, issues }
}

/* what shipping to a country costs, by method — [{ level, label, amount, min_days, max_days }] */
export function ratesFor(rules, country) {
  const c = String(country || '').toUpperCase()
  if (!rules || !rules.countries.includes(c)) return []
  const base = rules.overrides[c] != null ? rules.overrides[c] : rules.default
  return rules.methods.map((m) => ({ ...m, amount: base + (m.plus || 0) }))
}
export const shipsTo = (rules, country) => !!rules && rules.countries.includes(String(country || '').toUpperCase())
