/**
 * The menu is the keyboard, and a
 * ⌘K that fires nothing looks exactly like a ⌘K that is not registered. Every
 * assertion here is over the template, which is why the module imports Electron
 * for types only.
 */

import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, test, vi } from 'vitest'
import { SECTIONS, SECTION_LABEL } from '@core/schema.js'
import type { Command } from '@shared/api.js'
import type { OpenProject } from './project.js'
import {
  NEW_WINDOW_ITEM,
  createMenuActions,
  menuTemplate,
  newWindowEnabled,
  type MenuActions,
  type MenuEffects,
  type TargetWindow,
} from './menu.js'

const WINDOW: TargetWindow = { id: 7 }

const build = (
  overrides: Partial<MenuActions> = {},
): {
  readonly template: readonly MenuItemConstructorOptions[]
  readonly sent: { window: TargetWindow | undefined; command: Command }[]
  readonly actions: MenuActions
} => {
  const sent: { window: TargetWindow | undefined; command: Command }[] = []
  const actions: MenuActions = {
    projects: vi.fn(),
    newWindow: vi.fn(),
    send: (window, command) => {
      sent.push({ window, command })
    },
    isPackaged: false,
    ...overrides,
  }
  return { template: menuTemplate(actions), sent, actions }
}

const items = (template: readonly MenuItemConstructorOptions[], menu: string): readonly MenuItemConstructorOptions[] => {
  const submenu = template.find((item) => item.label === menu)?.submenu
  return Array.isArray(submenu) ? submenu : []
}

const item = (
  template: readonly MenuItemConstructorOptions[],
  menu: string,
  label: string,
): MenuItemConstructorOptions => {
  const found = items(template, menu).find((entry) => entry.label === label)
  if (found === undefined) throw new Error(`no "${label}" in ${menu}`)
  return found
}

const click = (entry: MenuItemConstructorOptions, window: TargetWindow | undefined): void => {
  // The click's Electron signature is (menuItem, browserWindow, event); the
  // template only ever reads the second.
  ;(entry.click as unknown as (item: unknown, window: TargetWindow | undefined) => void)(undefined, window)
}

describe('the menu bar', () => {
  const { template } = build()

  test('carries the standard macOS menus, so the app is not a web page in a frame', () => {
    expect(template.map((entry) => entry.role ?? entry.label)).toEqual([
      // The app menu is spelled out for one item — Settings… — and is still
      // the platform's block otherwise.
      'Inchworm',
      'File',
      // Spelled out for ⌘E, with the platform's own block kept around it.
      'Edit',
      'Go',
      'View',
      'windowMenu',
    ])
  })

  test('every accelerator wiki 04_ui_layout names for M3b and M4 is present, exactly once', () => {
    const accelerators = template
      .flatMap((entry) => (Array.isArray(entry.submenu) ? entry.submenu : []))
      .flatMap((entry) => (entry.accelerator === undefined ? [] : [entry.accelerator]))

    expect(accelerators).toEqual([
      // ⌘, — the settings sheet, in the app menu where macOS puts it.
      'CommandOrControl+,',
      'CommandOrControl+Shift+O',
      'CommandOrControl+N',
      'CommandOrControl+S',
      // ⌘E — a note to the agent, wrapped around the selection (Edit menu).
      'CommandOrControl+E',
      'CommandOrControl+K',
      'CommandOrControl+Alt+Left',
      'CommandOrControl+Alt+Right',
      'CommandOrControl+1',
      'CommandOrControl+2',
      'CommandOrControl+3',
      'CommandOrControl+4',
      'CommandOrControl+5',
      // ⌥⏎ and ⌃` — the editor and the drawer.
      'Alt+Enter',
      'Control+`',
    ])
    expect(new Set(accelerators).size).toBe(accelerators.length)
  })
})

