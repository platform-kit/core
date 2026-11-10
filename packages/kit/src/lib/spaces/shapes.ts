/*
 * WHAT THE SPACES FUNCTIONS RETURN. Each returns jsonb, which the generated types can only call Json; these are the
 * shapes the SQL builds, read from supabase/schemas/90-spaces.sql (space_reports as 92-encryption.sql redefines it).
 * `SpaceReturns` maps each function's name to its shape, and api.ts's rpc() answers with it.
 * A function that refuses says why in `error`; a shape that can also be a refusal carries `error?: undefined`.
 */
import type { Database, Json } from '../../../supabase/functions/_shared/database.types.ts'
import type { NamedPerson } from '../admin/shapes.js'

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
type Refused = { error: string }
type Ok<T = object> = ({ error?: undefined; ok: true } & T) | (Refused & { ok?: undefined } & { [K in keyof T]?: undefined })

/* a message as its row holds it, less the search vector (`to_jsonb(x) - 'fts'`) */
export type Message = Omit<Row<'space_messages'>, 'fts'>

type Flair = Pick<Row<'space_flair'>, 'slug' | 'name' | 'colour' | 'icon' | 'note' | 'inline'>
type Face = { avatar: string | null; avatar_style: string | null; avatar_seed: string; avatar_options: Json | null }

/* a message that names somebody, or that waits unread, as the lists across every space show it */
export type Mention = Pick<Message, 'id' | 'channel_id' | 'thread_root_id' | 'author_id' | 'body' | 'title' | 'seq' | 'created_at'> & {
  channel: string; channel_kind: string; mention: string; space: string; space_slug: string; author: string; unread: boolean
}
export type Unseen = Omit<Mention, 'mention'> & { peers: string[] | null; unread: true }

export type Person = Face & {
  id: string; name: string; about: string | null; roles: string[]
  wearing: { name: string; colour: string | null }[]; flair: Flair[]
}
export type MemberCard = Face & {
  id: string; name: string; about: string | null; since: string
  roles: { slug: string; name: string; colour: string | null }[]; said: number; flair: Flair[]
  may_flair: boolean; more: boolean
}

export type Post = Message & { pinned: boolean; last_reply_by: string | null; voices: string[] }
export type Thread = { root: Message; replies: Message[] }
export type Catchup = { channel: string; from: number; more: boolean; messages: Message[] }[]

export type Unread = {
  channel: string; space: string; kind: string; seq: number; read: number; unread: number; mentions: number
  notify: string; muted_until: string | null; last_message_at: string | null
  hushed: boolean; voice: boolean; file: boolean; mention: boolean
}
export type Dm = {
  channel: string; space: string; space_name: string | null; members: string[]; people: { id: string; name: string }[]
  unread: number; mentions: number; muted_until: string | null; last_message_at: string | null
  last: { author: string | null; kind: string; body: string; at: string } | null
}
export type Discovered = {
  id: string; slug: string; name: string; kind: string; fill: Json; joining: Json
  asked: string | null; mine: boolean; people: number
}
export type Everywhere = {
  id: string; channel: string; room: string; room_slug: string; space: string; space_name: string; space_slug: string
  kind: string; title: string | null; body: string | null; created_at: string; replies: number; author: string | null
  bot: string | null; meta: Json; name: string
}
export type Lately = { id: string; channel: string; room: string; kind: string; author: string | null; title: string | null; created_at: string; body: string | null }
export type Later = Pick<Message, 'author_id' | 'body' | 'title' | 'seq' | 'thread_root_id'> & {
  id: string; channel_id: string; channel: string; channel_kind: string; done_at: string | null; created_at: string
}
export type MyThread = { id: string; channel_id: string; channel: string; channel_kind: string; root: Message; last_at: string; reply_count: number; people: string[]; tail: Message[] }
export type Found = Pick<Message, 'id' | 'channel_id' | 'seq' | 'thread_root_id' | 'author_id' | 'kind' | 'title' | 'body' | 'created_at'> & { space_id: string }
export type Pinned = {
  message_id: string; note: string | null; created_at: string; pinned_by: string | null; by: string | null
  author_id: string | null; kind: string; body: string | null; title: string | null; meta: Json; said_at: string
  deleted_at: string | null; thread_root_id: string | null
}
export type Ask = { id: string; user_id: string; note: string | null; created_at: string; agreed_at: string | null; response_id: string | null; name: string; email: string | null }
export type SpaceFlair = Flair & { id: string; people: number }
export type Invite = { id: string; uses: number; used: number; expires_at: string | null; note: string | null; role: string | null; created_at: string; state: 'expired' | 'spent' | 'good' }
export type InviteLook = { state: 'unknown' } | { state: 'expired' | 'spent' | 'good'; space: string; name: string; kind: string; mine: boolean }
export type InviteAccepted = { state: 'unknown' | 'expired' | 'spent' | 'barred'; space?: undefined; name?: undefined } | { state: 'good' | 'joined'; space: string; name: string }
export type Mute = { kind: string; ref: string; until: string | null }
export type MyRecord = Pick<Row<'space_moderation'>, 'id' | 'kind' | 'reason' | 'until' | 'created_at'> & { space: string | null }
export type Recorded = Pick<Row<'space_moderation'>, 'id' | 'kind' | 'reason' | 'until' | 'created_at'> & { by: string; about: string }
export type Report = {
  id: string; space: string | null; channel: string | null; message: string | null; reason: string | null; note: string | null
  created_at: string; answered_at: string | null; by: string; about: string; about_id: string | null
  body: string | null; sealed: boolean; withdrawn: boolean; kind: string | null; room: string | null
}
export type Scheduled = { id: string; channel_id: string; channel: string; channel_kind: string; space: string; body: string; thread_root_id: string | null; send_at: string; failed: string | null }

export type SpaceReturns = {
  space_activity: Mention[]
  space_answer: Ok
  space_ask: Ok<{ state: string }>
  space_asks: Ask[]
  space_catchup: Catchup
  space_discover: Discovered[]
  space_dms: Dm[]
  space_everywhere: Everywhere[]
  space_first_replies: Record<string, Message[]>
  space_find_people: NamedPerson[]   /* an admin's search; [] to anybody else */
  space_people_named: NamedPerson[]  /* staff alone; [] to anybody else */
  space_flairs: SpaceFlair[]
  space_give_flair: Ok
  space_history: Message[]          /* null where the room may not be read */
  space_invite_accept: InviteAccepted
  space_invite_look: InviteLook
  space_invites_of: Invite[]
  space_lately: Lately[]
  space_later: Later[]
  space_member_card: MemberCard     /* null where either is not a member */
  space_my_mutes: Mute[]
  space_my_record: MyRecord[]
  space_people: Person[]
  space_pin: Ok<{ pinned: boolean }>
  space_pinned: Pinned[]
  space_posts: Post[]               /* null where the room may not be read */
  space_record: Recorded[]
  space_reports: Report[]
  space_schedule: Ok<{ id: string; send_at: string }>
  space_scheduled_mine: Scheduled[]
  space_search: Found[]
  space_thread: Thread              /* null where the root is gone or unreadable */
  space_threads: MyThread[]
  space_unread: Unread[]
  space_unseen: Unseen[]
}
