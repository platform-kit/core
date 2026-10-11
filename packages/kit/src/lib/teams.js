/*
 * A TEAM, FROM THE CLIENT. The team itself is a file — a projection of content/teams/*.md — and who
 * is in it is rows, so everything here is about the rows and nothing here writes the file.
 *
 * Three reads, each already fenced by the database: `team_people` answers a team's own members and
 * an administrator and nobody else (names, never addresses), `my_teams` answers the reader their
 * own, and inviting or removing is an administrator's act. A person is never removed from a team by
 * themselves: the rule that swept them in would put them back on the next sweep, and the honest way
 * to keep somebody out of a filled team is to change the rule.
 */
import { supabase } from './supabase.js'

/*
 * IS THE TEAM IN THE DATABASE AT ALL? The file is the declaration and the row is a projection of it,
 * and the two are not written at the same moment: in cloud mode a save is a draft, a publish is a
 * commit, and the projection is the deploy's — so between them a team exists as a file and as
 * nothing else. A surface that cannot tell that from "nobody is in it" says something false, and
 * offers a control (Add somebody) that the foreign key will refuse when it is pressed.
 * An administrator reads every team, published or not, which is what makes this answerable.
 */
export async function teamProjected(team) {
  const { data, error } = await supabase.from('teams').select('slug').eq('slug', String(team || '')).maybeSingle()
  if (error) return null   /* not answerable — the caller says nothing rather than guessing */
  return !!data
}

export async function teamPeople(team) {
  const { data, error } = await supabase.rpc('team_people', { p_team: String(team || '') })
  if (error) throw error
  return Array.isArray(data) ? data : []
}
export async function myTeams() {
  const { data, error } = await supabase.rpc('my_teams')
  if (error) throw error
  return Array.isArray(data) ? data : []
}
export async function inviteToTeam(team, user) {
  const { error } = await supabase.rpc('team_invite', { p_team: String(team || ''), p_user: user })
  if (error) throw error
}
export async function removeFromTeam(team, user) {
  const { error } = await supabase.rpc('team_remove', { p_team: String(team || ''), p_user: user })
  if (error) throw error
}
/* WHO COULD BE ASKED — every account, the admin's own read, narrowed by what was typed. It is the
   People section's read and not a list of its own: one answer to "who is here" is enough. */
export async function peopleToAsk(q, limit = 8) {
  const { data, error } = await supabase.rpc('admin_everybody', { p_q: q ? String(q) : null, p_narrow: 'all', p_limit: limit, p_offset: 0 })
  if (error) throw error
  return (data && Array.isArray(data.people)) ? data.people : []
}
