/**
 * The window's view of what has landed and not been written up. It holds a
 * report, asks for a new one, and does nothing else — the checkers run in main,
 * and the renderer never names one to *run*; it only repeats the name of one
 * that failed, because a list that quietly went partial is worse than a list
 * that says which half is missing.
 *
 * **Coalesced, never stacked.** A save fires a watcher event, and a checker
 * takes a second or two; asking again while one is in flight would queue spawns
 * behind a section nobody is looking at. One run at a time, and one more
 * afterwards if anything asked while it ran — which is the whole of the
 * refresh policy the design settled on (open · watcher · manual).
 */

import { createSignal } from 'solid-js'
import type { DebtError, DebtReport, WikiApi } from '@shared/api.js'

export type DebtStore = {
  readonly report: () => DebtReport | undefined
  readonly error: () => DebtError | undefined
  readonly checking: () => boolean
  /** Ask for a fresh answer. Cheap to call from an event handler. */
  readonly refresh: () => void
  /**
   * Stop asking. A window closing with a run queued would otherwise spawn one
   * more pair of checkers for a window that is gone.
   */
  readonly dispose: () => void
}

export const createDebtStore = (api: WikiApi): DebtStore => {
  const [report, setReport] = createSignal<DebtReport>()
  const [error, setError] = createSignal<DebtError>()
  const [checking, setChecking] = createSignal(false)
  // Plain locals, not signals: this is a mutex, and a mutex read through the
  // reactive graph is a mutex that can be read stale.
  // `checking()` remains, for the button — it reports the state, it is not it.
  let running = false
  let again = false
  let stopped = false

  const run = (): void => {
    running = true
    setChecking(true)
    const done = (): void => {
      running = false
      setChecking(false)
      if (again && !stopped) {
        again = false
        run()
      }
    }
    try {
      void api
        .readDebt()
        .then((answer) => {
          if (stopped) return
          if (answer.ok) {
            setReport(answer.value)
            setError(undefined)
          } else {
            // The last good list is kept on screen beside the failure: a project
            // whose checker broke still owes what it owed a minute ago.
            setError(answer.error)
          }
        })
        .catch(() => {
          // The bridge itself failed — a handler that threw, a window on its
          // way out. Saying so beats leaving the last list up as if it were
          // current, which is the section reading as clean when it is blind.
          if (!stopped) setError({ kind: 'unreachable' })
        })
        .finally(done)
    } catch {
      // A bridge member that is not there at all throws where it stands. Without
      // this the flag would latch and the button would say `…` forever.
      setError({ kind: 'unreachable' })
      done()
    }
  }

  const refresh = (): void => {
    if (stopped) return
    if (running) again = true
    else run()
  }

  const dispose = (): void => {
    stopped = true
    again = false
  }

  return { report, error, checking, refresh, dispose }
}
