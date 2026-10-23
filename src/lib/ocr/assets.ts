/**
 * Offline-first loading of the heavy reader assets (ONNX models, WASM). Files are fetched once
 * with progress and kept in the Cache API, so later scans start from disk. Works in pages and
 * workers, and does not depend on the service worker being active yet.
 */
const CACHE = 'medshelf-reader-v1'

export interface ReaderFile {
  path: string
  /** Approximate size, used for progress when the server omits Content-Length. */
  bytes: number
}

export const READER_FILES: ReaderFile[] = [
  { path: 'models/ch_PP-OCRv4_det_infer.onnx', bytes: 4_745_517 },
  { path: 'models/ch_PP-OCRv4_rec_infer.onnx', bytes: 10_822_323 },
  { path: 'models/ch_ppocr_mobile_v2.0_cls_infer.onnx', bytes: 578_966 },
  { path: 'models/ppocr_keys_v1.txt', bytes: 26_249 },
  { path: 'vendor/ort/ort-wasm-simd-threaded.wasm', bytes: 14_239_897 },
  { path: 'vendor/ort/ort-wasm-simd-threaded.mjs', bytes: 24_381 },
]

export const READER_TOTAL_BYTES = READER_FILES.reduce((n, f) => n + f.bytes, 0)

export type ProgressFn = (loadedBytes: number, totalBytes: number) => void

export async function fetchCached(
  url: string,
  expectedBytes: number,
  onChunk?: (n: number) => void,
): Promise<ArrayBuffer> {
  let cache: Cache | null
  try {
    cache = await caches.open(CACHE)
    const hit = await cache.match(url)
    if (hit) {
      const buf = await hit.arrayBuffer()
      onChunk?.(buf.byteLength)
      return buf
    }
  } catch {
    cache = null // Cache API unavailable (private mode, insecure context): just fetch every time.
  }
  const res = await fetch(url)
  if (!res.ok || !res.body)
    throw new Error(`Could not download the reader file ${url} (HTTP ${res.status}).`)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
    onChunk?.(value.length)
  }
  const out = new Uint8Array(size)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  if (expectedBytes && size < expectedBytes * 0.5)
    throw new Error(`The reader file ${url} looks incomplete. Check your connection and try again.`)
  try {
    await cache?.put(
      url,
      new Response(out.slice(), { headers: { 'content-type': 'application/octet-stream' } }),
    )
  } catch {
    /* quota exceeded: still usable this session */
  }
  return out.buffer
}

/** True when every reader file is already on this device. */
export async function isReaderCached(base: string): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE)
    const hits = await Promise.all(READER_FILES.map((f) => cache.match(base + f.path)))
    return hits.every(Boolean)
  } catch {
    return false
  }
}

export async function clearReaderCache(): Promise<void> {
  try {
    await caches.delete(CACHE)
  } catch {
    /* ignore */
  }
}
