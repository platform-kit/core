# Proposal

## Why

With one published course, the library at `/courses` and `<community>/courses` is a heading and a single small card in a grid built for many. It reads as an unfinished catalogue rather than a course. Course platforms open the course itself when there is only one: a member with one product lands in it, a one-course school opens on that course, and a course space opens on its curriculum.

## What Changes

- **A library of one course shows that course's overview in place.** Where `courses_list` answers exactly one course for the reader, the library address shows the course's overview (description, curriculum, and the reader's progress and next step or what getting in takes) instead of the library.
- **The address stays.** Nothing forwards. The community's frame and side navigation stay, the browser's back button behaves as on any page, and the page's canonical link names the course's own address.
- **No way back to a library that isn't there.** The overview's "back to all courses" link is hidden in this case. Lesson links still go to the course's own address, and the player's way back to the course is unchanged.
- **Two courses or more** show the library as before. No courses still shows the empty state.

## Non-goals

- A site setting to turn this off.
- Any change to the overview, the player or `courses_list`.

## Capabilities

### Modified Capabilities

- `courses`: the library with one course.

## Impact

- `packages/kit/theme/src/components/courses/CourseLibrary.vue`, `CoursesView.vue`, `CourseOverview.vue`.
- The courses page of the documentation site.
