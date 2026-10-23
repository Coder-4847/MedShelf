import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, FIXTURES, OUT, loadRaw } from './harness'
import { initBarcodeReader, scanBarcodes } from '../../src/lib/barcode/scan'

describe('barcode', () => {
  it('reads GS1 DataMatrix from a fixture', async () => {
    initBarcodeReader(
      readFileSync(join(ROOT, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm')),
    )
    const id = process.env.EVAL_IMAGE ?? 'scan-01-aligned-easy'
    const raw = await loadRaw(join(FIXTURES, `${id}.jpg`))
    const truth = JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), 'utf8'))
    const t0 = performance.now()
    const hits = await scanBarcodes(raw, (process.env.EVAL_MODE as 'fast') ?? 'fast')
    const ms = Math.round(performance.now() - t0)
    const expected = truth.boxes.filter((b: { hasDataMatrix: boolean }) => b.hasDataMatrix).length
    writeFileSync(
      join(OUT, `${id}-barcodes.json`),
      JSON.stringify({ ms, expected, found: hits.length, hits }, null, 1),
    )
    expect(hits.length).toBeGreaterThan(0)
  })
})
