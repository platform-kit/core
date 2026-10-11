const SOURCE = 'social'
const PAGE_SIZE = 100
const MAX_PAGES = 20
const PROFILE_WORKERS = 4

const text = (value) => (typeof value === 'string' && value.trim() ? value : null)
const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null)
const profileCache = new Map()

function avatarUrlOf(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function authorOf(message) {
  return object(message.author) || object(message.user) || object(message.from)
    || object(message.sender) || object(message.participant)
}

const authorNameOf = (message) => {
  const author = authorOf(message)
  return text(message.sender_name) || text(message.author_name)
    || text(author && author.displayName) || text(author && author.display_name) || text(author && author.name)
    || text(message.username) || text(message.handle)
    || text(author && author.username) || text(author && author.handle) || null
}
const timestamp = (value) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toISOString()
}
const authorIdOf = (message) => {
  const author = authorOf(message)
  return text(message.sender_id) || text(message.senderId) || text(message.author_id)
    || text(message.authorId) || text(author && author.id) || text(author && author.did)
}
const authorUsernameOf = (message) => {
  const author = authorOf(message)
  return text(message.sender_username) || text(message.author_username) || text(message.username)
    || text(message.handle) || text(message.screen_name)
    || text(author && author.username) || text(author && author.handle) || text(author && author.screen_name)
}
const authorAvatarOf = (message) => {
  const author = authorOf(message)
  const picture = object(author && author.picture)
  return avatarUrlOf(
    message.sender_avatar_url || message.author_avatar_url || message.avatar_url
      || message.profile_image_url || message.profile_picture_url || message.profilePictureUrl
      || (author && (author.avatarUrl || author.avatar_url || author.profile_image_url
        || author.profileImageUrl || author.profile_picture_url || author.profilePictureUrl
        || author.image_url || author.imageUrl || author.photo_url || author.photoUrl))
      || (picture && picture.url),
  )
}
const bodyOf = (message) => text(message.text) || text(message.body)
const idOf = (message) => text(message.id) || text(message.message_id) || text(message.comment_id)
const pageItems = (value) => {
  if (!object(value) || !Array.isArray(value.items)) {
    throw Object.assign(new Error('The provider returned an unsupported conversation response.'), {
      code: 'social_response_unsupported',
    })
  }
  return value.items
}

export function socialRef(accountId, kind, providerId) {
  return JSON.stringify([String(accountId), kind, String(providerId)])
}

function identity(row) {
  const value = row && row.social
  if (!value || !text(value.accountId) || !text(value.providerRef)) {
    throw new Error('The Social conversation reference is invalid.')
  }
  return socialRef(value.accountId, value.kind, value.providerRef)
}

function deskRow(account, kind, providerId, last, waiting, marks, operations = [], social = {}) {
  const id = socialRef(account.id, kind, providerId)
  const marked = marks[`${SOURCE}:${id}`]
  if (!waiting && marked === undefined) return null
  const waitingSince = waiting ? last.created_at : null
  const resolved = marked !== undefined && (!waitingSince || (marked && Date.parse(waitingSince) <= Date.parse(marked)))
  return {
    key: `${SOURCE}:${id}`,
    id,
    source: SOURCE,
    person: {
      id: last.authorId,
      name: last.authorName,
      username: last.authorUsername,
      avatarUrl: last.authorAvatarUrl,
      kind: 'reader',
    },
    detail: null,
    platform: account.provider_id,
    accountName: account.name || account.username || account.provider_id,
    conversationKind: kind,
    last: { body: last.body, at: last.created_at, mine: !waiting },
    unread: waiting && !resolved ? 1 : 0,
    waiting_since: resolved ? null : waitingSince,
    due: 0,
    resolved,
    at: last.created_at,
    assignee: null,
    canReply: !!(account.permissions && account.permissions.publish_now)
      && operations.some((item) => item && item.operation === (kind === 'dm' ? 'messages.write' : 'comments.write')),
    social: {
      accountId: account.id,
      providerId: account.provider_id,
      accountExternalId: account.external_id,
      kind,
      providerRef: providerId,
      accountName: account.name || account.username || account.provider_id,
      accountUsername: account.username || null,
      accountAvatarUrl: avatarUrlOf(account.avatar_url || account.avatarUrl || account.profile_image_url),
      profileRead: supports(operations, 'profiles.read'),
      ...social,
    },
  }
}

