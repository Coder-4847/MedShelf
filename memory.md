# MedShelf: project memory

Last updated: 2026-10-23. Read this first when resuming work (human or AI session).

## 1. Status in one paragraph

MedShelf is **built, tested, deployed and user-tested**. It is a static, offline-first PWA that turns a photo of a pile of medicines into an editable home inventory. Live site: **https://coder-4847.github.io/MedShelf/**. Repo: **https://github.com/Coder-4847/MedShelf**. The owner has tried most features on a real device and reports it works well. Nothing is known to be broken. Remaining work is improvement, not repair (section 10).

## 2. Product summary

- Tagline: _Your home medicine cabinet, organised._ Target user: a UAE household with lots of medicine at home.
- Core loop: **Scan** (photo/upload/live camera) → **Review** (outlined detections, edit/confirm/discard) → **Inventory** (editable table) → **Export** (.xlsx / .csv).
- No backend, no accounts, no analytics, no paid APIs, no cloud AI. Everything runs on-device. Verified by an e2e test that a full scan makes zero external requests.
- Safety stance: organisational tool only. No dosing, interactions, or "what is this for". The notice "MedShelf is an organisational tool. It can misread labels. Always verify medicine names, strengths, and expiry dates against the physical package. It does not provide medical advice." is shown in Settings → About and a shorter version on the Review screen. Low-confidence results are always flagged "Check this" and never auto-accepted.

## 3. Hosting and branches (important quirk)

- GitHub Pages source is **GitHub Actions** (already enabled by the owner).
- The repo's **default branch is `claude/exciting-cori-k1d1ib`** (it was the only branch when the repo was empty). GitHub's `github-pages` environment only accepts deployments from the default branch, so a deploy run from `main` is **blocked** (job fails in ~1 s with no steps).
- Therefore `.github/workflows/deploy.yml` triggers on push to **both** `main` and `claude/exciting-cori-k1d1ib`, and **deploys come from the long branch name**.
- `main` exists and was synced at commit `9b61c31`; later commits (this file) go to the feature branch only. Do not rely on `main` being current.
- **Do not push to both branches at once.** Both runs share the `pages` concurrency group with `cancel-in-progress`; the `main` run (which will fail) cancelled the good run once. Push only the feature branch.
- Optional cleanup the owner declined for now: Settings → General → Default branch → `main`, then remove `claude/exciting-cori-k1d1ib` from the workflow's `push.branches`.
- To redeploy: push to `claude/exciting-cori-k1d1ib`, or Actions → "Test and deploy to GitHub Pages" → Run workflow (select that branch).
- Workflows: `deploy.yml` (lint, typecheck, unit tests, build with `BASE_PATH=/<repo>/`, deploy), `ci.yml` (lint, format:check, typecheck, test, build on PRs and non-main pushes), `e2e.yml` (Playwright on PRs).
- No pull request was ever opened (the owner never asked for one).

## 4. Tech stack

Vite 8 + React 19 + TypeScript 6 (strict) · Tailwind CSS v4 (token layer in `src/index.css`, light/dark via `data-theme`) · Dexie (IndexedDB) · TanStack Table **v8** (pinned; v9 has a different API) · onnxruntime-web (WASM, single thread) · zxing-wasm · Tesseract.js (fallback) · ExcelJS (xlsx) · vite-plugin-pwa (Workbox) · Vitest · Playwright 1.56.1 (pinned to match the sandbox Chromium) · axe-core. Self-hosted Inter (latin subset).

Deviations from the original brief (all deliberate, all reported to the owner):

- **ExcelJS instead of SheetJS.** The patched SheetJS CDN build was unreachable from the sandbox; the npm `xlsx@0.18.5` is stale with known advisories and cannot write styles/frozen panes/conditional formatting. CSV uses an in-house RFC 4180 codec.
- **No WebGPU.** Single-thread WASM only; static hosting cannot provide cross-origin-isolation headers for threads.
- **Models came from npm** (`@gutenye/ocr-models`), because Hugging Face and GitHub raw were blocked in the sandbox. They are the standard PaddleOCR PP-OCRv4 mobile det/rec + v2.0 angle classifier ONNX files (RapidOCR conversions), committed in `public/models/` (~16 MB).
- Added an optional `packSize` field to items (not in the original data model).

## 5. Repository layout

