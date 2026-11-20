## 1. Kit

- [x] 1.1 `placesOf` reads `scroll` (frame · page) and refuses anything else — network.test 62/0
- [x] 1.2 SpacesPage: a `page` place sets `sp-flow`: the page grows, the menu sticks beside it on a wide screen without stretching the page — measured in Chromium: the diagnostics document scrolls, no inner scroller; the inbox and home keep the frame
- [x] 1.3 Docs: configuration and config keys name `scroll`

## 2. Verify

- [x] 2.1 A page place driven in a browser (DharmaLab's diagnostics): the document scrolls, the menu and the place's own tabs stay in view, a round in it still fits the window exactly (0px extra)
