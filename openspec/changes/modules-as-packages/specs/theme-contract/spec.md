## ADDED Requirements

### Requirement: The theme is the look, not the features

The theme SHALL hold the design tokens, palettes, looks, layout shell and the shared building blocks every module draws with. It SHALL NOT hold a module's pages, components or admin screens. A theme or a site SHALL be able to override any module's component by name, and two components of one name across the theme and the enabled modules SHALL be refused.

#### Scenario: a module screen in the theme

- **WHEN** a component that belongs to one module is placed in the theme
- **THEN** the manifests check fails, naming the component and its module

Verified by: `build/manifests.test.mts`, with a planted component

#### Scenario: overriding a module's component

- **WHEN** a site overrides a module's component by name
- **THEN** every import of that component, in the module and elsewhere, resolves to the site's

Verified by: `build/theme-overrides.test.mts` against `sites/demo`
