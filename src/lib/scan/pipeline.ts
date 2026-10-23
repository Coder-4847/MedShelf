import type { DrugMatcher } from '../match/matcher'
import type { TextRegion } from '../ocr/types'
import { attachBarcodes, groupIntoCandidates } from './candidates'
import type { BarcodeHit, Candidate } from './types'

/**
 * Turns raw OCR text regions and barcode hits into medicine candidates.
 * Barcode coordinates must already be in the same pixel space as the text regions.
 */
export function analyze(
  regions: TextRegion[],
  barcodes: BarcodeHit[],
  matcher: DrugMatcher,
  photoIndex: number,
  gtinNames: Map<string, { canonical: string }> = new Map(),
): { candidates: Candidate[]; unlinkedCodes: BarcodeHit[] } {
  const candidates = groupIntoCandidates(regions, matcher, photoIndex)
  const unlinkedCodes = attachBarcodes(candidates, barcodes)

  // A GTIN the user has confirmed before identifies the product exactly.
  for (const c of candidates) {
    if (!c.gtin) continue
    const known = gtinNames.get(c.gtin)
    if (known) {
      c.name = known.canonical
      c.matchedEntry = known.canonical
      c.confidence = Math.max(c.confidence, 0.97)
      c.needsCheck = false
    }
  }
  return { candidates, unlinkedCodes }
}
