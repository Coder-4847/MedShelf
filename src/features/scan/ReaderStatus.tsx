import { useEffect, useState } from 'react'
import { Button, ProgressBar } from '../../components/ui'
import { clearReaderCache, READER_TOTAL_BYTES } from '../../lib/ocr/assets'
import { reader, type ReaderState } from '../../lib/ocr/client'

const MB = (n: number) => `${(n / 1_048_576).toFixed(0)} MB`

/** Settings widget: is the offline reader on this device, and can it be fetched or removed. */
export function ReaderStatus() {
  const [state, setState] = useState<ReaderState>(reader.getState())
  const [cached, setCached] = useState<boolean | null>(null)

  useEffect(() => reader.subscribe(setState), [])
  useEffect(() => {
    void reader.isCached().then(setCached)
  }, [state.status])

  const busy = state.status === 'downloading' || state.status === 'starting'
  return (
    <div className="rounded-xl bg-surface-2 p-4 text-sm" data-testid="reader-status">
      <div className="font-medium">Offline reader</div>
      {busy && (
        <div className="mt-2 flex flex-col gap-2">
          <ProgressBar
            label="Downloading reader"
            value={state.status === 'downloading' ? state.loaded / state.total : 1}
          />
          <span className="text-muted">
            {state.status === 'downloading'
              ? `Downloading reader (one time): ${MB(state.loaded)} of ${MB(state.total)}`
              : 'Starting...'}
          </span>
        </div>
      )}
      {!busy && state.status === 'ready' && (
        <p className="mt-1 text-muted">Ready. Scanning works offline.</p>
      )}
      {!busy && state.status === 'failed' && (
        <p role="alert" className="mt-1 text-muted">
          Could not start: {state.message} Scans will use the basic fallback reader.
        </p>
      )}
      {!busy && state.status === 'idle' && (
        <p className="mt-1 text-muted">
          {cached
            ? 'Downloaded to this device. It starts the first time you scan.'
            : `Not downloaded yet (about ${MB(READER_TOTAL_BYTES)}, one time). It downloads automatically the first time you scan.`}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {state.status !== 'ready' && !busy && (
          <Button
            size="sm"
            icon="download"
            onClick={() => void reader.ensureReady().catch(() => {})}
          >
            {cached ? 'Start reader' : 'Download now'}
          </Button>
        )}
        {(cached || state.status === 'ready') && !busy && (
          <Button
            size="sm"
            onClick={async () => {
              reader.reset()
              await clearReaderCache()
              setCached(false)
            }}
          >
            Remove downloaded reader
          </Button>
        )}
      </div>
    </div>
  )
}
