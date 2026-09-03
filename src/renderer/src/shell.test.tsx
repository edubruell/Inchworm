// @vitest-environment happy-dom
/**
 * The window shell: what the native menu asks the window to do, and what the
 * window shows around the note — keyboard, picker, status bar, accent popover.
 *
 * Every command here arrives the way it does in the app — over the bridge from
 * a menu item — because the accelerator, the item and the view are three
 * separate pieces and only this end-to-end path proves they meet.
 */

import { render } from 'solid-js/web'
import { afterEach, describe, expect, test } from 'vitest'
import type { Command, OpenProjectError, ProjectSnapshot, ProjectSummary } from '@shared/api.js'
import { GRAPHITE, PALETTE } from '@core/hue.js'
import { SECTIONS, SECTION_LABEL } from '@core/schema.js'
import { fakeApi, type FakeApi } from '../../../tests/support/api.js'
import { App } from './App.jsx'

const STATE = `---
status: active
updated: 2026-08-20
---

# state — p
`

const CONTENTIONS = `# contentions

## C1 — one (fragile)

## C2 — two (fragile)

## C3 — three (RESOLVED 2026-08-19)
`

const FILES = new Map([
  ['wiki/00_state.md', STATE],
  ['wiki/01_scope.md', '# scope\n'],
  ['wiki/02_arch.md', '# arch\n'],
  ['wiki/contentions.md', CONTENTIONS],
  ['wiki/decisions.md', '# decisions\n'],
  ['notes/2026-08-19_day.md', '# day\n'],
  ['CLAUDE.md', '# CLAUDE\n'],
])

const project: ProjectSnapshot = {
  dir: '/p',
  name: 'p',
  hue: 226,
  layout: { wikiRoot: 'wiki', journal: 'notes', kind: 'software' },
  files: [...FILES.keys()],
}

let dispose = (): void => undefined

afterEach(() => {
  dispose()
  document.body.innerHTML = ''
  delete (window as { wiki?: unknown }).wiki
})

const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
}

const mount = async (
  options: {
    readonly project?: ProjectSnapshot | undefined
    readonly recent?: readonly ProjectSummary[]
    readonly refuseOpen?: OpenProjectError
    readonly files?: Map<string, string>
  } = {},
): Promise<FakeApi> => {
  const fake = fakeApi({
    project: 'project' in options ? options.project : project,
    files: options.files ?? FILES,
    recent: options.recent,
    refuseOpen: options.refuseOpen,
  })
  Object.defineProperty(window, 'wiki', { value: fake.api, configurable: true })
  dispose = render(() => <App />, document.body)
  await settle()
  return fake
}

const fire = async (fake: FakeApi, command: Command): Promise<void> => {
  fake.send(command)
  await settle()
}

/** What the note pane is showing: the view's `h1` is the open file's path. */
const openFile = (): string | null | undefined => document.querySelector('main h1')?.textContent

/** The topmost open sheet — dialogs stack in the top layer, so the last wins. */
const sheet = (): HTMLDialogElement | null => [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1) ?? null

const sheets = (): number => document.querySelectorAll('dialog[open]').length

const labelled = (label: string): HTMLDialogElement | null =>
  document.querySelector<HTMLDialogElement>(`dialog[open][aria-label="${label}"]`)

/** Escape on a modal `<dialog>` is a `close` event; happy-dom fires no default. */
const escape = async (dialog: HTMLDialogElement | null): Promise<void> => {
  dialog?.close()
  await settle()
}

const click = async (element: Element | null | undefined): Promise<void> => {
  ;(element as HTMLElement | null | undefined)?.click()
  await settle()
}

