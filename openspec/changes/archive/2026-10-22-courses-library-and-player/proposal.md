# Proposal

## Why

The reader's side of courses fell short of what a course platform has to offer. The reader's own courses were a tab of the app area: a list of titles with bars. On a site whose app area is a community place, that put them inside Diagnostics. The course page was a description with a plain outline, and a lesson was a page of text. A site also had to choose between courses on their own pages and courses in the community, although events are in both. Kajabi, Teachable and Thinkific each give a reader a library to come back to, a course overview that shows where they stand in every module, and a lesson player built for working through a course.

## What Changes

- `/courses` is the reader's library:
  - **Continue** for the course they were last in, naming its next lesson;
  - their courses in progress and finished, with covers, progress and certificates;
  - the rest of the catalogue, with what each course costs to get into.
  
  A guest sees the catalogue.
- **The course overview.**
  - A cover band.
  - A sticky card with progress, the next step and the course's facts.
  - The curriculum as modules that fold, each showing how much of it is done.
  - Each lesson marked with what kind it is: a video, audio, reading, a chapter, an article, a form or a session.
- **The lesson player.**
  - A bar of its own: the course, the progress, previous and next.
  - The curriculum beside the lesson. On a phone it opens from that bar.
  - **Complete and continue**, which finishes the lesson and moves on.
  - When a reader finishes the course, the player says so and offers the certificate.
- **Courses in both places.** When the community is on, Courses is a place in its navigation with the same library, overview and player. `/courses` stays as the courses' own pages. `courses.where` is removed, and a site that still sets it is told why.
- **Out of the app area.** The app area no longer has a courses tab. `/app/courses` forwards to `/courses`, ahead of any place that claims `/app`.
- A course with no image gets a cover drawn from its title and its theme.

## Non-goals

- Lesson comments, quizzes inside the player, and video progress tracking.
- Any change to who gets in, what is open, or how a course is declared.

## Review focus

- What the library and overview show is still the database's answer for the reader. No closed lesson's text, or the address of its media, reaches the browser.
- `/app/courses` forwards on a site whose Diagnostics place claims `/app`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `courses`:
  - "Readers and staff see where everyone is" gains the library, the overview and the player.
  - "Courses live on their own pages or as a place of the community" becomes "Courses live on their own pages and in the community".

## Impact

- `46-courses.sql`: `courses_list` and `course_state` return more of what the reader may already know.
- The courses components, the router, `site.mjs` (`coursesOf`, the kit's places), the app area's tabs and the demo config.
- The Courses docs page and FEATURES.md.
