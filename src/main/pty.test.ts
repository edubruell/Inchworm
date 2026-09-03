/**
 * The pane rules, with no shell anywhere: who owns an id, what a window may
 * touch, and what is left running when a window goes. `node-pty` is injected,
 * so everything here holds without the addon.
 */

import { describe, expect, test } from 'vitest'
import type { PtyEvent } from '@shared/api.js'
import type { PtyProcess, SpawnRequest } from './pty.js'
import { MAX_PANES, createPtyHost } from './pty.js'

type Fake = {
  readonly request: SpawnRequest
  readonly written: string[]
  readonly resized: [number, number][]
  killed: boolean
  emit: (data: string) => void
  die: (code: number) => void
}

const harness = (options: { readonly throws?: boolean } = {}) => {
  const spawned: Fake[] = []
  const sent: [number, PtyEvent][] = []

  const host = createPtyHost((request): PtyProcess => {
    if (options.throws === true) throw new Error('claude: command not found')
    let onData = (_data: string): void => undefined
    let onExit = (_event: { readonly exitCode: number }): void => undefined
    const fake: Fake = {
      request,
      written: [],
      resized: [],
      killed: false,
      emit: (data) => {
        onData(data)
      },
      die: (code) => {
        onExit({ exitCode: code })
      },
    }
    spawned.push(fake)
    return {
      onData: (listener) => (onData = listener),
      onExit: (listener) => (onExit = listener),
      write: (data) => fake.written.push(data),
      resize: (cols, rows) => fake.resized.push([cols, rows]),
      kill: () => (fake.killed = true),
    }
  }, (windowId, event) => sent.push([windowId, event]))

  return { host, spawned, sent }
}

const START = { preset: 'shell', cols: 80, rows: 24, agentCommand: 'claude' } as const

describe('starting a pane', () => {
  test('runs the preset in the project directory, at the geometry the pane asked for', () => {
    const app = harness()
    const result = app.host.start(1, '/p', { preset: 'agent', cols: 100, rows: 30, agentCommand: 'claude' })

    expect(result.ok).toBe(true)
    expect(app.spawned[0]?.request).toMatchObject({ args: ['-l', '-i', '-c', 'claude'], cwd: '/p', cols: 100, rows: 30 })
  })

  test('every preset goes through a login shell, or the packaged app has no PATH', () => {
    const app = harness()
    app.host.start(1, '/p', { preset: 'shell', cols: 80, rows: 24, agentCommand: 'claude' })
    // The command is always the shell; the preset is what it is asked to run.
    expect(app.spawned[0]?.request.command).toBe(process.env.SHELL ?? '/bin/zsh')
    expect(app.spawned[0]?.request.args).toEqual(['-l'])
  })

  test('the agent preset runs the command settings hold, and only main can name it', () => {
    const app = harness()
    app.host.start(1, '/p', { preset: 'agent', cols: 80, rows: 24, agentCommand: 'codex --model o3' })
    // The command line came from the settings store by way of the handler; the
    // renderer sent an id.
    expect(app.spawned[0]?.request.args).toEqual(['-l', '-i', '-c', 'codex --model o3'])
  })

  test('the renderer names a preset, never a command line', () => {
    const app = harness()
    for (const preset of ['agent', 'shell'] as const) app.host.start(1, '/p', { preset, cols: 80, rows: 24, agentCommand: 'claude' })
    // Nothing that crosses the bridge appears in an argv: the strings below are
    // this module's, chosen by an enum.
    expect(app.spawned.map((pane) => pane.request.args)).toEqual([
      ['-l', '-i', '-c', 'claude'],
      ['-l'],
    ])
  })

  /**
   * The asymmetry, as an assertion. `zsh -l -c` reads `.zprofile` and *not*
   * `.zshrc`, which is where a real machine builds its `PATH` — so the agent
   * pane exited 127 while the plain `shell` pane, interactive by virtue of
   * having a pty and no `-c`, finds it fine.
   */
  test('a preset that runs a command is interactive, or `.zshrc` never builds its PATH', () => {
    const app = harness()
    for (const preset of ['agent', 'shell'] as const) app.host.start(1, '/p', { preset, cols: 80, rows: 24, agentCommand: 'claude' })
    for (const pane of app.spawned) {
      const args = pane.request.args
      // `-c` without `-i` is the shape that cost the agent its PATH.
      expect(args.includes('-c') && !args.includes('-i')).toBe(false)
    }
  })

  test('a command that is not there is a sentence, not a crash', () => {
    const app = harness({ throws: true })
    const result = app.host.start(1, '/p', START)

    expect(result).toEqual({ ok: false, error: { kind: 'spawn-failed', detail: 'claude: command not found' } })
    // And it costs no slot under the cap.
    expect(app.host.panesOn(1)).toBe(0)
  })

  test('a window may hold only so many panes', () => {
    const app = harness()
    for (let pane = 0; pane < MAX_PANES; pane += 1) app.host.start(1, '/p', START)

    expect(app.host.start(1, '/p', START)).toEqual({ ok: false, error: { kind: 'too-many' } })
    // The cap is per window: another window is unaffected.
    expect(app.host.start(2, '/p', START).ok).toBe(true)
  })

  test('ids are never reused, so a message about a dead pane cannot reach a live one', () => {
    const app = harness()
    const first = app.host.start(1, '/p', START)
    app.host.kill(1, first.ok ? first.value.id : 0)
    const second = app.host.start(1, '/p', START)

    expect(first.ok && second.ok && second.value.id).not.toBe(first.ok && first.value.id)
  })
})

