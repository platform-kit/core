/*
 * THE SITE'S COMMENT POLICY, one file: content/comments.md. Every record that takes comments
 * inherits what is here and may override any of it in its own drawer, so turning comments on for a
 * whole library is this page and nothing else — nobody edits two hundred articles to change one
 * word. The same file declares the OPEN KINDS: the kinds of thing an embed on somebody else's site
 * may comment on, which is the one thing the site cannot have a record for.
 *
 * A save reprojects (comments-push.mjs), so the rows hold the resolved answer rather than the
 * question and one change here reaches every subject at once.
 */
import { z } from 'zod'
import { writeKeeping } from '../yaml-keep.mjs'
import matter from 'gray-matter'
import { DUMP } from '../util.mjs'
import { POLICY, wordsOf } from '../../comments-push.mjs'

const ALLOW = [
  { value: 'off', label: 'Nobody — comments are off' },
  { value: 'everyone', label: 'Anybody signed in' },
  { value: 'members', label: 'Members' },
  { value: 'hosts', label: 'Hosts and staff' },
]

const fields = z.object({
  allow: z.enum(['off', 'everyone', 'members', 'hosts']).meta({
    label: 'Who may comment', kind: 'select', choices: ALLOW,
    help: 'what a record that says nothing of its own takes; any record may differ',
  }),
  approval: z.enum(['none', 'all', 'trusted']).meta({
    label: 'Comments appear', kind: 'select', choices: [
      { value: 'none', label: 'At once' },
      { value: 'trusted', label: 'At once from people we know — the rest wait' },
      { value: 'all', label: 'Everything waits for a moderator' },
    ],
    help: 'we know staff, members, anybody who has bought something, and anybody whose comment a moderator has released before — never by what they wrote',
  }),
  reactions: z.boolean().meta({ label: 'Reactions', half: true, help: 'an emoji on a comment' }),
  votes: z.boolean().meta({
    label: 'Voting', half: true,
    help: 'up and down, one per person. Off by default: a score changes what people write as well as what they read',
  }),
  depth: z.number().int().min(1).max(10).meta({ label: 'Indent replies to', half: true, help: 'deeper replies continue in one flat run, each saying who it answers' }),
  collapse: z.number().int().min(1).max(200).meta({ label: 'Show replies before folding', half: true, help: 'the rest go behind a control saying how many' }),
  /* THE WORDS THAT HOLD A COMMENT. A machine may flag; only a person decides — a match never
     removes, refuses, edits or scores anything. Whole words, so "Scunthorpe" is not held by a word
     inside it, and the author is never told which one caught them. */
  flagged: z.array(z.string()).meta({
    label: 'Words that hold a comment for review', kind: 'list', of: 'text',
    help: 'a match holds the comment and shows a moderator which word it was — it never removes, refuses or edits anything. Whole words only, so "Scunthorpe" is safe.',
  }).optional(),
  /* WHERE THE EMBED MAY BE DRAWN. Not a secret — somebody determined can always comment by
     visiting the site itself — so what this prevents is the site's comments appearing under pages
     it did not agree to. The real fence is the frame-ancestors header the host serves. */
  domains: z.array(z.string()).meta({
    label: 'Sites the embed may appear on', kind: 'list', of: 'text',
    help: 'a domain and its subdomains — example.com covers www.example.com. Name none and the embed works anywhere.',
  }).optional(),
  /* THE OPEN KINDS: an embed on a blog with two hundred posts cannot have two hundred rows
     projected for it, so the site declares the KIND open and the subject is made the first time
     somebody comments. It is still a declaration — nobody can invent a kind. */
  kinds: z.array(z.object({
    kind: z.string(), allow: z.string().optional(), space: z.string().optional(), channel: z.string().optional(),
  })).meta({
    label: 'Kinds an embed may comment on', widget: 'rows', kind: 'list', of: 'group',
    fields: [
      { key: 'kind', label: 'Kind', kind: 'text', help: 'what the embed calls it — disqus_kind on the page' },
      { key: 'allow', label: 'Who may comment', kind: 'select', choices: ALLOW },
      { key: 'space', label: 'Space', kind: 'reference', options: 'comment-spaces' },
      { key: 'channel', label: 'Room', kind: 'reference', options: 'comment-channels' },
    ],
    help: 'pages on other sites carrying our embed; a kind not named here is refused, so a site that declares none can be embedded nowhere',
  }).optional(),
})

export default {
  key: 'comment-policy', name: 'Comment policy', dir: 'content', single: 'comments', title: 'allow',
  creates: true, fields,
  grammar: {
    parse: (text) => ({ data: matter(text).data, content: matter(text).content }),
    /* a file that documents itself keeps its documentation: this is the one that started it */
    serialise: (rec, ctx) => writeKeeping(ctx && ctx.current, rec.data, rec.content == null ? '\n' : rec.content,
      () => matter.stringify(rec.content == null ? '\n' : rec.content, rec.data, DUMP)),
  },
  /* a field the file leaves out is the shipped default, so the form shows what the site actually
     does rather than a blank that means something */
  prepare: (rec) => { rec.data = { ...POLICY, ...(rec.data || {}), flagged: wordsOf((rec.data || {}).flagged), domains: wordsOf((rec.data || {}).domains) }; return rec },
  after: (rec, ctx) => ctx.script('comments-push.mjs').catch((e) => console.warn('comments: not projected — ' + e.message)),
}
