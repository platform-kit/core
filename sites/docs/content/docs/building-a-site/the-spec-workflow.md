---
title: The spec workflow
description: How PlatformKit requirements are proposed, implemented, verified and recorded with OpenSpec.
order: 53
sources: [openspec/config.yaml, packages/kit/build/proposal-trace.test.mjs]
reviewed: 2026-10-10
---

## Specifications describe behavior

The current behavior of each PlatformKit capability is described by a requirement in `openspec/specs/<capability>/spec.md`. Requirements use observable WHEN/THEN scenarios, and every scenario names how it is verified. A specification is the contract for behavior; repository instructions explain how to work on it.

A change to a requirement goes through OpenSpec so its reason, behavior, implementation plan and verification stay together. A copy adjustment or a visual correction that does not change a requirement can be handled as a task and verified directly.

## The change loop

1. Run `/opsx:propose <name>` to create a proposal, specification deltas, design and task list. The proposal explains the user-visible reason and quotes any proposed reader-facing copy in full.
2. Review and correct the proposal before implementation.
3. Run `/opsx:apply` to implement the approved tasks. Pause and revise the artifacts if the implementation reveals a design choice or additional scope.
4. Run `/opsx:verify` to execute the named verifiers and applicable cross-cutting requirements. Report each scenario as passed, failed or not verified, with evidence.
5. Run `/opsx:archive` after verification to merge the approved deltas into the current capability specifications.

Each task names how its work will be verified. Tests prove only the behavior they exercise; a scenario without a pinned test is reported as not verified rather than assumed complete.

## Validation and traceability

Run `openspec validate --all --strict` to validate the current specifications and change artifacts. The OpenSpec CLI is a development dependency. Project context and artifact rules are maintained in `openspec/config.yaml`; generated slash commands and skills are refreshed with `openspec update`, not edited by hand.

A proposal trace check requires each promised feature to name the requirement that delivers it, and ensures every requirement in the change is accounted for. This catches scope that appears in a proposal but never reaches implementation or verification.
