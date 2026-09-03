/**
 * The non-colour half of every signal the viewer shows.
 *
 * A state is never signalled by colour alone, and a failure is announced
 * rather than merely tinted. Both are decisions about *words and roles*, so
 * they live here as pure functions rather than inside a component's JSX —
 * which is what lets them be tested without a DOM at all.
 */

import type { CapStatus } from '@core/caps.js'
import type { DebtKind } from '@core/debt.js'
import type { Preset } from '@shared/api.js'
import type { NoteStatus } from '@core/frontmatter.js'

/** ⬤ active · ◐ proposal · ○ superseded. */
export const statusGlyph = (status: NoteStatus): string => {
  switch (status.kind) {
    case 'active':
      return '⬤'
    case 'proposal':
      return '◐'
    case 'superseded':
      return '○'
  }
}

/**
 * A note's status as a word. The superseded arm names its successor, so the
 * chip and the sidebar tooltip cannot disagree about what "superseded" means.
 */
export const statusLabel = (status: NoteStatus): string =>
  status.kind === 'superseded' ? `superseded by ${String(status.by)}` : status.kind

/**
 * A live region only where something is actually wrong: over cap is an alert,
 * near cap a status, and a file with room to grow announces nothing at all.
 */
export const capRole = (cap: CapStatus): 'alert' | 'status' | undefined => {
  switch (cap.kind) {
    case 'over':
      return 'alert'
    case 'near':
      return 'status'
    case 'ok':
    case 'uncapped':
      return undefined
  }
}

/** The gauge as a sentence; `long` is the header card, short is a sidebar row. */
export const capLabel = (cap: CapStatus, long: boolean): string => {
  if (cap.kind === 'uncapped') return long ? `${String(cap.lines)} lines` : String(cap.lines)
  const suffix = cap.kind === 'over' ? ' · over cap' : cap.kind === 'near' ? ' · near cap' : ''
  return long
    ? `${String(cap.lines)} lines · cap ${String(cap.cap)}${suffix}`
    : `${String(cap.lines)}/${String(cap.cap)}${cap.kind === 'over' ? ' over' : ''}`
}

/** The tooltip: the same numbers, spelled out. */
export const capTitle = (cap: CapStatus): string =>
  cap.kind === 'uncapped'
    ? `${String(cap.lines)} lines · no cap`
    : `${String(cap.lines)} of ${String(cap.cap)} lines`

/**
 * The open-contentions count as a sentence. Zero is worth showing rather than
 * hiding — "no open contentions" is a real state of a project, and a badge that
 * appears and vanishes is a badge nobody learns to read.
 */
export const contentionsLabel = (open: number): string => {
  if (open === 0) return 'no open contentions'
  return open === 1 ? '1 open contention' : `${String(open)} open contentions`
}

/**
 * Unsaved drafts, as a sentence. Only ever shown when there is at least one —
 * unlike the contention count, "nothing unsaved" is the resting state of the
 * app and not a fact worth a slot in the rail.
 */
export const unsavedLabel = (count: number): string =>
  count === 1 ? '1 unsaved file' : `${String(count)} unsaved files`

/**
 * A pane's name. The preset is an enum on the wire and a word on screen, so a
 * reader can tell the agent from a shell without reading the colour — the same
 * rule every other signal in the window follows.
 */
export const presetLabel = (preset: Preset): string => {
  switch (preset) {
    case 'agent':
      return 'agent'
    case 'shell':
      return 'shell'
  }
}

/**
 * How loud a pane's tab is, as a *shade* of the project hue and never a hue of
 * its own: the agent pane is the loudest thing in the window, a secondary pane
 * is the line colour, and a plain shell is neutral.
 */
export const presetShade = (preset: Preset): 'loud' | 'none' => {
  switch (preset) {
    case 'agent':
      return 'loud'
    case 'shell':
      return 'none'
  }
}

/**
 * A debt kind as the word the sidebar shows. The checkers' own names are the
 * schema's (`unswept`, `unfiled`, `unlinked`, and the sentinel's unpaired
 * entry) and they are precise but private; a reader needs to know what is owed,
 * so each is spelled as the *action* it is waiting for.
 */
export const debtLabel = (kind: DebtKind): string => {
  switch (kind) {
    case 'unstamped':
      return 'note not swept'
    case 'unswept':
      return 'marker still set'
    case 'unfiled':
      return 'no marker'
    case 'unlinked':
      return 'named nowhere'
  }
}

/**
 * The section's own count, as a sentence. Unlike the contention badge this one
 * hides at zero: an empty debt list is the resting state of a wiki that is
 * being kept, and a permanent "0 not written up" is a line readers stop seeing.
 */
export const debtCountLabel = (count: number): string =>
  count === 1 ? '1 thing not written up' : `${String(count)} things not written up`

/**
 * What to say when a checker could not answer. The list below it is partial,
 * and saying so is the whole point — a debt section that silently drops a
 * checker reads as "clean", which is the one thing it must never say falsely.
 */
export const debtFailedLabel = (failed: readonly string[]): string | undefined =>
  failed.length === 0 ? undefined : `${String(failed.length)} checker(s) could not run — this list is partial`
