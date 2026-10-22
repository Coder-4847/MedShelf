import { db } from '../../db'

export interface Compressed {
  blob: Blob
  width: number
  height: number
}

type Source = ImageBitmap | HTMLCanvasElement | OffscreenCanvas

function dims(src: Source): { w: number; h: number } {
  return { w: src.width, h: src.height }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  quality: number,
): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality })
  return new Promise((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode image'))),
      'image/jpeg',
      quality,
    ),
  )
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** Scales so the long edge is at most `maxEdge` and encodes as JPEG. */
export async function compress(src: Source, maxEdge: number, quality: number): Promise<Compressed> {
  const { w, h } = dims(src)
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))
  const canvas = makeCanvas(tw, th)
  const ctx = canvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('Canvas is not available')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, tw, th)
  ctx.drawImage(src as CanvasImageSource, 0, 0, tw, th)
  return { blob: await canvasToBlob(canvas, quality), width: tw, height: th }
}

/** Decodes a user file, honouring EXIF orientation. */
export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('That file could not be read as a photo. Try a JPEG or PNG image.')
  }
}

/** Stores a photo (display size + thumbnail) and returns its id. */
export async function savePhoto(src: Source): Promise<number> {
  const [full, thumb] = await Promise.all([compress(src, 1200, 0.78), compress(src, 220, 0.7)])
  return db.photos.add({
    blob: full.blob,
    thumbBlob: thumb.blob,
    width: full.width,
    height: full.height,
    createdAt: Date.now(),
  })
}

export async function savePhotoFile(file: Blob): Promise<number> {
  const bmp = await decodeImage(file)
  try {
    return await savePhoto(bmp)
  } finally {
    bmp.close()
  }
}
