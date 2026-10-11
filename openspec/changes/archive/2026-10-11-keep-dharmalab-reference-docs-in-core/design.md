# Design

## Context

See [proposal.md](./proposal.md) for motivation. Core already has an ownership boundary test that rejects downstream-site identity and specifically asserts that product-oriented `PURPOSE.md` and `FEATURES.md` do not exist. The requested source copies describe DharmaLab, so they are not suitable for Core without being rewritten from Core's own contracts and evidence.

## Goals / Non-Goals

**Goals:**

- Give Core readers a plain-language account of the toolkit's purpose and what a site can use it to do.
- Make each feature claim auditable against a current capability spec and at least one implementation, test, or fixture signal; describe module switches and site configuration where they limit availability.
- Keep Core's downstream-site boundary enforced, including for the new documents.
- Establish evidence about whether the repository split omitted required Core material or left source-install, CLI, or deploy paths broken.

**Non-Goals:**

- Move DharmaLab product copy into Core, or rename DharmaLab-specific assessments and features as PlatformKit capabilities.
- Treat a spec, a passing unit test, or a file's presence as proof that a feature works in production.
- Run a production deploy, alter the site repository, or force-push as part of verification.

## Decisions

### Write Core-owned documents rather than copy site-owned ones

Use the existing DharmaLab documents only as evidence that the expected pair of files was missing, not as draft text. Derive the Core purpose from `kit-principles`; derive the feature inventory from current capability specs, module declarations/manifests, generic fixtures, and their named tests. Organize by what a site owner or reader can do, not by source tree or service names. Avoid promises that depend on DharmaLab data, enabled modules, production credentials, or behavior that the specs mark unverified.

**Alternative:** Copy the documents unchanged and allow-list their names. Rejected because that would weaken the ownership boundary and misdescribe a DharmaLab product as Core.

### Preserve the boundary check

The named Core documents will be included in the normal maintained-file scan. Remove only the test assertion that the filenames must be absent; replace it with assertions that both files exist and that the boundary sentinel is not present. Do not exempt either document from scanning or add a generic allow-list for downstream references.

**Alternative:** Exclude these files from scanning. Rejected because it would create an unmonitored path for exactly the content the test is intended to prevent.

### Audit through independent evidence layers

Use a claim matrix while drafting and verifying: Core capability/spec, code or module declaration, targeted test/fixture, availability caveat, and document section. Separately verify repository ownership and published refs, Core build/test/docs guards, the public GitHub-source CLI from a clean site fixture, and the existing deploy preflight path without invoking production-facing steps. Report each check as passed, failed, or not verified. A finite audit can expose known omissions and regressions but cannot establish that no mistake exists.

**Alternative:** Run only the documentation and boundary checks. Rejected because those do not verify package installation, site separation, or executable workflows.

## Risks / Trade-offs

- **A broad inventory can overstate support** → Label optional, configured, fixture-only, and unverified behavior; require the claim matrix and tests to support each statement.
- **The site checkout may contain changes unrelated to Core** → Audit read-only and do not copy, commit, or push site changes.
- **A passing local check may not represent the remote tip** → Record the exact commit and refs checked, and separately identify checks run on the currently published commit versus the local candidate.
- **The full suite may have costly or destructive integration lanes** → Inspect the runner and execute only safe, relevant selectors; do not run database reset, email sends, paid generation, or production deploy without explicit approval.

## Migration Plan

1. Draft and review the Core purpose and feature inventory against the claim matrix.
2. Run the boundary, docs, OpenSpec, and targeted CLI/deploy checks, then the broader safe Core suite only if its runner is demonstrably non-destructive.
3. Review the split's source/target ownership and record unverified paths.
4. If a verified issue is found, fix it surgically and rerun its narrow check.
5. Publish only after the proposal is approved and all requested checks pass; no production deploy is part of this change.

## Open Questions

None. The current source copies remain site-owned; Core documents will be rewritten for PlatformKit.
