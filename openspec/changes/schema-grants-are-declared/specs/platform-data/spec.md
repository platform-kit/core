## ADDED Requirements

### Requirement: A table's grants are declared with it

What each database role may do with a table SHALL be written in the declaration of that table and SHALL NOT be inherited from the platform's default privileges, which a project may not grant. The service role SHALL have an explicit grant on every table the kit declares, and a table with a policy written for signed-out or signed-in readers SHALL grant that role explicitly, so a policy is never the only thing standing between a role and a refusal. A policy that asks who the reader is (their identity, their rooms, their role) admits nobody signed out and needs no grant to the signed-out role.

**Intent.** A grant the platform used to add silently is a dependency nobody wrote down. When the platform stops adding it, the first sign is a refused request in production; writing it down makes the same schema behave the same on every project.

#### Scenario: a table the service role cannot touch

- **WHEN** a table is added to the declaration with no grant to the service role
- **THEN** the declarations check fails, naming the table and the statement to add

Verified by: `packages/kit/build/declarations.test.mts`, with the `space_pins` service-role grant removed

#### Scenario: a policy for readers with no grant behind it

- **WHEN** a table has a policy for signed-out readers, or for signed-in readers, and no grant to that role
- **THEN** the declarations check fails, naming the table, the role and the statement to add

Verified by: `packages/kit/build/declarations.test.mts` over every schema file, including the glue between modules

#### Scenario: a project that grants nothing by default

- **WHEN** the declaration is applied to a project whose platform default grants nothing on a new table
- **THEN** the server-side functions, the deploy steps and the readers a policy names reach their tables as they do where the platform grants by default

Verified by: NOT VERIFIED here — it needs a hosted project created with the default grants off; the declarations check is what holds it meanwhile
