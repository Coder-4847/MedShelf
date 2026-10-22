// Renders the PWA PNG icons from the SVG mark using the local Chromium (Playwright).
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'public/favicon.svg'), 'utf8')
const inner = svg
  .replace(/<svg[^>]*>/, '')
  .replace('</svg>', '')
  .replace(/<rect width="64" height="64"[^>]*\/>/, '')

const html = (size, maskable) => `<!doctype html><body style="margin:0;background:#0f6b64">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${maskable ? 0 : 15}" fill="#0f6b64"/>
  <g transform="${maskable ? 'translate(32 32) scale(.7) translate(-32 -32)' : ''}">${inner}</g>
</svg></body>`

const browser = await chromium.launch()
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(html(size, maskable))
  const buf = await page.screenshot({ omitBackground: true })
  writeFileSync(join(root, 'public/icons', name), buf)
  await page.close()
}
await browser.close()
console.log('icons written')
