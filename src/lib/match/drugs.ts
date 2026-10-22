import { db } from '../../db'
import { DrugMatcher, type DrugEntry } from './matcher'

let drugsPromise: Promise<DrugEntry[]> | null = null

/** drugs.json is loaded on demand so it stays out of the initial bundle. */
export function loadDrugs(): Promise<DrugEntry[]> {
  drugsPromise ??= import('../../data/drugs.json').then((m) => m.default as DrugEntry[])
  return drugsPromise
}

/** Builds a matcher including any aliases the user has taught the app. */
export async function createMatcher(): Promise<DrugMatcher> {
  const [drugs, learned] = await Promise.all([loadDrugs(), db.aliases.toArray()])
  return new DrugMatcher(drugs, learned)
}
