# Proposal

## Why

PlatformKit sells memberships, books and coaching, but not a course: lessons in order, released over time, tracked to completion. Kajabi, Teachable and Thinkific are built around that.

## What Changes

- A new `courses` module. A course is a record of its own, with sections and lessons in order.
- **Lessons:** a lesson is its own text and media (video, audio, downloads), or it points at something the site already has: a book chapter, an article, a form or quiz, or a session to book.
- **Getting in:** a course is sold in the store, included in a membership tier, or free to signed-in readers. Getting in creates an enrollment, a record of its own.
- **Release:** all at once, one lesson or section every N days after enrolling, or on fixed dates for a cohort. Optionally, a lesson stays locked until the one before it is complete.
- **Completion:** a lesson completes when the reader marks it done, passes its quiz, or finishes the chapter or form it points at. The course completes when every required lesson does.
- **Certificates:** an optional certificate on completion, with the reader's name, the course and the date, at a public address anyone can check, downloadable as a PDF.
- **Reader screens:** a course page (outline, progress, "Continue"), a lesson page with the outline beside it, and the reader's courses in their app area.
- **Staff screens:** a course builder in the admin (drag to reorder sections and lessons, release settings, cohorts) and an enrollments view (who is where, completion rates, where people stop).
- **Around it:**
  - Emails: "a new lesson is open" and "you finished".
  - An achievement on completion.
  - A community space whose membership is "enrolled in this course", or one cohort of it.
  - Comments on lessons.
  - Course progress on the member card's private half.

### The reader's words

Purpose: the course page and lesson page say where the reader is and what's next, in plain words.

> Continue · Start the course · {done} of {total} lessons · Opens {date} · Finish the lesson before to open this one · Mark complete · Course complete · Your certificate

## Non-goals

- Live classes. These are sessions and events, which a lesson can point to.
- Staff-graded assignments, SCORM imports, or a marketplace of other people's courses.

## Review focus

Enrollment as its own record, completion for lessons that point at existing content, and certificate verification.

## Capabilities

### New Capabilities

- `courses`: courses, lessons, enrollment, release, completion, certificates, and the reader and staff screens.

### Modified Capabilities

None. The Kajabi comparison row is updated when this change is archived.

## Impact

- Kit: a module manifest, a schema (courses, enrollments, lesson progress, certificates), functions for release emails and certificate PDFs.
- Theme: course, lesson, certificate and app-area pages; the admin course builder and enrollments view; strings.
- Docs: a "Courses" page and FEATURES.md.
- Demo: one sample course.
