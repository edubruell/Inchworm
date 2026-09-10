/**
 * Which window shows which project, and how many of them. One project per
 * window for the window's lifetime, so every project-scoped resource — today
 * the watcher, and only the watcher — is
 * shared by N windows and must be **reference-counted**: started on 0→1 and
 * released on 1→0, never on "a window closed".
 *
 * Bookkeeping only: `watch` is a dependency and changes go to subscribers, which
 * is what lets the refcount be tested without Electron, chokidar or a disk.
 */

import type { OpenProject } from './project.js'

/** What a watcher reports, in project-relative terms. */
export type WatchChange =
  /** Something appeared or vanished: the file list has to be rebuilt. */
  | { readonly kind: 'files' }
  /** One file's bytes changed. */
  | { readonly kind: 'file'; readonly path: string }

export type WatchProject = (project: OpenProject, notify: (change: WatchChange) => void) => () => void

export type Registry = {
  /** Binds a window to a project; starts the watcher if this is the first. */
  readonly attach: (windowId: number, project: OpenProject) => void
  /** Unbinds a window; stops the watcher when the last one on the project goes. */
  readonly detach: (windowId: number) => void
  readonly projectFor: (windowId: number) => OpenProject | undefined
  /**
   * The folder a window last tried and failed to open, kept so the bootstrap
   * panel can offer an agent in it without the renderer ever naming a
   * directory. Any window can have one — the picker opens as a sheet over a
   * window that already has a project — so it is a second folder beside the
   * project and never a substitute for one.
   */
  readonly rememberRefusal: (windowId: number, dir: string) => void
  readonly refusalFor: (windowId: number) => string | undefined
  /**
   * Binds an **agent window** to the folder it is about: a window with no
   * project, showing one agent running where the wiki is about to be. This is
   * what a window *is*, not what it once refused, which is why it is a second
   * map rather than a flag on the first — a picker window that refused a folder
   * is not an agent window on it.
   */
  readonly bindAgent: (windowId: number, dir: string) => void
  readonly agentFolderFor: (windowId: number) => string | undefined
  /**
   * Every agent window on this folder. Two agents writing one folder's
   * `CLAUDE.md` and wiki at once is a race — the opposite of two windows on one
   * project, which is two readers and deliberate.
   */
  readonly agentWindowsOn: (dir: string) => readonly number[]
  /** Every window on this project — the broadcast list. A project-scoped event
   * that answers only the sender desyncs every other window silently. */
  readonly windowsOn: (dir: string) => readonly number[]
  /** Projects with a live watcher; the refcount, observable for tests. */
  readonly watching: () => readonly string[]
  /** Watcher changes, carrying the project they belong to so no lookup is needed. */
  readonly onChange: (listener: (project: OpenProject, change: WatchChange) => void) => void
}

export const createRegistry = (watch: WatchProject): Registry => {
  const windows = new Map<number, OpenProject>()
  const refusals = new Map<number, string>()
  const agents = new Map<number, string>()
  const watchers = new Map<string, () => void>()
  const listeners: ((project: OpenProject, change: WatchChange) => void)[] = []

  const windowsOn = (dir: string): readonly number[] =>
    [...windows.entries()].filter(([, project]) => project.dir === dir).map(([id]) => id)

  const release = (windowId: number): void => {
    const project = windows.get(windowId)
    windows.delete(windowId)
    refusals.delete(windowId)
    agents.delete(windowId)
    // The last window on the project, not the last window: closing one of two
    // windows on the same project must leave the other's watcher alive.
    if (project === undefined || windowsOn(project.dir).length > 0) return
    watchers.get(project.dir)?.()
    watchers.delete(project.dir)
  }

  return {
    rememberRefusal: (windowId, dir): void => {
      refusals.set(windowId, dir)
    },
    refusalFor: (windowId): string | undefined => refusals.get(windowId),

    bindAgent: (windowId, dir): void => {
      agents.set(windowId, dir)
    },
    agentFolderFor: (windowId): string | undefined => agents.get(windowId),
    agentWindowsOn: (dir): readonly number[] =>
      [...agents.entries()].filter(([, at]) => at === dir).map(([id]) => id),

    attach: (windowId, project): void => {
      // Rebinding an id is not in the design (a window keeps its project for
      // life), but a silently orphaned watcher would never be closed again.
      if (windows.has(windowId)) release(windowId)
      windows.set(windowId, project)
      if (watchers.has(project.dir)) return
      watchers.set(
        project.dir,
        watch(project, (change) => {
          for (const listener of listeners) listener(project, change)
        }),
      )
    },
    detach: release,
    projectFor: (windowId): OpenProject | undefined => windows.get(windowId),
    windowsOn,
    watching: (): readonly string[] => [...watchers.keys()],
    onChange: (listener): void => {
      listeners.push(listener)
    },
  }
}
