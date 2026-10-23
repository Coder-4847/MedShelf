import type { Pt, Quad } from './types'

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function centroid(pts: Pt[]): Pt {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p.x
    y += p.y
  }
  return { x: x / pts.length, y: y / pts.length }
}

export function signedArea(poly: Pt[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

export const polyArea = (poly: Pt[]) => Math.abs(signedArea(poly))

/** Andrew's monotone chain. Returns the hull in counter-clockwise (y-up) order. */
export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length <= 2) return pts
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

export interface RotRect {
  cx: number
  cy: number
  /** Long side. */
  w: number
  /** Short side. */
  h: number
  /** Direction of the long side in radians, normalised to (-pi/2, pi/2]. */
  angle: number
}

/** Minimum-area bounding rectangle via the hull-edge method. */
export function minAreaRect(points: Pt[]): RotRect {
  const hull = convexHull(points)
  if (hull.length === 0) return { cx: 0, cy: 0, w: 0, h: 0, angle: 0 }
  if (hull.length < 3) {
    const a = hull[0]
    const b = hull[hull.length - 1]
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      w: Math.max(dist(a, b), 1),
      h: 1,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    }
  }
  let best: {
    area: number
    theta: number
    minX: number
    maxX: number
    minY: number
    maxY: number
  } | null = null
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const theta = Math.atan2(b.y - a.y, b.x - a.x)
    const c = Math.cos(theta)
    const s = Math.sin(theta)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const p of hull) {
      const x = p.x * c + p.y * s
      const y = -p.x * s + p.y * c
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const area = (maxX - minX) * (maxY - minY)
    if (!best || area < best.area) best = { area, theta, minX, maxX, minY, maxY }
  }
  const { theta, minX, maxX, minY, maxY } = best!
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const mx = (minX + maxX) / 2
  const my = (minY + maxY) / 2
  let w = maxX - minX
  let h = maxY - minY
  let angle = theta
  if (h > w) {
    ;[w, h] = [h, w]
    angle += Math.PI / 2
  }
  // Normalise to (-pi/2, pi/2] so text direction points rightwards.
  while (angle > Math.PI / 2) angle -= Math.PI
  while (angle <= -Math.PI / 2) angle += Math.PI
  return { cx: mx * c - my * s, cy: mx * s + my * c, w, h, angle }
}

export function rectToQuad(r: RotRect): Quad {
  const ux = Math.cos(r.angle)
  const uy = Math.sin(r.angle)
  const vx = -uy
  const vy = ux
  const hw = r.w / 2
  const hh = r.h / 2
  const p = (a: number, b: number): Pt => ({ x: r.cx + ux * a + vx * b, y: r.cy + uy * a + vy * b })
  return [p(-hw, -hh), p(hw, -hh), p(hw, hh), p(-hw, hh)]
}

export function quadToRect(q: Quad): RotRect {
  const w = dist(q[0], q[1])
  const h = dist(q[0], q[3])
  const c = centroid(q)
  let angle = Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x)
  while (angle > Math.PI / 2) angle -= Math.PI
  while (angle <= -Math.PI / 2) angle += Math.PI
  return { cx: c.x, cy: c.y, w, h, angle }
}

/** Grows a rectangle by `d` on every side (DB "unclip"). */
export function expandRect(r: RotRect, d: number): RotRect {
  return { ...r, w: r.w + 2 * d, h: r.h + 2 * d }
}

export function scaleQuad(q: Quad, sx: number, sy: number = sx, dx = 0, dy = 0): Quad {
  return q.map((p) => ({ x: p.x * sx + dx, y: p.y * sy + dy })) as Quad
}

export function quadBounds(q: Pt[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of q) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x0, y0, x1, y1 }
}

/** Sutherland-Hodgman clip of a polygon by a convex polygon (both any consistent winding). */
export function clipConvex(subject: Pt[], clip: Pt[]): Pt[] {
  const orient = signedArea(clip) >= 0 ? 1 : -1
  let output = subject
  for (let i = 0; i < clip.length && output.length; i++) {
    const a = clip[i]
    const b = clip[(i + 1) % clip.length]
    const inside = (p: Pt) => orient * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= 0
    const intersect = (p: Pt, q: Pt): Pt => {
      const A1 = q.y - p.y
      const B1 = p.x - q.x
      const C1 = A1 * p.x + B1 * p.y
      const A2 = b.y - a.y
      const B2 = a.x - b.x
      const C2 = A2 * a.x + B2 * a.y
      const det = A1 * B2 - A2 * B1
      return det === 0 ? p : { x: (B2 * C1 - B1 * C2) / det, y: (A1 * C2 - A2 * C1) / det }
    }
    const input = output
    output = []
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]
      const prev = input[(j + input.length - 1) % input.length]
      if (inside(cur)) {
        if (!inside(prev)) output.push(intersect(prev, cur))
        output.push(cur)
      } else if (inside(prev)) output.push(intersect(prev, cur))
    }
  }
  return output
}

export function overlap(
  a: Pt[],
  b: Pt[],
): { inter: number; iou: number; overA: number; overB: number } {
  const areaA = polyArea(a)
  const areaB = polyArea(b)
  if (areaA === 0 || areaB === 0) return { inter: 0, iou: 0, overA: 0, overB: 0 }
  const inter = polyArea(clipConvex(a, b))
  return { inter, iou: inter / (areaA + areaB - inter), overA: inter / areaA, overB: inter / areaB }
}

function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function pointInConvex(p: Pt, poly: Pt[]): boolean {
  const orient = signedArea(poly) >= 0 ? 1 : -1
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (orient * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) < 0) return false
  }
  return true
}

/** Minimum distance between two convex polygons (0 when they touch or overlap). */
export function polyDistance(a: Pt[], b: Pt[]): number {
  if (pointInConvex(a[0], b) || pointInConvex(b[0], a)) return 0
  let min = Infinity
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const a1 = a[i]
      const a2 = a[(i + 1) % a.length]
      const b1 = b[j]
      const b2 = b[(j + 1) % b.length]
      min = Math.min(
        min,
        pointSegDist(a1, b1, b2),
        pointSegDist(a2, b1, b2),
        pointSegDist(b1, a1, a2),
        pointSegDist(b2, a1, a2),
      )
    }
  }
  return min
}

/** Difference between two undirected line angles, in [0, pi/2]. */
export function lineAngleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % Math.PI
  if (d > Math.PI / 2) d = Math.PI - d
  return d
}

/** Distance from a point to a convex polygon (0 inside). */
export function pointPolyDistance(p: Pt, poly: Pt[]): number {
  if (pointInConvex(p, poly)) return 0
  let min = Infinity
  for (let i = 0; i < poly.length; i++)
    min = Math.min(min, pointSegDist(p, poly[i], poly[(i + 1) % poly.length]))
  return min
}
