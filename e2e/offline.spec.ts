import { expect, test } from '@playwright/test'

test('works offline after the first load: app shell and scanning', async ({ page, context }) => {
  await page.goto('/#/scan')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  // First scan downloads and caches the reader.
  await page.setInputFiles(
    '[data-testid=upload-input]',
    'tests/fixtures/scans/scan-05-random-6.jpg',
  )
  await expect(page.getByTestId('detection').first()).toBeVisible({ timeout: 150_000 })

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Scan medicines' })).toBeVisible()
  await page.setInputFiles(
    '[data-testid=upload-input]',
    'tests/fixtures/scans/scan-01-aligned-easy.jpg',
  )
  await expect(page.getByTestId('detection').first()).toBeVisible({ timeout: 150_000 })
  await expect(page.getByRole('button', { name: /Paracetamol 500 mg/ })).toBeVisible()
  await context.setOffline(false)
})
