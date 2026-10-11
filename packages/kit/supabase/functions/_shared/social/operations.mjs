const ID = /^[A-Za-z0-9._:-]{1,300}$/
const CURSOR = (value) => (typeof value === 'string' && value.length <= 2000 ? value : undefined)
const LIMIT = (value) => (Number.isInteger(value) && value > 0 && value <= 100 ? value : 25)
const DIRECT_AUTOMATION_EVENTS = Object.freeze({
  instagram: Object.freeze(['comment.received', 'message.received']),
  threads: Object.freeze(['comment.received']),
  linkedin: Object.freeze(['comment.received']),
})
const MANAGED_AUTOMATION_BACKENDS = Object.freeze(['zernio'])
const OPERATION_DEFINITIONS = Object.freeze([
  { operation: 'accounts.read', fields: [] },
  {
    operation: 'posts.read',
    fields: [
      { name: 'queryMode', type: 'select', choices: ['list', 'post', 'delivery'] },
      { name: 'referenceId', type: 'text', optional: true },
    ],
  },
  { operation: 'media.upload', fields: [{ name: 'attachmentId', type: 'attachment' }] },
  { operation: 'search.posts', fields: [{ name: 'query', type: 'text' }] },
  { operation: 'analytics.account.read', fields: [] },
  { operation: 'analytics.read', fields: [{ name: 'postId', type: 'text' }] },
  {
    operation: 'analytics.report.read',
    fields: [
      { name: 'from', type: 'date' },
      { name: 'to', type: 'date' },
      {
        name: 'metrics',
        type: 'metrics',
        choices: [
          'impressions',
          'reach',
          'engagement',
          'clicks',
          'views',
          'likes',
          'comments',
          'shares',
        ],
      },
    ],
  },
  {
    operation: 'profiles.read',
    fields: [
      { name: 'profileId', type: 'text', optional: true },
      { name: 'handle', type: 'text', optional: true },
    ],
  },
  {
    operation: 'graph.read',
    fields: [
      { name: 'kind', type: 'select', choices: ['following', 'followers', 'blocked', 'muted'] },
    ],
  },
  { operation: 'graph.follow', fields: [{ name: 'profileId', type: 'text' }] },
  { operation: 'graph.unfollow', fields: [{ name: 'profileId', type: 'text' }] },
  { operation: 'graph.block', fields: [{ name: 'profileId', type: 'text' }] },
  { operation: 'graph.unblock', fields: [{ name: 'profileId', type: 'text' }] },
  { operation: 'graph.mute', fields: [{ name: 'profileId', type: 'text' }] },
  { operation: 'graph.unmute', fields: [{ name: 'profileId', type: 'text' }] },
  { operation: 'comments.read', fields: [{ name: 'postId', type: 'text' }] },
  {
    operation: 'comments.write',
    fields: [
      { name: 'postId', type: 'text' },
      { name: 'commentId', type: 'text' },
      { name: 'text', type: 'textarea' },
    ],
  },
  {
    operation: 'messages.read',
    fields: [{ name: 'conversationId', type: 'text', optional: true }],
  },
  {
    operation: 'messages.write',
    fields: [
      { name: 'conversationId', type: 'text' },
      { name: 'text', type: 'textarea' },
    ],
  },
  { operation: 'notifications.read', fields: [] },
  {
    operation: 'notifications.seen',
    fields: [{ name: 'seenAt', type: 'datetime-local', optional: true }],
  },
  { operation: 'posts.cancelScheduled', fields: [{ name: 'jobId', type: 'text' }] },
  { operation: 'posts.deleteBackendRecord', fields: [{ name: 'recordId', type: 'text' }] },
  { operation: 'posts.removeFromPlatform', fields: [{ name: 'postId', type: 'text' }] },
  {
    operation: 'webhooks.verify',
    fields: [
      { name: 'headerName', type: 'text' },
      { name: 'signature', type: 'text' },
      { name: 'body', type: 'textarea' },
    ],
  },
  {
    operation: 'webhooks.decode',
    fields: [
      { name: 'headerName', type: 'text', optional: true },
      { name: 'headerValue', type: 'text', optional: true },
      { name: 'body', type: 'textarea' },
    ],
  },
])

