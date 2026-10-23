import { useEffect, useId, useState } from 'react'
import { Badge, Button, Field } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { ExpiryInput, QuantityStepper } from '../inventory/cells'
import { FORMS, type Settings } from '../../db/types'
import { createMatcher } from '../../lib/match/drugs'
import type { DrugMatcher } from '../../lib/match/matcher'
import { formatExpiry } from '../../lib/expiry'
import { confidenceLabel } from '../../lib/scan/session'
import type { Candidate } from '../../lib/scan/types'

const LABEL = {
  high: 'High confidence',
  medium: 'Check this',
  low: 'Check this: low confidence',
} as const

export function ConfidenceBadge({ c }: { c: Pick<Candidate, 'confidence' | 'needsCheck'> }) {
  const level = confidenceLabel(c)
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${level === 'high' ? 'bg-accent-soft text-accent-soft-fg' : 'bg-soon-bg text-soon-fg'}`}
      data-confidence={level}
    >
      <Icon name={level === 'high' ? 'check' : 'alert'} size={13} />
      {LABEL[level]}
    </span>
  )
}

export function CandidateEditor({
  c,
  settings,
  onChange,
  onConfirm,
  onDiscard,
  onRestore,
}: {
  c: Candidate
  settings: Settings
  onChange: (patch: Partial<Candidate>) => void
  onConfirm: () => void
  onDiscard: () => void
  onRestore: () => void
}) {
  const ids = {
    name: useId(),
    strength: useId(),
    form: useId(),
    pack: useId(),
    batch: useId(),
    category: useId(),
  }
  const [matcher, setMatcher] = useState<DrugMatcher | null>(null)
  const [suggestions, setSuggestions] = useState<{ name: string; score: number }[]>([])

  useEffect(() => {
    void createMatcher().then(setMatcher)
  }, [])

  // "Did you mean": top matches for everything read from this package.
  useEffect(() => {
    if (!matcher) return
    const seen = new Map<string, number>()
    for (const line of c.rawLines.slice(0, 8)) {
      for (const m of matcher.match(line, 3))
        seen.set(m.entry.name, Math.max(seen.get(m.entry.name) ?? 0, m.score))
    }
    setSuggestions(
      [...seen]
        .map(([name, score]) => ({ name, score }))
        .sort((a, b) => b.score - a.score)
        .filter((s) => s.name !== c.name)
        .slice(0, 4),
    )
  }, [matcher, c.rawLines, c.name])

  const applyEntry = (name: string) => {
    const entry = matcher?.findByName(name)
    onChange({
      name,
      matchedEntry: entry?.name,
      genericName: entry && entry.generic !== entry.name ? entry.generic : c.genericName,
      category: entry?.category || c.category,
      strengthOptions: [...new Set([...c.strengthOptions, ...(entry?.strengths ?? [])])].slice(
        0,
        8,
      ),
    })
  }

  const confirmed = c.status === 'confirmed'
  return (
    <div className="flex flex-col gap-4" data-testid="candidate-editor">
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge c={c} />
        {c.source === 'manual' && <Badge>Added by you</Badge>}
        {c.seenIn.length > 1 && <Badge>Seen in {c.seenIn.length} photos</Badge>}
        {confirmed && <Badge tone="accent">Confirmed</Badge>}
        <span className="text-xs text-muted tabular-nums">{Math.round(c.confidence * 100)}%</span>
      </div>
      {c.note && (
        <p role="note" className="rounded-lg bg-soon-bg p-3 text-sm text-soon-fg">
          {c.note}
        </p>
      )}
      {c.needsCheck && !c.note && (
        <p className="text-sm text-muted">
          {c.matchedEntry
            ? 'The name is a close match, not exact.'
            : 'This name is not in the built-in list.'}{' '}
          Compare with the package before confirming.
        </p>
      )}

      <Field label="Medicine name" htmlFor={ids.name}>
        <input
          id={ids.name}
          className="field"
          value={c.name}
          autoComplete="off"
          onChange={(e) => onChange({ name: e.target.value })}
          data-testid="candidate-name"
        />
        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1" aria-label="Suggestions">
            <span className="text-xs text-muted">Did you mean</span>
            {suggestions.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => applyEntry(s.name)}
                className="min-h-[36px] rounded-full border border-line-strong bg-surface px-3 text-sm hover:bg-surface-2"
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Strength" htmlFor={ids.strength}>
          <input
            id={ids.strength}
            className="field"
            value={c.strength ?? ''}
            onChange={(e) => onChange({ strength: e.target.value || undefined })}
          />
          {c.strengthOptions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {c.strengthOptions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChange({ strength: s })}
                  aria-pressed={c.strength === s}
                  className={`min-h-[32px] rounded-full border px-2.5 text-xs ${c.strength === s ? 'border-accent bg-accent-soft text-accent-soft-fg' : 'border-line-strong bg-surface text-muted hover:text-fg'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Form" htmlFor={ids.form}>
          <select
            id={ids.form}
            className="field"
            value={c.form ?? ''}
            onChange={(e) => onChange({ form: e.target.value || undefined })}
          >
            <option value="">Not set</option>
            {(c.form && !(FORMS as readonly string[]).includes(c.form) ? [c.form] : [])
              .concat(FORMS as unknown as string[])
              .map((f) => (
                <option key={f}>{f}</option>
              ))}
          </select>
        </Field>
        <Field label="Pack size" htmlFor={ids.pack}>
          <input
            id={ids.pack}
            className="field"
            value={c.packSize ?? ''}
            onChange={(e) => onChange({ packSize: e.target.value || undefined })}
          />
        </Field>
        <Field label="Quantity">
          <div>
            <QuantityStepper
              value={c.quantity}
              onChange={(n) => onChange({ quantity: Math.max(1, n) })}
              label={c.name || 'medicine'}
            />
          </div>
        </Field>
        <Field
          label="Expiry"
          hint={
            c.expirySource === 'barcode'
              ? 'Read from the barcode: exact.'
              : c.expirySource === 'text'
                ? 'Guessed from printed text. Verify on the package.'
                : 'Not found. Month and year is fine: 03/2027.'
          }
        >
          <ExpiryInput
            value={c.expiryDate}
            label="Expiry"
            inForm
            onCommit={(iso) => onChange({ expiryDate: iso || undefined, expirySource: undefined })}
          />
          {c.expiryDate && <span className="text-xs text-muted">{formatExpiry(c.expiryDate)}</span>}
        </Field>
        <Field label="Batch / lot" htmlFor={ids.batch}>
          <input
            id={ids.batch}
            className="field"
            value={c.batch ?? ''}
            onChange={(e) => onChange({ batch: e.target.value || undefined })}
          />
        </Field>
        <Field label="Category" htmlFor={ids.category}>
          <select
            id={ids.category}
            className="field"
            value={c.category ?? ''}
            onChange={(e) => onChange({ category: e.target.value || undefined })}
          >
            <option value="">Not set</option>
            {(c.category && !settings.categories.includes(c.category) ? [c.category] : [])
              .concat(settings.categories)
              .map((x) => (
                <option key={x}>{x}</option>
              ))}
          </select>
        </Field>
        {(c.gtin || c.serial) && (
          <div className="rounded-lg bg-surface-2 p-3 text-xs text-muted sm:col-span-2">
            <div className="flex items-center gap-1 font-medium text-fg">
              <Icon name="barcode" size={14} /> From barcode
            </div>
            {c.gtin && <div>GTIN {c.gtin}</div>}
            {c.serial && <div>Serial {c.serial}</div>}
          </div>
        )}
      </div>

      {c.rawLines.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">What was read from the package</summary>
          <ul className="mt-2 list-disc pl-5 text-muted">
            {c.rawLines.slice(0, 10).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap gap-2">
        {c.status === 'discarded' ? (
          <Button onClick={onRestore} icon="undo">
            Restore
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              icon="check"
              onClick={onConfirm}
              disabled={!c.name.trim()}
              data-testid="confirm"
            >
              {confirmed ? 'Confirmed' : 'Confirm'}
            </Button>
            <Button icon="trash" onClick={onDiscard}>
              Discard
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
