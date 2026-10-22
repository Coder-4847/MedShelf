// Copies runtime assets that the app loads by URL (ONNX Runtime WASM, Tesseract fallback
// files) from node_modules into public/vendor so the site is fully static and offline-capable.
// The OCR models themselves live in public/models and are committed to the repo.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = (p) => join(root, 'node_modules', p)
const out = (p) => join(root, 'public', 'vendor', p)

function copy(from, to) {
  if (!existsSync(from)) throw new Error(`Missing ${from} - run "npm install" first`)
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to)
}

// ONNX Runtime Web: single-threaded SIMD WASM build (no cross-origin isolation needed).
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
  copy(nm(`onnxruntime-web/dist/${f}`), out(`ort/${f}`))
}

// Tesseract.js fallback: worker script, LSTM cores, English traineddata.
copy(nm('tesseract.js/dist/worker.min.js'), out('tesseract/worker.min.js'))
const coreDir = nm('tesseract.js-core')
for (const f of readdirSync(coreDir)) {
  if (/^tesseract-core-(relaxedsimd-|simd-)?lstm\.(js|wasm)$/.test(f)) {
    copy(join(coreDir, f), out(`tesseract/core/${f}`))
  }
}
copy(
  nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
  out('tesseract/lang/eng.traineddata.gz'),
)
console.log('prepare-assets: vendor files copied to public/vendor')
