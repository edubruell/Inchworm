/**
 * The **agent window**: a folder that is not a project yet, and the agent
 * running in it. One terminal, the folder's name, and a way to try the folder
 * again — nothing else, because there is no wiki here to read.
 *
 * It is a window rather than a panel over the picker for one reason found in
 * use: the panel was mounted in whichever window opened the picker sheet, so
 * `/llmwiki init` appeared to be running *inside the project the reader was
 * reading*. A folder with no wiki is not that project's business, and a window
 * of its own is what says so.
 *
 * The folder is main's, for this window's lifetime: the pane asks for the
 * `pending` scope and never names a directory.
 */

import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { basename } from '@core/paths.js'
import { launcherFor } from '@core/settings.js'
import type { PendingSnapshot, Settings, WikiApi } from '@shared/api.js'
import { Icon } from './Icon.js'
import { openProjectMessage } from './messages.js'
import { Pane } from './Pane.js'
import { createTerminals } from './terminals.js'

export const AgentWindow = (props: {
  readonly api: WikiApi
  readonly pending: PendingSnapshot
  readonly settings: Settings
}): JSX.Element => {
  const terminals = createTerminals(props.api, 'pending')
  const [outcome, setOutcome] = createSignal<string>()

  /**
   * The agent this window started, read **once**. Deliberately not a derived
   * signal over `props.settings`: this window starts one process and keeps it,
   * so a launcher that followed the settings would rename a running `claude` to
   * `codex` the moment the reader changed the default in another window.
   */
  const chosen = launcherFor(props.settings, undefined)
  const launcher = chosen?.label ?? 'an agent'
  const folder = (): string => basename(props.pending.dir)

  // The window *is* the agent: there is nothing else in it to click first, and
  // a window that opened to an empty terminal would be one the reader has to
  // start by hand for no reason.
  onMount(() => {
    terminals.start('agent', 80, 24, chosen)
  })

  // The Window menu lists open windows by title, and several of these are open
  // at once in exactly the situation this window exists for.
  createEffect(() => {
    document.title = `${folder()} — ${launcher}`
  })

  /**
   * A ⌘W with the agent still running asks first. The window *is* one process,
   * and the reader who closes it by reflex loses the conversation that the
   * folder has no wiki to remember — the same veto the editor uses for unsaved
   * drafts, which main turns into a dialog (`main/window.ts`).
   */
  const guard = (event: BeforeUnloadEvent): void => {
    if (terminals.panes().some((open) => open.exited === undefined)) event.preventDefault()
  }
  window.addEventListener('beforeunload', guard)
  onCleanup(() => {
    window.removeEventListener('beforeunload', guard)
  })

  /** The pane, once there is one. There is never more than one in this window. */
  const pane = (): ReturnType<typeof terminals.panes>[number] | undefined => terminals.panes().at(0)

  /**
   * The one line this window says about itself. The retry's answer wins over a
   * failed start: `failure` is only cleared by another `start`, which never
   * comes here, so giving it precedence would freeze the window on its oldest
   * bad news and leave the only working button with nothing to say.
   */
  const notice = (): string | undefined => outcome() ?? terminals.failure()

  /**
   * The folder, tried again — the agent may have written the block by now. A
   * success opens the project in a *new* window, so this one stays as it is:
   * the agent may still be mid-sentence, and closing the window under it would
   * take the conversation with it.
   */
  const retry = (): void => {
    props.api
      .openProject(props.pending.dir)
      .then((result) => {
        setOutcome(
          result.ok
            ? `${folder()} opened in a window of its own. This window keeps the agent.`
            : openProjectMessage(result.error),
        )
      })
      .catch((error: unknown) => {
        setOutcome(error instanceof Error ? error.message : String(error))
      })
  }

  return (
    <section
      class="flex min-h-0 flex-1 flex-col bg-term text-term-text"
      aria-label={`${launcher} in ${props.pending.dir}`}
    >
      <div class="flex shrink-0 items-center gap-2 bg-term-chrome px-3 py-1.5 text-label">
        <Icon name="terminal" />
        {/* A heading, like every other view in the app: a window with no `h1`
            is a window a screen reader cannot name. */}
        <h1 class="font-medium">
          {launcher} in {folder()}
        </h1>
        <span class="truncate text-term-muted" title={props.pending.dir}>
          {props.pending.dir}
        </span>
        <span class="flex-1" />
        <button class="btn btn-term no-drag" onClick={retry}>
          <Icon name="revert" />
          Check {folder()} again
        </button>
      </div>

      {/* What the window has to say sits above the pane rather than in it: a
          pty's output is the process's, and the app writes nothing into it. */}
      <Show when={notice()}>
        {(message) => (
          <p role="alert" class="shrink-0 bg-term-chrome px-3 pb-1.5 text-label text-term-muted">
            {message()}
          </p>
        )}
      </Show>

      <Show
        when={pane()}
        fallback={
          <p class="p-3 text-label text-term-muted">
            {terminals.failure() === undefined
              ? `Starting ${launcher} in ${folder()}…`
              : `Nothing is running in ${folder()}.`}
          </p>
        }
      >
        {(live) => (
          <>
            {/* An agent that has quit leaves its output readable and says so —
                the drawer's rule, in a window that has no tab to show it on. */}
            {/* `!== undefined`, not the code itself: a clean exit is 0, and a
                truthiness test is how "the agent quit normally" becomes the one
                case the window says nothing about. */}
            <Show when={live().exited !== undefined}>
              <p role="status" class="shrink-0 bg-term-chrome px-3 pb-1.5 text-label text-term-muted">
                {launcher} exited ({String(live().exited)}). The output stays until this window is
                closed.
              </p>
            </Show>
            <Pane id={live().id} terminals={terminals} hue={0} hidden={false} />
          </>
        )}
      </Show>
    </section>
  )
}
