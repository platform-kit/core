export const DEFAULT_USAGE_UNIT = 'credits'

const normalized = (value: string) => String(value || '').trim()

export function resolveUsageUnit(offerUnit: any, eventUnit?: any, fallback = DEFAULT_USAGE_UNIT) {
  return normalized(offerUnit) || normalized(eventUnit) || normalized(fallback) || DEFAULT_USAGE_UNIT
}
