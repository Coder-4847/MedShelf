import { describe, it } from 'vitest'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import drugs from '../../src/data/drugs.json'
import { DrugMatcher, type DrugEntry } from '../../src/lib/match/matcher'
import { normalize, ratio } from '../../src/lib/match/text'
import { initBarcodeReader, scanBarcodes } from '../../src/lib/barcode/scan'
import { analyze } from '../../src/lib/scan/pipeline'
import { pointInConvex } from '../../src/lib/ocr/geometry'
import type { Candidate } from '../../src/lib/scan/types'
import {
  FIXTURES,
  OUT,
  ROOT,
  loadEngine,
  loadRaw,
  workImage,
  writeCandidateOverlay,
} from './harness'

interface Truth {
  name: string
  kind: 'generic' | 'brand' | 'invented'
  strength: string | null
  form: string
  pack: string | null
  expiry: string | null
  batch: string | null
  gtin: string | null
  hasDataMatrix: boolean
  quad: number[][]
}

const mode = (process.env.EVAL_MODE ?? 'fast') as 'fast' | 'thorough'
const only = process.env.EVAL_IMAGE

describe('scan accuracy on synthetic fixtures', () => {
  it(`scores all fixtures (${mode})`, async () => {
    const engine = await loadEngine()
    initBarcodeReader(
      readFileSync(join(ROOT, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm')),
    )
    const matcher = new DrugMatcher(drugs as DrugEntry[])
    const ids = readdirSync(FIXTURES)
      .filter((f) => f.endsWith('.jpg'))
      .map((f) => f.replace('.jpg', ''))
      .filter((id) => !only || id.includes(only))

    const totals = {
      boxes: 0,
      detected: 0,
      nameExact: 0,
      nameFuzzy: 0,
      nameWrong: 0,
      silentWrong: 0,
      extra: 0,
      split: 0,
      matchedKnown: 0,
      knownBoxes: 0,
      falseMatchInvented: 0,
      invented: 0,
      strengthOk: 0,
      strengthN: 0,
      formOk: 0,
      formN: 0,
      expiryOk: 0,
      expiryN: 0,
      batchOk: 0,
      batchN: 0,
      gtinOk: 0,
      gtinN: 0,
      dm: 0,
      dmFound: 0,
      dmLinked: 0,
      ms: 0,
    }
    const rows: string[] = []
    const detail: string[] = []

    for (const id of ids) {
      const truth = JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), 'utf8')) as {
        boxes: Truth[]
        width: number
      }
      const raw = await loadRaw(join(FIXTURES, `${id}.jpg`))
      const t0 = performance.now()
      const { img, scale } = workImage(raw, mode === 'fast' ? 1600 : 2000)
      const { regions } = await engine.run(img, mode)
      const codes = await scanBarcodes(raw, mode)
      for (const c of codes) c.polygon = c.polygon.map((p) => ({ x: p.x * scale, y: p.y * scale }))
      const { candidates, unlinkedCodes } = analyze(regions, codes, matcher, 0)
      const ms = performance.now() - t0
      totals.ms += ms

      // Assign each candidate to the ground-truth box containing its centre.
      const gtQuads = truth.boxes.map((b) =>
        b.quad.map(([x, y]) => ({ x: x * scale, y: y * scale })),
      )
      if (process.env.EVAL_DEBUG) {
        await writeCandidateOverlay(
          `${id}-cands`,
          img,
          gtQuads.map((q, i) => ({
            quad: q,
            label: `${truth.boxes[i].name} ${truth.boxes[i].strength ?? ''}`,
          })),
          candidates.map((c) => ({
            quad: c.quad,
            label: `${c.name} ${c.strength ?? ''} ${c.form ?? ''} ${c.confidence.toFixed(2)}`,
            check: c.needsCheck,
          })),
          regions,
        )
        writeFileSync(
          join(OUT, `${id}-cands.json`),
          JSON.stringify(
            candidates.map((c) => ({
              name: c.name,
              strength: c.strength,
              form: c.form,
              exp: c.expiryDate,
              batch: c.batch,
              gtin: c.gtin,
              conf: c.confidence,
              lines: c.rawLines,
            })),
            null,
            1,
          ),
        )
      }
      const assigned = new Map<number, Candidate[]>()
      let extra = 0
      for (const c of candidates) {
        const ctr = {
          x: c.quad.reduce((s, p) => s + p.x, 0) / 4,
          y: c.quad.reduce((s, p) => s + p.y, 0) / 4,
        }
        const gi = gtQuads.findIndex((q) => pointInConvex(ctr, q))
        if (gi < 0) extra++
        else assigned.set(gi, [...(assigned.get(gi) ?? []), c])
      }
      let detected = 0
      let nameOk = 0
      truth.boxes.forEach((b, gi) => {
        totals.boxes++
        const cs = assigned.get(gi) ?? []
        if (b.hasDataMatrix) totals.dm++
        if (cs.length > 1) {
          totals.split++
          detail.push(`${id}  SPLIT    ${b.name} -> ${cs.map((x) => x.name).join(' | ')}`)
        }
        // Judge the best candidate for this box (a split box counts as detected, flagged separately).
        const sim = (c: Candidate) => ratio(normalize(c.name), normalize(b.name))
        const c = [...cs].sort((x, y) => sim(y) - sim(x))[0]
        if (!c) {
          detail.push(`${id}  MISSED   ${b.name} ${b.strength ?? ''}`)
          return
        }
        detected++
        totals.detected++
        const s = sim(c)
        const exact = normalize(c.name) === normalize(b.name)
        if (exact) {
          totals.nameExact++
          nameOk++
        } else if (s >= 0.8) {
          totals.nameFuzzy++
          nameOk++
        } else {
          totals.nameWrong++
          if (!c.needsCheck) totals.silentWrong++
        }
        if (b.kind !== 'invented') {
          totals.knownBoxes++
          if (c.matchedEntry && normalize(c.matchedEntry) === normalize(b.name))
            totals.matchedKnown++
        } else {
          totals.invented++
          if (c.matchedEntry) totals.falseMatchInvented++
        }
        if (b.strength) {
          totals.strengthN++
          if (
            c.strength &&
            c.strength.replace(/\s/g, '').toLowerCase() ===
              b.strength.replace(/\s/g, '').toLowerCase()
          )
            totals.strengthOk++
          else
            detail.push(`${id}  strength ${b.name}: want "${b.strength}" got "${c.strength ?? ''}"`)
        }
        totals.formN++
        if (c.form && c.form.toLowerCase() === b.form.toLowerCase()) totals.formOk++
        else
          detail.push(
            `${id}  form ${b.name}: want "${b.form}" got "${c.form ?? ''}"  lines=${JSON.stringify(c.rawLines.slice(0, 6))}`,
          )
        if (b.expiry) {
          totals.expiryN++
          if (c.expiryDate === b.expiry) totals.expiryOk++
          else if (b.hasDataMatrix)
            detail.push(`${id}  expiry(DM) ${b.name}: want ${b.expiry} got ${c.expiryDate ?? ''}`)
        }
        if (b.batch) {
          totals.batchN++
          if (c.batch === b.batch) totals.batchOk++
        }
        if (b.gtin) {
          totals.gtinN++
          if (c.gtin === b.gtin) totals.gtinOk++
        }
        if (!exact && s < 0.8)
          detail.push(
            `${id}  NAME     ${b.name} -> "${c.name}" (conf ${c.confidence.toFixed(2)}, check=${c.needsCheck})`,
          )
        if (
          b.kind !== 'invented' &&
          !(c.matchedEntry && normalize(c.matchedEntry) === normalize(b.name))
        )
          detail.push(`${id}  NOMATCH  ${b.name} -> "${c.name}" matched=${c.matchedEntry ?? '-'}`)
        if (b.kind === 'invented' && c.matchedEntry)
          detail.push(`${id}  FALSEMATCH ${b.name} -> ${c.matchedEntry}`)
      })
      const dmFound = codes.length
      totals.dmFound += dmFound
      totals.dmLinked += codes.filter((c) => c.linkedTo).length
      totals.extra += extra
      rows.push(
        `| ${id} | ${truth.boxes.length} | ${detected} | ${nameOk} | ${extra} | ${codes.length}/${truth.boxes.filter((b) => b.hasDataMatrix).length} | ${unlinkedCodes.length} | ${(ms / 1000).toFixed(1)} |`,
      )
    }

    const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : 'n/a')
    const report = [
      `# Scan accuracy on synthetic fixtures (${mode} mode)`,
      '',
      '| image | boxes | detected | name OK | extra candidates | DataMatrix read/expected | unlinked codes | seconds |',
      '|---|---|---|---|---|---|---|---|',
      ...rows,
      '',
      `- Boxes detected: ${pct(totals.detected, totals.boxes)}`,
      `- Name correct (exact ${totals.nameExact} + near ${totals.nameFuzzy}): ${pct(totals.nameExact + totals.nameFuzzy, totals.detected)} of detected; exact only ${pct(totals.nameExact, totals.detected)}`,
      `- Wrong names: ${totals.nameWrong}, of which presented WITHOUT a "Check this" flag: ${totals.silentWrong}`,
      `- Known drug-list names (generic/brand) matched to the right entry: ${pct(totals.matchedKnown, totals.knownBoxes)}`,
      `- Invented brands falsely matched to a drug-list entry: ${totals.falseMatchInvented}/${totals.invented}`,
      `- Strength correct: ${pct(totals.strengthOk, totals.strengthN)}`,
      `- Form correct: ${pct(totals.formOk, totals.formN)}`,
      `- Expiry correct (barcode or printed text): ${pct(totals.expiryOk, totals.expiryN)}`,
      `- Batch correct: ${pct(totals.batchOk, totals.batchN)}`,
      `- GTIN correct: ${pct(totals.gtinOk, totals.gtinN)}`,
      `- DataMatrix codes read: ${pct(totals.dmFound, totals.dm)}; linked to a candidate: ${pct(totals.dmLinked, totals.dmFound)}`,
      `- Extra candidates not on any box: ${totals.extra}; boxes split into >1 candidate: ${totals.split}`,
      `- Mean time per photo: ${(totals.ms / ids.length / 1000).toFixed(1)} s (Node WASM, single thread)`,
      '',
      '## Misses and errors',
      ...detail.map((d) => '- ' + d),
    ].join('\n')
    writeFileSync(join(OUT, `report-${mode}.md`), report)
  })
})
