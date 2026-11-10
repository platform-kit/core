/*
 * Chatwoot's shapes over the desk's rows (support-api): a message, a conversation, a contact, an agent, the inbox, and
 * the webhook payloads — plain JavaScript, no imports, pinned under Node (build/support-api.test.mjs). Ids are the
 * rows' uuids (Chatwoot's are integers; a client that parses an id as a number is the one thing that breaks). Times:
 * Chatwoot answers `created_at` as unix seconds on a message and a conversation, ISO on a contact and in a webhook.
 *
 * The desk's rows: a message { id, author: contact | agent | system, agent_id, kind: text | voice | file, body,
 * attachment_path, attachment_type, attachment_name, attachment_size, seconds, deleted_at, created_at, url? };
 * a conversation { id, status, source, prompt_id, path, created_at, last_message_at, last_contact_at, last_agent_at,
 * resolved_at, contact_read_at, agent_read_at, assignee_id, custom_attributes }; a contact { id, user_id, token?,
 * name, email, verified, kind, custom_attributes, last_seen_at, last_path, created_at }.
 */
export const INBOX_ID = 1
export const ACCOUNT_ID = 1
const unix = (iso: string|number|Date|null) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : null)
const TYPE_N: any = { contact: 0, agent: 1, system: 2 }
export const TYPE_WORD = { contact: 'incoming', agent: 'outgoing', system: 'activity' }
const attachmentOf = (m: { attachment_path: any; url: any; attachment_type: any; kind: string; id: any; attachment_name: any; attachment_size: any; seconds: any }) => {
  if (!m.attachment_path && !m.url) return []
  const type = String(m.attachment_type || '')
  const fileType = m.kind === 'voice' || type.startsWith('audio/') ? 'audio' : type.startsWith('image/') ? 'image' : 'file'
  return [{ id: m.id, message_id: m.id, account_id: ACCOUNT_ID, file_type: fileType, extension: String(m.attachment_name || '').split('.').pop() || null, data_url: m.url || null, thumb_url: fileType === 'image' ? (m.url || null) : null, file_size: m.attachment_size ?? null, ...(m.seconds ? { duration: m.seconds } : {}) }]
}
export const senderOf = (m: { author: string; agent_id: any; agent_name: any }, contact: any, agentName: any) => (m.author === 'agent' ? { id: m.agent_id || null, name: agentName || m.agent_name || null, type: 'user', email: null, avatar_url: null, thumbnail: null, availability_status: 'online' } : m.author === 'contact' ? contactSender(contact) : null)
export const contactSender = (c: { id: any; name: any; email: any; user_id: any; custom_attributes: any }|null) => (c ? { id: c.id, name: c.name || 'Guest', email: c.email || null, type: 'contact', avatar_url: null, thumbnail: null, phone_number: null, identifier: c.user_id || null, custom_attributes: c.custom_attributes || {} } : null)

