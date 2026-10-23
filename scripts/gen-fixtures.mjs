// Generates synthetic "photos of a pile of medicines" plus ground-truth JSON.
// Boxes are rendered in Chromium (rotations, fonts, shadows, noise, glare) with real
// GS1 DataMatrix codes from bwip-js. Everything is seeded, so output is reproducible.
//
// Brand names are INVENTED placeholders, except a few real UAE brand/generic names used
// to measure drug-list matching. This is a synthetic benchmark, not real packaging.
import { chromium } from '@playwright/test'
import bwipjs from 'bwip-js'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'tests/fixtures/scans')
mkdirSync(outDir, { recursive: true })
const interWoff = readFileSync(
  join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'),
).toString('base64')

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// kind: generic (real INN, in drugs.json) | brand (real UAE brand, in drugs.json) | invented (not in any list)
const CATALOG = [
  {
    name: 'Paracetamol',
    kind: 'generic',
    strength: '500 mg',
    form: 'tablets',
    pack: 20,
    dosage: 'Each film-coated tablet contains Paracetamol 500 mg',
  },
  {
    name: 'Ibuprofen',
    kind: 'generic',
    strength: '400 mg',
    form: 'tablets',
    pack: 30,
    dosage: 'Each tablet contains Ibuprofen 400 mg',
  },
  {
    name: 'Amoxicillin',
    kind: 'generic',
    strength: '500 mg',
    form: 'capsules',
    pack: 16,
    dosage: 'Each capsule contains Amoxicillin 500 mg',
  },
  {
    name: 'Cetirizine',
    kind: 'generic',
    strength: '10 mg',
    form: 'tablets',
    pack: 10,
    dosage: 'Each tablet contains Cetirizine 10 mg',
  },
  {
    name: 'Omeprazole',
    kind: 'generic',
    strength: '20 mg',
    form: 'capsules',
    pack: 14,
    dosage: 'Each capsule contains Omeprazole 20 mg',
  },
  {
    name: 'Loratadine',
    kind: 'generic',
    strength: '10 mg',
    form: 'tablets',
    pack: 10,
    dosage: 'Each tablet contains Loratadine 10 mg',
  },
  {
    name: 'Metformin',
    kind: 'generic',
    strength: '500 mg',
    form: 'tablets',
    pack: 60,
    dosage: 'Each tablet contains Metformin HCl 500 mg',
  },
  {
    name: 'Atorvastatin',
    kind: 'generic',
    strength: '20 mg',
    form: 'tablets',
    pack: 30,
    dosage: 'Each tablet contains Atorvastatin 20 mg',
  },
  {
    name: 'Panadol',
    kind: 'brand',
    strength: '500 mg',
    form: 'tablets',
    pack: 24,
    dosage: 'Each tablet contains Paracetamol 500 mg',
  },
  {
    name: 'Brufen',
    kind: 'brand',
    strength: '400 mg',
    form: 'tablets',
    pack: 30,
    dosage: 'Each tablet contains Ibuprofen 400 mg',
  },
  {
    name: 'Zyrtec',
    kind: 'brand',
    strength: '10 mg',
    form: 'tablets',
    pack: 10,
    dosage: 'Each tablet contains Cetirizine 10 mg',
  },
  {
    name: 'Augmentin',
    kind: 'brand',
    strength: '625 mg',
    form: 'tablets',
    pack: 14,
    dosage: 'Each tablet contains Amoxicillin 500 mg and Clavulanic acid 125 mg',
  },
  {
    name: 'Ventolin',
    kind: 'brand',
    strength: '100 mcg',
    form: 'inhaler',
    pack: 200,
    dosage: 'Each actuation delivers Salbutamol 100 mcg',
  },
  {
    name: 'Gaviscon',
    kind: 'brand',
    strength: null,
    form: 'syrup',
    pack: null,
    volume: '150 ml',
    dosage: 'Oral suspension, aniseed flavour',
  },
  {
    name: 'Zentora',
    kind: 'invented',
    strength: '10 mg',
    form: 'tablets',
    pack: 28,
    dosage: 'Each tablet contains active ingredient 10 mg',
  },
  {
    name: 'Veldrin',
    kind: 'invented',
    strength: '250 mg',
    form: 'capsules',
    pack: 20,
    dosage: 'Each capsule contains active ingredient 250 mg',
  },
  {
    name: 'Nuvira',
    kind: 'invented',
    strength: '5 mg',
    form: 'tablets',
    pack: 30,
    dosage: 'Each tablet contains active ingredient 5 mg',
  },
  {
    name: 'Calmexa',
    kind: 'invented',
    strength: '100 mg',
    form: 'tablets',
    pack: 12,
    dosage: 'Each tablet contains active ingredient 100 mg',
  },
  {
    name: 'Lorvexa',
    kind: 'invented',
    strength: '20 mg',
    form: 'tablets',
    pack: 14,
    dosage: 'Each tablet contains active ingredient 20 mg',
  },
  {
    name: 'Betaprin',
    kind: 'invented',
    strength: '75 mg',
    form: 'tablets',
    pack: 28,
    dosage: 'Each tablet contains active ingredient 75 mg',
  },
  {
    name: 'Orelix',
    kind: 'invented',
    strength: '150 mg',
    form: 'capsules',
    pack: 30,
    dosage: 'Each capsule contains active ingredient 150 mg',
  },
  {
    name: 'Dolcira',
    kind: 'invented',
    strength: '50 mg/5 ml',
    form: 'syrup',
    pack: null,
    volume: '100 ml',
    dosage: 'Oral suspension',
  },
]

