export const DEFAULT_USAGE_UNIT = 'credits'

const normalized = (value) => String(value || '').trim()

export function resolveUsageUnit(offerUnit, eventUnit, fallback = DEFAULT_USAGE_UNIT) {
  return normalized(offerUnit) || normalized(eventUnit) || normalized(fallback) || DEFAULT_USAGE_UNIT
}
