import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useSettings } from '../../db/hooks'
import { readRegion, scanPhoto, type ScanProgress } from '../../lib/scan/scanPhoto'
import type { Quad } from '../../lib/ocr/types'
import type { BarcodeHit, Candidate, ScanResult } from '../../lib/scan/types'
import { applyBarcode } from '../../lib/scan/candidates'
import { friendlyDbError } from '../../lib/errors'

export interface SessionPhoto {
  index: number
  blob: Blob
  url: string
  width: number
  height: number
  engine: ScanResult['engine']
  barcodes: BarcodeHit[]
  unlinked: BarcodeHit[]
  totalMs: number
}

interface SessionValue {
  photos: SessionPhoto[]
  candidates: Candidate[]
  scanning: boolean
  progress: ScanProgress | null
  error: string | null
  addFiles: (files: File[] | Blob[]) => Promise<void>
  update: (id: string, patch: Partial<Candidate>) => void
  confirm: (id: string) => void
  discard: (id: string) => void
  restore: (id: string) => void
  confirmAllHigh: () => number
  addManual: (photoIndex: number, region: { x: number; y: number; w: number; h: number }) => string
  attachCode: (photoIndex: number, codeId: number, candidateId: string) => void
  createFromCode: (photoIndex: number, codeId: number) => string
  reset: () => void
  dismissError: () => void
}

const Ctx = createContext<SessionValue | null>(null)

export function useScanSession(): SessionValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useScanSession must be used inside ScanSessionProvider')
  return v
}

let manualCounter = 0

export function ScanSessionProvider({ children }: { children: ReactNode }) {
  const settings = useSettings()
  const [photos, setPhotos] = useState<SessionPhoto[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const photoCount = useRef(0)
  const urls = useRef<string[]>([])
  const photosRef = useRef<SessionPhoto[]>([])
  photosRef.current = photos

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  const addFiles = useCallback(
    async (files: (File | Blob)[]) => {
      // Photos are scanned one after another: the reader is single-threaded WASM.
      for (const file of files) {
        const index = photoCount.current++
        queue.current = queue.current.then(async () => {
          setScanning(true)
          setError(null)
          try {
            const out = await scanPhoto(file, index, settings.scanQuality, setProgress)
            const url = URL.createObjectURL(out.blob)
            urls.current.push(url)
            setPhotos((p) => [
              ...p,
              {
                index,
                blob: out.blob,
                url,
                width: out.width,
                height: out.height,
                engine: out.result.engine,
                barcodes: out.result.barcodes,
                unlinked: out.result.unlinkedCodes,
                totalMs: out.result.timings.totalMs,
              },
            ])
            setCandidates((c) => [...c, ...out.result.candidates])
          } catch (e) {
            setError(e instanceof Error ? e.message : friendlyDbError(e))
          } finally {
            setScanning(false)
            setProgress(null)
          }
        })
      }
      await queue.current
    },
    [settings.scanQuality],
  )

  const update = useCallback((id: string, patch: Partial<Candidate>) => {
    setCandidates((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  const value = useMemo<SessionValue>(
    () => ({
      photos,
      candidates,
      scanning,
      progress,
      error,
      addFiles,
      update,
      confirm: (id) => update(id, { status: 'confirmed' }),
      discard: (id) => update(id, { status: 'discarded' }),
      restore: (id) => update(id, { status: 'pending' }),
      confirmAllHigh: () => {
        let n = 0
        setCandidates((list) =>
          list.map((c) => {
            if (c.status === 'pending' && !c.needsCheck && c.confidence >= 0.8) {
              n++
              return { ...c, status: 'confirmed' as const }
            }
            return c
          }),
        )
        return n
      },
      addManual: (photoIndex, region) => {
        const id = `m${Date.now().toString(36)}${manualCounter++}`
        const quad: Quad = [
          { x: region.x, y: region.y },
          { x: region.x + region.w, y: region.y },
          { x: region.x + region.w, y: region.y + region.h },
          { x: region.x, y: region.y + region.h },
        ]
        const blank: Candidate = {
          id,
          photoIndex,
          name: '',
          strengthOptions: [],
          quantity: 1,
          confidence: 0.1,
          needsCheck: true,
          rawLines: [],
          quad,
          barcodeIds: [],
          source: 'manual',
          status: 'pending',
          seenIn: [photoIndex],
        }
        setCandidates((c) => [...c, blank])
        // Try to read the boxed area; the user can always type over the result.
        const photo = photosRef.current.find((p) => p.index === photoIndex)
        if (photo) {
          // Read the boxed area in the background so the editor opens on the new entry at once.
          void (async () => {
            try {
              const read = await readRegion(photo.blob, region, photoIndex)
              // The read can finish after the user has started typing: never overwrite their input.
              if (read) {
                setCandidates((list) =>
                  list.map((c) => {
                    if (c.id !== id) return c
                    const filled = {
                      ...read,
                      id,
                      quad,
                      source: 'manual' as const,
                      status: c.status,
                    }
                    if (c.name.trim() === '') return filled
                    return {
                      ...filled,
                      name: c.name,
                      strength: c.strength ?? filled.strength,
                      form: c.form ?? filled.form,
                      quantity: c.quantity,
                      needsCheck: true,
                    }
                  }),
                )
              }
            } catch {
              /* leave the blank candidate for manual entry */
            }
          })()
        }
        return id
      },
      attachCode: (photoIndex, codeId, candidateId) => {
        const photo = photosRef.current.find((p) => p.index === photoIndex)
        const code = photo?.barcodes.find((b) => b.id === codeId)
        if (!code) return
        code.linkedTo = candidateId
        setPhotos((p) =>
          p.map((x) =>
            x.index === photoIndex
              ? { ...x, unlinked: x.unlinked.filter((u) => u.id !== codeId) }
              : x,
          ),
        )
        setCandidates((list) =>
          list.map((c) => {
            if (c.id !== candidateId) return c
            const copy = { ...c, barcodeIds: [...c.barcodeIds, codeId] }
            applyBarcode(copy, code)
            return copy
          }),
        )
      },
      createFromCode: (photoIndex, codeId) => {
        const photo = photosRef.current.find((p) => p.index === photoIndex)
        const code = photo?.barcodes.find((b) => b.id === codeId)
        const id = `m${Date.now().toString(36)}${manualCounter++}`
        const xs = code?.polygon.map((p) => p.x) ?? [0]
        const ys = code?.polygon.map((p) => p.y) ?? [0]
        const x0 = Math.min(...xs) - 20
        const y0 = Math.min(...ys) - 20
        const x1 = Math.max(...xs) + 20
        const y1 = Math.max(...ys) + 20
        const c: Candidate = {
          id,
          photoIndex,
          name: '',
          strengthOptions: [],
          quantity: 1,
          confidence: 0.1,
          needsCheck: true,
          rawLines: [],
          quad: [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
          ],
          barcodeIds: [codeId],
          source: 'barcode',
          status: 'pending',
          seenIn: [photoIndex],
        }
        if (code) applyBarcode(c, code)
        setCandidates((list) => [...list, c])
        setPhotos((p) =>
          p.map((x) =>
            x.index === photoIndex
              ? { ...x, unlinked: x.unlinked.filter((u) => u.id !== codeId) }
              : x,
          ),
        )
        return id
      },
      reset: () => {
        urls.current.forEach((u) => URL.revokeObjectURL(u))
        urls.current = []
        photoCount.current = 0
        setPhotos([])
        setCandidates([])
        setError(null)
      },
      dismissError: () => setError(null),
    }),
    [photos, candidates, scanning, progress, error, addFiles, update],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