describe('output', () => {
  test('goes to the owning window alone — a pane belongs to a window, not a project', () => {
    const app = harness()
    app.host.start(7, '/p', START)
    app.spawned[0]?.emit('hello')

    expect(app.sent).toEqual([[7, { kind: 'data', id: 1, data: 'hello' }]])
  })

  test('a pane that exits says so, and stops counting against the cap', () => {
    const app = harness()
    app.host.start(1, '/p', START)
    app.spawned[0]?.die(130)

    expect(app.sent.at(-1)).toEqual([1, { kind: 'exit', id: 1, code: 130 }])
    expect(app.host.panesOn(1)).toBe(0)
  })
})

describe('ownership', () => {
  test('a window cannot type into, resize or kill another window’s shell', () => {
    const app = harness()
    const started = app.host.start(1, '/p', START)
    const id = started.ok ? started.value.id : 0

    app.host.write(2, id, 'rm -rf /\r')
    app.host.resize(2, id, 10, 10)
    app.host.kill(2, id)

    expect(app.spawned[0]?.written).toEqual([])
    expect(app.spawned[0]?.resized).toEqual([])
    expect(app.spawned[0]?.killed).toBe(false)
    expect(app.host.panesOn(1)).toBe(1)

    // Its own window still can.
    app.host.write(1, id, 'ls\r')
    expect(app.spawned[0]?.written).toEqual(['ls\r'])
  })

  test('an id that names nothing is silence, not a failure', () => {
    const app = harness()
    expect(() => {
      app.host.write(1, 99, 'x')
      app.host.resize(1, 99, 10, 10)
      app.host.kill(1, 99)
    }).not.toThrow()
  })
})

describe('a window closing', () => {
  test('kills every pane it held and leaves the other windows alone', () => {
    const app = harness()
    app.host.start(1, '/p', START)
    app.host.start(1, '/p', START)
    app.host.start(2, '/p', START)

    app.host.closeWindow(1)

    expect(app.spawned.map((pane) => pane.killed)).toEqual([true, true, false])
    expect(app.host.panesOn(1)).toBe(0)
    expect(app.host.panesOn(2)).toBe(1)
  })
})
