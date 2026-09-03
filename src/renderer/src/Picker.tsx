/**
 * The window with no project: the front door, the list of projects opened
 * before, and the door into a folder that is not a project yet.
 */

import {
  createEffect,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from 'solid-js'
// Inlined, not emitted as a file: the shipped page is `file://` under
// `default-src 'none'; img-src 'self' data:`, and `'self'` is not a promise
// worth making about a file URL. A data URI is covered by the policy the
// app already ships.
import mascot from './assets/mascot.png?inline'
import { chromaFor } from '@core/hue.js'
import { parentDir } from '@core/paths.js'
import { launcherFor } from '@core/settings.js'
import { AGENT_FILES, CONVENTIONAL_WIKI_ROOT } from '@core/schema.js'
import { sinceLabel } from '@core/time.js'
import type { OpenProjectError, ProjectSummary, Settings, WikiApi } from '@shared/api.js'
import { Icon } from './Icon.js'
import { markerAdvice, openProjectMessage } from './messages.js'
import { Pane } from './Pane.js'
import { createTerminals } from './terminals.js'

type NoWiki = Extract<OpenProjectError, { readonly kind: 'no-llmwiki' }>

/**
 * A folder that is not a project **yet**.
 *
 * The app never writes the schema itself — it shows a wiki, it does not curate
 * one — so the answer to "no llmwiki here" is not a template the app stamps
 * out, it is *the agent*, in that folder, with the reader watching.
 * `/llmwiki init` is the agent's job and this is the door to it.
 *
 * The pane runs in the folder main just refused, which main remembered when it
 * refused it: the renderer names an agent, never a directory.
 */
const Bootstrap = (props: {
  readonly api: WikiApi
  readonly error: NoWiki
  readonly settings: Settings
  /** Try the folder again — the agent may have written the block by now. */
  readonly onRetry: () => void
}): JSX.Element => {
  const terminals = createTerminals(props.api)
  const launcher = (): string => launcherFor(props.settings, undefined)?.label ?? 'an agent'

  const found = (name: string): boolean => props.error.markers.agentFiles.includes(name)

  /** The agent has the window: the panel behind it is not on screen. */
  const running = (): boolean => terminals.panes().length > 0

  // The panel goes when the panel's premise goes — the folder opened, or
  // another folder was chosen — and the pane goes with it. A window's drawer
  // starts empty, so a pty left running here would be alive with nothing on
  // screen able to read or type into it.
  onCleanup(() => {
    for (const pane of terminals.panes()) terminals.close(pane.id)
  })

  // The page behind a full-window pane must not keep its scrollbar: the pane is
  // positioned against the viewport *inside* the scrollbar, so a document that
  // still scrolls leaves a strip of picker down the right-hand edge of the
  // terminal.
  createEffect(() => {
    if (!running()) return
    const root = document.documentElement
    const previous = root.style.overflow
    root.style.overflow = 'hidden'
    onCleanup(() => {
      root.style.overflow = previous
    })
  })

  return (
    <>
      <section
        class="flex flex-col gap-3 rounded border border-status-proposal/60 bg-status-proposal/5 p-4"
        classList={{ hidden: running() }}
        aria-label="Not an llmwiki project"
      >
        <div class="flex items-start gap-2">
          <span class="mt-0.5 shrink-0 text-status-proposal">
            <Icon name="warn" />
          </span>
          <div class="min-w-0">
            <p role="alert" class="font-medium">
              {openProjectMessage(props.error)}
            </p>
            <p class="truncate text-xs text-status-muted" title={props.error.dir}>
              {props.error.dir}
            </p>
          </div>
        </div>

        {/* The evidence, as a checklist: "no CLAUDE.md" and "a CLAUDE.md with no
          block" need different next steps, and only the app can tell them
          apart before the reader opens a terminal themselves. */}
        <ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <For each={AGENT_FILES}>
            {(name) => (
              <li classList={{ 'text-status-muted': !found(name) }}>
                <span aria-hidden="true">{found(name) ? '✓' : '✗'}</span>{' '}
                <span class="font-mono">{name}</span>
                <span class="sr-only">{found(name) ? ' found' : ' missing'}</span>
              </li>
            )}
          </For>
          <li classList={{ 'text-status-muted': !props.error.markers.wiki }}>
            <span aria-hidden="true">{props.error.markers.wiki ? '✓' : '✗'}</span>{' '}
            <span class="font-mono">{CONVENTIONAL_WIKI_ROOT}</span>
            <span class="sr-only">{props.error.markers.wiki ? ' found' : ' missing'}</span>
          </li>
        </ul>

        <p class="text-sm text-status-muted">
          {markerAdvice(props.error)} The app never writes the schema itself. Run{' '}
          <code>/llmwiki init</code> in the agent this opens, then check again.
        </p>

        {/* No "running here" state to draw: while the agent is up it *is* the
            window, and this panel is behind it. */}
        <div class="flex items-center gap-2">
          <button
            class="btn btn-accent no-drag"
            onClick={() => {
              terminals.start('agent', 80, 24, launcherFor(props.settings, undefined))
            }}
          >
            <Icon name="terminal" />
            Start {launcher()} here
          </button>
          <button class="btn no-drag" onClick={props.onRetry}>
            <Icon name="revert" />
            Check again
          </button>
        </div>

        <Show when={terminals.failure()}>
          {(message) => (
            <p role="alert" class="text-sm text-status-over">
              {message()}
            </p>
          )}
        </Show>

        {/*
        Full window, not a box in the panel. `/llmwiki init` is a conversation
        with an agent — a plan, a diff, a question — and the 256px strip this
        used to be could hold none of it; the panel it sat in is at most 42rem
        wide, so the pane was narrower than the agent's own output ([[findings]]
        2026-08-24). So the pane takes the window the moment it starts.

        `fixed`, deliberately: this is rendered from inside the panel, but it
        belongs to the window. From the front door that is the whole viewport
        below the title bar; from the picker *sheet* the dialog is in the top
        layer, so a fixed child of it paints over the sheet and its backdrop
        both — one implementation for the two places the picker is mounted.
        `top-12` is the chrome's own height (the accent hairline plus the
        drag/title row): the traffic lights stay clickable and the window stays
        draggable, which a true full-screen cover would take away.
      */}
      </section>

      <For each={terminals.panes()}>
        {(pane) => (
          <section
            aria-label={`${launcher()} in ${props.error.dir}`}
            class="fixed inset-x-0 top-12 bottom-0 z-40 flex flex-col bg-term text-term-text"
          >
            {/* The way back is on screen, always — the same rule the drawer's
                height group follows: a pane that fills the window must carry
                its own exit and its own "check again". */}
            <div class="flex shrink-0 items-center gap-2 bg-term-chrome px-3 py-1.5 text-label">
              <Icon name="terminal" />
              <span class="font-medium">{launcher()}</span>
              <span class="truncate text-term-muted" title={props.error.dir}>
                {props.error.dir}
              </span>
              <span class="flex-1" />
              <button class="btn btn-term no-drag" onClick={props.onRetry}>
                <Icon name="revert" />
                Check again
              </button>
              <button
                class="btn btn-term no-drag"
                onClick={() => {
                  terminals.close(pane.id)
                }}
              >
                Close
              </button>
            </div>
            <Pane id={pane.id} terminals={terminals} hue={0} hidden={false} />
          </section>
        )}
      </For>
    </>
  )
}

/**
 * One project, as a row: its identity diamond in its *own* hue, its name, the
 * folder it lives in, and when it was last open.
 *
 * The hue is the point. Every other window in the app is one project painted in
 * one colour, and this is the only place several of them are seen at once — so
 * the reader recognises the window they want before reading a single word, and
 * the colour they are picking is the colour they will get.
 *
 * The whole row is the button. A hit target the width of the list is the
 * difference between pointing at a project and aiming at a link.
 */
const Row = (props: {
  readonly project: ProjectSummary
  readonly nowMs: number
  readonly onOpen: () => void
}): JSX.Element => (
  <li>
    <button
      class="project-row no-drag"
      style={{
        '--swatch-hue': String(props.project.hue),
        '--swatch-chroma': String(chromaFor(props.project.hue)),
      }}
      // The full path is the tooltip rather than the label: two projects can
      // share a name, and the row shows the parent folder truncated.
      title={props.project.dir}
      // Spelled out, because the row's three parts are three sibling spans and
      // a name computed from them runs the folder into the name.
      aria-label={`Open ${props.project.name}, in ${parentDir(props.project.dir)}, last opened ${sinceLabel(props.project.lastOpenedMs, props.nowMs)}`}
      onClick={props.onOpen}
    >
      <span class="mark" aria-hidden="true" />
      <span class="min-w-0 flex-1 text-left">
        <span class="block truncate font-medium">{props.project.name}</span>
        <span class="block truncate text-xs text-status-muted">{parentDir(props.project.dir)}</span>
      </span>
      <span class="flex shrink-0 items-center gap-1 text-xs text-status-muted">
        <Icon name="clock" />
        {sinceLabel(props.project.lastOpenedMs, props.nowMs)}
      </span>
    </button>
  </li>
)

/**
 * The window with no project: a folder chooser and the projects opened before.
 * Opening one creates a *new* window bound to it — this window stays the
 * picker, which is what makes "open the same project twice" the ordinary
 * gesture rather than a special case.
 *
 * It is also the app's front door, which is why it is not just a list of paths:
 * as a `window` it opens with a mark and a line saying what this is, and as a
 * `sheet` over an open project it drops both, because a reader who is already
 * inside a project does not need to be told.
 */
export const Picker = (props: {
  readonly api: WikiApi
  /** Called when a project actually opened — the sheet closes on it. */
  readonly onOpened?: () => void
  /** Where this is mounted. The sheet is the same list without the front door. */
  readonly variant?: 'window' | 'sheet'
  /** The clock, injected — `core` may not read one and neither may a test. */
  readonly now?: () => number
  /** The app's settings: which agent the bootstrap panel offers to start. */
  readonly settings: Settings
  /**
   * Open the settings sheet. On the front door as a *button* and not only as
   * ⌘,: which agent runs is decided here, before any project is open, and a
   * menu-only affordance is one no reader finds by looking.
   */
  readonly onSettings?: (() => void) | undefined
}): JSX.Element => {
  const [recent, { refetch }] = createResource(() => props.api.listProjects())
  const [failure, setFailure] = createSignal<string>()
  /**
   * A refusal that has somewhere to go. `no-llmwiki` is kept whole rather than
   * flattened to a sentence, because the panel below draws the evidence in it
   * and offers the agent that fixes it.
   */
  const [noWiki, setNoWiki] = createSignal<NoWiki>()
  const nowMs = (): number => (props.now ?? Date.now)()

  const open = async (dir: string | undefined): Promise<void> => {
    if (dir === undefined) return
    const result = await props.api.openProject(dir)
    setFailure(undefined)
    setNoWiki(undefined)
    if (!result.ok) {
      if (result.error.kind === 'no-llmwiki') setNoWiki(result.error)
      else setFailure(openProjectMessage(result.error))
      return
    }
    void refetch()
    // As a sheet, this window is *not* the picker: leaving it up would put a
    // modal over the note the reader came back to.
    props.onOpened?.()
  }

  // `ipcMain.handle` rejects when a handler throws, and a `void`-ed rejection is
  // a click that does nothing and says nothing.
  const attempt = (work: Promise<void>): void => {
    work.catch((error: unknown) => {
      setFailure(error instanceof Error ? error.message : String(error))
    })
  }

  const front = (): boolean => (props.variant ?? 'window') === 'window'

  return (
    <section class="mx-auto flex w-full max-w-xl flex-col gap-5 p-6" classList={{ 'pt-10': front() }}>
      <header class="flex flex-col gap-2" classList={{ 'items-center text-center': front() }}>
        {/* The mascot, not the diamond. The diamond is *project identity* — it
            carries `--accent` and says which project a window belongs to — and
            the front door belongs to no project, so the one drawn here was a
            hue with nothing behind it. The mark of the app is the drawing. */}
        <Show when={front()}>
          <img src={mascot} alt="" aria-hidden="true" class="h-28 w-auto select-none" />
        </Show>
        <h1 class="text-lg font-semibold">Open a project</h1>
        <Show when={front()}>
          <p class="max-w-md text-sm text-status-muted">
            An llmwiki project: state note, design notes, registers, journal. Read and edited beside
            the agent that writes them.
          </p>
        </Show>
      </header>

      <div class="flex items-center gap-2" classList={{ 'self-center': front() }}>
        <button
          class="btn btn-accent no-drag px-3 py-1.5"
          onClick={() => {
            attempt(props.api.chooseProject().then(open))
          }}
        >
          <Icon name="folder" />
          Choose folder…
        </button>
        <Show when={props.onSettings}>
          {(open) => (
            <button
              class="btn no-drag px-3 py-1.5"
              onClick={() => {
                open()()
              }}
            >
              <Icon name="settings" />
              Settings
            </button>
          )}
        </Show>
      </div>

      <Show when={failure()}>
        {(message) => (
          <p role="alert" class="text-status-over">
            Failed: {message()}
          </p>
        )}
      </Show>

      <Show when={noWiki()}>
        {(error) => (
          <Bootstrap
            api={props.api}
            error={error()}
            settings={props.settings}
            onRetry={() => {
              attempt(open(error().dir))
            }}
          />
        )}
      </Show>

      <section class="flex min-h-0 flex-col gap-2">
        <h2 class="text-xs font-semibold tracking-wide text-status-muted uppercase">Recent</h2>
        <ul class="flex flex-col gap-1.5 overflow-y-auto">
          <For
            each={recent()}
            fallback={
              <li class="rounded border border-dashed border-hairline p-4 text-center text-sm text-status-muted">
                Nothing opened yet. Choose the folder holding a project's{' '}
                <code>local_context/wiki</code>.
              </li>
            }
          >
            {(project) => (
              <Row
                project={project}
                nowMs={nowMs()}
                onOpen={() => {
                  attempt(open(project.dir))
                }}
              />
            )}
          </For>
        </ul>
      </section>
    </section>
  )
}
