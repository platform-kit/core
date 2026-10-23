# Tasks

## 1. The server

- [x] 1.1 A form response that completes, passed or unscored, records every open form lesson pointing at that form as done for that person, and checks the course for completion. Verified by `build/courses-db.test.mjs`: passed completes, failed does not, the last lesson completes the course.
- [x] 1.2 `course_state` gives each scored form lesson the reader's best attempt (score, total, passed, attempts), and `admin_course_enrollments` each person's. Verified by `build/courses-db.test.mjs`.

## 2. The player

- [x] 2.1 A form lesson runs its form inside the player, and replaces the form's end with the result: passed and on to the next lesson, or the score, the pass mark and Try again. A lesson already passed shows the best score and offers a retake. No Complete button on a form lesson unless it was passed before it opened. Verified in a browser on the demo at 1280 and 390 px, light and dark.
- [x] 2.2 The curriculum shows the best score against a scored form lesson; the admin's enrollments show each person's scores. Verified the same way.

## 3. Documentation

- [x] 3.1 The courses documentation page says how a quiz lesson runs and completes. Verified by `node packages/kit/build/docs-check.mjs`.
