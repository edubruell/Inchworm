/**
 * The terminal panes, and who is allowed to touch them.
 *
 * **A pane belongs to a window, not to a project.** Two windows on the same
 * project have their own shells, so output goes to the owning window alone —
 * the one main → renderer stream that is deliberately not the broadcast the
 * rest of the app uses.
 *
 * Every operation is checked against the *sending* window, exactly as the file
 * handlers are: a renderer must not be able to type into another window's
 * shell, and an id is a number a compromised renderer can guess.
 *
 * `node-pty` never appears here. The spawner is injected, which is what lets
 * the ownership rules, the cap and the cleanup be tested in plain node against
 * a fake — the part that would otherwise only be exercised by a real shell.
 */

import type { Preset, PtyError, PtyEvent, Wire } from '@shared/api.js'
import { err, ok } from '@core/result.js'

/** The slice of a `node-pty` process this module uses. */
export type PtyProcess = {
  readonly onData: (listener: (data: string) => void) => void
  readonly onExit: (listener: (event: { readonly exitCode: number }) => void) => void
  readonly write: (data: string) => void
  readonly resize: (cols: number, rows: number) => void
  readonly kill: () => void
}

export type SpawnRequest = {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly cols: number
  readonly rows: number
}

export type Spawner = (request: SpawnRequest) => PtyProcess

/**
 * What each pane runs. `agent` is the point of the app — the wiki beside the
 * thing that writes it — and `shell` is the escape hatch. There is deliberately
 * no third preset for a build command: a dev loop is one line typed into the
 * shell pane.
 *
 * **The renderer still never chooses an argv.** It names a preset, and for
 * `agent` an id out of settings; main looks the id up and builds the command
 * line here. That is the whole difference between "the agent is configurable"
 * and "the sandboxed side of the bridge can run anything".
 */
export const argsFor = (preset: Preset, agentCommand: string): readonly string[] => {
  switch (preset) {
    case 'agent':
      return ['-l', '-i', '-c', agentCommand]
    case 'shell':
      return ['-l']
  }
}

/**
 * Everything runs through a **login shell**, and not because a shell is wanted:
 * a macOS app launched from the Dock inherits `launchd`'s environment, not the
 * one a terminal has, so `claude` and `npm` are simply not on `PATH` there. The
 * login shell is what makes the packaged app behave like the terminal beside it
 * — the difference is invisible until the app is opened from the Dock.
 *
 * `-i` is there for the same reason and is not decoration. A login shell reads
 * `.zprofile`; it reads **`.zshrc` only when it is interactive**, and `.zshrc`
 * is where a real machine actually builds its `PATH` (homebrew, pyenv, conda,
 * `~/.local/bin`). A `-c` shell has no tty semantics of its own, so without
 * `-i` the preset shell is non-interactive, `claude` is not found, and the pane
 * exits **127** — while the `shell` preset, which is interactive by virtue of
 * having a pty and no `-c`, finds it fine. That asymmetry was the bug: `shell`
 * needs no `-i` because it already is one.
 */
const LOGIN_SHELL = process.env.SHELL ?? '/bin/zsh'

/**
 * Panes per window. The drawer holds tabs, not a tiling manager, and an app
 * that will spawn shells on request until it runs out of file descriptors is a
 * renderer bug away from being unusable.
 */
export const MAX_PANES = 4

type Pane = { readonly windowId: number; readonly process: PtyProcess }

export type PtyHost = {
  readonly start: (
    windowId: number,
    cwd: string,
    input: {
      readonly preset: Preset
      readonly cols: number
      readonly rows: number
      /** The command the `agent` preset runs; resolved from settings by the caller. */
      readonly agentCommand: string
    },
  ) => Wire<{ readonly id: number }, PtyError>
  readonly write: (windowId: number, id: number, data: string) => void
  readonly resize: (windowId: number, id: number, cols: number, rows: number) => void
  readonly kill: (windowId: number, id: number) => void
  /** Every pane the window held, killed. A closed window leaves no shells behind. */
  readonly closeWindow: (windowId: number) => void
  readonly panesOn: (windowId: number) => number
}

export const createPtyHost = (
  spawn: Spawner,
  send: (windowId: number, event: PtyEvent) => void,
): PtyHost => {
  const panes = new Map<number, Pane>()
  let nextId = 1

  /** The pane, only if this window owns it. A miss is silence, never a throw. */
  const owned = (windowId: number, id: number): PtyProcess | undefined => {
    const pane = panes.get(id)
    return pane?.windowId === windowId ? pane.process : undefined
  }

  const panesOn = (windowId: number): number =>
    [...panes.values()].filter((pane) => pane.windowId === windowId).length

  return {
    panesOn,

    start: (windowId, cwd, input): Wire<{ readonly id: number }, PtyError> => {
      if (panesOn(windowId) >= MAX_PANES) return err({ kind: 'too-many' })
      const args = argsFor(input.preset, input.agentCommand)
      const id = nextId
      try {
        const process = spawn({ command: LOGIN_SHELL, args, cwd, cols: input.cols, rows: input.rows })
        nextId += 1
        panes.set(id, { windowId, process })
        process.onData((data) => {
          send(windowId, { kind: 'data', id, data })
        })
        process.onExit((event) => {
          // Forgotten here rather than on the renderer's say-so: a pane whose
          // process is gone must not keep a slot under the cap.
          panes.delete(id)
          send(windowId, { kind: 'exit', id, code: event.exitCode })
        })
        return ok({ id })
      } catch (error: unknown) {
        // `claude` not being on PATH is the ordinary case, not an exception:
        // it reaches the drawer as a sentence, in the pane that would have run it.
        return err({ kind: 'spawn-failed', detail: error instanceof Error ? error.message : String(error) })
      }
    },

    write: (windowId, id, data): void => {
      owned(windowId, id)?.write(data)
    },

    resize: (windowId, id, cols, rows): void => {
      owned(windowId, id)?.resize(cols, rows)
    },

    // The entry stays until `onExit` removes it. Forgetting the handle first
    // means a process that ignores the signal can never be reached again, and
    // `closeWindow` would leave it running.
    kill: (windowId, id): void => {
      owned(windowId, id)?.kill()
    },

    closeWindow: (windowId): void => {
      for (const [id, pane] of [...panes]) {
        if (pane.windowId !== windowId) continue
        panes.delete(id)
        pane.process.kill()
      }
    },
  }
}
