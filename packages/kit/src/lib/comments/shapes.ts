/*
 * WHAT THE COMMENT FUNCTIONS RETURN. Each returns jsonb, which the generated types can only call Json; these are the
 * shapes the SQL builds, read from supabase/schemas/97-comments.sql (and comment_room_say in glue/core+spaces.sql).
 * A function that refuses says why in `error`; a shape that can also be a refusal carries `error?: undefined`, so a
 * caller asks `r.error` before anything else, as every caller does.
 */
import type { Database } from '../../../supabase/functions/_shared/database.types.ts'

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']

export type Refused = { error: string; id?: undefined }

/* comments_on: one line of the thread, oldest first; a withdrawn one keeps its place with a null body */
export type CommentLine = {
  id: string; body: string | null; created_at: string; parent: string | null
  author_id: string | null; deleted_at: string | null; state: string
  flagged: string | null   /* the word that held it, for a moderator alone */
  mine: boolean; name: string
  re: Record<string, number>; mine_re: string[]
  up: number; down: number; my_vote: number
}

/* comment_counts: subject → how many live comments */
export type CommentCounts = Record<string, number>

/* comment_queue: one comment as a moderator decides it */
export type QueuedComment = {
  id: string; kind: string; subject: string; title: string; href: string | null; attached: boolean
  body: string | null; state: string; flagged: string | null; created_at: string
  author_id: string; author: string; trusted: boolean
}

/* comment_subject: what the conversation is, or null where it takes no comments */
export type CommentSubject = Pick<Row<'comment_subjects'>, 'kind' | 'subject' | 'title' | 'href' | 'allow' | 'approval' | 'depth' | 'collapse' | 'votes' | 'reactions'> & {
  may_write: boolean; may_moderate: boolean; thread: string | null
}

/* comment_say: the comment written (less the word that held it), or the line its room wrote, or why not */
export type Said = Refused
  | (Omit<Row<'comments'>, 'flagged'> & { error?: undefined; in_channel?: undefined })
  | { error?: undefined; id: string; body: string; created_at: string; author_id: string; mine: true; in_channel: true; state: 'live' }

/* comment_approve, comment_refuse: what the comment came to */
export type Decided = Refused | { error?: undefined; ok: true; state: 'live' | 'removed' }
