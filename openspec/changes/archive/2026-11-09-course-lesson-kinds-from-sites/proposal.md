# Proposal

## Why

A course's lessons can only be the kit's five kinds: text, chapter, article, form and session. A site that has something of its own to put in a course has nowhere to put it, short of forking the courses module. A site's own instrument, exercise or tool should be able to sit in a course as a lesson, be completed like any other, and, where it measures something, say how far a reader has come in that section.

## What Changes

- **A site registers a lesson kind in its config** (`courses.kinds`): the kind's name, the component that plays it, and optionally a check of its `ref` at build time and a progress measure for its section.
- **A course file may name a registered kind.** The build refuses a lesson whose kind is neither the kit's nor registered, naming the kind and saying it is not registered.
- **The player plays it.** A lesson of a registered kind renders the site's component where a text lesson's words would be. The component completes the lesson the way a reader marks a text lesson complete, and the server records it the same way.
- **A section can show the kind's measure.** Where a section holds a lesson whose kind registers a progress measure, the section's bar and percentage in the sidebar and outline show that measure, for that reader, instead of lessons done out of lessons total. The course's own completion, certificate and overall percentage still count lessons.
- **Removing the registration** leaves the kit's five kinds working as before; a course that still names the kind is refused by the build, never half-played.

## Non-goals

- Any site's own kind in the kit. The kit carries the extension point only.
- Server-side verification of a site kind's completion. A site kind completes as a text lesson does.

## Capabilities

### Modified Capabilities

- `courses`: lessons of a site-registered kind, and a section measure from that kind.
- `kit-extension-model`: `courses.kinds` among the registrations a config carries.

## Impact

- `packages/kit/build/courses-io.mts` (the kinds a file may name), the push, `46-courses.sql` (the kind check), `CoursePlayer.vue`, `CourseOverview.vue`, `course-ui.js`, the config reader and the virtual module that hands a site's registrations to the theme.
- New code in TypeScript.
- The courses and extension-model pages of the documentation site; the demo registers a self-rating kind to prove it.
