// @vitest-environment happy-dom
/**
 * The structural half of the accessibility floor: **one `h1` per view**, and a
 * failed read that is *announced* rather than merely tinted. The other half —
 * the words, glyphs and roles — is pure and pinned by `signals.test.ts`; these
 * properties are not expressible without a document, which is what `happy-dom`
 * buys.
 *
 * `App` is rendered whole, not a component in isolation: "per view" is a claim
 * about the window, and the alternative to asserting it here is wiring the app
 * up in a browser by hand.
 */

import { render } from 'solid-js/web'
import { afterEach, describe, expect, test } from 'vitest'
import type { FileError, ProjectSnapshot, WikiApi } from '@shared/api.js'
import { fakeApi } from '../../../tests/support/api.js'
import { App } from './App.jsx'

const STATE = `---
status: active
updated: 2026-08-20
---

# state — p

## Now

- see [[02_arch]]

### deeper
`

const FILES = new Map([
  ['wiki/00_state.md', STATE],
  ['wiki/02_arch.md', '# arch\n'],
  ['CLAUDE.md', '# CLAUDE\n'],
])

const snapshot: ProjectSnapshot = {
  dir: '/p',
  name: 'p',
  hue: 210,
  layout: { wikiRoot: 'wiki', journal: 'notes', kind: 'software' },
  files: [...FILES.keys()],
}

const NOT_FOUND: FileError = { kind: 'not-found' }

let dispose = (): void => undefined

afterEach(() => {
  dispose()
  document.body.innerHTML = ''
  delete (window as { wiki?: WikiApi }).wiki
})

/** Mounts the real `App` against `window.wiki`, then lets the resources settle. */
const mount = async (api: WikiApi | undefined): Promise<void> => {
  if (api !== undefined) Object.defineProperty(window, 'wiki', { value: api, configurable: true })
  dispose = render(() => <App />, document.body)
  for (let tick = 0; tick < 8; tick += 1) await Promise.resolve()
}

/**
 * The `h1`s of the **active view**. A modal `<dialog>` makes the rest of the
 * document inert, so while a sheet is open the sheet is the view; a closed
 * dialog is not rendered at all and its heading is nobody's.
 */
const headings = (): readonly string[] => {
  const modal = document.querySelector('dialog[open]')
  const scope: ParentNode = modal ?? document
  return [...scope.querySelectorAll('h1')]
    .filter((node) => modal !== null || node.closest('dialog') === null)
    .map((node) => node.textContent)
}

describe('one h1 per view', () => {
  test('the project view: the file path, and the note is a document inside it', async () => {
    await mount(fakeApi({ project: snapshot, files: FILES }).api)

    expect(headings()).toEqual(['wiki/00_state.md'])
    // The note opens with `# state — p`; demoted, or the window has two.
    expect(document.querySelector('.prose')?.innerHTML).toContain('<h2>')
  })

  test('an open sheet is the view: its heading is the only one, and the window’s is inert', async () => {
    const api = fakeApi({ project: snapshot, files: FILES })
    await mount(api.api)

    api.send({ kind: 'palette' })
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve()

    expect(headings()).toEqual(['Jump to file'])
    // The window's own h1 is still in the document — `showModal` is what makes
    // it inert, which is why the rule is about the view and not the DOM. (The
    // projects sheet contributes nothing: it is mounted with its own opening.)
    const all = [...document.querySelectorAll('h1')].map((node) => node.textContent)
    expect(all).toContain('wiki/00_state.md')
    expect(all).toEqual(['wiki/00_state.md', 'Jump to file'])
  })

  test('the picker: a window with no project is still a view', async () => {
    await mount(fakeApi({ project: undefined }).api)

    expect(headings()).toEqual(['Open a project'])
  })

  test('no bridge: a failure state carries its own heading', async () => {
    await mount(undefined)

    expect(headings()).toEqual(['Inchworm'])
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('without its preload')
  })
})

/**
 * Not accessibility, but the same *kind* of property: a claim about the whole
 * window that no component can be asked about, and one that cost six of the
 * eight accent swatches before it had a runner.
 *
 * `-webkit-app-region` is a geometric region the OS computes in **document
 * order**, and a later `drag` element re-covers an earlier `no-drag`. The
 * CLAUDE.md row was a second, full-width drag strip rendered after the header,
 * so the accent popover hanging under the header fell inside it and its clicks
 * went to the window manager instead of the page — invisibly, and invisibly to
 * a CDP check too, because injected events bypass the OS layer entirely
 * OS layer entirely.
 */
describe('the window has exactly one drag region', () => {
  test('and it is the title bar, so no strip can swallow an overlay under it', async () => {
    await mount(fakeApi({ project: snapshot, files: FILES }).api)

    const dragging = [...document.querySelectorAll('.drag')]

    expect(dragging).toHaveLength(1)
    expect(dragging[0]?.tagName).toBe('HEADER')
  })
})

describe('a failure is announced, not tinted', () => {
  test('a read the main process refuses puts an alert in the view', async () => {
    await mount(fakeApi({ project: snapshot, files: FILES, fail: NOT_FOUND }).api)

    const alert = document.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Failed')
    // Still one heading: the failure lands *inside* the view, not instead of it.
    expect(headings()).toEqual(['wiki/00_state.md'])
  })
})