describe('⌘K — jump to file', () => {
  test('the command opens a modal sheet whose own heading is the only one in the view', async () => {
    const fake = await mount()
    expect(sheet()).toBeNull()

    await fire(fake, { kind: 'palette' })

    expect(sheet()?.getAttribute('aria-label')).toBe('Jump to file')
    expect([...(sheet()?.querySelectorAll('h1') ?? [])].map((node) => node.textContent)).toEqual(['Jump to file'])
  })

  test('it lists every file the window can open, CLAUDE.md included', async () => {
    const fake = await mount()
    await fire(fake, { kind: 'palette' })

    const options = [...(sheet()?.querySelectorAll('[role="option"]') ?? [])].map((node) =>
      node.textContent.startsWith('CLAUDE.md'),
    )
    expect(options).toHaveLength(FILES.size)
    expect(options.at(-1)).toBe(true)
  })

  test('typing filters, and clicking a match opens it and closes the sheet', async () => {
    const fake = await mount()
    await fire(fake, { kind: 'palette' })

    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')
    if (input === null) throw new Error('no palette input')
    input.value = 'arch'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()

    const options = [...(sheet()?.querySelectorAll('[role="option"]') ?? [])]
    expect(options).toHaveLength(1)

    await click(options[0])

    expect(sheet()).toBeNull()
    expect(openFile()).toBe('wiki/02_arch.md')
  })

  test('the arrow keys move the active option, and Enter opens it', async () => {
    const fake = await mount()
    await fire(fake, { kind: 'palette' })

    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')
    if (input === null) throw new Error('no palette input')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await settle()
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-option-1')

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()

    // Second in schema order: 00_state, then the numbered notes.
    expect(openFile()).toBe('wiki/01_scope.md')
  })

  test('a query that matches nothing says so instead of showing everything', async () => {
    const fake = await mount()
    await fire(fake, { kind: 'palette' })

    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')
    if (input === null) throw new Error('no palette input')
    input.value = 'zzzz'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()

    expect(sheet()?.querySelectorAll('[role="option"]')).toHaveLength(0)
    expect(sheet()?.textContent).toContain('No file matches')
  })
})

describe('⌘1–5 — the sidebar sections', () => {
  test('each section opens its first file, in schema order', async () => {
    const fake = await mount()

    await fire(fake, { kind: 'section', section: 'registers' })
    // `decisions` precedes `contentions` in the schema's register order.
    expect(openFile()).toBe('wiki/decisions.md')

    await fire(fake, { kind: 'section', section: 'journal' })
    expect(openFile()).toBe('notes/2026-08-19_day.md')

    await fire(fake, { kind: 'section', section: 'notes' })
    expect(openFile()).toBe('wiki/01_scope.md')
  })

  /**
   * The words, not just the routing: the sidebar and the View menu take both the
   * list and the labels from `core.SECTION_LABEL`, which each of them used to
   * otherwise spell for itself. A section renamed in the schema has to
   * be renamed here and nowhere else.
   */
  test('every section heading is core.SECTION_LABEL, in schema order', async () => {
    await mount()

    const headings = [...document.querySelectorAll('nav h2')].map((heading) => heading.textContent)
    // An empty section has no heading at all — this fixture has no archive —
    // so the claim is the labels *and* the order, not the count.
    const labels = SECTIONS.map((section) => SECTION_LABEL[section])

    expect(headings).toEqual(labels.filter((label) => headings.includes(label)))
    expect(headings).toContain('Registers')
  })

  test('a section with nothing in it leaves the pane where it was', async () => {
    const fake = await mount()
    await fire(fake, { kind: 'section', section: 'notes' })

    await fire(fake, { kind: 'section', section: 'archive' })

    expect(openFile()).toBe('wiki/01_scope.md')
  })
})

describe('⌘⌥← / ⌘⌥→ — history', () => {
  test('back returns to the previous note and forward undoes it', async () => {
    const fake = await mount()
    expect(openFile()).toBe('wiki/00_state.md')

    await fire(fake, { kind: 'section', section: 'notes' })
    await fire(fake, { kind: 'section', section: 'registers' })
    expect(openFile()).toBe('wiki/decisions.md')

    await fire(fake, { kind: 'back' })
    expect(openFile()).toBe('wiki/01_scope.md')

    await fire(fake, { kind: 'back' })
    expect(openFile()).toBe('wiki/00_state.md')

    await fire(fake, { kind: 'forward' })
    expect(openFile()).toBe('wiki/01_scope.md')
  })

  test('back at the start of history is a no-op, not an empty pane', async () => {
    const fake = await mount()

    await fire(fake, { kind: 'back' })
    await fire(fake, { kind: 'back' })

    expect(openFile()).toBe('wiki/00_state.md')
  })

  test('the window titles itself "project — note", which is what the Window menu lists', async () => {
    const fake = await mount()
    expect(document.title).toBe('p — wiki/00_state.md')

    await fire(fake, { kind: 'section', section: 'journal' })

    expect(document.title).toBe('p — notes/2026-08-19_day.md')
  })
})

