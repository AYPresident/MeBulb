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
| `revit/` | Revit exporter (Python for Dynamo / pyRevit) that feeds MeBulb's equipment library |
| `metrics.json` | Glyph widths of the PDF standard fonts, so text lays out identically on screen and in the PDF |

### Main modules (`src/js`)

- `00-core` utilities, geometry, font metrics · `10-units` units and scales
- `20-markup` markup types and drawing (screen SVG and PDF use the same primitives)
- `22-richtext` rich text runs and editor · `25-sketch` sketch-to-scale risers · `26-equip` equipment top views to scale with clearances and clash checks · `27-align` page alignment by grid bubbles or hand-placed reference points and grid lines
- `30-state` application state, undo · `40-viewer` page rendering · `45-content` PDF content parsing (snapping, text)
- `46-forms` form fields · `47-textedit` PDF text editing · `48-ocr` text recognition · `49-fonts` installed fonts and embedding
- `50-tools`, `51-editops` drawing tools and editing commands
- `60`–`69` user interface: properties, markups list, panels, menus, preferences, commands and shortcuts, layout
- `52-print` print dialog · `53-stamps` stamp library, custom PDF stamps with fields and stamp JavaScript (sandboxed)
- `70-pdfio` open/save/flatten, page operations · `71-pdfread` big-file reader and incremental (append-only) saves
- `72-dialogs` dialogs · `73-owned` colour processing and flatten/unflatten page content
- `74-revu` Bluebeam Revu compatibility (measurements, captions, counts, layers, viewports, importing other apps' markups)
- `75-btx` Bluebeam tool sets (.btx) import/export, tool previews, recent tools
- `76-host` desktop bridge · `78-session` live sessions over the Egnyte drive · `80-sample` sample drawing
- `vendor/ocr` offline text recognition (Tesseract compiled to WebAssembly, English model) and its worker

## Building

Node 20+. `npm install` fetches the build and test tools (pdf.js, pdf-lib, Playwright).

```
npm install
npx playwright install chromium        # once, for the tests
node build.js                          # dist/mebulb.html (loads pdf.js and pdf-lib from jsDelivr)
node desktop/build-desktop.js          # out/app: the desktop app folder (all engines bundled)
node desktop/build-desktop.js --win    # dist/MeBulb-<version>-portable-win-x64.zip
```

The desktop build bundles `pdfjs-dist` and `pdf-lib` from `node_modules` (or a shared tools folder
named by `MEBULB_TOOLS`) and needs an Electron Windows zip (`ELECTRON_WIN`, defaults to `/tmp/dl/electron-win.zip`, from the
official Electron GitHub release).

## Tests

`npm test` builds the page, then runs every browser suite in turn
(`test/run-all.js`; pass suite names to run some, e.g. `node test/run-all.js revu btx`):
`flow`, `flow2`, `flow3`, `r4`, `r5`, `label`, `incr`, `textmark`, `revu` (Bluebeam measurements,
counts and Revu-flattened markups, using sample files in `test/fixtures`), `stamps`, `btx` (tool sets),
`equip` (equipment and clearances), `r7` (curves and nodes, area rectangles, linked sketches and their
Revu output, callout knees and leaders, reference-mark alignment, same-spot page flipping), `ocr`, and `igs` (client drawings, skipped unless `IGS_DIR` has them). The tests need
`qpdf` and `pdftotext`/`pdftoppm` (poppler-utils). `test/desktop.js` runs the Linux Electron build under
`xvfb-run`, including a two-person live session.

GitHub Actions (`.github/workflows/ci.yml`) builds and runs the browser suites on every push and
pull request, and keeps the web build and the test screenshots.

## Design notes

- **PDFs stay the document.** Markups are real PDF annotations. MeBulb's own extra data
  (scales, risers, layers) is a compressed JSON stream referenced from the catalog as `/MeBulbData`.
- **Big files**: files over the threshold are read on demand (pdf.js range requests through the
  desktop bridge) and saved by appending an incremental update, so a 400 MB set saves in well under a second.
- **Bluebeam Revu**: markups carry Revu's intent (`/IT`), measurement dictionaries, count groups and
  rich-text captions, so Revu treats them as its own; tool sets go both ways as `.btx` files.
- **Compound markups go out as plain ones.** Revu redraws a markup from its dictionary when it is edited
  there, so a sketch is written as an exact Square/Circle/Polygon plus a FreeText label, ink and an arrow,
  grouped; a callout's extra leaders are grouped polylines. MeBulb reads them back as the one markup.
- **Curves** in polylines and polygons are stored as the point each bent side passes through halfway,
  relative to the side, and go out to other apps as short straight pieces.
- **Flatten / unflatten** keeps the markups as JSON inside the flattened drawing, so unflatten brings
  back real, editable annotations (text boxes stay text boxes).
- **Live sessions** write small change files into a hidden `.mebulb` folder beside the PDF; Egnyte
  syncs them and every copy merges them (newest change per markup wins).
