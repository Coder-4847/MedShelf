import { useEffect, useRef, useState } from 'react'
import { Button, Card, PageHeader, ProgressBar } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useRoute } from '../../app/router'
import { CameraDialog } from './CameraDialog'
import { ReviewPage } from './ReviewPage'
import { useScanSession } from './session'
import { useSettings } from '../../db/hooks'

const STAGES = [
  ['finding', 'Finding labels'],
  ['reading', 'Reading text'],
  ['barcodes', 'Reading barcodes'],
  ['matching', 'Matching names'],
] as const

export default function ScanPage() {
  const route = useRoute()
  const session = useScanSession()
  if (route.path === '/scan/review' && session.candidates.length + session.photos.length > 0)
    return <ReviewPage />
  return <CapturePage />
}

function CapturePage() {
  const session = useScanSession()
  const settings = useSettings()
  const [camera, setCamera] = useState(false)
  const takeRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const wasScanning = useRef(false)

  // Go to the review screen as soon as a scan finishes successfully.
  useEffect(() => {
    if (wasScanning.current && !session.scanning && !session.error && session.photos.length > 0) {
      window.location.hash = '/scan/review'
    }
    wasScanning.current = session.scanning
  }, [session.scanning, session.error, session.photos.length])

  const onFiles = (files: FileList | null) => {
    if (files && files.length) void session.addFiles(Array.from(files))
  }
  const p = session.progress
  const stageIndex = p ? STAGES.findIndex(([k]) => k === p.stage) : -1

  return (
    <>
      <PageHeader
        title="Scan medicines"
        subtitle={`Quality: ${settings.scanQuality === 'fast' ? 'Fast' : 'Thorough'}. Photos are read on this device and never uploaded.`}
        actions={
          session.photos.length > 0 && !session.scanning ? (
            <Button
              variant="primary"
              icon="arrowRight"
              onClick={() => {
                window.location.hash = '/scan/review'
              }}
            >
              Review {session.candidates.length} found
            </Button>
          ) : undefined
        }
      />

      {session.error && (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-3 rounded-xl bg-exp-bg p-4 text-sm text-exp-fg"
        >
          <span>{session.error}</span>
          <button className="min-h-[36px] shrink-0 underline" onClick={session.dismissError}>
            Dismiss
          </button>
        </div>
      )}

      {session.scanning ? (
        <Card className="mx-auto max-w-xl p-6">
          <div role="status" aria-live="polite">
            <h2 className="text-lg font-semibold">{p?.label ?? 'Working...'}</h2>
            <p className="mt-1 text-sm text-muted">
              This can take a few seconds. You can keep this tab open while it works.
            </p>
            <div className="mt-4">
              <ProgressBar label="Scan progress" value={p?.fraction ?? 0.02} />
            </div>
            {p?.stage === 'loading' && (
              <p className="mt-3 text-sm text-muted">
                Downloading reader (one time). After this, scanning works offline.
              </p>
            )}
            <ol className="mt-5 flex flex-col gap-2">
              {STAGES.map(([k, label], i) => (
                <li
                  key={k}
                  className={`flex items-center gap-2 text-sm ${i < stageIndex ? 'text-fg' : i === stageIndex ? 'font-semibold text-fg' : 'text-muted'}`}
                  aria-current={i === stageIndex ? 'step' : undefined}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border ${i < stageIndex ? 'border-accent bg-accent text-accent-fg' : i === stageIndex ? 'border-accent text-accent' : 'border-line-strong'}`}
                  >
                    {i < stageIndex ? (
                      <Icon name="check" size={12} />
                    ) : i === stageIndex ? (
                      <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                    ) : null}
                  </span>
                  {label}
                </li>
              ))}
            </ol>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="flex flex-col items-center gap-4 p-8 text-center lg:col-span-3">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-fg">
              <Icon name="scan" size={30} />
            </span>
            <div>
              <h2 className="text-lg font-semibold">
                {session.photos.length ? 'Add another photo' : 'Take or upload a photo'}
              </h2>
              <p className="mt-1 text-sm text-muted">
                Several medicines in one photo works best. Add more photos to scan a bigger
                collection; duplicates are merged.
              </p>
            </div>
            <div className="flex w-full max-w-sm flex-col gap-2">
              <input
                ref={takeRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                aria-label="Take photo"
                onChange={(e) => {
                  onFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <input
                ref={uploadRef}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                aria-label="Upload photos"
                data-testid="upload-input"
                onChange={(e) => {
                  onFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <Button
                variant="primary"
                size="lg"
                icon="scan"
                onClick={() => takeRef.current?.click()}
              >
                Take photo
              </Button>
              <Button size="lg" icon="video" onClick={() => setCamera(true)}>
                Use live camera
              </Button>
              <Button size="lg" icon="image" onClick={() => uploadRef.current?.click()}>
                Upload from gallery
              </Button>
            </div>
          </Card>
          <Card as="section" className="p-6 lg:col-span-2">
            <h2 className="font-semibold">Tips for a good scan</h2>
            <ul className="mt-3 flex flex-col gap-3 text-sm">
              {[
                ['box', 'Lay boxes flat with labels facing up'],
                ['sun', 'Use good light and avoid glare'],
                ['target', 'Get close enough that the text is sharp'],
                ['barcode', 'A visible square barcode (DataMatrix) gives exact expiry and batch'],
              ].map(([icon, text]) => (
                <li key={text} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                    <Icon name={icon as 'box'} size={15} />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">
              MedShelf can misread labels. You will review every suggestion before anything is
              added.
            </p>
          </Card>
        </div>
      )}
      <CameraDialog
        open={camera}
        onClose={() => setCamera(false)}
        onCapture={(b) => void session.addFiles([b])}
      />
    </>
  )
}
