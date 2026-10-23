---
title: Courses
description: Lessons in order, released over time and tracked to completion, with certificates — on pages of their own or as a place of the community.
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
    packages/kit/theme/src/components/admin/CourseEnrollments.vue,
    packages/kit/theme/src/components/spaces/panels/MemberCourses.vue,
    packages/kit/theme/src/instrument/ui/results/CoursesTab.vue,
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
- **A form or quiz**. It counts as finished when the reader has answered it, and passed it where it is scored.
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

## Where the courses live

By default, courses have pages of their own at `/courses`. A site with a community can put them in it instead, the way Circle does:

```js
// platformkit.config.js
courses: { where: 'community' },
```

They then appear as a place in the community's navigation, at `<community>/courses`, and `/courses` forwards there. The lessons, progress and certificates are the same either way. Putting courses in the community needs the `spaces` and `network` modules on.

## In the admin

- **Courses** is the course builder. Write what the course is about, choose who gets in and how it is released, add cohorts, and add lessons, dragging them into order. A lesson's address stays the same once people have started it.
- **Enrollments** shows each course's people, how far each has got, how many finish, and the lesson where most of those who haven't finished have stopped. It lists names and email addresses, so it is for administrators only.

A reader's courses also appear in their app area, and on the private half of their member card in the community.

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
