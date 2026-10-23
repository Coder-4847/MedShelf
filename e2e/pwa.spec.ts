import { expect, test } from '@playwright/test'

test('is installable: manifest, icons, service worker, theme colour', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const manifest = await (await request.get(new URL(href!, page.url()).toString())).json()
  expect(manifest).toMatchObject({ name: 'MedShelf', display: 'standalone' })
  expect(manifest.start_url).toBeTruthy()
  const sizes = manifest.icons.map(
    (i: { sizes: string; purpose?: string }) => `${i.sizes}${i.purpose ? ':' + i.purpose : ''}`,
  )
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512', '512x512:maskable']))
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, page.url()).toString())
    expect(res.ok(), icon.src).toBe(true)
  }
  const controlled = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    return !!reg.active
  })
  expect(controlled).toBe(true)
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1)
})

test('makes no external network requests', async ({ page }) => {
  const external: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (
      !['localhost', '127.0.0.1'].includes(u.hostname) &&
      !['data:', 'blob:'].includes(u.protocol)
    )
      external.push(r.url())
  })
  await page.goto('/#/scan')
  await page.setInputFiles(
    '[data-testid=upload-input]',
    'tests/fixtures/scans/scan-01-aligned-easy.jpg',
  )
  await expect(page.getByTestId('detection').first()).toBeVisible({ timeout: 150_000 })
  await page.goto('/#/settings')
  await page.goto('/#/inventory')
  expect(external).toEqual([])
})
