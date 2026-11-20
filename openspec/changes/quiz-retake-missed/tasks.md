# Tasks

## 1. The setting

- [x] 1.1 The parser reads `#! on-failure` (`retake-all`, `retake-missed`) into the kit settings and refuses it without a pass mark, with `workbook` or with `once`. Verified by the forms parse tests.
- [x] 1.2 The form builder's scoring card sets it once there is a pass mark. Verified in a browser: it reads retake-missed from the file.

## 2. The attempt

- [x] 2.1 The `form` function, for a `retake-missed` form whose last finished attempt by this person failed, copies that attempt's right answers into the new attempt when it is created, and `get` names them (`carried`), for a new attempt and for one in progress.
- [x] 2.2 The runner passes over every slide whose questions are all carried, ends on the last slide still asked, and spaces the progress over the slides asked.
- [x] 2.3 In a course lesson, failing a `retake-missed` quiz offers to retake the missed questions. Verified in a browser on DharmaLab's final quiz: failed at 19 of 25, the retake asked only the six missed (q3 q7 q11 q14 q20 q25), carried the other 19 and passed at 25 of 25, completing the course.

## 3. Documentation

- [x] 3.1 The forms page documents the setting; the courses page says what Try again asks. Verified by `node packages/kit/build/docs-check.mts`.
