/** The drop bridge is exercised on its own below; every other test ignores it. */

import { describe, expect, test } from 'vitest'
import { CHANNEL, EVENT } from '@shared/api.js'
import { createApi, type IpcInvokeLike } from './api.js'

const noPath = (): string => ''

type Recorder = {
  readonly ipc: IpcInvokeLike
  readonly calls: [string, unknown][]
  readonly listeners: Map<string, Set<(event: unknown, payload: unknown) => void>>
}

const recorder = (reply: unknown = null): Recorder => {
  const calls: [string, unknown][] = []
  const listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>()
  return {
    calls,
    listeners,
    ipc: {
      invoke: (channel, payload) => {
        calls.push([channel, payload])
        return Promise.resolve(reply)
      },
      on: (channel, listener) => {
        const set = listeners.get(channel) ?? new Set()
        set.add(listener)
        listeners.set(channel, set)
      },
      off: (channel, listener) => listeners.get(channel)?.delete(listener),
    },
  }
}

describe('createApi', () => {
  test('exposes exactly the declared surface', () => {
    expect(Object.keys(createApi(recorder().ipc, noPath)).sort()).toEqual(
      [
        'chooseProject',
        'pathForFile',
        'currentProject',
        'getSettings',
        'listProjects',
        'onCommand',
        'onPtyEvent',
        'openExternal',
        'startPty',
        'writePty',
        'resizePty',
        'killPty',
        'onProjectEvent',
        'openProject',
        'skillStatus',
        'installSkill',
        'readDebt',
        'readFile',
        'onSettings',
        'setAccent',
        'setSettings',
        'writeFile',
      ].sort(),
    )
  })

  /**
   * The drop bridge is the one member that touches no channel: it hands the
   * `File` to `webUtils` and returns a string. It must reach the injected
   * function unchanged, and it must not invoke anything — a drop that went
   * through IPC would be a drop the pane could not answer synchronously.
   */
  test('the dropped-file path goes straight to `webUtils`, and over no channel', () => {
    const fake = recorder()
    const seen: File[] = []
    const file = { name: 'shot.png' } as File
    const api = createApi(fake.ipc, (dropped) => {
      seen.push(dropped)
      return '/Users/ebr/Desktop/shot.png'
    })

    expect(api.pathForFile(file)).toBe('/Users/ebr/Desktop/shot.png')
    expect(seen).toEqual([file])
    expect(fake.calls).toEqual([])
  })

  // Every call goes through the allow-list constant, never a hand-written
  // string: a renamed channel must be a compile error, not a hang.
  test('each call uses the declared channel and wraps its argument in the payload shape', async () => {
    const fake = recorder()
    const api = createApi(fake.ipc, noPath)

    await api.chooseProject()
    await api.openProject('/p/a')
    await api.listProjects()
    await api.currentProject()
    await api.setAccent(210)
    await api.readFile('wiki/00_state.md')
    await api.writeFile({ path: 'wiki/00_state.md', text: 'x', baseSha: 'abc' })
    await api.getSettings()
    await api.setSettings({ launchers: [{ id: 'a', label: 'a', command: 'a' }], defaultLauncherId: 'a', noteTag: 'eddy' })
    await api.skillStatus()
    await api.installSkill('abc')
    await api.readDebt()

    expect(fake.calls).toEqual([
      [CHANNEL.chooseProject, undefined],
      [CHANNEL.openProject, { dir: '/p/a' }],
      [CHANNEL.listProjects, undefined],
      [CHANNEL.currentProject, undefined],
      [CHANNEL.setAccent, { hue: 210 }],
      [CHANNEL.readFile, { path: 'wiki/00_state.md' }],
      [CHANNEL.writeFile, { path: 'wiki/00_state.md', text: 'x', baseSha: 'abc' }],
      [CHANNEL.getSettings, undefined],
      // Settings cross whole rather than field by field: the store replaces the
      // list, so a partial payload would be a list with rows silently missing.
      [CHANNEL.setSettings, { launchers: [{ id: 'a', label: 'a', command: 'a' }], defaultLauncherId: 'a', noteTag: 'eddy' }],
      [CHANNEL.skillStatus, undefined],
      // The guard digest is a payload field like any other: the bridge wraps it
      // and decides nothing about it.
      [CHANNEL.installSkill, { baseSha: 'abc' }],
      // No payload at all: the project is the sending window's, and a debt read
      // has nothing for a renderer to name.
      [CHANNEL.readDebt, undefined],
    ])
  })

  test('a settings broadcast reaches the listener, and unsubscribing stops it', () => {
    const fake = recorder()
    const seen: unknown[] = []
    const off = createApi(fake.ipc, noPath).onSettings((settings) => seen.push(settings))

    const settings = { launchers: [{ id: 'a', label: 'a', command: 'a' }], defaultLauncherId: 'a', noteTag: 'eddy' }
    for (const listener of fake.listeners.get(EVENT.settings) ?? []) listener({ senderId: 1 }, settings)
    off()
    for (const listener of fake.listeners.get(EVENT.settings) ?? []) listener({ senderId: 1 }, settings)

    expect(seen).toEqual([settings])
  })

  test('project events reach the listener without the Electron event object', () => {
    const fake = recorder()
    const seen: unknown[] = []
    createApi(fake.ipc, noPath).onProjectEvent((event) => seen.push(event))

    const event = { kind: 'file', dir: '/p/a', path: 'wiki/00_state.md' }
    for (const listener of fake.listeners.get(EVENT.projectEvent) ?? []) listener({ senderId: 1 }, event)

    expect(seen).toEqual([event])
  })

  // A window that reloads must not leave a listener behind on the channel.
  test('the returned unsubscribe removes the listener it added', () => {
    const fake = recorder()
    const off = createApi(fake.ipc, noPath).onProjectEvent(() => undefined)

    expect(fake.listeners.get(EVENT.projectEvent)?.size).toBe(1)
    off()
    expect(fake.listeners.get(EVENT.projectEvent)?.size).toBe(0)
  })
  test('a menu command reaches the window with the Electron event stripped off it', () => {
    const seen: unknown[] = []
    const fake = recorder()
    createApi(fake.ipc, noPath).onCommand((command) => seen.push(command))

    const command = { kind: 'palette' }
    for (const listener of fake.listeners.get(EVENT.command) ?? []) listener({ senderId: 1 }, command)

    expect(seen).toEqual([command])
  })

  test('commands unsubscribe the same way project events do', () => {
    const fake = recorder()
    const off = createApi(fake.ipc, noPath).onCommand(() => undefined)

    expect(fake.listeners.get(EVENT.command)?.size).toBe(1)
    off()
    expect(fake.listeners.get(EVENT.command)?.size).toBe(0)
  })
})

