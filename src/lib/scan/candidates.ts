import {
  minAreaRect,
  expandRect,
  lineAngleDiff,
  pointPolyDistance,
  polyDistance,
  quadToRect,
  rectToQuad,
  quadBounds,
} from '../ocr/geometry'
import type { Pt, Quad, TextRegion } from '../ocr/types'
import { extractDetails, extractStrengths } from '../match/extract'
import { CONFIDENT_MATCH, MIN_MATCH, type DrugMatch, type DrugMatcher } from '../match/matcher'
import { LABEL_WORDS, normalize, wordTokens } from '../match/text'
import { clusterLines, splitByAnchors, toLines, type Line } from './group'
import type { BarcodeHit, Candidate } from './types'

let counter = 0
const newId = () => `c${Date.now().toString(36)}${(counter++).toString(36)}`

function clusterQuad(lines: Line[]): Quad {
  const pts: Pt[] = lines.flatMap((l) => l.region.quad)
  const rect = minAreaRect(pts)
  // The package is larger than its text: pad so the outline reads as the box, not just the words.
  return rectToQuad(expandRect(rect, Math.max(6, rect.h * 0.12)))
}

function letters(s: string) {
  return s.replace(/[^A-Za-z]/g, '').length
}

/** Lines tall enough to be a product name rather than fine print. */
function nameLines(lines: Line[]): Line[] {
  const maxH = Math.max(...lines.map((l) => l.rect.h))
  return lines
    .filter((l) => l.rect.h >= maxH * 0.42 && letters(l.region.text) >= 3)
    .sort((a, b) => b.rect.h - a.rect.h)
}

function bestMatchFor(
  lines: Line[],
  matcher: DrugMatcher,
): { line: Line; match: DrugMatch } | null {
  let best: { line: Line; match: DrugMatch; rank: number } | null = null
  for (const line of lines) {
    const m = matcher.match(line.region.text, 1)[0]
    if (!m) continue
    // Prefer taller lines when scores are close: brand names are the biggest text on a box.
    const rank = m.score + Math.min(0.03, line.rect.h / 4000) + line.region.score * 0.02
    if (!best || rank > best.rank) best = { line, match: m, rank }
  }
  return best
}

