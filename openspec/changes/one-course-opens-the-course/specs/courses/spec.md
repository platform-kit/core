## ADDED Requirements

### Requirement: A library of one course opens the course

Where the library has exactly one course for the reader, `/courses` and `<community>/courses` SHALL show that course's overview in place of the library, at the library's own address, without forwarding. The page's canonical link SHALL name the course's own address. The overview SHALL NOT offer a way back to all courses in this case. With two or more courses the library SHALL show as before, and with none it SHALL show its empty state.

#### Scenario: a site with one course

- **WHEN** a guest, and then a reader enrolled in it, opens `/courses` and `<community>/courses` on a site with one published course
- **THEN** each sees the course's overview with its curriculum and the right next step for them, the address is unchanged, the community's navigation stays, and there is no link back to all courses

Verified by: the demo rendered with one course at 1280 and 390 px, light and dark

#### Scenario: a second course

- **WHEN** a second course is published
- **THEN** both addresses show the library again

Verified by: the demo rendered with its courses
