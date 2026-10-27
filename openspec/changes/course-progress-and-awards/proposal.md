# Proposal

## Why

A course's navigation showed whether a lesson was done, but not whether its quiz was passed or failed, and a section showed a count with no sense of finishing. Passing a quiz earned nothing beyond the lesson tick. Course platforms that keep students going make progress visible at every level and mark each milestone: Kajabi and Thinkific show pass and fail against every quiz and progress against every module, and many award a badge for each one passed.

## What Changes

- **Every item in the curriculum shows its state**, in the lesson player's sidebar and the course overview alike: done, a quiz passed with its score, a quiz attempted and not yet passed with its best score, open, or closed.
- **Every section shows its progress**: how many of its required lessons are done, a bar, and a mark when the whole section is complete.
- **Every quiz passed earns an achievement.** The first time a reader passes a scored form lesson, the server records a `quiz_passed` event, and the achievements module awards that quiz's achievement. Each scored form lesson of a published course has one, declared by the achievements push from the course file, titled after its section unless the course gives it a title of its own. The player names the achievement as the quiz is passed, and the achievement has its own page like any other.

## Non-goals

- Points, levels or leaderboards.
- Achievements for lessons that are not quizzes.