const FONTS = [`'Inter'`, `'DejaVu Sans'`, `'Carlito'`, `'FreeSans'`, `'DejaVu Serif'`, `'Caladea'`]
const PALETTES = [
  { bg: '#ffffff', band: '#0b6e8a', fg: '#102a3a', accent: '#0b6e8a' },
  { bg: '#f4fbf6', band: '#2f8f4e', fg: '#14301d', accent: '#2f8f4e' },
  { bg: '#fff6ea', band: '#d9731a', fg: '#3a210a', accent: '#d9731a' },
  { bg: '#f3f0ff', band: '#5b3fc4', fg: '#221a47', accent: '#5b3fc4' },
  { bg: '#ffffff', band: '#c43b3b', fg: '#2b1212', accent: '#c43b3b' },
  { bg: '#eef3f6', band: '#1f3b57', fg: '#0f2233', accent: '#1f3b57' },
  { bg: '#1c2b3a', band: '#f2b134', fg: '#f5f7fa', accent: '#f2b134' },
  { bg: '#fdf3f5', band: '#b83a6b', fg: '#33121f', accent: '#b83a6b' },
]

function gtin13(r) {
  let s = '62911' + String(Math.floor(r() * 1e7)).padStart(7, '0')
  const d = s.split('').map(Number)
  let sum = 0
  d.forEach((v, i) => (sum += v * (i % 2 === 0 ? 1 : 3)))
  return s + ((10 - (sum % 10)) % 10)
}

const dmCache = new Map()
async function datamatrix(text, scale) {
  const key = `${text}|${scale}`
  if (!dmCache.has(key)) {
    const png = await bwipjs.toBuffer({
      bcid: 'gs1datamatrix',
      text,
      scale,
      padding: 2,
      backgroundcolor: 'FFFFFF',
    })
    dmCache.set(key, 'data:image/png;base64,' + png.toString('base64'))
  }
  return dmCache.get(key)
}

// Separating-axis test for two rotated rectangles (with margin).
function rectCorners(cx, cy, w, h, deg) {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c])
}
function overlaps(A, B) {
  for (const poly of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % 4]
      const nx = -(q[1] - p[1])
      const ny = q[0] - p[0]
      const proj = (pts) => pts.map(([x, y]) => x * nx + y * ny)
      const a = proj(A)
      const b = proj(B)
      if (Math.max(...a) < Math.min(...b) || Math.max(...b) < Math.min(...a)) return false
    }
  }
  return true
}

