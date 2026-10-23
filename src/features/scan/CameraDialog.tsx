import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from '../../components/ui'

/** Live camera capture via getUserMedia, with friendly handling of every failure mode. */
export function CameraDialog({
  open,
  onClose,
  onCapture,
}: {
  open: boolean
  onClose: () => void
  onCapture: (blob: Blob) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError('')
    setReady(false)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'Live camera is not available in this browser or context. Use "Take photo" or upload from your gallery instead.',
      )
      return
    }
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 4096 },
          height: { ideal: 3072 },
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play().then(() => setReady(true))
        }
      })
      .catch((e: DOMException) => {
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
          setError(
            'Camera permission was denied. Allow camera access in your browser settings, or use "Take photo" / upload instead.',
          )
        } else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
          setError('No camera was found on this device. You can upload a photo instead.')
        } else if (e.name === 'NotReadableError') {
          setError('The camera is being used by another app. Close it and try again.')
        } else setError('The camera could not be started. You can upload a photo instead.')
      })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [open])

  const capture = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    c.toBlob(
      (b) => {
        if (b) {
          onCapture(b)
          onClose()
        }
      },
      'image/jpeg',
      0.92,
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Take a photo"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="scan" disabled={!ready} onClick={capture}>
            Capture
          </Button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="rounded-lg bg-surface-2 p-4 text-sm">
          {error}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            className="max-h-[60dvh] w-full object-contain"
            aria-label="Camera preview"
          />
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        Lay the boxes flat with labels facing up, in good light and without glare.
      </p>
    </Modal>
  )
}
