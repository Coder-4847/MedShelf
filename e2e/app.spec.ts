import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'

const CSV = 'tests/fixtures/sample-inventory.csv'

// Rows hold inputs, so locate a row by its name field rather than by text content.
const rowOf = (page: Page, name: string) =>
  page
    .getByTestId('inventory-row')
    .filter({ has: page.getByLabel(`Name of ${name}`, { exact: true }) })

async function addManual(page: Page, name: string, strength: string, qty = 1) {
  await page.getByRole('button', { name: 'Add medicine' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name *').fill(name)
  await dialog.getByLabel('Strength').fill(strength)
  for (let i = 1; i < qty; i++)
    await dialog.getByRole('button', { name: /Increase quantity/ }).click()
  await dialog.getByRole('button', { name: 'Add to inventory' }).click()
  await expect(dialog).toBeHidden()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#/inventory')
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible()
})

test('add an item manually, edit inline, and it persists after reload', async ({ page }) => {
  await addManual(page, 'Panadol', '500 mg', 2)
  const row = rowOf(page, 'Panadol')
  await expect(row).toHaveCount(1)

  // Inline edit: strength, quantity stepper, expiry with month/year shorthand.
  const strength = row.getByLabel('Strength of Panadol')
  await strength.fill('1 g')
  await strength.press('Enter')
  await row.getByRole('button', { name: 'Increase quantity of Panadol' }).click()
  const expiry = row.getByLabel('Expiry of Panadol')
  await expiry.fill('03/2099')
  await expiry.press('Enter')
  await expect(row.getByText('OK', { exact: true })).toBeVisible()

  await page.reload()
  const after = rowOf(page, 'Panadol')
  await expect(after.getByLabel('Strength of Panadol')).toHaveValue('1 g')
  await expect(
    after.getByRole('textbox', { name: 'Quantity of Panadol', exact: true }),
  ).toHaveValue('3')
  await expect(after.getByLabel('Expiry of Panadol')).toHaveValue('31 Mar 2099')
})

test('shows expiry status chips and filters, and warns about duplicates', async ({ page }) => {
  await page.getByRole('button', { name: 'Import' }).first().click()
  await page.setInputFiles('#import-file', CSV)
  await page.getByRole('button', { name: /^Import \d+/ }).click()
  await expect(page.getByTestId('inventory-row')).toHaveCount(4)
  // Augmentin 03/2026 is in the past relative to the test machine's date (2026-10).
  await page.getByRole('button', { name: /^Expired/ }).click()
  await expect(rowOf(page, 'Augmentin')).toBeVisible()
  await page.getByRole('button', { name: /^Active/ }).click()

  await page.getByRole('button', { name: 'Add medicine' }).first().click()
  await page.getByRole('dialog').getByLabel('Name *').fill('panadol')
  await page.getByRole('dialog').getByLabel('Strength').fill('500 mg')
  await expect(page.getByText(/You already have/)).toBeVisible()
  await page.getByRole('button', { name: /to existing instead/ }).click()
  await expect(
    rowOf(page, 'Panadol').getByRole('textbox', { name: 'Quantity of Panadol', exact: true }),
  ).toHaveValue('4')
})

test('delete with undo, and bulk select', async ({ page }) => {
  await addManual(page, 'Brufen', '400 mg')
  await addManual(page, 'Zyrtec', '10 mg')
  await page.getByLabel('Select Brufen').check()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(rowOf(page, 'Brufen')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(rowOf(page, 'Brufen')).toHaveCount(1)
})

test('exports a real .xlsx (formatted) and a .csv', async ({ page }) => {
  await page.getByRole('button', { name: 'Import' }).first().click()
  await page.setInputFiles('#import-file', CSV)
  await page.getByRole('button', { name: /^Import \d+/ }).click()
  await expect(page.getByTestId('inventory-row')).toHaveCount(4)

  const [xlsx] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export' }).click()
      await page.getByRole('menuitem', { name: /Excel/ }).click()
    })(),
  ])
  expect(xlsx.suggestedFilename()).toMatch(/^medshelf-inventory-\d{4}-\d{2}-\d{2}\.xlsx$/)
  const path = await xlsx.path()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path!)
  const ws = wb.worksheets[0]
  expect(ws.getRow(1).getCell(1).value).toBe('Name')
  expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
  expect(ws.rowCount).toBe(5)
  expect(ws.getCell('E2').numFmt).toBe('dd mmm yyyy')

  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export' }).click()
      await page.getByRole('menuitem', { name: 'CSV' }).click()
    })(),
  ])
  expect(csv.suggestedFilename()).toMatch(/\.csv$/)
  const text = readFileSync((await csv.path())!, 'utf8')
  expect(text).toContain('Name,Strength,Form,Quantity,Expiry,Expiry status')
  expect(text).toContain('Panadol,500 mg,Tablet,3,2027-03-31')
})

test('imports an exported xlsx back (round trip) and backs up / restores JSON', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Import' }).first().click()
  await page.setInputFiles('#import-file', CSV)
  await page.getByRole('button', { name: /^Import \d+/ }).click()
  await expect(page.getByTestId('inventory-row')).toHaveCount(4)

  const [xlsx] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export' }).click()
      await page.getByRole('menuitem', { name: /Excel/ }).click()
    })(),
  ])
  const xlsxPath = await xlsx.path()

  await page.goto('/#/settings')
  const [backup] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Back up everything' }).click(),
  ])
  const backupPath = await backup.path()
  expect(backup.suggestedFilename()).toMatch(/^medshelf-backup-/)

  await page.getByRole('button', { name: 'Clear all data' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Clear everything' }).click()
  await page.goto('/#/inventory')
  await expect(page.getByText('Your inventory is empty')).toBeVisible()

  await page.getByRole('button', { name: 'Import' }).first().click()
  await page.setInputFiles('#import-file', xlsxPath!)
  await expect(page.getByText(/Found 4 medicines/)).toBeVisible()
  await page.getByRole('button', { name: /^Import \d+/ }).click()
  await expect(page.getByTestId('inventory-row')).toHaveCount(4)

  await page.goto('/#/settings')
  await page.getByLabel('Backup file').setInputFiles(backupPath!)
  await page.getByRole('dialog').getByRole('button', { name: 'Replace my data' }).click()
  await page.goto('/#/inventory')
  await expect(page.getByTestId('inventory-row')).toHaveCount(4)
})

test('settings shows the safety notice; dark mode applies', async ({ page }) => {
  await page.goto('/#/settings')
  await expect(page.getByTestId('safety-notice')).toContainText('It can misread labels')
  await expect(page.getByTestId('safety-notice')).toContainText('does not provide medical advice')
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('expired checklist: mark as disposed from the dashboard', async ({ page }) => {
  await page.getByRole('button', { name: 'Import' }).first().click()
  await page.setInputFiles('#import-file', CSV)
  await page.getByRole('button', { name: /^Import \d+/ }).click()
  await page.goto('/#/')
  await expect(page.getByText('Return expired medicines to a pharmacy')).toBeVisible()
  await page.getByRole('button', { name: 'Dispose' }).first().click()
  await page.goto('/#/inventory?view=expired')
  await expect(page.getByTestId('expired-note')).toContainText('pharmacy')
  await page.goto('/#/inventory?view=disposed')
  await expect(rowOf(page, 'Augmentin')).toBeVisible()
})

test('camera permission denied shows a helpful message', async ({ page, context }) => {
  await context.grantPermissions([])
  await page.goto('/#/scan')
  await page.getByRole('button', { name: 'Use live camera' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/camera/i)
})
