import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { localStack, serviceKey, supabaseUrl } from './tts/storage.mjs'

const url = supabaseUrl()
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anonKey || !localStack()) {
  console.log('social-publishing: skipped — no local Supabase stack in .env')
  process.exit(0)
}

const localAuth = await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2_000) })
if (!localAuth.ok) {
  console.log('social-publishing: skipped — the local Supabase stack is not up')
  process.exit(0)
}

const localConfig = fs.readFileSync('supabase/config.toml', 'utf8')
if (!/\[local_smtp\][\s\S]*?^\s*enabled\s*=\s*true\s*$/m.test(localConfig) ||
    /^\s*\[auth\.email\.smtp\]\s*$/m.test(localConfig)) {
  console.log('social-publishing: skipped — Supabase Auth is not safely routed to local Mailpit')
  process.exit(0)
}

const mailUrl = process.env.SOCIAL_TEST_MAILPIT_URL || url.replace(/:\d+$/, ':54324')
const mailHealth = await fetch(mailUrl + '/api/v1/messages?limit=1', { signal: AbortSignal.timeout(2_000) })
if (!mailHealth.ok) {
  console.log('social-publishing: skipped — local Mailpit is not up')
  process.exit(0)
}

const client = (key) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const service = client(serviceKey())
const signIn = async (email) => {
  const sb = client(anonKey)
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(`${email}: ${error.message}`)
  return { sb, user: data.user }
}
const invoke = async (sb, body) => {
  const { data, error } = await sb.auth.getSession()
  if (error || !data.session) throw new Error('social function call requires a signed-in test user')
  const response = await fetch(url + '/functions/v1/social', {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${data.session.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let result = {}
  try { result = await response.json() } catch { /* preserve a non-JSON response as a status */ }
  return { status: response.status, ...result }
}
const invokeMultipart = async (sb, fields) => {
  const { data, error } = await sb.auth.getSession()
  if (error || !data.session) throw new Error('social upload requires a signed-in test user')
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  const response = await fetch(url + '/functions/v1/social', {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${data.session.access_token}`,
    },
    body: form,
  })
  let result = {}
  try { result = await response.json() } catch { /* preserve a non-JSON response as a status */ }
  return { status: response.status, ...result }
}
const requireData = (label, result) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function authUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw new Error(`list users for cleanup: ${error.message}`)
    const found = data.users.find((user) => user.email?.toLowerCase() === email)
    if (found) return found
    if (data.users.length < 100) return null
  }
  throw new Error('could not find the test invitee within 2,000 local Auth users')
}
async function mailMessages() {
  const response = await fetch(mailUrl + '/api/v1/messages?limit=100')
  if (!response.ok) throw new Error(`Mailpit list failed: ${response.status}`)
  return (await response.json()).messages || []
}
async function rawMail(id) {
  const response = await fetch(`${mailUrl}/api/v1/message/${encodeURIComponent(id)}/raw`)
  if (!response.ok) throw new Error(`Mailpit message fetch failed: ${response.status}`)
  return response.text()
}
function mailText(raw) {
  const decoded = [raw]
  for (const match of raw.matchAll(/Content-Transfer-Encoding:\s*base64\s*\r?\n(?:[^\r\n]*\r?\n)*\r?\n([\s\S]*?)(?=\r?\n--|\s*$)/gi)) {
    decoded.push(Buffer.from(match[1].replace(/\s/g, ''), 'base64').toString('utf8'))
  }
  return decoded.map((text) => text
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&#x3d;/gi, '=')
    .replace(/&#61;/gi, '='))
    .join('\n')
}
function invitationUrl(raw) {
  const text = mailText(raw)
  const hrefs = [...text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
  const candidate = hrefs.find((href) => /\/auth\/v1\/verify(?:\?|%3f)/i.test(href))
  if (!candidate) throw new Error('the captured invitation has no Supabase Auth verify link')
  return candidate.replace(/&amp;/gi, '&').replace(/&#x3d;/gi, '=')
}

const adminLogin = await signIn('admin@example.com')
const readerLogin = await signIn('member@example.com')
const email = `social-invite-${randomUUID()}@example.com`
const before = await mailMessages()
const existingMailIds = new Set(before.map((message) => message.ID))
let grantId
let inviteeId
let invitationMailId
let testPostId
let testAccountId
let redditPostId
let redditAccountId
let redditCredentialId
const testDeliveryAccountIds = []
const grantedAccountIds = []
let failure
const cleanupErrors = []

async function grantAccountAccess(accountId) {
  if (!grantedAccountIds.includes(accountId)) grantedAccountIds.push(accountId)
  const permissions = await invoke(adminLogin.sb, {
    action: 'save_permissions',
    grantId,
    canManageAccounts: false,
    permissions: grantedAccountIds.map((id) => ({
      accountId: id,
      read_posts: true,
      create_posts: true,
      edit_posts: true,
      schedule_posts: true,
      approve_posts: true,
      publish_now: true,
      view_results: true,
    })),
  })
  assert.equal(permissions.status, 200, JSON.stringify(permissions))
}

try {
  const forbiddenInvite = await invoke(readerLogin.sb, { action: 'invite', email })
  assert.equal(forbiddenInvite.status, 403, 'ordinary readers cannot invite publishers')

  const invitation = await invoke(adminLogin.sb, { action: 'invite', email })
  grantId = invitation.invitation?.id
  assert.equal(invitation.status, 201, JSON.stringify(invitation))
  assert.equal(invitation.invitation.email, email)
  assert.equal(invitation.invitation.status, 'pending')

  const deadline = Date.now() + 20_000
  let message
  while (Date.now() < deadline) {
    message = (await mailMessages()).find((item) =>
      !existingMailIds.has(item.ID) &&
      (item.To || []).some((to) => to.Address?.toLowerCase() === email))
    if (message) break
    await wait(250)
  }
  assert.ok(message, 'Supabase Auth delivered the invitation to the intended local Mailpit recipient')
  invitationMailId = message.ID
  assert.match(message.Subject, /Invitation to schedule social posts/i)

  const raw = await rawMail(message.ID)
  const text = mailText(raw)
  assert.match(text, /a site administrator invited you to schedule posts for this site/i)
  assert.match(text, /Accept invitation/i)
  assert.doesNotMatch(text, /access_token|refresh_token|social_accounts|client_secret/i)
  const verifyUrl = invitationUrl(raw)

  const verified = await fetch(verifyUrl, { redirect: 'manual' })
  assert.ok([301, 302, 303, 307, 308].includes(verified.status), `Auth verify returned ${verified.status}`)
  const redirect = new URL(verified.headers.get('location') || '')
  assert.equal(redirect.pathname, '/admin/social')
  assert.equal(redirect.searchParams.get('invitation'), 'accepted')
  const fragment = new URLSearchParams(redirect.hash.slice(1))
  const accessToken = fragment.get('access_token')
  const refreshToken = fragment.get('refresh_token')
  assert.ok(accessToken && refreshToken, 'the Auth invitation returns a signed session to the fixed social route')

  const invitee = client(anonKey)
  const { data: sessionData, error: sessionError } = await invitee.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  assert.equal(sessionError, null, sessionError?.message)
  inviteeId = sessionData.user.id
  assert.equal(sessionData.user.email?.toLowerCase(), email)
  assert.ok(sessionData.user.invited_at, 'the account was created through Supabase Auth invite')

  const { data: profileBefore, error: profileError } = await service
    .from('profiles').select('role, roles').eq('id', inviteeId).single()
  assert.equal(profileError, null, profileError?.message)
  const mismatch = await invoke(readerLogin.sb, { action: 'accept_invitation' })
  assert.equal(mismatch.status, 403, 'a different account cannot claim the pending recipient-bound grant')

  const accepted = await invoke(invitee, { action: 'accept_invitation' })
  assert.equal(accepted.status, 200, JSON.stringify(accepted))
  assert.equal(accepted.invitation.id, grantId)
  assert.equal(accepted.invitation.status, 'active')
  assert.equal((await invitee.rpc('social_has_access')).data, false,
    'accepting an invitation alone grants no Social capabilities')
  const expiredInvite = await service.from('social_publisher_grants')
    .update({ expires_at: new Date(Date.now() - 1_000).toISOString() }).eq('id', grantId)
  assert.equal(expiredInvite.error, null, expiredInvite.error?.message)
  assert.equal((await invitee.rpc('social_has_access')).data, false,
    'an accepted invitation without explicit permissions still grants no Social capabilities')
  const { data: profileAfter, error: afterError } = await service
    .from('profiles').select('role, roles').eq('id', inviteeId).single()
  assert.equal(afterError, null, afterError?.message)
  assert.deepEqual(profileAfter, profileBefore, 'acceptance does not add or change a global staff role')

  const duplicate = await invoke(adminLogin.sb, { action: 'invite', email })
  assert.equal(duplicate.status, 409, 'active publisher access cannot be duplicated')
  const replay = await invoke(invitee, { action: 'accept_invitation' })
  assert.equal(replay.status, 409, 'the invitation can only be accepted once')

  testAccountId = randomUUID()
  const testAccount = await service.from('social_accounts').insert({
    id: testAccountId,
    provider_id: 'unsupported-test',
    external_id: `unsupported-${testAccountId}`,
    name: 'Unsupported test account',
    username: 'unsupported-test',
    credential_secret_id: randomUUID(),
    connected_by: adminLogin.user.id,
  })
  assert.equal(testAccount.error, null, testAccount.error?.message)
  await grantAccountAccess(testAccountId)
  assert.equal((await invitee.rpc('social_has_access')).data, true,
    'Social access begins only after the administrator explicitly grants an account capability')

  const savedDraft = await invoke(invitee, {
    action: 'save_draft',
    text: 'Draft text with image and video media.',
    timezone: 'America/New_York',
  })
  assert.equal(savedDraft.status, 201, JSON.stringify(savedDraft))
  testPostId = savedDraft.post.id
  assert.equal(savedDraft.post.body, 'Draft text with image and video media.')
  assert.equal(savedDraft.post.timezone, 'America/New_York')

  const unauthorizedUpload = await invokeMultipart(readerLogin.sb, {
    action: 'upload_attachment',
    postId: testPostId,
    file: new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])], 'reader.png', { type: 'image/png' }),
  })
  assert.equal(unauthorizedUpload.status, 403, 'an unrelated reader cannot upload media to a social draft')

  const image = await invokeMultipart(invitee, {
    action: 'upload_attachment',
    postId: testPostId,
    file: new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])], 'cover.png', { type: 'image/png' }),
  })
  assert.equal(image.status, 201, JSON.stringify(image))
  const video = await invokeMultipart(invitee, {
    action: 'upload_attachment',
    postId: testPostId,
    file: new File([new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0])], 'clip.mp4', { type: 'video/mp4' }),
  })
  assert.equal(video.status, 201, JSON.stringify(video))

  const replacement = await invokeMultipart(invitee, {
    action: 'replace_attachment',
    postId: testPostId,
    attachmentId: image.attachment.id,
    file: new File([new Uint8Array([0xff, 0xd8, 0xff, 0])], 'cover.jpg', { type: 'image/jpeg' }),
  })
  assert.equal(replacement.status, 200, JSON.stringify(replacement))
  assert.equal(replacement.attachment.id, image.attachment.id)
  assert.notEqual(replacement.attachment.object_path, image.attachment.object_path)
  const replacedObject = await service.storage.from('social').download(image.attachment.object_path)
  assert.ok(replacedObject.error, 'replacing media removes the prior private object')

  const ordered = await invoke(invitee, {
    action: 'order_attachments',
    postId: testPostId,
    attachmentIds: [video.attachment.id, replacement.attachment.id],
  })
  assert.equal(ordered.status, 200, JSON.stringify(ordered))
  const persistedDrafts = await invoke(invitee, { action: 'drafts' })
  assert.equal(persistedDrafts.status, 200, JSON.stringify(persistedDrafts))
  const persistedPost = persistedDrafts.posts.find((post) => post.id === testPostId)
  assert.equal(persistedPost.body, 'Draft text with image and video media.')
  assert.deepEqual(persistedPost.attachments.map((item) => item.id), [video.attachment.id, image.attachment.id])
  assert.deepEqual(persistedPost.attachments.map((item) => item.position), [0, 1])
  assert.equal(persistedPost.attachments[1].file_name, 'cover.jpg')

  const removed = await invoke(invitee, { action: 'remove_attachment', attachmentId: video.attachment.id })
  assert.equal(removed.status, 200, JSON.stringify(removed))
  const removedObject = await service.storage.from('social').download(video.attachment.object_path)
  assert.ok(removedObject.error, 'removing media deletes the private object')

  const invalidSchedule = await invoke(invitee, {
    action: 'schedule',
    postId: testPostId,
    text: 'Draft text with image and video media.',
    timezone: 'America/New_York',
    accountIds: [testAccountId],
    scheduledAt: new Date(Date.now() + 120_000).toISOString(),
  })
  assert.equal(invalidSchedule.status, 422, JSON.stringify(invalidSchedule))
  assert.equal(invalidSchedule.code, 'social_target_validation_failed')
  assert.deepEqual(invalidSchedule.targetErrors.map((target) => target.accountId), [testAccountId])
  assert.deepEqual(invalidSchedule.targetErrors[0].issues.map((issue) => issue.code), ['provider_unsupported'])
  assert.equal(invalidSchedule.targetErrors[0].providerId, 'unsupported-test')
  const stillDraft = await invoke(invitee, { action: 'drafts' })
  assert.equal(stillDraft.posts.find((post) => post.id === testPostId).deliveries.length, 0,
    'target validation leaves an unsupported schedule as a draft')

  const redditCredential = await service.rpc('social_vault_put', {
    p_secret: JSON.stringify({
      accessToken: 'social-test-token',
      refreshToken: 'social-test-refresh-token',
      expiresAt: null,
      scopes: ['identity', 'read', 'submit'],
    }),
    p_name: `social-test-reddit-${randomUUID()}`,
    p_description: 'Temporary credential for the Social integration test',
  })
  assert.equal(redditCredential.error, null, redditCredential.error?.message)
  redditCredentialId = redditCredential.data
  redditAccountId = randomUUID()
  const redditAccount = await service.from('social_accounts').insert({
    id: redditAccountId,
    provider_id: 'reddit',
    external_id: `reddit-${redditAccountId}`,
    name: 'Reddit integration test',
    username: 'social-integration-test',
    credential_secret_id: redditCredentialId,
    connected_by: adminLogin.user.id,
  })
  assert.equal(redditAccount.error, null, redditAccount.error?.message)
  await grantAccountAccess(redditAccountId)

  const redditCapabilities = await invoke(invitee, {
    action: 'account_capabilities',
    accountId: redditAccountId,
  })
  assert.equal(redditCapabilities.status, 200, JSON.stringify(redditCapabilities))
  assert.ok(
    redditCapabilities.operations.some(({ operation }) => operation === 'posts.read'),
    'the account operation manifest exposes supported Reddit reads',
  )
  assert.ok(
    !redditCapabilities.operations.some(({ operation }) => operation === 'graph.follow'),
    'the account operation manifest hides unsupported Reddit graph actions',
  )
  const unsupportedRedditOperation = await invoke(invitee, {
    action: 'account_operation',
    accountId: redditAccountId,
    operation: 'graph.follow',
    input: { profileId: 'another-account' },
  })
  assert.equal(unsupportedRedditOperation.status, 422, JSON.stringify(unsupportedRedditOperation))
  assert.equal(unsupportedRedditOperation.code, 'operation_unsupported')

  const redditMediaSchedule = await invoke(invitee, {
    action: 'schedule',
    postId: testPostId,
    text: 'A Reddit post cannot silently drop attached media.',
    timezone: 'America/New_York',
    accountIds: [redditAccountId],
    targetOptions: { [redditAccountId]: { subreddit: 'AskReddit', title: 'Media capability check' } },
    scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })
  assert.equal(redditMediaSchedule.status, 422, JSON.stringify(redditMediaSchedule))
  assert.ok(redditMediaSchedule.targetErrors[0].issues.some((issue) =>
    issue.code === 'reddit.media_unsupported'), 'Reddit rejects media at the served scheduling boundary')

  const redditDraft = await invoke(invitee, {
    action: 'save_draft',
    text: 'Reddit post before edit.',
    timezone: 'America/New_York',
  })
  assert.equal(redditDraft.status, 201, JSON.stringify(redditDraft))
  redditPostId = redditDraft.post.id
  const firstScheduleAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const redditSchedule = await invoke(invitee, {
    action: 'schedule',
    postId: redditPostId,
    text: 'Reddit post before edit.',
    timezone: 'America/New_York',
    accountIds: [redditAccountId],
    targetOptions: { [redditAccountId]: { subreddit: 'AskReddit', title: 'A scheduled post' } },
    scheduledAt: firstScheduleAt,
  })
  assert.equal(redditSchedule.status, 200, JSON.stringify(redditSchedule))
  assert.equal(redditSchedule.deliveries.length, 1)
  assert.equal(redditSchedule.deliveries[0].status, 'scheduled')

  const editedRedditDraft = await invoke(invitee, {
    action: 'save_draft',
    postId: redditPostId,
    text: 'Reddit post after edit.',
    timezone: 'America/New_York',
  })
  assert.equal(editedRedditDraft.status, 200, JSON.stringify(editedRedditDraft))
  const revisedScheduleAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const rescheduledRedditPost = await invoke(invitee, {
    action: 'schedule',
    postId: redditPostId,
    text: 'Reddit post after edit.',
    timezone: 'America/New_York',
    accountIds: [redditAccountId],
    targetOptions: { [redditAccountId]: { subreddit: 'AskReddit', title: 'An edited scheduled post' } },
    scheduledAt: revisedScheduleAt,
  })
  assert.equal(rescheduledRedditPost.status, 200, JSON.stringify(rescheduledRedditPost))
  assert.equal(rescheduledRedditPost.deliveries.length, 1)
  assert.equal(rescheduledRedditPost.deliveries[0].id, redditSchedule.deliveries[0].id,
    'rescheduling edits the existing account target rather than creating a duplicate')
  assert.equal(rescheduledRedditPost.deliveries[0].target_options.title, 'An edited scheduled post')
  assert.equal(new Date(rescheduledRedditPost.deliveries[0].scheduled_at).toISOString(),
    revisedScheduleAt)

  const cancelledRedditPost = await invoke(invitee, {
    action: 'cancel_schedule',
    postId: redditPostId,
  })
  assert.equal(cancelledRedditPost.status, 200, JSON.stringify(cancelledRedditPost))
  const cancelledRedditState = await invoke(invitee, { action: 'drafts' })
  assert.equal(cancelledRedditState.status, 200, JSON.stringify(cancelledRedditState))
  const cancelledRedditDraft = cancelledRedditState.posts.find((post) => post.id === redditPostId)
  assert.equal(cancelledRedditDraft.body, 'Reddit post after edit.')
  assert.equal(cancelledRedditDraft.deliveries.length, 1)
  assert.equal(cancelledRedditDraft.deliveries[0].status, 'cancelled')

  const failedDelivery = await service.from('social_deliveries').insert({
    post_id: testPostId,
    account_id: testAccountId,
    scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    status: 'failed',
    attempt_count: 1,
    last_error_code: 'provider_rejected',
    last_error: 'The provider rejected the post.',
  }).select('id').single()
  assert.equal(failedDelivery.error, null, failedDelivery.error?.message)
  const failedAttempt = await service.from('social_delivery_attempts').insert({
    delivery_id: failedDelivery.data.id,
    attempt_number: 1,
    status: 'terminal',
    operation: 'publish',
    error_code: 'provider_rejected',
    error_message: 'The provider rejected the post.',
    finished_at: new Date().toISOString(),
  })
  assert.equal(failedAttempt.error, null, failedAttempt.error?.message)
  const unrelatedRecovery = await invoke(readerLogin.sb, {
    action: 'recover_delivery',
    deliveryId: failedDelivery.data.id,
    resolution: 'retry',
  })
  assert.equal(unrelatedRecovery.status, 403, 'a reader without social access cannot recover deliveries')
  const recoveredFailure = await invoke(invitee, {
    action: 'recover_delivery',
    deliveryId: failedDelivery.data.id,
    resolution: 'retry',
  })
  assert.equal(recoveredFailure.status, 200, JSON.stringify(recoveredFailure))
  const failedRetryState = await service.from('social_deliveries')
    .select('status, attempt_count, recovered_by, recovered_at, recovery_action')
    .eq('id', failedDelivery.data.id).single()
  assert.equal(failedRetryState.error, null, failedRetryState.error?.message)
  assert.equal(failedRetryState.data.status, 'scheduled')
  assert.equal(failedRetryState.data.attempt_count, 1, 'manual recovery preserves the monotonic attempt number')
  assert.equal(failedRetryState.data.recovered_by, inviteeId)
  assert.equal(failedRetryState.data.recovery_action, 'retry')
  assert.ok(failedRetryState.data.recovered_at)

  const makeDeliveryAccount = async () => {
    const id = randomUUID()
    const result = await service.from('social_accounts').insert({
      id,
      provider_id: 'unsupported-test',
      external_id: `unsupported-${id}`,
      name: 'Unsupported recovery account',
      username: 'unsupported-recovery',
      credential_secret_id: randomUUID(),
      connected_by: adminLogin.user.id,
    })
    assert.equal(result.error, null, result.error?.message)
    testDeliveryAccountIds.push(id)
    await grantAccountAccess(id)
    return id
  }
  const reviewRetryAccountId = await makeDeliveryAccount()
  const reviewForRetry = await service.from('social_deliveries').insert({
    post_id: testPostId,
    account_id: reviewRetryAccountId,
    scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    status: 'review_required',
    last_error_code: 'publish_outcome_unknown',
    last_error: 'The provider response did not confirm the outcome.',
  }).select('id').single()
  assert.equal(reviewForRetry.error, null, reviewForRetry.error?.message)
  const unsafeRetry = await invoke(invitee, {
    action: 'recover_delivery',
    deliveryId: reviewForRetry.data.id,
    resolution: 'retry',
  })
  assert.equal(unsafeRetry.status, 409, 'an uncertain delivery cannot be retried without explicit confirmation')
  const confirmedRetry = await invoke(invitee, {
    action: 'recover_delivery',
    deliveryId: reviewForRetry.data.id,
    resolution: 'retry',
    confirmedNotPublished: true,
  })
  assert.equal(confirmedRetry.status, 200, JSON.stringify(confirmedRetry))

  const reviewPublishAccountId = await makeDeliveryAccount()
  const reviewForPublish = await service.from('social_deliveries').insert({
    post_id: testPostId,
    account_id: reviewPublishAccountId,
    scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    status: 'review_required',
    last_error_code: 'publish_outcome_unknown',
    last_error: 'The provider response did not confirm the outcome.',
  }).select('id').single()
  assert.equal(reviewForPublish.error, null, reviewForPublish.error?.message)
  const markedPublished = await invoke(invitee, {
    action: 'recover_delivery',
    deliveryId: reviewForPublish.data.id,
    resolution: 'marked_published',
    providerPostId: 'provider-post-123',
  })
  assert.equal(markedPublished.status, 200, JSON.stringify(markedPublished))
  const publishedState = await service.from('social_deliveries')
    .select('status, provider_post_id, recovered_by, recovery_action')
    .eq('id', reviewForPublish.data.id).single()
  assert.equal(publishedState.error, null, publishedState.error?.message)
  assert.equal(publishedState.data.status, 'published')
  assert.equal(publishedState.data.provider_post_id, 'provider-post-123')
  assert.equal(publishedState.data.recovered_by, inviteeId)
  assert.equal(publishedState.data.recovery_action, 'marked_published')

  const revoked = await invoke(adminLogin.sb, { action: 'revoke', grantId })
  assert.equal(revoked.status, 200, JSON.stringify(revoked))
  assert.equal((await invitee.rpc('social_has_access')).data, false, 'revocation takes effect in the existing session')
  const stillListed = await invitee.from('social_posts').select('id')
  assert.equal(stillListed.error, null, stillListed.error?.message)
  assert.deepEqual(stillListed.data, [], 'RLS hides social posts immediately after revocation')
  const postRevokeReplay = await invoke(invitee, { action: 'accept_invitation' })
  assert.equal(postRevokeReplay.status, 409, 'a revoked invitation cannot be reused')

  console.log('social-publishing: captured recipient-bound invitation, acceptance, replay protection and immediate revocation passed')
} catch (error) {
  failure = error
} finally {
  if (!invitationMailId) {
    try {
      const message = (await mailMessages()).find((item) =>
        !existingMailIds.has(item.ID) &&
        (item.To || []).some((to) => to.Address?.toLowerCase() === email))
      invitationMailId = message?.ID
    } catch (error) { cleanupErrors.push(`find test Mailpit message: ${error.message}`) }
  }
  if (!grantId) {
    const { data, error } = await service.from('social_publisher_grants')
      .select('id, user_id').eq('email', email)
    if (error) cleanupErrors.push(`find test grant: ${error.message}`)
    else if (data?.[0]) {
      grantId = data[0].id
      inviteeId = data[0].user_id || inviteeId
    }
  }
  if (grantId) {
    const { error } = await service.from('social_publisher_grants').delete().eq('id', grantId)
    if (error) cleanupErrors.push(`delete test grant: ${error.message}`)
  }
  if (testPostId) {
    const { data: objects, error } = await service.storage.from('social').list(`posts/${testPostId}`)
    if (error) cleanupErrors.push(`list test media for cleanup: ${error.message}`)
    else if (objects?.length) {
      const { error: removeError } = await service.storage.from('social')
        .remove(objects.map((object) => `posts/${testPostId}/${object.name}`))
      if (removeError) cleanupErrors.push(`remove test media: ${removeError.message}`)
    }
    const { error: postError } = await service.from('social_posts').delete().eq('id', testPostId)
    if (postError) cleanupErrors.push(`delete test post: ${postError.message}`)
  }
  if (redditPostId) {
    const { error } = await service.from('social_posts').delete().eq('id', redditPostId)
    if (error) cleanupErrors.push(`delete Reddit test post: ${error.message}`)
  }
  if (redditAccountId) {
    const { error } = await service.from('social_accounts').delete().eq('id', redditAccountId)
    if (error) cleanupErrors.push(`delete Reddit test account: ${error.message}`)
  }
  if (redditCredentialId) {
    const { error } = await service.rpc('social_vault_delete', { p_secret_id: redditCredentialId })
    if (error) cleanupErrors.push(`delete Reddit test credential: ${error.message}`)
  }
  if (testAccountId) {
    const { error } = await service.from('social_accounts').delete().eq('id', testAccountId)
    if (error) cleanupErrors.push(`delete test account: ${error.message}`)
  }
  for (const accountId of testDeliveryAccountIds) {
    const { error } = await service.from('social_accounts').delete().eq('id', accountId)
    if (error) cleanupErrors.push(`delete test delivery account: ${error.message}`)
  }
  if (!inviteeId) {
    try { inviteeId = (await authUserByEmail(email))?.id } catch (error) { cleanupErrors.push(error.message) }
  }
  if (inviteeId) {
    const { error } = await service.auth.admin.deleteUser(inviteeId)
    if (error && !/user not found/i.test(error.message)) cleanupErrors.push(`delete test Auth user: ${error.message}`)
  }
  if (invitationMailId) {
    const response = await fetch(`${mailUrl}/api/v1/messages`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ IDs: [invitationMailId] }),
    })
    if (!response.ok) cleanupErrors.push(`delete test Mailpit message: ${response.status}`)
  }
}

if (failure) throw failure
if (cleanupErrors.length) throw new Error(cleanupErrors.join('; '))
