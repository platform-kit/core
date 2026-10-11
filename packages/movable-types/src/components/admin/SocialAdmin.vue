<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { AgGridVue } from 'ag-grid-vue3'
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community'
import { useAgGridTheme } from '../../lib/agGridTheme.js'
import { supabase } from '@platform-kit/kit/lib/supabase.js'
import { isAdmin } from '@platform-kit/kit/lib/auth.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import AdminHead from './AdminHead.vue'
import SocialAutomations from './social/SocialAutomations.vue'

ModuleRegistry.registerModules([AllCommunityModule])
const gridTheme = useAgGridTheme()
const W = us('social')
const AUTOMATIONS = W.automations?.main || {}
const PAGE = W.page?.main || {}
const POSTS = W.page?.posts || {}
const COMMENTS = W.page?.comments || {}
const ANALYTICS = W.page?.analytics || {}
const INBOX = W.page?.inbox || {}
const EXPLORE = W.page?.explore || {}
const PAGE_OAUTH = W.page?.oauth || {}
const PAGE_STATUS = W.page?.status || {}
const EDITOR = W.editor?.compose || {}
const ACCOUNT_WORDS = W.accounts?.main || {}
const ACCOUNT_OPERATIONS = W.accounts?.operations || {}
const ACCOUNT_STATUS = W.accounts?.status || {}
const BACKEND_NAMES = W.accounts?.backends || {}
const ACCESS = W.access?.publishers || {}
const ACCESS_STATUS = W.access?.status || {}
const ACCESS_ACTIONS = [
  ['read_posts', 'read-posts'],
  ['create_posts', 'create-posts'],
  ['edit_posts', 'edit-posts'],
  ['schedule_posts', 'schedule-posts'],
  ['approve_posts', 'approve-posts'],
  ['publish_now', 'publish-now'],
  ['view_results', 'view-results'],
]
const UTC_HERE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()
const timeZones = (() => {
  try {
    return typeof Intl.supportedValuesOf === 'function'
      ? [...new Set(['UTC', UTC_HERE, ...Intl.supportedValuesOf('timeZone')])].sort()
      : [...new Set(['UTC', UTC_HERE])]
  } catch {
    return [...new Set(['UTC', UTC_HERE])]
  }
})()

const state = ref('loading')
const busy = ref(false)
const errorText = ref('')
const notice = ref('')
const accounts = ref([])
const providers = ref([])
const backends = ref([])
const managedProfiles = ref([])
const publishers = ref([])
const pendingApprovals = ref([])
const canManageSocialAccounts = ref(false)
const selectedPublisherId = ref('')
const publisherCanManageAccounts = ref(false)
const publisherPermissionDraft = ref({})
const posts = ref([])
const activeView = ref('calendar')
const mode = ref(
  typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches
    ? 'week'
    : 'month',
)
const timezone = ref(UTC_HERE)
const anchorDay = ref(dayKey(new Date(), UTC_HERE))
const editorOpen = ref(false)
const form = reactive({
  id: '',
  text: '',
  timezone: UTC_HERE,
  scheduledLocal: '',
  accountIds: [],
  targetOptions: {},
  attachments: [],
})
const providerForm = reactive({ providerId: 'x', clientId: '', clientSecret: '' })
const backendForm = reactive({ backendId: '', apiKey: '', webhookSecret: '' })
const managedConnectForm = reactive({ backendId: '', platform: '', profileId: '' })
const inviteEmail = ref('')
const settingsPane = ref('providers')
const accountInspector = reactive({
  openId: '',
  loadingId: '',
  error: '',
})
const accountOperations = reactive({})
const workspaceAccountId = ref('')
const selectedPostId = ref('')
const selectedDeliveryId = ref('')
const workspaceMode = ref('messages')
const workspaceRecords = ref([])
const workspaceMessages = ref([])
const workspaceSelectedId = ref('')
const workspaceLoading = ref(false)
const workspaceBusy = ref(false)
const workspaceError = ref('')
const workspaceQuery = ref('')
const workspaceReply = ref('')
const workspaceProfile = ref(null)
const providerPostRows = ref([])
const providerPostDetail = ref(null)
const analyticsAccount = ref(null)
const analyticsSnapshots = ref([])
const analyticsFrom = ref(plusDays(dayKey(new Date(), UTC_HERE), -30))
const analyticsTo = ref(dayKey(new Date(), UTC_HERE))
const canReviewApprovals = computed(
  () =>
    isAdmin.value ||
    accounts.value.some((account) => account.permissions?.approve_posts === true),
)
const connectedAccounts = computed(() =>
  accounts.value.filter((account) => account.status === 'connected'),
)
const canViewAutomations = computed(() =>
  accounts.value.some((account) => account.permissions?.view_results === true),
)
const workspaceNavigation = computed(() =>
  [
    {
      key: 'publish',
      label: PAGE['nav-publish'],
      items: [
        { key: 'calendar', label: PAGE['calendar-tab'] },
        { key: 'drafts', label: PAGE['drafts-tab'] },
        { key: 'posts', label: POSTS.title },
      ],
    },
    {
      key: 'engage',
      label: PAGE['nav-engage'],
      items: [
        { key: 'comments', label: COMMENTS.title },
        { key: 'inbox', label: INBOX.title },
        ...(canViewAutomations.value
          ? [{ key: 'automations', label: AUTOMATIONS.title }]
          : []),
      ],
    },
    {
      key: 'insights',
      label: PAGE['nav-insights'],
      items: [
        { key: 'analytics', label: ANALYTICS.title },
        { key: 'explore', label: EXPLORE.title },
      ],
    },
    {
      key: 'manage',
      label: PAGE['nav-manage'],
      items: [
        { key: 'accounts', label: PAGE['accounts-tab'] },
        ...(canReviewApprovals.value
          ? [{ key: 'approvals', label: ACCESS['approvals-tab'] }]
          : []),
        ...(isAdmin.value ? [{ key: 'settings', label: PAGE['settings-tab'] }] : []),
      ],
    },
  ].filter((group) => group.items.length),
)

