export const METRICS_HOURLY_MS = 60 * 60 * 1000
export const METRICS_DAILY_MS = 24 * METRICS_HOURLY_MS
export const METRICS_RECENT_WINDOW_MS = 72 * METRICS_HOURLY_MS
export const METRICS_MAX_PAYLOAD_BYTES = 32 * 1024

export function metricsCadenceMs(publishedAt, now = Date.now()) {
  const published = Date.parse(publishedAt)
  if (!Number.isFinite(published)) throw new TypeError('A valid publication time is required.')
  return published > now - METRICS_RECENT_WINDOW_MS ? METRICS_HOURLY_MS : METRICS_DAILY_MS
}

export function nextMetricsFetchAt(publishedAt, collectedAt = Date.now()) {
  const collected = typeof collectedAt === 'string' ? Date.parse(collectedAt) : collectedAt
  if (!Number.isFinite(collected)) throw new TypeError('A valid collection time is required.')
  const published = Date.parse(publishedAt)
  if (!Number.isFinite(published)) throw new TypeError('A valid publication time is required.')
  const hourly = collected + METRICS_HOURLY_MS
  const endOfHourlyWindow = published + METRICS_RECENT_WINDOW_MS
  return new Date(
    published > collected - METRICS_RECENT_WINDOW_MS
      ? Math.min(hourly, endOfHourlyWindow)
      : collected + METRICS_DAILY_MS,
  ).toISOString()
}

export function metricsDeliveryEligible(delivery, now = Date.now()) {
  if (!delivery || delivery.status !== 'published' || !delivery.provider_post_id) return false
  if (delivery.metrics_state === 'unsupported') return false
  const next = delivery.metrics_next_fetch_at ? Date.parse(delivery.metrics_next_fetch_at) : NaN
  const lease = delivery.metrics_lease_until ? Date.parse(delivery.metrics_lease_until) : NaN
  if (Number.isFinite(lease) && lease > now) return false
  return !Number.isFinite(next) || next <= now
}

export function hasSocialCapability(manifests, operation, platform) {
  const values = Array.isArray(manifests) ? manifests : [manifests]
  return values.some((manifest) =>
    Array.isArray(manifest?.capabilities) &&
    manifest.capabilities.some((capability) =>
      capability &&
      capability.operation === operation &&
      (capability.platform === '*' || capability.platform === platform) &&
      capability.availability === 'available',
    ),
  )
}

function scalarCount(value) {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return scalarCount(value.value ?? value.count ?? value.total_value)
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function flattenMetrics(value, output = {}, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return output
  if (Array.isArray(value)) {
    for (const item of value) flattenMetrics(item, output, depth + 1)
    return output
  }
  if (typeof value.name === 'string' && ('value' in value || 'count' in value || 'total_value' in value))
    output[value.name] = value.value ?? value.count ?? value.total_value
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === 'object') {
      if (!Array.isArray(item) && ('value' in item || 'count' in item || 'total_value' in item))
        output[key] = item.value ?? item.count ?? item.total_value
      flattenMetrics(item, output, depth + 1)
    } else if (item !== undefined) output[key] = item
  }
  return output
}

export function normalizePostMetrics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Object.assign(new Error('The provider returned an invalid metrics response.'), { code: 'metrics_response_invalid' })
  let providerMetrics
  try {
    providerMetrics = JSON.parse(JSON.stringify(value))
  } catch {
    throw Object.assign(new Error('The provider returned metrics that could not be stored.'), { code: 'metrics_response_invalid' })
  }
  const encoded = JSON.stringify(providerMetrics)
  if (new TextEncoder().encode(encoded).byteLength > METRICS_MAX_PAYLOAD_BYTES)
    throw Object.assign(new Error('The provider metrics response is too large to store.'), { code: 'metrics_response_too_large' })
  const flat = flattenMetrics(providerMetrics)
  const find = (names) => {
    for (const name of names) {
      const key = Object.keys(flat).find((candidate) => candidate.toLowerCase().replaceAll(/[-\s]/g, '_') === name)
      if (key !== undefined) {
        const count = scalarCount(flat[key])
        if (count !== null) return count
      }
    }
    return null
  }
  return {
    views: find(['views', 'view_count', 'video_views', 'video_view_count']),
    reads: find(['reads', 'read_count']),
    likes: find(['likes', 'like_count']),
    comments: find(['comments', 'comment_count']),
    providerMetrics,
  }
}