function requiredId(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw Object.assign(new Error(`A valid ${label} is required.`), {
      code: 'operation_input_invalid',
    })
  return value
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function requiredHandle(value) {
  if (typeof value !== 'string' || !/^@?[A-Za-z0-9._:-]{1,120}$/.test(value))
    throw Object.assign(new Error('Enter a valid profile handle.'), {
      code: 'operation_input_invalid',
    })
  return value
}

function textInput(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 10000)
    throw Object.assign(new Error('Enter text of 1–10,000 characters.'), {
      code: 'operation_input_invalid',
    })
  return value
}

function ref(account, kind, fields) {
  return {
    kind,
    version: 1,
    backend: account.backend,
    platform: account.platform,
    accountId: account.accountId,
    ...fields,
  }
}

const accountRef = (account) => ref(account, 'connected-account', {})

export function operationAvailable(manifest, operation, platform) {
  const capability = operation === 'webhooks.decode' ? 'webhooks.verify' : operation
  return (
    Array.isArray(manifest?.capabilities) &&
    manifest.capabilities.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        item.operation === capability &&
        (item.platform === '*' || item.platform === platform) &&
        item.availability === 'available',
    )
  )
}

export function availableSocialOperations(manifest, platform, client, backend = 'default') {
  const webhooks = client?.adapter(backend, { acknowledgeUnsafe: true })?.webhooks
  return OPERATION_DEFINITIONS.filter(
    ({ operation }) =>
      operationAvailable(manifest, operation, platform) &&
      (!operation.startsWith('webhooks.') || typeof webhooks?.[operation.slice('webhooks.'.length)] === 'function'),
  ).map((definition) => ({
    ...definition,
    fields: definition.fields.map((field) => ({
      ...field,
      choices: field.choices ? [...field.choices] : undefined,
    })),
  }))
}

export function availableSocialAutomationRoutes(manifest, platform, client, backend = 'default') {
  const webhooks = client?.adapter(backend, { acknowledgeUnsafe: true })?.webhooks
  if (
    !operationAvailable(manifest, 'webhooks.verify', platform) ||
    typeof webhooks?.verify !== 'function' ||
    typeof webhooks?.decode !== 'function'
  )
    return []

  const eventTypes =
    backend === 'default'
      ? DIRECT_AUTOMATION_EVENTS[platform] || []
      : MANAGED_AUTOMATION_BACKENDS.includes(backend)
        ? ['comment.received', 'message.received']
        : []
  const routes = []

  if (
    eventTypes.includes('comment.received') &&
    operationAvailable(manifest, 'comments.read', platform) &&
    operationAvailable(manifest, 'comments.write', platform)
  ) {
    const destinations = ['public_reply']
    if (
      backend === 'default' &&
      platform === 'instagram' &&
      operationAvailable(manifest, 'comments.privateReply', platform)
    )
      destinations.push('private_dm')
    routes.push({ eventKind: 'comment', destinations })
  }

  if (
    eventTypes.includes('message.received') &&
    operationAvailable(manifest, 'messages.read', platform) &&
    operationAvailable(manifest, 'messages.write', platform)
  )
    routes.push({ eventKind: 'dm', destinations: ['private_dm'] })

  return routes
}

