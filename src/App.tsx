import { Suspense, lazy, useEffect } from 'react'
import { Shell } from './app/Shell'
import { useRoute } from './app/router'
import { useApplyTheme } from './app/theme'
import { ToastProvider } from './components/ui'
import { useSettings } from './db/hooks'
import { purgeOrphanPhotos } from './db/repo'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { InventoryPage } from './features/inventory/InventoryPage'
import { SettingsPage } from './features/settings/SettingsPage'

const ScanPage = lazy(() => import('./features/scan/ScanPage'))

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/scan': 'Scan',
  '/inventory': 'Inventory',
  '/settings': 'Settings',
}

export default function App() {
  const route = useRoute()
  const settings = useSettings()
  useApplyTheme(settings.theme)

  useEffect(() => {
    document.title = `${TITLES[route.path] ?? 'MedShelf'} · MedShelf`
    // Move focus to the page heading after navigation so screen readers announce it.
    const t = setTimeout(
      () => document.getElementById('page-title')?.focus({ preventScroll: true }),
      50,
    )
    return () => clearTimeout(t)
  }, [route.path])

  useEffect(() => {
    void purgeOrphanPhotos().catch(() => {})
  }, [])

  let page
  if (route.path === '/inventory') page = <InventoryPage />
  else if (route.path === '/settings') page = <SettingsPage />
  else if (route.path.startsWith('/scan')) page = <ScanPage />
  else page = <DashboardPage />

  return (
    <ToastProvider>
      <Shell path={route.path} theme={settings.theme}>
        <Suspense fallback={<p className="py-10 text-center text-muted">Loading...</p>}>
          {page}
        </Suspense>
      </Shell>
    </ToastProvider>
  )
}
