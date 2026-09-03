/**
 * One project, one window: the project header, the sidebar, the note and the
 * status rail — and the window's own history, because ⌘⌥← is a claim about
 * *this* window, not about the app.
 *
 * **CLAUDE.md hangs off the header, not the file tree** — `buildNavigation`
 * excludes it from every section by design, so without this slot its cap gauge
 * would have nowhere to live.
 */

import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { capFor, capStatus } from '@core/caps.js'
import { DRAWER_DEFAULT, clampDrawer } from '@core/drawer.js'
import { classify } from '@core/classify.js'
import type { History } from '@core/history.js'
import { NO_HISTORY, back, current, forward, visit } from '@core/history.js'
import { buildNavigation } from '@core/navigation.js'
import { headings } from '@core/register.js'
import { isAgentFile } from '@core/schema.js'
import { appendEntry, entryTemplate } from '@core/templates.js'
import type { Command, CommandSection, ProjectSnapshot, Settings as SettingsValue, WikiApi } from '@shared/api.js'
import type { CommandHub } from './commands.js'
import { createDebtStore } from './debtStore.js'
import { createDrafts } from './drafts.js'
import { Drawer } from './Drawer.js'
import { Gauge } from './Gauge.js'
import { Note } from './Note.js'
import { createNoteStore } from './noteStore.js'
import { Palette } from './Palette.js'
import { Sidebar } from './Sidebar.js'
import { StatusBar } from './StatusBar.js'
import { createTerminals } from './terminals.js'

