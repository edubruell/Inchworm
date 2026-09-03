/**
 * The application menu — the *real* one, because on macOS the menu bar is where
 * a keyboard shortcut is discoverable and where an app that has none reads as
 * a web page in a frame.
 *
 * `electron` is imported for types only, so the whole template — labels,
 * accelerators, and what each item does — is assertable in plain node, exactly
 * as `windowOptions` is. Nothing here decides anything: every item calls an
 * injected action, and the composition root wires those to windows.
 */

import type { MenuItemConstructorOptions } from 'electron'
import { SECTIONS, SECTION_LABEL } from '@core/schema.js'
import type { Command } from '@shared/api.js'
import type { OpenProject } from './project.js'

/** The slice of a window this module needs; `BrowserWindow` satisfies it. */
export type TargetWindow = { readonly id: number }

export type MenuActions = {
  /** ⌘⇧O: the picker, as a sheet over `window` — or a new picker window if there is none. */
  readonly projects: (window: TargetWindow | undefined) => void
  /** ⌘N: a second window on the project `window` is bound to; a no-op if it has none. */
  readonly newWindow: (window: TargetWindow | undefined) => void
  /** Everything the view owns, delivered to the window the menu was used on. */
  readonly send: (window: TargetWindow | undefined, command: Command) => void
  readonly isPackaged: boolean
}

/**
 * The one item whose availability depends on the focused window: a picker
 * window has no project to open a second window on. Electron rebuilds nothing
 * on focus, so the template ships it disabled and the composition root flips it
 * as focus moves — by this id, which is why the id is exported rather than
 * spelled twice.
 */
export const NEW_WINDOW_ITEM = 'new-window-on-project'

export const menuTemplate = (actions: MenuActions): readonly MenuItemConstructorOptions[] => {
  /**
   * Electron hands the click the window the menu was used on. Reading it from
   * the argument rather than asking for "the focused window" is what keeps a
   * command in the window the reader is looking at — the same rule the IPC
   * handlers follow by scoping to the *sending* window.
   */
  const on = (command: Command) => (_item: unknown, window?: TargetWindow): void => {
    actions.send(window, command)
  }

  /**
   * The list and the words are `core`'s, so a section added to the schema gets
   * its ⌘-number here without anyone remembering to add it; a copy of the list
   * in this file would silently leave a sixth section unreachable. `core.Section`
   * and the wire's `CommandSection` are the same five literals, and the compiler
   * checks that here: `shared` may not import `core`, so this call is where the
   * two meet.
   */
  const sectionItems = SECTIONS.map(
    (section, index): MenuItemConstructorOptions => ({
      label: SECTION_LABEL[section],
      accelerator: `CommandOrControl+${String(index + 1)}`,
      click: on({ kind: 'section', section }),
    }),
  )

  return [
    /**
     * The app menu, spelled out rather than `role: 'appMenu'` for one item:
     * **Settings… (⌘,)**, which macOS expects here and nowhere else. Everything
     * else in it is still a role, so the About/Services/Hide/Quit block is the
     * platform's rather than this file's opinion.
     */
    {
      label: 'Inchworm',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CommandOrControl+,', click: on({ kind: 'settings' }) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Projects…',
          accelerator: 'CommandOrControl+Shift+O',
          click: (_item: unknown, window?: TargetWindow): void => {
            actions.projects(window)
          },
        },
        {
          id: NEW_WINDOW_ITEM,
          label: 'New Window on This Project',
          accelerator: 'CommandOrControl+N',
          enabled: false,
          click: (_item: unknown, window?: TargetWindow): void => {
            actions.newWindow(window)
          },
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CommandOrControl+S',
          click: on({ kind: 'save' }),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    /**
     * The Edit menu, spelled out for one item — **Insert Note Tag (⌘E)** —
     * with the platform's own block intact around it. A note to the agent is
     * an editing action and belongs here, next to the other things that change
     * the text.
     */
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Insert Note Tag', accelerator: 'CommandOrControl+E', click: on({ kind: 'tag' }) },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Jump to File…', accelerator: 'CommandOrControl+K', click: on({ kind: 'palette' }) },
        { type: 'separator' },
        { label: 'Back', accelerator: 'CommandOrControl+Alt+Left', click: on({ kind: 'back' }) },
        { label: 'Forward', accelerator: 'CommandOrControl+Alt+Right', click: on({ kind: 'forward' }) },
        { type: 'separator' },
        ...sectionItems,
      ],
    },
    {
      label: 'View',
      submenu: [
        // ⌥⏎ rather than a mode the reader has to find: the same pane, the same
        // scroll anchor, source instead of prose.
        { label: 'Edit Source', accelerator: 'Alt+Enter', click: on({ kind: 'edit' }) },
        { label: 'Terminal', accelerator: 'Control+`', click: on({ kind: 'terminal' }) },
        { type: 'separator' },
        // The reload items ship in development only: a packaged renderer holds
        // the privileged bridge, and ⌘R on it is a way to lose unsaved work
        // with no upside a reader ever wants.
        ...(actions.isPackaged
          ? []
          : ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[])),
        { role: 'togglefullscreen' },
      ],
    },
    // Electron's own Window menu lists the open windows by title, and the
    // renderer titles each one "project — note" — so window identification
    // works from the menu bar too, not only from a Mission Control thumbnail.
    { role: 'windowMenu' },
  ]
}

/**
 * Everything the menu's actions actually *do*, as primitive effects. The
 * composition root supplies four one-line functions and this decides what to
 * call when — which is the part worth asserting. In `index.ts` it would sit
 * behind a coverage exclusion, because that file only runs inside Electron, and
 * "the menu item lies about what it will do" would be untestable.
 */
export type MenuEffects = {
  readonly projectFor: (windowId: number) => OpenProject | undefined
  readonly openWindow: (project: OpenProject) => void
  /** A window with no project — which is the picker. */
  readonly createWindow: () => void
  /** Delivers to that window if it is still alive; a dead one is dropped. */
  readonly send: (windowId: number, command: Command) => void
  readonly isPackaged: boolean
}

export const createMenuActions = (effects: MenuEffects): MenuActions => ({
  // With every window closed the app is still running, and ⌘⇧O has to bring one
  // back. A window that *is* the picker gets the command anyway: only the view
  // knows whether it is a project window, and it ignores it if not.
  projects: (window): void => {
    if (window === undefined) effects.createWindow()
    else effects.send(window.id, { kind: 'projects' })
  },

  newWindow: (window): void => {
    const project = window === undefined ? undefined : effects.projectFor(window.id)
    if (project !== undefined) effects.openWindow(project)
  },

  send: (window, command): void => {
    if (window !== undefined) effects.send(window.id, command)
  },

  isPackaged: effects.isPackaged,
})

/**
 * Whether "New Window on This Project" applies right now. Computed from the
 * **focused** window rather than from whichever window last opened: closing the
 * last window fires no focus event, and a window created by the picker is not
 * focused until it is shown — either one leaves the item enabled over nothing.
 */
export const newWindowEnabled = (
  focused: TargetWindow | null | undefined,
  projectFor: (windowId: number) => OpenProject | undefined,
): boolean => (focused === null || focused === undefined ? false : projectFor(focused.id) !== undefined)
