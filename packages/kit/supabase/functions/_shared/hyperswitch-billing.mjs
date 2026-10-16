export function paymentPeriodEnd(start, interval = 'month') {
  if (!Number.isSafeInteger(start) || start < 0) {
    throw new TypeError('payment billing period start must be a non-negative epoch second')
  }
  if (interval === 'day' || interval === 'week') {
    return start + (interval === 'week' ? 7 : 1) * 86400
  }
  if (interval !== 'month' && interval !== 'year') {
    throw new TypeError(`unsupported payment billing interval "${interval}"`)
  }
  const date = new Date(start * 1000)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  if (interval === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1)
  else date.setUTCMonth(date.getUTCMonth() + 1)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return Math.floor(date.getTime() / 1000)
}

export function meteredUsageAmountMinor(numerator, currency) {
  let value
  try {
    value = BigInt(numerator)
  } catch {
    throw new TypeError('metered usage amount numerator must be a non-negative integer')
  }
  if (value < 0n) throw new TypeError('metered usage amount numerator must be a non-negative integer')

  let fractionDigits
  try {
    fractionDigits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).resolvedOptions().maximumFractionDigits
  } catch {
    throw new TypeError(`cannot determine the minor-unit scale for currency ${currency}`)
  }
  const minorUnitsPerMajor = 10n ** BigInt(fractionDigits)
  const denominator = 1_000_000_000_000n
  const amount = (value * minorUnitsPerMajor + denominator / 2n) / denominator
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('metered usage amount exceeds the safe payment amount range')
  }
  return Number(amount)
}
