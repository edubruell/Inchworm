// @vitest-environment happy-dom
/**
 * The editor, end to end through the real bridge shape: the ⌥⏎ toggle, the
 * sha-guarded save, the conflict banner and the register append affordance.
 *
 * "The file moved under the editor" is exercised here rather than reasoned
 * about: the sha guard is only a promise until something takes both ways out.
 */

import { EditorView } from '@codemirror/view'
import { docText, frontmatterEnd } from './sourceMode.js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, test } from 'vitest'
import type { Command, ProjectSnapshot } from '@shared/api.js'
import { fakeApi, type FakeApi } from '../../../tests/support/api.js'
import { App } from './App.jsx'

const STATE = `---
status: active
updated: 2026-08-20
---

# state — p
`

const CRLF = '---\r\nstatus: active\r\n---\r\n\r\n# windows\r\n'

const files = (): Map<string, string> =>
  new Map([
    ['wiki/00_state.md', STATE],
    ['wiki/03_crlf.md', CRLF],
    ['wiki/04_links.md', '# links\n\n[[00_state]] and [[99_missing]]\n\n<https://example.com/a>\n'],
    ['wiki/contentions.md', '# contentions\n\n## C1 — one (fragile)\n'],
    ['wiki/budgets.md', '# budgets\n\n| date |\n|---|\n'],
    ['wiki/decisions.md', '# decisions\n'],
    ['CLAUDE.md', '# CLAUDE\n'],
  ])

const project = (list: ReadonlyMap<string, string>): ProjectSnapshot => ({
  dir: '/p',
  name: 'p',
  hue: 210,
  layout: { wikiRoot: 'wiki', journal: 'notes', kind: 'software' },
  files: [...list.keys()],
})

let dispose = (): void => undefined

afterEach(() => {
  dispose()
  document.body.innerHTML = ''
  delete (window as { wiki?: unknown }).wiki
})

const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 12; tick += 1) await Promise.resolve()
}

const mount = async (): Promise<{ readonly fake: FakeApi; readonly list: Map<string, string> }> => {
  const list = files()
  const fake = fakeApi({ project: project(list), files: list })
  Object.defineProperty(window, 'wiki', { value: fake.api, configurable: true })
  dispose = render(() => <App />, document.body)
  await settle()
  return { fake, list }
}

const fire = async (fake: FakeApi, command: Command): Promise<void> => {
  fake.send(command)
  await settle()
}

const click = async (element: Element | null | undefined): Promise<void> => {
  ;(element as HTMLElement | null | undefined)?.click()
  await settle()
}

const button = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((element) => element.textContent.includes(text))

/**
 * The view's own headings. A closed `<dialog>` keeps its heading in the DOM and
 * it belongs to nobody, so the a11y count is taken outside the sheets — the
 * rule for counting them.
 */
const headings = (): readonly Element[] =>
  [...document.querySelectorAll('main h1')].filter((element) => element.closest('dialog') === null)

/** The CodeMirror document, as the reader sees it. */
const source = (): HTMLElement | null => document.querySelector<HTMLElement>('.cm-content')

/** The `EditorView` behind the mounted pane, or nothing. */
const cmView = (): EditorView | null => {
  const host = source()
  return host === null ? null : EditorView.findFromDOM(host)
}

/** Type into the editor the way the editor's own listener sees it. */
const type = async (text: string): Promise<void> => {
  const editor = cmView()
  if (editor === null) throw new Error('no editor mounted')
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } })
  await settle()
}

describe('view ⇄ edit', () => {
  test('⌥⏎ swaps prose for source on the same pane and the same file', async () => {
    const { fake } = await mount()

    expect(source()).toBeNull()
    await fire(fake, { kind: 'edit' })

    expect(source()?.textContent).toContain('# state — p')
    // The heading is the view's, and the view has not changed: still one h1,
    // still the open file.
    expect(headings()).toHaveLength(1)
    expect(headings()[0]?.textContent).toBe('wiki/00_state.md')

    await fire(fake, { kind: 'edit' })
    expect(source()).toBeNull()
  })

  test('the toggle is also a control, and it says which state it is in', async () => {
    const { fake } = await mount()
    expect(button('Edit source')?.getAttribute('aria-pressed')).toBe('false')

    await fire(fake, { kind: 'edit' })
    expect(button('Read')?.getAttribute('aria-pressed')).toBe('true')
  })

  test('the editable region names the file, for a reader who cannot see the header', async () => {
    const { fake } = await mount()
    await fire(fake, { kind: 'edit' })

    expect(source()?.getAttribute('aria-label')).toBe('Source of wiki/00_state.md')
  })
})

