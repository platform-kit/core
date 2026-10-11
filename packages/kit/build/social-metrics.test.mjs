import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  METRICS_DAILY_MS,
  METRICS_HOURLY_MS,
  METRICS_RECENT_WINDOW_MS,
  hasSocialCapability,
  metricsCadenceMs,
  metricsDeliveryEligible,
  nextMetricsFetchAt,
  normalizePostMetrics,
} from '../supabase/functions/_shared/social/metrics.mjs'

const published = Date.parse('2026-10-01T00:00:00.000Z')
const hour = METRICS_HOURLY_MS

assert.equal(metricsCadenceMs(new Date(published).toISOString(), published + 71 * hour), hour)
assert.equal(metricsCadenceMs(new Date(published).toISOString(), published + METRICS_RECENT_WINDOW_MS), METRICS_DAILY_MS)
assert.equal(
  nextMetricsFetchAt(new Date(published).toISOString(), published + 71.5 * hour),
  new Date(published + METRICS_RECENT_WINDOW_MS).toISOString(),
  'the final hourly check lands on the exact 72-hour boundary',
)
assert.equal(
  nextMetricsFetchAt(new Date(published).toISOString(), published + METRICS_RECENT_WINDOW_MS),
  new Date(published + METRICS_RECENT_WINDOW_MS + METRICS_DAILY_MS).toISOString(),
)
assert.equal(
  metricsDeliveryEligible({
    status: 'published',
    provider_post_id: 'provider-post',
    metrics_state: 'pending',
    metrics_next_fetch_at: null,
  }, published),
  true,
  'an existing published post with no schedule is eligible for its initial backfill',
)
assert.equal(metricsDeliveryEligible({ status: 'scheduled', provider_post_id: 'provider-post' }, published), false)
assert.equal(metricsDeliveryEligible({ status: 'published', provider_post_id: null }, published), false)
assert.equal(
  metricsDeliveryEligible({
    status: 'published',
    provider_post_id: 'provider-post',
    metrics_state: 'unsupported',
  }, published),
  false,
)
assert.equal(
  metricsDeliveryEligible({
    status: 'published',
    provider_post_id: 'provider-post',
    metrics_next_fetch_at: new Date(published + hour).toISOString(),
  }, published),
  false,
)
assert.equal(
  metricsDeliveryEligible({
    status: 'published',
    provider_post_id: 'provider-post',
    metrics_lease_until: new Date(published + 5 * 60 * 1000).toISOString(),
  }, published),
  false,
  'a live lease prevents duplicate collection',
)

const manifest = {
  capabilities: [
    { operation: 'analytics.read', platform: 'instagram', availability: 'available' },
    { operation: 'analytics.account.read', platform: '*', availability: 'available' },
  ],
}
assert.equal(hasSocialCapability(manifest, 'analytics.read', 'instagram'), true)
assert.equal(hasSocialCapability(manifest, 'analytics.read', 'reddit'), false)
assert.equal(
  hasSocialCapability(
    { capabilities: [{ operation: 'analytics.read', platform: 'reddit', availability: 'unsupported-by-platform' }] },
    'analytics.read',
    'reddit',
  ),
  false,
)

assert.deepEqual(normalizePostMetrics({
  data: {
    views: '12',
    likes: { value: 3 },
    comments: 1,
    saves: 4,
  },
}), {
  views: 12,
  reads: null,
  likes: 3,
  comments: 1,
  providerMetrics: { data: { views: '12', likes: { value: 3 }, comments: 1, saves: 4 } },
})
assert.deepEqual(
  (({ reads, comments }) => ({ reads, comments }))(
    normalizePostMetrics({
      metrics: [
        { name: 'reads', total_value: { value: '21' } },
        { name: 'comments', value: 2 },
      ],
    }),
  ),
  { reads: 21, comments: 2 },
  'provider-supported equivalent counters normalize from named metric arrays',
)
assert.equal(normalizePostMetrics({ views: -1 }).views, null, 'negative provider counters are not persisted as common totals')
assert.throws(() => normalizePostMetrics(null), /provider returned/i)
assert.throws(() => normalizePostMetrics({ payload: 'x'.repeat(33 * 1024) }), { code: 'metrics_response_too_large' })

const schema = fs.readFileSync(new URL('../supabase/schemas/99-social.sql', import.meta.url), 'utf8')
const kitModules = fs.readFileSync(new URL('./modules/kit.mjs', import.meta.url), 'utf8')
const assembledData = fs.readFileSync('supabase/data.sql', 'utf8')
const worker = fs.readFileSync(new URL('../supabase/functions/social-publish/index.ts', import.meta.url), 'utf8')
const socialApi = fs.readFileSync(new URL('../supabase/functions/social/index.ts', import.meta.url), 'utf8')
assert.match(schema, /CREATE TABLE IF NOT EXISTS "public"\."social_metrics_snapshots"/)
assert.match(schema, /"metrics_last_fetched_at" timestamp with time zone/)
assert.match(schema, /"metrics_next_fetch_at" timestamp with time zone/)
assert.match(schema, /social_deliveries_metrics_state_check/)
assert.match(schema, /for update skip locked[\s\S]*metrics_lease_token = gen_random_uuid/i)
assert.match(schema, /insert into public\.social_metrics_snapshots/i)
assert.match(schema, /metrics_state = case p_outcome[\s\S]*'unsupported' then null/i)
assert.match(schema, /least\(now\(\) \+ interval '1 hour', d\.published_at \+ interval '72 hours'\)/i)
assert.match(schema, /now\(\) \+ interval '1 day'/i)
assert.match(schema, /social_metrics_snapshots_publisher_read[\s\S]*social_can"\("account_id", 'view_results'\)/i)
assert.match(schema, /social_claim_metrics[\s\S]*grant execute[\s\S]*"service_role"/i)
assert.match(
  kitModules,
  /\{\s*name:\s*'social-metrics',\s*schedule:\s*'\*\/10 \* \* \* \*',\s*command:\s*'select public\.run_social_metrics\(\)'\s*\}/,
)
assert.match(
  assembledData,
  /PERFORM cron\.schedule\('social-metrics', '\*\/10 \* \* \* \*', 'select public\.run_social_metrics\(\)'\)/,
)
assert.match(worker, /if \(body\.action === 'collect_metrics'\) return collectDueMetrics\(\)/)
assert.match(worker, /hasSocialCapability[\s\S]*'analytics\.read'/)
assert.match(worker, /p_provider_metrics: metrics\?\.providerMetrics/)
assert.match(socialApi, /metrics_state, metrics_last_fetched_at, metrics_next_fetch_at, metrics_attempt_count, metrics_last_error_code, metrics_last_error/)
assert.match(schema, /CREATE POLICY "social_metrics_snapshots_publisher_read"[\s\S]*social_can"\("account_id", 'view_results'\)/)
assert.match(schema, /GRANT SELECT ON TABLE "public"\."social_metrics_snapshots" TO "authenticated"/)

console.log('social-metrics: cadence boundary, eligibility, capability gating, normalization and Supabase persistence declarations passed')
