# Design

## Context

The kit's database is a declaration, applied to a project by a diff. Its schema files already grant most tables explicitly: of the tables declared, the large majority carry `GRANT` statements beside them, and the functions' grants and revokes are deliberate and tested. Six tables carried none for the service role. Two of them, `inventory` and `promotion_usage`, carry a policy for everybody (shoppers see what is left), so they also depended on the platform granting the readers.

Most tables are reached by readers through `SECURITY DEFINER` functions, not directly: client code queries nine tables itself, and every one of those is granted. Tables with no grant to a reader are therefore closed to them by intent, and the platform's old default was what left them open.

## Goals / Non-Goals

**Goals:**
- The schema behaves the same on a project that grants by default and one that does not.
- A new table cannot be added without answering what the service role, and any reader a policy names, may do with it.

**Non-Goals:**
- Revoking the grants the old default put on existing tables. That would harden existing projects but changes what several tables permit and needs a per-table review.
- Making every table state a decision for `anon` and `authenticated`. Most are closed by intent, and a required `REVOKE` on each would be noise that hides the few grants that matter.

## Decisions

- **Check the service role always, readers only where a policy names them.** The service role is what every function and deploy step runs as, so a missing grant is always a bug. A reader's grant matters only where a policy is written for them; a table with no such policy is closed to them, which is a correct state, not a gap.
- **A policy that asks who the reader is needs no signed-out grant.** A policy with no `TO` clause applies to everybody, but one that tests `auth.uid()`, `is_*`, `can_*`, `has_*` or `my_*` admits nobody signed out. Counting those would force grants onto tables that are meant to stay closed to `anon`. The test reads this from the policy text, which is a heuristic: it errs toward flagging a policy it cannot classify as signed-in-only, and the fix is a one-line grant.
- **Put the grants in the file that declares the table.** The diff is computed from the declaration, so a grant kept elsewhere would be one more thing to forget.
- **Alternative: an explicit allow-list of closed tables.** Rejected: it duplicates what the absence of a policy already says and would drift.

## Risks / Trade-offs

- **The heuristic misreads a policy** → the test names the table, the role and the statement to add; a false positive costs one line and a false negative is the case the check exists to catch.
- **Old-default projects keep their broad grants** → unchanged by this work and named as a non-goal; the deploy's diff adds only what was missing.
- **Sequences and functions are not covered** → functions already have explicit grants and tests; the two sequences the schema declares (the email event and log counters) are not checked here and are a follow-up if the platform's change reaches them.

## Migration Plan

The deploy's schema diff adds the new `GRANT` statements. On a project that already granted these tables by default it changes nothing observable; on one that does not, it is what makes the six tables reachable. There is nothing to roll back separately: removing a grant is a later diff.
