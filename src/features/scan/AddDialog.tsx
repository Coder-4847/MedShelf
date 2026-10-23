import { useMemo, useState } from 'react'
import { Button, Modal, useToast } from '../../components/ui'
import { useItems, useSettings } from '../../db/hooks'
import { db } from '../../db'
import { addItem, adjustQuantity, learnAlias, learnGtin } from '../../db/repo'
import { compress } from '../../lib/image/compress'
import { aliasKey, normalize } from '../../lib/match/text'
import { findInventoryMatch, mergeForInventory, type MergedItem } from '../../lib/scan/session'
import { saveCrop } from '../../lib/scan/scanPhoto'
import type { Candidate } from '../../lib/scan/types'
import { friendlyDbError } from '../../lib/errors'
import type { SessionPhoto } from './session'

type Resolution = 'merge' | 'separate' | 'skip'

export function AddDialog({
  open,
  onClose,
  candidates,
  photos,
  onDone,
}: {
  open: boolean
  onClose: () => void
  candidates: Candidate[]
  photos: SessionPhoto[]
  onDone: () => void
}) {
  const allItems = useItems()
  const items = useMemo(() => allItems ?? [], [allItems])
  const settings = useSettings()
  const toast = useToast()
  const merged = useMemo(() => mergeForInventory(candidates), [candidates])
  const conflicts = useMemo(
    () =>
      merged.map((m) => ({ m, existing: findInventoryMatch(items, m) })).filter((x) => x.existing),
    [merged, items],
  )
  const [resolution, setResolution] = useState<Record<string, Resolution>>({})
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const resolve = (key: string): Resolution => resolution[key] ?? 'merge'

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      let added = 0
      let mergedCount = 0
      for (const m of merged) {
        const existing = findInventoryMatch(items, m)
        const choice = existing ? resolve(m.key) : 'separate'
        if (choice === 'skip') continue
        if (existing && choice === 'merge') {
          await adjustQuantity(existing.id!, m.quantity)
          mergedCount++
        } else {
          const photo = photos.find((p) => p.index === m.primary.photoIndex)
          const photoId = photo ? await saveCrop(photo.blob, m.primary.quad) : undefined
          await addItem({
            name: m.name,
            genericName: m.genericName,
            strength: m.strength,
            form: m.form,
            packSize: m.packSize,
            quantity: m.quantity,
            expiryDate: m.expiryDate,
            batch: m.batch,
            gtin: m.gtin,
            serial: m.serial,
            category: m.category,
            location: location || undefined,
            photoId,
          })
          added++
        }
        await learn(m)
      }
      const first = photos[0]
      let thumbBlob: Blob | undefined
      if (first) {
        try {
          const bmp = await createImageBitmap(first.blob)
          thumbBlob = (await compress(bmp, 160, 0.7)).blob
          bmp.close()
        } catch {
          /* thumbnail is optional */
        }
      }
      await db.scans.add({
        createdAt: Date.now(),
        photoCount: photos.length,
        itemCount: added + mergedCount,
        thumbBlob,
      })
      toast({
        message: `Added ${added} new${mergedCount ? ` and updated ${mergedCount} existing` : ''}.`,
      })
      onDone()
    } catch (e) {
      setError(friendlyDbError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Add to inventory"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button
            variant="primary"
            onClick={run}
            disabled={busy || merged.length === 0}
            data-testid="confirm-add"
          >
            {busy ? 'Adding...' : `Add ${merged.length} medicine${merged.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p>
          You are adding <strong>{merged.length}</strong> confirmed medicine
          {merged.length === 1 ? '' : 's'} ({merged.reduce((n, m) => n + m.quantity, 0)} pack
          {merged.reduce((n, m) => n + m.quantity, 0) === 1 ? '' : 's'}). Anything not confirmed is
          left out.
        </p>
        <label className="flex flex-col gap-1.5 font-medium">
          Where are these stored?{' '}
          <span className="text-xs font-normal text-muted">
            Optional. Applies to all new items.
          </span>
          <select className="field" value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="">Not set</option>
            {settings.locations.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        {conflicts.length > 0 && (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 font-medium">Already in your inventory</legend>
            {conflicts.map(({ m, existing }) => (
              <div key={m.key} className="rounded-xl border border-line p-3" data-testid="conflict">
                <div className="font-medium">
                  {m.name}
                  {m.strength ? ` ${m.strength}` : ''}
                </div>
                <div className="text-xs text-muted">
                  You have {existing!.quantity}. Scanned {m.quantity}.
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  {(
                    [
                      ['merge', `Add ${m.quantity} to the existing row`],
                      ['separate', 'Keep as a separate row (different batch or expiry)'],
                      ['skip', 'Skip'],
                    ] as [Resolution, string][]
                  ).map(([value, label]) => (
                    <label key={value} className="flex min-h-[40px] items-center gap-2">
                      <input
                        type="radio"
                        name={`res-${m.key}`}
                        checked={resolve(m.key) === value}
                        onChange={() => setResolution((r) => ({ ...r, [m.key]: value }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-exp-bg p-3 text-exp-fg">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

/** Teach the matcher: this OCR text means this medicine, and this GTIN is this medicine. */
async function learn(m: MergedItem) {
  const extra = {
    genericName: m.genericName,
    strength: m.strength,
    form: m.form,
    category: m.category,
  }
  for (const c of m.members) {
    if (c.source === 'manual' && !c.nameSource) continue
    const raw = c.nameSource ?? ''
    if (raw && aliasKey(raw) && normalize(aliasKey(raw)) !== normalize(m.name)) {
      // The user corrected (or confirmed) a misread: remember the mapping.
      await learnAlias(raw, m.name, extra)
    } else if (raw && !c.matchedEntry) {
      // An unknown medicine the user confirmed: remember it so it is recognised next time.
      await learnAlias(raw, m.name, extra, { force: true })
    }
  }
  if (m.gtin) await learnGtin(m.gtin, m.name, extra)
}
