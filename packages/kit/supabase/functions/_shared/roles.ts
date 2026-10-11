/*
 * WHAT SOMEBODY MAY DO, for the Edge Functions — the same five capabilities the database asks, in
 * the same words, so a function and a policy can never drift apart about what a role reaches.
 *
 * A person holds a SET of roles (`profiles.roles`): a coach who also writes articles holds both and
 * is not thereby an administrator. A reader holds none. Nothing here compares a role's name outside
 * this file, which is the point of it: when a role comes to mean something else, it is changed here
 * and in 10-foundation.sql and nowhere else.
 */
import { admin } from './lib.ts'

/* 'coach' is what 'provider' used to be called — still read, never written, and dropped once the
   backfill in data.sql has run everywhere */
export type Role = 'admin' | 'provider' | 'coach' | 'editor' | 'support' | 'analyst'

/* `role` is what this replaced: read as a fallback so a function keeps working against a database
   the backfill has not reached yet. It is dropped by a change of its own. */
export async function rolesOf(userId: string | null | undefined): Promise<Role[]> {
  if (!userId) return []
  const { data } = await admin.from('profiles').select('roles, role').eq('id', userId).maybeSingle()
  const set = Array.isArray(data?.roles) ? (data!.roles as Role[]) : []
  if (set.length) return set
  const one = data?.role
  return one && one !== 'user' ? [one as Role] : []
}

export const isAdmin = (roles: Role[]) => roles.includes('admin')
/* anybody who runs any part of the site, whatever part that is */
export const isStaff = (roles: Role[]) => roles.length > 0
export const isProvider = (roles: Role[]) => roles.includes('provider') || roles.includes('coach') || roles.includes('admin')
/* the support desk: its own role, and an administrator */
export const isSupport = (roles: Role[]) => roles.includes('support') || roles.includes('admin')
export const mayEditContent = (roles: Role[]) => roles.includes('editor') || roles.includes('admin')
export const maySeeFigures = (roles: Role[]) => roles.includes('analyst') || roles.includes('admin')
