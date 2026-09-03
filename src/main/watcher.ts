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

  return (): void => {
    if (pending !== undefined) clearTimeout(pending)
    watcher.close().catch((error: unknown) => {
      console.error('[Inchworm] watcher close', error)
    })
  }
}
