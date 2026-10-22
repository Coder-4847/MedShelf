import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './index'
import { DEFAULT_SETTINGS, type Item, type Settings } from './types'

/** All items; undefined while the first query is loading. */
export function useItems(): Item[] | undefined {
  return useLiveQuery(() => db.items.toArray(), [])
}

/** Stable identity between renders unless a setting actually changes. */
export function useSettings(): Settings {
  const rows = useLiveQuery(() => db.settings.toArray(), [])
  return useMemo(() => {
    if (!rows) return DEFAULT_SETTINGS
    return {
      ...DEFAULT_SETTINGS,
      ...Object.fromEntries(rows.map((r) => [r.key, r.value])),
    } as Settings
  }, [rows])
}