describe('⌘⇧O — the projects sheet', () => {
  test('opens the picker over the project window', async () => {
    const fake = await mount()

    await fire(fake, { kind: 'projects' })

    expect(sheet()?.getAttribute('aria-label')).toBe('Projects')
    expect(sheet()?.querySelector('h1')?.textContent).toBe('Open a project')
  })

  test('a window that already *is* the picker does not open it over itself', async () => {
    const fake = await mount({ project: undefined })

    await fire(fake, { kind: 'projects' })

    expect(sheet()).toBeNull()
    expect(document.querySelector('h1')?.textContent).toBe('Open a project')
  })
})

describe('the landing screen', () => {
  // Relative to the real clock, because the picker in a window reads the real
  // one: an hour ago is an hour ago whenever the suite runs.
  const RECENT = [
    { dir: '/Users/e/git/alpha', name: 'alpha', hue: 300, lastOpenedMs: Date.now() - 3_600_000 },
    { dir: '/Users/e/other/beta', name: 'beta', hue: 135, lastOpenedMs: Date.now() - 90_000 },
  ] as const

  const rows = (): readonly HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.project-row')]

  test('a recent project wears its own hue rather than the window hue', async () => {
    await mount({ project: undefined, recent: RECENT })

    // This is the one screen showing several projects at once, and each is the
    // colour its own window will be.
    expect(rows()).toHaveLength(2)
    expect(rows()[0]?.style.getPropertyValue('--swatch-hue')).toBe('300')
    expect(rows()[1]?.style.getPropertyValue('--swatch-hue')).toBe('135')
  })

  test('a row shows the folder and when it was last open, and reads as one name', async () => {
    await mount({ project: undefined, recent: RECENT })
    const first = rows()[0]

    // The parent folder under the name, and the full path only as the tooltip.
    expect(first?.textContent).toContain('/Users/e/git')
    expect(first?.textContent).not.toContain('/Users/e/git/alpha')
    expect(first?.getAttribute('title')).toBe('/Users/e/git/alpha')
    // A time that is a phrase, never a raw millisecond count — and a label a
    // screen reader can read, rather than three spans run together.
    expect(rows()[1]?.textContent).toContain('1 min ago')
    expect(first?.getAttribute('aria-label')).toBe('Open alpha, in /Users/e/git, last opened 1 h ago')
  })

  test('the whole row opens the project, not a word inside it', async () => {
    const fake = await mount({ project: undefined, recent: RECENT })

    await click(rows()[1])

    expect(fake.opened).toEqual(['/Users/e/other/beta'])
  })

  test('an empty list says what to choose rather than nothing', async () => {
    await mount({ project: undefined, recent: [] })

    expect(rows()).toHaveLength(0)
    expect(document.body.textContent).toContain('Nothing opened yet')
    expect(document.body.textContent).toContain('local_context/wiki')
  })

  test('the front door is marked by the mascot, and carries no diamond at all', async () => {
    await mount({ project: undefined, recent: RECENT })

    // The mark is the drawing, decorative: the heading below it is what a
    // screen reader announces.
    const mark = document.querySelector('img')
    expect(mark?.getAttribute('alt')).toBe('')

    // The diamond belongs to `Accent`, which is the accent picker and states
    // which project a window is. A window with no project shows none — not in
    // the title bar and not over the heading.
    expect(document.querySelectorAll('.rotate-45')).toHaveLength(0)
  })

  test('the front door introduces the app; the same picker as a sheet does not', async () => {
    await mount({ project: undefined, recent: RECENT })
    expect(document.body.textContent).toContain('beside the agent that writes them')

    dispose()
    document.body.innerHTML = ''
    const fake = await mount({ recent: RECENT })
    await fire(fake, { kind: 'projects' })

    expect(sheet()?.textContent).toContain('Recent')
    expect(sheet()?.textContent).not.toContain('beside the agent that writes them')
  })
})