function normalizedMessage(account, message) {
  const value = object(message)
  const id = value && idOf(value)
  const authorId = value && authorIdOf(value)
  const createdAt = value && timestamp(value.created_at || value.createdAt)
  const body = value && bodyOf(value)
  if (!id || !authorId || !createdAt || !body) return null
  return {
    id,
    authorId,
    authorName: authorNameOf(value),
    authorUsername: authorUsernameOf(value),
    authorAvatarUrl: authorAvatarOf(value),
    created_at: createdAt,
    body,
    mine: authorId === account.external_id,
    parentId: parentIdOf(value),
    eventType: text(value.event_type),
  }
}

function parentIdOf(value) {
  if (!object(value)) return null
  if (text(value.parent_id) || text(value.parentId) || text(value.in_reply_to_status_id_str) || text(value.in_reply_to_tweet_id)) {
    return text(value.parent_id) || text(value.parentId) || text(value.in_reply_to_status_id_str) || text(value.in_reply_to_tweet_id)
  }
  if (Array.isArray(value.referenced_tweets)) {
    const parent = value.referenced_tweets.find((item) => item && item.type === 'replied_to')
    return parent && text(parent.id)
  }
  return null
}

export function dmRowsOf(events, account, marks = {}, operations = []) {
  const latest = new Map()
  for (const event of events || []) {
    const eventType = object(event) && text(event.event_type)
    if (eventType && eventType !== 'MessageCreate') {
      throw Object.assign(new Error('The provider returned an unsupported direct-message event.'), {
        code: 'social_response_unsupported',
      })
    }
    const message = normalizedMessage(account, event)
    const conversationId = object(event) && (text(event.dm_conversation_id) || text(event.conversation_id))
    if (!message || !conversationId) {
      throw Object.assign(new Error('The provider did not identify direct-message authors, conversations and activity.'), {
        code: 'social_response_unsupported',
      })
    }
    const previous = latest.get(conversationId)
    if (previous && previous.created_at === message.created_at && previous.authorId !== message.authorId) {
      throw Object.assign(new Error('The provider did not establish the latest direct-message author.'), {
        code: 'social_response_unsupported',
      })
    }
    if (!previous || Date.parse(message.created_at) > Date.parse(previous.created_at)
      || (message.created_at === previous.created_at && message.id.localeCompare(previous.id) > 0)) {
      latest.set(conversationId, message)
    }
  }
  const out = []
  for (const [conversationId, message] of latest) {
    const row = deskRow(account, 'dm', conversationId, message, !message.mine, marks, operations, {
      conversationId,
      latestMessageId: message.id,
    })
    if (row) out.push(row)
  }
  return out
}

function threadRoot(message, byId, postId) {
  let current = message
  const seen = new Set()
  while (current.parentId && current.parentId !== postId) {
    if (seen.has(current.id)) return null
    seen.add(current.id)
    current = byId.get(current.parentId)
    if (!current) return null
  }
  return current.parentId === postId ? current.id : null
}

export function commentRowsOf(comments, account, post, marks = {}, operations = []) {
  const postBody = text(post && post.body)
  if (!postBody) {
    throw Object.assign(new Error('The source Social post is unavailable.'), {
      code: 'social_response_unsupported',
    })
  }
  const normalized = (comments || []).map((item) => normalizedMessage(account, item))
  if (normalized.some((item) => !item)) {
    throw Object.assign(new Error('The provider did not identify comment authors and activity.'), {
      code: 'social_response_unsupported',
    })
  }
  const byId = new Map(normalized.map((item) => [item.id, item]))
  const threads = new Map()
  for (const comment of normalized) {
    const root = threadRoot(comment, byId, post.provider_post_id)
    if (!root) {
      throw Object.assign(new Error('The provider did not return a complete comment thread.'), {
        code: 'social_thread_incomplete',
      })
    }
    const list = threads.get(root) || []
    list.push(comment)
    threads.set(root, list)
  }
  const out = []
  for (const [root, messages] of threads) {
    messages.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    const last = messages[messages.length - 1]
    const row = deskRow(account, 'comment', root, last, !last.mine, marks, operations, {
      postId: post.provider_post_id,
      postTitle: post.title || null,
      postBody,
      threadId: root,
      latestCommentId: last.id,
      commentIds: messages.map((item) => item.id),
    })
    if (row) out.push(row)
  }
  return out
}

function failure(account, kind, reason) {
  return {
    account: account.name || account.username || account.provider_id,
    kind,
    reason,
  }
}

async function invoke(supabase, action, fields = {}) {
  const { data, error } = await supabase.functions.invoke('social', { body: { action, ...fields } })
  if (error) throw error
  if (data && data.error) {
    throw Object.assign(new Error(data.error), { code: data.code || 'social_operation_failed' })
  }
  return data || {}
}

async function operation(supabase, accountId, name, input = {}) {
  const response = await invoke(supabase, 'desk_operation', { accountId, operation: name, input })
  return response.result
}

