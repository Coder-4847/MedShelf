import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, PageHeader, StatusChip, useToast } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useSettings } from '../../db/hooks'
import { confidenceLabel } from '../../lib/scan/session'
import { AddDialog } from './AddDialog'
import { CandidateEditor, ConfidenceBadge } from './CandidateEditor'
import { PhotoOverlay } from './PhotoOverlay'
import { useScanSession } from './session'
import { href } from '../../app/router'
import { formatExpiry } from '../../lib/expiry'

export function ReviewPage() {
  const s = useScanSession()
  const settings = useSettings()
  const toast = useToast()
  const [photoIndex, setPhotoIndex] = useState(s.photos[0]?.index ?? 0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showDiscarded, setShowDiscarded] = useState(false)

  const photo = s.photos.find((p) => p.index === photoIndex) ?? s.photos[0]
  const visible = useMemo(
    () => s.candidates.filter((c) => showDiscarded || c.status !== 'discarded'),
    [s.candidates, showDiscarded],
  )
  const onPhoto = visible.filter((c) => c.photoIndex === photo?.index)
  const selected = s.candidates.find((c) => c.id === selectedId) ?? null
  const confirmedCount = s.candidates.filter((c) => c.status === 'confirmed').length
  const highPending = s.candidates.filter(
    (c) => c.status === 'pending' && !c.needsCheck && c.confidence >= 0.8,
  ).length
  const pendingCount = s.candidates.filter((c) => c.status === 'pending').length
  const fallback = s.photos.some((p) => p.engine === 'tesseract')

  // Select the first item needing a decision when the screen opens.
  useEffect(() => {
    if (!selectedId && onPhoto[0]) setSelectedId(onPhoto[0].id)
  }, [onPhoto, selectedId])

  if (!photo) {
    return (
      <Card className="p-8 text-center">
        <p>Nothing to review yet.</p>
        <div className="mt-3">
          <Button
            variant="primary"
            onClick={() => {
              window.location.hash = '/scan'
            }}
          >
            Scan a photo
          </Button>
        </div>
      </Card>
    )
  }

  const next = (fromId: string) => {
    const list = s.candidates.filter((c) => c.status === 'pending' && c.id !== fromId)
    if (list[0]) {
      setSelectedId(list[0].id)
      if (list[0].photoIndex !== photoIndex) setPhotoIndex(list[0].photoIndex)
    }
  }

  const codes = photo.barcodes

  return (
    <>
      <PageHeader
        title="Review"
        subtitle={`${s.candidates.filter((c) => c.status !== 'discarded').length} found · ${confirmedCount} confirmed${pendingCount ? ` · ${pendingCount} to review` : ''}`}
        actions={
          <>
            <Button
              icon="plus"
              onClick={() => {
                window.location.hash = '/scan'
              }}
            >
              Add photo
            </Button>
            <Button
              variant="primary"
              icon="check"
              disabled={confirmedCount === 0}
              onClick={() => setAdding(true)}
              data-testid="add-to-inventory"
            >
              Add {confirmedCount} to inventory
            </Button>
          </>
        }
      />

      {fallback && (
        <div
          role="status"
          className="mb-4 flex items-start gap-3 rounded-xl bg-soon-bg p-3 text-sm text-soon-fg"
        >
          <Icon name="info" size={18} className="mt-0.5 shrink-0" />
          <span>
            The main reader could not run on this device, so the basic fallback reader was used. It
            is less accurate: check every suggestion carefully.
          </span>
        </div>
      )}
      <p className="mb-4 text-xs text-muted">
        Always verify names, strengths and expiry dates against the physical package. MedShelf can
        misread labels.
      </p>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="flex flex-col gap-3 lg:col-span-3">
          {s.photos.length > 1 && (
            <div role="tablist" aria-label="Photos" className="flex gap-2 overflow-x-auto">
              {s.photos.map((p) => (
                <button
                  key={p.index}
                  role="tab"
                  aria-selected={p.index === photo.index}
                  onClick={() => setPhotoIndex(p.index)}
                  className={`min-h-[40px] shrink-0 rounded-full border px-4 text-sm font-medium ${p.index === photo.index ? 'border-accent bg-accent-soft text-accent-soft-fg' : 'border-line-strong bg-surface text-muted'}`}
                >
                  Photo {p.index + 1}
                </button>
              ))}
            </div>
          )}
          <PhotoOverlay
            photo={photo}
            candidates={onPhoto}
            selectedId={selectedId}
            onSelect={setSelectedId}
            drawing={drawing}
            codes={codes}
            onDraw={(region) => {
              setDrawing(false)
              toast({ message: 'Reading that area...' })
              const id = s.addManual(photo.index, region)
              setSelectedId(id)
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button icon="target" aria-pressed={drawing} onClick={() => setDrawing((d) => !d)}>
              {drawing ? 'Cancel' : 'Missed one?'}
            </Button>
            <Button
              icon="check"
              disabled={highPending === 0}
              onClick={() => {
                const n = s.confirmAllHigh()
                toast({
                  message: `Confirmed ${n} high-confidence medicine${n === 1 ? '' : 's'}. Others still need your check.`,
                })
              }}
              data-testid="confirm-all-high"
            >
              Confirm all high-confidence ({highPending})
            </Button>
            <label className="ml-auto flex min-h-[44px] items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--accent)]"
                checked={showDiscarded}
                onChange={(e) => setShowDiscarded(e.target.checked)}
              />
              Show discarded
            </label>
          </div>
          <p className="text-xs text-muted">
            Read in {(photo.totalMs / 1000).toFixed(1)} s ·{' '}
            {photo.engine === 'paddleocr' ? 'PaddleOCR' : 'Tesseract fallback'}
          </p>
        </div>

        <div className="flex flex-col gap-3 lg:col-span-2">
          <Card as="section" className="p-4">
            {selected ? (
              <CandidateEditor
                key={selected.id}
                c={selected}
                settings={settings}
                onChange={(patch) => s.update(selected.id, patch)}
                onConfirm={() => {
                  s.confirm(selected.id)
                  next(selected.id)
                }}
                onDiscard={() => {
                  s.discard(selected.id)
                  next(selected.id)
                }}
                onRestore={() => s.restore(selected.id)}
              />
            ) : (
              <p className="py-8 text-center text-sm text-muted">
                Tap an outlined medicine on the photo to review it.
              </p>
            )}
          </Card>

          {photo.unlinked.length > 0 && (
            <Card as="section" className="p-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <Icon name="barcode" size={16} /> Unlinked barcodes
              </h2>
              <p className="mt-1 text-xs text-muted">
                These codes were read but not matched to a package automatically.
              </p>
              <ul className="mt-3 flex flex-col gap-3">
                {photo.unlinked.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-lg bg-surface-2 p-3 text-sm"
                    data-testid="unlinked-code"
                  >
                    <div className="text-xs text-muted">
                      {[
                        b.gtin && `GTIN ${b.gtin}`,
                        b.expiryDate && `Expiry ${formatExpiry(b.expiryDate)}`,
                        b.batch && `Batch ${b.batch}`,
                      ]
                        .filter(Boolean)
                        .join(' · ') || b.text.slice(0, 40)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <select
                        className="field !min-h-[40px] !w-auto"
                        aria-label="Attach to medicine"
                        value=""
                        onChange={(e) =>
                          e.target.value && s.attachCode(photo.index, b.id, e.target.value)
                        }
                      >
                        <option value="">Attach to...</option>
                        {s.candidates
                          .filter((c) => c.photoIndex === photo.index && c.status !== 'discarded')
                          .map((c, i) => (
                            <option key={c.id} value={c.id}>
                              {i + 1}. {c.name || 'Unnamed'}
                            </option>
                          ))}
                      </select>
                      <Button
                        size="sm"
                        onClick={() => setSelectedId(s.createFromCode(photo.index, b.id))}
                      >
                        New medicine from code
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Card as="section" className="mt-4">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-semibold">All found ({visible.length})</h2>
        </div>
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            Nothing was found. Try a closer, brighter photo, or use “Missed one?” to add medicines
            by hand.
          </p>
        ) : (
          <ul>
            {visible.map((c, i) => (
              <li key={c.id}>
                <button
                  onClick={() => {
                    setSelectedId(c.id)
                    if (c.photoIndex !== photo.index) setPhotoIndex(c.photoIndex)
                  }}
                  aria-current={c.id === selectedId}
                  className={`flex min-h-[56px] w-full items-center gap-3 border-b border-line px-4 py-2 text-left last:border-b-0 hover:bg-surface-2 ${c.id === selectedId ? 'bg-accent-soft/50' : ''}`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fg text-xs font-semibold text-bg">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate font-medium ${c.status === 'discarded' ? 'line-through opacity-60' : ''}`}
                    >
                      {c.name || 'Unnamed'}
                      {c.strength ? ` ${c.strength}` : ''}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {[
                        c.form,
                        c.expiryDate && `Exp ${formatExpiry(c.expiryDate)}`,
                        c.batch && `Batch ${c.batch}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {c.status === 'confirmed' ? (
                    <Badge tone="accent">Confirmed</Badge>
                  ) : c.status === 'discarded' ? (
                    <StatusChip status="none" label="Discarded" />
                  ) : (
                    <ConfidenceBadge c={c} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-4 text-sm text-muted">
        {confidenceLabelHelp(s.candidates.length)}{' '}
        <a className="text-accent underline" href={href('/inventory')}>
          Go to inventory
        </a>
      </p>

      <AddDialog
        open={adding}
        onClose={() => setAdding(false)}
        candidates={s.candidates}
        photos={s.photos}
        onDone={() => {
          setAdding(false)
          s.reset()
          window.location.hash = '/inventory'
        }}
      />
    </>
  )
}

function confidenceLabelHelp(n: number) {
  void confidenceLabel
  return n ? 'Only confirmed medicines are added to your inventory.' : ''
}
