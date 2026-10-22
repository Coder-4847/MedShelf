/** Turns storage/IO failures into messages a person can act on. */
export function friendlyDbError(e: unknown): string {
  const err = e as { name?: string; message?: string; inner?: { name?: string } } | undefined
  const name = err?.name ?? ''
  const inner = err?.inner?.name ?? ''
  if (
    name === 'QuotaExceededError' ||
    inner === 'QuotaExceededError' ||
    /quota/i.test(err?.message ?? '')
  ) {
    return 'This device is out of storage. Export a backup, remove some photos or items, then try again.'
  }
  if (
    name === 'DatabaseClosedError' ||
    name === 'OpenFailedError' ||
    /private mode|SecurityError/i.test(`${name}${err?.message}`)
  ) {
    return 'MedShelf could not open its storage. Private browsing or blocked site data can cause this.'
  }
  return err?.message || 'Something went wrong. Please try again.'
}