async function pages(supabase, accountId, name, input = {}) {
  const result = []
  const cursors = new Set()
  let cursor
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await operation(supabase, accountId, name, {
      ...input,
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    })
    result.push(...pageItems(response))
    if (!response.nextCursor) return result
    if (cursors.has(response.nextCursor)) break
    cursors.add(response.nextCursor)
    cursor = response.nextCursor
  }
  throw Object.assign(new Error('The provider conversation list is incomplete.'), {
    code: 'social_listing_incomplete',
  })
}

function supports(operations, name) {
  return operations.some((item) => item && item.operation === name)
}

function profileFields(result) {
  const profile = object(result && result.profile) || object(result && result.user) || object(result)
  if (!profile) return { unavailable: true }
  return {
    name: text(profile.displayName) || text(profile.display_name) || text(profile.name),
    username: text(profile.handle) || text(profile.username) || text(profile.screen_name),
    avatarUrl: avatarUrlOf(
      profile.avatarUrl || profile.avatar_url || profile.profileImageUrl || profile.profile_image_url
        || profile.profilePictureUrl || profile.profile_picture_url || profile.picture_url,
    ),
  }
}

async function readProfile(supabase, accountId, profileId) {
  const key = `${accountId}:${profileId}`
  if (profileCache.has(key)) return profileCache.get(key)
  const pending = operation(supabase, accountId, 'profiles.read', { profileId }).then(profileFields)
  profileCache.set(key, pending)
  try {
    return await pending
  } catch {
    if (profileCache.get(key) === pending) profileCache.delete(key)
    return { unavailable: true }
  }
}

function needsProfile(person) {
  return !person.name || !person.username || !person.avatarUrl
}

async function enrichPeople(supabase, accountId, profileRead, people) {
  const unique = [...new Map(people
    .filter((person) => person && person.id && needsProfile(person))
    .map((person) => [person.id, person])).values()]
  let next = 0
  await Promise.all(Array.from({ length: Math.min(PROFILE_WORKERS, unique.length) }, async () => {
    while (next < unique.length) {
      const person = unique[next++]
      if (!profileRead) {
        person.profileUnavailable = true
        continue
      }
      const profile = await readProfile(supabase, accountId, person.id)
      person.name = person.name || profile.name
      person.username = person.username || profile.username
      person.avatarUrl = person.avatarUrl || profile.avatarUrl
      person.profileUnavailable = !!profile.unavailable || !person.username || !person.avatarUrl
    }
  }))
}

export async function list(supabase, marks = {}) {
  const { accounts = [] } = await invoke(supabase, 'desk_accounts')
  const authorized = accounts.filter((account) =>
    account && account.status === 'connected' && account.permissions
      && account.permissions.view_results && account.permissions.publish_now)
  if (!authorized.length) return { rows: [], failures: [], availableAccounts: 0 }

  let posts = []
  let postFailure = null
  let postsTruncated = false
  try {
    const response = await invoke(supabase, 'desk_posts')
    posts = Array.isArray(response.posts) ? response.posts : []
    postsTruncated = response.truncated === true
  } catch {
    postFailure = { kind: 'comment', reason: 'provider-failed' }
  }

  const rows = []
  const failures = postFailure ? [postFailure] : []
  if (postsTruncated) failures.push({ kind: 'comment', reason: 'listing-truncated' })
  for (const account of authorized) {
    try {
      const { operations = [] } = await invoke(supabase, 'desk_capabilities', { accountId: account.id })
      const accountRows = []
      if (supports(operations, 'messages.read')) {
        const conversations = await pages(supabase, account.id, 'messages.read')
        accountRows.push(...dmRowsOf(conversations, account, marks, operations))
      } else {
        failures.push(failure(account, 'message', 'unsupported'))
      }
      const accountPosts = posts.filter((post) => post.account_id === account.id && post.provider_post_id)
      if (accountPosts.length) {
        if (!supports(operations, 'comments.read')) {
          failures.push(failure(account, 'comment', 'unsupported'))
        } else {
          for (const post of accountPosts) {
            try {
              const comments = await pages(supabase, account.id, 'comments.read', { postId: post.provider_post_id })
              accountRows.push(...commentRowsOf(comments, account, post, marks, operations))
            } catch {
              failures.push(failure(account, 'comment', 'provider-failed'))
            }
          }
          await enrichPeople(
            supabase,
            account.id,
            supports(operations, 'profiles.read'),
            accountRows.map((row) => row.person),
          )
          rows.push(...accountRows)
        }
      }
    } catch {
      failures.push(failure(account, 'conversation', 'provider-failed'))
    }
  }
  return { rows, failures, availableAccounts: authorized.length }
}

