import { useEffect, useMemo, useRef, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type Row as TRow,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Modal,
  PageHeader,
  StatusChip,
  useToast,
} from '../../components/ui'
import { Icon } from '../../components/Icon'
import { PhotoThumb } from '../../components/PhotoThumb'
import { ExpiryInput, QuantityStepper, SelectCell, TextCell } from './cells'
import { ItemDrawer } from './ItemDrawer'
import { FORM_ID, ItemForm, type ItemFormValues } from './ItemForm'
import { ImportDialog } from './ImportDialog'
import { exportInventory } from './exporter'
import { useItems, useSettings } from '../../db/hooks'
import {
  addItem,
  adjustQuantity,
  bulkUpdate,
  deleteItems,
  markDisposed,
  purgeOrphanPhotos,
  restoreItems,
  updateItem,
} from '../../db/repo'
import { FORMS, type Item, type Settings } from '../../db/types'
import {
  daysUntil,
  expiryStatus,
  formatExpiry,
  isLowStock,
  STATUS_LABEL,
  type ExpiryStatus,
} from '../../lib/expiry'
import { friendlyDbError } from '../../lib/errors'
import { useIsDesktop, useRoute } from '../../app/router'

interface Row extends Item {
  _status: ExpiryStatus
  _low: boolean
  _tags: string[]
  _search: string
}

type View = 'active' | 'expired' | 'soon' | 'low' | 'disposed' | 'all'

const VIEW_LABEL: Record<View, string> = {
  active: 'Active',
  expired: 'Expired',
  soon: 'Expiring soon',
  low: 'Low stock',
  disposed: 'Disposed',
  all: 'Everything',
}

const COLUMN_LABEL: Record<string, string> = {
  photo: 'Photo',
  name: 'Name',
  strength: 'Strength',
  form: 'Form',
  quantity: 'Quantity',
  expiryDate: 'Expiry',
  location: 'Location',
  category: 'Category',
  batch: 'Batch',
  notes: 'Notes',
}

const COL_STORAGE = 'medshelf-columns'

// Batch and notes start hidden so the default table fits; the Columns menu brings them back.
const DEFAULT_VISIBILITY: VisibilityState = { batch: false, notes: false }

function loadVisibility(): VisibilityState {
  try {
    const stored = localStorage.getItem(COL_STORAGE)
    return stored ? (JSON.parse(stored) as VisibilityState) : DEFAULT_VISIBILITY
  } catch {
    return DEFAULT_VISIBILITY
  }
}

