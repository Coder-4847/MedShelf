import { useRef, useState } from 'react'
import { Button, Card, ConfirmDialog, PageHeader, Segmented, useToast } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useSettings } from '../../db/hooks'
import { clearAllData, setSetting } from '../../db/repo'
import { createBackup, restoreBackup } from '../../lib/io/backup'
import { exportFilename } from '../../lib/io/columns'
import { downloadBlob } from '../../lib/io/download'
import { exportInventory } from '../inventory/exporter'
import { ImportDialog } from '../inventory/ImportDialog'
import { friendlyDbError } from '../../lib/errors'
import { ReaderStatus } from '../scan/ReaderStatus'

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card as="section" className="p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </Card>
  )
}

function ListEditor({
  label,
  items,
  onChange,
}: {
  label: string
  items: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (v && !items.some((i) => i.toLowerCase() === v.toLowerCase())) onChange([...items, v])
    setDraft('')
  }
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{label}</h3>
      <ul className="mb-3 flex flex-wrap gap-2">
        {items.map((i) => (
          <li
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pl-3 pr-1 text-sm"
          >
            {i}
            <button
              aria-label={`Remove ${i}`}
              className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded-full text-muted hover:bg-line hover:text-fg"
              onClick={() => onChange(items.filter((x) => x !== i))}
            >
              <Icon name="x" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          className="field"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add to ${label.toLowerCase()}`}
          aria-label={`New entry for ${label}`}
        />
        <Button type="submit" icon="plus">
          Add
        </Button>
      </form>
    </div>
  )
}

export function SettingsPage() {
  const settings = useSettings()
  const toast = useToast()
  const [importing, setImporting] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState<File | null>(null)
  const restoreRef = useRef<HTMLInputElement>(null)

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      toast({ message: friendlyDbError(e) })
    }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Everything is stored on this device only." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Expiry and stock">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Warn about expiry within
            <select
              className="field"
              value={settings.expiryWarningDays}
              onChange={(e) => setSetting('expiryWarningDays', Number(e.target.value))}
            >
              {[30, 45, 60, 90, 120, 180].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Default low-stock threshold
            <input
              className="field"
              inputMode="numeric"
              value={settings.lowStockDefault}
              aria-describedby="low-hint"
              onChange={(e) =>
                setSetting(
                  'lowStockDefault',
                  Math.max(0, parseInt(e.target.value.replace(/\D/g, '') || '0', 10)),
                )
              }
            />
            <span id="low-hint" className="text-xs font-normal text-muted">
              A medicine is "low" when its quantity is at or below this number. You can override it
              per medicine.
            </span>
          </label>
        </Section>

        <Section
          title="Scanning"
          description="Photos are read on this device. Nothing is uploaded."
        >
          <div>
            <div className="mb-2 text-sm font-medium">Scan quality</div>
            <Segmented
              label="Scan quality"
              value={settings.scanQuality}
              onChange={(v) => setSetting('scanQuality', v)}
              options={[
                { value: 'fast', label: 'Fast' },
                { value: 'thorough', label: 'Thorough' },
              ]}
            />
            <p className="mt-2 text-xs text-muted">
              Thorough also scans the photo in overlapping tiles to catch small print. It takes
              longer but finds more.
            </p>
          </div>
          <ReaderStatus />
        </Section>

        <Section
          title="Categories and locations"
          description="Used for filters and for sorting medicines into places."
        >
          <ListEditor
            label="Categories"
            items={settings.categories}
            onChange={(v) => setSetting('categories', v)}
          />
          <ListEditor
            label="Locations"
            items={settings.locations}
            onChange={(v) => setSetting('locations', v)}
          />
        </Section>

        <Section title="Appearance">
          <div>
            <div className="mb-2 text-sm font-medium">Theme</div>
            <Segmented
              label="Theme"
              value={settings.theme}
              onChange={(v) => setSetting('theme', v)}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </div>
        </Section>

        <Section
          title="Export and import"
          description="Spreadsheets for sharing or printing; backup files for moving everything, including photos, to another device."
        >
          <div className="flex flex-wrap gap-2">
            <Button
              icon="download"
              onClick={() =>
                run(async () => {
                  const n = await exportInventory('xlsx', settings.expiryWarningDays)
                  toast({ message: `Exported ${n} medicines to Excel` })
                })
              }
            >
              Export Excel
            </Button>
            <Button
              icon="download"
              onClick={() =>
                run(async () => {
                  const n = await exportInventory('csv', settings.expiryWarningDays)
                  toast({ message: `Exported ${n} medicines to CSV` })
                })
              }
            >
              Export CSV
            </Button>
            <Button icon="upload" onClick={() => setImporting(true)}>
              Import CSV / Excel
            </Button>
          </div>
          <hr className="border-line" />
          <div className="flex flex-wrap gap-2">
            <Button
              icon="file"
              onClick={() =>
                run(async () => {
                  downloadBlob(await createBackup(), exportFilename('json'))
                  toast({ message: 'Backup saved' })
                })
              }
            >
              Back up everything
            </Button>
            <Button icon="refresh" onClick={() => restoreRef.current?.click()}>
              Restore from backup
            </Button>
            <input
              ref={restoreRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Backup file"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) setConfirmRestore(f)
              }}
            />
          </div>
        </Section>

        <Section title="Clear data">
          <p className="text-sm text-muted">
            Removes every medicine, photo, learned name and setting from this device. Export a
            backup first if you might want them again.
          </p>
          <div>
            <Button icon="trash" onClick={() => setConfirmClear(true)}>
              Clear all data
            </Button>
          </div>
        </Section>

        <Card as="section" className="p-5 lg:col-span-2">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-fg">
              <Icon name="shield" size={18} />
            </span>
            <div>
              <h2 className="text-base font-semibold">About and safety notice</h2>
              <p className="mt-1 text-sm" data-testid="safety-notice">
                MedShelf is an organisational tool. It can misread labels. Always verify medicine
                names, strengths, and expiry dates against the physical package. It does not provide
                medical advice.
              </p>
              <p className="mt-3 text-sm text-muted">
                MedShelf works entirely on your device: no account, no tracking, no cloud
                processing. Text is read with PaddleOCR (PP-OCRv4, Apache-2.0) running through ONNX
                Runtime in your browser; barcodes with zxing-cpp. Version 1.0.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <ImportDialog open={importing} onClose={() => setImporting(false)} />

      <ConfirmDialog
        open={confirmClear}
        title="Clear all data?"
        message="This permanently deletes everything MedShelf has stored on this device. It cannot be undone."
        confirmLabel="Clear everything"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() =>
          run(async () => {
            await clearAllData()
            setConfirmClear(false)
            toast({ message: 'All data cleared' })
          })
        }
      />
      <ConfirmDialog
        open={!!confirmRestore}
        title="Restore from backup?"
        message="This replaces everything currently on this device with the contents of the backup."
        confirmLabel="Replace my data"
        onCancel={() => setConfirmRestore(null)}
        onConfirm={() =>
          run(async () => {
            const file = confirmRestore!
            setConfirmRestore(null)
            const r = await restoreBackup(await file.text())
            toast({ message: `Restored ${r.items} medicines` })
          })
        }
      />
    </>
  )
}
