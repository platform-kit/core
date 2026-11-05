## ADDED Requirements

### Requirement: A site registers course lesson kinds

A site's config SHALL be able to name `courses.kinds`: for each kind, its name, the component that plays it (`component`), and optionally a build-time check of a lesson's `ref` (`check`) and a progress measure for its section (`progress`). A kind SHALL NOT take the name of one of the kit's own kinds. With the registration removed, the kit's own kinds SHALL work as for a site that never registered one.

#### Scenario: registering and removing a kind

- **WHEN** the demo registers its self-rating kind, and then the registration is removed
- **THEN** with it, a course may use the kind; without it, every course using only the kit's kinds plays as before and one naming the self-rating is refused by the build

Verified by: `build/courses.test.mts`; a kind named `text` is refused when the config is read