describe('openExternal', () => {
  test('sends the URL as a payload object, like every other input', async () => {
    const ipc = recorder()
    await createApi(ipc.ipc, noPath).openExternal('https://example.com/')
    expect(ipc.calls).toEqual([[CHANNEL.openExternal, { url: 'https://example.com/' }]])
  })
})

describe('the terminal surface', () => {
  test('each pane call sends its own payload, and none of them invents a command', async () => {
    const ipc = recorder({ ok: true, value: { id: 3 } })
    const api = createApi(ipc.ipc, noPath)

    await api.startPty({ preset: 'agent', cols: 80, rows: 24 })
    await api.writePty({ id: 3, data: 'ls\r' })
    await api.resizePty({ id: 3, cols: 100, rows: 30 })
    await api.killPty({ id: 3 })

    expect(ipc.calls).toEqual([
      [CHANNEL.startPty, { preset: 'agent', cols: 80, rows: 24 }],
      [CHANNEL.writePty, { id: 3, data: 'ls\r' }],
      [CHANNEL.resizePty, { id: 3, cols: 100, rows: 30 }],
      [CHANNEL.killPty, { id: 3 }],
    ])
  })

  test('pane output is a subscription the renderer owns, like every other stream', () => {
    const ipc = recorder()
    const seen: unknown[] = []
    const stop = createApi(ipc.ipc, noPath).onPtyEvent((event) => seen.push(event))

    for (const listener of ipc.listeners.get(EVENT.pty) ?? []) listener(null, { kind: 'data', id: 1, data: 'hi' })
    expect(seen).toEqual([{ kind: 'data', id: 1, data: 'hi' }])

    stop()
    expect(ipc.listeners.get(EVENT.pty)?.size).toBe(0)
  })
})
