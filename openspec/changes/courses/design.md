# Design

## Context

See proposal.md for why. What exists to build on:

- **Content:** books, chapters, articles and content models, with drafts and publishing in all three deployment shapes.
- **Access:** access rules by visitor class (guest, signed in, buyer, member, tier), purchases in `40-commerce.sql`, tiers in memberships.
- **Reading and quizzes:** chapter reading progress and chapter quiz mastery, kept per reader across devices; forms with scoring.
- **Around it:** achievements (`98-achievements.sql`), spaces with rule-based membership (`90-spaces.sql`), email kinds, funnels, comments, the member-card panels, analytics events.

## Goals / Non-Goals

**Goals:** a course as its own record; enrollment as its own record; release and completion the server decides; certificates anyone can check; every surrounding module joining only when it's on.

**Non-Goals:** live classes (sessions and events cover them), staff-graded assignments, SCORM.

## Decisions

1. **Courses are content.** A course is a content record (a file in the repository, or a row in cloud mode) with sections and lessons, edited in the admin's course builder. Lessons that point at existing content name it by its id, so renaming a chapter never breaks a course.
2. **Enrollment is its own record.** An `enrollments` row (person, course, cohort, started, completed) is created when access is first granted: on purchase, on joining a tier that includes the course, or on starting a free course. It isn't a field on purchases or memberships, because it has its own lifecycle: release dates count from it, and it survives a tier change. Losing access through a refund or a lapsed membership keeps the record and its progress, but closes the lessons, so coming back resumes where the reader left off.
3. **The server decides what's open.** One database function answers, per enrollment, which lessons are open and why not (a date, the lesson before, no access). The reader's screens and the content endpoint both ask it, so locked lesson text is never sent, the same rule gated content follows today.
4. **Completion is recorded, and some of it is derived.** `lesson_progress` rows are written when a reader marks a lesson done, passes its quiz, or when the existing reading or form records say a pointed-at chapter or form is finished. A trigger completes the enrollment when every required lesson is done, which awards the achievement and issues the certificate.
5. **Certificates are records with a public page.** A `certificates` row has a random public id. `/certificates/<id>` shows the name, course and date to anyone. The PDF is rendered from that page by the existing print machinery.
6. **Release emails ride the existing jobs.** A scheduled database job finds lessons newly open per enrollment and sends "a new lesson is open", once per lesson per person, through the email module, with the funnel caps respected.
7. **Cohorts are dates plus a space.** A cohort is a start date and an optional space; spaces gain the membership rule "enrolled in course X (cohort Y)".

## Risks / Trade-offs

- **Pointed-at content can change after enrollment.** Completion follows the current chapter or form; a removed item drops out of the required count.
- **Large cohorts** cause bursts of release emails on start dates. They use the email module's existing caps and queue.
