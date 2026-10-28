# MeBulb

PDF markup and takeoff for construction drawings.
*Not the brightest, but it gets the job done.*

MeBulb is our own, clean-room application. It reads and writes standard PDF annotations
so markups made here open in Bluebeam Revu, Acrobat and other viewers, and markups made
there open here.

## What is in this repository

| Path | What it is |
| --- | --- |
| `src/body.html`, `src/style.css` | The page markup and styles |
| `src/js/*.js` | The application, concatenated in file-name order into one ES module |
| `build.js` | Assembles `src/` into a single self-contained `dist/mebulb.html` (web build) |
| `desktop/` | The portable Windows app (Electron shell, preload bridge, packaging) |
| `test/` | Playwright end-to-end tests (browser build and desktop build) |
| `metrics.json` | Glyph widths of the PDF standard fonts, so text lays out identically on screen and in the PDF |

### Main modules (`src/js`)

- `00-core` utilities, geometry, font metrics · `10-units` units and scales
- `20-markup` markup types and drawing (screen SVG and PDF use the same primitives)
- `22-richtext` rich text runs and editor · `25-sketch` sketch-to-scale risers · `27-align` page alignment by gridlines
- `30-state` application state, undo · `40-viewer` page rendering · `45-content` PDF content parsing (snapping, text)
- `46-forms` form fields · `47-textedit` PDF text editing · `48-ocr` text recognition · `49-fonts` installed fonts and embedding
- `50-tools`, `51-editops` drawing tools and editing commands
- `60`–`69` user interface: properties, markups list, panels, menus, preferences, commands and shortcuts, layout
- `70-pdfio` open/save/flatten, page operations · `71-pdfread` big-file reader and incremental (append-only) saves
- `72-dialogs` dialogs · `76-host` desktop bridge · `78-session` live sessions over the Egnyte drive · `80-sample` sample drawing

## Building

Node 18+.

```
node build.js                          # dist/mebulb.html (loads pdf.js and pdf-lib from jsDelivr)
node desktop/build-desktop.js          # out/app: the desktop app folder (all engines bundled)
node desktop/build-desktop.js --win    # dist/MeBulb-<version>-portable-win-x64.zip
```

The desktop build needs `pdfjs-dist` and `pdf-lib` (paths at the top of `desktop/build-desktop.js`)
and an Electron Windows zip (`ELECTRON_WIN`, defaults to `/tmp/dl/electron-win.zip`, from the
official Electron GitHub release).

## Tests

The tests drive the built page with Playwright: `node test/flow.js`, `flow2`, `flow3`, `r4`, `label`,
`incr` (incremental saves, fonts), and `desktop.js` (runs the Linux Electron build under
`xvfb-run`, including a two-person live session).

## Design notes

- **PDFs stay the document.** Markups are real PDF annotations. MeBulb's own extra data
  (scales, risers, layers) is a compressed JSON stream referenced from the catalog as `/MeBulbData`.
- **Big files**: files over the threshold are read on demand (pdf.js range requests through the
  desktop bridge) and saved by appending an incremental update, so a 400 MB set saves in well under a second.
- **Live sessions** write small change files into a hidden `.mebulb` folder beside the PDF; Egnyte
  syncs them and every copy merges them (newest change per markup wins).
