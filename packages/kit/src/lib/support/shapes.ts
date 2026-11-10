/*
 * WHAT THE SUPPORT FUNCTIONS RETURN. Each returns jsonb, which the generated types can only call Json; these are the
 * shapes the SQL builds, read from supabase/schemas/70-support.sql and 72-tickets.sql (ticket_raised_with and
 * ticket_answer_values as glue/forms+support.sql defines them). `SupportReturns` maps each function to its shape.
 * A function that refuses says why in `error`; the success fields of a refusal are `undefined`.
 */
import type { Database, Json } from '../../../supabase/functions/_shared/database.types.ts'

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
type Ok<T = object> = ({ error?: undefined; ok: true } & T) | ({ error: string; ok?: undefined } & { [K in keyof T]?: undefined })

type Named = { id: string; name: string }

/* support_inbox: a conversation, with who it is with and the last thing said */
export type InboxItem = Pick<Row<'support_conversations'>, 'id' | 'status' | 'assignee_id' | 'source' | 'prompt_id' | 'path' | 'created_at' | 'last_message_at'
  | 'last_contact_at' | 'last_agent_at' | 'resolved_at' | 'contact_read_at' | 'agent_read_at' | 'contact_typing_at'> & {
  contact: {
    id: string; user_id: string | null; name: string | null; email: string | null; verified: boolean
    kind: 'guest' | 'customer' | 'user'; orders: number; notes: string | null; custom_attributes: Record<string, unknown>   /* a jsonb object */
    last_seen_at: string | null; last_path: string | null; created_at: string
  }
  last: Pick<Row<'support_messages'>, 'id' | 'author' | 'kind' | 'body' | 'seconds' | 'deleted_at' | 'created_at'> | null
  unread: number; waiting_since: string | null; assignee: string | null
}

type Ticket = Row<'support_tickets'>
/* what an event of the ticket's timeline carries, by kind (every insert in 72-tickets.sql and its glue): a status or
   priority change its from and to, an assignment who, a link the conversation, a due date when, a form the response */
export type TicketEventData = { from?: string; to?: string; who?: string; conversation?: string; at?: string; response?: string }
/* a form's answers, in the order asked (ticket_raised_with, long form) or as field → value (short form) */
export type Answers = { field: string; value: Json }[]
export type ShortAnswers = Record<string, Json>

/* support_ticket: one ticket as the desk opens it */
export type TicketOpened = {
  ticket: Pick<Ticket, 'id' | 'ref' | 'title' | 'body' | 'status' | 'priority' | 'category' | 'created_at' | 'last_at' | 'due_at'
    | 'waiting_since' | 'resolved_at' | 'closed_at' | 'opened_via'> & {
    contact: { id: string; name: string; email: string | null; user_id: string | null; notes: string | null } | null
  }
  answers: Answers | null
  assignees: Named[]
  timeline: (Pick<Row<'support_ticket_events'>, 'id' | 'kind' | 'body' | 'internal' | 'by_contact' | 'created_at'> & {
    data: TicketEventData; agent: string | null; agent_name: string | null; name: string | null; type: string | null; size: number | null; path: string | null
  })[]
  chats: { id: string; status: string; last_at: string | null }[]
}

/* support_tickets_list: one row of the desk's list */
export type TicketRow = Pick<Ticket, 'id' | 'ref' | 'title' | 'body' | 'status' | 'priority' | 'category' | 'created_at' | 'last_at' | 'due_at'
  | 'waiting_since' | 'resolved_at' | 'opened_via'> & {
  contact: { id: string; name: string; email: string | null; user_id: string | null } | null
  assignees: Named[]; answers: ShortAnswers | null; replies: number; chats: number
}

/* support_ticket_mine, support_tickets_mine: a ticket as the person who raised it sees it */
export type MyTicket = {
  ticket: Pick<Ticket, 'id' | 'ref' | 'title' | 'body' | 'status' | 'created_at' | 'last_at' | 'resolved_at'>
  timeline: (Pick<Row<'support_ticket_events'>, 'id' | 'kind' | 'body' | 'by_contact' | 'created_at'> & {
    data: TicketEventData; agent_name: string | null; name: string | null; type: string | null
  })[]
}
export type MyTicketRow = Pick<Ticket, 'id' | 'ref' | 'title' | 'status' | 'created_at' | 'last_at' | 'resolved_at'> & { replies: number }

export type SupportReturns = {
  support_agents: (Named & { roles: string[] })[]
  support_inbox: InboxItem[]                 /* null for anybody not on support */
  support_search: string[]                   /* conversation ids */
  support_ticket: TicketOpened               /* null for anybody not on support */
  support_ticket_assign: Ok
  support_ticket_link: Ok
  support_ticket_mine: MyTicket              /* null unless it is theirs */
  support_ticket_open: Ok<{ id: string; ref: number }>
  support_ticket_say: Ok
  support_ticket_set: Ok
  support_tickets_for: Pick<Ticket, 'id' | 'ref' | 'title' | 'status' | 'priority'>[]
  support_tickets_list: TicketRow[]
  support_tickets_mine: MyTicketRow[]
  ticket_answer_values: { field: string; value: string; tickets: number }[]
}