describe('saving', () => {
  test('⌘S writes the bytes that are in the editor, guarded by the sha it started from', async () => {
    const { fake } = await mount()
    await fire(fake, { kind: 'edit' })
    await type('# changed\n')
    await fire(fake, { kind: 'save' })

    expect(fake.writes).toEqual([{ path: 'wiki/00_state.md', text: '# changed\n', baseSha: `sha:${STATE}` }])
  })

  test('nothing is written until something changed', async () => {
    const { fake } = await mount()
    await fire(fake, { kind: 'edit' })
    await fire(fake, { kind: 'save' })

    expect(fake.writes).toEqual([])
    expect(button('Save')?.disabled).toBe(true)
  })

  test('a save leaves the window reading its own bytes, without waiting for the watcher', async () => {
    const { fake } = await mount()
    await fire(fake, { kind: 'edit' })
    await type('# changed\n')
    await fire(fake, { kind: 'save' })
    await fire(fake, { kind: 'edit' })

    // Back in the prose pane: the note the window shows is the one it saved.
    expect(document.querySelector('.prose')?.textContent).toContain('changed')
    // And no conflict banner over its own write — the sha it wrote is the sha
    // it is now guarding on.
    expect(document.body.textContent).not.toContain('was written by something else')
  })

  test('the state line names what is unsaved, in words', async () => {
    const { fake } = await mount()
    await fire(fake, { kind: 'edit' })
    expect(document.body.textContent).toContain('saved')

    await type('# changed\n')
    expect(document.body.textContent).toContain('unsaved changes')
    expect(document.body.textContent).toContain('1 unsaved file')
  })
})

describe('the file moving underneath — [[contentions#C3]]', () => {
  /** Someone else writes the file, and the watcher tells this window. */
  const elsewhere = async (fake: FakeApi, list: Map<string, string>, text: string): Promise<void> => {
    list.set('wiki/00_state.md', text)
    fake.emit({ kind: 'file', dir: '/p', path: 'wiki/00_state.md' })
    await settle()
  }

  test('a genuinely diverged save is refused by the guard, merges nothing, and offers both ways out', async () => {
    const { fake, list } = await mount()
    await fire(fake, { kind: 'edit' })
    await type('# mine\n')
    await elsewhere(fake, list, '# theirs\n')

    await fire(fake, { kind: 'save' })

    // The write was attempted with the sha the editor started from, and main
    // refused it — nothing staged, the fake compares the sha like main does.
    expect(fake.writes).toEqual([{ path: 'wiki/00_state.md', text: '# mine\n', baseSha: `sha:${STATE}` }])
    expect(list.get('wiki/00_state.md')).toBe('# theirs\n')

    const banner = document.querySelector('[role="alert"]')
    expect(banner?.textContent).toContain('was written by something else')
    expect(banner?.textContent).toContain('Nothing has been saved and nothing has been merged')
    expect(button('Discard my changes and reload')).toBeDefined()
    expect(button('Overwrite the other change')).toBeDefined()
    // The draft is untouched: refusing a write must never cost the reader
    // what they typed.
    expect(source()?.textContent).toContain('# mine')
  })

  test('overwriting re-aims the guard at what is on disk now, so it is a decision and not a race', async () => {
    const { fake, list } = await mount()
    await fire(fake, { kind: 'edit' })
    await type('# mine\n')
    await elsewhere(fake, list, '# theirs\n')
    await fire(fake, { kind: 'save' })

    await click(button('Overwrite the other change'))

    expect(fake.writes.map((write) => write.baseSha)).toEqual([`sha:${STATE}`, 'sha:# theirs\n'])
    expect(list.get('wiki/00_state.md')).toBe('# mine\n')
  })

  test('reloading discards the draft and takes the bytes on disk', async () => {
    const { fake, list } = await mount()
    await fire(fake, { kind: 'edit' })
    await type('# mine\n')
    await elsewhere(fake, list, '# theirs\n')

    expect(document.body.textContent).toContain('changed on disk and here')
    await click(button('Discard my changes and reload'))
    expect(source()?.textContent).toContain('# theirs')
    expect(fake.writes).toEqual([])
  })

  test('a change on disk with nothing typed here is offered, not forced', async () => {
    const { fake, list } = await mount()
    await fire(fake, { kind: 'edit' })
    await elsewhere(fake, list, '# theirs\n')

    expect(document.body.textContent).toContain('changed on disk — reload to see it')
    // Not taken automatically: the editor is the reader's, even when the draft
    // holds nothing of their own yet.
    expect(source()?.textContent).toContain('# state — p')
    await click(button('Reload from disk'))
    expect(source()?.textContent).toContain('# theirs')
  })

  test('a save that fails for any other reason says so, and keeps the draft', async () => {
    const list = files()
    const fake = fakeApi({ project: project(list), files: list, refuseWrite: { kind: 'not-found' } })
    Object.defineProperty(window, 'wiki', { value: fake.api, configurable: true })
    dispose = render(() => <App />, document.body)
    await settle()

    await fire(fake, { kind: 'edit' })
    await type('# mine\n')
    await fire(fake, { kind: 'save' })

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('no longer there')
    expect(source()?.textContent).toContain('# mine')
  })
})

