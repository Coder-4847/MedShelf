import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Badge, Button, Card, StatusChip, useToast } from '../../components/ui'
import { Icon, type IconName } from '../../components/Icon'
import { PhotoThumb } from '../../components/PhotoThumb'
import { useItems, useSettings } from '../../db/hooks'
import { db } from '../../db'
import { markDisposed, setSetting } from '../../db/repo'
import { daysUntil, describeDays, expiryStatus, isLowStock } from '../../lib/expiry'
import { href } from '../../app/router'

function StatCard({
  label,
  value,
  icon,
  to,
  hint,
}: {
  label: string
  value: number | string
  icon: IconName
  to: string
  hint?: string
}) {
  return (
    <a
      href={href(to)}
      className="group block rounded-[14px] border border-line bg-surface p-4 shadow-sm transition-shadow hover:shadow-[var(--shadow-md)]"
    >
      <div className="flex items-center justify-between text-muted">
        <span className="text-sm font-medium">{label}</span>
        <Icon name={icon} size={18} />
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </a>
  )
}

export function DashboardPage() {
  const items = useItems()
  const settings = useSettings()
  const toast = useToast()
  const scans = useLiveQuery(() => db.scans.orderBy('createdAt').reverse().limit(5).toArray(), [])

  const stats = useMemo(() => {
    const active = (items ?? []).filter((i) => i.status === 'active')
    const within = (n: number) =>
      active.filter((i) => {
        const d = i.expiryDate ? daysUntil(i.expiryDate) : null
        return d !== null && d >= 0 && d <= n
      }).length
    const expired = active.filter(
      (i) => expiryStatus(i.expiryDate, settings.expiryWarningDays) === 'expired',
    )
    const soon = active.filter(
      (i) => expiryStatus(i.expiryDate, settings.expiryWarningDays) === 'soon',
    )
    const low = active.filter((i) =>
      isLowStock(i.quantity, i.lowStockThreshold, settings.lowStockDefault),
    )
    const attention = [
      ...expired
        .sort((a, b) => (a.expiryDate! < b.expiryDate! ? -1 : 1))
        .map((i) => ({ item: i, kind: 'expired' as const })),
      ...soon
        .sort((a, b) => (a.expiryDate! < b.expiryDate! ? -1 : 1))
        .map((i) => ({ item: i, kind: 'soon' as const })),
      ...low
        .filter((i) => !expired.includes(i) && !soon.includes(i))
        .map((i) => ({ item: i, kind: 'low' as const })),
    ]
    return {
      active,
      expired,
      soon,
      low,
      attention,
      d30: within(30),
      d60: within(60),
      d90: within(90),
    }
  }, [items, settings.expiryWarningDays, settings.lowStockDefault])

  // Nothing below the header renders until the first read finishes, so content that depends on
  // the data (onboarding, counts) never pushes already-visible content around.
  const loaded = items !== undefined
  const empty = loaded && items.length === 0
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1
            id="page-title"
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight outline-none"
          >
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted">Your home medicine cabinet, organised.</p>
        </div>
        <Button
          variant="primary"
          size="lg"
          icon="scan"
          onClick={() => {
            window.location.hash = '/scan'
          }}
        >
          Scan medicines
        </Button>
      </div>

      {loaded && (
        <>
          {empty && !settings.onboardingDismissed && (
            <Card as="section" className="mb-6 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Get started in three steps</h2>
                  <p className="mt-1 text-sm text-muted">
                    Everything stays on this device. No account needed.
                  </p>
                </div>
                <button
                  className="min-h-[36px] rounded-lg px-2 text-sm text-muted hover:text-fg"
                  onClick={() => setSetting('onboardingDismissed', true)}
                >
                  Dismiss
                </button>
              </div>
              <ol className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  [
                    '1',
                    'Scan',
                    'Lay your medicines on a table and take a photo. MedShelf finds the boxes and reads the labels.',
                  ],
                  [
                    '2',
                    'Review',
                    'Check the suggested names, fix anything it misread, and add any it missed.',
                  ],
                  [
                    '3',
                    'Track',
                    'Get expiry and low-stock alerts, and export to Excel whenever you like.',
                  ],
                ].map(([n, t, d]) => (
                  <li key={n} className="rounded-xl bg-surface-2 p-4">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-fg">
                      {n}
                    </span>
                    <h3 className="mt-2 font-semibold">{t}</h3>
                    <p className="mt-1 text-sm text-muted">{d}</p>
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  icon="scan"
                  onClick={() => {
                    window.location.hash = '/scan'
                  }}
                >
                  Scan your first photo
                </Button>
                <Button
                  icon="plus"
                  onClick={() => {
                    window.location.hash = '/inventory'
                  }}
                >
                  Add one by hand
                </Button>
              </div>
            </Card>
          )}

          <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Total medicines"
              value={stats.active.length}
              icon="box"
              to="/inventory"
              hint={`${stats.active.reduce((n, i) => n + i.quantity, 0)} packs in total`}
            />
            <StatCard
              label="Expiring soon"
              value={stats.soon.length}
              icon="clock"
              to="/inventory?view=soon"
              hint={`Within ${settings.expiryWarningDays} days`}
            />
            <StatCard
              label="Expired"
              value={stats.expired.length}
              icon="alert"
              to="/inventory?view=expired"
              hint={stats.expired.length ? 'Check and dispose' : 'Nothing expired'}
            />
            <StatCard
              label="Low stock"
              value={stats.low.length}
              icon="layers"
              to="/inventory?view=low"
              hint={`At or below ${settings.lowStockDefault} by default`}
            />
          </section>

          <Card as="section" className="mt-4 p-4">
            <h2 className="text-sm font-semibold text-muted">Expiring in the next</h2>
            <div className="mt-2 grid grid-cols-3 gap-3 text-center">
              {[
                ['30 days', stats.d30],
                ['60 days', stats.d60],
                ['90 days', stats.d90],
              ].map(([label, n]) => (
                <div key={label as string} className="rounded-xl bg-surface-2 py-3">
                  <div className="text-2xl font-semibold tabular-nums">{n as number}</div>
                  <div className="text-xs text-muted">{label as string}</div>
                </div>
              ))}
            </div>
          </Card>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card as="section" className="min-w-0 lg:col-span-2">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="font-semibold">Needs attention</h2>
                {stats.attention.length > 6 && (
                  <a className="text-sm text-accent underline" href={href('/inventory')}>
                    View all
                  </a>
                )}
              </div>
              {stats.attention.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">
                  {empty
                    ? 'Nothing here yet. Scan or add some medicines.'
                    : 'Nothing needs attention right now.'}
                </p>
              ) : (
                <ul>
                  {stats.attention.slice(0, 6).map(({ item, kind }) => (
                    <li
                      key={`${kind}-${item.id}`}
                      className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
                    >
                      <PhotoThumb photoId={item.photoId} size={40} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {item.name}
                          {item.strength ? ` ${item.strength}` : ''}
                        </div>
                        <div className="truncate text-xs text-muted">
                          {kind === 'low'
                            ? `Quantity ${item.quantity}`
                            : describeDays(item.expiryDate)}
                          {item.location ? ` · ${item.location}` : ''}
                        </div>
                      </div>
                      {kind === 'low' ? <Badge>Low stock</Badge> : <StatusChip status={kind} />}
                      {kind === 'expired' && (
                        <Button
                          size="sm"
                          onClick={async () => {
                            await markDisposed([item.id!])
                            toast({ message: `${item.name} marked as disposed` })
                          }}
                        >
                          Dispose
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {stats.expired.length > 0 && (
                <p className="border-t border-line px-4 py-3 text-xs text-muted">
                  Return expired medicines to a pharmacy or follow local disposal guidance.
                </p>
              )}
            </Card>

            <Card as="section" className="min-w-0">
              <div className="border-b border-line px-4 py-3">
                <h2 className="font-semibold">Recent scans</h2>
              </div>
              {!scans || scans.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">No scans yet.</p>
              ) : (
                <ul>
                  {scans.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-fg">
                        <Icon name="scan" size={18} />
                      </span>
                      <div>
                        <div className="text-sm font-medium">
                          {s.itemCount} medicine{s.itemCount === 1 ? '' : 's'} added
                        </div>
                        <div className="text-xs text-muted">
                          {new Date(s.createdAt).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}{' '}
                          · {s.photoCount} photo{s.photoCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {stats.expired.length > 0 && (
            <p className="mt-4 text-sm text-muted">
              <a className="text-accent underline" href={href('/inventory?view=expired')}>
                Open the expired checklist
              </a>{' '}
              to review and dispose of expired medicines.
            </p>
          )}
        </>
      )}
    </>
  )
}