export async function invokeSocialOperation({ client, account, operation, input = {}, context }) {
  const page = { cursor: CURSOR(input.cursor), limit: LIMIT(input.limit) }
  const postRef = (postId) =>
    ref(account, 'platform-post', { postId: requiredId(postId, 'post id') })
  const commentRef = (postId, commentId) =>
    ref(account, 'comment', {
      postId: requiredId(postId, 'post id'),
      commentId: requiredId(commentId, 'comment id'),
    })
  const conversationRef = (conversationId) =>
    ref(account, 'conversation', {
      conversationId: requiredId(conversationId, 'conversation id'),
    })

  switch (operation) {
    case 'accounts.read':
      return client.accounts.get(accountRef(account))
    case 'posts.read':
      if (input.queryMode !== undefined && !['list', 'post', 'delivery'].includes(input.queryMode))
        throw Object.assign(new Error('Choose a supported posts view.'), {
          code: 'operation_input_invalid',
        })
      if (input.queryMode === 'delivery' || input.deliveryId) {
        return client.posts.getDelivery(
          ref(account, 'delivery', {
            deliveryId: requiredId(input.referenceId || input.deliveryId, 'delivery id'),
          }),
        )
      }
      if (input.queryMode === 'post' || input.postId)
        return client.posts.get(postRef(input.referenceId || input.postId))
      return client.posts.list(accountRef(account), page)
    case 'media.upload':
      if (!input.mediaAttachment || typeof input.mediaAttachment !== 'object')
        throw Object.assign(new Error('Choose a saved image or video attachment.'), {
          code: 'operation_input_invalid',
        })
      return client.media.upload(input.mediaAttachment, accountRef(account))
    case 'search.posts':
      if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 500)
        throw Object.assign(new Error('Enter a search phrase of up to 500 characters.'), {
          code: 'operation_input_invalid',
        })
      return client.search.posts(accountRef(account), {
        query: input.query.trim(),
        ...(page.cursor ? { cursor: page.cursor } : {}),
        limit: page.limit,
      })
    case 'analytics.account.read':
      return client.analytics.getAccountMetrics(accountRef(account))
    case 'analytics.read':
      return client.analytics.getPostMetrics(postRef(input.postId))
    case 'analytics.report.read': {
      const from = requiredId(input.from, 'start date')
      const to = requiredId(input.to, 'end date')
      const metrics =
        Array.isArray(input.metrics) && input.metrics.length <= 50
          ? input.metrics.filter(
              (value) => typeof value === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(value),
            )
          : []
      if (
        !validDate(from) ||
        !validDate(to) ||
        Date.parse(`${from}T00:00:00Z`) > Date.parse(`${to}T00:00:00Z`) ||
        !metrics.length
      )
        throw Object.assign(new Error('Choose a valid date range and at least one metric.'), {
          code: 'operation_input_invalid',
        })
      return client.analytics.getReport(accountRef(account), {
        from,
        to,
        metrics,
        ...(Array.isArray(input.dimensions)
          ? {
              dimensions: input.dimensions
                .filter((value) => typeof value === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(value))
                .slice(0, 50),
            }
          : {}),
      })
    }
    case 'profiles.read':
      if (
        (typeof input.profileId !== 'string' || !input.profileId) &&
        (typeof input.handle !== 'string' || !input.handle)
      )
        throw Object.assign(new Error('Enter a profile id or handle.'), {
          code: 'operation_input_invalid',
        })
      return client.graph.getProfile(accountRef(account), {
        ...(typeof input.profileId === 'string' && input.profileId
          ? { profileId: requiredId(input.profileId, 'profile id') }
          : {}),
        ...(typeof input.handle === 'string' && input.handle
          ? { handle: requiredHandle(input.handle) }
          : {}),
      })
    case 'graph.read':
      if (!['following', 'followers', 'blocked', 'muted'].includes(input.kind))
        throw Object.assign(new Error('Choose a supported relationship list.'), {
          code: 'operation_input_invalid',
        })
      return client.graph.listRelationships(accountRef(account), { kind: input.kind, ...page })
    case 'graph.follow':
    case 'graph.unfollow':
    case 'graph.block':
    case 'graph.unblock':
    case 'graph.mute':
    case 'graph.unmute': {
      const target = ref(account, 'profile', {
        profileId: requiredId(input.profileId, 'profile id'),
      })
      const method = operation.slice('graph.'.length)
      return client.graph[method](target)
    }
    case 'comments.read':
      return client.comments.list(postRef(input.postId), page, context)
    case 'comments.write':
      return client.comments.reply(commentRef(input.postId, input.commentId), {
        text: textInput(input.text),
      }, context)
    case 'messages.read':
      if (input.conversationId)
        return client.messages.listMessages(conversationRef(input.conversationId), page, context)
      return client.messages.listConversations(accountRef(account), page, context)
    case 'messages.write':
      return client.messages.send(conversationRef(input.conversationId), {
        text: textInput(input.text),
      }, context)
    case 'notifications.read':
      return client.notifications.list(accountRef(account), page)
    case 'notifications.seen':
      return client.notifications.markSeen(accountRef(account), {
        ...(typeof input.seenAt === 'string' ? { seenAt: input.seenAt } : {}),
      })
    case 'posts.cancelScheduled':
      return client.posts.cancelScheduled(
        ref(account, 'scheduled-job', {
          jobId: requiredId(input.jobId, 'scheduled job id'),
        }),
      )
    case 'posts.deleteBackendRecord':
      return client.posts.deleteBackendRecord(
        ref(account, 'backend-post', {
          recordId: requiredId(input.recordId, 'backend record id'),
        }),
      )
    case 'posts.removeFromPlatform':
      return client.posts.removeFromPlatform(postRef(input.postId))
    case 'webhooks.verify':
    case 'webhooks.decode': {
      if (
        typeof input.body !== 'string' ||
        (input.headers !== undefined &&
          (!input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers))) ||
        (input.headers && Object.keys(input.headers).length > 30) ||
        (input.headerName !== undefined &&
          (typeof input.headerName !== 'string' || !input.headerName)) ||
        (operation === 'webhooks.verify' && input.signature !== undefined &&
          (typeof input.signature !== 'string' || input.headerName === undefined)) ||
        (operation === 'webhooks.decode' &&
          ((input.headerName === undefined) !== (input.headerValue === undefined) ||
            (input.headerValue !== undefined && typeof input.headerValue !== 'string')))
      )
        throw Object.assign(new Error('Provide a valid webhook body and headers.'), {
          code: 'operation_input_invalid',
        })
      const body = new TextEncoder().encode(input.body)
      if (body.byteLength > 1_048_576)
        throw Object.assign(new Error('Webhook body must be no larger than 1 MiB.'), {
          code: 'operation_input_invalid',
        })
      const headers = new Headers()
      const headerEntries = input.headers ? Object.entries(input.headers) : []
      if (typeof input.headerName === 'string' && input.headerName) {
        headerEntries.push([
          input.headerName,
          operation === 'webhooks.verify' ? input.signature : input.headerValue,
        ])
      }
      if (headerEntries.length > 30)
        throw Object.assign(new Error('Provide no more than 30 webhook headers.'), {
          code: 'operation_input_invalid',
        })
      for (const [name, value] of headerEntries) {
        if (
          !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/.test(name) ||
          typeof value !== 'string' ||
          value.length > 4096
        )
          throw Object.assign(new Error('The webhook headers are invalid.'), {
            code: 'operation_input_invalid',
          })
        headers.set(name, value)
      }
      const adapter = client.adapter(account.backend || 'default', { acknowledgeUnsafe: true })
      const method = adapter.webhooks?.[operation.slice('webhooks.'.length)]
      if (typeof method !== 'function')
        throw Object.assign(new Error('This adapter does not support this webhook operation.'), {
          code: 'operation_unsupported',
        })
      return method.call(adapter.webhooks, { headers, body }, {
        backendInstance: account.backend || 'default',
        correlationId: crypto.randomUUID(),
        retryBudget: { maxAttempts: 1, maxElapsedMs: 60_000 },
      })
    }
    default:
      throw Object.assign(new Error('This social operation is not supported.'), {
        code: 'operation_unsupported',
      })
  }
}

export async function invokeNativeOperation({
  client,
  operation,
  input = {},
  allowed = [],
  backend = 'default',
}) {
  if (typeof operation !== 'string' || !allowed.includes(operation))
    throw Object.assign(new Error('This native social operation is not declared by the adapter.'), {
      code: 'operation_unsupported',
    })
  const native = client.native(backend, { acknowledgeUnsafe: true })
  const method = native?.[operation]
  if (typeof method !== 'function')
    throw Object.assign(new Error('This native social operation is not available.'), {
      code: 'operation_unsupported',
    })
  return method(input, {
    backendInstance: backend,
    correlationId: crypto.randomUUID(),
    retryBudget: { maxAttempts: 1, maxElapsedMs: 60_000 },
  })
}
