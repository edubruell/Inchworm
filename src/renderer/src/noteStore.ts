/**
 * The window's model of its project: every file read once, parsed once, and
 * kept until the file changes on disk.
 *
 * **Why every file and not the open one.** The sidebar shows a status dot and a
 * cap gauge per row and the rail shows backlinks, and all three are functions
 * of a *parse* — of every note, not of the selected one. So the choice is not
 * "read everything or read one", it is "read everything once and reuse it, or
 * re-read on every keystroke".
 *
 * **One parse per change, not per view**: a watcher event re-reads exactly the
 * file that moved, and `renderHtml` is handed the AST that is already here.
 */

import { createMemo, createRenderEffect, createSignal, onCleanup, type Accessor } from 'solid-js'
import type { Backlink, LinkIndex, LinkResolution } from '@core/links.js'
import type { NoteState } from '@core/note.js'
import { backlinkIndex, buildLinkIndex, resolveLink } from '@core/links.js'
import { parseNote } from '@core/note.js'
import type { ProjectSnapshot, WikiApi } from '@shared/api.js'
import { fileMessage } from './messages.js'
import { withoutKey } from './maps.js'

export type Loaded = {
  readonly path: string
  readonly text: string
  readonly sha: string
  readonly note: NoteState
}

/** The bridge itself failed — not something `fileMessage` has a sentence for. */
const BRIDGE_FAILURE = 'Could not be read: the app could not reach the file service.'

export type NoteStore = {
  readonly get: (path: string) => Loaded | undefined
  /**
   * The bytes this window just wrote, taken as read. The watcher will say the
   * same thing a moment later, and without this the window spends that moment
   * believing the file it saved has changed underneath it — a conflict banner
   * over its own save.
   */
  readonly settle: (path: string, text: string, sha: string) => void
  readonly failure: (path: string) => string | undefined
  readonly resolve: (target: string) => LinkResolution
  readonly backlinksTo: (path: string) => readonly Backlink[]
  readonly index: Accessor<LinkIndex>
}

export const createNoteStore = (api: WikiApi, project: Accessor<ProjectSnapshot>): NoteStore => {
  const [loaded, setLoaded] = createSignal<ReadonlyMap<string, Loaded>>(new Map())
  const [failures, setFailures] = createSignal<ReadonlyMap<string, string>>(new Map())

  /**
   * Per-path request counter. Two watcher events in the same burst mean two
   * reads in flight, and IPC replies are not ordered — without the ticket the
   * older answer can land last and pin the pane to text that is no longer on
   * disk. **Monotonic and never cleared**: resetting it let a fresh read draw
   * the same number as one still in flight, which is the guard defeating
   * itself.
   *
   * It is a plain `Map`, not a signal: the loading effect must not depend on
   * what has arrived, or every arrival re-runs it and re-requests everything
   * still in flight.
   */
  const latest = new Map<string, number>()
  /** What has been asked for, so a file is read once — pruned when it leaves. */
  const requested = new Set<string>()

  const forget = (path: string): void => {
    requested.delete(path)
    setLoaded((current) => (current.has(path) ? withoutKey(current, path) : current))
    setFailures((current) => (current.has(path) ? withoutKey(current, path) : current))
  }

  const load = (path: string): void => {
    const ticket = (latest.get(path) ?? 0) + 1
    latest.set(path, ticket)
    requested.add(path)
    api
      .readFile(path)
      .then((result) => {
        // Stale reply, or the file left the project while it was in flight.
        if (latest.get(path) !== ticket || !requested.has(path)) return
        if (!result.ok) {
          // The stale body goes with the failure: a banner over the previous
          // render presents bytes that are provably not on disk as the note.
          setLoaded((current) => (current.has(path) ? withoutKey(current, path) : current))
          setFailures((current) => new Map(current).set(path, fileMessage(result.error)))
          return
        }
        const { text, sha } = result.value
        setFailures((current) => (current.has(path) ? withoutKey(current, path) : current))
        setLoaded((current) => new Map(current).set(path, { path, text, sha, note: parseNote(text) }))
      })
      .catch((error: unknown) => {
        // A rejection is the bridge failing, not the file: without this the pane
        // renders nothing at all and says nothing.
        console.error('[Inchworm] readFile', path, error)
        if (latest.get(path) === ticket && requested.has(path)) {
          setFailures((current) => new Map(current).set(path, BRIDGE_FAILURE))
        }
      })
  }

  // A *render* effect, so the first read is issued in the same reactive pass the
  // window learns its project in rather than one paint later.
  //
  // The file list is the project snapshot's, which the watcher keeps current:
  // new files are read, deleted ones are dropped, and a file already held is
  // left alone — re-reading the whole project on every add would re-parse it.
  createRenderEffect(() => {
    const files = new Set(project().files)
    for (const path of files) if (!requested.has(path)) load(path)
    // Over `requested`, not over what has arrived: a file whose first read is
    // still in flight is in neither map, so pruning by `loaded` would leave it
    // permanently claimed and never re-read.
    for (const path of [...requested]) if (!files.has(path)) forget(path)
  })

  onCleanup(
    api.onProjectEvent((event) => {
      // The path must be one this project lists: an event is a message, and the
      // window reads only what its own snapshot names. A file that is genuinely
      // new arrives as a `files` event first, which is what starts its read.
      if (event.kind !== 'file' || event.dir !== project().dir) return
      if (project().files.includes(event.path)) load(event.path)
    }),
  )

  const index = createMemo(() => buildLinkIndex(project().files, project().layout))

  const backlinks = createMemo(() =>
    backlinkIndex(
      [...loaded().values()].flatMap((entry) =>
        entry.note.kind === 'parsed' ? [{ path: entry.path, links: entry.note.links }] : [],
      ),
      index(),
    ),
  )

  return {
    get: (path) => loaded().get(path),
    settle: (path, text, sha): void => {
      // The ticket moves too: a read still in flight was issued against the
      // *older* bytes, and letting it land would undo the save in the view.
      latest.set(path, (latest.get(path) ?? 0) + 1)
      requested.add(path)
      setFailures((current) => (current.has(path) ? withoutKey(current, path) : current))
      setLoaded((current) => new Map(current).set(path, { path, text, sha, note: parseNote(text) }))
    },
    failure: (path) => failures().get(path),
    resolve: (target) => resolveLink(target, index()),
    backlinksTo: (path) => backlinks().get(path) ?? [],
    index,
  }
}
