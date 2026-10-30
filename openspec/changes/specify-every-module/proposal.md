# Proposal

## Why

Seventeen of PlatformKit's twenty-nine modules have no specification. They came into this repository already built, in the Oct 11 snapshot that began its history, and the OpenSpec workflow only adds a spec when a change touches a module. These modules had not changed since, so nothing ever asked for one. Without a spec, a module's behaviour is defined only by its code and its docs page, and a change to it has no requirement to keep or modify.

## What Changes

- A specification for each module that has none, describing its current behaviour as built: what a reader, a member or staff can do, what the module refuses, and the test that verifies each requirement.
- The four content collections (articles, books, wiki, docs) share one `library` spec, because they share one reader, one access model and one listing.
- Staff browser notifications are specified as `staff-push`, so the name does not suggest web push for readers.
- `translation` gets no spec: the module is reserved and nothing is built. Its spec comes with the change that builds it.

## Non-goals

- Changing any behaviour. Each requirement states what the code does today; where the code and the docs disagree, the code's behaviour is specified and the disagreement is listed in the tasks.
- Specifying what the module switch removes from the backend: that is `module-switch-removes-backend`.
