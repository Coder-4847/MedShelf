import type { AliasRecord } from '../../db/types'
import { LABEL_WORDS, aliasKey, normalize, ratio, skeleton, wordTokens } from './text'

export interface DrugEntry {
  name: string
  generic: string
  aliases: string[]
  strengths: string[]
  forms: string[]
  category: string
}

export type MatchKind = 'learned' | 'name' | 'alias' | 'generic'

export interface DrugMatch {
  entry: DrugEntry
  /** The name variant that matched. */
  variant: string
  /** 0..1 */
  score: number
  kind: MatchKind
  /**
   * True when the text equals the name (or differs only by OCR-confusable characters).
   * Anything else is a fuzzy guess and must be shown as "Check this".
   */
  exact: boolean
  /** Unclipped score used only for ordering ties (name > alias > generic). */
  rank?: number
}

/** Score at or above which a name match is treated as reliable; below it, "Check this". */
export const CONFIDENT_MATCH = 0.86
/** Below this a fuzzy hit is discarded as noise. */
export const MIN_MATCH = 0.74

interface Variant {
  norm: string
  skel: string
  tokens: string[]
  entry: DrugEntry
  kind: MatchKind
  raw: string
}

function splitGenerics(generic: string): string[] {
  return generic
    .split(/\s*\+\s*/)
    .map((g) => g.trim())
    .filter(Boolean)
}

export class DrugMatcher {
  private variants: Variant[] = []
  private learned = new Map<string, DrugEntry>()
  private byName = new Map<string, DrugEntry>()

  constructor(drugs: DrugEntry[], learned: AliasRecord[] = []) {
    for (const entry of drugs) {
      this.byName.set(normalize(entry.name), entry)
      this.addVariant(entry.name, entry, 'name')
      for (const alias of entry.aliases) this.addVariant(alias, entry, 'alias')
      const generics = splitGenerics(entry.generic)
      // Combination products are only reachable by brand; single generics are matchable.
      if (generics.length === 1) this.addVariant(generics[0], entry, 'generic')
    }
    for (const a of learned) this.addLearned(a)
  }

  private addVariant(raw: string, entry: DrugEntry, kind: MatchKind) {
    const norm = normalize(raw)
    if (norm.length < 3) return
    this.variants.push({
      norm,
      skel: skeleton(norm),
      tokens: norm.split(' '),
      entry,
      kind,
      raw,
    })
  }

  addLearned(a: AliasRecord) {
    if (a.key.startsWith('gtin:')) return
    const base = this.byName.get(normalize(a.canonical))
    const entry: DrugEntry = base ?? {
      name: a.canonical,
      generic: a.genericName ?? '',
      aliases: [],
      strengths: a.strength ? [a.strength] : [],
      forms: a.form ? [a.form.toLowerCase()] : [],
      category: a.category ?? '',
    }
    this.learned.set(a.key, entry)
  }

  get size(): number {
    return this.variants.length
  }

  findByName(name: string): DrugEntry | undefined {
    return this.byName.get(normalize(name))
  }

  /**
   * Matches a line (or several joined lines) of OCR text against the drug list.
   * Returns the best matches, highest score first.
   */
  match(text: string, limit = 3): DrugMatch[] {
    const words = wordTokens(text)
    if (!words.length) return []
    const results = new Map<DrugEntry, DrugMatch>()
    const consider = (m: DrugMatch) => {
      const prev = results.get(m.entry)
      if (!prev || (m.rank ?? m.score) > (prev.rank ?? prev.score)) results.set(m.entry, m)
    }

    // Learned aliases first: exact key on the whole text or any contiguous word window.
    for (let n = Math.min(4, words.length); n >= 1; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const key = words.slice(i, i + n).join(' ')
        const entry = this.learned.get(key)
        if (entry) consider({ entry, variant: key, score: 0.98, kind: 'learned', exact: true })
      }
    }

    const totalChars = words.join('').length
    const windows: { text: string; skel: string; chars: number; n: number }[] = []
    for (let n = 1; n <= Math.min(4, words.length); n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const slice = words.slice(i, i + n)
        if (n === 1 && LABEL_WORDS.has(slice[0])) continue
        const joined = slice.join(' ')
        windows.push({ text: joined, skel: skeleton(joined), chars: slice.join('').length, n })
      }
    }

    for (const v of this.variants) {
      let best = 0
      let bestExact = false
      for (const w of windows) {
        // Single short words are too ambiguous for fuzzy matching: require them exact.
        const exactOnly = w.text.replace(/ /g, '').length < 5 || v.norm.length < 5
        let s: number
        let exact = false
        if (w.text === v.norm) {
          s = 1
          exact = true
        } else if (w.skel === v.skel) {
          s = 0.96
          exact = true
        } else if (exactOnly) continue
        else {
          if (Math.abs(w.text.length - v.norm.length) > Math.max(3, v.norm.length * 0.35)) continue
          s = Math.max(ratio(w.text, v.norm), ratio(w.skel, v.skel) - 0.02)
        }
        if (s < MIN_MATCH) continue
        // Reward windows that cover most of the alphabetic text on the line; a brand name
        // buried in a long line is slightly less certain than the line being the brand.
        const coverage = Math.min(1, w.chars / Math.max(1, totalChars))
        s *= 0.92 + 0.08 * coverage
        // Longer variants win ties: "Panadol Extra" beats "Panadol" on the text "Panadol Extra".
        s += Math.min(0.01, v.tokens.length * 0.003)
        // On ties the product's own name beats an alias, which beats a generic name that
        // several products share (so "Atorvastatin" resolves to Atorvastatin, not to a brand).
        if (v.kind === 'generic') s -= 0.01
        else if (v.kind === 'name') s += 0.006
        if (s > best) {
          best = s
          bestExact = exact
        }
      }
      if (best >= MIN_MATCH) {
        consider({
          entry: v.entry,
          variant: v.raw,
          score: Math.min(1, best),
          kind: v.kind,
          exact: bestExact,
          rank: best,
        })
      }
    }
    return [...results.values()]
      .sort((a, b) => (b.rank ?? b.score) - (a.rank ?? a.score))
      .slice(0, limit)
  }
}

export { aliasKey }
