## ADDED Requirements

### Requirement: A kept table's triggers go before their functions

When a module is switched off on a database holding its tables, the plan SHALL drop every trigger on a kept table whose function the plan drops, before dropping the function, and SHALL keep the table and its rows.

#### Scenario: print switched off

- **WHEN** the print and store modules are switched off on a database whose `fulfilments`, `returns` and `order_transactions` carry their triggers
- **THEN** the plan applies, the triggers and functions are gone, and the tables and their rows remain

Verified by: DharmaLab's development database (two `fulfilments` rows kept)
