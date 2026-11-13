# Tasks

## 1. Declare the missing grants

- [x] 1.1 `41-inventory.sql`: grant `inventory` and `inventory_movements` to the service role, `inventory` to readers and `inventory_movements` to signed-in staff
- [x] 1.2 `42-promotions.sql`: the same for `promotion_usage` and `promotion_uses`
- [x] 1.3 `90-spaces.sql`: grant `space_pins` and `space_scheduled` to the service role

## 2. Hold it mechanically

- [x] 2.1 `declarations.test.mts`: every table grants the service role explicitly
- [x] 2.2 `declarations.test.mts`: a table with a policy for signed-out or signed-in readers grants that role, leaving out policies that ask who the reader is
- [x] 2.3 Prove the check fails when a grant is removed, and passes on the schemas as they are

## 3. Say it where the next table is written

- [x] 3.1 `AGENTS.md`: a table or function declares its grants and row-level security in the same schema file, never relying on platform default privileges
- [x] 3.2 Update the documentation page that describes the database declaration, and run the docs check

## 4. Verify

- [x] 4.1 Run `declarations.test.mts` and `openspec validate schema-grants-are-declared`