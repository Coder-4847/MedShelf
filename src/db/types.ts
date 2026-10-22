export type ItemStatus = 'active' | 'disposed'

export interface Item {
  id?: number
  name: string
  genericName?: string
  strength?: string
  form?: string
  packSize?: string
  quantity: number
  lowStockThreshold?: number
  /** ISO date (YYYY-MM-DD). Month-only expiry on a box means the last day of that month. */
  expiryDate?: string
  batch?: string
  gtin?: string
  serial?: string
  category?: string
  location?: string
  notes?: string
  photoId?: number
  status: ItemStatus
  /** ISO date the item was marked as disposed. */
  disposedAt?: string
  createdAt: number
  updatedAt: number
}

export type NewItem = Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'status'> & {
  status?: ItemStatus
}

export interface PhotoRecord {
  id?: number
  blob: Blob
  thumbBlob: Blob
  width: number
  height: number
  createdAt: number
}

/** A learned mapping from raw OCR text (or a GTIN) to a canonical medicine. */
export interface AliasRecord {
  /** Normalised raw text, or `gtin:<14 digits>`. */
  key: string
  canonical: string
  genericName?: string
  strength?: string
  form?: string
  category?: string
  count: number
  updatedAt: number
}

export interface SettingRecord {
  key: string
  value: unknown
}

export interface ScanRecord {
  id?: number
  createdAt: number
  photoCount: number
  itemCount: number
  thumbBlob?: Blob
}

export interface Settings {
  expiryWarningDays: number
  lowStockDefault: number
  categories: string[]
  locations: string[]
  scanQuality: 'fast' | 'thorough'
  theme: 'system' | 'light' | 'dark'
  onboardingDismissed: boolean
}

export const DEFAULT_CATEGORIES = [
  'Pain relief',
  'Antibiotics',
  'Allergy',
  'Cold & flu',
  'Digestive',
  'Vitamins & supplements',
  'Skin care',
  'First aid',
  'Chronic medication',
  'Other',
]

export const DEFAULT_LOCATIONS = ['Kitchen drawer', 'Bedroom', 'Bathroom cabinet', 'Travel kit']

export const DEFAULT_SETTINGS: Settings = {
  expiryWarningDays: 60,
  lowStockDefault: 1,
  categories: DEFAULT_CATEGORIES,
  locations: DEFAULT_LOCATIONS,
  scanQuality: 'fast',
  theme: 'system',
  onboardingDismissed: false,
}

export const FORMS = [
  'Tablet',
  'Capsule',
  'Syrup',
  'Suspension',
  'Solution',
  'Drops',
  'Cream',
  'Ointment',
  'Gel',
  'Lotion',
  'Spray',
  'Inhaler',
  'Injection',
  'Sachet',
  'Lozenge',
  'Suppository',
  'Patch',
  'Powder',
  'Other',
] as const