const SCENES = [
  // id, seed, boxes, rotation spec, effects
  { id: 'scan-01-aligned-easy', seed: 11, n: 6, rot: 'aligned', dm: 0.6, effects: {} },
  { id: 'scan-02-aligned-mixed', seed: 12, n: 8, rot: 'aligned', dm: 0.5, effects: {} },
  { id: 'scan-03-aligned-dense', seed: 13, n: 10, rot: 'aligned', dm: 0.5, effects: { blur: 0.5 } },
  {
    id: 'scan-04-aligned-light',
    seed: 14,
    n: 7,
    rot: 'aligned',
    dm: 0.7,
    effects: { glare: 0.25 },
  },
  { id: 'scan-05-random-6', seed: 21, n: 6, rot: 'random', dm: 0.5, effects: {} },
  { id: 'scan-06-random-8', seed: 22, n: 8, rot: 'random', dm: 0.5, effects: { blur: 0.4 } },
  { id: 'scan-07-random-8b', seed: 23, n: 8, rot: 'random', dm: 0.5, effects: {} },
  { id: 'scan-08-random-10', seed: 24, n: 10, rot: 'random', dm: 0.4, effects: { blur: 0.5 } },
  { id: 'scan-09-crowded-14', seed: 31, n: 14, rot: 'random', dm: 0.5, effects: {} },
  { id: 'scan-10-crowded-12', seed: 32, n: 12, rot: 'mixed', dm: 0.5, effects: { blur: 0.4 } },
  {
    id: 'scan-11-glare-dim',
    seed: 41,
    n: 8,
    rot: 'random',
    dm: 0.5,
    effects: { glare: 0.45, dim: 0.78, blur: 0.7 },
  },
  {
    id: 'scan-12-lowlight-noisy',
    seed: 42,
    n: 8,
    rot: 'mixed',
    dm: 0.5,
    effects: { dim: 0.6, noise: 0.22, blur: 0.8 },
  },
]

const W = 2400
const H = 1800

