/**
 * The window's unsaved work: one draft per file the reader has opened for
 * editing, held until it is saved or dropped.
 *
 * Drafts survive navigation. Going to another note and coming back must not
 * lose what was typed — this is a workbench beside a running agent, and the
 * reader is interrupted constantly.
 *
 * **Nothing is ever merged and nothing is overwritten by accident.** A write
 * carries the sha the draft started from; main refuses it if the file moved,
 * and the refusal reaches the reader as a banner with two explicit ways out.
 */

import { createMemo, createSignal } from 'solid-js'
import type { WikiApi } from '@shared/api.js'
import type { Draft, EditState } from './edit.js'
import { canSave, editState } from './edit.js'
import { fileMessage } from './messages.js'
import type { NoteStore } from './noteStore.js'
import { withKey, withoutKey } from './maps.js'

export type Drafts = {
  readonly get: (path: string) => Draft | undefined
  /** Seeds a draft from what the store holds, if there is not one already. */
  readonly open: (path: string) => void
  readonly change: (path: string, text: string) => void
  /** Throws the draft away and takes the bytes on disk. */
  readonly reload: (path: string) => void
  readonly save: (path: string) => void
  /** Saves over the other change, on the reader's explicit say-so. */
  readonly overwrite: (path: string) => void
  readonly state: (path: string) => EditState | undefined
  /** The sha now on disk, when a save was refused because the file moved. */
  readonly conflict: (path: string) => string | undefined
  readonly failure: (path: string) => string | undefined
  readonly saving: (path: string) => boolean
  /** Every path with unwritten changes — what the status rail counts. */
  readonly unsaved: () => readonly string[]
}

export const createDrafts = (api: WikiApi, store: NoteStore): Drafts => {
  const [drafts, setDrafts] = createSignal<ReadonlyMap<string, Draft>>(new Map())
  const [conflicts, setConflicts] = createSignal<ReadonlyMap<string, string>>(new Map())
  const [failures, setFailures] = createSignal<ReadonlyMap<string, string>>(new Map())
  const [saving, setSaving] = createSignal<ReadonlySet<string>>(new Set())

  const seed = (path: string): Draft | undefined => {
    const entry = store.get(path)
    return entry === undefined
      ? undefined
      : { path, text: entry.text, savedText: entry.text, baseSha: entry.sha }
  }

  const put = (path: string, draft: Draft): void => {
    setDrafts((current) => withKey(current, path, draft))
  }

  const clear = (path: string): void => {
    setConflicts((current) => (current.has(path) ? withoutKey(current, path) : current))
    setFailures((current) => (current.has(path) ? withoutKey(current, path) : current))
  }

  /**
   * The reply to a write that has landed. The draft is stamped **only if it is
   * still the draft that was written**: a reload or an overwrite while the
   * write was in flight replaces it, and stamping the replacement marked bytes
   * as saved that were never sent, and arms the next ⌘S to put them back over
   * the save that just succeeded.
   */
  const settle = (path: string, written: string, sha: string, guardedOn: string): void => {
    const draft = drafts().get(path)
    if (draft?.baseSha === guardedOn) put(path, { ...draft, savedText: written, baseSha: sha })
    // The store is told before the watcher gets there, or the window spends the
    // gap believing its own save was someone else's change.
    store.settle(path, written, sha)
  }

  const write = (path: string, baseSha: string): void => {
    const draft = drafts().get(path)
    if (draft === undefined || saving().has(path)) return
    // Captured, not re-read on arrival: the reader may type while the write is
    // in flight, and what was written is what must count as saved.
    const written = draft.text
    setSaving((current) => new Set(current).add(path))
    api
      .writeFile({ path, text: written, baseSha })
      .then((result) => {
        if (result.ok) {
          clear(path)
          settle(path, written, result.value.sha, baseSha)
          return
        }
        // Bound before the setter: narrowing does not survive into a callback.
        const error = result.error
        if (error.kind === 'conflict') setConflicts((current) => withKey(current, path, error.currentSha))
        else setFailures((current) => withKey(current, path, fileMessage(error)))
      })
      .catch((error: unknown) => {
        console.error('[Inchworm] writeFile', path, error)
        setFailures((current) => withKey(current, path, 'Could not be saved: the app could not reach the file service.'))
      })
      .finally(() => {
        setSaving((current) => {
          const next = new Set(current)
          next.delete(path)
          return next
        })
      })
  }

  const unsaved = createMemo(() =>
    [...drafts().values()].filter((draft) => draft.text !== draft.savedText).map((draft) => draft.path),
  )

  return {
    get: (path) => drafts().get(path),

    open: (path): void => {
      if (drafts().has(path)) return
      const fresh = seed(path)
      if (fresh !== undefined) put(path, fresh)
    },

    change: (path, text): void => {
      const draft = drafts().get(path)
      if (draft !== undefined && draft.text !== text) put(path, { ...draft, text })
    },

    reload: (path): void => {
      clear(path)
      const fresh = seed(path)
      setDrafts((current) => (fresh === undefined ? withoutKey(current, path) : withKey(current, path, fresh)))
    },

    // ⌘S on a file with nothing unwritten is a no-op, not a write: an
    // unconditional save would touch the file's mtime — and every watcher on
    // it — for nothing.
    save: (path): void => {
      const draft = drafts().get(path)
      if (draft !== undefined && canSave(editState(draft, store.get(path)?.sha))) write(path, draft.baseSha)
    },

    // The reader has seen both sentences and chosen: the guard is re-aimed at
    // what is on disk *now*, so the write is a deliberate overwrite rather than
    // a race that happens to land.
    overwrite: (path): void => {
      const currentSha = conflicts().get(path)
      if (currentSha !== undefined) {
        clear(path)
        write(path, currentSha)
      }
    },

    state: (path): EditState | undefined => {
      const draft = drafts().get(path)
      return draft === undefined ? undefined : editState(draft, store.get(path)?.sha)
    },

    conflict: (path) => conflicts().get(path),
    failure: (path) => failures().get(path),
    saving: (path) => saving().has(path),
    unsaved,
  }
}
