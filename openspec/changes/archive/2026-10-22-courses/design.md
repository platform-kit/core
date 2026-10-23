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

1. **Courses are a declaration, projected.** A course is a file (`content/courses/<slug>.md`, or a row in cloud mode) with its settings and lessons in front matter and each text lesson's words as a `## <key>` section of the body, edited in the admin's course builder. Like teams and spaces, a push (`courses-push`, and the model's projection over rows) makes the tables agree; nothing reads a row back into a file. Lessons live in the database so the database alone hands out a lesson's text. A course whose file goes is unpublished, never deleted. Alternative: a full content collection like articles. Rejected: twenty-six wiring points, and the text would have to be cut out of the published bundle again.
2. **Enrollment is its own record.** An `enrollments` row (person, course, cohort, started, completed) is created when access is first granted: on purchase, on joining a tier that includes the course, or on starting a free course. It isn't a field on purchases or memberships, because it has its own lifecycle: release dates count from it, and it survives a tier change. Losing access through a refund or a lapsed membership keeps the record and its progress, but closes the lessons, so coming back resumes where the reader left off.
3. **The server decides what's open.** One database function answers, per enrollment, which lessons are open and why not (a date, the lesson before, no access). The reader's screens and the content endpoint both ask it, so locked lesson text is never sent, the same rule gated content follows today.
4. **Completion is recorded, and checked where the server can see it.** `course_complete` writes `lesson_progress`. A form lesson needs a finished response (passed, where scored) and a session lesson a booking; a chapter or article is reported by the reader's app, since reading progress lives in the reader's own synced document. When every required lesson is done the enrollment completes, a `course_completed` event is recorded (a site's achievement rule awards on it), and the certificate is issued.
5. **Certificates are records with a public page.** A `certificates` row has a random public id. `/certificates/<id>` shows the name, course, date and issuer to anyone. The PDF is written in the browser by a one-page generator using the PDF format's built-in Helvetica (no library, no font to embed).
6. **Release emails ride the existing jobs.** A sweep every fifteen minutes posts to `course-notify`, which asks `course_notices_due` and writes each notice before sending, as the event reminders do. A lesson email goes only for a lesson that opened after somebody started (a course released all at once sends none), once per lesson, and at most one a day to a person. These are service emails; the marketing caps do not apply to them.
7. **Cohorts are dates plus a space.** A cohort is a start date and an optional space; spaces gain the membership rule "enrolled in course X (cohort Y)".

8. **Where they live.** `courses.where` puts them on pages of their own or in the community. In the community PlatformKit registers them as a place exactly as a site registers its own (`community.places`), so the navigation row, the mount at `<community>/courses` and the forwarding of `/courses` are the existing machinery. The list, course and lesson are one component (`CoursesView`) under either frame. The place's page is named by package path, so no file path of the build machine reaches the browser.
9. **Enrollments are an administrator's.** The view lists names and addresses, so it asks `is_admin`, as orders do.

## Risks / Trade-offs

- **Pointed-at content can change after enrollment.** Completion follows the current chapter or form; a removed item drops out of the required count.
- **Large cohorts** cause bursts of release emails on start dates: one per person, sent by the fifteen-minute sweep.
