import { describe, it } from 'vitest'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { FIXTURES, OUT, loadEngine, loadRaw, workImage, writeOverlay } from './harness'

const which = process.env.EVAL_IMAGE ?? 'scan-01-aligned-easy'
const mode = (process.env.EVAL_MODE ?? 'fast') as 'fast' | 'thorough'

describe('raw ocr', () => {
  it(`reads ${which} (${mode})`, async () => {
    const engine = await loadEngine()
    const raw = await loadRaw(join(FIXTURES, `${which}.jpg`))
    const { img, scale } = workImage(raw, mode === 'fast' ? 1600 : 2000)
    const t0 = performance.now()
    const { regions, timings } = await engine.run(img, mode)
    const lines = [
      `timings ${JSON.stringify(timings)} total ${Math.round(performance.now() - t0)}ms`,
    ]
    for (const r of regions) lines.push(`${r.score.toFixed(2)} ${JSON.stringify(r.text)}`)
    writeFileSync(join(OUT, `${which}-${mode}.txt`), lines.join('\n'))
    await writeOverlay('', img, 1, regions, `${which}-${mode}`)
    void scale
  })
})
