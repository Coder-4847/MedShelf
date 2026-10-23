/// <reference lib="webworker" />
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { initBarcodeReader, scanBarcodes } from '../lib/barcode/scan'
import type { RawImage, ScanMode } from '../lib/ocr/types'
import type { BarcodeHit } from '../lib/scan/types'

export type BarcodeRequest = {
  type: 'run'
  id: number
  width: number
  height: number
  buffer: ArrayBuffer
  mode: ScanMode
}
export type BarcodeResponse =
  | { type: 'result'; id: number; hits: BarcodeHit[]; ms: number }
  | { type: 'error'; id: number; message: string }

let ready: Promise<void> | null = null

self.onmessage = async (e: MessageEvent<BarcodeRequest>) => {
  const msg = e.data
  try {
    ready ??= fetch(wasmUrl)
      .then((r) => {
        if (!r.ok) throw new Error('Could not load the barcode reader.')
        return r.arrayBuffer()
      })
      .then((buf) => initBarcodeReader(buf))
    await ready
    const t0 = performance.now()
    const img: RawImage = {
      data: new Uint8ClampedArray(msg.buffer),
      width: msg.width,
      height: msg.height,
    }
    const hits = await scanBarcodes(img, msg.mode)
    ;(self as unknown as Worker).postMessage({
      type: 'result',
      id: msg.id,
      hits,
      ms: performance.now() - t0,
    } satisfies BarcodeResponse)
  } catch (err) {
    ready = null
    ;(self as unknown as Worker).postMessage({
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    } satisfies BarcodeResponse)
  }
}
