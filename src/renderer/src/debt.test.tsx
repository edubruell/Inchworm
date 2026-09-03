// @vitest-environment happy-dom
/**
 * The sidebar's debt section: what a window shows for the things that landed
 * and were never written up, and when it asks again. What the checkers *find*
 * is `core/debt.test.ts`'s and what the app may spawn is `main/debt.test.ts`'s;
 * this is the surface.
 */

import { render } from 'solid-js/web'
import { afterEach, describe, expect, test } from 'vitest'
import type { DebtError, DebtReport, ProjectSnapshot, WikiApi } from '@shared/api.js'
import { fakeApi, type FakeApi } from '../../../tests/support/api.js'
import { App } from './App.jsx'
import { createDebtStore } from './debtStore.js'

const FILES = new Map([
  ['wiki/00_state.md', '# state — p\n'],
  ['wiki/findings.md', '# findings\n'],
  ['CLAUDE.md', '# CLAUDE\n'],
])

const project: ProjectSnapshot = {
  dir: '/p',
  name: 'p',
  hue: 226,
  layout: { wikiRoot: 'wiki', journal: 'notes', kind: 'software' },
  files: [...FILES.keys()],
}

const REPORT: DebtReport = {
  items: [
    { kind: 'unstamped', label: 'findings.md:42', detail: 'no stamp for #x', path: 'wiki/findings.md' },
    { kind: 'unfiled', label: 'v3_back', detail: 'payload/incoming/v3_back — no RETURN.txt — landed by hand?' },
  ],
  failed: [],
  checkedMs: 1_000,
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
  options: { readonly debt?: DebtReport; readonly refuseDebt?: DebtError; readonly rejectDebt?: boolean } = {},
): Promise<FakeApi> => {
  const fake = fakeApi({
    project,
    files: FILES,
    debt: options.debt,
    refuseDebt: options.refuseDebt,
    rejectDebt: options.rejectDebt,
  })
  Object.defineProperty(window, 'wiki', { value: fake.api, configurable: true })
  dispose = render(() => <App />, document.body)
  await settle()
  return fake
}

const section = (): HTMLElement | null => document.querySelector<HTMLElement>('section[aria-label="Not written up"]')

const rows = (): readonly string[] =>
  [...(section()?.querySelectorAll('li') ?? [])].map((row) => row.textContent)

const openFile = (): string | null | undefined => document.querySelector('main h1')?.textContent

describe('the debt section', () => {
  test('is absent when nothing is owed', async () => {
    // The opposite of the contention badge's rule, and deliberately so: a row
    // that is always there and always zero is a row nobody reads.
    await mount()
    expect(section()).toBeNull()
  })

  test('lists what landed, says what each row is waiting for, and counts it', async () => {
    await mount({ debt: REPORT })
    expect(rows()).toHaveLength(2)
    expect(rows()[0]).toContain('findings.md:42')
    // The word, not only the colour.
    expect(rows()[0]).toContain('note not swept')
    expect(rows()[1]).toContain('no marker')
    expect(section()?.querySelector('[aria-label="2 things not written up"]')?.textContent).toBe('2')
  })

  test('a row the window can open is a button; one it cannot is not', async () => {
    await mount({ debt: REPORT })
    const buttons = section()?.querySelectorAll('li button') ?? []
    expect(buttons).toHaveLength(1)
    // A payload round is real debt the app must show and cannot display; a
    // button that does nothing teaches the reader that none of them work.
    expect(buttons[0]?.textContent).toContain('findings.md:42')
  })

  test('pressing a row opens that file in the note pane', async () => {
    await mount({ debt: REPORT })
    ;(section()?.querySelector('li button') as HTMLElement | null)?.click()
    await settle()
    expect(openFile()).toBe('wiki/findings.md')
  })

  test('“Check again” re-asks, and the section never writes anything', async () => {
    const fake = await mount({ debt: REPORT })
    const before = fake.debtReads()
    ;(section()?.querySelector('button[aria-label="Check again"]') as HTMLElement | null)?.click()
    await settle()
    expect(fake.debtReads()).toBe(before + 1)
    expect(fake.writes).toEqual([])
  })

  test('a project event re-asks — the watcher part of the refresh policy', async () => {
    const fake = await mount({ debt: REPORT })
    const before = fake.debtReads()
    fake.emit({ kind: 'file', dir: '/p', path: 'wiki/findings.md' })
    await settle()
    // Exactly one: a looser assertion would pass with the coalescing deleted.
    expect(fake.debtReads()).toBe(before + 1)
  })

  test('a burst of events is one extra round, not one per event', async () => {
    const fake = await mount({ debt: REPORT })
    const before = fake.debtReads()
    for (let event = 0; event < 5; event += 1) fake.emit({ kind: 'file', dir: '/p', path: 'wiki/findings.md' })
    await settle()
    expect(fake.debtReads()).toBeLessThanOrEqual(before + 2)
  })

  test('an event for another project changes nothing here', async () => {
    const fake = await mount({ debt: REPORT })
    const before = fake.debtReads()
    fake.emit({ kind: 'file', dir: '/elsewhere', path: 'wiki/findings.md' })
    await settle()
    expect(fake.debtReads()).toBe(before)
  })

  test('a checker that cannot run is announced, not swallowed into “clean”', async () => {
    await mount({ refuseDebt: { kind: 'no-python' } })
    const alert = section()?.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('python3')
  })

  test('a bridge that never answers is a state, not a silently stale list', async () => {
    // `invoke` rejects when no handler is registered — version skew between a
    // renderer and a main that has moved on.
    await mount({ rejectDebt: true })
    expect(section()?.querySelector('[role="alert"]')?.textContent).toContain('could not be reached')
  })

  test('the other refusals each say their own thing', async () => {
    await mount({ refuseDebt: { kind: 'no-bundle', detail: '/nope' } })
    expect(section()?.querySelector('[role="alert"]')?.textContent).toContain('no checkers')
    dispose()
    document.body.innerHTML = ''
    await mount({ refuseDebt: { kind: 'no-project' } })
    expect(section()?.querySelector('[role="alert"]')?.textContent).toContain('no project')
  })

  test('one thing owed is spoken in the singular', async () => {
    await mount({ debt: { items: REPORT.items.slice(0, 1), failed: [], checkedMs: 0 } })
    expect(section()?.querySelector('[aria-label="1 thing not written up"]')?.textContent).toBe('1')
  })

  test('every kind has its own word', async () => {
    await mount({
      debt: {
        items: [
          { kind: 'unswept', label: 'a', detail: 'd' },
          { kind: 'unlinked', label: 'b', detail: 'd' },
        ],
        failed: [],
        checkedMs: 0,
      },
    })
    expect(rows()[0]).toContain('marker still set')
    expect(rows()[1]).toContain('named nowhere')
  })

  test('a partial answer says so', async () => {
    await mount({ debt: { ...REPORT, failed: ['wiki-trigger.py'] } })
    expect(section()?.querySelector('[role="status"]')?.textContent).toContain('partial')
  })
})

