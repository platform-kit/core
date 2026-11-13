# Proposal

## Why

Supabase no longer grants a new table in `public` to `anon`, `authenticated` and `service_role` for you: it is the default for new projects since 2026-05-30 and for every project from 2026-10-30. A table that relied on the old grant answers `42501 permission denied` on such a project: for the service role, every function and deploy step that touches it; for a reader, every policy written for them, because a policy only filters rows of a table the role may already touch. The kit's schema declares most grants itself, but six tables declared none for the service role, and two that shoppers are meant to read (`inventory`, `promotion_usage`) declared none for readers either. Nothing would have caught a seventh.

## What Changes

- The schema states each role's access to a table in the same file that declares the table: the service role always, and a signed-in or signed-out reader wherever a policy is written for them.
- The six tables that lacked it now have it: `inventory`, `inventory_movements`, `promotion_usage`, `promotion_uses`, `space_pins`, `space_scheduled`.
- `declarations.test.mts` fails a table with no explicit service-role grant, and a table with a policy for `anon` or `authenticated` and no grant to that role.
- `AGENTS.md` carries the rule, so a table added by hand or by an agent declares its grants with it.

Non-goals: revoking grants the old default left on existing projects (a larger, per-table review), and changing which tables readers may reach.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `platform-data`: a table's grants are part of its declaration and are never inherited from the platform.

## Impact

- `packages/kit/supabase/schemas/41-inventory.sql`, `42-promotions.sql`, `90-spaces.sql`.
- `packages/kit/build/declarations.test.mts`.
- `AGENTS.md`, and the documentation page that describes the database declaration.
- On an existing project the deploy's schema diff adds the new grants; behaviour is unchanged where the old default already granted them.