function cleanName(text: string): string {
  const t = text
    .replace(/[^A-Za-z0-9 &+'-]/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(mg|mcg|ml|g|iu)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t ? t[0].toUpperCase() + t.slice(1) : text.trim()
}

const NUMBER_ONLY = /^\d+(?:[.,]\d+)?$/
const UNIT_ONLY = /^(mg|mcg|[µμu]g|g|ml|iu)$/i

function pairNumberAndUnit(cluster: Line[]): string[] {
  const out: string[] = []
  for (const n of cluster.filter((l) => NUMBER_ONLY.test(l.region.text.trim()))) {
    let best: Line | null = null
    let bestD = Infinity
    for (const u of cluster.filter((l) => UNIT_ONLY.test(l.region.text.trim()))) {
      const d = polyDistance(n.region.quad, u.region.quad)
      if (d < bestD && d <= 1.5 * Math.max(n.rect.h, u.rect.h)) {
        bestD = d
        best = u
      }
    }
    if (best) out.push(`${n.region.text.trim()} ${best.region.text.trim()}`)
  }
  return out
}

function isNameLike(line: Line) {
  const toks = wordTokens(line.region.text)
  return letters(line.region.text) >= 4 && toks.some((t) => !LABEL_WORDS.has(t))
}

/** Stricter than isNameLike: mostly letters, and not a batch/expiry/boilerplate string. */
function isProperName(line: Line) {
  const text = line.region.text
  const alnum = text.replace(/[^A-Za-z0-9]/g, '')
  if (letters(text) < 4 || letters(text) / Math.max(1, alnum.length) < 0.8) return false
  if (/exp|b\.?n\b|batch|lot\b/i.test(text) && /\d/.test(text)) return false
  // Fine print ("Each tablet contains...", "Keep out of reach..."), including its garbled readings.
  if (/^(each|eac|keep|store|ea[a-z]{0,2}h)/i.test(text) || /contains|ingredient/i.test(text))
    return false
  // Run-together boilerplate such as "Keepoutofreachofchildren".
  if (text.length > 12 && /keep|reach|child|contain|ingred|store|below|syrup/i.test(text))
    return false
  return wordTokens(text).some((t) => t.length >= 4 && !LABEL_WORDS.has(t))
}

export function buildCandidate(
  cluster: Line[],
  matcher: DrugMatcher,
  photoIndex: number,
): Candidate | null {
  if (!cluster.length) return null
  const sorted = [...cluster].sort((a, b) => b.rect.h - a.rect.h)
  const rawLines = sorted.map((l) => l.region.text)
  const joined = [...cluster]
    .sort((a, b) => a.rect.cy - b.rect.cy)
    .map((l) => l.region.text)
    .join('\n')

  const nameCandidates = nameLines(cluster)
  const found = bestMatchFor(nameCandidates.length ? nameCandidates : sorted, matcher)

  let name: string
  let confidence: number
  let matchedEntry: string | undefined
  let matchScore: number | undefined
  let nameSource: string | undefined
  let genericName: string | undefined
  let category: string | undefined
  let formHint: string | undefined
  let strengthHints: string[] = []

  if (found && found.match.score >= MIN_MATCH) {
    const { entry, score } = found.match
    name = entry.name
    matchedEntry = entry.name
    matchScore = score
    nameSource = found.line.region.text
    genericName =
      entry.generic && normalize(entry.generic) !== normalize(entry.name)
        ? entry.generic
        : undefined
    category = entry.category || undefined
    const cap = (f: string) => f[0].toUpperCase() + f.slice(1)
    if (entry.forms.length === 1) formHint = cap(entry.forms[0])
    else {
      // A pack volume ("150 ml") on a product sold in one liquid form tells us which form this is.
      const liquids = entry.forms.filter((f) =>
        ['syrup', 'suspension', 'solution', 'drops'].includes(f),
      )
      if (liquids.length === 1 && /\b\d+\s*ml\b/i.test(joined.replace(/(\d)(ml)/gi, '$1 $2')))
        formHint = cap(liquids[0])
    }
    strengthHints = entry.strengths
    confidence = score * (0.72 + 0.28 * found.line.region.score)
    // A fuzzy name match is a guess, however close: never present it as certain.
    if (!found.match.exact) confidence = Math.min(confidence, 0.78)
  } else {
    // Unknown product: use the largest name-like line as a best guess, clearly flagged.
    const guess = nameCandidates.find(isNameLike) ?? sorted.find(isNameLike) ?? sorted[0]
    name = cleanName(guess.region.text)
    nameSource = guess.region.text
    confidence = Math.min(0.5, 0.3 + 0.2 * guess.region.score)
    // A drug named in fine print ("contains Paracetamol 500 mg") is a useful generic suggestion.
    const generic = cluster
      .map((l) => matcher.match(l.region.text, 1)[0])
      .find((m) => m && m.score >= CONFIDENT_MATCH)
    if (generic) {
      genericName = generic.entry.generic || generic.entry.name
      category = generic.entry.category || undefined
    }
  }

  // Strength: look at larger lines first (the headline strength), then everything.
  let strength: string | undefined
  const strengthOptions: string[] = []
  for (const l of sorted) {
    const s = extractStrengths(l.region.text)
    for (const x of s.all) if (!strengthOptions.includes(x)) strengthOptions.push(x)
    if (!strength && s.primary) strength = s.primary
  }
  // Vertical or tightly set text often splits into "250" and "mg" lines: rejoin neighbours.
  for (const text of pairNumberAndUnit(cluster)) {
    const s = extractStrengths(text)
    for (const x of s.all) if (!strengthOptions.includes(x)) strengthOptions.push(x)
    if (!strength && s.primary) strength = s.primary
  }
  const details = extractDetails(joined)
  strength ??= details.strength
  if (strength && matchedEntry && strengthHints.length) {
    const norm = (x: string) => x.replace(/\s+/g, '').toLowerCase()
    if (strengthHints.some((h) => norm(h) === norm(strength!)))
      confidence = Math.min(0.99, confidence + 0.03)
  }
  if (!strength) confidence -= 0.04

  // A second large, distant name-like line suggests two packages were merged into one.
  let note: string | undefined
  const nameLine =
    found && found.match.score >= MIN_MATCH
      ? found.line
      : (nameCandidates.find(isNameLike) ?? sorted[0])
  const rivals = cluster.filter(
    (l) =>
      l !== nameLine &&
      isProperName(l) &&
      l.rect.h >= Math.max(24, nameLine.rect.h * 0.5) &&
      normalize(l.region.text) !== normalize(nameLine.region.text) &&
      polyDistance(l.region.quad, nameLine.region.quad) >
        1.5 * Math.max(l.rect.h, nameLine.rect.h) &&
      !(
        matcher.match(l.region.text, 1)[0]?.entry.generic &&
        normalize(matcher.match(l.region.text, 1)[0].entry.generic) === normalize(name)
      ),
  )
  if (rivals.length) {
    note = 'This area may contain more than one package.'
    confidence = Math.min(confidence, 0.7)
  }
  const needsCheck = confidence < 0.8 || !matchedEntry || !!note

  return {
    id: newId(),
    photoIndex,
    name,
    genericName,
    strength,
    strengthOptions: [...new Set([...strengthOptions, ...strengthHints])].slice(0, 8),
    form: details.form ?? formHint,
    packSize: details.packSize,
    category,
    expiryDate: details.expiryDate,
    expirySource: details.expiryDate ? 'text' : undefined,
    batch: details.batch,
    quantity: 1,
    confidence: Math.max(0.05, Math.min(0.99, confidence)),
    needsCheck,
    note,
    matchedEntry,
    matchScore,
    rawLines,
    nameSource,
    quad: clusterQuad(cluster),
    barcodeIds: [],
    source: 'ocr',
    status: 'pending',
    seenIn: [photoIndex],
  }
}

export interface GroupingConfig {
  gapFactor?: number
}

/** Regions + matcher -> medicine candidates (one per detected package). */
export function groupIntoCandidates(
  regions: TextRegion[],
  matcher: DrugMatcher,
  photoIndex: number,
  cfg: GroupingConfig = {},
): Candidate[] {
  const lines = toLines(regions)
  const clusters = clusterLines(
    lines,
    cfg.gapFactor ? { gapFactor: cfg.gapFactor, maxAngle: (22 * Math.PI) / 180 } : undefined,
  )
  const out: Candidate[] = []
  const parts = attachOrphans(clusters.flatMap((c) => splitCluster(c, matcher)))
  for (const part of parts) {
    // Skip clusters that are only a stray fragment of fine print.
    if (part.length === 1 && (part[0].rect.h < 12 || letters(part[0].region.text) < 4)) continue
    const c = buildCandidate(part, matcher, photoIndex)
    if (c && !isNoise(c, part)) out.push(c)
  }
  return out
}

/**
 * Fine print (batch/expiry lines, "each tablet contains...") often sits too far from the
 * product name to link by proximity alone. A cluster of only small text is attached to the
 * nearest clearly larger cluster whose text runs the same way.
 */
function attachOrphans(parts: Line[][]): Line[][] {
  const info = parts.map((lines) => {
    const maxH = Math.max(...lines.map((l) => l.rect.h))
    const quad = clusterQuad(lines)
    const rect = quadToRect(quad)
    return { lines, maxH, quad, angle: rect.angle, merged: false }
  })
  const hosts = info.filter((i) => i.lines.some(isProperName))
  for (const o of info) {
    if (o.lines.some(isProperName)) continue
    const center = {
      x: o.quad.reduce((a, p) => a + p.x, 0) / 4,
      y: o.quad.reduce((a, p) => a + p.y, 0) / 4,
    }
    const host = hosts
      .filter((h) => h !== o && lineAngleDiff(h.angle, o.angle) < (28 * Math.PI) / 180)
      .map((h) => ({ h, d: pointPolyDistance(center, h.quad) }))
      .filter(({ h, d }) => d <= Math.max(3 * h.maxH, 0.5 * quadToRect(h.quad).w))
      .sort((a, b) => a.d - b.d)[0]
    if (host) {
      host.h.lines.push(...o.lines)
      o.merged = true
    }
  }
  return info.filter((i) => !i.merged).map((i) => i.lines)
}

/**
 * When a cluster contains two packages, separate them. Anchors are lines that name a product:
 * either two different drugs recognised confidently, or two similarly large name-like lines
 * that are far apart (a package has one dominant name).
 */
function splitCluster(cluster: Line[], matcher: DrugMatcher): Line[][] {
  if (cluster.length < 2) return [cluster]
  const named = cluster.filter(isProperName)
  if (named.length < 2) return [cluster]
  const maxH = Math.max(...named.map((l) => l.rect.h))
  const anchors: { line: Line; key: string; known: boolean }[] = []
  const sorted = [...cluster].sort((a, b) => b.rect.h - a.rect.h)
  for (const l of sorted) {
    if (!isProperName(l)) continue
    const m = matcher.match(l.region.text, 1)[0]
    const known = !!m && m.score >= CONFIDENT_MATCH
    // Recognised drugs may be a secondary line; unknown names must be near the top size.
    if (l.rect.h < maxH * (known ? 0.42 : 0.5) || (!known && l.rect.h < 24)) continue
    const key = known ? normalize(m!.entry.name) : normalize(l.region.text)
    const g = known ? normalize(m!.entry.generic) : ''
    const clash = anchors.some((a) => {
      if (a.key === key || a.key.startsWith(key) || key.startsWith(a.key)) return true
      // "Panadol" and its generic "Paracetamol" on one box are one product.
      return (
        known &&
        a.known &&
        g !== '' &&
        (g === a.key ||
          normalize(matcher.match(a.line.region.text, 1)[0]?.entry.generic ?? '') === key)
      )
    })
    if (!clash) anchors.push({ line: l, key, known })
  }
  if (anchors.length < 2) return [cluster]
  // Anchors adjacent to each other are a two-line name (or a misread badge next to the name),
  // not two boxes. Keep recognised drugs first, then taller lines, skipping satellites.
  const ordered = [...anchors].sort(
    (a, b) => Number(b.known) - Number(a.known) || b.line.rect.h - a.line.rect.h,
  )
  const far: typeof anchors = []
  for (const a of ordered) {
    const adjacent = far.some((b) => {
      // Two different recognised drugs are two boxes even when set close together.
      const factor = a.known && b.known ? 0.8 : 1.5
      return (
        polyDistance(a.line.region.quad, b.line.region.quad) <=
        factor * Math.max(a.line.rect.h, b.line.rect.h)
      )
    })
    if (!adjacent) far.push(a)
  }
  if (far.length < 2) return [cluster]
  return splitByAnchors(
    cluster,
    far.map((a) => a.line),
  )
}

/** Drop candidates that are just label boilerplate. */
function isNoise(c: Candidate, lines: Line[]): boolean {
  if (c.matchedEntry) return false
  const best = lines.reduce((m, l) => Math.max(m, l.region.score), 0)
  const hasName = lines.some(isProperName)
  return !hasName || best < 0.5 || c.name.length < 3
}

/**
 * Attach each barcode to the package it sits on. Codes are usually printed in a corner or on a
 * side panel, outside the text block, so a code attaches to the nearest package whose
 * orientation agrees with the code's, within a reach scaled to the package size.
 */
export function attachBarcodes(candidates: Candidate[], codes: BarcodeHit[]): BarcodeHit[] {
  const unlinked: BarcodeHit[] = []
  for (const code of codes) {
    const center: Pt = {
      x: code.polygon.reduce((s, p) => s + p.x, 0) / code.polygon.length,
      y: code.polygon.reduce((s, p) => s + p.y, 0) / code.polygon.length,
    }
    const b = quadBounds(code.polygon)
    const size = Math.max(b.x1 - b.x0, b.y1 - b.y0)
    // A square symbol's orientation is only defined modulo 90 degrees.
    const codeAngle = Math.atan2(
      code.polygon[1].y - code.polygon[0].y,
      code.polygon[1].x - code.polygon[0].x,
    )
    let best: Candidate | null = null
    let bestScore = Infinity
    let bestD = Infinity
    for (const c of candidates) {
      const rect = quadToRect(c.quad)
      const d = pointPolyDistance(center, c.quad)
      const mis = lineAngleDiff(
        ((codeAngle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2),
        ((rect.angle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2),
      )
      const misFold = Math.min(mis, Math.PI / 2 - mis)
      const score = d * (1 + 2 * misFold)
      if (score < bestScore) {
        bestScore = score
        bestD = d
        best = c
      }
    }
    const reach = best ? Math.max(size * 1.6, quadToRect(best.quad).w * 0.35) : 0
    if (best && bestD <= reach) {
      code.linkedTo = best.id
      best.barcodeIds.push(code.id)
      applyBarcode(best, code)
    } else unlinked.push(code)
  }
  return unlinked
}

/** Barcode data is exact, so it overrides OCR guesses for expiry, batch and identifiers. */
export function applyBarcode(c: Candidate, code: BarcodeHit) {
  if (code.expiryDate) {
    c.expiryDate = code.expiryDate
    c.expirySource = 'barcode'
  }
  if (code.batch) c.batch = code.batch
  if (code.gtin) c.gtin = code.gtin
  if (code.serial) c.serial = code.serial
}