describe('the store', () => {
  test('coalesces rather than stacks: one run at a time, one more if asked during it', async () => {
    // A save is a watcher event and a checker takes a second or two; queueing
    // one spawn per event would pile python processes behind a section nobody
    // is looking at.
    let waiting: ((value: unknown) => void) | undefined
    let reads = 0
    const api = {
      readDebt: () => {
        reads += 1
        return new Promise((resolve) => {
          waiting = resolve
        })
      },
    } as unknown as WikiApi

    const store = createDebtStore(api)
    store.refresh()
    expect(reads).toBe(1)
    expect(store.checking()).toBe(true)

    // Three more asks while the first is in flight are one more run, not three.
    store.refresh()
    store.refresh()
    store.refresh()
    expect(reads).toBe(1)

    waiting?.({ ok: true, value: { items: [], failed: [], checkedMs: 0 } })
    await settle()
    expect(reads).toBe(2)

    waiting?.({ ok: true, value: { items: [], failed: [], checkedMs: 0 } })
    await settle()
    expect(reads).toBe(2)
    expect(store.checking()).toBe(false)
  })

  test('says it is checking while it is, and stops when it stops', async () => {
    let waiting: ((value: unknown) => void) | undefined
    const api = {
      readDebt: () =>
        new Promise((resolve) => {
          waiting = resolve
        }),
    } as unknown as WikiApi
    const store = createDebtStore(api)
    store.refresh()
    expect(store.checking()).toBe(true)
    waiting?.({ ok: true, value: { items: [], failed: [], checkedMs: 0 } })
    await settle()
    expect(store.checking()).toBe(false)
  })

  test('a disposed store does not fire the run it had queued', async () => {
    // A window closing with a run queued would otherwise spawn one more pair of
    // checkers for a window that is gone.
    let waiting: ((value: unknown) => void) | undefined
    let reads = 0
    const api = {
      readDebt: () => {
        reads += 1
        return new Promise((resolve) => {
          waiting = resolve
        })
      },
    } as unknown as WikiApi
    const store = createDebtStore(api)
    store.refresh()
    store.refresh()
    store.dispose()
    waiting?.({ ok: true, value: { items: [], failed: [], checkedMs: 0 } })
    await settle()
    expect(reads).toBe(1)
    store.refresh()
    expect(reads).toBe(1)
  })

  test('a bridge member that is not there at all does not latch the button', () => {
    // `window.wiki.readDebt` missing throws where it stands rather than
    // rejecting; without the guard `checking` would stay true forever.
    const store = createDebtStore({} as unknown as WikiApi)
    store.refresh()
    expect(store.checking()).toBe(false)
    expect(store.error()?.kind).toBe('unreachable')
  })

  test('keeps the last good list on screen when a later read fails', async () => {
    // A project whose checker broke still owes what it owed a minute ago.
    let answer: unknown = { ok: true, value: { items: [{ kind: 'unfiled', label: 'x', detail: 'd' }], failed: [], checkedMs: 0 } }
    const api = { readDebt: () => Promise.resolve(answer) } as unknown as WikiApi
    const store = createDebtStore(api)

    store.refresh()
    await settle()
    expect(store.report()?.items).toHaveLength(1)

    answer = { ok: false, error: { kind: 'no-python' } }
    store.refresh()
    await settle()
    expect(store.error()?.kind).toBe('no-python')
    expect(store.report()?.items).toHaveLength(1)
  })
})
