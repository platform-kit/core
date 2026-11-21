## ADDED Requirements

### Requirement: A site's strings hold only what it changes or adds

A site's strings file SHALL contain only fields that differ from the theme's default for the same scope, group and key, or that the theme does not have. The strings check SHALL refuse a field equal to the default, naming the file and the key. The admin's UI strings editor SHALL list every scope the theme has, SHALL show each default as its field's placeholder, SHALL write only fields that differ from the default, and SHALL remove a field from the site's file when it is reset to the default.

#### Scenario: a copied default

- **WHEN** a site's `content/app/ui/store.md` holds `featured: View all` under the same group and key where the theme's default is also `View all`
- **THEN** the strings check fails and names `content/app/ui/store.md` and the key

Verified by: `packages/kit/build/strings.test.mts`

#### Scenario: an override and an extension

- **WHEN** a site's file changes one default field and adds a group the theme does not have
- **THEN** the check passes, the changed field and the added group render, and every other field renders the theme's default

Verified by: `packages/kit/build/strings.test.mts`

#### Scenario: the editor resets a field

- **WHEN** an administrator edits a string and then resets it to the default
- **THEN** the site's file no longer contains that field

Verified by: the editor driven in a browser on DharmaLab: a change to a default saved one field, Reset removed it

### Requirement: The theme's default strings are the kit's own words

Every group in the theme's and the modules' default strings SHALL be read by a kit source file, and SHALL name no site, product or site-specific concept. A group only a site's code reads SHALL live in that site's strings.

#### Scenario: a group no kit file reads

- **WHEN** a default group is read by no file under `packages/kit`
- **THEN** the strings check fails and names the scope and the group

Verified by: `packages/kit/build/strings.test.mts`