function dayKey(date, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}
function dateAtNoon(key) {
  return new Date(`${key}T12:00:00Z`)
}
function plusDays(key, count) {
  const date = new Date(`${key}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}
function mondayOf(key) {
  const date = new Date(`${key}T00:00:00Z`)
  return plusDays(key, -((date.getUTCDay() + 6) % 7))
}
function dayLabel(key, options = { weekday: 'short' }) {
  return dateAtNoon(key).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' })
}
function localInputOf(iso, zone) {
  if (!iso) return ''
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
function zonedInputToIso(value, zone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const desired = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5])
  let instant = desired
  for (let index = 0; index < 5; index++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value]),
    )
    const represented = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
    )
    const difference = desired - represented
    instant += difference
    if (difference === 0) break
  }
  if (localInputOf(new Date(instant).toISOString(), zone) !== value) return null
  return new Date(instant).toISOString()
}

async function invoke(endpoint, body) {
  const { data, error } = await supabase.functions.invoke(endpoint, { body })
  if (error) {
    let message = error.message || PAGE['request-failed']
    let databaseCode = ''
    if (error.context instanceof Response) {
      try {
        const detail = await error.context.json()
        if (typeof detail?.error === 'string') message = detail.error
        if (
          typeof detail?.databaseCode === 'string' &&
          /^[A-Za-z0-9_-]{1,32}$/.test(detail.databaseCode)
        )
          databaseCode = detail.databaseCode
        if (Array.isArray(detail?.targetErrors)) {
          const targetLines = detail.targetErrors.flatMap((target) => {
            const account = accounts.value.find((item) => item.id === target.accountId)
            const accountName = account
              ? `${account.provider_id} · @${account.username}`
              : target.accountId
            return (target.issues || []).map((issue) => {
              const attachment = form.attachments.find((item) => item.id === issue.attachmentId)
              const reason = attachment
                ? `${attachment.file_name}: ${issue.message}`
                : issue.message || issue.code
              return EDITOR['target-error-line']
                .replace('{account}', accountName)
                .replace('{reason}', reason)
            })
          })
          if (targetLines.length) message = [message, ...targetLines].join('\n')
        }
      } catch {
        /* retain the function client's explicit error */
      }
    }
    if (databaseCode) message = `${message} [${databaseCode}]`
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data || {}
}
async function social(action, fields = {}) {
  return invoke('social', { action, ...fields })
}
async function withPreview(attachment) {
  const { data, error } = await supabase.storage
    .from('social')
    .createSignedUrl(attachment.object_path, 3600)
  if (error) throw new Error(ACCOUNT_WORDS['media-preview-failed'] || error.message)
  return { ...attachment, previewUrl: data.signedUrl }
}
async function load() {
  state.value = 'loading'
  errorText.value = ''
  try {
    const [accountResult, providerResult, postResult] = await Promise.all([
      social('accounts'),
      social('providers'),
      social('drafts'),
    ])
    accounts.value = accountResult.accounts || []
    canManageSocialAccounts.value = accountResult.canManageAccounts === true
    providers.value = providerResult.providers || []
    backends.value = providerResult.backends || []
    if (!providers.value.some((provider) => provider.id === providerForm.providerId))
      providerForm.providerId = providers.value[0]?.id || ''
    if (!backends.value.some((backend) => backend.id === backendForm.backendId))
      backendForm.backendId = backends.value[0]?.id || ''
    if (!backends.value.some((backend) => backend.id === managedConnectForm.backendId))
      managedConnectForm.backendId =
        backends.value.find((backend) => backend.configured)?.id || ''
    const connectBackend = backends.value.find(
      (backend) => backend.id === managedConnectForm.backendId,
    )
    if (!connectBackend?.platforms?.includes(managedConnectForm.platform))
      managedConnectForm.platform = connectBackend?.platforms?.[0] || ''
    if (managedConnectForm.backendId === 'zernio' && connectBackend?.configured)
      await loadManagedProfiles()
    posts.value = await Promise.all(
      (postResult.posts || []).map(async (post) => ({
        ...post,
        attachments: await Promise.all((post.attachments || []).map(withPreview)),
      })),
    )
    if (!posts.value.some((post) => post.id === selectedPostId.value))
      selectedPostId.value = posts.value[0]?.id || ''
    if (isAdmin.value) {
      const publisherResult = await social('publishers')
      publishers.value = publisherResult.publishers || []
      if (!publishers.value.some((publisher) => publisher.id === selectedPublisherId.value))
        selectedPublisherId.value = ''
    } else publishers.value = []
    state.value = 'ready'
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
    state.value = 'error'
  }
}

function operationKey(operation) {
  return operation
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replaceAll('.', '-')
    .toLowerCase()
}
function operationLabel(operation) {
  return ACCOUNT_OPERATIONS[`operation-${operationKey(operation)}`] || ''
}
function backendName(backend) {
  return BACKEND_NAMES[backend.id] || backend.id
}
async function ensureAccountOperations(accountId) {
  if (accountOperations[accountId]) return accountOperations[accountId]
  const result = await social('account_capabilities', { accountId })
  accountOperations[accountId] = result.operations || []
  return accountOperations[accountId]
}
function hasOperation(accountId, operation) {
  return (accountOperations[accountId] || []).some((item) => item.operation === operation)
}
function accountViews(account) {
  const operations = accountOperations[account.id] || []
  const routes = [
    ['posts', ['posts.read']],
    ['comments', ['comments.read', 'comments.write']],
    ['analytics', ['analytics.account.read', 'analytics.read']],
    ['inbox', ['messages.read', 'messages.write', 'notifications.read', 'notifications.seen']],
    ['explore', ['search.posts', 'profiles.read', 'graph.read', 'graph.follow', 'graph.unfollow', 'graph.block', 'graph.unblock', 'graph.mute', 'graph.unmute']],
  ]
  return routes
    .filter(([, names]) => operations.some((item) => names.includes(item.operation)))
    .map(([view]) => view)
}
async function toggleAccountDetails(account) {
  if (accountInspector.openId === account.id) {
    accountInspector.openId = ''
    return
  }
  accountInspector.openId = account.id
  accountInspector.error = ''
  if (accountOperations[account.id]) return
  accountInspector.loadingId = account.id
  try {
    await ensureAccountOperations(account.id)
  } catch (error) {
    accountInspector.error =
      error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
  } finally {
    accountInspector.loadingId = ''
  }
}
async function invokeCapability(accountId, operation, input = {}) {
  if (!hasOperation(accountId, operation)) {
    throw new Error(ACCOUNT_OPERATIONS['operation-unavailable'])
  }
  const result = await social('account_operation', { accountId, operation, input })
  return result.result ?? result
}
function currentAccount() {
  return accounts.value.find((account) => account.id === workspaceAccountId.value) || null
}
async function openAccountView(view, account) {
  workspaceAccountId.value = account.id
  await setView(view)
}
async function setView(view) {
  const allowed = [
    'calendar',
    'drafts',
    'posts',
    'comments',
    'analytics',
    'inbox',
    'explore',
    'accounts',
    'settings',
    'approvals',
    'automations',
  ]
  if (!allowed.includes(view) || (view === 'settings' && !isAdmin.value)) return
  activeView.value = view
  workspaceError.value = ''
  workspaceRecords.value = []
  workspaceMessages.value = []
  workspaceSelectedId.value = ''
  workspaceProfile.value = null
  if (
    view === 'calendar' ||
    view === 'drafts' ||
    view === 'accounts' ||
    view === 'settings' ||
    view === 'automations'
  ) return
  if (view === 'approvals') {
    try {
      workspaceLoading.value = true
      const queue = await social('approval_queue')
      pendingApprovals.value = queue.deliveries || []
    } catch (error) {
      workspaceError.value = error instanceof Error ? error.message : PAGE['request-failed']
    } finally {
      workspaceLoading.value = false
    }
    return
  }
  const account = currentAccount() || accounts.value.find((item) => item.status === 'connected')
  if (!account) {
    workspaceAccountId.value = ''
    if (view === 'analytics') {
      try {
        workspaceLoading.value = true
        await loadAnalytics()
      } catch (error) {
        workspaceError.value =
          error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
      } finally {
        workspaceLoading.value = false
      }
    }
    return
  }
  workspaceAccountId.value = account.id
  if (view === 'posts') {
    try {
      workspaceLoading.value = true
      await ensureAccountOperations(account.id)
      await loadProviderPosts()
    } catch (error) {
      workspaceError.value =
        error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
    } finally {
      workspaceLoading.value = false
    }
    return
  }
  try {
    workspaceLoading.value = true
    await ensureAccountOperations(account.id)
    if (view === 'comments') await loadComments()
    else if (view === 'analytics') await loadAnalytics()
    else if (view === 'inbox') await loadInbox()
  } catch (error) {
    workspaceError.value =
      error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
  } finally {
    workspaceLoading.value = false
  }
  async function loadProviderPosts() {
    providerPostRows.value = []
    providerPostDetail.value = null
    if (!hasOperation(workspaceAccountId.value, 'posts.read')) return
    const result = await invokeCapability(workspaceAccountId.value, 'posts.read', {
      queryMode: 'list',
    })
    providerPostRows.value = workspaceRows(result, ['posts', 'items', 'results'])
  }
  async function inspectProviderPost(item) {
    const referenceId = recordId(item?._source, ['postId', 'post_id', 'id', 'ref'])
    if (!referenceId || !hasOperation(workspaceAccountId.value, 'posts.read')) return
    workspaceSelectedId.value = item._key
    workspaceLoading.value = true
    workspaceError.value = ''
    try {
      const result = await invokeCapability(workspaceAccountId.value, 'posts.read', {
        queryMode: 'post',
        referenceId,
      })
      providerPostDetail.value = result
    } catch (error) {
      workspaceError.value =
        error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
    } finally {
      workspaceLoading.value = false
    }
  }
  async function inspectProviderDelivery(delivery) {
    if (!delivery?.provider_post_id || !hasOperation(delivery.account_id, 'posts.read')) return
    workspaceAccountId.value = delivery.account_id
    await ensureAccountOperations(delivery.account_id)
    workspaceLoading.value = true
    workspaceError.value = ''
    try {
      providerPostDetail.value = await invokeCapability(delivery.account_id, 'posts.read', {
        queryMode: 'delivery',
        referenceId: delivery.provider_post_id,
      })
    } catch (error) {
      workspaceError.value =
        error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
    } finally {
      workspaceLoading.value = false
    }
  }
  async function removeProviderPost(item) {
    const postId = recordId(item?._source, ['postId', 'post_id', 'id', 'ref'])
    if (!postId || !hasOperation(workspaceAccountId.value, 'posts.removeFromPlatform')) return
    if (!window.confirm(POSTS['remove-confirm'])) return
    workspaceBusy.value = true
    workspaceError.value = ''
    try {
      await invokeCapability(workspaceAccountId.value, 'posts.removeFromPlatform', { postId })
      await loadProviderPosts()
    } catch (error) {
      workspaceError.value =
        error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
    } finally {
      workspaceBusy.value = false
    }
  }
  async function removePublishedDelivery(delivery) {
    if (!delivery?.provider_post_id) return
    try {
      await ensureAccountOperations(delivery.account_id)
    } catch (error) {
      workspaceError.value =
        error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
      return
    }
    if (!hasOperation(delivery.account_id, 'posts.removeFromPlatform')) return
    if (!window.confirm(POSTS['remove-confirm'])) return
    workspaceBusy.value = true
    workspaceError.value = ''
    try {
      await invokeCapability(delivery.account_id, 'posts.removeFromPlatform', {
        postId: delivery.provider_post_id,
      })
      await load()
    } catch (error) {
      workspaceError.value =
        error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
    } finally {
      workspaceBusy.value = false
    }
  }
}
function recordValue(item, keys) {
  for (const key of keys) {
    const value = item?.[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}
function recordId(item, keys = ['id', 'ref', 'postId', 'post_id', 'commentId', 'comment_id', 'conversationId', 'conversation_id', 'profileId', 'profile_id', 'did']) {
  for (const key of keys) {
    const value = item?.[key]
    if (typeof value === 'string' && value.trim()) return value
    if (value && typeof value === 'object' && typeof value.id === 'string') return value.id
  }
  return ''
}
function resultItems(result, names = []) {
  const value = result?.result ?? result
  if (Array.isArray(value)) return value
  const containers = [value, value?.data, value?.result]
  const keys = [...names, 'items', 'records', 'results', 'data']
  for (const container of containers) {
    for (const key of keys) {
      if (Array.isArray(container?.[key])) return container[key]
    }
  }
  return value && typeof value === 'object' ? [value] : []
}
function workspaceRows(result, names = []) {
  return resultItems(result, names).map((source, index) => ({
    _source: source,
    _key: recordId(source) || `record-${index}`,
    _title:
      recordValue(source, ['text', 'body', 'message', 'name', 'displayName', 'title', 'subject', 'handle', 'username']) ||
      EXPLORE['unnamed-record'] ||
      '',
    _subtitle: recordValue(source, ['authorName', 'author_name', 'author', 'handle', 'username', 'createdAt', 'created_at']),
    _status: recordValue(source, ['status', 'state', 'deliveryStatus', 'delivery_status']),
  }))
}
function workspaceDetail(item) {
  if (!item?._source) return ''
  return recordValue(item._source, ['text', 'body', 'message', 'description', 'content', 'title', 'name'])
}
function workspaceAuthor(item) {
  const source = item?._source || {}
  return recordValue(source, ['authorName', 'author_name', 'author', 'displayName', 'username', 'handle'])
}
function workspaceTimestamp(item) {
  return recordValue(item?._source, ['createdAt', 'created_at', 'publishedAt', 'published_at', 'timestamp', 'updatedAt', 'updated_at'])
}
function workspaceSelection(item) {
  workspaceSelectedId.value = item?._key || ''
}
const workspaceSelected = computed(
  () => workspaceRecords.value.find((item) => item._key === workspaceSelectedId.value) || null,
)
const workspaceAccount = computed(
  () => accounts.value.find((account) => account.id === workspaceAccountId.value) || null,
)
const postGridRows = computed(() =>
  posts.value.map((post) => {
    const activeDeliveries = (post.deliveries || []).filter((delivery) => delivery.status !== 'cancelled')
    return {
      ...post,
      _summary: post.body || PAGE['media-post'],
      _updated: new Date(post.updated_at || post.created_at).toLocaleString(),
      _scheduled: activeDeliveries
        .map((delivery) => new Date(delivery.scheduled_at).toLocaleString())
        .join(' · '),
      _accounts: activeDeliveries.map(accountName).join(' · ') || POSTS['draft-label'],
      _delivery: activeDeliveries.length
        ? [...new Set(activeDeliveries.map((delivery) => statusWord(delivery.status)))].join(' · ')
        : POSTS['draft-label'],
    }
  }),
)
const postGridColumns = computed(() => [
  { headerName: POSTS['col-post'], field: '_summary', pinned: 'left', flex: 2, minWidth: 160 },
  { headerName: POSTS['col-updated'], field: '_updated', width: 145 },
  { headerName: POSTS['col-scheduled'], field: '_scheduled', width: 150 },
  { headerName: POSTS['col-accounts'], field: '_accounts', flex: 1, minWidth: 120 },
  { headerName: POSTS['col-delivery'], field: '_delivery', flex: 1, minWidth: 120 },
])
const postRowId = (params) => params.data.id
const selectedPost = computed(
  () => posts.value.find((post) => post.id === selectedPostId.value) || null,
)
const commentableDeliveries = computed(() =>
  posts.value.flatMap((post) =>
    (post.deliveries || [])
      .filter(
        (delivery) =>
          delivery.status === 'published' &&
          delivery.provider_post_id &&
          (!workspaceAccountId.value || delivery.account_id === workspaceAccountId.value),
      )
      .map((delivery) => ({ ...delivery, post })),
  ),
)
const selectedDelivery = computed(
  () =>
    commentableDeliveries.value.find((delivery) => delivery.id === selectedDeliveryId.value) ||
    commentableDeliveries.value[0] ||
    null,
)
const analyticsDelivery = computed(
  () =>
    commentableDeliveries.value.find((delivery) => delivery.id === selectedDeliveryId.value) || null,
)
const analyticsSnapshotsInRange = computed(() =>
  analyticsSnapshots.value.filter((snapshot) => {
    const collectedDay = dayKey(new Date(snapshot.collected_at), UTC_HERE)
    return (
      (!analyticsFrom.value || collectedDay >= analyticsFrom.value) &&
      (!analyticsTo.value || collectedDay <= analyticsTo.value)
    )
  }),
)
function selectPostRow(event) {
  selectedPostId.value = event.data.id
}
function deliveryAt(delivery) {
  return delivery.scheduled_at ? new Date(delivery.scheduled_at).toLocaleString() : ''
}
function selectedRecordTimestamp(item) {
  return recordValue(item?._source, [
    'createdAt',
    'created_at',
    'receivedAt',
    'received_at',
    'timestamp',
    'seenAt',
    'seen_at',
  ])
}
async function loadComments() {
  if (!workspaceAccountId.value || !hasOperation(workspaceAccountId.value, 'comments.read')) {
    workspaceRecords.value = []
    return
  }
  if (!selectedDelivery.value) {
    workspaceRecords.value = []
    return
  }
  const result = await invokeCapability(workspaceAccountId.value, 'comments.read', {
    postId: selectedDelivery.value.provider_post_id,
  })
  workspaceRecords.value = workspaceRows(result, ['comments'])
  workspaceSelectedId.value = workspaceRecords.value[0]?._key || ''
}
async function selectWorkspaceAccount(event) {
  workspaceAccountId.value = event.target.value
  selectedDeliveryId.value = ''
  workspaceRecords.value = []
  workspaceMessages.value = []
  workspaceSelectedId.value = ''
  const view = activeView.value
  if (view !== 'posts') await setView(view)
}
async function openComments(delivery) {
  workspaceAccountId.value = delivery.account_id
  selectedDeliveryId.value = delivery.id
  await setView('comments')
}
async function openAnalytics(delivery) {
  workspaceAccountId.value = delivery.account_id
  selectedDeliveryId.value = delivery.id
  await setView('analytics')
}
async function replyToComment() {
  const item = workspaceSelected.value?._source
  const commentId = recordId(item, ['commentId', 'comment_id', 'id', 'ref'])
  if (!selectedDelivery.value || !commentId || !workspaceReply.value.trim()) return
  workspaceBusy.value = true
  workspaceError.value = ''
  try {
    await invokeCapability(workspaceAccountId.value, 'comments.write', {
      postId: selectedDelivery.value.provider_post_id,
      commentId,
      text: workspaceReply.value,
    })
    workspaceReply.value = ''
    await loadComments()
  } catch (error) {
    workspaceError.value =
      error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
  } finally {
    workspaceBusy.value = false
  }
}
async function loadAnalytics() {
  analyticsAccount.value = null
  analyticsSnapshots.value = []
  workspaceError.value = ''
  if (
    workspaceAccountId.value &&
    hasOperation(workspaceAccountId.value, 'analytics.account.read')
  ) {
    try {
      analyticsAccount.value = await invokeCapability(
        workspaceAccountId.value,
        'analytics.account.read',
      )
    } catch (error) {
      workspaceError.value =
        error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
    }
  }
  const from = analyticsFrom.value
    ? new Date(`${analyticsFrom.value}T00:00:00`).toISOString()
    : null
  const through = analyticsTo.value
    ? new Date(`${plusDays(analyticsTo.value, 1)}T00:00:00`).toISOString()
    : null
  const snapshots = []
  let offset = 0
  try {
    while (true) {
      let query = supabase
        .from('social_metrics_snapshots')
        .select('id, delivery_id, post_id, account_id, collected_at, views, reads, likes, comments, provider_metrics')
      if (analyticsDelivery.value) query = query.eq('delivery_id', analyticsDelivery.value.id)
      if (from) query = query.gte('collected_at', from)
      if (through) query = query.lt('collected_at', through)
      const { data, error } = await query
        .order('collected_at', { ascending: false })
        .range(offset, offset + 999)
      if (error) throw new Error(error.message || ACCOUNT_OPERATIONS['operation-failed'])
      snapshots.push(...(data || []))
      if ((data || []).length < 1000) break
      offset += data.length
    }
  } catch (error) {
    workspaceError.value =
      error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
  }
  analyticsSnapshots.value = snapshots
}
function analyticsSnapshotContext(snapshot) {
  const delivery = posts.value
    .flatMap((post) => (post.deliveries || []).map((item) => ({ ...item, post })))
    .find((item) => item.id === snapshot.delivery_id)
  const post = posts.value.find((item) => item.id === snapshot.post_id)
  const account = accounts.value.find((item) => item.id === snapshot.account_id)
  return `${delivery?.post.body?.slice(0, 75) || post?.body?.slice(0, 75) || PAGE['media-post']} · ${account?.name || snapshot.account_id}`
}
function metricsRows(value) {
  if (!value || typeof value !== 'object') return []
  const source = value.data && typeof value.data === 'object' ? value.data : value
  const known = ['impressions', 'reach', 'engagement', 'clicks', 'views', 'reads', 'likes', 'comments', 'shares']
  return known
    .filter((key) => source[key] !== undefined && (typeof source[key] === 'number' || typeof source[key] === 'string'))
    .map((key) => ({ key, value: source[key] }))
}
async function loadInbox() {
  if (!workspaceAccountId.value) return
  if (workspaceMode.value === 'notifications') {
    if (!hasOperation(workspaceAccountId.value, 'notifications.read')) {
      workspaceRecords.value = []
      return
    }
    const result = await invokeCapability(workspaceAccountId.value, 'notifications.read')
    workspaceRecords.value = workspaceRows(result, ['notifications'])
    workspaceSelectedId.value = workspaceRecords.value[0]?._key || ''
    return
  }
  if (!hasOperation(workspaceAccountId.value, 'messages.read')) {
    workspaceRecords.value = []
    return
  }
  const result = await invokeCapability(workspaceAccountId.value, 'messages.read')
  workspaceRecords.value = workspaceRows(result, ['conversations', 'threads'])
  workspaceSelectedId.value = workspaceRecords.value[0]?._key || ''
  if (workspaceSelected.value) await loadConversation(workspaceSelected.value)
}
async function loadConversation(conversation) {
  const conversationId = recordId(conversation?._source, [
    'conversationId',
    'conversation_id',
    'id',
    'ref',
  ])
  if (!conversationId || !hasOperation(workspaceAccountId.value, 'messages.read')) return
  const result = await invokeCapability(workspaceAccountId.value, 'messages.read', {
    conversationId,
  })
  workspaceMessages.value = workspaceRows(result, ['messages'])
}
async function selectConversation(row) {
  workspaceSelection(row)
  workspaceMessages.value = []
  try {
    await loadConversation(row)
  } catch (error) {
    workspaceError.value =
      error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
  }
}
async function sendConversationReply() {
  const conversationId = recordId(workspaceSelected.value?._source, [
    'conversationId',
    'conversation_id',
    'id',
    'ref',
  ])
  if (!conversationId || !workspaceReply.value.trim()) return
  workspaceBusy.value = true
  workspaceError.value = ''
  try {
    await invokeCapability(workspaceAccountId.value, 'messages.write', {
      conversationId,
      text: workspaceReply.value,
    })
    workspaceReply.value = ''
    await loadConversation(workspaceSelected.value)
  } catch (error) {
    workspaceError.value =
      error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
  } finally {
    workspaceBusy.value = false
  }
}
async function markSelectedNotificationSeen() {
  if (!workspaceSelected.value) return
  const seenAt = selectedRecordTimestamp(workspaceSelected.value)
  workspaceBusy.value = true
  workspaceError.value = ''
  try {
    await invokeCapability(workspaceAccountId.value, 'notifications.seen', {
      ...(seenAt ? { seenAt: new Date(seenAt).toISOString() } : {}),
    })
    await loadInbox()
  } catch (error) {
    workspaceError.value =
      error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
  } finally {
    workspaceBusy.value = false
  }
}
async function searchWorkspace() {
  if (!workspaceQuery.value.trim() || !hasOperation(workspaceAccountId.value, 'search.posts')) return
  workspaceLoading.value = true
  workspaceError.value = ''
  workspaceProfile.value = null
  try {
    const result = await invokeCapability(workspaceAccountId.value, 'search.posts', {
      query: workspaceQuery.value.trim(),
      limit: 25,
    })
    workspaceRecords.value = workspaceRows(result, ['posts', 'items', 'results'])
    workspaceSelectedId.value = workspaceRecords.value[0]?._key || ''
  } catch (error) {
    workspaceError.value =
      error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
  } finally {
    workspaceLoading.value = false
  }
}
async function lookupProfile(handle) {
  if (!handle?.trim() || !hasOperation(workspaceAccountId.value, 'profiles.read')) return
  workspaceLoading.value = true
  workspaceError.value = ''
  try {
    workspaceProfile.value = await invokeCapability(workspaceAccountId.value, 'profiles.read', {
      handle: handle.trim().replace(/^@/, ''),
    })
  } catch (error) {
    workspaceError.value =
      error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
  } finally {
    workspaceLoading.value = false
  }
}
async function loadRelationships() {
  if (!hasOperation(workspaceAccountId.value, 'graph.read')) return
  workspaceLoading.value = true
  workspaceError.value = ''
  try {
    const result = await invokeCapability(workspaceAccountId.value, 'graph.read', {
      kind: workspaceMode.value,
      limit: 25,
    })
    workspaceRecords.value = workspaceRows(result, ['profiles', 'users', 'items', 'results'])
    workspaceSelectedId.value = workspaceRecords.value[0]?._key || ''
  } catch (error) {
    workspaceError.value =
      error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
  } finally {
    workspaceLoading.value = false
  }
}
async function actOnSelectedProfile(operation) {
  const profile = workspaceProfile.value || workspaceSelected.value?._source
  const profileId = recordId(profile, ['profileId', 'profile_id', 'id', 'did'])
  if (!profileId || !hasOperation(workspaceAccountId.value, operation)) return
  workspaceBusy.value = true
  workspaceError.value = ''
  try {
    await invokeCapability(workspaceAccountId.value, operation, { profileId })
    if (workspaceMode.value !== 'search') await loadRelationships()
  } catch (error) {
    workspaceError.value =
      error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
  } finally {
    workspaceBusy.value = false
  }
}
async function performRemotePostAction(operation) {
  const source = workspaceSelected.value?._source
  if (!source || !hasOperation(workspaceAccountId.value, operation)) return
  const fields =
    operation === 'posts.cancelScheduled'
      ? { jobId: recordId(source, ['jobId', 'job_id', 'scheduledJobId', 'scheduled_job_id']) }
      : operation === 'posts.deleteBackendRecord'
        ? { recordId: recordId(source, ['recordId', 'record_id', 'backendRecordId', 'backend_record_id']) }
        : { postId: recordId(source, ['postId', 'post_id', 'id', 'ref']) }
  if (!Object.values(fields)[0]) return
  workspaceBusy.value = true
  workspaceError.value = ''
  try {
    await invokeCapability(workspaceAccountId.value, operation, fields)
    if (workspaceMode.value === 'search') await searchWorkspace()
    else if (workspaceMode.value === 'relationships') await loadRelationships()
  } catch (error) {
    workspaceError.value =
      error instanceof Error ? error.message : ACCOUNT_OPERATIONS['operation-failed']
  } finally {
    workspaceBusy.value = false
  }
}

const monthLabel = computed(() =>
  dateAtNoon(anchorDay.value).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }),
)
const periodDays = computed(() => {
  if (mode.value === 'week')
    return Array.from({ length: 7 }, (_, index) => plusDays(mondayOf(anchorDay.value), index))
  const first = anchorDay.value.slice(0, 8) + '01'
  const firstDate = new Date(`${first}T00:00:00Z`)
  const start = plusDays(first, -((firstDate.getUTCDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, index) => plusDays(start, index))
})
const weekdayLabels = computed(() =>
  Array.from({ length: 7 }, (_, index) =>
    dayLabel(plusDays('2024-01-01', index), { weekday: 'short' }),
  ),
)
const scheduledPosts = computed(() =>
  posts.value.filter((post) =>
    (post.deliveries || []).some((delivery) => !['cancelled'].includes(delivery.status)),
  ),
)
const scheduledTargetCount = computed(() =>
  posts.value.reduce(
    (count, post) =>
      count +
      (post.deliveries || []).filter((delivery) =>
        ['scheduled', 'remote-scheduled'].includes(delivery.status),
      ).length,
    0,
  ),
)
const draftPosts = computed(() =>
  posts.value.filter(
    (post) => !(post.deliveries || []).some((delivery) => !['cancelled'].includes(delivery.status)),
  ),
)
const lockedPost = computed(() => {
  const post = posts.value.find((item) => item.id === form.id)
  return (post?.deliveries || []).some(
    (delivery) => !['scheduled', 'cancelled'].includes(delivery.status),
  )
})
const redditTargets = computed(() =>
  accounts.value.filter(
    (account) => account.provider_id === 'reddit' && form.accountIds.includes(account.id),
  ),
)
const redditSelected = computed(() => redditTargets.value.length > 0)
function ensureTargetOptions(accountId) {
  if (!form.targetOptions[accountId]) form.targetOptions[accountId] = { subreddit: '', title: '' }
}
function postsOn(key) {
  return scheduledPosts.value.filter((post) =>
    post.deliveries.some(
      (delivery) => dayKey(new Date(delivery.scheduled_at), timezone.value) === key,
    ),
  )
}
function accountsForPost(post) {
  return (post.deliveries || [])
    .filter((delivery) => delivery.status !== 'cancelled')
    .map((delivery) => accounts.value.find((account) => account.id === delivery.account_id))
    .filter(Boolean)
}
function statusWord(status) {
  return PAGE_STATUS[status.replaceAll('_', '-')] || status
}
function accountName(delivery) {
  return accounts.value.find((item) => item.id === delivery.account_id)?.name || delivery.account_id
}
function eventTime(post) {
  const delivery = (post.deliveries || []).find((item) => item.status !== 'cancelled')
  return delivery
    ? new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: timezone.value,
      }).format(new Date(delivery.scheduled_at))
    : ''
}
function movePeriod(direction) {
  if (mode.value === 'week') anchorDay.value = plusDays(anchorDay.value, direction * 7)
  else {
    const date = new Date(`${anchorDay.value.slice(0, 7)}-01T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() + direction)
    anchorDay.value = date.toISOString().slice(0, 7) + '-01'
  }
}
function resetForm() {
  form.id = ''
  form.text = ''
  form.timezone = timezone.value
  form.scheduledLocal = ''
  form.accountIds = []
  form.targetOptions = {}
  form.attachments = []
  errorText.value = ''
  notice.value = ''
}
function newPost(key = anchorDay.value) {
  resetForm()
  form.scheduledLocal = `${key}T10:00`
  editorOpen.value = true
}
function editPost(post) {
  resetForm()
  form.id = post.id
  form.text = post.body
  form.timezone = post.timezone || timezone.value
  const firstDelivery = (post.deliveries || []).find((delivery) => delivery.status !== 'cancelled')
  if (firstDelivery) {
    form.scheduledLocal = localInputOf(firstDelivery.scheduled_at, form.timezone)
    form.accountIds = (post.deliveries || [])
      .filter((delivery) => delivery.status !== 'cancelled')
      .map((delivery) => delivery.account_id)
    form.targetOptions = Object.fromEntries(
      (post.deliveries || [])
        .filter((delivery) => delivery.status !== 'cancelled')
        .map((delivery) => [delivery.account_id, { ...(delivery.target_options || {}) }]),
    )
  }
  form.attachments = [...(post.attachments || [])]
  editorOpen.value = true
}
async function savePost() {
  busy.value = true
  errorText.value = ''
  try {
    const result = await social('save_draft', {
      postId: form.id || undefined,
      text: form.text,
      timezone: form.timezone,
    })
    form.id = result.post.id
    notice.value = PAGE['draft-saved']
    await load()
    const saved = posts.value.find((post) => post.id === form.id)
    if (saved) form.attachments = [...saved.attachments]
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    busy.value = false
  }
}
async function uploadFiles(event, attachmentId) {
  const files = [...(event.target.files || [])]
  event.target.value = ''
  if (!form.id) {
    errorText.value = EDITOR['save-before-media']
    return
  }
  busy.value = true
  errorText.value = ''
  try {
    for (const file of files) {
      const body = new FormData()
      body.set('action', attachmentId ? 'replace_attachment' : 'upload_attachment')
      body.set('postId', form.id)
      if (attachmentId) body.set('attachmentId', attachmentId)
      body.set('file', file)
      const result = await invoke('social', body)
      const item = await withPreview(result.attachment)
      if (attachmentId) {
        form.attachments = form.attachments.map((attachment) =>
          attachment.id === attachmentId ? item : attachment,
        )
      } else form.attachments.push(item)
    }
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    busy.value = false
  }
}
async function removeAttachment(attachmentId) {
  busy.value = true
  errorText.value = ''
  try {
    await social('remove_attachment', { attachmentId })
    form.attachments = form.attachments.filter((attachment) => attachment.id !== attachmentId)
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    busy.value = false
  }
}
async function moveAttachment(index, direction) {
  const next = index + direction
  if (next < 0 || next >= form.attachments.length) return
  const ordered = [...form.attachments]
  ;[ordered[index], ordered[next]] = [ordered[next], ordered[index]]
  busy.value = true
  errorText.value = ''
  try {
    await social('order_attachments', {
      postId: form.id,
      attachmentIds: ordered.map((item) => item.id),
    })
    form.attachments = ordered
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    busy.value = false
  }
}
async function schedulePost() {
  busy.value = true
  errorText.value = ''
  try {
    if (!form.accountIds.length) throw new Error(EDITOR['select-account'])
    const scheduledAt = zonedInputToIso(form.scheduledLocal, form.timezone)
    if (!scheduledAt) throw new Error(EDITOR['time-invalid'])
    if (!form.id) {
      const saved = await social('save_draft', { text: form.text, timezone: form.timezone })
      form.id = saved.post.id
    } else await social('save_draft', { postId: form.id, text: form.text, timezone: form.timezone })
    await social('schedule', {
      postId: form.id,
      text: form.text,
      timezone: form.timezone,
      accountIds: form.accountIds,
      targetOptions: Object.fromEntries(
        form.accountIds
          .filter((accountId) => form.targetOptions[accountId])
          .map((accountId) => [accountId, form.targetOptions[accountId]]),
      ),
      scheduledAt,
    })
    editorOpen.value = false
    await load()
    notice.value = PAGE['post-scheduled']
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    busy.value = false
  }
}
async function cancelSchedule(post) {
  if (!window.confirm(PAGE['cancel-confirm'])) return
  busy.value = true
  errorText.value = ''
  try {
    await social('cancel_schedule', { postId: post.id })
    await load()
    if (editorOpen.value && form.id === post.id) editorOpen.value = false
    notice.value = PAGE['schedule-cancelled']
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    busy.value = false
  }
}
async function recoverDelivery(delivery, resolution) {
  let providerPostId
  let confirmedNotPublished = false
  if (resolution === 'retry') {
    const message =
      delivery.status === 'review_required' ? PAGE['confirm-not-published'] : PAGE['retry-confirm']
    if (!window.confirm(message)) return
    confirmedNotPublished = delivery.status === 'review_required'
  } else {
    providerPostId = window.prompt(PAGE['provider-post-id'], delivery.provider_post_id || '')
    if (!providerPostId?.trim()) return
  }
  busy.value = true
  errorText.value = ''
  try {
    await social('recover_delivery', {
      deliveryId: delivery.id,
      resolution,
      providerPostId,
      confirmedNotPublished,
    })
    await load()
    notice.value = PAGE['delivery-recovered']
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    busy.value = false
  }
}
async function connect(provider) {
  let loginHint
  if (provider.id === 'bluesky') {
    loginHint = window.prompt(ACCOUNT_WORDS['bluesky-login-hint'])?.trim()
    if (!loginHint) return
  }
  const connectBackend = computed(() =>
    backends.value.find((backend) => backend.id === managedConnectForm.backendId),
  )
  const managedPlatformChoices = computed(() => connectBackend.value?.platforms || [])
  async function loadManagedProfiles() {
    managedProfiles.value = []
    managedConnectForm.profileId = ''
    if (managedConnectForm.backendId !== 'zernio') return
    try {
      const result = await social('managed_profiles', { backendId: 'zernio' })
      managedProfiles.value = result.profiles || []
      managedConnectForm.profileId = managedProfiles.value[0]?.id || ''
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
    }
  }
  async function selectManagedBackend() {
    const platforms = managedPlatformChoices.value
    if (!platforms.includes(managedConnectForm.platform))
      managedConnectForm.platform = platforms[0] || ''
    await loadManagedProfiles()
  }
  async function connectManaged() {
    busy.value = true
    errorText.value = ''
    try {
      const result = await social('managed_connect', {
        backendId: managedConnectForm.backendId,
        platform: managedConnectForm.platform,
        ...(managedConnectForm.backendId === 'zernio'
          ? { profileId: managedConnectForm.profileId }
          : {}),
      })
      window.location.assign(result.authorizationUrl)
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
      busy.value = false
    }
  }
  busy.value = true
  errorText.value = ''
  try {
    const result = await invoke('social-oauth', {
      action: 'start',
      providerId: provider.id,
      ...(loginHint ? { loginHint } : {}),
    })
    window.location.assign(result.authorizationUrl)
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
    busy.value = false
  }
}
async function disconnect(account) {
  if (!window.confirm(ACCOUNT_WORDS['disconnect-confirm'])) return
  busy.value = true
  errorText.value = ''
  try {
    await social('disconnect', { accountId: account.id })
    await load()
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    busy.value = false
  }
}
async function saveProvider() {
  busy.value = true
  errorText.value = ''
  try {
    await social('save_provider', {
      providerId: providerForm.providerId,
      clientId: providerForm.clientId,
      clientSecret: providerForm.clientSecret,
    })
    providerForm.clientId = ''
    providerForm.clientSecret = ''
    await load()
    notice.value = ACCOUNT_WORDS['provider-saved']
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    busy.value = false
  }
  async function saveBackend() {
    busy.value = true
    errorText.value = ''
    try {
      await social('save_backend', {
        backendId: backendForm.backendId,
        apiKey: backendForm.apiKey,
        webhookSecret: backendForm.webhookSecret,
      })
      backendForm.apiKey = ''
      backendForm.webhookSecret = ''
      await load()
      await selectManagedBackend()
      notice.value = ACCOUNT_WORDS['backend-saved']
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
    } finally {
      busy.value = false
    }
  }
}
async function invitePublisher() {
  busy.value = true
  errorText.value = ''
  try {
    await social('invite', { email: inviteEmail.value })
    inviteEmail.value = ''
    await load()
    notice.value = ACCESS['invitation-sent']
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    busy.value = false
  }
}
async function revokePublisher(publisher) {
  if (!window.confirm(ACCESS['revoke-confirm'])) return
  busy.value = true
  errorText.value = ''
  try {
    await social('revoke', { grantId: publisher.id })
    await load()
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    busy.value = false
  }
}
const selectedPublisher = computed(
  () => publishers.value.find((publisher) => publisher.id === selectedPublisherId.value) || null,
)
function editPublisherPermissions(publisher) {
  selectedPublisherId.value = publisher.id
  publisherCanManageAccounts.value = publisher.can_manage_accounts === true
  const saved = new Map(
    (publisher.accountPermissions || []).map((permission) => [permission.account_id, permission]),
  )
  publisherPermissionDraft.value = Object.fromEntries(
    accounts.value.map((account) => {
      const permissions = saved.get(account.id) || {}
      return [
        account.id,
        Object.fromEntries(ACCESS_ACTIONS.map(([key]) => [key, permissions[key] === true])),
      ]
    }),
  )
}
async function savePublisherPermissions() {
  if (!selectedPublisher.value) return
  busy.value = true
  errorText.value = ''
  try {
    await social('save_permissions', {
      grantId: selectedPublisher.value.id,
      canManageAccounts: publisherCanManageAccounts.value,
      permissions: accounts.value.map((account) => ({
        accountId: account.id,
        ...(publisherPermissionDraft.value[account.id] || {}),
      })),
    })
    const selectedId = selectedPublisher.value.id
    await load()
    const publisher = publishers.value.find((item) => item.id === selectedId)
    if (publisher) editPublisherPermissions(publisher)
    notice.value = ACCESS['permissions-saved']
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    busy.value = false
  }
}
async function setAccountApproval(account, required) {
  busy.value = true
  errorText.value = ''
  try {
    await social('set_approval', { accountId: account.id, required })
    account.approval_required = required
    notice.value = required ? ACCESS['approval-required-saved'] : ACCESS['approval-not-required-saved']
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    busy.value = false
  }
}
async function reviewApproval(delivery, decision) {
  workspaceBusy.value = true
  workspaceError.value = ''
  try {
    const result = await social('review_delivery', { deliveryId: delivery.id, decision })
    const updatedDelivery = result.delivery
    if (!updatedDelivery?.id || updatedDelivery.id !== delivery.id)
      throw new Error(PAGE['request-failed'])
    posts.value = posts.value.map((post) =>
      post.id === updatedDelivery.post_id
        ? {
            ...post,
            deliveries: (post.deliveries || []).map((item) =>
              item.id === updatedDelivery.id ? { ...item, ...updatedDelivery } : item,
            ),
          }
        : post,
    )
    const queue = await social('approval_queue')
    pendingApprovals.value = queue.deliveries || []
  } catch (error) {
    workspaceError.value = error instanceof Error ? error.message : PAGE['request-failed']
  } finally {
    workspaceBusy.value = false
  }
}
function canReviewApproval(delivery) {
  return (
    isAdmin.value ||
    accounts.value.some(
      (account) =>
        account.id === delivery.account_id && account.permissions?.approve_posts === true,
    )
  )
}
onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const oauthConnection = params.get('social_connection')
  const oauthCode = params.get('social_code')
  if (oauthConnection || oauthCode) {
    params.delete('social_connection')
    params.delete('social_code')
    const query = params.toString()
    history.replaceState(
      history.state,
      '',
      window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
    )
  }
  await load()
  if (state.value === 'ready' && oauthConnection) {
    activeView.value = 'accounts'
    const outcome = PAGE_OAUTH[oauthCode] || PAGE['oauth-finished']
    if (oauthConnection === 'error') errorText.value = outcome
    else notice.value = outcome
  }
})
</script>

