# Proposal

## Why

Switching a module off keeps its tables and drops its functions. The diff drops a module's trigger functions without dropping the triggers, because it meant to drop the whole table. With the table kept, the first trigger function still in use stopped the plan ("other objects depend on it"). Turning off the print or store module failed this way on DharmaLab's database, and a production deploy would have failed too.

## What Changes

- The plan drops every trigger on a kept table whose function the diff drops, before the function itself. Switching the module back on declares both again.

## Capabilities

### Modified Capabilities

- `deploy`: a module switched off on a database that holds its tables.

## Impact

- `packages/kit/build/plan.mts` (`keepOffTables`).
