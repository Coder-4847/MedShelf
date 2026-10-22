import { useEffect, useId, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Icon } from '../../components/Icon'
import { formatExpiry, parseExpiryInput } from '../../lib/expiry'

/** Text that behaves like plain text until hovered or focused; commits on blur / Enter. */
export function TextCell({
  value,
  onCommit,
  label,
  list,
  placeholder,
  className = '',
}: {
  value: string | undefined
  onCommit: (v: string) => void
  label: string
  list?: string
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  const commit = () => {
    if (draft.trim() !== (value ?? '')) onCommit(draft)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
    if (e.key === 'Escape') {
      setDraft(value ?? '')
      ;(e.target as HTMLInputElement).blur()
    }
  }
  return (
    <input
      className={`cell-input ${className}`}
      value={draft}
      list={list}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKey}
    />
  )
}

export function SelectCell({
  value,
  options,
  onCommit,
  label,
  placeholder = '-',
}: {
  value: string | undefined
  options: string[]
  onCommit: (v: string) => void
  label: string
  placeholder?: string
}) {
  const opts = value && !options.includes(value) ? [value, ...options] : options
  return (
    <select
      className="cell-input pr-1"
      value={value ?? ''}
      aria-label={label}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onCommit(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

/**
 * Accepts dates the way they are printed on boxes: "03/2027", "Mar 2027", "31/03/2027" or ISO.
 * Month-only dates resolve to the last day of the month.
 */
export function ExpiryInput({
  value,
  onCommit,
  label,
  inForm = false,
}: {
  value: string | undefined
  onCommit: (iso: string) => void
  label: string
  inForm?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [invalid, setInvalid] = useState(false)
  const errId = useId()
  useEffect(() => {
    if (!editing) {
      setDraft(value ?? '')
      setInvalid(false)
    }
  }, [value, editing])

  const commit = () => {
    setEditing(false)
    if (draft.trim() === '') {
      if (value) onCommit('')
      return
    }
    const iso = parseExpiryInput(draft)
    if (!iso) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (iso !== value) onCommit(iso)
  }

  return (
    <>
      <input
        className={`${inForm ? 'field' : 'cell-input'} ${invalid ? '!border-exp-fg' : ''}`}
        value={editing || invalid ? draft : formatExpiry(value)}
        placeholder="MM/YYYY"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errId : undefined}
        inputMode="text"
        onFocus={() => {
          setEditing(true)
          setDraft(value ?? '')
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setInvalid(false)
            setDraft(value ?? '')
            setEditing(false)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      {invalid && (
        <span id={errId} role="alert" className="block text-xs text-exp-fg">
          Use MM/YYYY or DD/MM/YYYY
        </span>
      )}
    </>
  )
}

export function QuantityStepper({
  value,
  onChange,
  label,
  compact = false,
}: {
  value: number
  onChange: (n: number) => void
  label: string
  compact?: boolean
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const size = compact ? 'min-h-[36px] min-w-[36px]' : 'min-h-[44px] min-w-[44px]'
  return (
    <div className="inline-flex items-center rounded-[10px] border border-line-strong bg-surface">
      <button
        type="button"
        aria-label={`Decrease quantity of ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
        className={`${size} flex items-center justify-center rounded-l-[9px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40`}
      >
        <Icon name="minus" size={16} />
      </button>
      <input
        inputMode="numeric"
        aria-label={`Quantity of ${label}`}
        value={draft}
        className={`w-11 bg-transparent text-center text-sm font-medium tabular-nums outline-none ${compact ? 'min-h-[36px]' : 'min-h-[44px]'} focus-visible:bg-accent-soft`}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => {
          const n = draft === '' ? value : Math.max(0, parseInt(draft, 10))
          setDraft(String(n))
          if (n !== value) onChange(n)
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <button
        type="button"
        aria-label={`Increase quantity of ${label}`}
        onClick={() => onChange(value + 1)}
        className={`${size} flex items-center justify-center rounded-r-[9px] text-muted hover:bg-surface-2 hover:text-fg`}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}
