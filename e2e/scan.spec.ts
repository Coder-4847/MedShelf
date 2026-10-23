import { expect, test } from '@playwright/test'

const IMG = 'tests/fixtures/scans/scan-05-random-6.jpg'
// Every box in this photo carries a DataMatrix, including the high-confidence ones.
const IMG_BARCODES = 'tests/fixtures/scans/scan-01-aligned-easy.jpg'

async function scan(page: import('@playwright/test').Page, file = IMG) {
  await page.goto('/#/scan')
  await page.setInputFiles('[data-testid=upload-input]', file)
  await expect(page.getByTestId('detection').first()).toBeVisible({ timeout: 150_000 })
}

test('scan flow: upload photo, review, confirm, add to inventory with barcode expiry', async ({
  page,
}) => {
  await scan(page, IMG_BARCODES)
  expect(await page.getByTestId('detection').count()).toBeGreaterThanOrEqual(5)
  await expect(page.getByRole('button', { name: /Paracetamol 500 mg/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Ibuprofen 400 mg/ })).toBeVisible()
  // Low-confidence (unknown) names must be flagged, never silently accepted.
  await expect(page.getByText(/Check this/).first()).toBeVisible()
  await expect(page.getByTestId('add-to-inventory')).toBeDisabled()

  await page.getByTestId('confirm-all-high').click()
  await page.getByTestId('add-to-inventory').click()
  await page.getByTestId('confirm-add').click()
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible()
  const rows = page.getByTestId('inventory-row')
  expect(await rows.count()).toBeGreaterThanOrEqual(3)
  await expect(
    rows.filter({ has: page.getByLabel('Name of Paracetamol', { exact: true }) }),
  ).toHaveCount(1)
  // The barcode supplied an exact expiry date for at least one confirmed medicine.
  await expect(page.getByTestId('inventory-row').first()).toBeVisible()
  const withExpiry = await rows
    .locator('input[aria-label^="Expiry of"]')
    .evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).value).length)
  expect(withExpiry).toBeGreaterThanOrEqual(1)
})

test('correcting a name teaches the app (learned alias) and duplicates are offered a merge', async ({
  page,
}) => {
  await scan(page)
  // Fix an unknown/flagged name, confirm it, add everything.
  const flagged = page.getByRole('button', { name: /Calmexa/ }).first()
  await flagged.click()
  await page.getByTestId('candidate-name').fill('Calmexa Forte')
  await page.getByTestId('confirm').click()
  await page.getByTestId('confirm-all-high').click()
  await page.getByTestId('add-to-inventory').click()
  await page.getByTestId('confirm-add').click()
  await expect(
    page
      .getByTestId('inventory-row')
      .filter({ has: page.getByLabel('Name of Calmexa Forte', { exact: true }) }),
  ).toHaveCount(1)

  // Scan the same photo again: the same medicines are now duplicates and the correction is remembered.
  await scan(page)
  await expect(page.getByRole('button', { name: /Calmexa Forte/ }).first()).toBeVisible()
  await page.getByTestId('confirm-all-high').click()
  await page
    .getByRole('button', { name: /Calmexa Forte/ })
    .first()
    .click()
  await page.getByTestId('confirm').click()
  await page.getByTestId('add-to-inventory').click()
  await expect(page.getByTestId('conflict').first()).toBeVisible()
  await page.getByTestId('confirm-add').click()
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible()
  const calm = page
    .getByTestId('inventory-row')
    .filter({ has: page.getByLabel('Name of Calmexa Forte', { exact: true }) })
  await expect(calm).toHaveCount(1)
  await expect(
    calm.getByRole('textbox', { name: 'Quantity of Calmexa Forte', exact: true }),
  ).toHaveValue('2')
})

test('"Missed one?" lets you draw a region and type a medicine', async ({ page }) => {
  await scan(page)
  const before = await page.getByTestId('detection').count()
  await page.getByRole('button', { name: 'Missed one?' }).click()
  const svg = page.getByRole('group', { name: 'Detected medicines' })
  const box = (await svg.boundingBox())!
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + 70, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByTestId('detection')).toHaveCount(before + 1)
  await page.getByTestId('candidate-name').fill('My custom medicine')
  await page.getByTestId('confirm').click()
  await expect(page.getByRole('button', { name: /My custom medicine/ })).toBeVisible()
})

test('falls back to Tesseract when the ONNX models cannot load, and says so', async ({ page }) => {
  await page.route('**/models/*.onnx', (route) => route.abort())
  await scan(page, 'tests/fixtures/scans/scan-01-aligned-easy.jpg')
  await expect(page.getByText(/fallback reader was used/)).toBeVisible()
  await expect(page.getByText(/Tesseract fallback/)).toBeVisible()
})

test('unreadable file shows an error instead of crashing', async ({ page }) => {
  await page.goto('/#/scan')
  await page.setInputFiles('[data-testid=upload-input]', {
    name: 'broken.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('not an image'),
  })
  await expect(page.getByRole('alert')).toContainText(/could not be read/i)
})