```
src/
  app/            Shell (sidebar + mobile tab bar), hash router (+ useIsDesktop), theme
  components/     ui.tsx (Button, Modal/drawer, Toast, Chips...), Icon.tsx, Logo.tsx, PhotoThumb.tsx
  db/             index.ts (Dexie schema v1->v2 + migration), repo.ts, hooks.ts, types.ts
  data/drugs.json 482 UAE-oriented entries {name, generic, aliases[], strengths[], forms[], category}
  features/
    dashboard/    summary cards, 30/60/90 buckets, needs-attention, recent scans, onboarding
    inventory/    table + mobile cards, inline cells, ItemForm, ItemDrawer, ImportDialog, exporter
    scan/         ScanPage, ReviewPage, CandidateEditor, PhotoOverlay, AddDialog, CameraDialog,
                  ReaderStatus, session.tsx (context holding the multi-photo session)
    settings/     SettingsPage
  lib/
    expiry.ts     status logic, month-end rule, flexible date parsing (03/2027 etc.)
    gs1/parse.ts  GS1 element-string parser (AI 01/10/11/13/15/17/21..., FNC1/GS, HRI, YYMMDD day 00 = month end, century rule)
    barcode/scan.ts  zxing-wasm DataMatrix + 1D, full image + tiles, GS1 interpretation
    ocr/          detect.ts (DB post-process), recognize.ts (CTC, Latin-only mask), engine.ts (tiling, merge,
                  orientation), geometry.ts, image.ts, assets.ts (Cache API loader), client.ts (worker client),
                  tesseract.ts (fallback)
    match/        text.ts, matcher.ts (fuzzy + learned aliases), extract.ts (strength/form/pack/expiry/batch), drugs.ts
    scan/         group.ts, candidates.ts (clustering, splitting, confidence), pipeline.ts, scanPhoto.ts, session.ts
    io/           csv.ts, xlsx.ts, import.ts, backup.ts, columns.ts, download.ts
  workers/        ocr.worker.ts, barcode.worker.ts
public/models/    PP-OCRv4 det/rec/cls ONNX + ppocr_keys_v1.txt (committed)
public/vendor/    ORT wasm + Tesseract fallback files (git-ignored; copied by scripts/prepare-assets.mjs)
scripts/          prepare-assets.mjs, gen-fixtures.mjs, gen-icons.mjs
tests/unit/       Vitest (130 tests)      tests/eval/  model-backed accuracy harness (Node)
tests/fixtures/   scans/ (12 synthetic photos + ground truth + RESULTS.md), sample-inventory.csv
e2e/              Playwright specs: app, scan, offline, a11y, pwa
```

## 6. How the scan pipeline works

1. Photo decoded with EXIF orientation. Working copy: long edge 1600 px (fast) / 2000 px (thorough) for text; 3000 / 4000 px copy for barcodes (DataMatrix needs native resolution).
2. OCR worker (PP-OCRv4 via ORT WASM): DB detector → connected components → min-area rotated rects → unclip. Thorough mode also detects on 736 px overlapping tiles; boxes merged by polygon overlap (larger wins).
3. Each box deskewed to 48 px height; angle classifier plus retries at other orientations (also 90° for near-square boxes). CTC decode restricted to Latin/digit/punctuation (CJK masked out). Note the decoder often drops spaces ("500mg", "14tablets"); all extractors tolerate this.
4. Barcode worker (zxing-wasm, wasm supplied locally; its default CDN is never used): GS1 parse → GTIN, expiry, batch, serial.
5. Main thread: cluster text lines by proximity + orientation (square-ish lines compared modulo 90°); split clusters containing multiple name "anchors"; attach orphan fine print to a host cluster; match names against `drugs.json` + learned aliases; extract strength/form/pack/expiry/batch; link barcodes to the nearest orientation-compatible package.
6. Confidence rules: exact (or OCR-confusable-equal) match can be "high"; **any fuzzy match is capped below 0.8 → "Check this"**; unknown names ≤ 0.5; clusters that look like several packages get a note and are flagged.
7. If the ONNX reader fails to load/run, `scanPhoto` falls back to Tesseract.js (4 rotations in thorough mode) and the Review screen shows a notice.
8. Models are fetched once with progress ("Downloading reader (one time)") and kept in the Cache API (`medshelf-reader-v1`) by `lib/ocr/assets.ts`; the service worker only runtime-caches `/vendor/tesseract/`.

## 7. Data model (Dexie)

Tables: `items`, `photos` (blob + thumbBlob), `aliases` (learned: normalised raw text → canonical name; also `gtin:<14 digits>` keys), `settings` (key/value), `scans` (recent scans). **Schema versions:** v1 = first four tables; v2 adds `scans` and an `items.disposedAt` index with an upgrade that backfills `disposedAt`. Never edit an old `version()` block; append a new one (tested in `tests/unit/db.test.ts`).

Behaviours worth remembering: month-only expiry means last day of that month; an item is expired only when strictly before today (local date); low stock = quantity ≤ per-item threshold or the default (1); duplicates are name + strength; two photos of the same pile are counted once (quantity = max per-photo total; same GTIN+serial never counted twice); confirmed/corrected names teach the matcher (identity aliases are learned for unknown names so they are recognised next time).

## 8. Commands

