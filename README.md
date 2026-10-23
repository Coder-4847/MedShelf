# MedShelf

**Your home medicine cabinet, organised.**

MedShelf turns a photo of a pile of medicines into a clean, editable home inventory. It is a static
web app (React + TypeScript): no backend, no accounts, no paid APIs, no cloud AI. Everything runs on
your device and works offline after the first load. Built with UAE households in mind: UAE brand
names in the drug list and GS1 DataMatrix (expiry, batch, serial) support.

> MedShelf is an organisational tool. It can misread labels. Always verify medicine names, strengths
> and expiry dates against the physical package. It does not provide medical advice.

## Features

- **Scan**: take/upload photos (or live camera). PP-OCRv4 text detection + recognition run in a Web
  Worker through ONNX Runtime (WASM); GS1 DataMatrix / 1D barcodes via zxing-wasm. Handles rotated
  and upside-down labels, overlapping tiles ("thorough" mode), multi-photo sessions.
- **Review**: photo with outlined detections, editable candidate, confidence indicator, "Check this"
  flags (low confidence is never silently accepted), "Missed one?" draw tool, unlinked-barcode
  attach, "Confirm all high-confidence".
- **Inventory**: TanStack Table with inline editing, sort, search, status/category/location
  filters, column toggle, bulk actions, detail drawer with photo, undo on delete, print list.
- **Dashboard**: totals, expiring in 30/60/90 days, expired, low stock, needs-attention list,
  recent scans, onboarding. Expired checklist with "mark as disposed".
- **Learning**: confirmed corrections become local aliases (and GTIN to name); duplicates are
  detected and merged by name + strength.
- **Data**: real `.xlsx` export (styled header, frozen pane, live expiry-status formula with
  conditional colouring) and CSV; CSV/XLSX import; JSON backup/restore with photos.
- **PWA**: installable, offline, light/dark theme, self-hosted fonts, no analytics, no external
  network requests at runtime.

## Develop

```bash
npm install          # install dependencies
npm run dev          # http://localhost:5173
npm run build        # type-check + production build into dist/
npm run preview      # serve dist/ on :4173
npm test             # unit tests (Vitest)
npm run test:e2e     # Playwright (run `npm run build` first)
npm run lint && npm run typecheck
```

`npm run dev` and `npm run build` run `scripts/prepare-assets.mjs`, which copies the ONNX Runtime
WASM and the Tesseract fallback files from `node_modules` into `public/vendor` (git-ignored). The
PP-OCRv4 models are committed in `public/models`.

### Measure scan accuracy

```bash
npm run gen:fixtures                       # regenerate the synthetic photos (seeded)
npx vitest run --config vitest.eval.config.ts score                     # fast mode
EVAL_MODE=thorough npx vitest run --config vitest.eval.config.ts score  # thorough mode
```

Reports are written to `eval-output/`. The numbers from the last run are in
[`tests/fixtures/scans/RESULTS.md`](tests/fixtures/scans/RESULTS.md).

## Deploy to GitHub Pages

1. Push this repository to GitHub (default branch `main`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main`. `.github/workflows/deploy.yml` lints, type-checks, tests and builds with
   `BASE_PATH=/<repo-name>/`, then publishes `dist/`. The site appears at
   `https://<user>.github.io/<repo-name>/`.

The app uses hash routing, so deep links work on Pages without rewrite rules. For a custom domain
(served from `/`), build without `BASE_PATH`.

`.github/workflows/e2e.yml` runs the Playwright suite on pull requests.

## Project layout

```
src/
  app/            shell, hash router, theme
  components/     UI primitives (Button, Modal, Toast, ...), icons, logo
  db/             Dexie schema (v1, v2 + migration), repo helpers, hooks
  data/drugs.json 482 UAE-oriented brand/generic entries (easy to extend)
  features/       dashboard, inventory, scan, settings
  lib/gs1         GS1 element-string parser (+ unit tests)
  lib/ocr         detector, recogniser, engine, Tesseract fallback, asset cache
  lib/match       normalisation, fuzzy matcher, strength/form/pack/expiry extraction
  lib/scan        grouping, candidates, barcode linking, session merging
  lib/io          csv, xlsx, import mapping, JSON backup
  workers/        ocr.worker.ts, barcode.worker.ts
public/models     PP-OCRv4 det / rec / cls ONNX + dictionary
```

### Extending the drug list

Add objects to `src/data/drugs.json`:

```json
{
  "name": "Panadol",
  "generic": "Paracetamol",
  "aliases": ["Panadol Tablets"],
  "strengths": ["500 mg"],
  "forms": ["tablet"],
  "category": "Pain relief"
}
```

`name`, `generic` and `aliases` are all matchable. Names must be unique (a unit test checks this).

## How scanning works

1. Photo is decoded (EXIF-corrected) and scaled: ~1600 px (fast) / 2000 px (thorough) for text; up to
   3000/4000 px for barcodes, which need native resolution.
2. PP-OCR detector finds rotated text boxes (full image, plus overlapping tiles in thorough mode);
   boxes are merged and de-duplicated.
3. Each box is deskewed; the angle classifier and a retry at other orientations handle upside-down or
   sideways text. Decoding is restricted to Latin characters.
4. Barcodes are read and parsed (GTIN AI 01, expiry AI 17 with day `00` = month end, batch AI 10,
   serial AI 21) and linked to the nearest package.
5. Text boxes are clustered into packages by proximity and orientation; clusters that swallowed two
   packages are split; names are fuzzy-matched against `drugs.json` and your learned aliases.
6. Anything that is not an exact match, or whose cluster looks like several packages, is flagged
   "Check this".

If the ONNX models cannot load or run, the app falls back to Tesseract.js automatically and says so.

## Credits and licences

- Text detection/recognition: [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-OCRv4 mobile
  models (Apache-2.0), ONNX conversions as packaged in `@gutenye/ocr-models` (MIT, RapidOCR builds).
- [ONNX Runtime Web](https://onnxruntime.ai/) (MIT), [zxing-wasm](https://github.com/Sec-ant/zxing-wasm)
  (MIT) / zxing-cpp (Apache-2.0), [Tesseract.js](https://tesseract.projectnaptha.com/) (Apache-2.0),
  [ExcelJS](https://github.com/exceljs/exceljs) (MIT), [Dexie](https://dexie.org/) (Apache-2.0),
  [TanStack Table](https://tanstack.com/table) (MIT), [Inter](https://rsms.me/inter/) (OFL).
