import { useEffect, useState } from 'react'
import { db } from '../db'
import { Icon } from './Icon'

export function usePhotoUrl(photoId: number | undefined, kind: 'thumb' | 'full' = 'thumb') {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!photoId) {
      setUrl(undefined)
      return
    }
    let cancelled = false
    let objectUrl: string | undefined
    db.photos.get(photoId).then((p) => {
      if (!p || cancelled) return
      objectUrl = URL.createObjectURL(kind === 'thumb' ? p.thumbBlob : p.blob)
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photoId, kind])
  return url
}

export function PhotoThumb({
  photoId,
  size = 40,
  alt = '',
}: {
  photoId?: number
  size?: number
  alt?: string
}) {
  const url = usePhotoUrl(photoId, 'thumb')
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2 text-muted"
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <Icon name="pill" size={size * 0.5} />
      )}
    </span>
  )
}
