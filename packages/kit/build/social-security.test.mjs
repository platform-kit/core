import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const note = (message) => console.log('social-security: ' + message)
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) {
  note('skipped — no local Supabase stack in .env')
  leave(0)
}
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* local stack is unavailable */ }
if (!up) {
  note('skipped — the local Supabase stack is not up')
  process.exit(0)
}

const client = (key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const service = client(serviceKey())
const as = async (email) => {
  const sb = client(anon)
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(`${email}: ${error.message}`)
  return { sb, id: data.user.id }
}
const admin = await as('admin@example.com')
const invitee = await as('free@example.com')
const reader = await as('member@example.com')
const deskStaff = await as('support@example.com')
const now = new Date()
const postId = randomUUID()
const accountId = randomUUID()
const otherAccountId = randomUUID()
const deliveryId = randomUUID()
const otherDeliveryId = randomUUID()
const attachmentId = randomUUID()
const objectPath = `posts/${postId}/${attachmentId}`
let grantId
let vaultId
let deskStaffGrantId

const expectNoError = (label, result) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

try {
  const grant = expectNoError('create active test grant', await service.from('social_publisher_grants').insert({
    email: 'free@example.com',
    user_id: invitee.id,
    status: 'active',
    invited_by: admin.id,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    accepted_at: now.toISOString(),
  }).select('id').single())
  grantId = grant.id
  const deskGrant = expectNoError('create Social access for Spaces staff', await service.from('social_publisher_grants').insert({
    email: 'support@example.com',
    user_id: deskStaff.id,
    status: 'active',
    invited_by: admin.id,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    accepted_at: now.toISOString(),
  }).select('id').single())
  deskStaffGrantId = deskGrant.id
  for (const [id, name] of [
    [accountId, 'Test Account'],
    [otherAccountId, 'Other Test Account'],
  ]) {
    expectNoError('create test account', await service.from('social_accounts').insert({
      id,
      provider_id: 'fixture',
      external_id: `account-${id}`,
      name,
      username: `test-account-${id.slice(0, 8)}`,
      credential_secret_id: crypto.randomUUID(),
      connected_by: admin.id,
    }))
  }
  expectNoError('create test post', await service.from('social_posts').insert({
    id: postId,
    body: 'Test post',
    created_by: admin.id,
  }))
  expectNoError('create test attachment', await service.from('social_attachments').insert({
    id: attachmentId,
    post_id: postId,
    object_path: objectPath,
    kind: 'image',
    mime_type: 'image/png',
    file_name: 'test.png',
    byte_size: 3,
  }))
  expectNoError('create test delivery', await service.from('social_deliveries').insert({
    id: deliveryId,
    post_id: postId,
    account_id: accountId,
    scheduled_at: new Date(Date.now() + 60_000).toISOString(),
  }))
  const { error: uploadError } = await service.storage.from('social').upload(objectPath, new Uint8Array([1, 2, 3]), {
    contentType: 'image/png',
    upsert: false,
  })
  if (uploadError) throw new Error(`upload test media: ${uploadError.message}`)

  assert.equal((await invitee.sb.rpc('social_has_access')).data, false, 'an active invitation alone grants no Social access')
  assert.equal((await admin.sb.rpc('social_has_access')).data, true)
  assert.equal((await reader.sb.rpc('social_has_access')).data, false)
  assert.equal(((await admin.sb.from('social_posts').select('id').eq('id', postId)).data || []).length, 1)
  assert.equal(((await admin.sb.from('social_accounts').select('id').eq('id', accountId)).data || []).length, 1)
  assert.equal(((await invitee.sb.from('social_posts').select('id').eq('id', postId)).data || []).length, 0)
  assert.equal(((await invitee.sb.from('social_accounts').select('id').eq('id', accountId)).data || []).length, 0)
  assert.equal(((await invitee.sb.from('social_deliveries').select('id').eq('id', deliveryId)).data || []).length, 0)
  assert.equal(((await reader.sb.from('social_posts').select('id').eq('id', postId)).data || []).length, 0)
  assert.equal(((await reader.sb.from('social_accounts').select('id').eq('id', accountId)).data || []).length, 0)
  const deniedWrite = await reader.sb.from('social_posts').insert({ body: 'unauthorized', created_by: reader.id })
  assert.ok(deniedWrite.error, 'non-publishers must not write social rows directly')

  expectNoError('grant read access to one account', await service.from('social_publisher_account_permissions').insert({
    grant_id: grantId,
    account_id: accountId,
    read_posts: true,
  }))
  assert.equal((await invitee.sb.rpc('social_has_access')).data, true)
  assert.equal(((await invitee.sb.from('social_accounts').select('id')).data || []).length, 1)
  assert.deepEqual(
    (await invitee.sb.from('social_accounts').select('id').eq('id', accountId)).data,
    [{ id: accountId }],
  )
  assert.equal(((await invitee.sb.from('social_posts').select('id').eq('id', postId)).data || []).length, 1)
  assert.equal(((await invitee.sb.from('social_deliveries').select('id').eq('id', deliveryId)).data || []).length, 1)
  const publisherDownload = await invitee.sb.storage.from('social').download(objectPath)
  assert.equal(publisherDownload.error, null, 'an account-scoped reader can fetch private media for a readable post')

  expectNoError('add inaccessible target to shared post', await service.from('social_deliveries').insert({
    id: otherDeliveryId,
    post_id: postId,
    account_id: otherAccountId,
    scheduled_at: new Date(Date.now() + 60_000).toISOString(),
  }))
  assert.equal(((await invitee.sb.from('social_accounts').select('id').eq('id', otherAccountId)).data || []).length, 0)
  assert.equal(((await invitee.sb.from('social_deliveries').select('id').eq('id', otherDeliveryId)).data || []).length, 0)
  assert.equal(((await invitee.sb.from('social_posts').select('id').eq('id', postId)).data || []).length, 0,
    'a shared post is hidden if any target is outside the publisher’s grants')
  assert.equal(((await invitee.sb.from('social_attachments').select('id').eq('id', attachmentId)).data || []).length, 0,
    'attachments do not expose content from a mixed-access post')

  expectNoError('grant Spaces staff read access to one account', await service.from('social_publisher_account_permissions').insert({
    grant_id: deskStaffGrantId,
    account_id: accountId,
    read_posts: true,
    view_results: true,
    publish_now: false,
  }))
  expectNoError('mark the known account delivery published', await service.from('social_deliveries').update({
    status: 'published',
    provider_post_id: 'fixture-provider-post',
    published_at: now.toISOString(),
  }).eq('id', deliveryId))

  let edgeReady = false
  try {
    const probe = await fetch(url + '/functions/v1/social', {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(3000),
    })
    edgeReady = probe.ok
  } catch { /* the local Edge Runtime is optional for this database test */ }
  if (!edgeReady) {
    note('served Social Edge Function unavailable — direct Desk authorization checks skipped')
  } else {
    const invokeDesk = async (person, body) => {
      const { data, error } = await person.sb.auth.getSession()
      if (error || !data.session) throw new Error('get test session for Social Edge request: ' + (error?.message || 'missing session'))
      const response = await fetch(url + '/functions/v1/social', {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
        headers: {
          'content-type': 'application/json',
          apikey: anon,
          authorization: 'Bearer ' + data.session.access_token,
        },
        body: JSON.stringify(body),
      })
      return { status: response.status, body: await response.json() }
    }

    const nonstaffAccounts = await invokeDesk(invitee, { action: 'desk_accounts' })
    assert.ok(nonstaffAccounts.status === 403 && nonstaffAccounts.body.code === 'desk_staff_required',
      'a Social invitee without Spaces staff access cannot query Desk accounts')

    const readOnlyAccounts = await invokeDesk(deskStaff, { action: 'desk_accounts' })
    assert.ok(
      readOnlyAccounts.status === 200 && readOnlyAccounts.body.accounts?.length === 0,
      'read-only staff do not see Social Desk account identities',
    )
    const readOnlyPosts = await invokeDesk(deskStaff, { action: 'desk_posts' })
    assert.ok(
      readOnlyPosts.status === 200 && readOnlyPosts.body.posts?.length === 0,
      'read-only staff do not see published post context through the Desk',
    )
    const readOnlyCapabilities = await invokeDesk(deskStaff, { action: 'desk_capabilities', accountId })
    assert.ok(
      readOnlyCapabilities.status === 403 && readOnlyCapabilities.body.code === 'social_permission_required',
      'read-only staff cannot inspect Social provider capabilities through the Desk',
    )
    for (const operation of ['comments.read', 'messages.read', 'comments.write', 'messages.write', 'profiles.read']) {
      const denied = await invokeDesk(deskStaff, {
        action: 'desk_operation',
        accountId,
        operation,
        input: {
          postId: 'fixture-post',
          commentId: 'fixture-comment',
          conversationId: 'fixture-conversation',
          text: 'fixture-only',
        },
      })
      assert.ok(denied.status === 403 && denied.body.code === 'social_permission_required',
        `read-only staff cannot request ${operation} through the Desk`)
    }
    const readOnlyAutomations = await invokeDesk(deskStaff, { action: 'automation_list', accountId })
    assert.ok(
      readOnlyAutomations.status === 200 &&
        Array.isArray(readOnlyAutomations.body.automations) &&
        Array.isArray(readOnlyAutomations.body.events) &&
        Array.isArray(readOnlyAutomations.body.responses),
      'View results staff can inspect authorized Social automation history',
    )
    const readOnlySave = await invokeDesk(deskStaff, {
      action: 'automation_save',
      accountId,
      eventKind: 'comment',
      keyword: 'guide',
      botSlug: 'not-used-without-publish-permission',
      destinations: ['public_reply'],
      mode: 'draft',
      enabled: true,
    })
    assert.ok(
      readOnlySave.status === 403 && readOnlySave.body.code === 'social_permission_required',
      'View results alone cannot manage or enable an automation',
    )
    const readOnlySend = await invokeDesk(deskStaff, {
      action: 'automation_response',
      responseId: randomUUID(),
      decision: 'send',
    })
    assert.ok(
      readOnlySend.status === 403 && readOnlySend.body.code === 'social_permission_required',
      'View results alone cannot manually send a bot response',
    )
    const readerAutomationRead = await invokeDesk(reader, { action: 'automation_list', accountId })
    assert.ok(
      readerAutomationRead.status === 403 && readerAutomationRead.body.code === 'social_access_required',
      'a general reader cannot inspect private Social automation records',
    )

    expectNoError('grant Spaces staff Social Admin publish access to one account',
      await service.from('social_publisher_account_permissions')
        .update({ publish_now: true }).eq('grant_id', deskStaffGrantId).eq('account_id', accountId))

    const accounts = await invokeDesk(deskStaff, { action: 'desk_accounts' })
    assert.ok(
      accounts.status === 200 &&
        accounts.body.accounts?.length === 1 &&
        accounts.body.accounts[0].id === accountId,
      'the staff Desk lists only connected accounts with current View results and Publish now',
    )

    const posts = await invokeDesk(deskStaff, { action: 'desk_posts' })
    assert.ok(
      posts.status === 200 &&
        posts.body.posts?.length === 1 &&
        posts.body.posts[0].account_id === accountId &&
        posts.body.posts[0].provider_post_id === 'fixture-provider-post' &&
        posts.body.posts[0].body === 'Test post',
      'the Desk discovers published posts and source context only through its granted account',
    )

    for (const operation of ['comments.read', 'messages.read', 'profiles.read']) {
      const denied = await invokeDesk(deskStaff, {
        action: 'desk_operation',
        accountId: otherAccountId,
        operation,
        input: operation === 'comments.read'
          ? { postId: 'fixture-post' }
          : { conversationId: 'fixture-conversation' },
      })
      assert.ok(denied.status === 403 && denied.body.code === 'social_permission_required',
        `the Desk refuses ${operation} on an account without View results`)
    }

    for (const operation of ['comments.write', 'messages.write']) {
      const denied = await invokeDesk(deskStaff, {
        action: 'desk_operation',
        accountId: otherAccountId,
        operation,
        input: {
          postId: 'fixture-post',
          commentId: 'fixture-comment',
          conversationId: 'fixture-conversation',
          text: 'fixture-only',
        },
      })
      assert.ok(denied.status === 403 && denied.body.code === 'social_permission_required',
        `the Desk refuses ${operation} on an account without Social Admin publisher access`)
    }

    expectNoError('revoke the Desk staff Social invitation', await service.from('social_publisher_grants')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('id', deskStaffGrantId))
    const revoked = await invokeDesk(deskStaff, { action: 'desk_operation', accountId, operation: 'comments.read' })
    assert.ok(revoked.status === 403 && revoked.body.code === 'social_access_required',
      'the next Desk request observes a revoked Social invitation')
    note('served Edge Function checks passed: staff gate, publisher-only Desk reads, account isolation, post context, write denial and revocation')
  }
  const hiddenTargetDownload = await invitee.sb.storage.from('social').download(objectPath)
  assert.ok(hiddenTargetDownload.error, 'private media is hidden when a post includes an inaccessible target')
  const readerDownload = await reader.sb.storage.from('social').download(objectPath)
  assert.ok(readerDownload.error, 'an unrelated signed-in reader cannot read private social media')
  const readerUpload = await reader.sb.storage.from('social').upload(`posts/${postId}/${randomUUID()}`, new Uint8Array([1]), {
    contentType: 'image/png',
    upsert: false,
  })
  assert.ok(readerUpload.error, 'an unrelated signed-in reader cannot upload private social media')

  const stored = expectNoError('store test Vault secret', await service.rpc('social_vault_put', {
    p_secret: 'fixture-secret-never-for-production',
    p_name: `social-test-${postId}`,
    p_description: 'short-lived adapter authorization test',
  }))
  vaultId = stored
  assert.equal(expectNoError('read test Vault secret', await service.rpc('social_vault_read', { p_secret_id: vaultId })), 'fixture-secret-never-for-production')
  const deniedVaultRead = await invitee.sb.rpc('social_vault_read', { p_secret_id: vaultId })
  assert.ok(deniedVaultRead.error, 'an authenticated publisher cannot read Vault secrets')

  expectNoError('revoke test grant', await service.from('social_publisher_grants').update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('id', grantId))
  assert.equal((await invitee.sb.rpc('social_has_access')).data, false)
  assert.equal(((await invitee.sb.from('social_posts').select('id').eq('id', postId)).data || []).length, 0)
  const revokedDownload = await invitee.sb.storage.from('social').download(objectPath)
  assert.ok(revokedDownload.error, 'revocation blocks later direct media reads in the existing session')

  note('publisher, administrator, unrelated reader, direct writes, private storage, immediate revocation and Vault boundaries passed')
} finally {
  if (vaultId) {
    const { error } = await service.rpc('social_vault_delete', { p_secret_id: vaultId })
    if (error) throw new Error(`remove test Vault secret: ${error.message}`)
  }
  await service.storage.from('social').remove([objectPath])
  await service.from('social_deliveries').delete().eq('id', otherDeliveryId)
  await service.from('social_deliveries').delete().eq('id', deliveryId)
  await service.from('social_attachments').delete().eq('id', attachmentId)
  await service.from('social_posts').delete().eq('id', postId)
  await service.from('social_accounts').delete().eq('id', accountId)
  await service.from('social_accounts').delete().eq('id', otherAccountId)
  if (grantId) await service.from('social_publisher_grants').delete().eq('id', grantId)
  if (deskStaffGrantId) await service.from('social_publisher_grants').delete().eq('id', deskStaffGrantId)
}
