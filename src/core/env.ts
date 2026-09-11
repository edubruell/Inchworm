/**
 * What a pane's shell inherits — and the one family of variables it must not.
 *
 * Inchworm's whole point is an agent running *beside* the wiki it writes, so a
 * pane's `claude` has to be a **top-level session**. It is not one if the app
 * itself was started from inside a Claude Code session: macOS hands the app its
 * launcher's environment, the pty host copies that environment into every
 * shell, and the agent finds `CLAUDE_CODE_CHILD_SESSION=1` waiting for it. The
 * symptom is quiet and total — *"Transcript saving is off — inherited
 * CLAUDE_CODE_CHILD_SESSION marker"* in every pane of every window, for the
 * life of that app instance, with nothing wrong on disk to find afterwards.
 *
 * Dropping the markers is safe in a way it would not be for an ordinary child
 * process: a pane runs a **login interactive shell** (`pty.ts`), so anything
 * the reader actually configured is re-read from `.zprofile` and `.zshrc` a
 * moment later. What cannot come back that way is exactly what we are removing
 * — per-session state of the process that happened to launch the app.
 */

/**
 * The variables Claude Code sets to describe *its own* session: the child
 * marker, the session and bridge ids, the messaging socket and its token, the
 * entrypoint, the parent pid, the effort and the exec path. Matched by shape
 * rather than listed name by name, because the list grows with the harness and
 * a marker this file has not heard of is precisely the one that would leak.
 *
 * Deliberately narrow at the edges: `ANTHROPIC_*` keys are credentials and
 * survive, and so does anything else with `CLAUDE` merely inside it.
 */
const SESSION_MARKERS = [/^CLAUDECODE$/, /^CLAUDE_CODE_/, /^CLAUDE_PID$/, /^CLAUDE_EFFORT$/] as const

export const isParentSessionVar = (name: string): boolean =>
  SESSION_MARKERS.some((marker) => marker.test(name))

/**
 * The environment a spawned pane gets: the caller's, minus the parent session's
 * markers. Unset values are dropped with them, so the result is the plain
 * `Record<string, string>` a spawner wants rather than one holding `undefined`
 * holes that would be passed on as the string `"undefined"`.
 */
export const paneEnv = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !isParentSessionVar(entry[0]),
    ),
  )
