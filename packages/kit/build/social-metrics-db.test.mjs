import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { localStack, serviceKey, supabaseUrl } from './tts/storage.mjs'

const url = supabaseUrl()
if (!url || !localStack()) {
  console.log('social-metrics-db: skipped — no local Supabase stack in .env')
  process.exit(0)
}

try {
  const health = await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(2_000) })
  if (!health.ok) throw new Error('local Supabase stack is not running')
} catch {
  console.log('social-metrics-db: skipped — the local Supabase stack is not running')
  process.exit(0)
}

const service = createClient(url, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data: users, error: userError } = await service.auth.admin.listUsers({ page: 1, perPage: 1 })
if (userError || !users?.users?.[0]) {
  console.log('social-metrics-db: skipped — a local Auth user is needed for isolated fixture rows')
  process.exit(0)
}

const { data: existingDue, error: dueError } = await service
  .from('social_deliveries')
  .select('id, published_at, metrics_next_fetch_at, metrics_lease_until, metrics_state')
  .eq('status', 'published')
  .not('provider_post_id', 'is', null)
  .limit(1000)
if (dueError) {
  console.log(`social-metrics-db: skipped — cannot inspect due rows (${dueError.code})`)
  process.exit(0)
}
const now = Date.now()
const otherDue = (existingDue || []).filter((row) => {
  const next = row.metrics_next_fetch_at ? Date.parse(row.metrics_next_fetch_at) : NaN
  const lease = row.metrics_lease_until ? Date.parse(row.metrics_lease_until) : NaN
  return row.metrics_state !== 'unsupported' &&
    (!Number.isFinite(next) || next <= now) &&
    (!Number.isFinite(lease) || lease <= now)
})
if ((existingDue || []).length >= 1000 || otherDue.length) {
  console.log('social-metrics-db: skipped — unrelated published posts are due; refusing to claim them')
  process.exit(0)
}

const accountId = randomUUID()
const postId = randomUUID()
const recentDeliveryId = randomUUID()
const unsupportedPostId = randomUUID()
const unsupportedDeliveryId = randomUUID()
const failedPostId = randomUUID()
const failedDeliveryId = randomUUID()
const authorId = users.users[0].id
const publishedAt = new Date(Date.now() - 71 * 60 * 60 * 1000).toISOString()

async function insert(table, values) {
  const { error } = await service.from(table).insert(values)
  if (error) throw new Error(`social-metrics-db: insert ${table} failed (${error.code})`)
}

async function expectRow(table, columns, id) {
  const { data, error } = await service.from(table).select(columns).eq('id', id).single()
  if (error) throw new Error(`social-metrics-db: read ${table} failed (${error.code})`)
  return data
}