/** a message as Chatwoot answers one (the Client API and the Application API share it) */
export function messageOf(m: any, { contact = null as { custom_attributes: any; id?: any; name?: any; email?: any; type?: string | undefined; avatar_url?: null | undefined; thumbnail?: null | undefined; phone_number?: null | undefined; identifier?: any; } | { id: any; name: any; email: any; type: string; avatar_url: null; thumbnail: null; phone_number: null; identifier: any; custom_attributes: any; } | null, agentName = null as string | null | undefined, conversationId = null as string | null, echoId = null as string | null } = {}) {
  const withdrawn = !!m.deleted_at
  return {
    id: m.id, content: withdrawn ? null : (m.body ?? null), inbox_id: INBOX_ID, conversation_id: conversationId || m.conversation_id || null, echo_id: echoId || undefined,
    message_type: TYPE_N[m.author] ?? 2, content_type: 'text', content_attributes: withdrawn ? { deleted: true } : {}, status: 'sent', private: false, source_id: null,
    created_at: unix(m.created_at), updated_at: unix(m.created_at), sender: senderOf(m, contact, agentName), attachments: withdrawn ? [] : attachmentOf(m),
    ...(m.kind === 'voice' ? { content_attributes: { kind: 'voice', seconds: m.seconds ?? null } } : {}),
    /*
     * WHAT A BOT OFFERED, in the shape this API already wears. Chatwoot says a message with buttons
     * with `content_type: 'input_select'` and its options under `content_attributes.items` — so a
     * client written against Chatwoot draws ours without being told anything, and one that has
     * never heard of choices still reads the words. `taken` is ours, and is additive: a client that
     * ignores it sees what every client sees.
     */
    ...(!withdrawn && (m.choices || []).length
      ? { content_type: 'input_select',
          content_attributes: { items: m.choices.map((c: { text: any; key: any }) => ({ title: c.text, value: c.key })), ...(m.choice_key ? { taken: m.choice_key } : {}) } }
      : {}),
  }
}
/** the Client API's conversation: the contact's own view */
/* a support contact as the desk's rows hold it */
type ContactRow = { id: any; name: any; email: any; user_id: any; custom_attributes: any }
export function clientConversationOf(c: any, { contact = null, messages = [] }: { contact?: ContactRow | null, messages?: any[] } = {}) {
  return { id: c.id, inbox_id: INBOX_ID, status: c.status, contact_last_seen_at: unix(c.contact_read_at), agent_last_seen_at: unix(c.agent_read_at), messages, contact: contactSender(contact), custom_attributes: c.custom_attributes || {}, additional_attributes: { path: c.path || null, source: c.source || null }, pubsub_token: c.listen_key || null, created_at: unix(c.created_at) }
}
/** the Client API's contact */
export function clientContactOf(c: { id: any; name: any; email: any; user_id: any; custom_attributes: any; verified: any }, sourceId: string, { pubsubToken = null } = {}) {
  return { id: c.id, source_id: sourceId, name: c.name || null, email: c.email || null, phone_number: null, identifier: c.user_id || null, pubsub_token: pubsubToken, custom_attributes: c.custom_attributes || {}, additional_attributes: { verified: !!c.verified }, avatar_url: null }
}
/** an agent as Chatwoot lists one */
export const agentOf = (p: any) => (p ? { id: p.id, name: p.name || p.display_name || null, email: p.email || null, role: (p.roles || []).includes('admin') ? 'administrator' : 'agent', availability_status: 'online', auto_offline: false, confirmed: true, available_name: p.name || p.display_name || null, thumbnail: null, account_id: ACCOUNT_ID } : null)
/** the Application API's conversation */
export function conversationOf(c: { id: any; status: any; last_message_at?: any; created_at?: any; last_agent_at?: any; agent_read_at?: any; contact_read_at?: any; path?: any; source?: any; prompt_id?: any; resolved_at?: any; custom_attributes?: any; [k: string]: any }, { contact = null, assignee = null, messages = [] as any[], unread = 0, waitingSince = null as string | null }: { contact?: ContactRow | null, assignee?: { id: string, name?: string | null, display_name?: string | null, email?: string | null, roles?: string[], [k: string]: any } | null, messages?: any[], unread?: number, waitingSince?: string | null } = {}) {
  const last = messages.length ? messages[messages.length - 1] : null
  return {
    id: c.id, inbox_id: INBOX_ID, account_id: ACCOUNT_ID, status: c.status, muted: false, can_reply: true, channel: 'Channel::WebWidget', priority: null, snoozed_until: null,
    timestamp: unix(c.last_message_at || c.created_at), created_at: unix(c.created_at), updated_at: unix(c.last_message_at || c.created_at), unread_count: unread,
    first_reply_created_at: unix(c.last_agent_at), waiting_since: unix(waitingSince), agent_last_seen_at: unix(c.agent_read_at), assignee_last_seen_at: unix(c.agent_read_at), contact_last_seen_at: unix(c.contact_read_at),
    additional_attributes: { path: c.path || null, source: c.source || null, prompt_id: c.prompt_id || null, resolved_at: c.resolved_at || null }, custom_attributes: c.custom_attributes || {}, labels: [],
    messages, last_non_activity_message: [...messages].reverse().find((m: any) => m.message_type !== 2) || last,
    meta: { sender: contactSender(contact), assignee: assignee ? agentOf(assignee) : null, team: null, hmac_verified: false, channel: 'Channel::WebWidget' },
  }
}
/** the Application API's contact */
export function contactOf(c: any, { sourceId = null, conversationsCount = null }: { sourceId?: string | null; conversationsCount?: number | null } = {}) {
  return {
    id: c.id, name: c.name || (c.user_id ? null : 'Guest'), email: c.email || null, phone_number: null, identifier: c.user_id || null, thumbnail: null, availability_status: 'offline', blocked: false,
    custom_attributes: c.custom_attributes || {}, additional_attributes: { kind: c.kind || (c.user_id ? 'user' : 'guest'), verified: !!c.verified, last_path: c.last_path || null, notes: c.notes || null, orders: c.orders ?? null },
    contact_inboxes: [{ source_id: sourceId, inbox: inboxOf() }], created_at: c.created_at || null, last_activity_at: c.last_seen_at || null, ...(conversationsCount != null ? { conversations_count: conversationsCount } : {}),
  }
}
export function inboxOf(site: any = {}) {
  return { id: INBOX_ID, name: site.name || 'Support', channel_type: 'Channel::WebWidget', channel_id: INBOX_ID, website_token: site.space || null, website_url: site.url || null, welcome_title: null, welcome_tagline: null, widget_color: null, greeting_enabled: false, enable_auto_assignment: false, working_hours_enabled: false, csat_survey_enabled: false, allow_messages_after_resolved: true, pre_chat_form_enabled: false, hmac_mandatory: false, continuity_via_email: false }
}
export const accountOf = (site: any = {}) => ({ id: ACCOUNT_ID, name: site.name || 'Support' })
/** a webhook row as the Application API answers it */
export const webhookOf = (w: any) => ({ id: w.id, url: w.url, subscriptions: w.subscriptions || [], account_id: ACCOUNT_ID, inbox_id: null, webhook_type: 'account', last_at: w.last_at || null, last_error: w.last_error || null })
export const EVENTS = ['conversation_created', 'conversation_status_changed', 'conversation_updated', 'message_created', 'message_updated', 'contact_created', 'contact_updated', 'webwidget_triggered']
/** the webhook payload: a message event carries the message with the conversation; a conversation event the conversation */
export function webhookPayload(event: string, { message = null, conversation = null, site = {} }: { message?: Record<string, any> | null, conversation?: Record<string, any> | null, site?: Record<string, any> } = {}) {
  const inbox = { id: INBOX_ID, name: (site as any).name || 'Support' }
  if (message) {
    const { sender, ...m } = message
    return { event, ...m, message_type: ['incoming', 'outgoing', 'activity'][(message as any).message_type] || 'activity', created_at: (message as any).created_at ? new Date((message as any).created_at * 1000).toISOString() : null, sender, inbox, conversation, account: accountOf(site) }
  }
  return { event, ...conversation, inbox, account: accountOf(site) }
}
/** Chatwoot's Client API contact_identifier → the contact token (the source_id is the token itself) */
export const errorOf = (message: string, code: string | null = null) => ({ error: message, ...(code ? { code } : {}), errors: [message] })
