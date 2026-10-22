import { useState } from 'react'
import { Button, ConfirmDialog, Modal, StatusChip, useToast } from '../../components/ui'
import { FORM_ID, ItemForm, type ItemFormValues } from './ItemForm'
import { describeDays, expiryStatus } from '../../lib/expiry'
import type { Item, Settings } from '../../db/types'
import { markActive, markDisposed, updateItem } from '../../db/repo'
import { friendlyDbError } from '../../lib/errors'

export function ItemDrawer({
  item,
  items,
  settings,
  onClose,
  onDelete,
}: {
  item: Item | null
  items: Item[]
  settings: Settings
  onClose: () => void
  onDelete: (item: Item) => void
}) {
  const toast = useToast()
  const [confirmDispose, setConfirmDispose] = useState(false)

  const save = async (values: ItemFormValues) => {
    if (!item?.id) return
    try {
      await updateItem(item.id, {
        ...values,
        // updateItem treats undefined as "clear this field".
        genericName: values.genericName,
        strength: values.strength,
        form: values.form,
        packSize: values.packSize,
        lowStockThreshold: values.lowStockThreshold,
        expiryDate: values.expiryDate,
        batch: values.batch,
        gtin: values.gtin,
        serial: values.serial,
        category: values.category,
        location: values.location,
        notes: values.notes,
        photoId: values.photoId,
      })
      toast({ message: 'Saved' })
      onClose()
    } catch (e) {
      toast({ message: friendlyDbError(e) })
    }
  }

  const status = item ? expiryStatus(item.expiryDate, settings.expiryWarningDays) : 'none'

  return (
    <>
      <Modal
        open={!!item}
        onClose={onClose}
        variant="drawer"
        title={item?.name ?? 'Medicine'}
        footer={
          item && (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                {item.status === 'active' ? (
                  <Button size="sm" onClick={() => setConfirmDispose(true)}>
                    Mark as disposed
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={async () => {
                      await markActive([item.id!])
                      toast({ message: 'Restored to inventory' })
                      onClose()
                    }}
                  >
                    Restore
                  </Button>
                )}
                <Button size="sm" icon="trash" onClick={() => onDelete(item)}>
                  Delete
                </Button>
              </div>
              <div className="flex gap-2">
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="primary" type="submit" form={FORM_ID}>
                  Save
                </Button>
              </div>
            </div>
          )
        }
      >
        {item && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {item.status === 'disposed' ? (
                <StatusChip
                  status="none"
                  label={`Disposed${item.disposedAt ? ` ${item.disposedAt}` : ''}`}
                />
              ) : (
                <StatusChip status={status} />
              )}
              {item.expiryDate && item.status === 'active' && (
                <span className="text-sm text-muted">{describeDays(item.expiryDate)}</span>
              )}
            </div>
            <ItemForm
              key={item.id}
              mode="edit"
              initial={item}
              items={items}
              settings={settings}
              onSubmit={save}
              onError={(m) => toast({ message: m })}
            />
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={confirmDispose}
        title="Mark as disposed?"
        message="It will be removed from your active inventory and kept in the disposed list. You can restore it later."
        confirmLabel="Mark as disposed"
        onCancel={() => setConfirmDispose(false)}
        onConfirm={async () => {
          if (item?.id) await markDisposed([item.id])
          setConfirmDispose(false)
          toast({ message: 'Marked as disposed' })
          onClose()
        }}
      />
    </>
  )
}
