import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Button, Field } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { usePhotoUrl } from '../../components/PhotoThumb'
import { ExpiryInput, QuantityStepper } from './cells'
import { FORMS, type Item, type NewItem, type Settings } from '../../db/types'
import { findDuplicate } from '../../db/repo'
import { loadDrugs } from '../../lib/match/drugs'
import type { DrugEntry } from '../../lib/match/matcher'
import { normalize } from '../../lib/match/text'
import { savePhotoFile } from '../../lib/image/compress'

export const FORM_ID = 'item-form'

export interface ItemFormValues extends NewItem {
  photoId?: number
}

export function ItemForm({
  initial,
  items,
  settings,
  mode,
  onSubmit,
  onAddToExisting,
  onError,
}: {
  initial?: Partial<Item>
  items: Item[]
  settings: Settings
  mode: 'create' | 'edit'
  onSubmit: (values: ItemFormValues) => void
  onAddToExisting?: (existing: Item, qty: number) => void
  onError?: (message: string) => void
}) {
  const [v, setV] = useState<ItemFormValues>({
    name: initial?.name ?? '',
    genericName: initial?.genericName,
    strength: initial?.strength,
    form: initial?.form,
    packSize: initial?.packSize,
    quantity: initial?.quantity ?? 1,
    lowStockThreshold: initial?.lowStockThreshold,
    expiryDate: initial?.expiryDate,
    batch: initial?.batch,
    gtin: initial?.gtin,
    serial: initial?.serial,
    category: initial?.category,
    location: initial?.location,
    notes: initial?.notes,
    photoId: initial?.photoId,
  })
  const [drugs, setDrugs] = useState<DrugEntry[]>([])
  const [touchedSubmit, setTouchedSubmit] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const ids = {
    name: useId(),
    generic: useId(),
    strength: useId(),
    form: useId(),
    pack: useId(),
    qty: useId(),
    low: useId(),
    batch: useId(),
    cat: useId(),
    loc: useId(),
    gtin: useId(),
    serial: useId(),
    notes: useId(),
    exp: useId(),
  }
  const drugListId = useId()
  const strengthListId = useId()
  const photoUrl = usePhotoUrl(v.photoId, 'full')

  useEffect(() => {
    loadDrugs().then(setDrugs)
  }, [])

  const set = <K extends keyof ItemFormValues>(key: K, value: ItemFormValues[K]) =>
    setV((prev) => ({ ...prev, [key]: value }))

  const matchedEntry = useMemo(
    () => drugs.find((d) => normalize(d.name) === normalize(v.name)),
    [drugs, v.name],
  )

  const duplicate = useMemo(
    () =>
      mode === 'create' ? findDuplicate(items, { name: v.name, strength: v.strength }) : undefined,
    [items, mode, v.name, v.strength],
  )

  const onNameChange = (name: string) => {
    const entry = drugs.find((d) => normalize(d.name) === normalize(name))
    setV((prev) => ({
      ...prev,
      name,
      // Pre-fill from the drug list only when the field is still empty, never overwriting input.
      genericName:
        prev.genericName ||
        (entry && entry.generic !== entry.name ? entry.generic : prev.genericName),
      category:
        prev.category ||
        (entry && settings.categories.includes(entry.category) ? entry.category : prev.category),
      form: prev.form || (entry?.forms.length === 1 ? capitalise(entry.forms[0]) : prev.form),
    }))
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouchedSubmit(true)
    if (!v.name.trim()) {
      nameRef.current?.focus()
      return
    }
    onSubmit(v)
  }

  const onPhoto = async (file: File | undefined) => {
    if (!file) return
    try {
      set('photoId', await savePhotoFile(file))
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Could not add the photo.')
    }
  }

  const nameInvalid = touchedSubmit && !v.name.trim()

  return (
    <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex items-center gap-3">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2 text-muted">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={`Photo of ${v.name || 'medicine'}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <Icon name="image" size={28} />
          )}
        </span>
        <div className="flex flex-col gap-1.5">
          <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-surface-2 focus-within:outline focus-within:outline-2 focus-within:outline-accent">
            <Icon name="scan" size={16} />
            {v.photoId ? 'Replace photo' : 'Add photo'}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => onPhoto(e.target.files?.[0])}
            />
          </label>
          {v.photoId && (
            <button
              type="button"
              className="self-start text-xs text-muted underline"
              onClick={() => set('photoId', undefined)}
            >
              Remove photo
            </button>
          )}
        </div>
      </div>

      <Field label="Name *" htmlFor={ids.name}>
        <input
          id={ids.name}
          ref={nameRef}
          className={`field ${nameInvalid ? '!border-exp-fg' : ''}`}
          value={v.name}
          list={drugListId}
          autoComplete="off"
          aria-invalid={nameInvalid || undefined}
          aria-required="true"
          data-autofocus={mode === 'create' ? '' : undefined}
          onChange={(e) => onNameChange(e.target.value)}
        />
        <datalist id={drugListId}>
          {drugs.slice(0, 600).map((d) => (
            <option key={d.name} value={d.name} />
          ))}
        </datalist>
        {nameInvalid && (
          <span role="alert" className="text-xs text-exp-fg">
            Enter the medicine name.
          </span>
        )}
      </Field>

      {duplicate && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-xl border border-line-strong bg-accent-soft p-3 text-sm text-accent-soft-fg"
        >
          <p>
            You already have{' '}
            <strong>
              {duplicate.name}
              {duplicate.strength ? ` ${duplicate.strength}` : ''}
            </strong>{' '}
            (quantity {duplicate.quantity}).
          </p>
          {onAddToExisting && (
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onAddToExisting(duplicate, v.quantity || 1)}
              >
                Add {v.quantity || 1} to existing instead
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Strength" htmlFor={ids.strength} hint="For example 500 mg or 250 mg/5 ml">
          <input
            id={ids.strength}
            className="field"
            value={v.strength ?? ''}
            list={strengthListId}
            onChange={(e) => set('strength', e.target.value)}
          />
          <datalist id={strengthListId}>
            {matchedEntry?.strengths.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Form" htmlFor={ids.form}>
          <select
            id={ids.form}
            className="field"
            value={v.form ?? ''}
            onChange={(e) => set('form', e.target.value)}
          >
            <option value="">Not set</option>
            {(v.form && !(FORMS as readonly string[]).includes(v.form) ? [v.form] : [])
              .concat(FORMS as unknown as string[])
              .map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Generic name" htmlFor={ids.generic}>
          <input
            id={ids.generic}
            className="field"
            value={v.genericName ?? ''}
            onChange={(e) => set('genericName', e.target.value)}
          />
        </Field>
        <Field label="Pack size" htmlFor={ids.pack} hint="For example 24 tablets or 100 ml">
          <input
            id={ids.pack}
            className="field"
            value={v.packSize ?? ''}
            onChange={(e) => set('packSize', e.target.value)}
          />
        </Field>
        <Field label="Quantity (boxes or bottles)">
          <div>
            <QuantityStepper
              value={v.quantity}
              onChange={(n) => set('quantity', n)}
              label={v.name || 'medicine'}
            />
          </div>
        </Field>
        <Field
          label="Low-stock threshold"
          htmlFor={ids.low}
          hint={`Blank uses the default (${settings.lowStockDefault})`}
        >
          <input
            id={ids.low}
            className="field"
            inputMode="numeric"
            value={v.lowStockThreshold ?? ''}
            onChange={(e) => {
              const d = e.target.value.replace(/[^\d]/g, '')
              set('lowStockThreshold', d === '' ? undefined : parseInt(d, 10))
            }}
          />
        </Field>
        <Field
          label="Expiry"
          htmlFor={ids.exp}
          hint="Month and year is fine: 03/2027 means end of March 2027"
        >
          <ExpiryInput
            value={v.expiryDate}
            label="Expiry"
            inForm
            onCommit={(iso) => set('expiryDate', iso || undefined)}
          />
        </Field>
        <Field label="Batch / lot" htmlFor={ids.batch}>
          <input
            id={ids.batch}
            className="field"
            value={v.batch ?? ''}
            onChange={(e) => set('batch', e.target.value)}
          />
        </Field>
        <Field label="Category" htmlFor={ids.cat}>
          <select
            id={ids.cat}
            className="field"
            value={v.category ?? ''}
            onChange={(e) => set('category', e.target.value)}
          >
            <option value="">Not set</option>
            {withCurrent(settings.categories, v.category).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location" htmlFor={ids.loc}>
          <select
            id={ids.loc}
            className="field"
            value={v.location ?? ''}
            onChange={(e) => set('location', e.target.value)}
          >
            <option value="">Not set</option>
            {withCurrent(settings.locations, v.location).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="GTIN (from barcode)" htmlFor={ids.gtin}>
          <input
            id={ids.gtin}
            className="field"
            inputMode="numeric"
            value={v.gtin ?? ''}
            onChange={(e) => set('gtin', e.target.value)}
          />
        </Field>
        <Field label="Serial number" htmlFor={ids.serial}>
          <input
            id={ids.serial}
            className="field"
            value={v.serial ?? ''}
            onChange={(e) => set('serial', e.target.value)}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor={ids.notes}>
        <textarea
          id={ids.notes}
          rows={3}
          className="field"
          value={v.notes ?? ''}
          onChange={(e) => set('notes', e.target.value)}
        />
      </Field>
    </form>
  )
}

function withCurrent(list: string[], current: string | undefined) {
  return current && !list.includes(current) ? [current, ...list] : list
}

function capitalise(s: string) {
  const c = s[0]?.toUpperCase() + s.slice(1)
  return (FORMS as readonly string[]).includes(c) ? c : s
}
