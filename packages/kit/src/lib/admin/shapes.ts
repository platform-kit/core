/*
 * WHAT THE ADMIN FUNCTIONS RETURN. Each returns jsonb, which the generated types can only call Json; these are the
 * shapes the SQL builds, read from the schema file each names. `AdminReturns` maps each function to its shape.
 * A function an admin alone may call answers null to anybody else.
 */
import type { Database } from '../../../supabase/functions/_shared/database.types.ts'

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
type Line = Database['public']['Functions']['order_lines']['Returns'][number]

/* a person as the admin's lists name them */
export type NamedPerson = { id: string; name: string; email: string | null; roles: string[] }

/* admin_everybody (10-foundation.sql): one page of everybody, and how many there are in all */
export type Everybody = {
  total: number
  people: { id: string; email: string | null; name: string; username: string | null; roles: string[]; verified: boolean; member: boolean; customer: boolean; since: string }[]
}

/* person_purchases (40-commerce.sql): what somebody has bought, newest first */
export type PersonPurchase = Pick<Row<'purchases'>, 'id' | 'sku' | 'key' | 'variant' | 'currency' | 'status'> & { amount: number | null; at: string }
/* person_bookings (glue/core+sessions.sql; [] without sessions) */
export type PersonBooking = Pick<Row<'bookings'>, 'uid' | 'title' | 'start_at' | 'status'> & { type: string | null }

/* admin_person (10-foundation.sql): one person, as their admin page opens them */
export type AdminPerson = {
  id: string; email: string | null; username: string | null; name: string; first_name: string | null; last_name: string | null
  roles: string[]; verified_at: string | null; since: string
  billing_id: string | null   /* the processor's own id, for the link out to invoices */
  entitlements: Pick<Row<'entitlements'>, 'kind' | 'key' | 'tier' | 'source' | 'expires_at'>[]
  purchases: PersonPurchase[]
  subscription: (Pick<Row<'subscriptions'>, 'sku' | 'key' | 'status' | 'next_sku' | 'next_at'> & { period_end: string | null }) | null
  bookings: PersonBooking[]
}

/* set_roles (10-foundation.sql): the roles now held, or why not */
export type RolesSet = { ok: true; roles: string[]; why?: undefined } | { ok: false; why: string; roles?: undefined }

/* admin_orders (43-orders.sql): every order with its lines and what happened to it, and the purchases no order holds */
export type AdminOrder = Pick<Row<'orders'>, 'id' | 'number' | 'version' | 'status' | 'email' | 'user_id' | 'currency' | 'created_at'
  | 'shipping_total' | 'shipping_address' | 'checkout_session'> & {
  total: number; payment: string; fulfilment: string
  lines: Pick<Line, 'line' | 'sku' | 'variant' | 'title' | 'variant_title' | 'unit_price' | 'quantity' | 'removed'>[]
  transactions: Pick<Row<'order_transactions'>, 'amount' | 'reason' | 'reference' | 'created_at'>[]
  fulfilments: Pick<Row<'fulfilments'>, 'id' | 'supplier' | 'status' | 'tracking' | 'quantity' | 'proof' | 'error' | 'book' | 'format'>[]
  returns: Pick<Row<'returns'>, 'id' | 'number' | 'status' | 'reason' | 'exchange_order_id' | 'requested_at'>[]
}
export type LoosePurchase = Pick<Row<'purchases'>, 'id' | 'sku' | 'variant' | 'title' | 'amount_total' | 'currency' | 'status' | 'email' | 'user_id' | 'created_at' | 'quantity'> & {
  session: string | null
  variant_title?: undefined   /* not sent: admin_orders builds a loose purchase without it */
}
export type AdminOrders = { orders: AdminOrder[]; loose: LoosePurchase[] }

export type AdminReturns = {
  admin_people: NamedPerson[]                                          /* 10-foundation.sql */
  admin_hosts: { id: string; email: string; name: string | null }[]    /* 55-sessions.sql: every provider with an email */
  admin_everybody: Everybody
  admin_person: AdminPerson
  set_roles: RolesSet
  admin_orders: AdminOrders
  person_purchases: PersonPurchase[]
  person_bookings: PersonBooking[]
}
