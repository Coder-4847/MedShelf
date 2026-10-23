/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm'
import { fetchCached, READER_FILES } from '../lib/ocr/assets'
import { OcrEngine } from '../lib/ocr/engine'
import type { Ort } from '../lib/ocr/ort'
import { buildDictionary } from '../lib/ocr/recognize'
import type { RawImage, ScanMode } from '../lib/ocr/types'

export type OcrRequest =
  | { type: 'init'; base: string }
  | { type: 'run'; id: number; width: number; height: number; buffer: ArrayBuffer; mode: ScanMode }

export type OcrResponse =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'ready'; backend: 'wasm' }
  | { type: 'error'; id?: number; message: string }
  | { type: 'stage'; id: number; stage: 'detecting' | 'reading'; done: number; total: number }
  | {
      type: 'result'
      id: number
      regions: import('../lib/ocr/types').TextRegion[]
      timings: import('../lib/ocr/engine').OcrTimings
    }

const post = (m: OcrResponse) => (self as unknown as Worker).postMessage(m)

let engine: OcrEngine | null = null

async function init(base: string) {
  let loaded = 0
  const total = READER_FILES.reduce((n, f) => n + f.bytes, 0)
  const fetchFile = (name: string) => {
    const f = READER_FILES.find((x) => x.path === name)!
    return fetchCached(base + f.path, f.bytes, (n) => {
      loaded += n
      post({ type: 'download', loaded: Math.min(loaded, total), total })
    })
  }
  const [det, rec, cls, dictBuf, wasm, glue] = await Promise.all([
    fetchFile('models/ch_PP-OCRv4_det_infer.onnx'),
    fetchFile('models/ch_PP-OCRv4_rec_infer.onnx'),
    fetchFile('models/ch_ppocr_mobile_v2.0_cls_infer.onnx'),
    fetchFile('models/ppocr_keys_v1.txt'),
    fetchFile('vendor/ort/ort-wasm-simd-threaded.wasm'),
    fetchFile('vendor/ort/ort-wasm-simd-threaded.mjs'),
  ])
  // Single-threaded WASM: threads need cross-origin isolation, which static hosting cannot provide.
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  ort.env.wasm.wasmPaths = {
    wasm: URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })),
    mjs: URL.createObjectURL(new Blob([glue], { type: 'text/javascript' })),
  } as never
  const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' as const }
  const [detS, recS, clsS] = await Promise.all([
    ort.InferenceSession.create(new Uint8Array(det), opts),
    ort.InferenceSession.create(new Uint8Array(rec), opts),
    ort.InferenceSession.create(new Uint8Array(cls), opts),
  ])
  const dict = buildDictionary(new TextDecoder().decode(dictBuf))
  engine = new OcrEngine(ort as unknown as Ort, detS, recS, clsS, dict)
  post({ type: 'ready', backend: 'wasm' })
}

self.onmessage = async (e: MessageEvent<OcrRequest>) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      await init(msg.base)
    } else if (msg.type === 'run') {
      if (!engine) throw new Error('The reader is not ready yet.')
      const img: RawImage = {
        data: new Uint8ClampedArray(msg.buffer),
        width: msg.width,
        height: msg.height,
      }
      const { regions, timings } = await engine.run(img, msg.mode, (p) =>
        post({ type: 'stage', id: msg.id, stage: p.stage, done: p.done, total: p.total }),
      )
      post({ type: 'result', id: msg.id, regions, timings })
    }
  } catch (err) {
    post({
      type: 'error',
      id: msg.type === 'run' ? msg.id : undefined,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
