---
title: Courses
description: Lessons in order, released over time and tracked to completion, with certificates — a library, a course overview and a lesson player, on pages of their own and in the community.
order: 16.5
sources:
  [
    packages/kit/supabase/schemas/46-courses.sql,
    packages/kit/build/courses-io.mjs,
    packages/kit/build/courses-push.mjs,
    packages/kit/build/steps/courses.mjs,
    packages/kit/build/models/core/courses.mjs,
    packages/kit/supabase/functions/course-notify,
    packages/kit/src/lib/certificate-pdf.js,
    packages/kit/theme/src/pages/CoursesPage.vue,
    packages/kit/theme/src/components/courses/CoursesView.vue,
    packages/kit/theme/src/components/courses/CoursesPlace.vue,
    packages/kit/theme/src/components/courses/CourseLibrary.vue,
    packages/kit/theme/src/components/courses/CourseOverview.vue,
    packages/kit/theme/src/components/courses/CoursePlayer.vue,
    packages/kit/theme/src/components/courses/CourseCover.vue,
    packages/kit/theme/src/components/courses/course-ui.js,
    packages/kit/src/lib/courses-paths.js,
    packages/kit/theme/src/components/admin/CourseEnrollments.vue,
    packages/kit/theme/src/components/spaces/panels/MemberCourses.vue,
    packages/kit/theme/src/content/ui/courses.md,
    packages/kit/build/courses.test.mjs,
    packages/kit/build/courses-db.test.mjs,
  ]
reviewed: 2026-10-22
---

A course is sections and lessons in order, which a reader works through and finishes. The `courses` module adds them: the course builder in the admin, the reader's pages, enrollments, release over time, completion, certificates and the emails that go with them.

## What a lesson can be

Each lesson is one of five kinds:

- **Its own text**, with a video or audio track and files to download.
- **A book chapter**, which opens the book at that chapter.
- **An article**.
- **A form or quiz**. It runs inside the lesson. The lesson is finished the moment the reader completes it, and passes it where it is scored; nobody marks it by hand. The reader then sees their score: passed, with the way on to the next lesson, or the pass mark and **Try again**. A quiz already passed shows their best score and can be taken again without undoing the lesson. The curriculum shows each reader their best score, and the enrollments screen shows administrators every person's best score and how many attempts it took.
- **A session to book**. It counts as finished once the reader has booked one.

A lesson is required to finish the course unless it is marked optional.

## Who gets in

A course can be free to anyone signed in, sold in the store, included in a membership tier, or any mix of the three. Somebody who buys the product or joins the tier is enrolled on the way in, so the course is waiting for them. On a free course, they press **Start the course**.

An enrollment is a record of its own. If somebody loses access, through a refund or a lapsed membership, their lessons close but their progress is kept. If they get access back, they carry on where they stopped.

## Release

- **All at once:** every lesson is open from the start.
- **Over time:** one lesson, or one section, opens every so many days from when the reader started.
- **By cohort:** the same, counted from a cohort's start date. A reader joins the next cohort to start.

A course can also be **taken in order**, so each lesson opens only once the required lesson before it is finished.

The database decides what is open for each reader, so a closed lesson's text is never sent to their browser. The page says why a lesson is closed and when it opens.

## Finishing

A course is complete when every required lesson is. Finishing records a `course_completed` event. An achievement whose rule watches that event awards itself, for example:

```md
---
title: Finished a course
when:
  event: course_completed
---
```

Where the course gives one, finishing also issues a certificate. It has a public address that anyone given it can open to check it, and it downloads as a PDF.

## Emails

Readers get an email when a lesson opens, and one when they finish. A lesson email is sent once per lesson, and at most one a day goes to any one person; a course released all at once sends none. The designs are **course-lesson** and **course-complete** under admin → Emails.

## What readers see

- **The library**, at `/courses`. The course a reader was last in comes first, with its next lesson and a Continue button. Their other courses in progress follow, then the ones they finished with their certificates, then every other course with what getting in takes: free, a membership or a purchase. A guest sees the catalogue. A course with no picture gets a cover drawn from its title.
- **A course's overview.** The reader's card shows their progress, the next lesson and the course's facts. Beside it is the curriculum: each section is a module that folds, says how much of it is done and when it opens, and marks each lesson as a video, audio, reading, chapter, article, form or session.
- **The lesson player.** A bar of its own holds the way back to the course, the progress, the curriculum and previous and next. The curriculum stands beside the lesson, or opens as a drawer on a phone. **Complete and continue** finishes the lesson and opens the next one. Where the next one isn't open yet, the player says when it opens. On the last required lesson, it says the course is complete and offers the certificate.

## Where the courses live

Courses always have pages of their own at `/courses`. Where the site has a community (the `spaces` and `network` modules), they are also a place in it, the way Circle has them and the way Events are both. A Courses row sits in the community's navigation, and the same library, overview and player appear at `<community>/courses`. Neither address forwards to the other. There is nothing to configure: `courses.where`, which once chose between the two, is refused by name.

`/app/courses`, where the app area once listed a reader's courses, goes to the library. That holds even on a site whose own community place claims `/app`.

## In the admin

- **Courses** is the course builder. Write what the course is about, choose who gets in and how it is released, add cohorts, and add lessons, dragging them into order. A lesson's address stays the same once people have started it.
- **Enrollments** shows each course's people, how far each has got, how many finish, and the lesson where most of those who haven't finished have stopped. It lists names and email addresses, so it is for administrators only.

A reader's courses also appear on the private half of their member card in the community.

## The file

A course is a file, `content/courses/<slug>.md`, or a row in cloud mode. The admin writes it, and a site can write it by hand:

```md
---
title: Writing plainly
image: /uploads/courses/writing-plainly.svg
access: { free: true, tiers: [member], skus: [] }
release: drip # all · drip · cohort
drip: lesson # lesson · section
every: 2 # days
inOrder: true
certificate: true
cohorts: # with release: cohort
  - { key: spring, starts: 2026-03-01, space: writing-circle }
lessons:
  - { key: welcome, title: Why plain words, section: Starting out, media: { type: video, src: … } }
  - { key: chapter-one, title: Read the first chapter, kind: chapter, ref: plain-words#1 }
  - { key: check, title: A short check, kind: form, ref: reading-check }
  - { key: talk, title: Talk it through, kind: session, ref: one-on-one, required: false }
---

What the course is about.

## welcome

The welcome lesson's own words.
```

The text before the first `## ` heading is the course's description. Each lesson of its own text takes the section headed with its key. A chapter is written `<book>#<n>`, counted from 1. A course with a mistake in its file is not published, and the build names the mistake.

A space can be filled with a course's people, or one cohort of them:

```md
fill: { course: writing-plainly, cohort: spring }
```