function buildRows(items: Item[], settings: Settings): Row[] {
  return items.map((i) => {
    const status = expiryStatus(i.expiryDate, settings.expiryWarningDays)
    const low =
      i.status === 'active' && isLowStock(i.quantity, i.lowStockThreshold, settings.lowStockDefault)
    const tags =
      i.status === 'disposed' ? ['disposed'] : ['active', status, ...(low ? ['low'] : [])]
    return {
      ...i,
      _status: status,
      _low: low,
      _tags: tags,
      _search: [
        i.name,
        i.genericName,
        i.strength,
        i.form,
        i.batch,
        i.notes,
        i.category,
        i.location,
        i.gtin,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
    }
  })
}

function expirySort(a: TRow<Row>, b: TRow<Row>) {
  const x = a.original.expiryDate
  const y = b.original.expiryDate
  if (!x && !y) return 0
  if (!x) return 1
  if (!y) return -1
  return x < y ? -1 : x > y ? 1 : 0
}

export function InventoryPage() {
  const items = useItems()
  const settings = useSettings()
  const toast = useToast()
  const route = useRoute()
  const isDesktop = useIsDesktop()

  const initialView = (route.params.get('view') as View) || 'active'
  const [view, setView] = useState<View>(initialView in VIEW_LABEL ? initialView : 'active')
  const [category, setCategory] = useState(route.params.get('category') ?? '')
  const [location, setLocation] = useState(route.params.get('location') ?? '')
  const [search, setSearch] = useState('')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }])
  const [visibility, setVisibility] = useState<VisibilityState>(loadVisibility)
  const [selection, setSelection] = useState<RowSelectionState>({})
  const [openId, setOpenId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)

  // Dashboard links such as #/inventory?view=expired drive the filters.
  useEffect(() => {
    const v = route.params.get('view') as View | null
    if (v && v in VIEW_LABEL) setView(v)
  }, [route.params])

  useEffect(() => {
    try {
      localStorage.setItem(COL_STORAGE, JSON.stringify(visibility))
    } catch {
      /* ignore */
    }
  }, [visibility])

  const rows = useMemo(() => buildRows(items ?? [], settings), [items, settings])

  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const f: ColumnFiltersState = []
    if (view !== 'all') f.push({ id: '_view', value: view })
    if (category) f.push({ id: 'category', value: category })
    if (location) f.push({ id: 'location', value: location })
    return f
  }, [view, category, location])

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      toast({ message: friendlyDbError(e) })
    }
  }
  const patch = (id: number | undefined, changes: Partial<Item>) =>
    id && guard(() => updateItem(id, changes))

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: 'select',
        enableSorting: false,
        enableHiding: false,
        header: ({ table }) => (
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            aria-label="Select all visible medicines"
            checked={table.getIsAllRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomeRowsSelected()
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            aria-label={`Select ${row.original.name}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      },
      {
        id: 'photo',
        header: 'Photo',
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={`Open details for ${row.original.name}`}
            onClick={() => setOpenId(row.original.id!)}
            className="rounded-lg"
          >
            <PhotoThumb photoId={row.original.photoId} size={40} />
          </button>
        ),
      },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <div className="flex min-w-[10rem] items-center gap-1">
            <TextCell
              value={row.original.name}
              label={`Name of ${row.original.name}`}
              onCommit={(v) => v.trim() && patch(row.original.id, { name: v })}
              className="font-medium"
            />
            <IconButton
              icon="chevronRight"
              label={`Open details for ${row.original.name}`}
              size={16}
              className="!min-h-[36px] !min-w-[36px] text-muted"
              onClick={() => setOpenId(row.original.id!)}
            />
          </div>
        ),
      },
      {
        accessorKey: 'strength',
        header: 'Strength',
        cell: ({ row }) => (
          <TextCell
            value={row.original.strength}
            label={`Strength of ${row.original.name}`}
            onCommit={(v) => patch(row.original.id, { strength: v })}
          />
        ),
      },
      {
        accessorKey: 'form',
        header: 'Form',
        cell: ({ row }) => (
          <div className="min-w-[6.5rem]">
            <SelectCell
              value={row.original.form}
              options={[...FORMS]}
              label={`Form of ${row.original.name}`}
              onCommit={(v) => patch(row.original.id, { form: v })}
            />
          </div>
        ),
      },
      {
        accessorKey: 'quantity',
        header: 'Qty',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <QuantityStepper
              compact
              value={row.original.quantity}
              label={row.original.name}
              onChange={(n) =>
                guard(() => adjustQuantity(row.original.id!, n - row.original.quantity))
              }
            />
            {row.original._low && <Badge>Low</Badge>}
          </div>
        ),
      },
      {
        accessorKey: 'expiryDate',
        header: 'Expiry',
        sortingFn: expirySort,
        cell: ({ row }) => (
          <div className="flex min-w-[11rem] flex-col gap-1">
            <ExpiryInput
              value={row.original.expiryDate}
              label={`Expiry of ${row.original.name}`}
              onCommit={(iso) => patch(row.original.id, { expiryDate: iso || undefined })}
            />
            {row.original.status === 'active' ? (
              <div className="px-2">
                <StatusChip status={row.original._status} />
              </div>
            ) : (
              <div className="px-2">
                <StatusChip status="none" label="Disposed" />
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'location',
        header: 'Location',
        filterFn: (row, id, value) => row.getValue(id) === value,
        cell: ({ row }) => (
          <div className="min-w-[8rem]">
            <SelectCell
              value={row.original.location}
              options={settings.locations}
              label={`Location of ${row.original.name}`}
              onCommit={(v) => patch(row.original.id, { location: v })}
            />
          </div>
        ),
      },
      {
        accessorKey: 'category',
        header: 'Category',
        filterFn: (row, id, value) => row.getValue(id) === value,
        cell: ({ row }) => (
          <div className="min-w-[8rem]">
            <SelectCell
              value={row.original.category}
              options={settings.categories}
              label={`Category of ${row.original.name}`}
              onCommit={(v) => patch(row.original.id, { category: v })}
            />
          </div>
        ),
      },
      {
        accessorKey: 'batch',
        header: 'Batch',
        cell: ({ row }) => (
          <TextCell
            value={row.original.batch}
            label={`Batch of ${row.original.name}`}
            onCommit={(v) => patch(row.original.id, { batch: v })}
          />
        ),
      },
      {
        accessorKey: 'notes',
        header: 'Notes',
        cell: ({ row }) => (
          <TextCell
            value={row.original.notes}
            label={`Notes for ${row.original.name}`}
            onCommit={(v) => patch(row.original.id, { notes: v })}
          />
        ),
      },
      {
        id: '_view',
        accessorFn: (r) => r._tags,
        enableHiding: false,
        filterFn: (row, id, value) => (row.getValue(id) as string[]).includes(value),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.locations, settings.categories],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting,
      columnVisibility: { ...visibility, _view: false },
      rowSelection: selection,
      columnFilters,
      globalFilter: search,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: (u) =>
      setVisibility((prev) => (typeof u === 'function' ? u(prev) : u)),
    onRowSelectionChange: setSelection,
    getRowId: (r) => String(r.id),
    globalFilterFn: (row, _id, value: string) =>
      row.original._search.includes(String(value).toLowerCase().trim()),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: false,
  })

  const visibleRows = table.getRowModel().rows
  const selectedIds = table.getSelectedRowModel().rows.map((r) => r.original.id!)
  const openItem = openId ? ((items ?? []).find((i) => i.id === openId) ?? null) : null

  const doDelete = async (ids: number[]) => {
    const removed = await deleteItems(ids)
    setSelection({})
    setOpenId(null)
    setTimeout(() => void purgeOrphanPhotos(), 12_000)
    toast({
      message: `Deleted ${removed.length} medicine${removed.length === 1 ? '' : 's'}`,
      action: { label: 'Undo', onClick: () => void restoreItems(removed) },
    })
  }

  const hasFilters = !!(search || category || location || view !== 'active')
  const counts = useMemo(() => {
    const c: Record<View, number> = {
      active: 0,
      expired: 0,
      soon: 0,
      low: 0,
      disposed: 0,
      all: rows.length,
    }
    for (const r of rows) for (const t of r._tags) if (t in c) c[t as View]++
    return c
  }, [rows])

  const onCreate = async (values: ItemFormValues) => {
    try {
      await addItem(values)
      setAdding(false)
      toast({ message: `Added ${values.name}` })
    } catch (e) {
      toast({ message: friendlyDbError(e) })
    }
  }

  const doExport = async (kind: 'xlsx' | 'csv') => {
    setExportOpen(false)
    try {
      const n = await exportInventory(kind, settings.expiryWarningDays)
      toast({ message: `Exported ${n} medicine${n === 1 ? '' : 's'} to ${kind.toUpperCase()}` })
    } catch (e) {
      toast({ message: friendlyDbError(e) })
    }
  }

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Inventory"
          subtitle={
            items
              ? `${counts.active} active medicine${counts.active === 1 ? '' : 's'}`
              : 'Loading...'
          }
          actions={
            <>
              <div className="relative">
                <Button
                  icon="download"
                  onClick={() => setExportOpen((o) => !o)}
                  aria-expanded={exportOpen}
                  aria-haspopup="menu"
                >
                  Export
                </Button>
                {exportOpen && (
                  <Menu onClose={() => setExportOpen(false)}>
                    <button role="menuitem" className="menu-item" onClick={() => doExport('xlsx')}>
                      Excel (.xlsx)
                    </button>
                    <button role="menuitem" className="menu-item" onClick={() => doExport('csv')}>
                      CSV
                    </button>
                  </Menu>
                )}
              </div>
              <Button icon="upload" onClick={() => setImporting(true)}>
                Import
              </Button>
              <Button icon="print" onClick={() => window.print()} className="max-sm:!hidden">
                Print
              </Button>
              <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
                Add medicine
              </Button>
            </>
          }
        />

        {/* Toolbar */}
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <Icon
                name="search"
                size={18}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                type="search"
                className="field !pl-10"
                placeholder="Search name, batch, notes..."
                aria-label="Search inventory"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="field !w-[calc(50%-0.25rem)] sm:!w-auto"
              aria-label="Filter by category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {[
                ...new Set([
                  ...settings.categories,
                  ...(rows.map((r) => r.category).filter(Boolean) as string[]),
                ]),
              ].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="field !w-[calc(50%-0.25rem)] sm:!w-auto"
              aria-label="Filter by location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              <option value="">All locations</option>
              {[
                ...new Set([
                  ...settings.locations,
                  ...(rows.map((r) => r.location).filter(Boolean) as string[]),
                ]),
              ].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="relative hidden md:block">
              <Button
                icon="columns"
                onClick={() => setColumnsOpen((o) => !o)}
                aria-expanded={columnsOpen}
              >
                Columns
              </Button>
              {columnsOpen && (
                <Menu onClose={() => setColumnsOpen(false)} align="right">
                  <fieldset className="p-2">
                    <legend className="sr-only">Visible columns</legend>
                    {table
                      .getAllLeafColumns()
                      .filter((c) => c.id in COLUMN_LABEL)
                      .map((c) => (
                        <label
                          key={c.id}
                          className="flex min-h-[40px] items-center gap-2 px-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[var(--accent)]"
                            checked={c.getIsVisible()}
                            disabled={c.id === 'name'}
                            onChange={c.getToggleVisibilityHandler()}
                          />
                          {COLUMN_LABEL[c.id]}
                        </label>
                      ))}
                  </fieldset>
                </Menu>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Status filter">
            {(['active', 'expired', 'soon', 'low', 'disposed', 'all'] as View[]).map((v) => (
              <button
                key={v}
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`min-h-[40px] rounded-full border px-3.5 text-sm font-medium transition-colors ${
                  view === v
                    ? 'border-accent bg-accent-soft text-accent-soft-fg'
                    : 'border-line-strong bg-surface text-muted hover:text-fg'
                }`}
              >
                {VIEW_LABEL[v]} <span className="tabular-nums opacity-70">{counts[v]}</span>
              </button>
            ))}
            {hasFilters && (
              <button
                className="min-h-[40px] px-2 text-sm text-muted underline"
                onClick={() => {
                  setView('active')
                  setCategory('')
                  setLocation('')
                  setSearch('')
                }}
              >
                Reset filters
              </button>
            )}
          </div>
        </div>

        {/* Bulk bar */}
        {selectedIds.length > 0 && (
          <div
            role="region"
            aria-label="Bulk actions"
            className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent bg-accent-soft p-2.5 text-accent-soft-fg anim-fade"
          >
            <span className="px-2 text-sm font-medium">{selectedIds.length} selected</span>
            <select
              className="field !w-auto !min-h-[40px]"
              aria-label="Set location for selected"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  void bulkUpdate(selectedIds, { location: e.target.value })
                  toast({ message: `Location set for ${selectedIds.length}` })
                  setSelection({})
                }
              }}
            >
              <option value="">Set location...</option>
              {settings.locations.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <select
              className="field !w-auto !min-h-[40px]"
              aria-label="Set category for selected"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  void bulkUpdate(selectedIds, { category: e.target.value })
                  toast({ message: `Category set for ${selectedIds.length}` })
                  setSelection({})
                }
              }}
            >
              <option value="">Set category...</option>
              {settings.categories.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={() => {
                void markDisposed(selectedIds)
                toast({ message: `Marked ${selectedIds.length} as disposed` })
                setSelection({})
              }}
            >
              Mark disposed
            </Button>
            <Button size="sm" icon="trash" onClick={() => setConfirmBulkDelete(true)}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelection({})}>
              Clear
            </Button>
          </div>
        )}

        {items && rows.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-line-strong bg-surface">
            <EmptyState
              icon="box"
              title="Your inventory is empty"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    variant="primary"
                    icon="scan"
                    onClick={() => {
                      window.location.hash = '/scan'
                    }}
                  >
                    Scan medicines
                  </Button>
                  <Button icon="plus" onClick={() => setAdding(true)}>
                    Add manually
                  </Button>
                  <Button icon="upload" onClick={() => setImporting(true)}>
                    Import a file
                  </Button>
                </div>
              }
            >
              Scan a photo of your medicines, add them by hand, or import a spreadsheet.
            </EmptyState>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="rounded-[14px] border border-line bg-surface">
            <EmptyState icon="search" title="No medicines match">
              Try clearing the search or changing the filters.
            </EmptyState>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            {isDesktop && (
              <div className="overflow-x-auto rounded-[14px] border border-line bg-surface shadow-sm md:block">
                <table className="w-full border-collapse text-left text-sm">
                  <caption className="sr-only">Medicine inventory. Cells are editable.</caption>
                  <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
                    {table.getHeaderGroups().map((hg) => (
                      <tr key={hg.id}>
                        {hg.headers.map((h) => {
                          const sorted = h.column.getIsSorted()
                          return (
                            <th
                              key={h.id}
                              scope="col"
                              className="whitespace-nowrap px-2 py-2.5 font-semibold"
                              aria-sort={
                                sorted === 'asc'
                                  ? 'ascending'
                                  : sorted === 'desc'
                                    ? 'descending'
                                    : undefined
                              }
                            >
                              {h.column.getCanSort() ? (
                                <button
                                  className="inline-flex min-h-[36px] items-center gap-1 rounded-md px-1 uppercase hover:text-fg"
                                  onClick={h.column.getToggleSortingHandler()}
                                >
                                  {flexRender(h.column.columnDef.header, h.getContext())}
                                  <Icon
                                    name={sorted === 'desc' ? 'chevronDown' : 'chevronUp'}
                                    size={14}
                                    className={sorted ? 'opacity-100' : 'opacity-25'}
                                  />
                                </button>
                              ) : (
                                <span className="px-1">
                                  {flexRender(h.column.columnDef.header, h.getContext())}
                                </span>
                              )}
                            </th>
                          )
                        })}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr
                        key={row.id}
                        data-testid="inventory-row"
                        className={`border-t border-line align-top ${row.getIsSelected() ? 'bg-accent-soft/50' : ''} ${row.original.status === 'disposed' ? 'opacity-60' : ''}`}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-2 py-2">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Mobile cards */}
            {!isDesktop && (
              <ul className="flex flex-col gap-3" aria-label="Medicines">
                {visibleRows.map((row) => {
                  const r = row.original
                  const days = r.expiryDate ? daysUntil(r.expiryDate) : null
                  return (
                    <li
                      key={row.id}
                      data-testid="inventory-card"
                      className={`rounded-[14px] border border-line bg-surface p-3 shadow-sm ${r.status === 'disposed' ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-3 h-5 w-5 accent-[var(--accent)]"
                          aria-label={`Select ${r.name}`}
                          checked={row.getIsSelected()}
                          onChange={row.getToggleSelectedHandler()}
                        />
                        <button
                          className="flex min-w-0 flex-1 items-start gap-3 text-left"
                          onClick={() => setOpenId(r.id!)}
                          aria-label={`Open details for ${r.name}`}
                        >
                          <PhotoThumb photoId={r.photoId} size={48} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{r.name}</span>
                            <span className="block truncate text-sm text-muted">
                              {[r.strength, r.form].filter(Boolean).join(' · ') || 'No details'}
                            </span>
                            <span className="block truncate text-xs text-muted">
                              {[r.location, r.category].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        </button>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                        <div className="flex items-center gap-2">
                          <QuantityStepper
                            value={r.quantity}
                            label={r.name}
                            onChange={(n) => guard(() => adjustQuantity(r.id!, n - r.quantity))}
                          />
                          {r._low && <Badge>Low</Badge>}
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <StatusChip
                            status={r.status === 'disposed' ? 'none' : r._status}
                            label={r.status === 'disposed' ? 'Disposed' : undefined}
                          />
                          {r.expiryDate && (
                            <span className="text-xs text-muted">
                              {formatExpiry(r.expiryDate)}
                              {days !== null &&
                              r.status === 'active' &&
                              days >= 0 &&
                              days <= settings.expiryWarningDays
                                ? ''
                                : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>

      <PrintList
        rows={visibleRows.map((r) => r.original)}
        title={`Inventory: ${VIEW_LABEL[view]}`}
      />

      <ItemDrawer
        item={openItem}
        items={items ?? []}
        settings={settings}
        onClose={() => setOpenId(null)}
        onDelete={(i) => void doDelete([i.id!])}
      />

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add medicine"
        variant="drawer"
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" type="submit" form={FORM_ID}>
              Add to inventory
            </Button>
          </>
        }
      >
        <ItemForm
          mode="create"
          items={items ?? []}
          settings={settings}
          onSubmit={onCreate}
          onAddToExisting={(existing, qty) => {
            void adjustQuantity(existing.id!, qty)
            setAdding(false)
            toast({ message: `Added ${qty} to ${existing.name}` })
          }}
          onError={(m) => toast({ message: m })}
        />
      </Modal>

      <ImportDialog open={importing} onClose={() => setImporting(false)} />

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${selectedIds.length} medicine${selectedIds.length === 1 ? '' : 's'}?`}
        message="You can undo this right after."
        confirmLabel="Delete"
        onCancel={() => setConfirmBulkDelete(false)}
        onConfirm={() => {
          setConfirmBulkDelete(false)
          void doDelete(selectedIds)
        }}
      />
    </>
  )
}

function Menu({
  children,
  onClose,
  align = 'left',
}: {
  children: React.ReactNode
  onClose: () => void
  align?: 'left' | 'right'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest('[aria-haspopup],[aria-expanded]')
      )
        onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      role="menu"
      className={`absolute top-full z-20 mt-1 min-w-[11rem] overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-[var(--shadow-md)] anim-fade ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      {children}
    </div>
  )
}

function PrintList({ rows, title }: { rows: Row[]; title: string }) {
  return (
    <section className="print-only" aria-hidden="true">
      <h1 style={{ fontSize: '16pt', marginBottom: 4 }}>MedShelf - {title}</h1>
      <p style={{ marginBottom: 10, fontSize: '9pt' }}>
        Printed {new Date().toLocaleDateString()}. Verify details against the physical packages.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5pt' }}>
        <thead>
          <tr>
            {[
              'Name',
              'Strength',
              'Form',
              'Qty',
              'Expiry',
              'Status',
              'Location',
              'Category',
              'Batch',
            ].map((h) => (
              <th
                key={h}
                style={{ textAlign: 'left', borderBottom: '1.5px solid #000', padding: '3px 4px' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {[
                r.name,
                r.strength,
                r.form,
                r.quantity,
                formatExpiry(r.expiryDate),
                r.status === 'disposed' ? 'Disposed' : STATUS_LABEL[r._status],
                r.location,
                r.category,
                r.batch,
              ].map((c, i) => (
                <td key={i} style={{ borderBottom: '0.5px solid #999', padding: '3px 4px' }}>
                  {c ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
