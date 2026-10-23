import { lineAngleDiff, polyDistance, quadToRect, type RotRect } from '../ocr/geometry'
import type { TextRegion } from '../ocr/types'

export interface Line {
  region: TextRegion
  rect: RotRect
  index: number
}

export function toLines(regions: TextRegion[], minScore = 0.45): Line[] {
  return regions
    .filter((r) => r.score >= minScore && r.text.replace(/[^A-Za-z0-9]/g, '').length >= 2)
    .map((region, index) => ({ region, rect: quadToRect(region.quad), index }))
}

export interface GroupOptions {
  /** Max gap between linked lines, as a multiple of the taller line's text height. */
  gapFactor: number
  /** Max angle difference (radians) between lines of one package. */
  maxAngle: number
}

export const DEFAULT_GROUP: GroupOptions = { gapFactor: 1.6, maxAngle: (22 * Math.PI) / 180 }

/**
 * Single-linkage clustering of text lines by spatial proximity and orientation.
 * Lines on one box face are parallel and close together relative to their size.
 */
export function clusterLines(lines: Line[], opts: GroupOptions = DEFAULT_GROUP): Line[][] {
  const parent = lines.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b)
  }
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]
      const b = lines[j]
      // Near-square lines (a lone "mg", a pill-shaped strength) have an ambiguous reading
      // direction, so their angle is only trusted modulo 90 degrees.
      const squarish = a.rect.w / a.rect.h < 2 || b.rect.w / b.rect.h < 2
      const diff = lineAngleDiff(a.rect.angle, b.rect.angle)
      const effective = squarish ? Math.min(diff, Math.PI / 2 - diff) : diff
      if (effective > opts.maxAngle) continue
      const hMax = Math.max(a.rect.h, b.rect.h)
      const hMin = Math.min(a.rect.h, b.rect.h)
      if (hMax / hMin > 9) continue
      if (polyDistance(a.region.quad, b.region.quad) <= opts.gapFactor * hMax) union(i, j)
    }
  }
  const groups = new Map<number, Line[]>()
  lines.forEach((l, i) => {
    const r = find(i)
    groups.set(r, [...(groups.get(r) ?? []), l])
  })
  return [...groups.values()]
}

/**
 * Splits a cluster that swallowed several packages. `anchors` are lines known to carry
 * different medicine names; every other line goes to the nearest anchor.
 */
export function splitByAnchors(cluster: Line[], anchors: Line[]): Line[][] {
  if (anchors.length < 2) return [cluster]
  const buckets = anchors.map((a) => [a])
  for (const l of cluster) {
    if (anchors.includes(l)) continue
    let best = 0
    let bestD = Infinity
    anchors.forEach((a, i) => {
      // Distance in units of the anchor's own text height, so big labels claim a wider area.
      const d = polyDistance(l.region.quad, a.region.quad) / Math.max(a.rect.h, 12)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    buckets[best].push(l)
  }
  return buckets
}