describe('the register append affordance', () => {
  test('a block-shaped register offers it; the entry lands at the bottom, in a draft', async () => {
    const { fake, list } = await mount()
    await fire(fake, { kind: 'section', section: 'registers' })
    // Registers come in schema order, never alphabetical: `decisions` first.
    expect(document.querySelector('main h1')?.textContent).toBe('wiki/decisions.md')
    expect(button('Append entry from template')).toBeDefined()

    // A table-shaped register has no affordance rather than a wrong one: a row
    // appended after the prose that follows the table is a broken file.
    await click(button('budgets'))
    expect(document.querySelector('main h1')?.textContent).toBe('wiki/budgets.md')
    expect(button('Append entry from template')).toBeUndefined()
    expect(list.get('wiki/budgets.md')).toBe('# budgets\n\n| date |\n|---|\n')
  })

  test('the template is the register’s own, numbered from the entries already there', async () => {
    const { fake, list } = await mount()
    await fire(fake, { kind: 'section', section: 'registers' })
    await click(button('contentions'))

    await click(button('Append entry from template'))

    expect(source()?.textContent).toContain('## C2 —')
    // Nothing has been written: the app never appends to disk on its own.
    expect(fake.writes).toEqual([])
    expect(list.get('wiki/contentions.md')).toBe('# contentions\n\n## C1 — one (fragile)\n')

    await fire(fake, { kind: 'save' })
    expect(list.get('wiki/contentions.md')).toContain('## C1 — one (fragile)\n\n## C2 —')
  })
})

describe('source mode', () => {
  test('frontmatterEnd finds the leading block, and only a leading one', () => {
    // Through the closing `---` and its newline, and no further.
    expect(frontmatterEnd('---\nstatus: active\n---\n\n# note\n')).toBe(23)
    // Not at the start of the file: not frontmatter.
    expect(frontmatterEnd('# note\n\n---\na: 1\n---\n')).toBe(0)
    // Opened and never closed: nothing to decorate rather than the whole file.
    expect(frontmatterEnd('---\nstatus: active\n')).toBe(0)
    expect(frontmatterEnd('')).toBe(0)
  })

  test('a resolved link is marked, and a dangling one differently — never by colour alone', async () => {
    const { fake } = await mount()
    await fire(fake, { kind: 'palette' })
    await click(button('04_links.md'))
    await fire(fake, { kind: 'edit' })

    expect(document.querySelectorAll('.cm-wikilink')).toHaveLength(1)
    expect(document.querySelectorAll('.cm-wikilink-dangling')).toHaveLength(1)
    expect(document.querySelector('.cm-wikilink-dangling')?.textContent).toBe('[[99_missing]]')
  })

  test('a link that the agent has just created stops being dangling without a keystroke', async () => {
    const { fake, list } = await mount()
    await fire(fake, { kind: 'palette' })
    await click(button('04_links.md'))
    await fire(fake, { kind: 'edit' })
    expect(document.querySelectorAll('.cm-wikilink-dangling')).toHaveLength(1)

    list.set('wiki/99_missing.md', '# missing no more\n')
    fake.emit({ kind: 'files', dir: '/p', files: [...list.keys()] })
    await settle()

    expect(document.querySelectorAll('.cm-wikilink-dangling')).toHaveLength(0)
    expect(document.querySelectorAll('.cm-wikilink')).toHaveLength(2)
  })

  test('the frontmatter block is marked as its own region', async () => {
    const { fake } = await mount()
    await fire(fake, { kind: 'edit' })

    expect(document.querySelectorAll('.cm-frontmatter').length).toBeGreaterThan(0)
  })

  test('the source pane numbers its lines, and only the source pane does', async () => {
    const { fake } = await mount()
    // Reading mode is prose: no gutter, because a rendered note has no lines.
    expect(document.querySelector('.cm-lineNumbers')).toBeNull()

    await fire(fake, { kind: 'edit' })

    // The first gutter element is CodeMirror's invisible width spacer, not a line.
    const numbers = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
      .slice(1)
      .map((element) => element.textContent)
    expect(numbers.slice(0, 3)).toEqual(['1', '2', '3'])
  })
})