export const ProjectView = (props: {
  readonly api: WikiApi
  readonly project: ProjectSnapshot
  readonly hub: CommandHub
  /**
   * Today, as the register formats spell it. Injected rather than read from a
   * clock here, so the date an appended entry carries is assertable — and so it
   * is the *local* day, not a UTC one that flips mid-afternoon.
   */
  readonly today: () => string
  /** The app's settings, live: the drawer's launcher buttons come from them. */
  readonly settings: SettingsValue
}): JSX.Element => {
  const store = createNoteStore(props.api, () => props.project)
  const drafts = createDrafts(props.api, store)
  const terminals = createTerminals(props.api)
  /**
   * The debt section's answers. Asked for on open, again whenever the project
   * changes on disk, and by hand from the section's own control — the three
   * parts of the refresh policy, and the reason the store coalesces rather
   * than queues (a save is a watcher event, and a checker takes a second).
   */
  const debt = createDebtStore(props.api)
  debt.refresh()
  onCleanup(
    props.api.onProjectEvent((event) => {
      if (event.dir === props.project.dir) debt.refresh()
    }),
  )
  onCleanup(() => {
    debt.dispose()
  })
  const [history, setHistory] = createSignal<History>(NO_HISTORY)
  const [palette, setPalette] = createSignal(false)
  const [editing, setEditing] = createSignal(false)
  /** Where the caret goes when the document is replaced from outside the editor. */
  const [caret, setCaret] = createSignal<number>()
  const [drawer, setDrawer] = createSignal(false)
  /**
   * ⌘E, counted rather than flagged: pressing it twice is two notes, and a
   * boolean would only ever fire once. Zero is "never asked".
   */
  const [tagNonce, setTagNonce] = createSignal(0)
  /**
   * How tall the drawer is, per window and for as long as the window lives. Not
   * persisted: the right height belongs to what is happening in the pane right
   * now, and a remembered one would be a guess about the next session rather
   * than a fact about this one.
   */
  const [drawerHeight, setDrawerHeight] = createSignal(DRAWER_DEFAULT)

  // A window resized smaller must not leave the drawer taller than the rule
  // allows — the clamp is the same one the handle applies, so the two cannot
  // disagree.
  const refit = (): void => {
    setDrawerHeight((height) => clampDrawer(height, window.innerHeight))
  }
  window.addEventListener('resize', refit)
  onCleanup(() => {
    window.removeEventListener('resize', refit)
  })

  // The state file is the read-first file in this schema, so it is what a
  // window opens on — as the first history entry, not as a special case that
  // ⌘⌥← would have to know about.
  const stateFile = createMemo(() =>
    props.project.files.find((path) => classify(path, props.project.layout).kind === 'state'),
  )

  const open = (path: string): void => {
    setCaret(undefined)
    setHistory((visited) => visit(visited, path))
  }

  /**
   * ⌥⏎. A file the window could not read has no source to show, so the toggle
   * is a no-op rather than an empty editor over a failure message.
   */
  const toggleEdit = (): void => {
    const path = selected()
    setEditing((on) => (on ? false : path !== undefined && store.get(path) !== undefined))
    if (!editing()) setCaret(undefined)
    else if (path !== undefined) drafts.open(path)
  }

  /**
   * The append affordance. The entry goes into the *draft*, at the bottom, from
   * the register's own template — the app never writes to disk on its own, and
   * it never inserts anywhere but the end.
   */
  const appendTo = (path: string): void => {
    const entry = store.get(path)
    const kind = classify(path, props.project.layout)
    if (entry === undefined || kind.kind !== 'register') return
    drafts.open(path)
    const current = drafts.get(path)?.text ?? entry.text
    const template = entryTemplate(kind.register, { date: props.today(), headings: headings(current) })
    if (template === undefined) return
    const appended = appendEntry(current, template)
    drafts.change(path, appended.text)
    setCaret(appended.from)
    setEditing(true)
  }

  createEffect(() => {
    const first = stateFile()
    if (first !== undefined && current(history()) === undefined) open(first)
  })

  const selected = createMemo(() => current(history()) ?? stateFile())

  /**
   * Edit mode follows the file, not the pane. Navigating while editing used to
   * leaves `Source` with no draft and the prose suppressed — the file's bytes
   * nowhere on screen at all. One rule covers every way the selection can move,
   * including ⌘⌥← and ⌘1–5, which do not go through `open()`.
   */
  createEffect(() => {
    const path = selected()
    if (!editing()) return
    if (path === undefined) {
      setEditing(false)
      return
    }
    // A draft with unsaved work in it outlives its file: the reader must still
    // be able to reach what they typed and write it back.
    if (store.get(path) === undefined && drafts.get(path) === undefined) setEditing(false)
    else drafts.open(path)
  })

  // The Window menu lists open windows by title, so "which window is this" is
  // answerable from the menu bar as well as from a Mission Control thumbnail.
  createEffect(() => {
    document.title = selected() === undefined ? props.project.name : `${props.project.name} — ${String(selected())}`
  })

  /**
   * ⌘1–5. A section with nothing in it stays where it is rather than clearing
   * the pane: ⌘4 in a project with no journal is a no-op, not a blank window.
   */
  const openSection = (section: CommandSection): void => {
    const first = buildNavigation(props.project.files, props.project.layout).find(
      (group) => group.section === section,
    )?.entries[0]
    if (first !== undefined) open(first.path)
  }

  const saveSelected = (): void => {
    const path = selected()
    if (path !== undefined) drafts.save(path)
  }

  /**
   * ⌘E only in the source pane: there is nowhere to put a tag in rendered
   * prose, and it must not quietly change the file behind a reading view.
   */
  const insertTag = (): void => {
    if (editing()) setTagNonce((count) => count + 1)
  }

  const ACTIONS: Record<string, (command: Command) => void> = {
    palette: () => setPalette(true),
    edit: toggleEdit,
    save: saveSelected,
    terminal: () => setDrawer((open) => !open),
    tag: insertTag,
    back: () => setHistory(back),
    forward: () => setHistory(forward),
    section: (command) => {
      if (command.kind === 'section') openSection(command.section)
    },
  }

  props.hub.listen((command) => {
    ACTIONS[command.kind]?.(command)
  })

  /**
   * Unsaved work outlives a stray ⌘W only if something objects. The renderer is
   * the only side that knows a draft exists, so it vetoes the unload and main
   * turns that veto into a real dialog (`main/window.ts`).
   */
  const guard = (event: BeforeUnloadEvent): void => {
    if (drafts.unsaved().length > 0) event.preventDefault()
  }
  window.addEventListener('beforeunload', guard)
  onCleanup(() => {
    window.removeEventListener('beforeunload', guard)
  })

  // Whichever agent file this project has — `AGENTS.md` is a project marker in
  // its own right, so the header slot names the file that is actually there.
  const claudeMd = createMemo(() => props.project.files.find((path) => isAgentFile(path)))
  const claudeCap = createMemo(() => {
    const path = claudeMd()
    const note = path === undefined ? undefined : store.get(path)
    return note === undefined || path === undefined
      ? undefined
      : capStatus(note.note.lineCount, capFor(classify(path, props.project.layout)))
  })

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      {/*
        This row is **not** a drag region, and that is a fix rather than an
        omission. `-webkit-app-region` is a *geometric* region the OS computes
        in document order: a `drag` element that comes later re-covers an
        earlier `no-drag`, and the pixels it covers stop being the page's at
        all. This row is 30 px tall, full width, and renders after the header —
        so it swallowed six of the eight accent swatches, which hang under the
        header and over this band ([[gotchas]] 2026-08-21). The window is
        dragged by the title bar above; one drag region is enough, and `a11y`
        asserts there is exactly one.
      */}
      <Show when={claudeMd()}>
        {(path) => (
          <div class="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-1 text-label">
            <button
              class="no-drag rounded px-2 py-0.5 hover:bg-accent-wash"
              classList={{ 'bg-accent-wash font-medium': selected() === path() }}
              aria-current={selected() === path() ? 'true' : undefined}
              onClick={() => {
                open(path())
              }}
            >
              {path()}
              <span class="ml-2">
                <Gauge cap={claudeCap()} />
              </span>
            </button>
            <span class="truncate text-status-muted">{props.project.dir}</span>
          </div>
        )}
      </Show>

      <div class="flex min-h-0 flex-1">
        <Sidebar project={props.project} store={store} debt={debt} selected={selected()} onSelect={open} />
        <Note
          project={props.project}
          store={store}
          drafts={drafts}
          path={selected()}
          onOpen={open}
          editing={editing()}
          onToggleEdit={toggleEdit}
          onAppend={appendTo}
          caret={caret()}
          tag={{ name: props.settings.noteTag, nonce: tagNonce() }}
          onOpenExternal={(url) => {
            void props.api.openExternal(url)
          }}
        />
      </div>

      {/* Mounted once anything has been started, and *hidden* rather than
          unmounted: disposing an `xterm` throws away its screen, and the pane
          comes back replaying raw bytes into a fresh terminal — a corrupted
          redraw of the one pane the app exists for (M4 bug hunt). */}
      <Show when={drawer() || terminals.panes().length > 0}>
        <Drawer
          terminals={terminals}
          launchers={props.settings.launchers}
          hue={props.project.hue}
          hidden={!drawer()}
          height={drawerHeight()}
          onHeight={setDrawerHeight}
          onClose={() => {
            setDrawer(false)
          }}
        />
      </Show>

      <StatusBar
        project={props.project}
        store={store}
        drafts={drafts}
        onOpen={open}
        drawer={drawer()}
        onToggleDrawer={() => {
          setDrawer((open) => !open)
        }}
      />

      <Palette
        open={palette()}
        project={props.project}
        onOpen={open}
        onClose={() => {
          setPalette(false)
        }}
      />
    </div>
  )
}
