/*
 * WHAT THE ADMIN FUNCTIONS RETURN. Each returns jsonb, which the generated types can only call Json; these are the
 * shapes the SQL builds, read from the schema file each names. `AdminReturns` maps each function to its shape.
 * A function an admin alone may call answers null to anybody else.
 */

/* a person as the admin's lists name them */
export type NamedPerson = { id: string; name: string; email: string | null; roles: string[] }

export type AdminReturns = {
  admin_people: NamedPerson[]                                          /* 10-foundation.sql */
  admin_hosts: { id: string; email: string; name: string | null }[]    /* 55-sessions.sql: every provider with an email */
}
