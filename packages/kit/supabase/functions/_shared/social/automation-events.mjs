const asRecord = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}

const asText = (value, max = 10000) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
    ? value.trim()
    : undefined

const asId = (value, max = 500) =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined

function normalized({
  accountId,
  eventId,
  eventKind,
  itemId,
  authorId,
  body,
  postId,
  commentId,
  conversationId,
}) {
  if (!accountId || !eventId || !itemId || !authorId || !body) return null
  return {
    externalAccountId: accountId,
    providerEventId: eventId,
    eventKind,
    itemId,
    authorId,
    body,
    ...(postId ? { postId } : {}),
    ...(commentId ? { commentId } : {}),
    ...(conversationId ? { conversationId } : {}),
  }
}

function normalizeInstagram(payload, event) {
  const result = []
  for (const entryValue of Array.isArray(payload.entry) ? payload.entry : []) {
    const entry = asRecord(entryValue)
    const accountId = asId(entry.id)
    for (const changeValue of Array.isArray(entry.changes) ? entry.changes : []) {
      const change = asRecord(changeValue)
      if (change.field !== 'comments') continue
      const value = asRecord(change.value)
      const commentId = asId(value.id)
      const item = normalized({
        accountId,
        eventId: event.id,
        eventKind: 'comment',
        itemId: commentId,
        authorId: asId(asRecord(value.from).id),
        body: asText(value.text),
        postId: asId(asRecord(value.media).id),
        commentId,
      })
      if (item) result.push(item)
    }
    for (const messagingValue of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const messaging = asRecord(messagingValue)
      const message = asRecord(messaging.message)
      const itemId = asId(message.mid)
      const recipientId = asId(asRecord(messaging.recipient).id)
      const conversationId = asId(asRecord(messaging.conversation).id) ?? recipientId
      const item = normalized({
        accountId,
        eventId: event.id,
        eventKind: 'dm',
        itemId,
        authorId: asId(asRecord(messaging.sender).id),
        body: asText(message.text),
        conversationId,
      })
      if (item) result.push(item)
    }
  }
  return result
}

function normalizeThreads(payload, event) {
  const values = asRecord(payload.values)
  if (values.field !== 'replies') return []
  const value = asRecord(values.value)
  const rootPost = asRecord(value.root_post)
  const commentId = asId(value.id)
  const item = normalized({
    accountId: asId(rootPost.owner_id),
    eventId: event.id,
    eventKind: 'comment',
    itemId: commentId,
    authorId: asId(asRecord(value.from).id),
    body: asText(value.text),
    postId: asId(rootPost.id),
    commentId,
  })
  return item ? [item] : []
}

function normalizeLinkedIn(payload, event) {
  const result = []
  for (const value of Array.isArray(payload.notifications) ? payload.notifications : []) {
    const notification = asRecord(value)
    if (notification.action !== 'COMMENT') continue
    const comment = asRecord(notification.comment)
    const actor = asRecord(notification.actor)
    const post = asRecord(notification.post)
    const itemId =
      asId(comment.commentId) ??
      asId(comment.id) ??
      asId(notification.commentId) ??
      asId(notification.entity)
    const item = normalized({
      accountId: asId(notification.organizationalEntity),
      eventId: event.id,
      eventKind: 'comment',
      itemId,
      authorId: asId(actor.id) ?? asId(notification.actor),
      body: asText(comment.text) ?? asText(notification.text),
      postId: asId(post.id) ?? asId(notification.postId),
      commentId: itemId,
    })
    if (item) result.push(item)
  }
  return result
}

function normalizeManaged(payload, event) {
  const data = asRecord(payload.data)
  const source = Object.keys(data).length ? data : payload
  const kind = event.type === 'comment.received' ? 'comment' : event.type === 'message.received' ? 'dm' : null
  if (!kind) return []
  const item = asRecord(kind === 'comment' ? source.comment ?? source : source.message ?? source)
  const account = asRecord(source.account)
  const author = asRecord(item.author ?? item.from ?? source.author)
  const post = asRecord(item.post ?? source.post)
  const conversation = asRecord(item.conversation ?? source.conversation)
  const itemId =
    asId(item.id) ??
    asId(item.commentId) ??
    asId(item.messageId) ??
    asId(item.message_id)
  const normalizedItem = normalized({
    accountId:
      asId(source.accountId) ??
      asId(source.social_account_id) ??
      asId(account.accountId) ??
      asId(account.id),
    eventId: event.id,
    eventKind: kind,
    itemId,
    authorId: asId(author.id) ?? asId(item.authorId) ?? asId(item.senderId),
    body: asText(item.text) ?? asText(item.body),
    postId: asId(item.postId) ?? asId(post.id),
    commentId: kind === 'comment' ? itemId : undefined,
    conversationId: asId(item.conversationId) ?? asId(conversation.id),
  })
  const providerId =
    asId(source.platform) ??
    asId(source.provider) ??
    asId(account.platform) ??
    asId(account.provider)
  return normalizedItem && providerId ? [{ ...normalizedItem, providerId }] : []
}

export function normalizeSocialAutomationEvents({ backend, provider, decoded, body }) {
  if (!decoded || typeof decoded.id !== 'string' || !decoded.id) return []
  let payload
  try {
    payload = asRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)))
  } catch {
    return []
  }
  if (backend === 'default') {
    const events =
      provider === 'instagram'
        ? normalizeInstagram(payload, decoded)
        : provider === 'threads'
          ? normalizeThreads(payload, decoded)
          : provider === 'linkedin'
            ? normalizeLinkedIn(payload, decoded)
            : []
    return events.map((event) => ({ ...event, providerId: provider }))
  }
  if (backend === 'zernio') return normalizeManaged(payload, decoded)
  return []
}
