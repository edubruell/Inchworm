/**
 * Where the reader has been in this window (⌘⌥← / ⌘⌥→).
 *
 * Browser semantics, because that is what the gesture means everywhere else:
 * going back and then somewhere new drops the forward tail rather than
 * branching. Pure and data-first: the window keeps one of these in a signal,
 * and `back`/`forward` at the ends return the *same object*, so Solid's
 * reference equality makes a no-op cost nothing. (The menu items are not
 * disabled at the ends — main would need the renderer's history to do that, and
 * a disabled Back is not worth an IPC round trip per keystroke.)
 */

export type History = {
  /** Oldest first. Never empty once anything has been visited. */
  readonly visited: readonly string[]
  /** Index into `visited`; `-1` only before the first visit. */
  readonly at: number
}

export const NO_HISTORY: History = { visited: [], at: -1 }

export const current = (history: History): string | undefined => history.visited[history.at]

/**
 * Re-visiting the current entry is a no-op, not a duplicate: the sidebar
 * re-selects the open file on every watcher event, and a history that grew on
 * each of those would need two presses of ⌘⌥← to move once.
 */
export const visit = (history: History, path: string): History =>
  current(history) === path
    ? history
    : { visited: [...history.visited.slice(0, history.at + 1), path], at: history.at + 1 }

const canGoBack = (history: History): boolean => history.at > 0
const canGoForward = (history: History): boolean => history.at < history.visited.length - 1

export const back = (history: History): History =>
  canGoBack(history) ? { visited: history.visited, at: history.at - 1 } : history

export const forward = (history: History): History =>
  canGoForward(history) ? { visited: history.visited, at: history.at + 1 } : history
