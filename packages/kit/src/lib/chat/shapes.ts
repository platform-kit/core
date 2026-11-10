/*
 * WHAT THE CHAT FUNCTIONS RETURN. Each returns jsonb, which the generated types can only call Json; these are the
 * shapes the SQL builds, read from supabase/schemas/50-chat.sql. `ChatReturns` maps each function to its shape, and
 * api.ts's rpc() answers with it.
 */
import type { Database } from '../../../supabase/functions/_shared/database.types.ts'

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']

/* somebody one may write to; their address only to a provider */
export type ChatPerson = { id: string; name: string; roles: string[]; email: string | null }

/* chat_inbox: every conversation, newest first, with who it is with and the last thing said */
export type InboxRow = {
  id: string
  peer: ChatPerson & { title: string | null; tiers: string[]; session_chat: boolean }
  last: Pick<Row<'messages'>, 'id' | 'kind' | 'body' | 'sender_id' | 'created_at' | 'deleted_at'> | null
  unread: number; last_message_at: string | null; peer_read_at: string | null; created_at: string; awaiting_since: string | null
}

/* chat_members: the subscribers a provider may start a conversation with, one page of them, and how many in all */
export type Members = {
  items: { id: string; name: string; title: string | null; email: string | null; tier: string | null; conversation_id: string | null }[]
  total: number
}

export type ChatReturns = {
  chat_inbox: InboxRow[]
  chat_members: Members
  chat_people: ChatPerson[]
}
