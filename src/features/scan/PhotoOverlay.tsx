import { useRef, useState, type PointerEvent } from 'react'
import { Icon } from '../../components/Icon'
import type { Candidate } from '../../lib/scan/types'
import type { BarcodeHit } from '../../lib/scan/types'
import type { SessionPhoto } from './session'

interface Drag {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The photo with every detection outlined. Tap an outline to select it. */
export function PhotoOverlay({
  photo,
  candidates,
  selectedId,
  onSelect,
  drawing,
  onDraw,
  codes,
}: {
  photo: SessionPhoto
  candidates: Candidate[]
  selectedId: string | null
  onSelect: (id: string) => void
  drawing: boolean
  onDraw: (region: { x: number; y: number; w: number; h: number }) => void
  codes: BarcodeHit[]
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const toImage = (e: PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const m = svg.getScreenCTM()!.inverse()
    const p = pt.matrixTransform(m)
    return {
      x: Math.max(0, Math.min(photo.width, p.x)),
      y: Math.max(0, Math.min(photo.height, p.y)),
    }
  }

  const onDown = (e: PointerEvent) => {
    if (!drawing) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const p = toImage(e)
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const onMove = (e: PointerEvent) => {
    if (!drag) return
    const p = toImage(e)
    setDrag({ ...drag, x1: p.x, y1: p.y })
  }
  const onUp = () => {
    if (!drag) return
    let x = Math.min(drag.x0, drag.x1)
    let y = Math.min(drag.y0, drag.y1)
    let w = Math.abs(drag.x1 - drag.x0)
    let h = Math.abs(drag.y1 - drag.y0)
    if (w < 24 && h < 24) {
      // A tap rather than a drag: use a sensible package-sized region around the tap.
      w = photo.width * 0.22
      h = w * 0.55
      x = Math.max(0, Math.min(photo.width - w, drag.x0 - w / 2))
      y = Math.max(0, Math.min(photo.height - h, drag.y0 - h / 2))
    }
    setDrag(null)
    onDraw({ x, y, w, h })
  }

  const stroke = Math.max(3, photo.width / 400)
  const font = Math.max(14, photo.width / 70)
  return (
    <div className="relative overflow-hidden rounded-[14px] border border-line bg-surface-2">
      <img
        src={photo.url}
        alt={`Photo ${photo.index + 1} of your medicines`}
        className="block h-auto w-full select-none"
        draggable={false}
      />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${photo.width} ${photo.height}`}
        className={`absolute inset-0 h-full w-full ${drawing ? 'cursor-crosshair touch-none' : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        role="group"
        aria-label="Detected medicines"
      >
        {candidates
          .filter((c) => c.status !== 'discarded')
          .map((c, i) => {
            const selected = c.id === selectedId
            const pts = c.quad.map((p) => `${p.x},${p.y}`).join(' ')
            return (
              <g
                key={c.id}
                onClick={() => !drawing && onSelect(c.id)}
                className={drawing ? '' : 'cursor-pointer'}
                data-testid="detection"
              >
                <polygon
                  points={pts}
                  fill={selected ? 'rgba(15,107,100,0.18)' : 'rgba(255,255,255,0.04)'}
                  stroke="#000"
                  strokeOpacity={0.55}
                  strokeWidth={stroke + 2}
                />
                <polygon
                  points={pts}
                  fill="none"
                  stroke={selected || c.status === 'confirmed' ? '#2fd1c1' : '#ffffff'}
                  strokeWidth={selected ? stroke + 1 : stroke}
                  strokeDasharray={
                    c.status === 'confirmed' ? undefined : `${stroke * 3} ${stroke * 2}`
                  }
                />
                <circle
                  cx={c.quad[0].x}
                  cy={c.quad[0].y}
                  r={font * 0.85}
                  fill={c.status === 'confirmed' ? '#0f6b64' : '#14201f'}
                  stroke="#fff"
                  strokeWidth={2}
                />
                <text
                  x={c.quad[0].x}
                  y={c.quad[0].y + font * 0.35}
                  textAnchor="middle"
                  fontSize={font}
                  fill="#fff"
                  fontWeight={700}
                >
                  {c.status === 'confirmed' ? '✓' : i + 1}
                </text>
                {c.needsCheck && c.status !== 'confirmed' && (
                  <g>
                    <circle
                      cx={c.quad[1].x}
                      cy={c.quad[1].y}
                      r={font * 0.85}
                      fill="#fcefd0"
                      stroke="#7a4300"
                      strokeWidth={2}
                    />
                    <text
                      x={c.quad[1].x}
                      y={c.quad[1].y + font * 0.35}
                      textAnchor="middle"
                      fontSize={font}
                      fill="#7a4300"
                      fontWeight={700}
                    >
                      !
                    </text>
                  </g>
                )}
              </g>
            )
          })}
        {codes.map((b) => (
          <polygon
            key={b.id}
            points={b.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#2fd1c1"
            strokeWidth={stroke}
            strokeDasharray={b.linkedTo ? undefined : `${stroke} ${stroke}`}
          >
            <title>{b.linkedTo ? 'Barcode linked to a medicine' : 'Unlinked barcode'}</title>
          </polygon>
        ))}
        {drag && (
          <rect
            x={Math.min(drag.x0, drag.x1)}
            y={Math.min(drag.y0, drag.y1)}
            width={Math.abs(drag.x1 - drag.x0)}
            height={Math.abs(drag.y1 - drag.y0)}
            fill="rgba(47,209,193,0.2)"
            stroke="#2fd1c1"
            strokeWidth={stroke}
          />
        )}
      </svg>
      {drawing && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-fg/80 px-3 py-2 text-sm text-bg">
          <Icon name="target" size={16} /> Drag a box around the medicine, or tap on it.
        </div>
      )}
    </div>
  )
}