```bash
npm install
npm run dev | build | preview          # build/dev run scripts/prepare-assets.mjs first
npm run lint && npm run format:check && npm run typecheck
npm test                                # 130 unit tests
npm run build && npm run test:e2e       # 22 Playwright tests (needs build; uses vite preview :4173)
npm run gen:fixtures                    # regenerate synthetic scan photos (seeded)
npm run eval:scan  /  npm run eval:scan:thorough   # accuracy against fixtures (writes eval-output/, git-ignored)
BASE_PATH=/MedShelf/ npm run build      # what CI builds for Pages
```

## 9. Measured quality (see `tests/fixtures/scans/RESULTS.md` for the full tables)

Synthetic benchmark: 12 generated photos, 105 boxes. **Optimistic by construction** (parameters tuned while looking at it; not real packaging).

|                                    | Fast (default) | Thorough  |
| ---------------------------------- | -------------- | --------- |
| Boxes found                        | 98%            | 99%       |
| Name right (of found)              | 100%           | 99%       |
| Strength / form                    | 92% / 70%      | 97% / 93% |
| DataMatrix read                    | 60/60          | 60/60     |
| Expiry right                       | 62%            | 71%       |
| Unflagged wrong names              | 0              | 1         |
| Time/photo (Node WASM, server CPU) | ~5 s           | ~17 s     |

In the browser a fast scan took ~5–7 s on the build server. Not benchmarked on phones. Lighthouse (production build, mobile preset): Performance 95–96, Accessibility 100, Best Practices 100; SEO was 91 before `robots.txt` was added (not re-measured). Lighthouse 12 has no PWA category; installability is covered by `e2e/pwa.spec.ts`. axe-core WCAG A/AA passes on all screens in both themes; tap targets ≥ 44 px; no horizontal scroll at 390 px.

## 10. Known limitations and next steps

Known weaknesses:

- **Touching boxes with names not in the drug list can merge into one candidate** (the one unflagged wrong name in thorough mode, fixture scan-06). The review UI flags merges it detects but not all.
- Names one letter from a real drug (e.g. "Orelix" vs "Orelox") are _suggested_ as that drug, always flagged "Check this".
- White-on-colour pill text is sometimes missed → empty strength/form.
- Arabic text is not read (Latin-only recogniser). Fine print is often unreadable at working resolution.
- Real UAE packaging (glossy foil, curved boxes, logos) has **not** been benchmarked. Tesseract fallback accuracy not measured.
- Single-thread WASM; no WebGPU.

Suggested next improvements, in priority order:

1. Collect real photos of UAE packaging (owner offered none yet), build a real benchmark, retune grouping thresholds against it (current thresholds are in `lib/scan/candidates.ts` and `lib/scan/group.ts`).
2. Detect box outlines to stop merges; add an Arabic-capable recogniser.
3. Speed: multi-thread/WebGPU via a cross-origin-isolation service-worker trick; skip tiny print unless needed.
4. Smaller: switch default branch to `main`; add GTIN-based lookup list; per-item reminders; CSV column mapping UI.

## 11. Gotchas learned (save yourself the debugging)

- `useSettings()` must return a **memoised** object. An unstable identity made TanStack Table's auto-reset loop forever and froze the Inventory page (fixed in `db/hooks.ts`).
- Render **one** inventory layout at a time (`useIsDesktop`); rendering both table and cards duplicated labels and broke a11y/tests.
- Dashboard body is gated on the first DB read to avoid layout shift (CLS 0.57 → 0).
- ORT: use the "extern wasm" build (`resolve.conditions` in `vite.config.ts`) and supply the `.wasm` and `.mjs` from the offline cache; otherwise Vite bundles a duplicate 14 MB wasm and the PWA precache fails.
- zxing-wasm defaults to a CDN for its wasm: always call `initBarcodeReader(wasmBuffer)` first.
- Tesseract needs the `tesseract-core-*-lstm.wasm.js` variants in `public/vendor/tesseract/core/`, plus gzipped `eng.traineddata`.
- Region OCR ("Missed one?") runs in the background; it must never overwrite what the user has typed (`session.tsx`).
- Playwright rows hold `<input>`s, so locate rows by `getByLabel('Name of X', { exact: true })`, not by text.
- `pkill -f` and backgrounded servers in the sandbox can kill the shell; start servers with `nohup`.
- In the original sandbox, `huggingface.co`, `cdn.jsdelivr.net`, `cdn.sheetjs.com` and `github.io` were blocked; npm was reachable.

## 12. How to resume

1. Clone `Coder-4847/MedShelf`, check out `claude/exciting-cori-k1d1ib`, `npm install`.
2. Skim sections 3 (deploy quirk), 6 (pipeline) and 10 (next steps) of this file.
3. Run `npm test`, `npm run build`, `npm run test:e2e` to confirm a green baseline before changing anything.
4. For any scan-quality change, re-run `npm run eval:scan` and `npm run eval:scan:thorough` and update `tests/fixtures/scans/RESULTS.md`. Never claim accuracy that was not measured.
5. Deploy by pushing the feature branch only (see section 3).