export async function messages(supabase, row) {
  const identity = row && row.social
  if (!identity) throw new Error('The Social conversation reference is invalid.')
  let raw
  const account = {
    id: identity.accountId,
    external_id: identity.accountExternalId,
    provider_id: identity.providerId,
    name: identity.accountName,
    username: identity.accountUsername,
    avatarUrl: identity.accountAvatarUrl,
  }
  if (identity.kind === 'dm') {
    raw = await pages(supabase, identity.accountId, 'messages.read', { conversationId: identity.conversationId })
  } else if (identity.kind === 'comment') {
    raw = await pages(supabase, identity.accountId, 'comments.read', { postId: identity.postId })
    const post = { provider_post_id: identity.postId }
    const normalized = raw.map((item) => normalizedMessage(account, item))
    if (normalized.some((item) => !item)) {
      throw new Error('The provider returned an unsupported conversation response.')
    }
    const byId = new Map(normalized.map((item) => [item.id, item]))
    const selected = normalized
      .filter((item) => threadRoot(item, byId, post.provider_post_id) === identity.threadId)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
    if (!selected.length) {
      throw new Error('The provider conversation is no longer available.')
    }
    return enrichMessages(supabase, identity, selected)
  } else {
    throw new Error('The Social conversation kind is unsupported.')
  }
  const normalized = raw.map((item) => normalizedMessage(account, item))
  if (normalized.some((item) => !item)) {
    throw new Error('The provider returned an unsupported conversation response.')
  }
  return enrichMessages(supabase, identity, normalized)
}

async function enrichMessages(supabase, identity, messages) {
  const profiles = new Map()
  const authors = messages.filter((message) => !message.mine && needsProfile({
    name: message.authorName,
    username: message.authorUsername,
    avatarUrl: message.authorAvatarUrl,
  }))
  const people = authors.map((message) => ({
    id: message.authorId,
    name: message.authorName,
    username: message.authorUsername,
    avatarUrl: message.authorAvatarUrl,
  }))
  await enrichPeople(supabase, identity.accountId, identity.profileRead, people)
  for (const person of people) profiles.set(person.id, person)
  return messages.map((message) => {
    const own = message.mine
    const profile = profiles.get(message.authorId)
    const name = message.authorName || (own ? identity.accountName : null) || (profile && profile.name)
    const username = message.authorUsername || (own ? identity.accountUsername : null) || (profile && profile.username)
    const avatarUrl = message.authorAvatarUrl || (own ? identity.accountAvatarUrl : null) || (profile && profile.avatarUrl)
    return {
      id: message.id,
      body: message.body,
      kind: 'text',
      created_at: message.created_at,
      mine: own,
      author: name || username || null,
      authorUsername: username || null,
      authorAvatarUrl: avatarUrl || null,
      authorProfileUnavailable: !own && (!name || !username || !avatarUrl)
        && (!identity.profileRead || !profile || profile.profileUnavailable === true),
    }
  })
}

export async function send(supabase, row, body) {
  const social = row && row.social
  const textBody = String(body || '').trim()
  if (!social || !textBody) throw new Error('A Social conversation and reply are required.')
  let response
  if (social.kind === 'dm') {
    response = await operation(supabase, social.accountId, 'messages.write', {
      conversationId: social.conversationId,
      text: textBody,
    })
  } else if (social.kind === 'comment') {
    response = await operation(supabase, social.accountId, 'comments.write', {
      postId: social.postId,
      commentId: social.latestCommentId,
      text: textBody,
    })
  } else {
    throw new Error('The Social conversation kind is unsupported.')
  }
  const result = object(response)
  const confirmedId = result && (
    text(result.id) || text(result.messageId) || text(result.message_id) ||
    text(result.commentId) || text(result.comment_id) || text(result.postId)
  )
  if (!confirmedId) {
    throw Object.assign(new Error('The provider did not confirm the reply. Reconcile the conversation before retrying.'), {
      code: 'ambiguous_outcome',
    })
  }
  return confirmedId
}

export async function resolve(supabase, row, done, userId) {
  const ref = identity(row)
  const query = supabase.from('desk_done')
  if (done) {
    const { error } = await query.upsert(
      { user_id: userId, source: SOURCE, ref, resolved_at: new Date().toISOString() },
      { onConflict: 'user_id,source,ref' },
    )
    if (error) throw error
  } else {
    const { error } = await query.delete().eq('user_id', userId).eq('source', SOURCE).eq('ref', ref)
    if (error) throw error
  }
}

export async function read() {}

export const id = SOURCE
export const module = 'social-publishing'
export const icon = 'dm'
