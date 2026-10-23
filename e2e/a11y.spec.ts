import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes.length} node(s): ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  )
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([])
}

async function seed(page: Page) {
  await page.goto('/#/inventory')
  await page.getByRole('button', { name: 'Import' }).first().click()
  await page.setInputFiles('#import-file', 'tests/fixtures/sample-inventory.csv')
  await page.getByRole('button', { name: /^Import \d+/ }).click()
  await expect(
    page.getByTestId('inventory-row').or(page.getByTestId('inventory-card')),
  ).toHaveCount(4)
}

for (const theme of ['light', 'dark'] as const) {
  test(`no WCAG A/AA violations: main screens (${theme})`, async ({ page }) => {
    await page.goto('/#/settings')
    await page.getByRole('radio', { name: theme === 'dark' ? 'Dark' : 'Light' }).click()
    await seed(page)
    await audit(page, `inventory ${theme}`)
    await page.goto('/#/')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await audit(page, `dashboard ${theme}`)
    await page.goto('/#/scan')
    await audit(page, `scan ${theme}`)
    await page.goto('/#/settings')
    await audit(page, `settings ${theme}`)
    await page.goto('/#/inventory')
    await page.getByRole('button', { name: 'Add medicine' }).first().click()
    await audit(page, `add dialog ${theme}`)
    await page.keyboard.press('Escape')
    await page.getByLabel('Open details for Panadol').first().click()
    await audit(page, `detail drawer ${theme}`)
  })

  test(`no WCAG A/AA violations: review screen (${theme})`, async ({ page }) => {
    await page.goto('/#/settings')
    await page.getByRole('radio', { name: theme === 'dark' ? 'Dark' : 'Light' }).click()
    await page.goto('/#/scan')
    await page.setInputFiles(
      '[data-testid=upload-input]',
      'tests/fixtures/scans/scan-05-random-6.jpg',
    )
    await expect(page.getByTestId('detection').first()).toBeVisible({ timeout: 150_000 })
    await audit(page, `review ${theme}`)
  })
}

test('keyboard: dialogs trap focus and Escape closes', async ({ page }) => {
  await page.goto('/#/inventory')
  await page.getByRole('button', { name: 'Add medicine' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Name *')).toBeFocused()
  for (let i = 0; i < 40; i++) await page.keyboard.press('Tab')
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Add medicine' }).first()).toBeFocused()
})

test('mobile: tap targets are at least 44px and no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seed(page)
  for (const hash of ['/#/', '/#/inventory', '/#/scan', '/#/settings']) {
    await page.goto(hash)
    await page.waitForTimeout(300)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow, `${hash} scrolls horizontally`).toBeLessThanOrEqual(1)
  }
  await page.goto('/#/inventory')
  const small = await page.evaluate(() => {
    const out: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>(
      'button, a, select, input:not([type=file]):not(.sr-only)',
    )) {
      const r = (el.closest('label') ?? el).getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || el.closest('.sr-only')) continue
      if (r.height < 43.5 && r.width < 43.5)
        out.push(
          `${el.tagName} ${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        )
    }
    return out
  })
  expect(small).toEqual([])
})
