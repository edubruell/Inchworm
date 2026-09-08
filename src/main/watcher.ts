/**
 * The chokidar half of the refcounted watcher. On macOS chokidar sits on
 * fsevents, so a recursive watch is cheap — and there are only two of them:
 * the wiki root and the journal, plus CLAUDE.md.
 *
 * The agent writes in bursts (a close touches five registers in a second), so
 * appearances and disappearances coalesce into one "rebuild the list"; content
 * changes stay per-file, because the renderer re-reads the file that moved.
 */

import { watch } from 'chokidar'
import { watchTargets } from './files.js'
import { isDotPath, relativePosix } from './paths.js'
import type { WatchChange, WatchProject } from './registry.js'

/** Long enough to swallow a burst, short enough that "within a second" holds. */
const COALESCE_MS = 100

export const watchProject: WatchProject = (project, notify) => {
  const watcher = watch([...watchTargets(project.dir, project.layout)], {
    ignoreInitial: true,
    // A dotfile is not wiki content, and `.git` under a watched root would
    // deliver an event per index write. Asked of the *project-relative* path:
    // a project living under `~/.claude/` is not a project with no events.
    ignored: (path: string) => isDotPath(relativePosix(project.dir, path)),
    // The agent's writes are not atomic; without this a half-written note is
    // read and parsed before the rest of it lands.
    awaitWriteFinish: { stabilityThreshold: COALESCE_MS, pollInterval: 20 },
  })

  let pending: NodeJS.Timeout | undefined
  const coalesced = (change: WatchChange): void => {
    if (pending !== undefined) return
    pending = setTimeout(() => {
      pending = undefined
      notify(change)
    }, COALESCE_MS)
  }

  watcher.on('all', (event, path) => {
    if (event === 'change') notify({ kind: 'file', path: relativePosix(project.dir, path) })
    else coalesced({ kind: 'files' })
  })
  // An unhandled watcher error is an uncaught exception in main, which takes
  // every window with it; a directory that vanished is not worth the app.
  watcher.on('error', (error: unknown) => {
    console.error('[Inchworm] watcher', error)
  })

  /**
   * The listener goes *synchronously*; the watcher closes when it closes.
   * `close()` is a promise, so a stop is otherwise a request rather than an
   * effect, and chokidar can still deliver between the call and the close
   * landing — whether it does depends on how fast the platform's event source
   * is. fsevents wins that race almost always; the macOS CI runner did not
   * (2026-09-08), and neither inotify nor ReadDirectoryChangesW is under any
   * obligation to. Dropping the `all` listener costs nothing and makes the
   * silence the caller was promised true immediately.
   *
   * Only `all`: `error` stays, because an EventEmitter with no error listener
   * *throws* on one, and chokidar may report during a close. Removing every
   * listener would turn a vanished directory into an uncaught exception in
   * main, which is precisely what the handler above exists to prevent.
   */
  return (): void => {
    if (pending !== undefined) clearTimeout(pending)
    watcher.removeAllListeners('all')
    watcher.close().catch((error: unknown) => {
      console.error('[Inchworm] watcher close', error)
    })
  }
}