describe('byte-faithfulness', () => {
  test('a CRLF file keeps its line endings through an edit and a save', async () => {
    const { fake, list } = await mount()
    await fire(fake, { kind: 'palette' })
    await click(button('03_crlf.md'))
    await fire(fake, { kind: 'edit' })

    // The editor is showing the file's own bytes, endings included.
    const view = cmView()
    expect(view === null ? undefined : docText(view.state)).toBe(CRLF)

    view?.dispatch({ changes: { from: view.state.doc.length, insert: 'more' } })
    await settle()
    await fire(fake, { kind: 'save' })

    // No formatter is ever pointed at a wiki file (wiki CLAUDE.md).
    expect(list.get('wiki/03_crlf.md')).toBe(`${CRLF}more`)
    expect(list.get('wiki/03_crlf.md')).toContain('\r\n')
  })
})

describe('what a draft survives', () => {
  test('navigating away and back keeps what was typed', async () => {
    const { fake } = await mount()
    await fire(fake, { kind: 'edit' })
    await type('# mine\n')

    await fire(fake, { kind: 'palette' })
    await click(button('04_links.md'))
    // Still in edit mode, and showing the *other* file — not a blank pane.
    expect(source()?.textContent).toContain('links')

    await fire(fake, { kind: 'back' })
    expect(source()?.textContent).toContain('# mine')
    expect(document.body.textContent).toContain('unsaved changes')
  })

  test('a file the window cannot read drops the pane back to reading, never to nothing', async () => {
    const { fake, list } = await mount()
    await fire(fake, { kind: 'edit' })
    expect(source()).not.toBeNull()

    // The file leaves the project while it is open, with nothing typed.
    list.delete('wiki/00_state.md')
    fake.emit({ kind: 'files', dir: '/p', files: [...list.keys()] })
    await settle()

    expect(document.querySelector('main h1')).not.toBeNull()
  })
})

describe('a note that is no longer on disk', () => {
  test('a save refused because the file is gone still says so', async () => {
    // `''` is main's sha for a file that is not there — a falsy value that used
    // to hide the banner over exactly the case that risks losing work.
    const list = files()
    const fake = fakeApi({ project: project(list), files: list, refuseWrite: { kind: 'conflict', currentSha: '' } })
    Object.defineProperty(window, 'wiki', { value: fake.api, configurable: true })
    dispose = render(() => <App />, document.body)
    await settle()

    await fire(fake, { kind: 'edit' })
    await type('# mine\n')
    await fire(fake, { kind: 'save' })

    const banner = document.querySelector('[role="alert"]')
    expect(banner?.textContent).toContain('no longer on disk')
    expect(button('Write it back')).toBeDefined()
  })
})

describe('the append affordance, in detail', () => {
  test('the caret lands in the skeleton, not at the top of the file', async () => {
    const { fake } = await mount()
    await fire(fake, { kind: 'section', section: 'registers' })
    await click(button('contentions'))
    await click(button('Append entry from template'))

    const view = cmView()
    const head = view?.state.selection.main.head ?? 0
    expect(view?.state.doc.sliceString(head, head + 4)).toBe('## C')
  })

  test('the date is the one the window was handed, in local time', async () => {
    const { fake } = await mount()
    await fire(fake, { kind: 'section', section: 'registers' })
    await click(button('Append entry from template'))

    const today = new Date().toLocaleDateString('en-CA')
    expect(source()?.textContent).toContain(`## [${today}]`)
  })
})

describe('a web link in a note', () => {
  test('leaves through the OS, and the window never navigates', async () => {
    const { fake } = await mount()
    await fire(fake, { kind: 'palette' })
    await click(button('04_links.md'))

    const anchor = document.querySelector<HTMLElement>('.prose a[href^="https://"]')
    expect(anchor).not.toBeNull()
    await click(anchor)

    expect(fake.externals).toEqual(['https://example.com/a'])
    // A `[[link]]` in the same prose is navigation, not a URL.
    expect(fake.externals).toHaveLength(1)
  })

  /**
   * The other half of the same handler, and the half easiest to leave
   * unclicked: a resolved wikilink carries the path
   * `core` put in `data-path`, and opening it is navigation inside the window.
   */
  test('a resolved wikilink navigates by its data-path, and never leaves', async () => {
    const { fake } = await mount()
    await fire(fake, { kind: 'palette' })
    await click(button('04_links.md'))

    const wikilink = document.querySelector<HTMLElement>('.prose a.wikilink[data-path]')
    expect(wikilink?.dataset.path).toBe('wiki/00_state.md')
    await click(wikilink)

    expect(document.querySelector('main h1')?.textContent).toBe('wiki/00_state.md')
    expect(fake.externals).toHaveLength(0)
  })
})
