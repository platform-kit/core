## 1. Checks

- [x] 1.1 `strings.test.mts`: fail a site field equal to the theme's default, naming the file and key
- [x] 1.2 `strings.test.mts`: fail a default group that no kit file naming its scope reads
- [x] 1.3 Both fail on the old tree (1,295 copied fields in DharmaLab; 14 unread default groups) and pass after section 2 and the DharmaLab change — 32/0 over DharmaLab and over sites/demo

## 2. Defaults

- [x] 2.1 Remove `pages`: pairs, words, areas, summary, radar, grid, and the hero and empty-box fields only DharmaLab reads; delete the unused `QueueList.vue`
- [x] 2.2 Remove `quiz`: diagnostic, teachings, host
- [x] 2.3 Remove `sheet`: drawer, conv, built, shapes, patterns, areas, pairs, words
- [x] 2.4 Remove `library.card` (DharmaLab holds it) and `sections.faq` (read by nothing)
- [x] 2.5 "the shelf" → "the library" in the library, store and gate defaults and the email tags' sample
- [x] 2.6 DharmaLab's merged strings, before and after, differ only by the reworded shelf lines and the four fields nothing read

## 3. Editor

- [x] 3.1 The UI strings editor lists every theme scope, shows each default as the field's placeholder, saves only fields that differ, and Reset removes a field

## 4. Docs

- [x] 4.1 `building-a-site/strings` and `running-a-site/settings/site-settings-and-strings` state the rule, the editor and both checks
