import { commentRowsOf, dmRowsOf, list, messages, send, socialRef } from '../src/lib/desk/social.js'

let pass = 0
let fail = 0
const ok = (name, condition, detail) => {
  if (condition) pass++
  else {
    fail++
    console.log('  FAIL  ' + name + (detail ? ' — ' + detail : ''))
  }
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\nSOCIAL DESK\n')

const account = {
  id: 'account-a',
  provider_id: 'x',
  external_id: 'our-account',
  name: 'Example Publisher',
  username: 'examplepublisher',
  avatar_url: 'https://avatar.test/examplepublisher.png',
  status: 'connected',
  permissions: { view_results: true, publish_now: true },
}
const dmEvents = [
  {
    id: 'dm-in',
    dm_conversation_id: 'conversation-in',
    sender_id: 'reader-1',
    text: 'Could you explain this?',
    created_at: '2026-10-05T10:00:00.000Z',
    event_type: 'MessageCreate',
  },
  {
    id: 'dm-answered',
    dm_conversation_id: 'conversation-answered',
    sender_id: 'our-account',
    text: 'Thanks for asking.',
    created_at: '2026-10-05T11:00:00.000Z',
    event_type: 'MessageCreate',
  },
]
const commentEvents = [
  {
    id: 'comment-root',
    author_id: 'reader-2',
    author: { name: 'Jordan Lee' },
    text: 'Can you say more?',
    created_at: '2026-10-05T12:00:00.000Z',
    referenced_tweets: [{ type: 'replied_to', id: 'post-1' }],
  },
  {
    id: 'comment-answer',
    author_id: 'our-account',
    author_name: 'Example Publisher',
    text: 'Of course.',
    created_at: '2026-10-05T12:30:00.000Z',
    referenced_tweets: [{ type: 'replied_to', id: 'comment-root' }],
  },
  {
    id: 'comment-waiting',
    author_id: 'reader-3',
    sender_name: 'Morgan Chen',
    text: 'One more question.',
    created_at: '2026-10-05T13:00:00.000Z',
    referenced_tweets: [{ type: 'replied_to', id: 'comment-root' }],
  },
  {
    id: 'comment-thread-done',
    author_id: 'our-account',
    text: 'That is all.',
    created_at: '2026-10-05T14:00:00.000Z',
    referenced_tweets: [{ type: 'replied_to', id: 'post-1' }],
  },
]
const post = { account_id: account.id, provider_post_id: 'post-1', title: 'A published post', body: 'The complete published post.' }
const dmRows = dmRowsOf(dmEvents, account)
ok('external latest DM is waiting, account-authored latest DM is not',
  equal(dmRows.map((row) => row.social.conversationId), ['conversation-in']))
const orderedDmRows = dmRowsOf([
  { ...dmEvents[0], created_at: '2026-10-05T09:00:00.000Z' },
  { ...dmEvents[0], id: 'dm-latest-us', sender_id: account.external_id, text: 'Already answered.', created_at: '2026-10-05T10:30:00.000Z' },
], account)
ok('DM activity is reduced to the latest event per conversation',
  orderedDmRows.length === 0)
let ambiguousDmRejected = false
try {
  dmRowsOf([
    dmEvents[0],
    { ...dmEvents[0], id: 'dm-same-time', sender_id: account.external_id },
  ], account)
} catch (error) {
  ambiguousDmRejected = error.code === 'social_response_unsupported'
}
ok('DM events tied across authors are not guessed into a waiting state', ambiguousDmRejected)
let incompleteDmRejected = false
try {
  dmRowsOf([{ id: 'dm-missing-author', dm_conversation_id: 'conversation-unknown', text: 'Hello' }], account)
} catch (error) {
  incompleteDmRejected = error.code === 'social_response_unsupported'
}
ok('DM events without provable author and time are rejected', incompleteDmRejected)
const dmRef = socialRef(account.id, 'dm', 'conversation-in')
const laterExternalDm = { ...dmEvents[0], id: 'dm-in-later', text: 'Following up.', created_at: '2026-10-05T11:00:00.000Z' }
const reopenedDm = dmRowsOf([dmEvents[0], laterExternalDm], account, {
  [`social:${dmRef}`]: '2026-10-05T10:30:00.000Z',
})
ok('a later external message reopens a staff member’s private completion mark',
  reopenedDm.length === 1 && reopenedDm[0].resolved === false && reopenedDm[0].waiting_since === laterExternalDm.created_at)
const stillFinishedDm = dmRowsOf(dmEvents.slice(0, 1), account, {
  [`social:${dmRef}`]: '2026-10-05T10:30:00.000Z',
})
ok('a completion mark at or after the latest activity keeps the row finished',
  stillFinishedDm.length === 1 && stillFinishedDm[0].resolved === true && stillFinishedDm[0].waiting_since === null)
ok('DM rows identify platform, connected account, author and provider activity',
  dmRows[0].platform === 'x' && dmRows[0].accountName === 'Example Publisher'
    && dmRows[0].person.id === 'reader-1' && dmRows[0].waiting_since === dmEvents[0].created_at)
const payloadProfile = dmRowsOf([{
  ...dmEvents[0],
  username: 'reader.handle',
  profile_image_url: 'https://avatar.test/reader.png',
}], account)[0].person
ok('provider payload usernames and HTTPS avatars are preserved',
  payloadProfile.username === 'reader.handle' && payloadProfile.avatarUrl === 'https://avatar.test/reader.png')
const insecureProfile = dmRowsOf([{
  ...dmEvents[0],
  username: 'reader.handle',
  profile_image_url: 'http://avatar.test/reader.png',
}], account)[0].person
ok('provider avatar URLs must use HTTPS',
  insecureProfile.username === 'reader.handle' && insecureProfile.avatarUrl === null)
ok('provider conversation identities include account and kind',
  socialRef('account-a', 'dm', 'same-id') !== socialRef('account-b', 'dm', 'same-id')
    && socialRef('account-a', 'dm', 'same-id') !== socialRef('account-a', 'comment', 'same-id'))

const commentRows = commentRowsOf(commentEvents.slice(0, 3), account, post)
ok('a comment thread is waiting when its latest activity is external',
  commentRows.length === 1 && commentRows[0].social.threadId === 'comment-root'
    && commentRows[0].social.latestCommentId === 'comment-waiting')
ok('comment rows retain the published post and account context',
  commentRows[0].social.postId === 'post-1' && commentRows[0].social.postTitle === 'A published post'
    && commentRows[0].social.postBody === post.body)
let missingPostContextRejected = false
try {
  commentRowsOf(commentEvents.slice(0, 3), account, { provider_post_id: 'post-1' })
} catch (error) {
  missingPostContextRejected = error.code === 'social_response_unsupported'
}
ok('comments without source-post context are not exposed as replyable', missingPostContextRejected)
ok('account-authored latest comment activity is not listed as waiting',
  commentRowsOf(commentEvents.slice(0, 2), account, post).length === 0)
let incompleteRejected = false
try {
  commentRowsOf([{ id: 'unknown', text: 'No author or time' }], account, post)
} catch (error) {
  incompleteRejected = error.code === 'social_response_unsupported'
}
ok('comment responses without provable author and time are rejected', incompleteRejected)

const ops = ['messages.read', 'messages.write', 'comments.read', 'comments.write', 'profiles.read']
const providerProfiles = {
  'reader-1': { displayName: 'Alex Rivera', handle: 'alexrivera', avatarUrl: 'https://avatar.test/alex.png' },
  'reader-2': { displayName: 'Jordan Lee', handle: 'jordanlee', avatarUrl: 'https://avatar.test/jordan.png' },
  'reader-3': { displayName: 'Morgan Chen', handle: 'morganchen', avatarUrl: 'https://avatar.test/morgan.png' },
}
const profileReads = []
const client = {
  functions: {
    async invoke(_name, { body }) {
      if (body.action === 'desk_accounts') return { data: { accounts: [account] }, error: null }
      if (body.action === 'desk_posts') return { data: { posts: [post] }, error: null }
      if (body.action === 'desk_capabilities') return { data: { operations: ops.map((operation) => ({ operation })) }, error: null }
      if (body.action === 'desk_operation') {
        if (body.operation === 'messages.read' && !body.input.conversationId) {
          return { data: { result: { items: dmEvents } }, error: null }
        }
        if (body.operation === 'messages.read') {
          return { data: { result: { items: [dmEvents[0]] } }, error: null }
        }
        if (body.operation === 'comments.read') {
          return { data: { result: { items: commentEvents.slice(0, 3) } }, error: null }
        }
        if (body.operation === 'profiles.read') {
          profileReads.push(body.input.profileId)
          return { data: { result: providerProfiles[body.input.profileId] }, error: null }
        }
        if (body.operation === 'messages.write') {
          return { data: { result: { id: 'sent-message' } }, error: null }
        }
        if (body.operation === 'comments.write') {
          return { data: { result: { commentId: 'sent-comment' } }, error: null }
        }
      }
      return { data: null, error: new Error('unexpected call: ' + body.action) }
    },
  },
}
const listed = await list(client)
ok('supported account routes produce comment and DM rows through the Social operations',
  listed.rows.length === 2 && listed.failures.length === 0
    && listed.rows.some((row) => row.conversationKind === 'dm')
    && listed.rows.some((row) => row.conversationKind === 'comment'))
ok('queue authors are enriched with provider names, handles and secure avatars',
  listed.rows.find((row) => row.conversationKind === 'dm').person.name === 'Alex Rivera'
    && listed.rows.find((row) => row.conversationKind === 'dm').person.username === 'alexrivera'
    && listed.rows.find((row) => row.conversationKind === 'dm').person.avatarUrl === 'https://avatar.test/alex.png'
    && listed.rows.find((row) => row.conversationKind === 'comment').person.username === 'morganchen')
ok('profile enrichment reads each distinct missing author through profiles.read',
  ['reader-1', 'reader-3'].every((id) => profileReads.includes(id)))
const detail = await messages(client, listed.rows.find((row) => row.conversationKind === 'comment'))
ok('comment details are read from the provider operation without mirroring',
  detail.map((item) => item.id).join(',') === 'comment-root,comment-answer,comment-waiting')
ok('comment details identify the connected account author as ours',
  detail.find((item) => item.id === 'comment-answer')?.mine === true)
ok('comment history preserves the names of every participant in the multi-user thread',
  detail.map((item) => item.author).join(',') === 'Jordan Lee,Example Publisher,Morgan Chen'
    && listed.rows.find((row) => row.conversationKind === 'comment').person.name === 'Morgan Chen')
ok('comment history enriches each author and the connected account without changing message order',
  detail[0].authorUsername === 'jordanlee'
    && detail[0].authorAvatarUrl === 'https://avatar.test/jordan.png'
    && detail[1].authorUsername === 'examplepublisher'
    && detail[1].authorAvatarUrl === 'https://avatar.test/examplepublisher.png'
    && detail[2].authorUsername === 'morganchen'
    && detail[2].authorAvatarUrl === 'https://avatar.test/morgan.png')
const dmDetail = await messages(client, listed.rows.find((row) => row.conversationKind === 'dm'))
ok('DM details are fetched for the namespaced provider conversation',
  dmDetail.length === 1 && dmDetail[0].id === 'dm-in' && dmDetail[0].mine === false)
ok('DM history includes the sender name, provider username and avatar',
  dmDetail[0].author === 'Alex Rivera' && dmDetail[0].authorUsername === 'alexrivera'
    && dmDetail[0].authorAvatarUrl === 'https://avatar.test/alex.png')
const commentSent = await send(client, listed.rows.find((row) => row.conversationKind === 'comment'), 'Thanks for writing.')
const dmSent = await send(client, listed.rows.find((row) => row.conversationKind === 'dm'), 'Thanks for writing.')
ok('comment and DM replies require a provider-confirmed identifier',
  commentSent === 'sent-comment' && dmSent === 'sent-message')

let deniedCalls = 0
const noAccess = {
  functions: {
    async invoke(_name, { body }) {
      if (body.action === 'desk_accounts') return { data: { accounts: [{ ...account, permissions: { view_results: false } }] }, error: null }
      deniedCalls++
      return { data: null, error: new Error('must not invoke provider operations') }
    },
  },
}
const denied = await list(noAccess)
ok('read-denied accounts reveal no rows and invoke no further Social operation',
  denied.availableAccounts === 0 && denied.rows.length === 0 && deniedCalls === 0)

let readOnlyCalls = 0
const readOnlyAccess = {
  functions: {
    async invoke(_name, { body }) {
      if (body.action === 'desk_accounts') {
        return { data: { accounts: [{ ...account, permissions: { view_results: true, publish_now: false } }] }, error: null }
      }
      readOnlyCalls++
      return { data: null, error: new Error('must not invoke provider operations') }
    },
  },
}
const readOnly = await list(readOnlyAccess)
ok('read-only Social staff cannot discover Desk conversations or invoke provider operations',
  readOnly.availableAccounts === 0 && readOnly.rows.length === 0 && readOnlyCalls === 0)

const unsupported = {
  functions: {
    async invoke(_name, { body }) {
      if (body.action === 'desk_accounts') return { data: { accounts: [account] }, error: null }
      if (body.action === 'desk_posts') return { data: { posts: [] }, error: null }
      if (body.action === 'desk_capabilities') return { data: { operations: [] }, error: null }
      throw new Error('undeclared operation invoked')
    },
  },
}
const missingRoute = await list(unsupported)
ok('undeclared discovery is not invoked and the route is reported unsupported',
  missingRoute.rows.length === 0 && missingRoute.failures.some((item) => item.reason === 'unsupported'))

const truncated = {
  functions: {
    async invoke(_name, { body }) {
      if (body.action === 'desk_accounts') return { data: { accounts: [account] }, error: null }
      if (body.action === 'desk_posts') return { data: { posts: [post], truncated: true }, error: null }
      if (body.action === 'desk_capabilities') return { data: { operations: ops.map((operation) => ({ operation })) }, error: null }
      if (body.action === 'desk_operation') {
        return { data: { result: { items: body.operation === 'messages.read' ? dmEvents : commentEvents.slice(0, 3) } }, error: null }
      }
      throw new Error('unexpected call')
    },
  },
}
const partial = await list(truncated)
ok('a capped post scan is surfaced as partial coverage',
  partial.failures.some((item) => item.reason === 'listing-truncated'))

const broken = {
  functions: {
    async invoke(_name, { body }) {
      if (body.action === 'desk_accounts') return { data: { accounts: [account] }, error: null }
      if (body.action === 'desk_posts') return { data: { posts: [] }, error: null }
      if (body.action === 'desk_capabilities') return { data: { operations: [{ operation: 'messages.read' }] }, error: null }
      if (body.action === 'desk_operation') return { data: null, error: new Error('provider unavailable') }
      throw new Error('unexpected call')
    },
  },
}
const failedRead = await list(broken)
ok('provider failures are explicit and do not become an empty successful source',
  failedRead.availableAccounts === 1 && failedRead.rows.length === 0
    && failedRead.failures.some((item) => item.reason === 'provider-failed'))

const profileFailureAccount = { ...account, id: 'account-profile-failure' }
const profileFailureRow = {
  ...listed.rows.find((row) => row.conversationKind === 'dm'),
  social: {
    ...listed.rows.find((row) => row.conversationKind === 'dm').social,
    accountId: profileFailureAccount.id,
    profileRead: true,
  },
}
const profileFailure = {
  functions: {
    async invoke(_name, { body }) {
      if (body.action === 'desk_operation' && body.operation === 'messages.read') {
        return { data: { result: { items: [{ ...dmEvents[0], sender_name: 'Alex from message' }] } }, error: null }
      }
      if (body.action === 'desk_operation' && body.operation === 'profiles.read') {
        return { data: null, error: new Error('profile lookup failed') }
      }
      throw new Error('unexpected call')
    },
  },
}
const profileFailureMessages = await messages(profileFailure, profileFailureRow)
ok('a failed profile lookup preserves the conversation and labels incomplete profile details',
  profileFailureMessages.length === 1 && profileFailureMessages[0].author === 'Alex from message'
    && profileFailureMessages[0].authorProfileUnavailable === true)

const profileUnsupportedRow = {
  ...profileFailureRow,
  social: { ...profileFailureRow.social, accountId: 'account-profile-unsupported', profileRead: false },
}
let unsupportedProfileCalls = 0
const profileUnsupported = {
  functions: {
    async invoke(_name, { body }) {
      if (body.action === 'desk_operation' && body.operation === 'messages.read') {
        return { data: { result: { items: [dmEvents[0]] } }, error: null }
      }
      unsupportedProfileCalls++
      throw new Error('profiles.read must not be invoked')
    },
  },
}
const profileUnsupportedMessages = await messages(profileUnsupported, profileUnsupportedRow)
ok('unsupported profile reads are not invoked and missing details remain explicit',
  unsupportedProfileCalls === 0 && profileUnsupportedMessages[0].authorProfileUnavailable === true)

console.log(`SOCIAL DESK: ${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
