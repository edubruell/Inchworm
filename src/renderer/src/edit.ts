/**
 * What an open draft *is*, as words and roles rather than as pixels — the same
 * split `signals.ts` makes, and for the same reason: "the file moved under
 * you" is an accessibility statement before it is a colour.
 *
 * The app never merges and never silently reloads. Both halves of a divergence
 * stay on screen and the reader chooses.
 */

export type Draft = {
  readonly path: string
  /** What is in the editor now. */
  readonly text: string
  /** The bytes last known to be on disk — written by us, or read from there. */
  readonly savedText: string
  /** The sha the next write is guarded on. */
  readonly baseSha: string
}

export type EditState =
  | 'clean'
  /** Edited here, untouched there. */
  | 'dirty'
  /** Touched there, untouched here — safe to take. */
  | 'stale'
  /** Both sides moved. Nothing is overwritten without a second sentence. */
  | 'diverged'

export const editState = (draft: Draft, diskSha: string | undefined): EditState => {
  const moved = diskSha !== undefined && diskSha !== draft.baseSha
  const edited = draft.text !== draft.savedText
  if (edited) return moved ? 'diverged' : 'dirty'
  return moved ? 'stale' : 'clean'
}

/** Nothing to write is not a failure, it is just nothing to write. */
export const canSave = (state: EditState): boolean => state === 'dirty' || state === 'diverged'

export const editLabel = (state: EditState): string => {
  switch (state) {
    case 'clean':
      return 'saved'
    case 'dirty':
      return 'unsaved changes'
    case 'stale':
      return 'changed on disk — reload to see it'
    case 'diverged':
      return 'changed on disk and here — saving would overwrite the other change'
  }
}

/** Amber while both sides hold something; silent while only one does. */
export const editRole = (state: EditState): 'status' | undefined =>
  state === 'stale' || state === 'diverged' ? 'status' : undefined
