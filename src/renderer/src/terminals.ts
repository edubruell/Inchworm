/**
 * The window's terminal panes: what is open, which one is in front, and where
 * each pane's bytes go.
 *
 * A pane belongs to **this window**, not to the project — two windows on the
 * same project have their own shells — so this subscribes to the window's own
 * stream and never to a broadcast.
 *
 * Output can arrive before an `xterm` has been attached to receive it: a shell
 * prints its prompt in the same millisecond it starts. Each pane therefore
 * keeps a bounded backlog, which is replayed on attach and dropped after.
 */

import { createSignal, onCleanup } from 'solid-js'
import type { Launcher, Preset, PtyEvent, WikiApi } from '@shared/api.js'
import { dropText } from '@core/shell.js'
import { ptyMessage } from './messages.js'
import { presetLabel } from './signals.js'

export type Pane = {
  readonly id: number
  readonly preset: Preset
  /**
   * What the tab says. For `agent` panes it is the launcher's own label, so a
   * window running two different agents has two distinguishable tabs rather
   * than two tabs saying "agent".
   */
  readonly label: string
  /** The process is gone; the output stays readable until the tab is closed. */
  readonly exited: number | undefined
}

/** Bytes held for a pane nothing is listening to yet. A prompt, not a session. */
const BACKLOG = 64_000

export type Terminals = {
  readonly panes: () => readonly Pane[]
  readonly active: () => number | undefined
  readonly select: (id: number) => void
  /**
   * `launcher` names *which* agent, by id — the command itself is main's, and
   * the renderer never learns it.
   */
  readonly start: (preset: Preset, cols: number, rows: number, launcher?: Launcher) => void
  readonly close: (id: number) => void
  readonly failure: () => string | undefined
  /** Where one pane's bytes go. Returns its own unsubscribe. */
  readonly attach: (id: number, sink: (data: string) => void) => () => void
  readonly send: (id: number, data: string) => void
  readonly resize: (id: number, cols: number, rows: number) => void
  /** Files dropped on a pane, typed into it as quoted paths. Never a newline. */
  readonly drop: (id: number, files: readonly File[]) => void
}

export const createTerminals = (api: WikiApi): Terminals => {
  const [panes, setPanes] = createSignal<readonly Pane[]>([])
  const [active, setActive] = createSignal<number>()
  const [failure, setFailure] = createSignal<string>()

  const sinks = new Map<number, (data: string) => void>()
  const backlog = new Map<number, string>()

  const deliver = (event: PtyEvent): void => {
    if (event.kind === 'exit') {
      setPanes((current) =>
        current.map((pane) => (pane.id === event.id ? { ...pane, exited: event.code } : pane)),
      )
      return
    }
    // A pane the window has closed keeps producing bytes until its process is
    // actually gone; without this they accumulate in a backlog nothing will
    // ever read.
    if (!panes().some((pane) => pane.id === event.id)) return
    const sink = sinks.get(event.id)
    if (sink !== undefined) {
      sink(event.data)
      return
    }
    // Kept from the end: a pane that has printed a screenful before anyone
    // looked should show the last screenful, not the first.
    const held = (backlog.get(event.id) ?? '') + event.data
    backlog.set(event.id, held.length > BACKLOG ? held.slice(-BACKLOG) : held)
  }

  onCleanup(api.onPtyEvent(deliver))

  return {
    panes,
    active,
    failure,

    select: (id): void => {
      setActive(id)
    },

    start: (preset, cols, rows, launcher): void => {
      setFailure(undefined)
      api
        .startPty({ preset, cols, rows, launcherId: launcher?.id })
        .then((result) => {
          if (!result.ok) {
            setFailure(ptyMessage(result.error))
            return
          }
          const pane: Pane = {
            id: result.value.id,
            preset,
            label: launcher?.label ?? presetLabel(preset),
            exited: undefined,
          }
          setPanes((current) => [...current, pane])
          setActive(pane.id)
        })
        .catch((error: unknown) => {
          console.error('[Inchworm] startPty', error)
          setFailure('Could not be started: the app could not reach the terminal service.')
        })
    },

    close: (id): void => {
      void api.killPty({ id })
      sinks.delete(id)
      backlog.delete(id)
      setPanes((current) => current.filter((pane) => pane.id !== id))
      setActive((current) => (current === id ? panes().find((pane) => pane.id !== id)?.id : current))
    },

    attach: (id, sink): (() => void) => {
      sinks.set(id, sink)
      const held = backlog.get(id)
      if (held !== undefined) {
        backlog.delete(id)
        sink(held)
      }
      return (): void => {
        if (sinks.get(id) === sink) sinks.delete(id)
      }
    },

    send: (id, data): void => {
      void api.writePty({ id, data })
    },

    resize: (id, cols, rows): void => {
      void api.resizePty({ id, cols, rows })
    },

    // A drop that carries no file with a path — a text selection, an image
    // dragged out of a browser — types nothing. Silence is the right answer:
    // there is no path to offer and a stray space is worse than none.
    drop: (id, files): void => {
      const paths = files.map((file) => api.pathForFile(file)).filter((path) => path !== '')
      const text = dropText(paths)
      if (text !== '') void api.writePty({ id, data: text })
    },
  }
}
