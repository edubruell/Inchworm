/**
 * Cap reporting. The app **shows** a cap and never enforces one: trimming a
 * file to fit would delete memory, which is the failure the caps exist to
 * prevent.
 */

import type { WikiFileKind } from './classify.js'
import { CAP } from './schema.js'

/** Amber at 80 % of the cap, red past it. */
export const NEAR_CAP = 0.8

export type CapStatus =
  | { readonly kind: 'uncapped'; readonly lines: number }
  | {
      readonly kind: 'ok' | 'near' | 'over'
      readonly lines: number
      readonly cap: number
      /** `lines / cap`, for the gauge; > 1 when over. */
      readonly fraction: number
    }

/** The cap that applies to a file, or `undefined` for the uncapped kinds. */
export const capFor = (kind: WikiFileKind): number | undefined => {
  switch (kind.kind) {
    case 'state':
      return CAP.state
    case 'register':
      return CAP.register
    case 'claudeMd':
      return CAP.claudeMd
    // Notes, journal entries and archives are deliberately uncapped: they are
    // curated or append-only history, not the churn file.
    case 'note':
    case 'journal':
    case 'archive':
    case 'other':
      return undefined
  }
}

/** A cap of zero or less is no cap: `lines / 0` is a `NaN` gauge, not a reading. */
export const capStatus = (lines: number, cap: number | undefined): CapStatus => {
  if (cap === undefined || cap <= 0) return { kind: 'uncapped', lines }
  const fraction = lines / cap
  const kind = lines > cap ? 'over' : fraction >= NEAR_CAP ? 'near' : 'ok'
  return { kind, lines, cap, fraction }
}
