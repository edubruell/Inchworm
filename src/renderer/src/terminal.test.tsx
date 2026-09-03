// @vitest-environment happy-dom
/**
 * The terminal drawer: ⌃`, the tabs, the shades, and where a pane's bytes go.
 *
 * `node-pty` is nowhere near this file — the bridge is the fake one, exactly as
 * the window sees it. What the addon itself does is `main/pty.test.ts`'s and
 * the packaged run's.
 */

import { createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, test } from 'vitest'
import { DRAWER_DEFAULT, DRAWER_MIN, DRAWER_STEP, clampDrawer, drawerFull, drawerSplit } from '@core/drawer.js'
import type { ProjectSnapshot } from '@shared/api.js'
import { fakeApi, type FakeApi } from '../../../tests/support/api.js'
import { App } from './App.jsx'
import { createTerminals } from './terminals.js'

const FILES = new Map([
  ['wiki/00_state.md', '# state\n'],
  ['CLAUDE.md', '# CLAUDE\n'],
])

const project: ProjectSnapshot = {
  dir: '/p',
  name: 'p',
  hue: 210,
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
  for (let tick = 0; tick < 12; tick += 1) await Promise.resolve()
}

const mount = async (): Promise<FakeApi> => {
  const fake = fakeApi({ project, files: new Map(FILES) })
  Object.defineProperty(window, 'wiki', { value: fake.api, configurable: true })
  dispose = render(() => <App />, document.body)
  await settle()
  return fake
}

const drawer = (): HTMLElement | null => document.querySelector('[aria-label="Terminal"]')

const button = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((element) => element.textContent.trim() === text)

const click = async (element: Element | null | undefined): Promise<void> => {
  ;(element as HTMLElement | null | undefined)?.click()
  await settle()
}

describe('the drawer', () => {
  test('⌃` opens it and ⌃` closes it, and it is a named region either way', async () => {
    const fake = await mount()
    expect(drawer()).toBeNull()

    fake.send({ kind: 'terminal' })
    await settle()
    expect(drawer()).not.toBeNull()
    expect(document.body.textContent).toContain('No pane open')

    fake.send({ kind: 'terminal' })
    await settle()
    expect(drawer()).toBeNull()
  })

  test('a pane starts on the preset that was asked for, and the tab says which agent', async () => {
    const fake = await mount()
    fake.send({ kind: 'terminal' })
    await settle()

    await click(button('+ claude'))

    expect(fake.started).toEqual(['agent'])
    // The *launcher's* label, not the word "agent": two agents in one window
    // must have two distinguishable tabs.
    expect(fake.launched).toEqual(['claude'])
    expect(drawer()?.textContent).toContain('claude')
    // Named, not only shaded: the difference survives greyscale.
    expect(document.querySelector('.xterm')).not.toBeNull()
  })

  test('the agent pane is the loud shade and a plain shell is neutral — one hue, three shades', async () => {
    const fake = await mount()
    fake.send({ kind: 'terminal' })
    await settle()
    await click(button('+ claude'))
    await click(button('+ shell'))

    const tabs = [...(drawer()?.querySelectorAll('button') ?? [])].filter((element) =>
      element.className.includes('border-b-'),
    )
    // Word-bounded: `border-accent-line` contains `border-accent`, so a
    // `toContain` here passes with the shades swapped.
    expect(tabs[0]?.className).toMatch(/\bborder-accent\b/)
    // Neutral is the drawer's own line now that the drawer is a dark surface,
    // not the window's hairline — still "no accent", which is the claim.
    expect(tabs[1]?.className).toMatch(/\bborder-term-line\b/)
  })

  test('a pane whose process died says so and stays readable', async () => {
    const fake = await mount()
    fake.send({ kind: 'terminal' })
    await settle()
    await click(button('+ shell'))

    fake.output({ kind: 'exit', id: 1, code: 130 })
    await settle()

    expect(drawer()?.textContent).toContain('(exited 130)')
  })

  test('hiding the drawer keeps the panes alive rather than throwing their screens away', async () => {
    const fake = await mount()
    fake.send({ kind: 'terminal' })
    await settle()
    await click(button('+ claude'))
    const terminal = document.querySelector('.xterm')

    fake.send({ kind: 'terminal' })
    await settle()

    // Out of sight, still the same terminal: disposing it would replay raw
    // bytes into a fresh one and redraw a corrupted screen.
    expect(document.querySelector('.xterm')).toBe(terminal)
    expect(drawer()?.className).toContain('hidden')
  })

  test('the fifth pane is refused, in words', async () => {
    const fake = await mount()
    fake.send({ kind: 'terminal' })
    await settle()
    for (let pane = 0; pane < 4; pane += 1) await click(button('+ shell'))

    await click(button('+ shell'))

    expect(drawer()?.querySelector('[role="alert"]')?.textContent).toContain('as many panes')
  })

  test('a preset that cannot be started reaches the reader as a sentence', async () => {
    const fake = fakeApi({ project, files: new Map(FILES), refusePty: { kind: 'spawn-failed', detail: 'claude: not found' } })
    Object.defineProperty(window, 'wiki', { value: fake.api, configurable: true })
    dispose = render(() => <App />, document.body)
    await settle()
    fake.send({ kind: 'terminal' })
    await settle()

    await click(button('+ claude'))

    expect(drawer()?.querySelector('[role="alert"]')?.textContent).toContain('claude: not found')
  })
})