describe('the status bar', () => {
  test('names the project, counts the notes and the open contentions, and shows the state cap', async () => {
    await mount()
    const bar = document.querySelector('footer')

    expect(bar?.textContent).toContain('p')
    expect(bar?.textContent).toContain('2 notes')
    // C3 is resolved; C1 and C2 are not.
    expect(bar?.textContent).toContain('2 open contentions')
    expect(bar?.textContent).toContain('00_state.md')
    expect(bar?.textContent).toContain('watching')
  })

  test('the count is a button that opens the register it is nagging about', async () => {
    await mount()

    await click([...document.querySelectorAll('footer button')].find((node) => node.textContent.includes('open')))

    expect(openFile()).toBe('wiki/contentions.md')
  })
})

describe('the contentions badge', () => {
  test('the sidebar row carries the open count, as a number and a sentence', async () => {
    await mount()

    const badge = [...document.querySelectorAll('nav [aria-label]')].find((node) =>
      node.getAttribute('aria-label')?.includes('open contention'),
    )

    expect(badge?.textContent).toBe('2')
    expect(badge?.getAttribute('aria-label')).toBe('2 open contentions')
  })
})

describe('the accent popover', () => {
  test('the diamond opens the palette, and a swatch sets the hue and closes it', async () => {
    const fake = await mount()
    const diamond = document.querySelector('header button')

    expect(diamond?.getAttribute('aria-expanded')).toBe('false')
    await click(diamond)
    expect(diamond?.getAttribute('aria-expanded')).toBe('true')

    const swatches = [...document.querySelectorAll('header [role="group"] button')]
    expect(swatches).toHaveLength(PALETTE.length)
    // The current hue is the pressed one, so the popover shows where it is.
    expect(swatches.filter((node) => node.getAttribute('aria-pressed') === 'true')).toHaveLength(1)

    // The graphite slot, deliberately: it is the one whose identity is a
    // *chroma* rather than a hue, and it must cross the bridge like any other.
    await click(swatches[PALETTE.length - 1])

    expect(fake.accents).toEqual([GRAPHITE])
    expect(diamond?.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('dismissing a sheet', () => {
  test('Escape closes it and leaves the window as it was', async () => {
    const fake = await mount()
    await fire(fake, { kind: 'palette' })

    await escape(sheet())

    expect(sheets()).toBe(0)
    expect(openFile()).toBe('wiki/00_state.md')
  })

  test('a click on the backdrop closes it; a click inside does not', async () => {
    const fake = await mount()
    await fire(fake, { kind: 'projects' })
    const dialog = sheet()

    // The content sits in a child, so a click whose target *is* the dialog
    // landed on the backdrop.
    ;(dialog?.querySelector('.sheet-body') as HTMLElement | null)?.click()
    await settle()
    expect(sheets()).toBe(1)

    dialog?.click()
    await settle()
    expect(sheets()).toBe(0)
  })

  test('the palette can be reopened after being dismissed, with nothing typed', async () => {
    const fake = await mount()
    await fire(fake, { kind: 'palette' })

    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')
    if (input === null) throw new Error('no palette input')
    input.value = 'arch'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    await escape(sheet())

    await fire(fake, { kind: 'palette' })

    const reopened = document.querySelector<HTMLInputElement>('[role="combobox"]')
    expect(reopened?.value).toBe('')
    expect(reopened?.getAttribute('aria-activedescendant')).toBe('palette-option-0')
  })

  test('⌘K over the picker sheet stacks rather than replacing it', async () => {
    const fake = await mount()
    await fire(fake, { kind: 'projects' })
    await fire(fake, { kind: 'palette' })

    // Native top-layer behaviour: both are up, the newer one on top, and
    // closing it leaves the reader in the one underneath. (Which is "on top" is
    // the browser's top layer, not DOM order, so it is not asserted here.)
    expect(sheets()).toBe(2)

    await escape(labelled('Jump to file'))

    expect(sheets()).toBe(1)
    expect(sheet()?.getAttribute('aria-label')).toBe('Projects')
  })
})

describe('the palette keyboard, at the edges', () => {
  const press = async (key: string): Promise<void> => {
    document.querySelector('[role="combobox"]')?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    await settle()
  }

  test('ArrowUp at the top wraps to the last match', async () => {
    const fake = await mount()
    await fire(fake, { kind: 'palette' })

    await press('ArrowUp')

    const last = FILES.size - 1
    expect(document.querySelector('[role="combobox"]')?.getAttribute('aria-activedescendant')).toBe(
      `palette-option-${String(last)}`,
    )
  })

  test('Enter with nothing matching does nothing, and leaves the sheet open', async () => {
    const fake = await mount()
    await fire(fake, { kind: 'palette' })

    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')
    if (input === null) throw new Error('no palette input')
    input.value = 'zzzz'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(input.getAttribute('aria-activedescendant')).toBeNull()

    await press('Enter')

    expect(sheets()).toBe(1)
    expect(openFile()).toBe('wiki/00_state.md')
  })
})

describe('the projects sheet, used', () => {
  const RECENT = [
    { dir: '/other', name: 'other', hue: 150, lastOpenedMs: 2 },
    { dir: '/older', name: 'older', hue: 95, lastOpenedMs: 1 },
  ]

  test('lists the recent projects and opens the one that is clicked', async () => {
    const fake = await mount({ recent: RECENT })
    await fire(fake, { kind: 'projects' })

    const rows = [...(sheet()?.querySelectorAll('ul button') ?? [])]
    expect(rows).toHaveLength(2)

    await click(rows[0])

    expect(fake.opened).toEqual(['/other'])
    // The window is behind the sheet, so the sheet has to get out of the way.
    expect(sheets()).toBe(0)
  })

  test('a refused folder is announced inside the sheet, which stays open', async () => {
    const fake = await mount({ recent: RECENT, refuseOpen: { kind: 'no-llmwiki', dir: '/nope', markers: { agentFiles: [], wiki: false } } })
    await fire(fake, { kind: 'projects' })

    await click(sheet()?.querySelector('ul button'))

    expect(sheets()).toBe(1)
    expect(sheet()?.querySelector('[role="alert"]')?.textContent).toContain('No llmwiki project')
  })
})

describe('a window with no project', () => {
  test('ignores every command a project view would answer', async () => {
    const fake = await mount({ project: undefined })

    for (const command of [
      { kind: 'palette' },
      { kind: 'back' },
      { kind: 'forward' },
      { kind: 'section', section: 'notes' },
    ] as const) {
      await fire(fake, command)
    }

    expect(sheets()).toBe(0)
    expect(document.querySelector('h1')?.textContent).toBe('Open a project')
  })
})

describe('no open contentions', () => {
  const CALM = new Map([
    ['wiki/00_state.md', STATE],
    ['wiki/contentions.md', '# contentions\n\n## C1 — settled (RESOLVED 2026-08-19)\n'],
  ])

  test('the badge is absent, and the rail still says so in words', async () => {
    await mount({
      project: { ...project, files: [...CALM.keys()] },
      files: CALM,
    })

    const badge = [...document.querySelectorAll('nav [aria-label]')].find((node) =>
      node.getAttribute('aria-label')?.includes('contention'),
    )
    expect(badge).toBeUndefined()
    expect(document.querySelector('footer')?.textContent).toContain('no open contentions')
  })
})

describe('the accent popover, dismissed', () => {
  test('a pointerdown outside closes it; one inside does not', async () => {
    await mount()
    const diamond = document.querySelector('header button')
    await click(diamond)

    document.querySelector('header [role="group"]')?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await settle()
    expect(diamond?.getAttribute('aria-expanded')).toBe('true')

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await settle()
    expect(diamond?.getAttribute('aria-expanded')).toBe('false')
  })

  test('Escape closes it', async () => {
    await mount()
    const diamond = document.querySelector('header button')
    await click(diamond)

    diamond?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()

    expect(diamond?.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the window lets go when it unmounts', () => {
  test('both bridge subscriptions are dropped, and a later command reaches nobody', async () => {
    const fake = await mount()
    // Three event listeners: the window's, for the project snapshot; the note
    // store's, for the files it has read; and the debt section's, which re-asks
    // the checkers whenever the project changes on disk.
    expect(fake.listening()).toEqual({ commands: 1, events: 3 })

    dispose()
    dispose = (): void => undefined

    expect(fake.listening()).toEqual({ commands: 0, events: 0 })
    // The document-level popover listener goes with it, so this must not throw.
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    fake.send({ kind: 'palette' })
    await settle()
    expect(sheets()).toBe(0)
  })
})