async function buildScene(scene) {
  const r = rng(scene.seed)
  const pick = (arr) => arr[Math.floor(r() * arr.length)]
  const cat = [...CATALOG].sort(() => r() - 0.5).slice(0, scene.n)
  const placed = []
  const boxes = []
  for (const item of cat) {
    let ok = false
    for (let attempt = 0; attempt < 4000 && !ok; attempt++) {
      const bw = Math.round(430 + r() * 110)
      const bh = Math.round(200 + r() * 70)
      const cx = Math.round(60 + r() * (W - 120))
      const cy = Math.round(60 + r() * (H - 120))
      let deg
      if (scene.rot === 'aligned') deg = (r() - 0.5) * 36
      else if (scene.rot === 'random') deg = r() * 360
      else deg = r() < 0.5 ? (r() - 0.5) * 40 : r() * 360
      const grow = scene.n > 11 ? 8 : 24
      const corners = rectCorners(cx, cy, bw + grow, bh + grow, deg)
      if (corners.some(([x, y]) => x < 10 || y < 10 || x > W - 10 || y > H - 10)) continue
      if (placed.some((p) => overlaps(corners, p))) continue
      placed.push(corners)
      ok = true
      const hasDm = r() < scene.dm
      const expYear = 2026 + Math.floor(r() * 4)
      const expMonth = 1 + Math.floor(r() * 12)
      const batch =
        pick(['A', 'B', 'K', 'M', 'X']) +
        String(Math.floor(r() * 9000 + 1000)) +
        pick(['', 'A', 'B'])
      const serial = String(Math.floor(r() * 9e9 + 1e9))
      const gtin = gtin13(r)
      const lastDay = new Date(Date.UTC(expYear, expMonth, 0)).getUTCDate()
      boxes.push({
        item,
        cx,
        cy,
        bw,
        bh,
        deg,
        hasDm,
        expYear,
        expMonth,
        batch,
        serial,
        gtin: '0' + gtin,
        lastDay,
        font: pick(FONTS),
        pal: pick(PALETTES),
        layout: Math.floor(r() * 3),
        corners,
        printExp: r() < 0.7,
      })
    }
    if (!ok) throw new Error(`could not place box in ${scene.id}`)
  }

  let html = ''
  const truth = []
  for (const b of boxes) {
    const { item, pal } = b
    const dmText = `(01)${b.gtin}(17)${String(b.expYear).slice(2)}${String(b.expMonth).padStart(2, '0')}00(10)${b.batch}(21)${b.serial}`
    const dmSize = 96
    const dmSrc = b.hasDm ? await datamatrix(dmText, 3) : ''
    const strengthLine = item.strength ?? ''
    const packText = item.pack ? `${item.pack} ${item.form}` : (item.volume ?? '')
    const expText = `EXP ${String(b.expMonth).padStart(2, '0')}/${b.expYear}`
    const unit = b.bh / 230
    const brandPx = Math.round((item.name.length > 9 ? 52 : 62) * unit)
    const common = `position:absolute;left:${b.cx - b.bw / 2}px;top:${b.cy - b.bh / 2}px;width:${b.bw}px;height:${b.bh}px;transform:rotate(${b.deg}deg);background:${pal.bg};color:${pal.fg};font-family:${b.font},sans-serif;border-radius:6px;box-shadow:5px 9px 16px rgba(0,0,0,.38), 0 0 0 1px rgba(0,0,0,.18);overflow:hidden;`
    const dm = b.hasDm
      ? `<img src="${dmSrc}" style="position:absolute;right:${12 * unit}px;bottom:${10 * unit}px;width:${dmSize * unit}px;height:${dmSize * unit}px;image-rendering:pixelated">`
      : ''
    const fine = `<div style="position:absolute;left:${16 * unit}px;bottom:${12 * unit}px;width:${b.bw - (b.hasDm ? 140 * unit : 30 * unit)}px;font-size:${Math.round(13 * unit)}px;line-height:1.25;opacity:.85">${item.dosage}.<br>${b.printExp ? `B.N. ${b.batch} &nbsp;&nbsp; <b>${expText}</b>` : 'Keep out of reach of children.'}</div>`
    let inner
    if (b.layout === 0) {
      inner = `<div style="background:${pal.band};color:${pal.bg === '#1c2b3a' ? '#1c2b3a' : '#fff'};padding:${10 * unit}px ${16 * unit}px;font-weight:800;font-size:${brandPx}px;letter-spacing:.5px;white-space:nowrap">${item.name}</div>
        <div style="padding:${8 * unit}px ${16 * unit}px 0;font-size:${Math.round(34 * unit)}px;font-weight:700">${strengthLine}</div>
        <div style="padding:0 ${16 * unit}px;font-size:${Math.round(19 * unit)}px">${packText}</div>${fine}${dm}`
    } else if (b.layout === 1) {
      inner = `<div style="position:absolute;left:0;top:0;bottom:0;width:${22 * unit}px;background:${pal.band}"></div>
        <div style="padding:${14 * unit}px ${16 * unit}px 0 ${40 * unit}px;font-weight:800;font-size:${brandPx}px;color:${pal.accent === '#f2b134' ? '#f2b134' : pal.accent};white-space:nowrap">${item.name}</div>
        <div style="padding:${4 * unit}px ${16 * unit}px 0 ${40 * unit}px;font-size:${Math.round(32 * unit)}px;font-weight:600">${strengthLine}</div>
        <div style="padding:${2 * unit}px ${16 * unit}px 0 ${40 * unit}px;font-size:${Math.round(18 * unit)}px">${packText}</div>${fine.replace(`left:${16 * unit}px`, `left:${40 * unit}px`)}${dm}`
    } else {
      inner = `<div style="text-align:center;padding-top:${14 * unit}px;font-weight:700;font-size:${brandPx}px;white-space:nowrap">${item.name}</div>
        <div style="text-align:center;margin:${4 * unit}px auto 0;display:table;background:${pal.band};color:${pal.bg === '#1c2b3a' ? '#1c2b3a' : '#fff'};padding:${3 * unit}px ${14 * unit}px;font-size:${Math.round(30 * unit)}px;font-weight:700;border-radius:99px">${strengthLine || packText}</div>
        <div style="text-align:center;font-size:${Math.round(18 * unit)}px;padding-top:${5 * unit}px">${strengthLine ? packText : ''}</div>${fine}${dm}`
    }
    html += `<div class="box" style="${common}">${inner}</div>`
    truth.push({
      name: item.name,
      kind: item.kind,
      strength: item.strength,
      form:
        item.form === 'tablets'
          ? 'Tablet'
          : item.form === 'capsules'
            ? 'Capsule'
            : item.form === 'syrup'
              ? 'Syrup'
              : item.form === 'inhaler'
                ? 'Inhaler'
                : item.form,
      pack: item.pack ? `${item.pack} ${item.form}` : (item.volume ?? null),
      expiry:
        b.printExp || b.hasDm
          ? `${b.expYear}-${String(b.expMonth).padStart(2, '0')}-${String(b.lastDay).padStart(2, '0')}`
          : null,
      expiryFromBarcode: b.hasDm,
      expiryPrinted: b.printExp,
      batch: b.hasDm || b.printExp ? b.batch : null,
      gtin: b.hasDm ? b.gtin : null,
      serial: b.hasDm ? b.serial : null,
      hasDataMatrix: b.hasDm,
      quad: b.corners.map(([x, y]) => [Math.round(x), Math.round(y)]),
    })
  }

  const e = scene.effects
  const page = `<!doctype html><html><head><style>
    @font-face{font-family:'Inter';src:url(data:font/woff2;base64,${interWoff}) format('woff2');font-weight:100 900}
    html,body{margin:0;padding:0}
    #scene{position:relative;width:${W}px;height:${H}px;overflow:hidden;
      background:
        repeating-linear-gradient(92deg, rgba(90,60,30,.10) 0 3px, rgba(255,255,255,.04) 3px 9px, rgba(60,35,15,.08) 9px 14px),
        linear-gradient(135deg,#b69571,#a07c58 50%,#b89a76);
      filter: brightness(${e.dim ?? 1}) blur(${e.blur ?? 0.3}px) contrast(1.03);}
    #glare{position:absolute;inset:0;background:radial-gradient(ellipse at ${30 + (scene.seed % 40)}% ${25 + (scene.seed % 30)}%, rgba(255,255,255,${e.glare ?? 0}) 0, rgba(255,255,255,0) 45%);pointer-events:none}
    #vig{position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.28) 100%);pointer-events:none}
    #noise{position:absolute;inset:0;opacity:${e.noise ?? 0.07};mix-blend-mode:multiply;pointer-events:none}
  </style></head><body>
  <div id="scene">${html}<div id="glare"></div><div id="vig"></div>
  <svg id="noise" width="${W}" height="${H}"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="${e.noise ? 1.2 : 0.9}" numOctaves="2" seed="${scene.seed}"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg></div>
  </body></html>`
  return { page, truth }
}

