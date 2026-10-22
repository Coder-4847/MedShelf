import { describe, expect, it } from 'vitest'
import drugs from '../../src/data/drugs.json'
import { CONFIDENT_MATCH, DrugMatcher, type DrugEntry } from '../../src/lib/match/matcher'
import { aliasKey, levenshtein, normalize, skeleton } from '../../src/lib/match/text'

const matcher = new DrugMatcher(drugs as DrugEntry[])
const top = (t: string) => matcher.match(t)[0]

describe('drugs.json', () => {
  it('has the required shape and size', () => {
    const list = drugs as DrugEntry[]
    expect(list.length).toBeGreaterThanOrEqual(400)
    for (const d of list) {
      expect(typeof d.name).toBe('string')
      expect(Array.isArray(d.aliases)).toBe(true)
      expect(Array.isArray(d.strengths)).toBe(true)
      expect(Array.isArray(d.forms)).toBe(true)
      expect(d.category).toBeTruthy()
    }
    const names = list.map((d) => d.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })
  it('contains the UAE names called out in the brief', () => {
    const names = new Set((drugs as DrugEntry[]).map((d) => d.name.toLowerCase()))
    for (const n of [
      'panadol',
      'adol',
      'brufen',
      'nurofen',
      'voltaren',
      'augmentin',
      'amoxil',
      'zithromax',
      'ventolin',
      'telfast',
      'zyrtec',
      'claritin',
      'nexium',
      'losec',
      'omeprazole',
      'gaviscon',
      'buscopan',
      'imodium',
      'cataflam',
      'cetal',
      'congestal',
      'strepsils',
      'otrivin',
      'betadine',
      'vitamin d3',
      'vitamin c',
      'omega-3',
      'ors',
    ]) {
      expect(names.has(n), n).toBe(true)
    }
  })
})

describe('text helpers', () => {
  it('normalises', () => {
    expect(normalize('Cold & Flu!')).toBe('cold and flu')
    expect(normalize('Béta-Dine')).toBe('beta dine')
  })
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('abc', 'abc')).toBe(0)
  })
  it('collapses OCR confusables', () => {
    expect(skeleton('panad0l')).toBe(skeleton('panadol'))
    expect(skeleton('rnotilium')).toBe(skeleton('motilium'))
  })
  it('builds alias keys without strengths', () => {
    expect(aliasKey('PANADOOL 500 mg')).toBe('panadool')
  })
})

describe('fuzzy matching', () => {
  it('matches exact brand names confidently', () => {
    expect(top('PANADOL')?.entry.name).toBe('Panadol')
    expect(top('PANADOL')?.score).toBeGreaterThanOrEqual(CONFIDENT_MATCH)
    expect(top('Augmentin 625 mg')?.entry.name).toBe('Augmentin')
  })
  it('prefers the more specific brand variant', () => {
    expect(top('Panadol Extra 500 mg')?.entry.name).toBe('Panadol Extra')
    expect(top('Panadol Cold & Flu')?.entry.name).toBe('Panadol Cold & Flu')
  })
  it('tolerates typical OCR errors', () => {
    expect(top('Panado1')?.entry.name).toBe('Panadol')
    expect(top('BRUFEN 4OO')?.entry.name).toBe('Brufen')
    expect(top('Zithromax')?.entry.name).toBe('Zithromax')
    expect(top('Zithromaz')?.entry.name).toBe('Zithromax')
    expect(top('Nurofen')?.entry.name).toBe('Nurofen')
    expect(top('Buscopan')?.entry.name).toBe('Buscopan')
    expect(top('Gaviscon Advance')?.entry.name).toBe('Gaviscon')
  })
  it('matches generics', () => {
    expect(top('Paracetamol 500 mg Tablets')?.entry.name).toBe('Paracetamol')
    expect(top('IBUPROFEN 400mg')?.entry.name).toBe('Ibuprofen')
    expect(top('Amoxicillin')?.entry.name).toBe('Amoxicillin')
  })
  it('matches an alias', () => {
    expect(top('Vit D3')?.entry.name).toBe('Vitamin D3')
  })
  it('does not match label boilerplate or invented names', () => {
    for (const t of [
      'film coated tablets',
      'Keep out of reach of children',
      'Store below 25 C',
      'Manufactured by',
      'Zentora',
      'Veldrin',
      'Nuvira Plus',
      'Lorvexa',
    ]) {
      const m = top(t)
      expect(
        m === undefined || m.score < CONFIDENT_MATCH,
        `${t} -> ${m?.entry.name} ${m?.score}`,
      ).toBe(true)
    }
  })
  it('returns nothing for empty or numeric text', () => {
    expect(matcher.match('')).toEqual([])
    expect(matcher.match('500 mg 20')).toEqual([])
  })
})

describe('learned aliases', () => {
  it('applies a learned OCR misread to a known drug', () => {
    const m = new DrugMatcher(drugs as DrugEntry[], [
      { key: 'panakol', canonical: 'Panadol', count: 1, updatedAt: 0 },
    ])
    expect(m.match('PANAKOL 500 mg')[0]).toMatchObject({ kind: 'learned', score: 0.98 })
    expect(m.match('PANAKOL')[0].entry.name).toBe('Panadol')
  })
  it('supports custom medicines not in the list', () => {
    const m = new DrugMatcher(drugs as DrugEntry[], [
      { key: 'zentora', canonical: 'Zentora Forte', strength: '10 mg', count: 1, updatedAt: 0 },
    ])
    const hit = m.match('ZENTORA')[0]
    expect(hit.entry.name).toBe('Zentora Forte')
    expect(hit.entry.strengths).toEqual(['10 mg'])
  })
})
