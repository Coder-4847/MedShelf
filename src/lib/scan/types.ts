import type { Pt, Quad } from '../ocr/types'

export interface BarcodeHit {
  id: number
  format: string
  text: string
  /** Corner points in the coordinates of the OCR working image. */
  polygon: Pt[]
  gtin?: string
  gtinValid?: boolean
  expiryDate?: string
  batch?: string
  serial?: string
  /** Candidate id this code was attached to (or undefined for unlinked). */
  linkedTo?: string
}

export type CandidateStatus = 'pending' | 'confirmed' | 'discarded'

export interface Candidate {
  id: string
  /** Index of the photo within the session. */
  photoIndex: number
  name: string
  genericName?: string
  strength?: string
  strengthOptions: string[]
  form?: string
  packSize?: string
  category?: string
  expiryDate?: string
  expirySource?: 'barcode' | 'text'
  batch?: string
  gtin?: string
  serial?: string
  quantity: number
  /** 0..1 */
  confidence: number
  /** True whenever the name or details should be double-checked against the package. */
  needsCheck: boolean
  /** Human-readable reason for a warning, shown next to the "Check this" marker. */
  note?: string
  matchedEntry?: string
  matchScore?: number
  /** Raw OCR text lines, top to bottom by size, kept for alias learning and the "what was read" view. */
  rawLines: string[]
  /** The text the name was derived from, used as the learned-alias key. */
  nameSource?: string
  quad: Quad
  barcodeIds: number[]
  source: 'ocr' | 'barcode' | 'manual'
  status: CandidateStatus
  /** Photos (indices) this medicine was seen in after merging. */
  seenIn: number[]
}

export interface ScanResult {
  candidates: Candidate[]
  unlinkedCodes: BarcodeHit[]
  barcodes: BarcodeHit[]
  engine: 'paddleocr' | 'tesseract'
  timings: { totalMs: number; detectMs?: number; readMs?: number; barcodeMs?: number }
  /** Working-image size the quads are expressed in. */
  width: number
  height: number
}