describe('what an item does', () => {
  test('the view commands go to the window the menu was used on, not "the focused one"', () => {
    const { template, sent } = build()

    click(item(template, 'Go', 'Jump to File…'), WINDOW)
    click(item(template, 'Go', 'Back'), WINDOW)
    click(item(template, 'Go', 'Forward'), WINDOW)
    click(item(template, 'Go', 'Registers'), WINDOW)

    expect(sent).toEqual([
      { window: WINDOW, command: { kind: 'palette' } },
      { window: WINDOW, command: { kind: 'back' } },
      { window: WINDOW, command: { kind: 'forward' } },
      { window: WINDOW, command: { kind: 'section', section: 'registers' } },
    ])
  })

  /**
   * Save, Edit Source and Terminal: the three items whose *action* is easy to
   * leave unclicked, because an accelerator assertion looks like coverage.
   */
  test('Save, Edit Source and Terminal send their commands to the menu\'s window', () => {
    const { template, sent } = build()

    click(item(template, 'File', 'Save'), WINDOW)
    click(item(template, 'View', 'Edit Source'), WINDOW)
    click(item(template, 'View', 'Terminal'), WINDOW)

    expect(sent).toEqual([
      { window: WINDOW, command: { kind: 'save' } },
      { window: WINDOW, command: { kind: 'edit' } },
      { window: WINDOW, command: { kind: 'terminal' } },
    ])
  })

  test('the two menus that grew an item still send to the window they were used on', () => {
    const { template, sent } = build()

    click(item(template, 'Inchworm', 'Settings…'), WINDOW)
    click(item(template, 'Edit', 'Insert Note Tag'), WINDOW)

    expect(sent).toEqual([
      { window: WINDOW, command: { kind: 'settings' } },
      { window: WINDOW, command: { kind: 'tag' } },
    ])
  })

  test('the Edit menu kept the platform block it had as a role', () => {
    const { template } = build()
    const edit = template.find((entry) => entry.label === 'Edit')
    const roles = (Array.isArray(edit?.submenu) ? edit.submenu : []).flatMap((entry) =>
      entry.role === undefined ? [] : [entry.role],
    )

    // Spelling a role menu out is how the standard items get lost; they are
    // asserted rather than assumed.
    expect(roles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
  })

  test('⌘1–5 are the five sidebar sections, in schema order', () => {
    const { template, sent } = build()

    for (const label of ['State', 'Notes', 'Registers', 'Journal', 'Archive']) {
      click(item(template, 'Go', label), WINDOW)
    }

    expect(sent.map((entry) => entry.command)).toEqual([
      { kind: 'section', section: 'state' },
      { kind: 'section', section: 'notes' },
      { kind: 'section', section: 'registers' },
      { kind: 'section', section: 'journal' },
      { kind: 'section', section: 'archive' },
    ])
  })

  /**
   * The one the previous test cannot fail on: it names five labels, so a sixth
   * section added to `core.SECTIONS` would still leave it green while getting
   * no ⌘-number at all. This asserts the *derivation* — the list, the words and
   * the numbering are `core`'s, and the menu carries no copy of them.
   */
  test('the Go section items are core.SECTIONS itself, labelled and numbered from it', () => {
    const { template } = build()

    const numbered = SECTIONS.map((section, index) => ({
      label: SECTION_LABEL[section],
      accelerator: `CommandOrControl+${String(index + 1)}`,
    }))

    // The sections are the tail of Go, after the palette and the history pair.
    const tail = items(template, 'Go').slice(-SECTIONS.length)

    expect(tail.map(({ label, accelerator }) => ({ label, accelerator }))).toEqual(numbered)
  })

  test('Projects… and New Window are main-process actions, not view commands', () => {
    const { template, actions, sent } = build()

    click(item(template, 'File', 'Projects…'), WINDOW)
    click(item(template, 'File', 'New Window on This Project'), WINDOW)

    expect(actions.projects).toHaveBeenCalledWith(WINDOW)
    expect(actions.newWindow).toHaveBeenCalledWith(WINDOW)
    expect(sent).toEqual([])
  })

  test('with no window at all the actions still fire, and get undefined', () => {
    const { template, actions, sent } = build()

    click(item(template, 'File', 'Projects…'), undefined)
    click(item(template, 'Go', 'Jump to File…'), undefined)

    expect(actions.projects).toHaveBeenCalledWith(undefined)
    expect(sent).toEqual([{ window: undefined, command: { kind: 'palette' } }])
  })
})

describe('window-dependent state', () => {
  test('New Window ships disabled and carries the id the composition root flips', () => {
    const entry = item(build().template, 'File', 'New Window on This Project')

    expect(entry.id).toBe(NEW_WINDOW_ITEM)
    expect(entry.enabled).toBe(false)
  })
})

describe('the View menu', () => {
  test('a packaged build offers no reload: ⌘R on the privileged renderer is a way to lose work', () => {
    const roles = items(build({ isPackaged: true }).template, 'View').flatMap((entry) =>
      entry.role === undefined ? [] : [entry.role],
    )

    expect(roles).toEqual(['togglefullscreen'])
  })

  test('development keeps reload and the dev tools', () => {
    const roles = items(build({ isPackaged: false }).template, 'View').map((entry) => entry.role)

    expect(roles).toContain('reload')
    expect(roles).toContain('toggleDevTools')
  })
})

describe('what the actions do', () => {
  const PROJECT = { dir: '/p', layout: { wikiRoot: 'wiki', journal: 'notes', kind: 'software' } } as OpenProject

  const wiring = (
    projects: ReadonlyMap<number, OpenProject>,
  ): {
    readonly actions: MenuActions
    readonly opened: OpenProject[]
    readonly created: number[]
    readonly sent: { id: number; command: Command }[]
  } => {
    const opened: OpenProject[] = []
    const created: number[] = []
    const sent: { id: number; command: Command }[] = []
    const effects: MenuEffects = {
      projectFor: (id) => projects.get(id),
      openWindow: (project) => opened.push(project),
      createWindow: () => created.push(1),
      send: (id, command) => sent.push({ id, command }),
      isPackaged: false,
    }
    return { actions: createMenuActions(effects), opened, created, sent }
  }

  test('⌘⇧O with no window opens a picker window instead of sending into nothing', () => {
    const { actions, created, sent } = wiring(new Map())

    actions.projects(undefined)

    expect(created).toHaveLength(1)
    expect(sent).toEqual([])
  })

  test('⌘⇧O on a window sends the command there and creates nothing', () => {
    const { actions, created, sent } = wiring(new Map([[7, PROJECT]]))

    actions.projects(WINDOW)

    expect(created).toEqual([])
    expect(sent).toEqual([{ id: 7, command: { kind: 'projects' } }])
  })

  test('⌘N opens a second window on the project the window is bound to', () => {
    const { actions, opened } = wiring(new Map([[7, PROJECT]]))

    actions.newWindow(WINDOW)

    expect(opened).toEqual([PROJECT])
  })

  test('⌘N on a picker window opens nothing at all', () => {
    const { actions, opened } = wiring(new Map())

    actions.newWindow(WINDOW)
    actions.newWindow(undefined)

    expect(opened).toEqual([])
  })

  test('a view command with no window is dropped rather than broadcast', () => {
    const { actions, sent } = wiring(new Map())

    actions.send(undefined, { kind: 'palette' })

    expect(sent).toEqual([])
  })
})

describe('newWindowEnabled', () => {
  const projectFor = (id: number): OpenProject | undefined =>
    id === 7 ? { dir: '/p', layout: { wikiRoot: 'wiki', journal: 'notes', kind: 'software' } } : undefined

  test('a project window enables it', () => {
    expect(newWindowEnabled(WINDOW, projectFor)).toBe(true)
  })

  test('a picker window does not', () => {
    expect(newWindowEnabled({ id: 9 }, projectFor)).toBe(false)
  })

  test('no focused window does not — this is the arm that used to go stale', () => {
    // `BrowserWindow.getFocusedWindow()` answers null after the last window
    // closes, and no focus event follows it.
    expect(newWindowEnabled(null, projectFor)).toBe(false)
    expect(newWindowEnabled(undefined, projectFor)).toBe(false)
  })
})
