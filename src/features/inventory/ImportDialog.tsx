import { useRef, useState } from 'react'
import { Button, Modal, useToast } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { db } from '../../db'
import { addItems, findDuplicate, adjustQuantity } from '../../db/repo'
import { parseCsvItems, rowsToItems, type ImportResult } from '../../lib/io/import'
import { friendlyDbError } from '../../lib/errors'

type DupMode = 'merge' | 'skip' | 'add'

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [result, setResult] = useState<ImportResult | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [dupCount, setDupCount] = useState(0)
  const [dupMode, setDupMode] = useState<DupMode>('merge')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setResult(null)
    setDupCount(0)
    setFileName('')
    setError('')
    setBusy(false)
  }
  const close = () => {
    reset()
    onClose()
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    reset()
    setFileName(file.name)
    try {
      const lower = file.name.toLowerCase()
      let parsed: ImportResult
      if (lower.endsWith('.csv') || file.type === 'text/csv') {
        parsed = parseCsvItems(await file.text())
      } else if (lower.endsWith('.xlsx')) {
        const { parseXlsx } = await import('../../lib/io/xlsx')
        parsed = rowsToItems(await parseXlsx(await file.arrayBuffer()))
      } else {
        throw new Error(
          'Choose a .csv or .xlsx file. Older .xls files should be re-saved as .xlsx.',
        )
      }
      const current = await db.items.toArray()
      setDupCount(parsed.rows.filter((row) => findDuplicate(current, row.item)).length)
      setResult(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.')
    }
  }

  const run = async () => {
    if (!result) return
    setBusy(true)
    try {
      const items = await db.items.toArray()
      const toAdd: typeof result.rows = []
      let merged = 0
      let skipped = 0
      for (const row of result.rows) {
        const dup = findDuplicate(items, row.item)
        if (dup && dupMode === 'merge') {
          await adjustQuantity(dup.id!, row.item.quantity)
          merged++
        } else if (dup && dupMode === 'skip') skipped++
        else toAdd.push(row)
      }
      await addItems(toAdd.map((r) => r.item))
      toast({
        message: `Imported ${toAdd.length} new${merged ? `, merged ${merged}` : ''}${skipped ? `, skipped ${skipped}` : ''}.`,
      })
      close()
    } catch (e) {
      setError(friendlyDbError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import medicines"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!result || result.rows.length === 0 || busy}
            onClick={run}
          >
            {busy ? 'Importing...' : `Import ${result?.rows.length ?? ''}`.trim()}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted">
          Choose a CSV or Excel (.xlsx) file with a header row. Columns are matched by name: Name,
          Strength, Form, Quantity, Expiry, Location, Category, Batch, Notes. Files exported from
          MedShelf import cleanly.
        </p>
        <div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,text/csv"
            className="sr-only"
            id="import-file"
            onChange={(e) => onFile(e.target.files?.[0])}
            data-autofocus
          />
          <label
            htmlFor="import-file"
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-4 font-medium hover:bg-surface-2 focus-within:outline focus-within:outline-2 focus-within:outline-accent"
          >
            <Icon name="upload" size={18} />
            {fileName || 'Choose file'}
          </label>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-exp-bg p-3 text-exp-fg">
            {error}
          </p>
        )}
        {result && (
          <div className="flex flex-col gap-3" aria-live="polite">
            <p>
              Found <strong>{result.rows.length}</strong> medicine
              {result.rows.length === 1 ? '' : 's'}
              {dupCount > 0 && <> ({dupCount} already in your inventory)</>}.
            </p>
            {dupCount > 0 && (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 font-medium">
                  When a medicine is already in your inventory
                </legend>
                {(
                  [
                    ['merge', 'Add the imported quantity to the existing row'],
                    ['skip', 'Skip it'],
                    ['add', 'Add it as a separate row'],
                  ] as [DupMode, string][]
                ).map(([value, label]) => (
                  <label key={value} className="flex min-h-[44px] items-center gap-2">
                    <input
                      type="radio"
                      name="dup"
                      checked={dupMode === value}
                      onChange={() => setDupMode(value)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            )}
            {result.errors.length > 0 && (
              <details className="rounded-lg border border-line p-3">
                <summary className="cursor-pointer font-medium">
                  {result.errors.length} row{result.errors.length === 1 ? '' : 's'} need attention
                </summary>
                <ul className="mt-2 list-disc pl-5 text-muted">
                  {result.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>
                      Line {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {result.unmapped.length > 0 && (
              <p className="text-muted">Ignored columns: {result.unmapped.join(', ')}</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