<template>
  <section class="ui-page sp-admin">
    <div v-if="state === 'loading'" class="sp-message">{{ PAGE.loading }}</div>
    <div v-else-if="state === 'error'" class="sp-message sp-error">{{ errorText }}</div>
    <template v-else>
      <AdminHead :title="PAGE.title" :sub="PAGE.lead">
        <template #barLeft>
          <nav class="sp-workspace-nav" :aria-label="PAGE['workspace-navigation']">
            <select
              class="ui-select sp-workspace-select"
              :value="activeView"
              :aria-label="PAGE['workspace-navigation']"
              @change="setView($event.target.value)"
            >
              <optgroup v-for="group in workspaceNavigation" :key="group.key" :label="group.label">
                <option v-for="item in group.items" :key="item.key" :value="item.key">
                  {{ item.label }}
                </option>
              </optgroup>
            </select>
          </nav>
        </template>
        <template #actions>
          <div
            class="sp-page-actions"
            :class="{ 'sp-page-actions-calendar': activeView === 'calendar' }"
          >
            <div v-if="activeView === 'calendar'" class="sp-tools">
              <div class="sp-mode" role="group" :aria-label="PAGE['calendar-view']">
                <button type="button" :aria-pressed="mode === 'month'" @click="mode = 'month'">
                  {{ PAGE.month }}
                </button>
                <button type="button" :aria-pressed="mode === 'week'" @click="mode = 'week'">
                  {{ PAGE.week }}
                </button>
              </div>
            </div>
            <button
              v-if="['calendar', 'drafts', 'posts'].includes(activeView)"
              class="sp-primary sp-create"
              type="button"
              @click="newPost()"
            >
              <span aria-hidden="true">+</span>
              {{ PAGE['new-post'] }}
            </button>
          </div>
        </template>
      </AdminHead>

      <main class="sp-main">
          <p v-if="notice" class="sp-notice" role="status">{{ notice }}</p>
          <p v-if="errorText" class="sp-error" role="alert">{{ errorText }}</p>

          <SocialAutomations v-if="activeView === 'automations'" :accounts="accounts" />
          <section v-if="activeView === 'calendar'" class="sp-view">
        <div class="sp-top">
          <div class="sp-heading">
            <h2>{{ PAGE.calendar }}</h2>
          </div>
        </div>

            <div class="sp-overview" role="group" :aria-label="PAGE['calendar-overview']">
              <article class="sp-overview-card">
                <span>{{ PAGE['metric-scheduled'] }}</span>
                <strong>{{ scheduledTargetCount }}</strong>
              </article>
              <article class="sp-overview-card">
                <span>{{ PAGE['metric-drafts'] }}</span>
                <strong>{{ draftPosts.length }}</strong>
              </article>
              <article class="sp-overview-card">
                <span>{{ PAGE['metric-accounts'] }}</span>
                <strong>{{ connectedAccounts.length }}</strong>
              </article>
            </div>

            <div class="sp-calendar">
          <div class="sp-cal-head">
            <div class="sp-period">
              <button type="button" :aria-label="PAGE['previous-period']" @click="movePeriod(-1)">
                ‹
              </button>
              <h3>
                {{
                  mode === 'week'
                    ? `${dayLabel(periodDays[0], { month: 'short', day: 'numeric' })} – ${dayLabel(periodDays[6], { month: 'short', day: 'numeric', year: 'numeric' })}`
                    : monthLabel
                }}
              </h3>
              <button type="button" :aria-label="PAGE['next-period']" @click="movePeriod(1)">
                ›
              </button>
            </div>
            <button
              class="sp-subtle"
              type="button"
              @click="anchorDay = dayKey(new Date(), timezone)"
            >
              {{ PAGE.today }}
            </button>
          </div>
          <div v-if="mode === 'month'" class="sp-weekdays">
            <div v-for="weekday in weekdayLabels" :key="weekday">{{ weekday }}</div>
          </div>
          <div class="sp-grid" :class="{ 'sp-grid-week': mode === 'week' }">
            <section
              v-for="day in periodDays"
              :key="day"
              class="sp-day"
              :class="{
                'sp-day-outside': mode === 'month' && day.slice(0, 7) !== anchorDay.slice(0, 7),
                'sp-day-selected': day === anchorDay,
              }"
              :aria-label="
                dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
              "
            >
              <div class="sp-day-head">
                <button
                  type="button"
                  class="sp-day-select"
                  :aria-label="
                    dayLabel(day, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  "
                  :aria-pressed="day === anchorDay"
                  @click="anchorDay = day"
                >
                  {{
                    mode === 'week'
                      ? `${dayLabel(day, { weekday: 'short' })} ${dayLabel(day, { day: 'numeric' })}`
                      : dayLabel(day, { day: 'numeric' })
                  }}
                </button>
                <button
                  type="button"
                  :aria-label="`${PAGE['new-post-for']} ${dayLabel(day, { month: 'long', day: 'numeric' })}`"
                  @click.stop="newPost(day)"
                >
                  +
                </button>
              </div>
              <button
                v-for="post in postsOn(day)"
                :key="post.id"
                type="button"
                class="sp-event"
                @click.stop="editPost(post)"
              >
                <span class="sp-event-time">{{ eventTime(post) }}</span>
                <span class="sp-event-copy">{{ post.body || PAGE['media-post'] }}</span>
                <span
                  v-for="delivery in post.deliveries.filter((item) => item.status !== 'cancelled')"
                  :key="delivery.id"
                  class="sp-status"
                  :data-status="delivery.status"
                >
                  {{ statusWord(delivery.status) }}
                </span>
              </button>
            </section>
          </div>
          <p v-if="!scheduledPosts.length" class="sp-empty">{{ PAGE['calendar-empty'] }}</p>
        </div>
      </section>

      <section v-else-if="activeView === 'posts'" class="sp-view">
        <div class="sp-top">
          <div class="sp-heading">
            <h2>{{ POSTS.title }}</h2>
            <p>{{ POSTS.description }}</p>
          </div>
        </div>
        <div class="sp-post-workspace">
          <AgGridVue
            class="sp-post-grid"
            :theme="gridTheme"
            :row-data="postGridRows"
            :column-defs="postGridColumns"
            :get-row-id="postRowId"
            :row-height="58"
            :suppress-cell-focus="true"
            @row-clicked="selectPostRow"
          />
          <aside class="sp-panel sp-post-detail">
            <template v-if="selectedPost">
              <div class="sp-panel-head">
                <div>
                  <h3>{{ POSTS['selected-post'] }}</h3>
                </div>
                <button class="sp-subtle" type="button" @click="editPost(selectedPost)">
                  {{ POSTS.edit }}
                </button>
              </div>
              <p class="sp-record-body">{{ selectedPost.body }}</p>
              <div class="sp-deliveries">
                <h4>{{ POSTS.deliveries }}</h4>
                <article
                  v-for="delivery in selectedPost.deliveries || []"
                  :key="delivery.id"
                  class="sp-delivery-card"
                >
                  <div>
                    <strong>{{ accountName(delivery) }}</strong>
                    <span class="sp-status" :data-status="delivery.status">
                      {{ statusWord(delivery.status) }}
                    </span>
                    <small v-if="deliveryAt(delivery)">{{ deliveryAt(delivery) }}</small>
                    <small v-if="delivery.provider_post_id" class="sp-muted">
                      {{ POSTS['provider-post'] }} · {{ delivery.provider_post_id }}
                    </small>
                    <small v-if="delivery.last_error" class="sp-error">{{ delivery.last_error }}</small>
                  </div>
                  <div class="sp-row-actions">
                    <button
                      v-if="delivery.status === 'scheduled'"
                      type="button"
                      class="sp-subtle"
                      :disabled="busy"
                      @click="cancelSchedule(selectedPost)"
                    >
                      {{ PAGE['cancel-schedule'] }}
                    </button>
                    <button
                      v-if="['failed', 'review_required'].includes(delivery.status)"
                      type="button"
                      class="sp-subtle"
                      :disabled="busy"
                      @click="recoverDelivery(delivery, 'retry')"
                    >
                      {{ PAGE['retry-delivery'] }}
                    </button>
                    <button
                      v-if="delivery.status === 'review_required'"
                      type="button"
                      class="sp-subtle"
                      :disabled="busy"
                      @click="recoverDelivery(delivery, 'published')"
                    >
                      {{ PAGE['mark-published'] }}
                    </button>
                    <button
                      v-if="delivery.status === 'published' && delivery.provider_post_id"
                      type="button"
                      class="sp-subtle"
                      @click="openComments(delivery)"
                    >
                      {{ POSTS['view-comments'] }}
                    </button>
                    <button
                      v-if="delivery.status === 'published' && delivery.provider_post_id"
                      type="button"
                      class="sp-subtle"
                      @click="openAnalytics(delivery)"
                    >
                      {{ POSTS['view-analytics'] }}
                    </button>
                    <button
                      v-if="delivery.status === 'published' && delivery.provider_post_id && hasOperation(delivery.account_id, 'posts.removeFromPlatform')"
                      type="button"
                      class="sp-subtle"
                      :disabled="workspaceBusy"
                      @click="removePublishedDelivery(delivery)"
                    >
                      {{ operationLabel('posts.removeFromPlatform') }}
                    </button>
                    <button
                      v-if="delivery.status === 'published' && delivery.provider_post_id && hasOperation(delivery.account_id, 'posts.read')"
                      type="button"
                      class="sp-subtle"
                      :disabled="workspaceLoading"
                      @click="inspectProviderDelivery(delivery)"
                    >
                      {{ POSTS['delivery-details'] }}
                    </button>
                  </div>
                </article>
                <p v-if="!(selectedPost.deliveries || []).length" class="sp-empty">
                  {{ POSTS['no-deliveries'] }}
                </p>
              </div>
            </template>
            <p v-else class="sp-empty">{{ POSTS['select-post'] }}</p>
          </aside>
        </div>
        <section v-if="workspaceAccount" class="sp-panel sp-provider-posts">
          <header class="sp-panel-head">
            <div>
              <h3>{{ POSTS['provider-posts'] }}</h3>
              <p>{{ workspaceAccount.name }} · {{ workspaceAccount.provider_id }}</p>
            </div>
            <button
              v-if="hasOperation(workspaceAccount.id, 'posts.read')"
              class="sp-subtle"
              type="button"
              :disabled="workspaceLoading"
              @click="loadProviderPosts"
            >
              {{ POSTS.refresh }}
            </button>
          </header>
          <p v-if="!hasOperation(workspaceAccount.id, 'posts.read')" class="sp-empty">
            {{ POSTS['provider-posts-unavailable'] }}
          </p>
          <div v-else class="sp-record-workspace sp-provider-post-workspace">
            <div class="sp-record-list" role="list">
              <button
                v-for="item in providerPostRows"
                :key="item._key"
                type="button"
                class="sp-record-row"
                :aria-current="workspaceSelectedId === item._key ? 'true' : undefined"
                @click="inspectProviderPost(item)"
              >
                <strong>{{ item._title }}</strong>
                <span>{{ item._subtitle }}</span>
                <small>{{ item._status }}</small>
              </button>
              <p v-if="!providerPostRows.length" class="sp-empty">{{ POSTS['provider-empty'] }}</p>
            </div>
            <aside class="sp-panel sp-record-detail">
              <h4>{{ POSTS['provider-detail'] }}</h4>
              <pre v-if="providerPostDetail" class="sp-report-result">{{ JSON.stringify(providerPostDetail, null, 2) }}</pre>
              <p v-else class="sp-empty">{{ POSTS['select-provider-post'] }}</p>
              <button
                v-if="providerPostRows.some((item) => item._key === workspaceSelectedId) && hasOperation(workspaceAccount.id, 'posts.removeFromPlatform')"
                class="sp-subtle"
                type="button"
                :disabled="workspaceBusy"
                @click="removeProviderPost(providerPostRows.find((item) => item._key === workspaceSelectedId))"
              >
                {{ operationLabel('posts.removeFromPlatform') }}
              </button>
            </aside>
          </div>
        </section>
      </section>

      <section v-else-if="activeView === 'comments'" class="sp-view">
        <div class="sp-top">
          <div class="sp-heading">
            <h2>{{ COMMENTS.title }}</h2>
            <p>{{ COMMENTS.description }}</p>
          </div>
        </div>
        <div class="ui-toolbar sp-filterbar">
          <label class="sp-workspace-account">
            <span>{{ ACCOUNT_WORDS.title }}</span>
            <select :value="workspaceAccountId" :disabled="!connectedAccounts.length" @change="selectWorkspaceAccount">
              <option v-if="!connectedAccounts.length" value="" disabled>{{ ACCOUNT_WORDS['no-account-selection'] }}</option>
              <option v-for="account in connectedAccounts" :key="account.id" :value="account.id">
                {{ account.name }} · {{ account.provider_id }}
              </option>
            </select>
          </label>
          <label class="sp-workspace-account sp-filter-post">
            <span>{{ COMMENTS['choose-post'] }}</span>
            <select
              :value="selectedDeliveryId"
              @change="
                selectedDeliveryId = $event.target.value;
                loadComments()
              "
            >
              <option value="">{{ COMMENTS['choose-post'] }}</option>
              <option v-for="delivery in commentableDeliveries" :key="delivery.id" :value="delivery.id">
                {{ delivery.post.body?.slice(0, 75) || PAGE['media-post'] }} ·
                {{ accountName(delivery) }} · {{ deliveryAt(delivery) }}
              </option>
            </select>
          </label>
        </div>
        <p v-if="workspaceLoading" class="sp-empty">{{ PAGE.loading }}</p>
        <p v-if="workspaceError" class="sp-error" role="alert">{{ workspaceError }}</p>
        <div
          v-else-if="!workspaceLoading"
          :class="['sp-record-workspace', { 'sp-record-workspace-empty': !workspaceRecords.length }]"
        >
          <div class="sp-record-list" role="list">
            <button
              v-for="item in workspaceRecords"
              :key="item._key"
              type="button"
              class="sp-record-row"
              :aria-current="workspaceSelectedId === item._key ? 'true' : undefined"
              @click="workspaceSelection(item)"
            >
              <strong>{{ item._title }}</strong>
              <span>{{ item._subtitle }}</span>
              <small>{{ item._status }}</small>
            </button>
            <p v-if="!workspaceRecords.length" class="sp-empty">
              {{ connectedAccounts.length ? COMMENTS['empty-comments'] : ACCOUNT_WORDS.empty }}
            </p>
          </div>
          <aside v-if="workspaceSelected || workspaceRecords.length" class="sp-panel sp-record-detail">
            <template v-if="workspaceSelected">
              <h3>{{ COMMENTS['selected-comment'] }}</h3>
              <p class="sp-record-body">{{ workspaceDetail(workspaceSelected) }}</p>
              <p class="sp-muted">{{ workspaceAuthor(workspaceSelected) }} · {{ workspaceTimestamp(workspaceSelected) }}</p>
              <form v-if="hasOperation(workspaceAccountId, 'comments.write')" class="sp-context-form" @submit.prevent="replyToComment">
                <label>
                  <span>{{ COMMENTS.reply }}</span>
                  <textarea v-model="workspaceReply" rows="3" required />
                </label>
                <button class="sp-secondary" type="submit" :disabled="workspaceBusy">
                  {{ COMMENTS['send-reply'] }}
                </button>
              </form>
            </template>
            <p v-else class="sp-empty">{{ COMMENTS['select-comment'] }}</p>
          </aside>
        </div>
      </section>

      <section v-else-if="activeView === 'analytics'" class="sp-view">
        <div class="sp-top">
          <div class="sp-heading">
            <h2>{{ ANALYTICS.title }}</h2>
            <p>{{ ANALYTICS.description }}</p>
          </div>
        </div>
        <div class="ui-toolbar sp-filterbar">
          <label class="sp-workspace-account">
            <span>{{ ACCOUNT_WORDS.title }}</span>
            <select :value="workspaceAccountId" :disabled="!connectedAccounts.length" @change="selectWorkspaceAccount">
              <option v-if="!connectedAccounts.length" value="" disabled>{{ ACCOUNT_WORDS['no-account-selection'] }}</option>
              <option v-for="account in connectedAccounts" :key="account.id" :value="account.id">
                {{ account.name }} · {{ account.provider_id }}
              </option>
            </select>
          </label>
          <label class="sp-workspace-account sp-filter-post">
            <span>{{ ANALYTICS['choose-post'] }}</span>
            <select
              :value="analyticsDelivery?.id || ''"
              @change="
                selectedDeliveryId = $event.target.value;
                loadAnalytics()
              "
            >
              <option value="">{{ ANALYTICS['all-posts'] }}</option>
              <option v-for="delivery in commentableDeliveries" :key="delivery.id" :value="delivery.id">
                {{ delivery.post.body?.slice(0, 75) || PAGE['media-post'] }} · {{ accountName(delivery) }}
              </option>
            </select>
          </label>
          <div class="sp-analytics-filters" role="group" :aria-label="ANALYTICS['date-filters']">
            <label class="sp-workspace-account">
              <span>{{ ANALYTICS['date-from'] }}</span>
              <input v-model="analyticsFrom" type="date" :max="analyticsTo" @change="loadAnalytics" />
            </label>
            <label class="sp-workspace-account">
              <span>{{ ANALYTICS['date-to'] }}</span>
              <input v-model="analyticsTo" type="date" :min="analyticsFrom" @change="loadAnalytics" />
            </label>
          </div>
        </div>
        <p v-if="workspaceLoading" class="sp-empty">{{ PAGE.loading }}</p>
        <p v-if="workspaceError" class="sp-error" role="alert">{{ workspaceError }}</p>
        <p v-if="!workspaceLoading && !connectedAccounts.length" class="sp-empty">
          {{ ACCOUNT_WORDS.empty }}
        </p>
        <div v-if="connectedAccounts.length" class="sp-metric-grid">
          <article class="sp-panel sp-metric-card sp-metric-history">
            <h3>{{ ANALYTICS['history-title'] }}</h3>
            <p class="sp-muted">{{ ANALYTICS['collection-cadence'] }}</p>
            <p v-if="analyticsDelivery" class="sp-muted">
              {{ analyticsDelivery.post.body?.slice(0, 75) || PAGE['media-post'] }} ·
              {{ accountName(analyticsDelivery) }}
            </p>
            <dl v-if="analyticsDelivery" class="sp-metric-meta">
              <dt>{{ ANALYTICS['fetch-state'] }}</dt>
              <dd>{{ ANALYTICS[`state-${analyticsDelivery.metrics_state || 'pending'}`] || ANALYTICS['state-error'] }}</dd>
              <dt>{{ ANALYTICS['last-fetched'] }}</dt>
              <dd>{{ analyticsDelivery.metrics_last_fetched_at ? new Date(analyticsDelivery.metrics_last_fetched_at).toLocaleString() : ANALYTICS['not-fetched'] }}</dd>
              <dt>{{ ANALYTICS['next-fetch'] }}</dt>
              <dd>{{ analyticsDelivery.metrics_next_fetch_at ? new Date(analyticsDelivery.metrics_next_fetch_at).toLocaleString() : ANALYTICS['not-fetched'] }}</dd>
              <dt>{{ ANALYTICS['fetch-attempts'] }}</dt>
              <dd>{{ analyticsDelivery.metrics_attempt_count || 0 }}</dd>
              <template v-if="analyticsDelivery.metrics_last_error">
                <dt>{{ ANALYTICS['last-error'] }}</dt>
                <dd>{{ analyticsDelivery.metrics_last_error }}</dd>
              </template>
            </dl>
            <p v-if="!analyticsSnapshots.length" class="sp-empty">{{ ANALYTICS['no-snapshots'] }}</p>
            <p v-else-if="!analyticsSnapshotsInRange.length" class="sp-empty">
              {{ ANALYTICS['no-snapshots-in-range'] }}
            </p>
            <ol v-else class="sp-metric-snapshots">
              <li v-for="snapshot in analyticsSnapshotsInRange" :key="snapshot.id">
                <span>{{ analyticsSnapshotContext(snapshot) }}</span>
                <strong>{{ ANALYTICS['snapshot-at'] }} · {{ new Date(snapshot.collected_at).toLocaleString() }}</strong>
                <dl>
                  <template v-for="metric in metricsRows(snapshot)" :key="metric.key">
                    <dt>{{ ANALYTICS[`metric-${metric.key}`] || metric.key }}</dt><dd>{{ metric.value }}</dd>
                  </template>
                </dl>
                <details v-if="snapshot.provider_metrics && Object.keys(snapshot.provider_metrics).length">
                  <summary>{{ ANALYTICS['provider-metrics'] }}</summary>
                  <pre class="sp-report-result">{{ JSON.stringify(snapshot.provider_metrics, null, 2) }}</pre>
                </details>
              </li>
            </ol>
          </article>
          <article v-if="analyticsAccount" class="sp-panel sp-metric-card">
            <h3>{{ ANALYTICS['account-metrics'] }}</h3>
            <dl>
              <template v-for="metric in metricsRows(analyticsAccount)" :key="metric.key">
                <dt>{{ ANALYTICS[`metric-${metric.key}`] || metric.key }}</dt><dd>{{ metric.value }}</dd>
              </template>
            </dl>
          </article>
        </div>
      </section>

      <section v-else-if="activeView === 'inbox'" class="sp-view">
        <div class="sp-top">
          <div class="sp-heading">
            <h2>{{ INBOX.title }}</h2>
            <p>{{ INBOX.description }}</p>
          </div>
        </div>
        <div class="ui-toolbar sp-filterbar">
          <label class="sp-workspace-account">
            <span>{{ ACCOUNT_WORDS.title }}</span>
            <select :value="workspaceAccountId" :disabled="!connectedAccounts.length" @change="selectWorkspaceAccount">
              <option v-if="!connectedAccounts.length" value="" disabled>{{ ACCOUNT_WORDS['no-account-selection'] }}</option>
              <option v-for="account in connectedAccounts" :key="account.id" :value="account.id">{{ account.name }} · {{ account.provider_id }}</option>
            </select>
          </label>
          <div class="sp-mode" role="group" :aria-label="INBOX['inbox-mode']">
            <button type="button" :aria-pressed="workspaceMode === 'messages'" @click="workspaceMode = 'messages'; setView('inbox')">{{ INBOX.messages }}</button>
            <button type="button" :aria-pressed="workspaceMode === 'notifications'" @click="workspaceMode = 'notifications'; setView('inbox')">{{ INBOX.notifications }}</button>
          </div>
        </div>
        <p v-if="workspaceLoading" class="sp-empty">{{ PAGE.loading }}</p>
        <p v-if="workspaceError" class="sp-error" role="alert">{{ workspaceError }}</p>
        <div
          v-else-if="!workspaceLoading"
          :class="['sp-record-workspace', { 'sp-record-workspace-empty': !workspaceRecords.length }]"
        >
          <div class="sp-record-list" role="list">
            <button
              v-for="item in workspaceRecords"
              :key="item._key"
              type="button"
              class="sp-record-row"
              :aria-current="workspaceSelectedId === item._key ? 'true' : undefined"
              @click="workspaceMode === 'messages' ? selectConversation(item) : workspaceSelection(item)"
            >
              <strong>{{ item._title }}</strong>
              <span>{{ item._subtitle }}</span>
              <small>{{ item._status }}</small>
            </button>
            <p v-if="!workspaceRecords.length" class="sp-empty">
              {{
                connectedAccounts.length
                  ? workspaceMode === 'messages'
                    ? INBOX['empty-messages']
                    : INBOX['empty-notifications']
                  : ACCOUNT_WORDS.empty
              }}
            </p>
          </div>
          <aside v-if="workspaceSelected || workspaceRecords.length" class="sp-panel sp-record-detail">
            <template v-if="workspaceSelected">
              <h3>{{ workspaceSelected._title }}</h3>
              <p class="sp-record-body">{{ workspaceDetail(workspaceSelected) }}</p>
              <p class="sp-muted">{{ workspaceTimestamp(workspaceSelected) }}</p>
              <div v-if="workspaceMode === 'messages'" class="sp-message-list">
                <article v-for="message in workspaceMessages" :key="message._key" class="sp-message-item">
                  <strong>{{ message._subtitle }}</strong>
                  <p>{{ workspaceDetail(message) }}</p>
                  <small>{{ workspaceTimestamp(message) }}</small>
                </article>
                <form v-if="hasOperation(workspaceAccountId, 'messages.write')" class="sp-context-form" @submit.prevent="sendConversationReply">
                  <label><span>{{ INBOX.reply }}</span><textarea v-model="workspaceReply" rows="3" required /></label>
                  <button class="sp-secondary" type="submit" :disabled="workspaceBusy">{{ INBOX['send-reply'] }}</button>
                </form>
              </div>
              <button
                v-else-if="hasOperation(workspaceAccountId, 'notifications.seen')"
                class="sp-secondary"
                type="button"
                :disabled="workspaceBusy"
                @click="markSelectedNotificationSeen"
              >
                {{ INBOX['mark-seen'] }}
              </button>
            </template>
            <p v-else class="sp-empty">{{ INBOX['select-record'] }}</p>
          </aside>
        </div>
      </section>

      <section v-else-if="activeView === 'explore'" class="sp-view">
        <div class="sp-top">
          <div class="sp-heading">
            <h2>{{ EXPLORE.title }}</h2>
            <p>{{ EXPLORE.description }}</p>
          </div>
        </div>
        <div class="ui-toolbar sp-explore-tools">
          <label class="sp-workspace-account">
            <span>{{ ACCOUNT_WORDS.title }}</span>
            <select :value="workspaceAccountId" :disabled="!connectedAccounts.length" @change="selectWorkspaceAccount">
              <option v-if="!connectedAccounts.length" value="" disabled>{{ ACCOUNT_WORDS['no-account-selection'] }}</option>
              <option v-for="account in connectedAccounts" :key="account.id" :value="account.id">{{ account.name }} · {{ account.provider_id }}</option>
            </select>
          </label>
          <div class="sp-mode" role="group" :aria-label="EXPLORE['explore-mode']">
            <button type="button" :aria-pressed="workspaceMode === 'search'" @click="workspaceMode = 'search'">{{ EXPLORE.search }}</button>
            <button type="button" :aria-pressed="workspaceMode === 'profile'" @click="workspaceMode = 'profile'">{{ EXPLORE.profiles }}</button>
            <button type="button" :aria-pressed="workspaceMode === 'following'" @click="workspaceMode = 'following'; loadRelationships()">{{ EXPLORE.following }}</button>
            <button type="button" :aria-pressed="workspaceMode === 'followers'" @click="workspaceMode = 'followers'; loadRelationships()">{{ EXPLORE.followers }}</button>
            <button type="button" :aria-pressed="workspaceMode === 'blocked'" @click="workspaceMode = 'blocked'; loadRelationships()">{{ EXPLORE.blocked }}</button>
            <button type="button" :aria-pressed="workspaceMode === 'muted'" @click="workspaceMode = 'muted'; loadRelationships()">{{ EXPLORE.muted }}</button>
          </div>
          <form v-if="workspaceMode === 'search' && hasOperation(workspaceAccountId, 'search.posts')" class="sp-explore-form" @submit.prevent="searchWorkspace">
            <label><span>{{ EXPLORE['search-posts'] }}</span><input v-model="workspaceQuery" type="search" required /></label>
            <button class="sp-secondary" type="submit" :disabled="workspaceLoading">{{ EXPLORE.search }}</button>
          </form>
          <form v-if="workspaceMode === 'profile' && hasOperation(workspaceAccountId, 'profiles.read')" class="sp-explore-form" @submit.prevent="lookupProfile(workspaceQuery)">
            <label><span>{{ EXPLORE['profile-handle'] }}</span><input v-model="workspaceQuery" type="text" required /></label>
            <button class="sp-secondary" type="submit" :disabled="workspaceLoading">{{ EXPLORE['lookup-profile'] }}</button>
          </form>
        </div>
        <p v-if="workspaceLoading" class="sp-empty">{{ PAGE.loading }}</p>
        <p v-if="workspaceError" class="sp-error" role="alert">{{ workspaceError }}</p>
        <div
          v-else-if="!workspaceLoading"
          :class="['sp-record-workspace', { 'sp-record-workspace-empty': !workspaceRecords.length }]"
        >
          <div class="sp-record-list" role="list">
            <button
              v-for="item in workspaceRecords"
              :key="item._key"
              type="button"
              class="sp-record-row"
              :aria-current="workspaceSelectedId === item._key ? 'true' : undefined"
              @click="workspaceSelection(item)"
            >
              <strong>{{ item._title }}</strong><span>{{ item._subtitle }}</span><small>{{ item._status }}</small>
            </button>
            <p v-if="!workspaceRecords.length" class="sp-empty">
              {{ connectedAccounts.length ? EXPLORE['empty-results'] : ACCOUNT_WORDS.empty }}
            </p>
          </div>
          <aside v-if="workspaceProfile || workspaceSelected || workspaceRecords.length" class="sp-panel sp-record-detail">
            <template v-if="workspaceProfile || workspaceSelected">
              <h3>{{ recordValue(workspaceProfile, ['displayName', 'display_name', 'name', 'handle', 'username']) || workspaceSelected?._title }}</h3>
              <p class="sp-record-body">{{ recordValue(workspaceProfile, ['description', 'bio', 'text']) || workspaceDetail(workspaceSelected) }}</p>
              <p class="sp-muted">{{ recordValue(workspaceProfile, ['handle', 'username', 'followersCount', 'followers_count']) || workspaceSelected?._subtitle }}</p>
              <div class="sp-row-actions">
                <template v-for="operation in ['graph.follow', 'graph.unfollow', 'graph.block', 'graph.unblock', 'graph.mute', 'graph.unmute']" :key="operation">
                  <button v-if="hasOperation(workspaceAccountId, operation)" class="sp-subtle" type="button" :disabled="workspaceBusy" @click="actOnSelectedProfile(operation)">
                    {{ operationLabel(operation) }}
                  </button>
                </template>
                <template v-for="operation in ['posts.removeFromPlatform', 'posts.deleteBackendRecord']" :key="operation">
                  <button v-if="workspaceMode === 'search' && hasOperation(workspaceAccountId, operation)" class="sp-subtle" type="button" :disabled="workspaceBusy" @click="performRemotePostAction(operation)">
                    {{ operationLabel(operation) }}
                  </button>
                </template>
              </div>
            </template>
            <p v-else class="sp-empty">{{ EXPLORE['select-record'] }}</p>
          </aside>
        </div>
      </section>

      <section v-else-if="activeView === 'accounts'" class="sp-view">
        <div class="sp-top">
          <div class="sp-heading">
            <h2>{{ ACCOUNT_WORDS.title }}</h2>
            <p>{{ ACCOUNT_WORDS.description }}</p>
          </div>
        </div>
        <section class="sp-panel">
          <div v-if="!accounts.length" class="sp-empty sp-account-empty">
            <strong>{{ ACCOUNT_WORDS.empty }}</strong>
            <span
              v-if="
                !providers.some((item) => item.configured) &&
                !backends.some((backend) => backend.configured)
              "
            >
              {{ ACCOUNT_WORDS['configure-first'] }}
            </span>
          </div>
          <article v-for="account in accounts" :key="account.id" class="sp-account-card">
            <div class="sp-account">
              <div class="sp-account-avatar">{{ account.name.slice(0, 1) }}</div>
              <div class="sp-account-info">
                <strong>{{ account.name }}</strong>
                <span>{{ account.provider_id }} · @{{ account.username }}</span>
                <span class="sp-status" :data-status="account.status">{{
                  ACCOUNT_STATUS[account.status.replaceAll('_', '-')] || account.status
                }}</span>
              </div>
              <button
                v-if="account.status === 'connected'"
                class="sp-subtle"
                type="button"
                :aria-expanded="accountInspector.openId === account.id"
                @click="toggleAccountDetails(account)"
              >
                {{
                  accountInspector.openId === account.id
                    ? ACCOUNT_OPERATIONS['hide-details']
                    : ACCOUNT_OPERATIONS.details
                }}
              </button>
              <button
                v-if="account.status !== 'disconnected'"
                class="sp-subtle"
                type="button"
                :disabled="busy"
                @click="disconnect(account)"
              >
                {{ ACCOUNT_WORDS.disconnect }}
              </button>
            </div>
            <div v-if="accountInspector.openId === account.id" class="sp-account-details">
              <p v-if="accountInspector.loadingId === account.id" class="sp-empty">
                {{ ACCOUNT_OPERATIONS['loading-details'] }}
              </p>
              <template v-else>
                <label v-if="canManageSocialAccounts" class="sp-approval-toggle">
                  <input
                    type="checkbox"
                    :checked="account.approval_required"
                    :disabled="busy"
                    @change="setAccountApproval(account, $event.target.checked)"
                  />
                  <span>{{ ACCESS['approval-setting'] }}</span>
                </label>
                <h4>{{ ACCOUNT_OPERATIONS['available-workspaces'] }}</h4>
                <p v-if="!accountViews(account).length" class="sp-empty">
                  {{ ACCOUNT_OPERATIONS['no-workspaces'] }}
                </p>
                <div class="sp-account-workspaces">
                  <button
                    v-for="view in accountViews(account)"
                    :key="view"
                    class="sp-secondary"
                    type="button"
                    @click="openAccountView(view, account)"
                  >
                    {{ PAGE[`${view}-tab`] || W.page?.[view]?.title || view }}
                  </button>
                </div>
              </template>
            </div>
          </article>
          <p v-if="accountInspector.error" class="sp-error" role="alert">
            {{ accountInspector.error }}
          </p>
          <div class="sp-connect">
            <button
              v-for="provider in providers.filter((item) => item.configured)"
              :key="provider.id"
              class="sp-secondary"
              type="button"
              :disabled="busy"
              @click="connect(provider)"
            >
              {{ ACCOUNT_WORDS.connect }} {{ provider.name }}
            </button>
            <label v-if="backends.some((backend) => backend.configured)" class="sp-connector">
              <span>{{ ACCOUNT_WORDS['managed-backend'] }}</span>
              <select
                v-model="managedConnectForm.backendId"
                @change="selectManagedBackend"
              >
                <option
                  v-for="backend in backends.filter((item) => item.configured)"
                  :key="backend.id"
                  :value="backend.id"
                >
                  {{ backendName(backend) }}
                </option>
              </select>
              <select v-model="managedConnectForm.platform" required>
                <option
                  v-for="platform in managedPlatformChoices"
                  :key="platform"
                  :value="platform"
                >
                  {{ platform }}
                </option>
              </select>
              <select
                v-if="managedConnectForm.backendId === 'zernio'"
                v-model="managedConnectForm.profileId"
                required
              >
                <option
                  v-for="profile in managedProfiles"
                  :key="profile.id"
                  :value="profile.id"
                >
                  {{ profile.name }}
                </option>
              </select>
              <button
                class="sp-secondary"
                type="button"
                :disabled="
                  busy ||
                  !managedConnectForm.backendId ||
                  !managedConnectForm.platform ||
                  (managedConnectForm.backendId === 'zernio' && !managedConnectForm.profileId)
                "
                @click="connectManaged"
              >
                {{ ACCOUNT_WORDS['start-managed-connection'] }}
              </button>
            </label>
            <p
              v-if="
                accounts.length &&
                !providers.some((item) => item.configured) &&
                !backends.some((backend) => backend.configured)
              "
              class="sp-empty"
            >
              {{ ACCOUNT_WORDS['configure-first'] }}
            </p>
          </div>
        </section>
      </section>

      <section
        v-else-if="activeView === 'settings' && isAdmin"
        class="sp-view sp-settings"
        :class="{ 'sp-settings-access': settingsPane === 'access' }"
      >
        <div class="sp-top">
          <div class="sp-heading">
            <h2>{{ PAGE['settings-tab'] }}</h2>
            <p>{{ PAGE['settings-description'] }}</p>
          </div>
        </div>
        <nav class="ui-pagetabs sp-settings-tabs" :aria-label="ACCESS['settings-navigation']">
          <button
            type="button"
            :class="{ on: settingsPane === 'providers' }"
            :aria-pressed="settingsPane === 'providers'"
            @click="settingsPane = 'providers'"
          >
            {{ ACCESS['provider-settings-tab'] }}
          </button>
          <button
            type="button"
            :class="{ on: settingsPane === 'access' }"
            :aria-pressed="settingsPane === 'access'"
            @click="settingsPane = 'access'"
          >
            {{ ACCESS['publisher-access-tab'] }}
          </button>
          <button
            type="button"
            :class="{ on: settingsPane === 'calendar' }"
            :aria-pressed="settingsPane === 'calendar'"
            @click="settingsPane = 'calendar'"
          >
            {{ ACCESS['calendar-settings-tab'] }}
          </button>
        </nav>
        <label class="sp-settings-mobile-nav">
          <span>{{ ACCESS['settings-navigation'] }}</span>
          <select v-model="settingsPane" :aria-label="ACCESS['settings-navigation']">
            <option value="providers">{{ ACCESS['provider-settings-tab'] }}</option>
            <option value="access">{{ ACCESS['publisher-access-tab'] }}</option>
            <option value="calendar">{{ ACCESS['calendar-settings-tab'] }}</option>
          </select>
        </label>
        <section v-if="settingsPane === 'calendar'" class="sp-panel">
          <header class="sp-panel-head">
            <div>
              <h3>{{ PAGE['calendar-settings-title'] }}</h3>
              <p>{{ PAGE['calendar-settings-description'] }}</p>
            </div>
          </header>
          <label class="sp-tz-label sp-timezone-setting">
            <span>{{ PAGE.timezone }}</span>
            <select v-model="timezone" :aria-label="PAGE.timezone">
              <option v-for="zone in timeZones" :key="zone" :value="zone">{{ zone }}</option>
            </select>
          </label>
        </section>
        <section v-if="settingsPane === 'providers'" class="sp-panel">
          <header class="sp-panel-head">
            <div>
              <h3>{{ ACCOUNT_WORDS['provider-settings'] }}</h3>
              <p>{{ ACCOUNT_WORDS['provider-settings-description'] }}</p>
            </div>
          </header>
          <form class="sp-form" @submit.prevent="saveProvider">
            <label
              >{{ ACCOUNT_WORDS.provider }}
              <select v-model="providerForm.providerId" required>
                <option v-for="provider in providers" :key="provider.id" :value="provider.id">
                  {{ provider.name }}
                </option>
              </select>
            </label>
            <template v-if="providerForm.providerId === 'bluesky'">
              <p class="sp-empty">{{ ACCOUNT_WORDS['bluesky-provider-setup'] }}</p>
            </template>
            <template v-else>
              <label
                >{{ ACCOUNT_WORDS['client-id']
                }}<input v-model="providerForm.clientId" autocomplete="off" required
              /></label>
              <label
                >{{ ACCOUNT_WORDS['client-secret']
                }}<input
                  v-model="providerForm.clientSecret"
                  type="password"
                  autocomplete="new-password"
                  required
              /></label>
            </template>
            <button class="sp-secondary" type="submit" :disabled="busy">
              {{ ACCOUNT_WORDS['save-provider'] }}
            </button>
          </form>
        </section>

        <section v-if="settingsPane === 'providers'" class="sp-panel">
          <header class="sp-panel-head">
            <div>
              <h3>{{ ACCOUNT_WORDS['managed-backend-settings'] }}</h3>
              <p>{{ ACCOUNT_WORDS['managed-backend-settings-description'] }}</p>
            </div>
          </header>
          <form class="sp-form" @submit.prevent="saveBackend">
            <label>
              {{ ACCOUNT_WORDS['managed-backend'] }}
              <select v-model="backendForm.backendId" required>
                <option v-for="backend in backends" :key="backend.id" :value="backend.id">
                  {{ backendName(backend) }}
                </option>
              </select>
            </label>
            <label>
              {{ ACCOUNT_WORDS['managed-api-key'] }}
              <input
                v-model="backendForm.apiKey"
                type="password"
                autocomplete="new-password"
                required
              />
            </label>
            <label>
              {{ ACCOUNT_WORDS['managed-webhook-secret'] }}
              <input
                v-model="backendForm.webhookSecret"
                type="password"
                autocomplete="new-password"
              />
            </label>
            <button class="sp-secondary" type="submit" :disabled="busy">
              {{ ACCOUNT_WORDS['save-managed-backend'] }}
            </button>
          </form>
          <p class="sp-muted">{{ ACCOUNT_WORDS['managed-secrets-write-only'] }}</p>
        </section>

        <section v-if="settingsPane === 'access'" class="sp-panel sp-access">
          <header class="sp-panel-head">
            <div>
              <h3>{{ ACCESS.title }}</h3>
              <p>{{ ACCESS.description }}</p>
            </div>
          </header>
          <form class="sp-invite" @submit.prevent="invitePublisher">
            <label
              >{{ ACCESS.email
              }}<input v-model="inviteEmail" type="email" autocomplete="email" required
            /></label>
            <button class="sp-secondary" type="submit" :disabled="busy">{{ ACCESS.invite }}</button>
          </form>
          <div class="sp-access-layout">
            <div class="sp-publisher-list">
              <article v-for="publisher in publishers" :key="publisher.id" class="sp-publisher">
                <button
                  class="sp-publisher-select"
                  type="button"
                  :aria-pressed="selectedPublisherId === publisher.id"
                  @click="editPublisherPermissions(publisher)"
                >
                  <strong>{{ publisher.email }}</strong>
                  <span>{{ ACCESS_STATUS[publisher.status.replaceAll('_', '-')] || publisher.status }}</span>
                  <small>{{
                    publisher.accountPermissions?.length
                      ? ACCESS['configured-accounts'].replace(
                          '{count}',
                          String(publisher.accountPermissions.length),
                        )
                      : ACCESS['not-configured']
                  }}</small>
                </button>
                <button
                  v-if="publisher.status === 'pending' || publisher.status === 'active'"
                  class="sp-subtle"
                  type="button"
                  :disabled="busy"
                  @click="revokePublisher(publisher)"
                >
                  {{ ACCESS.revoke }}
                </button>
              </article>
              <p v-if="!publishers.length" class="sp-empty">{{ ACCESS['no-publishers'] }}</p>
            </div>
            <section v-if="selectedPublisher" class="sp-permission-editor">
            <header class="sp-panel-head">
              <div>
                <h4>{{ ACCESS['permissions-for'] }} {{ selectedPublisher.email }}</h4>
                <p>{{ ACCESS['explicit-grants-only'] }}</p>
              </div>
            </header>
            <label class="sp-approval-toggle">
              <input type="checkbox" v-model="publisherCanManageAccounts" :disabled="busy" />
              <span>{{ ACCESS['manage-accounts'] }}</span>
            </label>
            <p class="sp-muted">{{ ACCESS['manage-accounts-description'] }}</p>
            <div class="sp-permission-scroll">
              <table class="sp-permission-table">
                <thead>
                  <tr>
                    <th scope="col">{{ ACCESS.account }}</th>
                    <th v-for="[, label] in ACCESS_ACTIONS" :key="label" scope="col">
                      {{ ACCESS[label] }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="account in accounts" :key="account.id">
                    <th scope="row">
                      <span>{{ account.name }}</span>
                      <small>{{ account.provider_id }} · @{{ account.username }}</small>
                      <small v-if="account.approval_required">{{ ACCESS['approval-required'] }}</small>
                    </th>
                    <td v-for="[permission, label] in ACCESS_ACTIONS" :key="label">
                      <label class="sp-permission-check">
                        <span class="ui-sr-only">{{ ACCESS[label] }}</span>
                        <input
                          v-model="publisherPermissionDraft[account.id][permission]"
                          type="checkbox"
                          :disabled="busy"
                        />
                      </label>
                    </td>
                  </tr>
                  <tr v-if="!accounts.length">
                    <td class="sp-empty" :colspan="ACCESS_ACTIONS.length + 1">
                      {{ ACCESS['no-accounts'] }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button
              class="sp-primary"
              type="button"
              :disabled="busy || ['revoked', 'expired'].includes(selectedPublisher.status)"
              @click="savePublisherPermissions"
            >
              {{ ACCESS['save-permissions'] }}
            </button>
            </section>
          </div>
        </section>
      </section>

      <section v-else-if="activeView === 'approvals' && canReviewApprovals" class="sp-view">
        <div class="sp-top">
          <div class="sp-heading">
            <h2>{{ ACCESS['approvals-title'] }}</h2>
            <p>{{ ACCESS['approvals-description'] }}</p>
          </div>
        </div>
        <section class="sp-panel">
          <p v-if="workspaceLoading" class="sp-empty">{{ PAGE.loading }}</p>
          <p v-if="workspaceError" class="sp-error" role="alert">{{ workspaceError }}</p>
          <article v-for="delivery in pendingApprovals" :key="delivery.id" class="sp-approval-row">
            <div class="sp-approval-copy">
              <strong>{{ delivery.account?.name }} · {{ delivery.account?.provider_id }}</strong>
              <p>{{ delivery.post?.body || PAGE['media-post'] }}</p>
              <small>{{
                delivery.approval_intent === 'immediate'
                  ? ACCESS['immediate-intent']
                  : ACCESS['scheduled-intent'].replace(
                      '{time}',
                      new Date(delivery.scheduled_at).toLocaleString(),
                    )
              }}</small>
            </div>
            <div v-if="canReviewApproval(delivery)" class="sp-delivery-actions">
              <button
                class="sp-secondary"
                type="button"
                :disabled="workspaceBusy"
                @click="reviewApproval(delivery, 'approve')"
              >
                {{ ACCESS.approve }}
              </button>
              <button
                class="sp-subtle"
                type="button"
                :disabled="workspaceBusy"
                @click="reviewApproval(delivery, 'return')"
              >
                {{ ACCESS['return-to-draft'] }}
              </button>
            </div>
          </article>
          <p v-if="!workspaceLoading && !pendingApprovals.length" class="sp-empty">
            {{ ACCESS['approvals-empty'] }}
          </p>
        </section>
      </section>

      <section v-else-if="activeView === 'drafts'" class="sp-view">
        <div class="sp-top">
          <div class="sp-heading">
            <h2>{{ PAGE.drafts }}</h2>
            <p>{{ PAGE['drafts-description'] }}</p>
          </div>
        </div>
        <section class="sp-panel sp-drafts">
          <button
            v-for="post in draftPosts"
            :key="post.id"
            type="button"
            class="sp-draft"
            @click="editPost(post)"
          >
            <span>{{ post.body || PAGE['media-post'] }}</span>
            <small>{{
              dayLabel(dayKey(new Date(post.updated_at), timezone), {
                month: 'short',
                day: 'numeric',
              })
            }}</small>
          </button>
          <p v-if="!draftPosts.length" class="sp-empty">{{ PAGE['drafts-empty'] }}</p>
        </section>
      </section>
      </main>
    </template>

    <div v-if="editorOpen" class="sp-overlay" @click.self="editorOpen = false">
      <section class="sp-composer" role="dialog" aria-modal="true" :aria-label="EDITOR.title">
        <header class="sp-composer-head">
          <div>
            <h2>{{ form.id ? EDITOR['edit-title'] : EDITOR.title }}</h2>
            <p>{{ EDITOR.description }}</p>
          </div>
          <button
            type="button"
            class="sp-close"
            :aria-label="EDITOR.close"
            @click="editorOpen = false"
          >
            ×
          </button>
        </header>
        <div class="sp-composer-body">
          <p v-if="lockedPost" class="sp-message">{{ EDITOR['delivery-locked'] }}</p>
          <section
            v-if="form.id && posts.find((post) => post.id === form.id)?.deliveries.length"
            class="sp-deliveries"
          >
            <h3>{{ PAGE['delivery-title'] }}</h3>
            <article
              v-for="delivery in posts.find((post) => post.id === form.id).deliveries"
              :key="delivery.id"
              class="sp-delivery"
            >
              <div class="sp-delivery-copy">
                <strong>{{ accountName(delivery) }}</strong>
                <span class="sp-status" :data-status="delivery.status">{{
                  statusWord(delivery.status)
                }}</span>
                <small v-if="delivery.last_error">{{ delivery.last_error }}</small>
              </div>
              <div
                v-if="['failed', 'blocked', 'review_required'].includes(delivery.status)"
                class="sp-delivery-actions"
              >
                <button
                  class="sp-secondary"
                  type="button"
                  :disabled="busy"
                  @click="recoverDelivery(delivery, 'retry')"
                >
                  {{ PAGE['retry-delivery'] }}
                </button>
                <button
                  v-if="delivery.status === 'review_required'"
                  class="sp-subtle"
                  type="button"
                  :disabled="busy"
                  @click="recoverDelivery(delivery, 'marked_published')"
                >
                  {{ PAGE['mark-published'] }}
                </button>
              </div>
            </article>
          </section>
          <label class="sp-field"
            >{{ EDITOR.text
            }}<textarea
              v-model="form.text"
              rows="6"
              maxlength="25000"
              :readonly="lockedPost"
            ></textarea>
          </label>
          <div class="sp-media">
            <div class="sp-media-head">
              <strong>{{ EDITOR.media }}</strong
              ><label v-if="!lockedPost" class="sp-file"
                >{{ EDITOR['add-media']
                }}<input
                  type="file"
                  accept="image/jpeg,image/png,video/mp4"
                  multiple
                  :disabled="busy || redditSelected"
                  @change="uploadFiles($event)"
              /></label>
            </div>
            <p>{{ EDITOR['media-help'] }}</p>
            <p v-if="redditSelected" class="sp-muted">{{ EDITOR['reddit-text-only-help'] }}</p>
            <div v-if="form.attachments.length" class="sp-attachments">
              <article
                v-for="(attachment, index) in form.attachments"
                :key="attachment.id"
                class="sp-attachment"
              >
                <img
                  v-if="attachment.kind === 'image'"
                  :src="attachment.previewUrl"
                  :alt="attachment.file_name"
                />
                <video v-else :src="attachment.previewUrl" controls preload="metadata"></video>
                <div>
                  <strong>{{ attachment.file_name }}</strong
                  ><small>{{ (attachment.byte_size / 1048576).toFixed(1) }} MB</small>
                </div>
                <div class="sp-attachment-actions">
                  <button
                    v-if="!lockedPost"
                    type="button"
                    :aria-label="EDITOR['move-media-up']"
                    :disabled="busy || index === 0"
                    @click="moveAttachment(index, -1)"
                  >
                    ↑
                  </button>
                  <button
                    v-if="!lockedPost"
                    type="button"
                    :aria-label="EDITOR['move-media-down']"
                    :disabled="busy || index === form.attachments.length - 1"
                    @click="moveAttachment(index, 1)"
                  >
                    ↓
                  </button>
                  <label v-if="!lockedPost" class="sp-file" :aria-label="EDITOR['replace-media']"
                    >↻<input
                      type="file"
                      accept="image/jpeg,image/png,video/mp4"
                      :disabled="busy"
                      @change="uploadFiles($event, attachment.id)"
                  /></label>
                  <button
                    v-if="!lockedPost"
                    type="button"
                    :aria-label="EDITOR['remove-media']"
                    :disabled="busy"
                    @click="removeAttachment(attachment.id)"
                  >
                    ×
                  </button>
                </div>
              </article>
            </div>
          </div>
          <fieldset class="sp-targets">
            <legend>{{ EDITOR.accounts }}</legend>
            <label
              v-for="account in accounts.filter((item) => item.status === 'connected')"
              :key="account.id"
              class="sp-target"
            >
              <input
                v-model="form.accountIds"
                type="checkbox"
                :value="account.id"
                :disabled="
                  lockedPost || (account.provider_id === 'reddit' && form.attachments.length > 0)
                "
                @change="ensureTargetOptions(account.id)"
              />
              <span
                ><strong>{{ account.name }}</strong
                ><small>{{ account.provider_id }} · @{{ account.username }}</small></span
              >
            </label>
            <p v-if="!accounts.some((item) => item.status === 'connected')" class="sp-empty">
              {{ EDITOR['no-connected-accounts'] }}
            </p>
          </fieldset>
          <fieldset v-if="redditTargets.length" class="sp-targets">
            <legend>{{ EDITOR['reddit-options'] }}</legend>
            <div v-for="account in redditTargets" :key="account.id" class="sp-schedule-fields">
              <label
                >{{ EDITOR['reddit-subreddit']
                }}<input
                  v-model="form.targetOptions[account.id].subreddit"
                  maxlength="21"
                  :disabled="lockedPost"
              /></label>
              <label
                >{{ EDITOR['reddit-title']
                }}<input
                  v-model="form.targetOptions[account.id].title"
                  maxlength="300"
                  :disabled="lockedPost"
              /></label>
            </div>
          </fieldset>
          <div class="sp-schedule-fields">
            <label
              >{{ EDITOR['publish-at']
              }}<input
                v-model="form.scheduledLocal"
                type="datetime-local"
                step="60"
                :disabled="lockedPost"
            /></label>
            <label
              >{{ EDITOR.timezone
              }}<select v-model="form.timezone" :disabled="lockedPost">
                <option v-for="zone in timeZones" :key="zone" :value="zone">{{ zone }}</option>
              </select></label
            >
          </div>
          <p v-if="notice" class="sp-notice" role="status">{{ notice }}</p>
          <p v-if="errorText" class="sp-error" role="alert">{{ errorText }}</p>
        </div>
        <footer class="sp-composer-foot">
          <button
            v-if="
              form.id &&
              posts
                .find((post) => post.id === form.id)
                ?.deliveries.some((delivery) =>
                  ['scheduled', 'retry_wait', 'blocked', 'failed'].includes(delivery.status),
                )
            "
            class="sp-danger"
            type="button"
            :disabled="busy"
            @click="cancelSchedule(posts.find((post) => post.id === form.id))"
          >
            {{ EDITOR['cancel-schedule'] }}
          </button>
          <span class="sp-grow"></span>
          <button
            class="sp-secondary"
            type="button"
            :disabled="busy || lockedPost"
            @click="savePost"
          >
            {{ EDITOR['save-draft'] }}
          </button>
          <button
            class="sp-primary"
            type="button"
            :disabled="busy || lockedPost || !form.accountIds.length"
            @click="schedulePost"
          >
            {{ EDITOR.schedule }}
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.sp-admin {
  color: var(--ink, #25241f);
  min-width: 0;
  container-name: social-admin;
  container-type: inline-size;
}
.sp-top,
.sp-panel-head,
.sp-cal-head,
.sp-composer-head,
.sp-composer-foot,
.sp-media-head,
.sp-invite,
.sp-account,
.sp-publisher,
.sp-day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.sp-view {
  display: grid;
  gap: 1rem;
}
.sp-settings {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
}
.sp-settings-access {
  grid-template-columns: minmax(0, 1fr);
}
.sp-heading h2,
.sp-panel h3,
.sp-composer h2,
.sp-cal-head h3 {
  margin: 0;
  color: var(--ink, #25241f);
}
.sp-heading p,
.sp-panel-head p,
.sp-composer-head p,
.sp-media p {
  color: var(--ink2, #77736b);
  margin: 0.35rem 0 0;
}
.sp-tools {
  display: flex;
  align-items: end;
  gap: 0.65rem;
  flex-wrap: wrap;
}
.sp-tz-label,
.sp-form label,
.sp-invite label,
.sp-schedule-fields label,
.sp-field {
  display: grid;
  gap: 0.35rem;
  color: var(--ink2, #77736b);
  font-size: 0.82rem;
}
.sp-tz-label select {
  min-width: 12rem;
}
.sp-admin button,
.sp-admin input,
.sp-admin select,
.sp-admin textarea {
  font: inherit;
}
.sp-admin button,
.sp-admin select,
.sp-admin input:not([type='checkbox']):not([type='file']),
.sp-admin textarea {
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.55rem;
}
.sp-admin button {
  cursor: pointer;
  color: inherit;
  background: var(--paper, #fffefa);
  padding: 0.55rem 0.8rem;
}
.sp-admin button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.sp-admin input:not([type='checkbox']):not([type='file']),
.sp-admin select,
.sp-admin textarea {
  color: var(--ink, #25241f);
  background: var(--paper, #fffefa);
  padding: 0.6rem 0.7rem;
  min-width: 0;
}
.sp-admin textarea {
  resize: vertical;
}
.sp-primary {
  border-color: var(--accent, #b65c45) !important;
  color: #fff !important;
  background: var(--accent, #b65c45) !important;
  font-weight: 650 !important;
}
.sp-secondary {
  font-weight: 600;
}
.sp-subtle {
  background: transparent !important;
}
.sp-danger {
  color: #a13c32 !important;
}
.sp-mode {
  display: flex;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.6rem;
  overflow: hidden;
}
.sp-mode button {
  border: 0;
  border-radius: 0;
}
.sp-mode button[aria-pressed='true'] {
  color: var(--accent, #b65c45);
  background: color-mix(in srgb, var(--accent, #b65c45) 10%, var(--paper, #fffefa));
}
.sp-calendar,
.sp-panel {
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.9rem;
  background: var(--paper, #fffefa);
}
.sp-calendar {
  overflow: hidden;
}
.sp-cal-head {
  min-height: 3.6rem;
  padding: 0.65rem 0.9rem;
}
.sp-period {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}
.sp-period button {
  font-size: 1.25rem;
  line-height: 1;
}
.sp-weekdays,
.sp-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}
.sp-weekdays {
  border-top: 1px solid var(--line, #ded9cf);
  border-bottom: 1px solid var(--line, #ded9cf);
  color: var(--ink2, #77736b);
  font-size: 0.75rem;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.sp-weekdays > div {
  padding: 0.65rem 0.25rem;
}
.sp-day {
  min-height: 8rem;
  padding: 0.4rem;
  border-right: 1px solid var(--line, #ded9cf);
  border-bottom: 1px solid var(--line, #ded9cf);
}
.sp-day:nth-child(7n) {
  border-right: 0;
}
.sp-grid-week .sp-day {
  min-height: 18rem;
}
.sp-day-outside {
  color: var(--ink2, #77736b);
  background: color-mix(in srgb, var(--paper, #fffefa) 88%, var(--line, #ded9cf));
}
.sp-day-selected .sp-day-head > span {
  color: var(--accent, #b65c45);
  font-weight: 750;
}
.sp-day-head {
  justify-content: flex-end;
  min-height: 1.9rem;
  font-size: 0.85rem;
}
.sp-day-head button {
  padding: 0.12rem 0.45rem;
  border: 0;
  background: transparent;
  color: var(--accent, #b65c45);
  font-size: 1.2rem;
}
.sp-day-head .sp-day-select {
  margin-right: auto;
  color: inherit;
  font-size: 0.85rem;
}
.sp-day-head .sp-day-select[aria-pressed='true'] {
  color: var(--accent, #b65c45);
  font-weight: 750;
}
.sp-event {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  width: 100%;
  margin: 0.25rem 0;
  padding: 0.3rem 0.4rem !important;
  text-align: left;
  font-size: 0.72rem !important;
}
.sp-event-time {
  color: var(--ink2, #77736b);
}
.sp-event-copy {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sp-deliveries {
  display: grid;
  gap: 0.6rem;
}
.sp-deliveries h3 {
  margin: 0;
  font-size: 1rem;
}
.sp-delivery {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.6rem;
}
.sp-delivery-copy {
  display: grid;
  min-width: 0;
  gap: 0.25rem;
}
.sp-delivery-copy small {
  color: var(--ink2, #77736b);
  overflow-wrap: anywhere;
}
.sp-delivery-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.35rem;
}
.sp-status {
  display: inline-flex;
  justify-self: start;
  grid-column: 2;
  margin-top: 0.15rem;
  padding: 0.08rem 0.35rem;
  border-radius: 99px;
  color: var(--ink2, #77736b);
  background: color-mix(in srgb, var(--ink, #25241f) 7%, var(--paper, #fffefa));
  font-size: 0.67rem;
}
.sp-status[data-status='published'] {
  color: #276248;
  background: #e2efe7;
}
.sp-status[data-status='failed'],
.sp-status[data-status='blocked'],
.sp-status[data-status='review_required'],
.sp-status[data-status='reconnect_required'] {
  color: #933d31;
  background: #f7e6e1;
}
.sp-empty,
.sp-message {
  padding: 1rem;
  color: var(--ink2, #77736b);
}
.sp-panel {
  padding: 1rem;
}
.sp-panel-head {
  align-items: start;
  margin-bottom: 0.8rem;
}
.sp-account-card {
  border-top: 1px solid var(--line, #ded9cf);
}
.sp-account {
  justify-content: flex-start;
  padding: 0.65rem 0;
}
.sp-account-details {
  display: grid;
  gap: 0.65rem;
  padding: 0.35rem 0 1rem 3.3rem;
}
.sp-account-details h4,
.sp-operation h5 {
  margin: 0;
  font-size: 0.9rem;
}
.sp-operation {
  display: grid;
  gap: 0.6rem;
  padding: 0.8rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.7rem;
  background: color-mix(in srgb, var(--paper, #fffefa) 92%, var(--line, #ded9cf));
}
.sp-operation label {
  display: grid;
  gap: 0.3rem;
  color: var(--ink2, #77736b);
  font-size: 0.8rem;
}
.sp-operation-result {
  max-height: 18rem;
  overflow: auto;
  margin: 0;
  padding: 0.75rem;
  border-radius: 0.5rem;
  color: var(--ink, #25241f);
  background: color-mix(in srgb, var(--ink, #25241f) 5%, var(--paper, #fffefa));
  font-size: 0.72rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.sp-account-avatar {
  display: grid;
  place-items: center;
  width: 2.3rem;
  height: 2.3rem;
  flex: 0 0 auto;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent, #b65c45) 15%, var(--paper, #fffefa));
}
.sp-account-info,
.sp-publisher > div {
  display: grid;
  min-width: 0;
  gap: 0.12rem;
}
.sp-account-info > span,
.sp-publisher span {
  color: var(--ink2, #77736b);
  font-size: 0.78rem;
}
.sp-account-info .sp-status {
  grid-column: auto;
}
.sp-connect {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.7rem;
}
.sp-connector {
  display: grid;
  grid-template-columns: minmax(8rem, auto) repeat(3, minmax(8rem, 1fr)) auto;
  align-items: end;
  gap: 0.5rem;
  flex: 1 1 100%;
  color: var(--ink2, #77736b);
  font-size: 0.82rem;
}
.sp-connector > span {
  align-self: center;
}
.sp-muted {
  color: var(--ink2, #77736b);
  font-size: 0.8rem;
}
.sp-form {
  display: grid;
  gap: 0.65rem;
}
.sp-form button {
  justify-self: start;
}
.sp-invite {
  align-items: end;
  margin: 0.75rem 0;
}
.sp-invite label {
  flex: 1;
}
.sp-publisher {
  align-items: stretch;
  padding: 0.55rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.7rem;
}
.sp-publisher-select {
  display: grid;
  flex: 1 1 auto;
  min-width: 0;
  gap: 0.2rem;
  border-color: transparent !important;
  text-align: left;
}
.sp-publisher-select[aria-pressed='true'] {
  border-color: var(--accent, #b65c45) !important;
  background: color-mix(in srgb, var(--accent, #b65c45) 7%, var(--paper, #fffefa));
}
.sp-publisher-select small {
  color: var(--ink2, #77736b);
}
.sp-permission-editor {
  display: grid;
  gap: 0.85rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line, #ded9cf);
}
.sp-permission-scroll {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.65rem;
}
.sp-permission-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 0.78rem;
}
.sp-permission-table th,
.sp-permission-table td {
  padding: 0.65rem 0.5rem;
  border-bottom: 1px solid var(--line, #ded9cf);
}
.sp-permission-table thead th {
  color: var(--ink2, #77736b);
  font-weight: 600;
  vertical-align: bottom;
}
.sp-permission-table th:first-child {
  width: 13rem;
  text-align: left;
}
.sp-permission-table th:not(:first-child),
.sp-permission-table td {
  text-align: center;
}
.sp-permission-table tbody th {
  display: grid;
  gap: 0.18rem;
  font-weight: 600;
}
.sp-permission-table tbody th small {
  color: var(--ink2, #77736b);
  font-size: 0.7rem;
  font-weight: 400;
}
.sp-approval-toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  min-width: 0;
  line-height: 1.4;
}
.sp-approval-toggle input {
  flex: 0 0 auto;
  margin-top: 0.2rem;
}
.sp-approval-toggle span {
  min-width: 0;
}
.sp-permission-check {
  display: grid;
  place-items: center;
  min-height: 2rem;
}
.sp-approval-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 1rem;
  margin-top: 0.65rem;
  padding: 0.85rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.7rem;
}
.sp-approval-copy {
  display: grid;
  min-width: 0;
  gap: 0.35rem;
}
.sp-approval-copy p {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.sp-approval-copy small {
  color: var(--ink2, #77736b);
}
.sp-draft {
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
  width: 100%;
  margin: 0.25rem 0;
  text-align: left;
}
.sp-draft > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sp-draft small {
  flex: 0 0 auto;
  color: var(--ink2, #77736b);
}
.sp-notice {
  padding: 0.7rem 0.85rem;
  border-radius: 0.6rem;
  color: #276248;
  background: #e2efe7;
}
.sp-error {
  padding: 0.7rem 0.85rem;
  border-radius: 0.6rem;
  color: #933d31;
  background: #f7e6e1;
  white-space: pre-wrap;
}
.sp-overlay {
  position: fixed;
  z-index: 10000;
  inset: 0;
  display: grid;
  place-items: stretch end;
  background: rgb(18 20 28 / 55%);
}
.sp-composer {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(46rem, 100%);
  height: 100%;
  max-height: 100vh;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 1rem 0 0 1rem;
  background: var(--paper, #fffefa);
  box-shadow: 0 1.5rem 5rem rgb(0 0 0 / 25%);
  overflow: hidden;
}
.sp-composer-head,
.sp-composer-foot {
  padding: 1rem 1.2rem;
  border-bottom: 1px solid var(--line, #ded9cf);
}
.sp-composer-foot {
  border-top: 1px solid var(--line, #ded9cf);
  border-bottom: 0;
}
.sp-composer-body {
  display: grid;
  gap: 1rem;
  overflow: auto;
  padding: 1rem 1.2rem;
}
.sp-close {
  font-size: 1.3rem !important;
}
.sp-file {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: pointer;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.5rem;
  padding: 0.45rem 0.65rem;
  color: var(--ink, #25241f);
  background: var(--paper, #fffefa);
}
.sp-file input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
}
.sp-media-head strong,
.sp-targets legend {
  color: var(--ink, #25241f);
}
.sp-media-head {
  justify-content: flex-start;
}
.sp-attachments {
  display: grid;
  gap: 0.55rem;
}
.sp-attachment {
  display: grid;
  grid-template-columns: 4rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.7rem;
  padding: 0.55rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.65rem;
}
.sp-attachment img,
.sp-attachment video {
  width: 4rem;
  height: 3.2rem;
  object-fit: cover;
  border-radius: 0.35rem;
  background: #171717;
}
.sp-attachment > div:first-of-type {
  display: grid;
  min-width: 0;
  gap: 0.15rem;
  overflow: hidden;
}
.sp-attachment strong {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sp-attachment small {
  color: var(--ink2, #77736b);
}
.sp-attachment-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.sp-attachment-actions button,
.sp-attachment-actions .sp-file {
  padding: 0.35rem 0.48rem;
}
.sp-targets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.65rem;
  padding: 0.8rem;
}
.sp-targets legend {
  padding: 0 0.35rem;
  font-weight: 650;
}
.sp-target {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--paper, #fffefa) 92%, var(--line, #ded9cf));
}
.sp-target span {
  display: grid;
  min-width: 0;
}
.sp-target small {
  color: var(--ink2, #77736b);
}
.sp-schedule-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.7rem;
}
.sp-grow {
  flex: 1;
}
.sp-post-workspace,
.sp-record-workspace,
.sp-metric-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(18rem, 0.9fr);
  align-items: start;
  gap: 1rem;
}
.sp-analytics-filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 12rem));
  gap: 0.75rem;
}
.sp-post-grid {
  display: flex;
  min-width: 0;
  min-height: 28rem;
  width: 100%;
}
.sp-post-grid :deep(.ag-root-wrapper) {
  flex: 1;
  min-height: 28rem;
}
.sp-post-detail,
.sp-record-detail {
  min-width: 0;
  display: grid;
  gap: 0.75rem;
}
.sp-post-detail .sp-panel-head {
  margin-bottom: 0;
}
.sp-post-detail h4,
.sp-record-detail h4 {
  margin: 0;
}
.sp-muted,
.sp-delivery-card small,
.sp-record-row span,
.sp-record-row small,
.sp-message-item small {
  color: var(--ink2, #77736b);
  overflow-wrap: anywhere;
}
.sp-record-body {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.sp-deliveries {
  margin-top: 0.5rem;
}
.sp-delivery-card {
  display: grid;
  gap: 0.6rem;
  padding: 0.7rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.65rem;
}
.sp-delivery-card > div:first-child {
  display: grid;
  justify-items: start;
  gap: 0.3rem;
  min-width: 0;
}
.sp-row-actions,
.sp-account-workspaces {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.sp-account-workspaces {
  padding: 0 0 0.7rem 3.3rem;
}
.sp-workspace-account,
.sp-context-form label,
.sp-explore-form label {
  display: grid;
  gap: 0.35rem;
  color: var(--ink2, #77736b);
  font-size: 0.82rem;
}
.sp-workspace-account select {
  min-width: min(18rem, 100%);
}
.sp-record-list {
  display: grid;
  gap: 0.4rem;
  max-height: 34rem;
  overflow: auto;
}
.sp-record-row {
  display: grid;
  justify-items: start;
  gap: 0.2rem;
  min-width: 0;
  text-align: left;
}
.sp-record-row[aria-current='true'] {
  border-color: var(--accent, #b65c45);
  background: color-mix(in srgb, var(--accent, #b65c45) 8%, var(--paper, #fffefa));
}
.sp-record-row strong,
.sp-record-row span,
.sp-record-row small {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sp-record-row span,
.sp-record-row small {
  white-space: nowrap;
}
.sp-context-form {
  display: grid;
  gap: 0.65rem;
}
.sp-context-form textarea {
  width: 100%;
}
.sp-message-list {
  display: grid;
  gap: 0.65rem;
}
.sp-message-item {
  padding: 0.65rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.65rem;
}
.sp-message-item p {
  margin: 0.35rem 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.sp-metric-card dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.45rem 1rem;
}
.sp-metric-card dt {
  color: var(--ink2, #77736b);
}
.sp-metric-card dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.sp-metric-history {
  grid-column: 1 / -1;
}
.sp-metric-snapshots {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sp-metric-snapshots li {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.65rem;
}
.sp-metric-snapshots strong,
.sp-metric-snapshots summary {
  font-size: 0.85rem;
}
.sp-report-result {
  max-height: 22rem;
  overflow: auto;
  padding: 0.75rem;
  border-radius: 0.55rem;
  background: color-mix(in srgb, var(--ink, #25241f) 5%, var(--paper, #fffefa));
  font-size: 0.75rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.sp-explore-tools {
  display: grid;
  gap: 0.75rem;
}
.sp-explore-form {
  display: flex;
  align-items: end;
  gap: 0.5rem;
}
.sp-explore-form label {
  flex: 1;
}
.sp-provider-posts {
  display: grid;
  gap: 0.75rem;
}
.sp-provider-post-workspace {
  grid-template-columns: minmax(0, 1fr) minmax(18rem, 1fr);
}
@media (max-width: 720px) {
  .sp-top {
    align-items: stretch;
    flex-direction: column;
  }
  .sp-tools {
    align-items: stretch;
  }
  .sp-tz-label {
    flex: 1 1 100%;
  }
  .sp-tools {
    width: 100%;
  }
  .sp-connector {
    grid-template-columns: minmax(0, 1fr);
    flex-basis: 100%;
  }
  .sp-tz-label select {
    width: 100%;
  }
  .sp-settings {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-invite {
    align-items: stretch;
    flex-direction: column;
  }
  .sp-invite label {
    width: 100%;
  }
  .sp-invite button {
    align-self: flex-start;
  }
  .sp-account {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .sp-account-info {
    flex: 1 1 calc(100% - 3.5rem);
  }
  .sp-account-details {
    padding-left: 0;
  }
  .sp-post-workspace,
  .sp-record-workspace,
  .sp-metric-grid,
  .sp-analytics-filters,
  .sp-provider-post-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-post-grid {
    min-height: 23rem;
  }
  .sp-explore-tools .sp-mode {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    overflow: visible;
  }
  .sp-explore-tools .sp-mode button {
    min-width: 0;
    padding: 0.55rem 0.35rem;
    white-space: normal;
  }
  .sp-account-workspaces {
    padding-left: 0;
  }
  .sp-explore-form {
    align-items: stretch;
    flex-direction: column;
  }
  .sp-day {
    min-height: 5.3rem;
    padding: 0.2rem;
  }
  .sp-day-head {
    gap: 0.05rem;
  }
  .sp-day-head button {
    padding: 0;
  }
  .sp-day-head .sp-day-select {
    flex: 1 1 auto;
    min-width: 0;
    margin-right: 0;
    text-align: left;
    font-size: 0.72rem;
  }
  .sp-day-head button:not(.sp-day-select) {
    flex: 0 0 1.1rem;
    width: 1.1rem;
    font-size: 0.9rem;
  }
  .sp-grid-week .sp-day {
    min-height: 11rem;
  }
  .sp-event {
    display: block;
    padding: 0.2rem !important;
    font-size: 0.65rem !important;
  }
  .sp-event-time {
    display: none;
  }
  .sp-event-copy {
    display: block;
  }
  .sp-status {
    display: none;
  }
  .sp-delivery-card .sp-status {
    display: inline-flex;
  }
  .sp-cal-head {
    padding: 0.55rem;
  }
  .sp-day-head {
    min-height: 1.55rem;
  }
  .sp-day-head button {
    padding: 0.05rem 0.25rem;
  }
  .sp-overlay {
    padding: 0;
  }
  .sp-composer {
    width: 100%;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
  .sp-composer-head,
  .sp-composer-foot {
    padding: 0.8rem;
  }
  .sp-composer-body {
    padding: 0.8rem;
  }
  .sp-composer-foot {
    flex-wrap: wrap;
  }
  .sp-targets {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-schedule-fields {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-attachment {
    grid-template-columns: 3.3rem minmax(0, 1fr);
  }
  .sp-delivery {
    flex-direction: column;
  }
  .sp-delivery-actions {
    justify-content: flex-start;
  }
  .sp-attachment img,
  .sp-attachment video {
    width: 3.3rem;
  }
  .sp-attachment-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}

@container social-admin (max-width: 720px) {
  .sp-settings {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-post-workspace,
  .sp-record-workspace,
  .sp-metric-grid,
  .sp-provider-post-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-post-grid,
  .sp-post-detail,
  .sp-record-detail {
    width: 100%;
    min-width: 0;
  }
  .sp-analytics-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .sp-approval-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-delivery-actions {
    justify-content: flex-start;
  }
}

.sp-page-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.65rem;
  min-width: 0;
}
.sp-page-actions-calendar {
  --sp-control-height: 2.75rem;
  --sp-control-width: 8.125rem;
}
.sp-page-actions-calendar .sp-mode,
.sp-page-actions-calendar .sp-create {
  width: var(--sp-control-width);
  height: var(--sp-control-height);
  box-sizing: border-box;
}
.sp-create {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  min-height: 2.75rem;
  border-radius: 0.72rem !important;
  box-shadow: 0 0.25rem 0.65rem color-mix(in srgb, var(--accent, #b65c45) 22%, transparent);
}
.sp-page-actions-calendar .sp-create {
  min-height: var(--sp-control-height);
  padding: 0 0.5rem;
}
.sp-create > span {
  display: grid;
  place-items: center;
  width: 1.15rem;
  height: 1.15rem;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 1rem;
  line-height: 1;
}
.sp-workspace-nav {
  min-width: 0;
  flex: 0 1 21rem;
}
.sp-workspace-select {
  width: 100%;
  height: 2.75rem;
  min-height: 2.75rem;
  padding: 0 0.8rem;
}
.sp-main {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
.sp-main > .sp-view {
  gap: 1.15rem;
  padding: 0;
  border: 0;
}
.sp-admin :deep(.ui-pagebar) {
  align-items: center;
  min-height: 2.75rem;
  margin-top: 0.2rem;
}
.sp-admin :deep(.ui-pageacts) {
  justify-content: flex-end;
}
.sp-tools,
.sp-tz-label {
  --sp-control-height: 2.75rem;
}
.sp-tools {
  align-items: center;
  gap: 0.5rem;
}
.sp-tz-label {
  align-items: center;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.45rem;
}
.sp-tz-label select {
  min-width: 10rem;
  height: var(--sp-control-height);
  min-height: var(--sp-control-height);
  box-sizing: border-box;
}
.sp-mode {
  height: var(--sp-control-height);
  padding: 0.2rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.7rem;
  background: color-mix(in srgb, var(--paper, #fffefa) 88%, var(--line, #ded9cf));
  box-sizing: border-box;
}
.sp-mode button {
  height: 100%;
  min-height: 0;
  padding: 0.38rem 0.72rem;
  border: 0 !important;
  border-radius: 0.48rem;
  background: transparent;
  color: var(--ink2, #77736b);
  font-size: 0.82rem;
  font-weight: 600;
}
.sp-mode button[aria-pressed='true'] {
  color: var(--ink, #25241f);
  background: var(--paper, #fffefa);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--ink, #25241f) 12%, transparent);
}
.sp-admin :is(button, input, select, textarea):focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent, #b65c45) 34%, transparent);
  outline-offset: 2px;
}
.sp-admin button:not(:disabled):active {
  transform: translateY(1px);
}
.sp-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}
.sp-overview-card {
  display: grid;
  gap: 0.55rem;
  min-height: 6rem;
  padding: 1rem 1.05rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.9rem;
  background:
    radial-gradient(ellipse at 100% 0, color-mix(in srgb, var(--accent, #b65c45) 8%, transparent), transparent 62%),
    var(--paper, #fffefa);
  box-shadow: 0 0.35rem 1rem color-mix(in srgb, var(--ink, #25241f) 4%, transparent);
}
.sp-overview-card span {
  color: var(--ink2, #77736b);
  font-size: 0.77rem;
  font-weight: 650;
}
.sp-overview-card strong {
  color: var(--ink, #25241f);
  font-size: clamp(1.45rem, 2vw, 1.8rem);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.sp-heading h2 {
  font-size: clamp(1.2rem, 1.6vw, 1.45rem);
  letter-spacing: -0.025em;
}
.sp-heading p {
  max-width: 58ch;
  line-height: 1.5;
}
.sp-calendar,
.sp-panel {
  border-radius: 1rem;
  box-shadow: 0 0.35rem 1.2rem color-mix(in srgb, var(--ink, #25241f) 4%, transparent);
}
.sp-panel {
  padding: clamp(0.85rem, 1.5vw, 1.2rem);
}
.sp-panel-head {
  align-items: center;
  margin-bottom: 1rem;
}
.sp-panel-head h3,
.sp-panel-head h4 {
  font-size: 1rem;
  letter-spacing: -0.015em;
}
.sp-panel-head p {
  max-width: 62ch;
  font-size: 0.85rem;
  line-height: 1.5;
}
.sp-cal-head {
  min-height: 4.1rem;
  padding: 0.75rem 1rem;
}
.sp-period h3 {
  min-width: 11ch;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-align: center;
}
.sp-period button {
  display: grid;
  place-items: center;
  width: 2.15rem;
  height: 2.15rem;
  padding: 0;
  border-color: transparent;
  border-radius: 0.65rem;
  background: transparent;
  color: var(--ink2, #77736b);
}
.sp-period button:hover,
.sp-day-head button:not(.sp-day-select):hover {
  background: color-mix(in srgb, var(--ink, #25241f) 6%, var(--paper, #fffefa));
}
.sp-weekdays {
  background: color-mix(in srgb, var(--paper, #fffefa) 87%, var(--line, #ded9cf));
  font-size: 0.68rem;
  font-weight: 700;
}
.sp-weekdays > div {
  padding: 0.55rem 0.25rem;
}
.sp-day {
  min-height: 7.5rem;
  padding: 0.42rem;
  background: var(--paper, #fffefa);
}
.sp-day-selected {
  background: color-mix(in srgb, var(--accent, #b65c45) 4%, var(--paper, #fffefa));
}
.sp-day-head {
  justify-content: flex-start;
  min-height: 1.75rem;
  margin-bottom: 0.1rem;
}
.sp-day-head .sp-day-select {
  display: grid;
  place-items: center;
  min-width: 1.75rem;
  min-height: 1.75rem;
  margin-right: auto;
  padding: 0.1rem 0.35rem;
  border: 0;
  border-radius: 50%;
}
.sp-day-head .sp-day-select[aria-pressed='true'] {
  width: 1.75rem;
  color: var(--paper, #fffefa);
  background: var(--accent, #b65c45);
}
.sp-day-head button:not(.sp-day-select) {
  display: grid;
  place-items: center;
  width: 1.55rem;
  height: 1.55rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--ink2, #77736b);
  font-size: 1rem;
}
.sp-event {
  gap: 0.25rem 0.45rem;
  margin: 0.28rem 0;
  padding: 0.38rem 0.45rem !important;
  border-color: color-mix(in srgb, var(--accent, #b65c45) 18%, var(--line, #ded9cf)) !important;
  border-left: 2px solid var(--accent, #b65c45) !important;
  border-radius: 0.45rem !important;
  background: color-mix(in srgb, var(--accent, #b65c45) 6%, var(--paper, #fffefa)) !important;
}
.sp-event-time {
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
}
.sp-event-copy {
  color: var(--ink, #25241f);
  font-size: 0.72rem;
  font-weight: 600;
}
.sp-post-workspace,
.sp-record-workspace {
  gap: 1rem;
}
.sp-post-workspace {
  grid-template-columns: minmax(0, 1.45fr) minmax(17rem, 0.85fr);
}
.sp-post-grid,
.sp-post-grid :deep(.ag-root-wrapper) {
  min-height: 32rem;
}
.sp-post-detail,
.sp-record-detail {
  border-radius: 0.9rem;
  background: color-mix(in srgb, var(--paper, #fffefa) 96%, var(--line, #ded9cf));
}
.sp-record-list {
  display: grid;
  align-content: start;
  gap: 0.42rem;
  max-height: min(64vh, 42rem);
  overflow: auto;
  padding: 0.15rem;
}
.sp-record-row {
  gap: 0.28rem;
  padding: 0.8rem !important;
  border-color: transparent !important;
  border-radius: 0.75rem !important;
  background: transparent !important;
  text-align: left;
  transition:
    background-color 140ms ease,
    border-color 140ms ease;
}
.sp-record-row:hover {
  background: color-mix(in srgb, var(--ink, #25241f) 4%, var(--paper, #fffefa)) !important;
}
.sp-record-row[aria-current='true'] {
  border-color: color-mix(in srgb, var(--accent, #b65c45) 28%, var(--line, #ded9cf)) !important;
  background: color-mix(in srgb, var(--accent, #b65c45) 7%, var(--paper, #fffefa)) !important;
}
.sp-record-row strong {
  color: var(--ink, #25241f);
  font-size: 0.87rem;
}
.sp-record-row span,
.sp-record-row small {
  line-height: 1.4;
}
.sp-record-detail {
  min-height: 12rem;
  padding: 1rem;
}
.sp-draft {
  min-height: 5rem;
  padding: 0.85rem 1rem !important;
  border-radius: 0.75rem !important;
  text-align: left;
  transition:
    transform 140ms ease,
    border-color 140ms ease,
    box-shadow 140ms ease;
}
.sp-draft:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent, #b65c45) 30%, var(--line, #ded9cf)) !important;
  box-shadow: 0 0.35rem 0.8rem color-mix(in srgb, var(--ink, #25241f) 6%, transparent);
}
.sp-draft span {
  max-height: 3.2em;
  overflow: hidden;
  line-height: 1.55;
}
.sp-account-card {
  margin-top: 0.55rem;
  padding: 0.1rem 0.8rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.8rem;
  background: color-mix(in srgb, var(--paper, #fffefa) 98%, var(--line, #ded9cf));
}
.sp-account {
  min-height: 4.4rem;
  gap: 0.8rem;
}
.sp-account-avatar {
  width: 2.65rem;
  height: 2.65rem;
  color: var(--accent, #b65c45);
  font-weight: 750;
}
.sp-account-info {
  flex: 1 1 auto;
}
.sp-account-workspaces {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.sp-settings {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
}
.sp-settings-tabs {
  grid-column: 1 / -1;
  display: flex;
  width: fit-content;
  max-width: 100%;
  padding: 0.25rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.72rem;
  background: color-mix(in srgb, var(--paper, #fffefa) 90%, var(--line, #ded9cf));
}
.sp-settings-mobile-nav {
  display: none;
}
.sp-settings-tabs button {
  border-color: transparent !important;
  border-radius: 0.52rem !important;
  background: transparent !important;
  color: var(--ink2, #77736b);
  font-size: 0.84rem;
  font-weight: 600;
}
.sp-settings-tabs button.on {
  border-color: var(--line, #ded9cf) !important;
  background: var(--paper, #fffefa) !important;
  color: var(--ink, #25241f);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--ink, #25241f) 10%, transparent);
}
.sp-settings > .sp-panel {
  min-width: 0;
}
.sp-settings .sp-form {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}
.sp-settings .sp-form label {
  align-content: start;
  gap: 0.45rem;
  color: var(--ink2, #77736b);
  font-size: 0.77rem;
  font-weight: 650;
}
.sp-settings .sp-form input,
.sp-settings .sp-form select {
  width: 100%;
  min-height: 2.65rem;
  border-radius: 0.62rem;
}
.sp-settings .sp-form button {
  grid-column: 1 / -1;
  justify-self: end;
}
.sp-settings > .sp-panel > .sp-muted {
  margin: 0.85rem 0 0;
  line-height: 1.5;
}
.sp-access {
  grid-column: 1 / -1;
}
.sp-access-layout {
  display: grid;
  grid-template-columns: minmax(16rem, 0.72fr) minmax(0, 1.5fr);
  align-items: start;
  gap: 1rem;
}
.sp-publisher-list {
  display: grid;
  align-content: start;
  gap: 0.5rem;
}
.sp-publisher {
  align-items: center;
  padding: 0.55rem;
  border-color: var(--line, #ded9cf);
  border-radius: 0.75rem;
  background: var(--paper, #fffefa);
}
.sp-publisher-select {
  align-content: center;
  gap: 0.32rem;
  padding: 0.5rem !important;
}
.sp-publisher-select[aria-pressed='true'] {
  border-color: transparent !important;
  background: color-mix(in srgb, var(--accent, #b65c45) 7%, var(--paper, #fffefa));
}
.sp-permission-editor {
  margin: 0;
  padding: 1rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.9rem;
  background: color-mix(in srgb, var(--paper, #fffefa) 94%, var(--line, #ded9cf));
}
.sp-permission-table th,
.sp-permission-table td {
  padding: 0.72rem 0.55rem;
}
.sp-permission-table thead th {
  position: sticky;
  top: 0;
  background: var(--paper, #fffefa);
}
.sp-overlay {
  z-index: 1000;
  background: color-mix(in srgb, var(--ink, #25241f) 54%, transparent);
  backdrop-filter: blur(5px);
}
.sp-composer {
  width: min(58rem, calc(100vw - 3rem));
  border: 1px solid color-mix(in srgb, var(--line, #ded9cf) 75%, transparent);
  border-radius: 1.1rem;
  box-shadow: 0 1.5rem 5rem color-mix(in srgb, var(--ink, #25241f) 28%, transparent);
}
.sp-composer-head {
  padding: 1.2rem 1.35rem;
}
.sp-composer-body {
  gap: 1rem;
  padding: 1.25rem 1.35rem;
}
.sp-composer-foot {
  padding: 1rem 1.35rem;
  border-top: 1px solid var(--line, #ded9cf);
  background: color-mix(in srgb, var(--paper, #fffefa) 90%, var(--line, #ded9cf));
}
.sp-notice,
.sp-error {
  padding: 0.8rem 1rem;
  border-radius: 0.75rem;
  line-height: 1.45;
}
.sp-notice {
  border: 1px solid color-mix(in srgb, #276248 26%, var(--line, #ded9cf));
  background: color-mix(in srgb, #276248 8%, var(--paper, #fffefa));
}
.sp-error {
  border: 1px solid color-mix(in srgb, #a13c32 28%, var(--line, #ded9cf));
  background: color-mix(in srgb, #a13c32 8%, var(--paper, #fffefa));
}

@container social-admin (max-width: 760px) {
  .sp-admin :deep(.ui-pagesub) {
    display: none;
  }
  .sp-admin :deep(.ui-pagehead) {
    margin-bottom: 0.65rem;
    padding-bottom: 0.65rem;
  }
  .sp-admin :deep(.ui-pagebar) {
    margin-bottom: 0.7rem;
  }
  .sp-admin :deep(.ui-pagebarleft) {
    width: 100%;
  }
  .sp-admin :deep(.ui-pageacts) {
    flex: 1 1 100%;
    justify-content: stretch;
  }
  .sp-workspace-nav {
    flex: 1 1 100%;
    max-width: none;
  }
  .sp-page-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    width: 100%;
    gap: 0.5rem;
  }
  .sp-tools {
    grid-column: 1 / -1;
    grid-row: 1;
    width: 100%;
    flex-wrap: nowrap;
    gap: 0.45rem;
  }
  .sp-tz-label {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
  }
  .sp-tz-label select {
    width: 100%;
    min-width: 0;
    min-height: 2.75rem;
  }
  .sp-mode {
    flex: 0 0 auto;
  }
  .sp-mode button {
    height: 100%;
    min-height: 0;
    padding: 0.35rem 0.6rem;
    white-space: nowrap;
  }
  .sp-create {
    grid-column: 2;
    grid-row: 2;
    justify-self: end;
    min-height: 2.75rem;
    padding: 0.55rem 0.75rem;
    white-space: nowrap;
  }
  .sp-page-actions-calendar {
    --sp-control-width: 7.5rem;
  }
  .sp-page-actions-calendar .sp-create {
    padding: 0 0.5rem;
  }
  .sp-workspace-select {
    height: 2.75rem;
    min-height: 2.75rem;
  }
  .sp-main > .sp-view {
    gap: 0.7rem;
  }
  .sp-overview {
    gap: 0;
    border-bottom: 1px solid var(--line, #ded9cf);
  }
  .sp-overview-card {
    min-height: 0;
    gap: 0.25rem;
    padding: 0.4rem 0.5rem 0.65rem;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  .sp-overview-card + .sp-overview-card {
    border-left: 1px solid var(--line, #ded9cf);
  }
  .sp-overview-card span {
    font-size: 0.66rem;
    line-height: 1.2;
  }
  .sp-overview-card strong {
    font-size: 1.45rem;
  }
  .sp-cal-head {
    gap: 0.4rem;
    padding: 0.55rem;
  }
  .sp-period {
    gap: 0.25rem;
  }
  .sp-period h3 {
    min-width: 9ch;
    font-size: 0.9rem;
  }
  .sp-day {
    min-height: 5.2rem;
  }
  .sp-grid-week {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-grid-week .sp-day {
    min-height: 0;
    padding: 0.55rem 0.65rem;
    border-right: 0;
  }
  .sp-grid-week .sp-day-head {
    display: flex;
    justify-content: flex-start;
  }
  .sp-grid-week .sp-day-head .sp-day-select {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: flex-start;
    width: auto;
    min-width: 0;
    margin-right: auto;
    padding: 0.3rem 0.55rem;
    border-radius: 0.45rem;
  }
  .sp-grid-week .sp-day-head .sp-day-select[aria-pressed='true'] {
    flex: 0 0 auto;
    width: auto;
    min-width: 0;
    padding: 0.3rem 0.55rem;
    border-radius: 0.45rem;
  }
  .sp-grid-week .sp-event {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: auto;
    max-width: 100%;
  }
  .sp-grid-week .sp-event-time,
  .sp-grid-week .sp-status {
    display: inline-flex;
  }
  .sp-settings {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-settings-tabs {
    display: none;
  }
  .sp-settings-mobile-nav {
    display: grid;
    gap: 0.4rem;
  }
  .sp-settings-tabs {
    grid-column: auto;
  }
  .sp-settings .sp-form {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-settings .sp-form button {
    grid-column: auto;
    justify-self: stretch;
  }
  .sp-access-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-post-grid,
  .sp-post-grid :deep(.ag-root-wrapper) {
    min-height: 23rem;
  }
  .sp-record-list {
    max-height: 24rem;
  }
  .sp-composer {
    width: 100%;
    border-radius: 0;
  }
}

@container social-admin (max-width: 1000px) {
  .sp-post-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-post-grid,
  .sp-post-grid :deep(.ag-root-wrapper) {
    min-height: 16rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sp-admin *,
  .sp-admin *::before,
  .sp-admin *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

.sp-view {
  gap: 0.85rem;
}
.sp-view > * {
  min-width: 0;
}
.sp-top {
  flex-wrap: wrap;
}
.sp-top > * {
  min-width: 0;
}
.sp-top > .sp-heading {
  flex: 1 1 24rem;
}
.sp-heading h2 {
  font-size: 1.35rem;
  letter-spacing: -0.02em;
  line-height: 1.15;
}
.sp-heading p {
  max-width: 72ch;
  margin-top: 0.3rem;
  font-size: 0.82rem;
  line-height: 1.45;
}
.sp-admin button,
.sp-admin input,
.sp-admin select,
.sp-admin textarea {
  font-family: var(--f, system-ui);
  font-size: 0.84rem;
  line-height: 1.25;
}
.sp-workspace-account {
  min-width: 0;
  width: min(18rem, 100%);
  flex: 0 1 18rem;
  gap: 0.35rem;
  color: var(--ink3, #77736b);
  font-family: var(--m, monospace);
  font-size: 0.66rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.sp-workspace-account > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sp-workspace-account select,
.sp-workspace-account input {
  width: 100%;
  height: 2.25rem;
  min-height: 2.25rem;
  padding: 0 0.65rem;
  color: var(--ink, #25241f);
  font-family: var(--f, system-ui);
  font-size: 0.82rem;
  letter-spacing: normal;
  text-transform: none;
  box-sizing: border-box;
}
.sp-view > .sp-top + .sp-workspace-account {
  width: min(36rem, 100%);
  flex: 0 1 36rem;
}
.sp-record-workspace {
  align-items: start;
  gap: 0.75rem;
}
.sp-post-workspace {
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;
}
.sp-post-detail {
  min-height: 0;
}
.sp-post-grid,
.sp-post-grid :deep(.ag-root-wrapper) {
  min-height: 17rem;
}
.sp-record-workspace-empty {
  grid-template-columns: minmax(0, 1fr);
}
.sp-record-list {
  min-height: 8rem;
  max-height: min(58vh, 34rem);
}
.sp-record-workspace-empty .sp-record-list {
  min-height: 0;
  max-height: none;
}
.sp-record-workspace-empty .sp-empty {
  min-height: 4rem;
}
.sp-record-detail {
  min-height: 8rem;
  padding: 0.9rem;
}
.sp-drafts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 0.6rem;
}
.sp-draft {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  min-height: 3.5rem;
  gap: 0.75rem;
  padding: 0.65rem 0.8rem !important;
  font-family: var(--f, system-ui);
  font-size: 0.83rem;
  text-align: left;
}
.sp-draft small {
  color: var(--ink3, #77736b);
  font-size: 0.72rem;
  white-space: nowrap;
}
.sp-draft span {
  display: -webkit-box;
  max-height: 2.8em;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: 1.4;
}
.sp-settings {
  align-items: start;
}
.sp-settings > .sp-top,
.sp-settings > .sp-settings-tabs {
  grid-column: 1 / -1;
}
.sp-settings .sp-form {
  grid-template-columns: minmax(0, 1fr);
  gap: 0.7rem;
}
.sp-settings .sp-form label {
  gap: 0.35rem;
  color: var(--ink3, #77736b);
  font-family: var(--m, monospace);
  font-size: 0.66rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.sp-settings .sp-form input,
.sp-settings .sp-form select {
  height: 2.25rem;
  min-height: 2.25rem;
  padding: 0 0.65rem;
  font-family: var(--f, system-ui);
  font-size: 0.82rem;
  letter-spacing: normal;
  text-transform: none;
  box-sizing: border-box;
}
.sp-settings .sp-form button {
  grid-column: auto;
  justify-self: start;
  min-height: 2.25rem;
  padding: 0 0.8rem;
}
.sp-settings-tabs button {
  min-height: 2.4rem;
  padding: 0 0.8rem;
  font-family: var(--f, system-ui);
  font-size: 0.82rem;
}
.sp-panel {
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--ink, #25241f) 5%, transparent);
}
.sp-panel-head h3,
.sp-panel-head h4 {
  font-size: 0.95rem;
}
.sp-panel-head p,
.sp-settings > .sp-panel > .sp-muted {
  font-size: 0.78rem;
  line-height: 1.45;
}
.sp-empty {
  display: grid;
  min-height: 4.25rem;
  align-content: center;
  justify-items: center;
  gap: 0.3rem;
  margin: 0;
  padding: 1rem;
  border: 1px dashed var(--line, #ded9cf);
  border-radius: 0.7rem;
  background: color-mix(in srgb, var(--paper, #fffefa) 94%, var(--line, #ded9cf));
  color: var(--ink2, #77736b);
  font-family: var(--f, system-ui);
  font-size: 0.8rem;
  line-height: 1.45;
  text-align: center;
}
.sp-account-empty strong {
  color: var(--ink, #25241f);
  font-size: 0.88rem;
  font-weight: 650;
}
.sp-account-empty span {
  max-width: 56ch;
}
.sp-mode {
  height: auto;
  min-height: 2.25rem;
  align-items: center;
  gap: 0.15rem;
  padding: 0.18rem;
  border-radius: 0.55rem;
}
.sp-mode button {
  min-height: 1.8rem;
  padding: 0.35rem 0.65rem;
  border-radius: 0.4rem;
  font-family: var(--f, system-ui);
  font-size: 0.78rem;
  white-space: nowrap;
}
.sp-record-row {
  font-family: var(--f, system-ui);
  font-size: 0.8rem;
}
.sp-record-row span,
.sp-record-row small {
  font-size: 0.75rem;
}
.sp-approval-row {
  align-items: center;
  gap: 0.8rem;
  padding: 0.8rem 0;
  border-bottom: 1px solid var(--line, #ded9cf);
}
.sp-approval-row:last-of-type {
  border-bottom: 0;
}
.sp-analytics-filters {
  align-items: end;
  gap: 0.65rem;
}
.sp-metric-history {
  min-width: 0;
}
.sp-account-card {
  padding-inline: 0.65rem;
}

@container social-admin (max-width: 760px) {
  .sp-top {
    align-items: stretch;
  }
  .sp-workspace-account,
  .sp-view > .sp-top + .sp-workspace-account {
    width: 100%;
  }
  .sp-record-workspace-empty .sp-empty {
    min-height: 4.25rem;
  }
  .sp-record-detail {
    min-height: 0;
  }
  .sp-drafts {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-drafts > .sp-empty {
    grid-column: 1;
  }
  .sp-settings > .sp-top,
  .sp-settings > .sp-settings-tabs {
    grid-column: auto;
  }
  .sp-settings .sp-form button {
    justify-self: stretch;
  }
  .sp-post-grid,
  .sp-post-grid :deep(.ag-root-wrapper) {
    min-height: 18rem;
  }
}

.sp-view {
  align-content: start;
  grid-auto-rows: max-content;
  gap: 0.875rem;
}
.sp-main {
  align-content: start;
}
.sp-main > .sp-view {
  align-self: start;
  width: 100%;
}
.sp-top {
  align-items: flex-end;
  gap: 0.75rem;
}
.sp-top > .sp-heading {
  flex: 1 1 22rem;
}
.sp-heading h2 {
  font-family: var(--fd, inherit);
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.25;
}
.sp-heading p {
  max-width: 72ch;
  margin-top: 0.25rem;
  font-family: var(--f, inherit);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.sp-admin button,
.sp-admin input,
.sp-admin select,
.sp-admin textarea {
  font-family: var(--f, inherit);
  font-size: 0.8125rem;
  line-height: 1.3;
}
.sp-workspace-account {
  min-width: 0;
  width: min(18rem, 100%);
  flex: 0 1 18rem;
  gap: 0.3rem;
  color: var(--ink3, #77736b);
  font-family: var(--m, monospace);
  font-size: 0.65625rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.sp-workspace-account select,
.sp-workspace-account input {
  width: 100%;
  height: 2.125rem;
  min-height: 2.125rem;
  padding: 0 0.625rem;
  color: var(--ink, #25241f);
  font-family: var(--f, inherit);
  font-size: 0.8125rem;
  letter-spacing: normal;
  text-transform: none;
  box-sizing: border-box;
}
.sp-filterbar,
.sp-explore-tools {
  align-items: end;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border-radius: 0.75rem;
}
.sp-filterbar .sp-workspace-account {
  width: 14rem;
  flex: 0 1 14rem;
}
.sp-filterbar .sp-filter-post {
  width: min(32rem, 100%);
  flex: 1 1 20rem;
}
.sp-analytics-filters {
  display: flex;
  align-items: end;
  gap: 0.625rem;
}
.sp-analytics-filters .sp-workspace-account {
  width: 12rem;
  flex: 0 1 12rem;
}
.sp-explore-tools .sp-workspace-account {
  width: 14rem;
  flex: 0 1 14rem;
}
.sp-filterbar .sp-mode,
.sp-explore-tools .sp-mode {
  height: 2.125rem;
  min-height: 2.125rem;
}
.sp-filterbar .sp-mode button,
.sp-explore-tools .sp-mode button {
  min-height: 1.75rem;
  padding: 0.3rem 0.625rem;
  font-family: var(--f, inherit);
  font-size: 0.78125rem;
}
.sp-explore-tools .sp-mode {
  max-width: 100%;
  overflow-x: auto;
}
.sp-explore-tools .sp-mode button {
  flex: 0 0 auto;
}
.sp-panel {
  padding: 1rem;
  border-color: var(--hair, var(--line, #ded9cf));
  border-radius: 0.75rem;
  background: var(--paper, #fffefa);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--ink, #25241f) 5%, transparent);
}
.sp-panel-head {
  align-items: center;
  margin-bottom: 0.75rem;
}
.sp-panel-head h3,
.sp-panel-head h4 {
  font-family: var(--fd, inherit);
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.sp-panel-head p,
.sp-settings > .sp-panel > .sp-muted {
  font-size: 0.78125rem;
  line-height: 1.45;
}
.sp-record-workspace {
  align-items: start;
  gap: 0.875rem;
}
.sp-post-workspace {
  grid-template-columns: minmax(0, 1fr);
  gap: 0.875rem;
}
.sp-post-detail {
  min-height: 0;
}
.sp-post-grid,
.sp-post-grid :deep(.ag-root-wrapper) {
  min-height: 17rem;
}
.sp-record-workspace-empty {
  grid-template-columns: minmax(0, 1fr);
}
.sp-record-list {
  min-height: 8rem;
  max-height: min(58vh, 34rem);
}
.sp-record-workspace-empty .sp-record-list {
  min-height: 0;
  max-height: none;
}
.sp-record-workspace-empty .sp-empty {
  min-height: 4rem;
}
.sp-record-detail {
  min-height: 8rem;
  padding: 0.875rem;
  background: var(--card, var(--paper, #fffefa));
}
.sp-drafts {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  padding: 0;
  overflow: hidden;
}
.sp-draft {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  width: 100%;
  min-height: 3.25rem;
  gap: 0.75rem;
  padding: 0.65rem 1rem !important;
  border: 0 !important;
  border-bottom: 1px solid var(--hair, var(--line, #ded9cf)) !important;
  border-radius: 0 !important;
  background: transparent !important;
  font-family: var(--f, inherit);
  font-size: 0.8125rem;
  text-align: left;
  transition: background-color 120ms ease;
}
.sp-draft:last-of-type {
  border-bottom: 0 !important;
}
.sp-draft:hover {
  transform: none;
  box-shadow: none;
  background: color-mix(in srgb, var(--ink, #25241f) 4%, var(--paper, #fffefa)) !important;
}
.sp-draft small {
  color: var(--ink3, #77736b);
  font-family: var(--m, monospace);
  font-size: 0.65625rem;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.sp-draft span {
  display: -webkit-box;
  max-height: 2.8em;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: 1.4;
}
.sp-settings {
  align-items: start;
}
.sp-settings > .sp-top,
.sp-settings > .sp-settings-tabs {
  grid-column: 1 / -1;
}
.sp-settings .sp-form {
  grid-template-columns: minmax(0, 1fr);
  gap: 0.625rem;
}
.sp-settings .sp-form label {
  gap: 0.3rem;
  color: var(--ink3, #77736b);
  font-family: var(--m, monospace);
  font-size: 0.65625rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.sp-settings .sp-form input,
.sp-settings .sp-form select {
  height: 2.125rem;
  min-height: 2.125rem;
  padding: 0 0.625rem;
  font-family: var(--f, inherit);
  font-size: 0.8125rem;
  letter-spacing: normal;
  text-transform: none;
  box-sizing: border-box;
}
.sp-settings .sp-form button {
  grid-column: auto;
  justify-self: start;
  min-height: 2.125rem;
  padding: 0 0.75rem;
}
.sp-settings-tabs {
  max-width: 100%;
}
.sp-settings-tabs button {
  white-space: nowrap;
}
.sp-approval-row {
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--hair, var(--line, #ded9cf));
}
.sp-approval-row:last-of-type {
  border-bottom: 0;
}
.sp-account-card {
  padding-inline: 0.625rem;
}

@container social-admin (max-width: 760px) {
  .sp-top {
    align-items: stretch;
  }
  .sp-top > .sp-heading {
    flex: 0 1 auto;
  }
  .sp-workspace-account {
    width: 100%;
  }
  .sp-filterbar,
  .sp-explore-tools {
    align-items: stretch;
  }
  .sp-filterbar .sp-workspace-account,
  .sp-filterbar .sp-filter-post,
  .sp-analytics-filters,
  .sp-analytics-filters .sp-workspace-account,
  .sp-explore-tools .sp-workspace-account,
  .sp-explore-tools .sp-mode {
    width: 100%;
    flex: 1 1 100%;
  }
  .sp-analytics-filters {
    flex-wrap: wrap;
  }
  .sp-settings {
    grid-template-columns: minmax(0, 1fr);
  }
  .sp-settings > .sp-top,
  .sp-settings > .sp-settings-tabs {
    grid-column: auto;
  }
  .sp-settings-tabs {
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }
  .sp-settings .sp-form button {
    justify-self: stretch;
  }
  .sp-approval-row {
    align-items: flex-start;
  }
}
</style>
