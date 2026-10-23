import type { OcrRequest, OcrResponse } from '../../workers/ocr.worker'
import type { BarcodeRequest, BarcodeResponse } from '../../workers/barcode.worker'
import type { BarcodeHit } from '../scan/types'
import { isReaderCached } from './assets'
import type { OcrTimings } from './engine'
import type { RawImage, ScanMode, TextRegion } from './types'

export type ReaderState =
  | { status: 'idle' }
  | { status: 'downloading'; loaded: number; total: number }
  | { status: 'starting' }
  | { status: 'ready'; backend: 'wasm' }
  | { status: 'failed'; message: string }

const base = import.meta.env.BASE_URL

type Listener = (s: ReaderState) => void

/** Owns the OCR and barcode workers. Models load lazily the first time they are needed. */
class ReaderClient {
  private ocr: Worker | null = null
  private barcode: Worker | null = null
  private state: ReaderState = { status: 'idle' }
  private listeners = new Set<Listener>()
  private ready: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<
    number,
    {
      resolve: (v: never) => void
      reject: (e: Error) => void
      onStage?: (s: Extract<OcrResponse, { type: 'stage' }>) => void
    }
  >()

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  getState() {
    return this.state
  }

  private set(s: ReaderState) {
    this.state = s
    this.listeners.forEach((l) => l(s))
  }

  /** Downloads (once) and starts the reader. Safe to call repeatedly. */
  ensureReady(): Promise<void> {
    if (this.state.status === 'ready') return Promise.resolve()
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL('../../workers/ocr.worker.ts', import.meta.url), {
        type: 'module',
      })
      this.ocr = worker
      this.set({ status: 'downloading', loaded: 0, total: 1 })
      worker.onmessage = (e: MessageEvent<OcrResponse>) => {
        const m = e.data
        if (m.type === 'download') {
          this.set(
            m.loaded >= m.total
              ? { status: 'starting' }
              : { status: 'downloading', loaded: m.loaded, total: m.total },
          )
        } else if (m.type === 'ready') {
          this.set({ status: 'ready', backend: m.backend })
          resolve()
        } else if (m.type === 'error' && m.id === undefined) {
          this.fail(m.message, reject)
        } else if (m.type === 'stage') {
          this.pending.get(m.id)?.onStage?.(m)
        } else if (m.type === 'result') {
          this.pending.get(m.id)?.resolve(m as never)
          this.pending.delete(m.id)
        } else if (m.type === 'error' && m.id !== undefined) {
          this.pending.get(m.id)?.reject(new Error(m.message))
          this.pending.delete(m.id)
        }
      }
      worker.onerror = (e) => this.fail(e.message || 'The reader crashed while starting.', reject)
      worker.postMessage({ type: 'init', base } satisfies OcrRequest)
    })
    this.ready.catch(() => {})
    return this.ready
  }

  private fail(message: string, reject: (e: Error) => void) {
    this.ocr?.terminate()
    this.ocr = null
    this.ready = null
    this.set({ status: 'failed', message })
    this.pending.forEach((p) => p.reject(new Error(message)))
    this.pending.clear()
    reject(new Error(message))
  }

  async runOcr(
    img: RawImage,
    mode: ScanMode,
    onStage?: (stage: 'detecting' | 'reading', done: number, total: number) => void,
  ): Promise<{ regions: TextRegion[]; timings: OcrTimings }> {
    await this.ensureReady()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: never) => void,
        reject,
        onStage: (s) => onStage?.(s.stage, s.done, s.total),
      })
      const buffer = img.data.buffer.slice(
        img.data.byteOffset,
        img.data.byteOffset + img.data.byteLength,
      ) as ArrayBuffer
      this.ocr!.postMessage(
        {
          type: 'run',
          id,
          width: img.width,
          height: img.height,
          buffer,
          mode,
        } satisfies OcrRequest,
        [buffer],
      )
    })
  }

  async runBarcodes(img: RawImage, mode: ScanMode): Promise<BarcodeHit[]> {
    this.barcode ??= new Worker(new URL('../../workers/barcode.worker.ts', import.meta.url), {
      type: 'module',
    })
    const worker = this.barcode
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent<BarcodeResponse>) => {
        if (e.data.id !== id) return
        worker.removeEventListener('message', onMessage)
        if (e.data.type === 'result') resolve(e.data.hits)
        else reject(new Error(e.data.message))
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener(
        'error',
        (e) => reject(new Error(e.message || 'The barcode reader crashed.')),
        { once: true },
      )
      const buffer = img.data.buffer.slice(
        img.data.byteOffset,
        img.data.byteOffset + img.data.byteLength,
      ) as ArrayBuffer
      worker.postMessage(
        {
          type: 'run',
          id,
          width: img.width,
          height: img.height,
          buffer,
          mode,
        } satisfies BarcodeRequest,
        [buffer],
      )
    })
  }

  /** Lets Settings show "available offline" without starting the reader. */
  isCached(): Promise<boolean> {
    return isReaderCached(base)
  }

  reset() {
    this.ocr?.terminate()
    this.ocr = null
    this.ready = null
    this.set({ status: 'idle' })
  }
}

export const reader = new ReaderClient()