try {
  await insert('social_accounts', {
    id: accountId,
    provider_id: 'reddit',
    external_id: `social-metrics-${accountId}`,
    name: 'Metrics test account',
    username: 'metrics-test',
    connected_by: authorId,
  })
  await insert('social_posts', {
    id: postId,
    body: 'Metrics snapshot persistence fixture',
    created_by: authorId,
  })
  await insert('social_deliveries', {
    id: recentDeliveryId,
    post_id: postId,
    account_id: accountId,
    scheduled_at: publishedAt,
    status: 'published',
    provider_post_id: `provider-${recentDeliveryId}`,
    published_at: publishedAt,
    metrics_state: 'pending',
  })
  const { data: claimed, error: claimError } = await service.rpc('social_claim_metrics', {
    p_limit: 1,
    p_lease_seconds: 30,
  })
  if (claimError) throw new Error(`social-metrics-db: claim failed (${claimError.code})`)
  assert.equal(claimed?.length, 1)
  assert.equal(claimed[0].id, recentDeliveryId)
  assert.equal(claimed[0].metrics_attempt_count, 1)
  const token = claimed[0].metrics_lease_token

  const { data: saved, error: finishError } = await service.rpc('social_finish_metrics', {
    p_delivery_id: recentDeliveryId,
    p_lease_token: token,
    p_outcome: 'success',
    p_views: 22,
    p_reads: null,
    p_likes: 3,
    p_comments: 1,
    p_provider_metrics: { saves: 4 },
  })
  if (finishError) throw new Error(`social-metrics-db: successful finish failed (${finishError.code})`)
  assert.equal(saved, true)

  const delivery = await expectRow(
    'social_deliveries',
    'metrics_state, metrics_last_fetched_at, metrics_next_fetch_at, metrics_attempt_count, metrics_last_error',
    recentDeliveryId,
  )
  assert.equal(delivery.metrics_state, 'available')
  assert.ok(delivery.metrics_last_fetched_at)
  assert.equal(delivery.metrics_attempt_count, 1)
  assert.equal(delivery.metrics_last_error, null)
  assert.ok(Math.abs(Date.parse(delivery.metrics_next_fetch_at) - (Date.parse(publishedAt) + 72 * 60 * 60 * 1000)) < 60_000)

  const { data: snapshots, error: snapshotError } = await service
    .from('social_metrics_snapshots')
    .select('delivery_id, views, reads, likes, comments, provider_metrics')
    .eq('delivery_id', recentDeliveryId)
  if (snapshotError) throw new Error(`social-metrics-db: snapshot read failed (${snapshotError.code})`)
  assert.equal(snapshots?.length, 1)
  assert.deepEqual(
    (({ delivery_id, views, reads, likes, comments, provider_metrics }) =>
      ({ delivery_id, views, reads, likes, comments, provider_metrics }))(snapshots[0]),
    {
      delivery_id: recentDeliveryId,
      views: 22,
      reads: null,
      likes: 3,
      comments: 1,
      provider_metrics: { saves: 4 },
    },
  )
  const { data: staleFinish, error: staleError } = await service.rpc('social_finish_metrics', {
    p_delivery_id: recentDeliveryId,
    p_lease_token: token,
    p_outcome: 'success',
    p_views: 999,
  })
  if (staleError) throw new Error(`social-metrics-db: stale finish failed (${staleError.code})`)
  assert.equal(staleFinish, false)

  await insert('social_posts', { id: unsupportedPostId, body: 'Unsupported metrics fixture', created_by: authorId })
  await insert('social_deliveries', {
    id: unsupportedDeliveryId,
    post_id: unsupportedPostId,
    account_id: accountId,
    scheduled_at: new Date().toISOString(),
    status: 'published',
    provider_post_id: `provider-${unsupportedDeliveryId}`,
    published_at: new Date().toISOString(),
  })
  const { data: unsupportedClaim, error: unsupportedClaimError } = await service.rpc('social_claim_metrics', {
    p_limit: 1,
    p_lease_seconds: 30,
  })
  if (unsupportedClaimError) throw new Error(`social-metrics-db: unsupported claim failed (${unsupportedClaimError.code})`)
  assert.equal(unsupportedClaim?.[0]?.id, unsupportedDeliveryId)
  const { data: unsupportedSaved, error: unsupportedFinishError } = await service.rpc('social_finish_metrics', {
    p_delivery_id: unsupportedDeliveryId,
    p_lease_token: unsupportedClaim[0].metrics_lease_token,
    p_outcome: 'unsupported',
    p_error_code: 'analytics_unsupported',
    p_error: 'This account does not support post analytics.',
  })
  if (unsupportedFinishError) throw new Error(`social-metrics-db: unsupported finish failed (${unsupportedFinishError.code})`)
  assert.equal(unsupportedSaved, true)
  const unsupported = await expectRow(
    'social_deliveries',
    'metrics_state, metrics_next_fetch_at, metrics_last_error_code',
    unsupportedDeliveryId,
  )
  assert.deepEqual(unsupported, {
    metrics_state: 'unsupported',
    metrics_next_fetch_at: null,
    metrics_last_error_code: 'analytics_unsupported',
  })

  await insert('social_posts', { id: failedPostId, body: 'Transient failure fixture', created_by: authorId })
  await insert('social_deliveries', {
    id: failedDeliveryId,
    post_id: failedPostId,
    account_id: accountId,
    scheduled_at: new Date().toISOString(),
    status: 'published',
    provider_post_id: `provider-${failedDeliveryId}`,
    published_at: new Date().toISOString(),
  })
  const { data: failedClaim, error: failedClaimError } = await service.rpc('social_claim_metrics', {
    p_limit: 1,
    p_lease_seconds: 30,
  })
  if (failedClaimError) throw new Error(`social-metrics-db: retry claim failed (${failedClaimError.code})`)
  assert.equal(failedClaim?.[0]?.id, failedDeliveryId)
  const { data: failedSaved, error: failedFinishError } = await service.rpc('social_finish_metrics', {
    p_delivery_id: failedDeliveryId,
    p_lease_token: failedClaim[0].metrics_lease_token,
    p_outcome: 'error',
    p_error_code: 'provider_unavailable',
    p_error: 'The provider request failed.',
  })
  if (failedFinishError) throw new Error(`social-metrics-db: retry finish failed (${failedFinishError.code})`)
  assert.equal(failedSaved, true)
  const failed = await expectRow(
    'social_deliveries',
    'metrics_state, metrics_next_fetch_at, metrics_attempt_count, metrics_last_error_code',
    failedDeliveryId,
  )
  assert.equal(failed.metrics_state, 'error')
  assert.equal(failed.metrics_attempt_count, 1)
  assert.equal(failed.metrics_last_error_code, 'provider_unavailable')
  assert.ok(Date.parse(failed.metrics_next_fetch_at) > Date.now())
  assert.ok(Date.parse(failed.metrics_next_fetch_at) < Date.now() + 61 * 60 * 1000)

  console.log('social-metrics-db: lease claims, durable snapshots, cadence metadata, unsupported skips, retries and stale-lease rejection passed')
} finally {
  for (const id of [postId, unsupportedPostId, failedPostId]) {
    const { error } = await service.from('social_posts').delete().eq('id', id)
    if (error) console.error(`social-metrics-db: cleanup post failed (${error.code})`)
  }
  const { error } = await service.from('social_accounts').delete().eq('id', accountId)
  if (error) console.error(`social-metrics-db: cleanup account failed (${error.code})`)
}
