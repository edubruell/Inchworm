// @vitest-environment happy-dom
/**
 * The export button in the title bar: which word it sends, what it says back,
 * and where it is not.
 *
 * Mounted through `App` rather than over the component, because half of what is
 * under test is that the button belongs to a *project* window — the picker and
 * the agent window have no wiki to export.
 */

import { render } from 'solid-js/web'
import { afterEach, describe, expect, test } from 'vitest'
import type { ExportError, ExportResult, ProjectSnapshot } from '@shared/api.js'
import { fakeApi, type FakeApi } from '../../../tests/support/api.js'
import { App } from './App.jsx'

const FILES = new Map([
  ['wiki/00_state.md', '# state\n'],
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
    readonly pending?: { readonly dir: string }
    readonly exportResult?: ExportResult
    readonly refuseExport?: ExportError
    readonly rejectExport?: boolean
    readonly deferExport?: boolean
  } = {},
): Promise<FakeApi> => {
  const fake = fakeApi({
    project: 'project' in options ? options.project : project,
    files: FILES,
    pending: options.pending,
    exportResult: options.exportResult,
    refuseExport: options.refuseExport,
    rejectExport: options.rejectExport,
    deferExport: options.deferExport,
  })
  Object.defineProperty(window, 'wiki', { value: fake.api, configurable: true })
  dispose = render(() => <App />, document.body)
  await settle()
  return fake
}

const trigger = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>('button[aria-label="Export this wiki"]')

const choice = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Export scope"] button')].find((button) =>
    button.textContent.startsWith(label),
  )

const click = async (element: Element | null | undefined): Promise<void> => {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await settle()
}

const popover = (): Element | null => document.querySelector('[aria-label="Export scope"]')

describe('where the button is', () => {
  test('in the title bar of a project window', async () => {
    await mount()
    expect(trigger()).not.toBeNull()
  })

  // Nothing to export: the picker is about projects, not inside one.
  test('not in the picker', async () => {
    await mount({ project: undefined })
    expect(trigger()).toBeNull()
  })

  // An agent window is a folder with no wiki yet — the whole reason it exists.
  test('not in an agent window', async () => {
    await mount({ project: undefined, pending: { dir: '/somewhere' } })
    expect(trigger()).toBeNull()
  })

  test('it does not drag the window', async () => {
    await mount()
    expect(trigger()?.classList.contains('no-drag')).toBe(true)
  })
})

describe('choosing a bundle', () => {
  test('the two scopes are offered, and only after the button is pressed', async () => {
    await mount()
    expect(popover()).toBeNull()
    await click(trigger())
    expect(choice('Whole wiki')).toBeDefined()
    expect(choice('Key notes')).toBeDefined()
  })

  test('sends the word, and never a path', async () => {
    const fake = await mount()
    await click(trigger())
    await click(choice('Key notes'))
    expect(fake.exported()).toEqual(['curated'])
  })

  test('the whole wiki is its own scope', async () => {
    const fake = await mount()
    await click(trigger())
    await click(choice('Whole wiki'))
    expect(fake.exported()).toEqual(['everything'])
  })
})

describe('what it says back', () => {
  test('a saved bundle names the file, the count and the size', async () => {
    await mount({ exportResult: { kind: 'saved', path: '/tmp/p-notes-2026-09-19.zip', files: 12, bytes: 20_480 } })
    await click(trigger())
    await click(choice('Key notes'))
    const text = popover()?.textContent ?? ''
    expect(text).toContain('12 files')
    expect(text).toContain('20 kB')
    expect(text).toContain('/tmp/p-notes-2026-09-19.zip')
  })

  // The reader closed the dialog. Telling them so is the app narrating their
  // own gesture back at them, so the popover just goes.
  test('a cancelled dialog says nothing and closes', async () => {
    await mount({ exportResult: { kind: 'cancelled' } })
    await click(trigger())
    await click(choice('Whole wiki'))
    expect(popover()).toBeNull()
  })

  test('a refusal is the wire error as a sentence, and stays on screen', async () => {
    await mount({ refuseExport: { kind: 'empty' } })
    await click(trigger())
    await click(choice('Key notes'))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Nothing in this project matches that scope')
  })

  // The invoke itself never coming back would otherwise leave "Packing…" up for
  // the life of the window.
  test('a bridge that never answers is reported rather than spun on', async () => {
    await mount({ rejectExport: true })
    await click(trigger())
    await click(choice('Whole wiki'))
    expect(popover()?.textContent).not.toContain('Packing…')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('did not come back')
  })

  // A red line from the last attempt sitting under a fresh one would be the app
  // reporting an outcome that is no longer true.
  test('reopening the popover clears the previous outcome', async () => {
    await mount({ refuseExport: { kind: 'empty' } })
    await click(trigger())
    await click(choice('Key notes'))
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
    await click(trigger())
    await click(trigger())
    expect(popover()?.textContent).not.toContain('Nothing in this project')
  })
})

describe('while an export is in flight', () => {
  const start = async (): Promise<FakeApi> => {
    const fake = await mount({ deferExport: true })
    await click(trigger())
    await click(choice('Whole wiki'))
    return fake
  }

  test('it says so, and both scopes refuse a second click', async () => {
    const fake = await start()
    expect(popover()?.textContent).toContain('Packing…')
    expect(choice('Whole wiki')?.disabled).toBe(true)
    expect(choice('Key notes')?.disabled).toBe(true)
    await click(choice('Key notes'))
    expect(fake.exported()).toEqual(['everything'])
    fake.settleExport()
    await settle()
  })

  /*
   * The save panel is a sheet on the window, but the window keeps taking
   * clicks. Dismissing the popover here would throw away the line that names
   * the file just written, and the reader would never learn where it went.
   */
  test('a click on the window behind does not dismiss it', async () => {
    const fake = await start()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await settle()
    expect(popover()).not.toBeNull()
    fake.settleExport()
    await settle()
    expect(popover()?.textContent).toContain('/tmp/bundle.zip')
  })

  test('once it has landed, a click outside dismisses it again', async () => {
    const fake = await start()
    fake.settleExport()
    await settle()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await settle()
    expect(popover()).toBeNull()
  })
})

describe('the popover lets go of the document', () => {
  test('after the window is disposed, a stray pointerdown reaches nothing', async () => {
    await mount()
    await click(trigger())
    expect(popover()).not.toBeNull()
    dispose()
    dispose = (): void => undefined
    document.body.innerHTML = ''
    // The listener is registered on `document`, which outlives the app: a leak
    // here is a handler still firing into a disposed component.
    expect(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    }).not.toThrow()
  })
})
