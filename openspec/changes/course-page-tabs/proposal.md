# Proposal

## Why

A course page shows the whole curriculum first and the course's description, its "About this course", only after the last module. On a long course, someone deciding whether to start has to scroll past every lesson to find out what the course is.

## What Changes

- **Two tabs on a course page, Overview and Contents**, under the course's heading and opening paragraph. The reader's card (progress, next step or how to get in, and the course's facts) stays beside both.
- **No tabs when a course has no description beyond its opening paragraph.** The curriculum shows as it does now.
- **The tab that opens first:** Overview for someone not enrolled, Contents for someone enrolled. The open tab is kept in the address (`#overview`, `#contents`), so a link can open either.
- **Tab labels are strings** a site can reword.

## Capabilities

### Modified Capabilities

- `courses`: what a course page shows.

## Impact

- `packages/kit/modules/courses/ui/CourseOverview.vue` and `courses.css`; `packages/kit/modules/courses/strings/courses.md`; the courses page in the documentation site.