/**
 * Where a pane's bytes go is asserted here rather than through the rendered
 * terminal: `xterm`'s DOM renderer paints from a measured layout, and happy-dom
 * has none — the rows stay empty however much is written to them. What is ours
 * is the routing, and that is what these cover.
 */
describe('the pane store', () => {
  test('bytes held before an attach are replayed once, newest first if they overflow', async () => {
    const fake = fakeApi({ project, files: new Map(FILES) })
    await createRoot(async (destroy) => {
      const terminals = createTerminals(fake.api)
      terminals.start('shell', 80, 24)
      await settle()

      fake.output({ kind: 'data', id: 1, data: 'early' })
      const seen: string[] = []
      const detach = terminals.attach(1, (data) => seen.push(data))
      expect(seen).toEqual(['early'])

      // Replayed once: a second attach must not see the same bytes again.
      detach()
      const again: string[] = []
      terminals.attach(1, (data) => again.push(data))
      expect(again).toEqual([])

      destroy()
    })
  })

  describe('a file dropped on a pane', () => {
    /** A `File` in name only: the fake bridge answers from `file.name`. */
    const file = (name: string): File => ({ name }) as File

    test('types its path, quoted, and never presses return', async () => {
      const fake = fakeApi({ project, files: new Map(FILES) })
      await createRoot(async (destroy) => {
        const terminals = createTerminals(fake.api)
        terminals.start('agent', 80, 24)
        await settle()

        terminals.drop(1, [file('Bildschirmfoto 2026-08-21 um 09.01.23.png')])
        await settle()

        expect(fake.typed).toEqual(["'/drop/Bildschirmfoto 2026-08-21 um 09.01.23.png' "])
        // The pane may hold an agent mid-question; the reader presses return.
        expect(fake.typed[0]).not.toContain('\n')
        destroy()
      })
    })

    test('types nothing for a drag that carried no file on disk', async () => {
      const fake = fakeApi({ project, files: new Map(FILES), dropPath: () => '' })
      await createRoot(async (destroy) => {
        const terminals = createTerminals(fake.api)
        terminals.start('agent', 80, 24)
        await settle()

        terminals.drop(1, [file('from-a-browser.png')])
        await settle()

        expect(fake.typed).toEqual([])
        destroy()
      })
    })
  })

  describe('the drag handle on the top border', () => {
    const handle = (): HTMLElement | null => document.querySelector('[role="separator"][aria-label="Resize terminal"]')

    const press = async (key: string): Promise<void> => {
      handle()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      await settle()
    }

    test('↑ makes the drawer taller and ↓ makes it shorter, so it is not pointer-only', async () => {
      const fake = await mount()
      fake.send({ kind: 'terminal' })
      await settle()

      const height = (): number => Number.parseInt(drawer()?.style.height ?? '', 10)
      const opened = height()
      expect(opened).toBe(DRAWER_DEFAULT)

      await press('ArrowUp')
      expect(height()).toBe(opened + DRAWER_STEP)

      await press('ArrowDown')
      expect(height()).toBe(opened)
    })

    test('never shrinks past a usable pane, however often ↓ is pressed', async () => {
      const fake = await mount()
      fake.send({ kind: 'terminal' })
      await settle()

      for (let press_ = 0; press_ < 40; press_ += 1) await press('ArrowDown')

      expect(Number.parseInt(drawer()?.style.height ?? '', 10)).toBe(DRAWER_MIN)
    })

    test('never grows past the window, however often ↑ is pressed', async () => {
      const fake = await mount()
      fake.send({ kind: 'terminal' })
      await settle()

      for (let press_ = 0; press_ < 200; press_ += 1) await press('ArrowUp')

      expect(Number.parseInt(drawer()?.style.height ?? '', 10)).toBe(
        clampDrawer(Number.POSITIVE_INFINITY, window.innerHeight),
      )
    })
  })

  describe('the three height presets', () => {
    const press = async (label: string): Promise<void> => {
      const found = [...document.querySelectorAll('button')].find((e) => e.getAttribute('aria-label') === label)
      ;(found as HTMLElement | undefined)?.click()
      await settle()
    }
    const height = (): number => Number.parseInt(drawer()?.style.height ?? '', 10)

    test('split takes 30 % of the window and full takes all but the title bar', async () => {
      const fake = await mount()
      fake.send({ kind: 'terminal' })
      await settle()
      expect(height()).toBe(DRAWER_DEFAULT)

      await press('Terminal at full height')
      expect(height()).toBe(drawerFull(window.innerHeight))

      await press('Split the window 70/30')
      expect(height()).toBe(drawerSplit(window.innerHeight))
    })

    /**
     * Why full height is allowed to take the window at all: the group that put
     * it there rides on the drawer's own chrome, so the way back is on screen
     * whatever the drawer is doing.
     */
    test('the way back is still on screen at full height', async () => {
      const fake = await mount()
      fake.send({ kind: 'terminal' })
      await settle()
      await press('Terminal at full height')

      for (const label of ['Hide terminal', 'Split the window 70/30']) {
        expect([...document.querySelectorAll('button')].some((e) => e.getAttribute('aria-label') === label)).toBe(true)
      }

      await press('Hide terminal')
      expect(drawer()).toBeNull()
    })

    test('every icon-only control carries a name, and its glyph is hidden from it', async () => {
      const fake = await mount()
      fake.send({ kind: 'terminal' })
      await settle()

      const iconOnly = [...(drawer()?.querySelectorAll('button') ?? [])].filter(
        (element) => element.querySelector('svg') !== null && element.textContent.trim() === '',
      )

      expect(iconOnly.length).toBeGreaterThanOrEqual(3)
      for (const button_ of iconOnly) {
        expect(button_.getAttribute('aria-label')).toBeTruthy()
        expect(button_.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
      }
    })
  })

  test('closing a pane kills it and lets go of its sink', async () => {
    const fake = fakeApi({ project, files: new Map(FILES) })
    await createRoot(async (destroy) => {
      const terminals = createTerminals(fake.api)
      terminals.start('shell', 80, 24)
      await settle()

      const seen: string[] = []
      terminals.attach(1, (data) => seen.push(data))
      terminals.close(1)
      fake.output({ kind: 'data', id: 1, data: 'after' })

      expect(seen).toEqual([])
      expect(terminals.panes()).toEqual([])
      destroy()
    })
  })
})