const browser = await chromium.launch()
const only = process.argv[2]
const index = []
for (const scene of SCENES) {
  if (only && !scene.id.includes(only)) continue
  const { page: html, truth } = await buildScene(scene)
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(150)
  const jpg = await page.screenshot({
    type: 'jpeg',
    quality: 80,
    clip: { x: 0, y: 0, width: W, height: H },
  })
  writeFileSync(join(outDir, `${scene.id}.jpg`), jpg)
  writeFileSync(
    join(outDir, `${scene.id}.json`),
    JSON.stringify(
      {
        id: scene.id,
        width: W,
        height: H,
        rotation: scene.rot,
        effects: scene.effects,
        boxes: truth,
      },
      null,
      1,
    ),
  )
  index.push({ id: scene.id, boxes: truth.length, kb: Math.round(jpg.length / 1024) })
  await page.close()
  console.log(scene.id, truth.length, 'boxes', Math.round(jpg.length / 1024), 'KB')
}
await browser.close()
writeFileSync(
  join(outDir, 'README.md'),
  `# Synthetic scan fixtures\n\nGenerated by \`npm run gen:fixtures\` (seeded, reproducible). Each \`.jpg\` is a fake photo of medicine boxes on a table with a \`.json\` ground truth (names, strengths, expiry, batch, GTIN, polygon per box).\n\nBrand names are invented placeholders except a few real UAE brand/generic names used to measure drug-list matching. These are NOT real packaging.\n`,
)
