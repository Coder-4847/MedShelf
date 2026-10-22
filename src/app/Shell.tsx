import type { ReactNode } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { Wordmark } from '../components/Logo'
import { IconButton } from '../components/ui'
import { href } from './router'
import { setSetting } from '../db/repo'
import type { Settings } from '../db/types'

export const NAV: { path: string; label: string; icon: IconName }[] = [
  { path: '/', label: 'Dashboard', icon: 'dashboard' },
  { path: '/scan', label: 'Scan', icon: 'scan' },
  { path: '/inventory', label: 'Inventory', icon: 'inventory' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
]

function isActive(current: string, path: string) {
  return path === '/' ? current === '/' : current === path || current.startsWith(path + '/')
}

export function Shell({
  path,
  theme,
  children,
}: {
  path: string
  theme: Settings['theme']
  children: ReactNode
}) {
  const dark = document.documentElement.dataset.theme === 'dark'
  const toggleTheme = () => setSetting('theme', dark ? 'light' : 'dark')

  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface px-4 py-5 md:flex">
        <a href={href('/')} className="mb-8 px-2" aria-label="MedShelf home">
          <Wordmark />
        </a>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
          {NAV.map((n) => {
            const active = isActive(path, n.path)
            return (
              <a
                key={n.path}
                href={href(n.path)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[44px] items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium transition-colors ${
                  active
                    ? 'bg-accent-soft text-accent-soft-fg'
                    : 'text-muted hover:bg-surface-2 hover:text-fg'
                }`}
              >
                <Icon name={n.icon} />
                {n.label}
              </a>
            )
          })}
        </nav>
        <div className="flex items-center justify-between px-2 pt-4 text-xs text-muted">
          <span>Your home medicine cabinet, organised.</span>
        </div>
        <div className="mt-2 flex items-center justify-between rounded-[10px] border border-line px-3 py-1">
          <span className="text-sm text-muted">
            {theme === 'system' ? 'Theme: auto' : `Theme: ${theme}`}
          </span>
          <IconButton
            icon={dark ? 'sun' : 'moon'}
            label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={toggleTheme}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-2 backdrop-blur md:hidden">
          <a href={href('/')} aria-label="MedShelf home">
            <Wordmark />
          </a>
          <IconButton
            icon={dark ? 'sun' : 'moon'}
            label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={toggleTheme}
          />
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-28 pt-5 outline-none md:px-8 md:pb-10 md:pt-8"
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Main"
        className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {NAV.map((n) => {
          const active = isActive(path, n.path)
          return (
            <a
              key={n.path}
              href={href(n.path)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                active ? 'text-accent' : 'text-muted'
              }`}
            >
              <span
                className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${active ? 'bg-accent-soft' : ''}`}
              >
                <Icon name={n.icon} size={21} />
              </span>
              {n.label}
            </a>
          )
        })}
      </nav>
    </div>
  )
}
