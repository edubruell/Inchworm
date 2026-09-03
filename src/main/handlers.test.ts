/**
 * The whole privileged surface with every effect replaced by a recorder: no
 * Electron, no window, no store on disk. What is left under test is the part
 * that decides — which project a message is scoped to, what is refused, and who
 * hears about it.
 */

import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { hueForPath } from '@core/hue.js'
import type { ProjectEvent, ProjectSummary, Settings } from '@shared/api.js'
import { DEFAULT_SETTINGS } from '@core/settings.js'
import { SKILL_FILES } from '@core/skill.js'
import { CHANNEL, EVENT } from '@shared/api.js'
import { projectEventFor, registerHandlers, type HandlerDeps, type IpcEventLike } from './handlers.js'
import type { OpenProject } from './project.js'
import { createPtyHost, type SpawnRequest } from './pty.js'
import { createRegistry } from './registry.js'

const fixture = (name: string): string => join(import.meta.dirname, '../../tests/fixtures', name)

const layout = { wikiRoot: 'local_context/wiki/', journal: 'local_context/notes/', kind: 'software' } as const
const sample: OpenProject = { dir: fixture('sample-wiki'), layout }
const edge: OpenProject = { dir: fixture('edge-cases'), layout }

type Harness = {
  /** URLs handed to the OS browser. */
  readonly externals: readonly string[]
  /** Everything that reached a pane's stdin. */
  readonly shells: readonly string[]
  readonly call: (channel: string, payload?: unknown, windowId?: number) => Promise<unknown>
  readonly remembered: readonly ProjectSummary[]
  readonly channels: readonly string[]
  readonly opened: OpenProject[]
  readonly broadcasts: [string, ProjectEvent][]
  readonly hues: Map<string, number>
  /** Every argv a pane was spawned with, so "who chose the command" is assertable. */
  readonly spawns: SpawnRequest[]
  /** Every guard digest an install carried, so a stale one is assertable. */
  readonly skillInstalls: readonly string[]
  /** Every project directory a debt read was scoped to. */
  readonly debtReads: readonly string[]
  /** Settings as the store holds them now, and every broadcast of them. */
  readonly settingsNow: () => Settings
  readonly settingsBroadcasts: Settings[]
}

const harness = (
  attached: OpenProject | 'no-project' = sample,
  second?: OpenProject,
  startingSettings: Settings = DEFAULT_SETTINGS,
): Harness => {
  const registered = new Map<string, (event: IpcEventLike, payload: unknown) => unknown>()
  const opened: OpenProject[] = []
  const broadcasts: [string, ProjectEvent][] = []
  const hues = new Map<string, number>()
  const summaries: ProjectSummary[] = []
  const externals: string[] = []
  const shells: string[] = []
  const spawns: SpawnRequest[] = []
  const settingsBroadcasts: Settings[] = []
  const skillInstalls: string[] = []
  let settings = startingSettings

  const registry = createRegistry(() => (): void => undefined)
  if (attached !== 'no-project') registry.attach(1, attached)
  if (second !== undefined) registry.attach(2, second)

  const debtReads: string[] = []

  const deps: HandlerDeps = {
    registry,
    // The checker spawner, recorded rather than run: what it spawns is
    // `main/debt.test.ts`'s, and what is under test here is that the read is
    // scoped by the *sending window* like every other project read.
    debt: {
      read: (projectDir: string) => {
        debtReads.push(projectDir)
        return Promise.resolve({ ok: true, value: { items: [], failed: [], checkedMs: 0 } })
      },
    },
    // The skill host, recorded rather than run: what it does to `~/.claude` is
    // `main/skill.test.ts`'s, and what is under test here is that the payload
    // is parsed and the digest is passed through untouched.
    skill: {
      status: () => Promise.resolve({ ok: true, value: { state: 'absent', sha: '', files: SKILL_FILES.length } }),
      install: (baseSha: string) => {
        skillInstalls.push(baseSha)
        return Promise.resolve({ ok: true, value: { files: SKILL_FILES.length, fresh: true } })
      },
    },
    store: {
      list: () => summaries,
      find: (dir) => summaries.find((summary) => summary.dir === dir),
      remember: (dir, lastOpenedMs) => {
        const summary = { dir, name: 'sample-wiki', hue: hues.get(dir) ?? hueForPath(dir), lastOpenedMs }
        summaries.push(summary)
        return Promise.resolve(summary)
      },
      setHue: (dir, hue) => {
        hues.set(dir, hue)
        return Promise.resolve(undefined)
      },
    },
    windowIdOf: (event) => (event.sender as { readonly id?: number }).id,
    chooseDirectory: () => Promise.resolve('/chosen'),
    openWindow: (project) => opened.push(project),
    broadcast: (dir, event) => broadcasts.push([dir, event]),
    ptys: createPtyHost(
      (request) => {
        spawns.push(request)
        return {
          onData: () => undefined,
          onExit: () => undefined,
          write: (data: string) => shells.push(data),
          resize: (cols: number, rows: number) => shells.push(`resize:${String(cols)}x${String(rows)}`),
          kill: () => shells.push('kill'),
        }
      },
      () => undefined,
    ),
    settings: {
      get: () => settings,
      set: (next) => {
        settings = next
        return Promise.resolve(next)
      },
    },
    broadcastSettings: (next) => settingsBroadcasts.push(next),
    openExternal: (url) => {
      externals.push(url)
      return Promise.resolve()
    },
    now: () => 1000,
  }

  registerHandlers({ handle: (channel, listener) => registered.set(channel, listener) }, deps)

  return {
    channels: [...registered.keys()],
    remembered: summaries,
    opened,
    broadcasts,
    externals,
    shells,
    hues,
    spawns,
    settingsNow: () => settings,
    settingsBroadcasts,
    skillInstalls,
    debtReads,
    call: (channel, payload, windowId = 1) =>
      Promise.resolve(registered.get(channel)?.({ sender: { id: windowId } }, payload)),
  }
}

describe('the channel allow-list', () => {
  // The test that fails when a channel is added quietly: the app answers these
  // and nothing else.
  test('registers exactly the declared channels', () => {
    expect([...harness().channels].sort()).toEqual(Object.values(CHANNEL).sort())
  })

  test('the broadcast channel is never a handler — it only goes main → renderer', () => {
    expect(harness().channels).not.toContain(EVENT.projectEvent)
  })
})

describe('project:open', () => {
  test('opens a window and records the project', async () => {
    const app = harness()
    const result = await app.call(CHANNEL.openProject, { dir: fixture('sample-wiki') })

    expect(result).toMatchObject({ ok: true, value: { dir: fixture('sample-wiki'), lastOpenedMs: 1000 } })
    expect(app.opened).toHaveLength(1)
  })

  test('a folder that is not a project opens no window and is not remembered', async () => {
    const app = harness()
    const result = await app.call(CHANNEL.openProject, { dir: fixture('broken-projects/no-block') })

    expect(result).toMatchObject({ ok: false, error: { kind: 'no-llmwiki' } })
    expect(app.opened).toEqual([])
    // Otherwise the picker's "recent" list grows entries that cannot be opened.
    expect(app.remembered).toEqual([])
  })

  // The same project opened twice is two windows, not a focus change.
  test('opening the same project twice opens two windows', async () => {
    const app = harness()
    await app.call(CHANNEL.openProject, { dir: fixture('sample-wiki') })
    await app.call(CHANNEL.openProject, { dir: fixture('sample-wiki') })

    expect(app.opened).toHaveLength(2)
    expect(app.remembered).toHaveLength(2)
  })

  test.each([
    [{ dir: 'relative/path' }, 'a relative path'],
    [{ dir: '' }, 'an empty path'],
    [{}, 'no path at all'],
    ['/tmp', 'a bare string instead of the payload'],
    [undefined, 'nothing'],
  ])('refuses %o (%s)', async (payload, _why: string) => {
    const app = harness()
    expect(await app.call(CHANNEL.openProject, payload)).toEqual({ ok: false, error: { kind: 'bad-request' } })
    expect(app.opened).toEqual([])
  })
})

describe('project:current', () => {
  test('answers with the project bound to the sending window', async () => {
    const snapshot = await harness().call(CHANNEL.currentProject)
    expect(snapshot).toMatchObject({ dir: sample.dir, layout })
    expect((snapshot as { readonly files: readonly string[] }).files).toContain('local_context/wiki/00_state.md')
  })

  test('a window with no project gets undefined, not someone else’s project', async () => {
    await expect(harness('no-project').call(CHANNEL.currentProject)).resolves.toBeUndefined()
  })
})

describe('file:read and file:write', () => {
  test('reads a file of the sending window’s project', async () => {
    const result = await harness().call(CHANNEL.readFile, { path: 'local_context/wiki/00_state.md' })
    expect(result).toMatchObject({ ok: true, value: { path: 'local_context/wiki/00_state.md' } })
    expect((result as { readonly value: { readonly text: string } }).value.text).toContain('# state — sample-project')
  })

  // Two windows, two projects: the answer follows the *sending window*, so a
  // renderer cannot read a project it was not opened on.
  test('each window reads its own project', async () => {
    const app = harness(sample, edge)
    const fromEdge = await app.call(CHANNEL.readFile, { path: 'local_context/wiki/00_state.md' }, 2)
    const fromSample = await app.call(CHANNEL.readFile, { path: 'local_context/wiki/00_state.md' }, 1)

    expect((fromEdge as { readonly value: { readonly text: string } }).value.text).not.toEqual(
      (fromSample as { readonly value: { readonly text: string } }).value.text,
    )
  })

  test('a file that exists only in the other window’s project is not found', async () => {
    const app = harness(sample, edge)
    const result = await app.call(CHANNEL.readFile, { path: 'local_context/wiki/01_scope.md' }, 2)
    expect(result).toMatchObject({ ok: false, error: { kind: 'not-found' } })
  })

  // Containment is to the project's memory, not to the project directory.
  test.each(['package.json', '.git/config', 'src/main/index.ts'])('refuses to read %s', async (path) => {
    expect(await harness().call(CHANNEL.readFile, { path })).toEqual({
      ok: false,
      error: { kind: 'outside-project' },
    })
  })

  // The renderer never names its project, so a window with none has no root to
  // resolve against — there is no ambient "current project" to fall back to.
  test('a window with no project can read nothing', async () => {
    const result = await harness('no-project').call(CHANNEL.readFile, { path: 'local_context/wiki/00_state.md' })
    expect(result).toEqual({ ok: false, error: { kind: 'no-project' } })
  })

  test.each([
    ['../../../etc/hosts', 'a traversal'],
    ['/etc/hosts', 'an absolute path'],
    ['wiki\\..\\..\\etc', 'backslashes'],
    ['', 'an empty path'],
  ])('refuses %s at the schema (%s)', async (path, _why: string) => {
    expect(await harness().call(CHANNEL.readFile, { path })).toEqual({ ok: false, error: { kind: 'bad-request' } })
  })

  test('a write with no project is refused before any path arithmetic', async () => {
    const result = await harness('no-project').call(CHANNEL.writeFile, {
      path: 'local_context/wiki/00_state.md',
      text: 'x',
      baseSha: '',
    })
    expect(result).toEqual({ ok: false, error: { kind: 'no-project' } })
  })

  test('a write payload missing its baseSha is refused: the guard is not optional', async () => {
    const result = await harness().call(CHANNEL.writeFile, { path: 'local_context/wiki/00_state.md', text: 'x' })
    expect(result).toEqual({ ok: false, error: { kind: 'bad-request' } })
  })
})

describe('project:accent', () => {
  test('persists the hue and tells every window on the project', async () => {
    const app = harness()
    await app.call(CHANNEL.setAccent, { hue: 337 })

    expect(app.hues.get(sample.dir)).toBe(337)
    expect(app.broadcasts).toEqual([[sample.dir, { kind: 'accent', dir: sample.dir, hue: 337 }]])
  })

  test.each([
    [{ hue: 41 }, 'a hue that is not on the palette'],
    [{ hue: 210.5 }, 'a fractional hue'],
    [{ hue: -1 }, 'a negative hue'],
    [{ hue: '210' }, 'a hue as a string'],
    [{}, 'no hue'],
  ])('ignores %o (%s)', async (payload, _why: string) => {
    const app = harness()
    await app.call(CHANNEL.setAccent, payload)
    expect(app.hues.size).toBe(0)
    expect(app.broadcasts).toEqual([])
  })

  test('a window with no project changes nothing', async () => {
    const app = harness('no-project')
    await app.call(CHANNEL.setAccent, { hue: 337 })
    expect(app.broadcasts).toEqual([])
  })
})

describe('the terminal', () => {
  test('a pane is scoped to the sending window’s project, and the preset is an enum', async () => {
    const app = harness()
    await expect(app.call(CHANNEL.startPty, { preset: 'shell', cols: 80, rows: 24 })).resolves.toEqual({
      ok: true,
      value: { id: 1 },
    })
  })

  test('a window with no project starts nothing', async () => {
    const app = harness('no-project')
    await expect(app.call(CHANNEL.startPty, { preset: 'shell', cols: 80, rows: 24 })).resolves.toEqual({
      ok: false,
      error: { kind: 'no-project' },
    })
  })

  test.each([
    [{ preset: 'rm -rf /', cols: 80, rows: 24 }, 'a command line where a preset belongs'],
    [{ preset: 'shell', cols: 0, rows: 24 }, 'a zero-column geometry'],
    [{ preset: 'shell' }, 'no geometry at all'],
  ])('refuses %o (%s)', async (payload, _why: string) => {
    const app = harness()
    await expect(app.call(CHANNEL.startPty, payload)).resolves.toEqual({ ok: false, error: { kind: 'bad-request' } })
  })

  test('keystrokes reach the pane the window owns', async () => {
    const app = harness()
    await app.call(CHANNEL.startPty, { preset: 'shell', cols: 80, rows: 24 })
    await app.call(CHANNEL.writePty, { id: 1, data: 'ls\r' })

    expect(app.shells).toEqual(['ls\r'])
  })

  test('and never one another window owns', async () => {
    const app = harness(sample, sample)
    await app.call(CHANNEL.startPty, { preset: 'shell', cols: 80, rows: 24 }, 1)
    await app.call(CHANNEL.writePty, { id: 1, data: 'rm -rf /\r' }, 2)
    await app.call(CHANNEL.resizePty, { id: 1, cols: 10, rows: 10 }, 2)
    await app.call(CHANNEL.killPty, { id: 1 }, 2)

    // Recorded, not merely absent: the fake spawner logs a resize and a kill, so
    // a handler that passed the wrong window id would show up here.
    expect(app.shells).toEqual([])

    // Its own window still reaches it, which is what proves the pane is alive.
    await app.call(CHANNEL.writePty, { id: 1, data: 'ls\r' }, 1)
    expect(app.shells).toEqual(['ls\r'])
  })

  test('a malformed write is dropped rather than partially applied', async () => {
    const app = harness()
    await app.call(CHANNEL.startPty, { preset: 'shell', cols: 80, rows: 24 })
    await app.call(CHANNEL.writePty, { id: 1 })
    await app.call(CHANNEL.writePty, { id: 0, data: 'x' })

    expect(app.shells).toEqual([])
  })
})

describe('openExternal', () => {
  test('a web link reaches the OS as the *parsed* href, not as the string that was sent', async () => {
    const app = harness()
    // The URL parser strips the control character; opening the raw string would
    // hand the OS something the check never saw.
    await app.call(CHANNEL.openExternal, { url: 'https://example.com/a\nb' })
    expect(app.externals).toEqual(['https://example.com/ab'])
  })

  test.each([
    ['file:///etc/passwd', 'a scheme that launches an application'],
    ['smb://host/share', 'a scheme that triggers an authentication attempt'],
    ['javascript:alert(1)', 'a scheme that is code'],
    ['not a url', 'not a URL at all'],
  ])('refuses %s (%s)', async (url, _why: string) => {
    const app = harness()
    await app.call(CHANNEL.openExternal, { url })
    expect(app.externals).toEqual([])
  })

  test('a malformed payload opens nothing', async () => {
    const app = harness()
    await app.call(CHANNEL.openExternal, { url: '' })
    await app.call(CHANNEL.openExternal, {})
    expect(app.externals).toEqual([])
  })
})

describe('projectEventFor', () => {
  test('a content change names the file and costs no directory walk', async () => {
    await expect(projectEventFor(sample, { kind: 'file', path: 'local_context/wiki/00_state.md' })).resolves.toEqual({
      kind: 'file',
      dir: sample.dir,
      path: 'local_context/wiki/00_state.md',
    })
  })

  test('an appearance or disappearance carries the whole new list', async () => {
    const event = await projectEventFor(sample, { kind: 'files' })
    expect(event.kind === 'files' && event.files).toContain('local_context/wiki/00_state.md')
  })
})


describe('the folder that is not a project yet', () => {
  const bare = fixture('broken-projects/no-block')

  test('a refused open is remembered as the pending folder, and an agent runs there', async () => {
    const app = harness('no-project')

    await app.call(CHANNEL.openProject, { dir: bare })
    const started = await app.call(CHANNEL.startPty, { preset: 'agent', cols: 80, rows: 24 })

    // The renderer asked for "an agent"; the *folder* is the one main itself
    // just failed to open.
    expect(started).toMatchObject({ ok: true })
    expect(app.spawns.at(-1)?.cwd).toBe(bare)
  })

  test('a window with no project and no refusal behind it still has nowhere to run', async () => {
    const app = harness('no-project')

    expect(await app.call(CHANNEL.startPty, { preset: 'agent', cols: 80, rows: 24 })).toEqual({
      ok: false,
      error: { kind: 'no-project' },
    })
  })

  test('a window bound to a project ignores any pending folder — the project wins', async () => {
    const app = harness()

    await app.call(CHANNEL.openProject, { dir: bare })
    await app.call(CHANNEL.startPty, { preset: 'agent', cols: 80, rows: 24 })

    expect(app.spawns.at(-1)?.cwd).toBe(sample.dir)
  })
})

describe('settings', () => {
  const two: Settings = {
    launchers: [
      { id: 'claude', label: 'claude', command: 'claude' },
      { id: 'codex', label: 'codex', command: 'codex --model o3' },
    ],
    defaultLauncherId: 'claude',
    noteTag: 'eddy',
  }

  test('the agent pane runs the launcher the renderer named, resolved here', async () => {
    const app = harness(sample, undefined, two)

    await app.call(CHANNEL.startPty, { preset: 'agent', cols: 80, rows: 24, launcherId: 'codex' })

    expect(app.spawns.at(-1)?.args).toEqual(['-l', '-i', '-c', 'codex --model o3'])
  })

  test('naming nothing runs the default launcher, and naming a deleted one falls back to it', async () => {
    const app = harness(sample, undefined, two)

    await app.call(CHANNEL.startPty, { preset: 'agent', cols: 80, rows: 24 })
    await app.call(CHANNEL.startPty, { preset: 'agent', cols: 80, rows: 24, launcherId: 'gone' })

    expect(app.spawns.map((spawn) => spawn.args.at(-1))).toEqual(['claude', 'claude'])
  })

  test('a saved change is persisted and broadcast to every window', async () => {
    const app = harness()

    const result = await app.call(CHANNEL.setSettings, two)

    expect(result).toEqual({ ok: true, value: two })
    expect(app.settingsNow()).toEqual(two)
    expect(app.settingsBroadcasts).toEqual([two])
  })

  test('settings core refuses are not written and come back as the reason', async () => {
    const app = harness()

    const result = await app.call(CHANNEL.setSettings, { launchers: [], defaultLauncherId: 'x', noteTag: 'eddy' })

    expect(result).toEqual({ ok: false, error: { kind: 'no-launchers' } })
    expect(app.settingsNow()).toEqual(DEFAULT_SETTINGS)
    expect(app.settingsBroadcasts).toEqual([])
  })

  /**
   * The division of labour, as an assertion: the schema takes the *shape* and
   * `core` judges the *meaning*. A row added and not yet typed into is an
   * ordinary thing to save by accident, and "this is a bug in the app" is the
   * wrong thing to tell someone about it.
   */
  test('an empty command is refused by core, in words, not by the schema as a bad request', async () => {
    const app = harness()

    const result = await app.call(CHANNEL.setSettings, {
      launchers: [{ id: 'codex', label: 'codex', command: '' }],
      defaultLauncherId: 'codex',
      noteTag: 'eddy',
    })

    expect(result).toEqual({ ok: false, error: { kind: 'empty-field', field: 'command' } })
  })

  test('a payload that is not settings at all is a bad request, not a crash', async () => {
    const app = harness()

    expect(await app.call(CHANNEL.setSettings, { launchers: 'claude' })).toEqual({
      ok: false,
      error: { kind: 'bad-request' },
    })
  })

  test('the default launcher is what a window reads back', async () => {
    const app = harness(sample, undefined, two)

    expect(await app.call(CHANNEL.getSettings)).toEqual(two)
  })
})

/**
 * The skill install is the app speaking for itself: no project, no window
 * scope, and a payload that is parsed like every other. What it does to
 * `~/.claude` is `main/skill.test.ts`'s.
 */
describe('the skill install', () => {
  test('status is answered in a window with no project — there is one ~/.claude per machine', async () => {
    const app = harness('no-project')

    expect(await app.call(CHANNEL.skillStatus)).toMatchObject({ ok: true, value: { state: 'absent' } })
  })

  test('the guard digest reaches the host exactly as it was sent', async () => {
    const app = harness()

    await app.call(CHANNEL.installSkill, { baseSha: 'abcdef' })

    expect(app.skillInstalls).toEqual(['abcdef'])
  })

  test('an empty digest is a legitimate guard — it means nothing was installed', async () => {
    const app = harness()

    expect(await app.call(CHANNEL.installSkill, { baseSha: '' })).toMatchObject({ ok: true })
    expect(app.skillInstalls).toEqual([''])
  })

  test('a malformed payload is refused before the installer is reached', async () => {
    const app = harness()

    for (const payload of [{ baseSha: 42 }, {}, null, { baseSha: 'x'.repeat(65) }]) {
      expect(await app.call(CHANNEL.installSkill, payload)).toEqual({ ok: false, error: { kind: 'bad-request' } })
    }
    expect(app.skillInstalls).toEqual([])
  })
})

describe('debt:read', () => {
  test('is scoped to the sending window’s project, and takes no payload', async () => {
    const bench = harness()
    // A payload is sent anyway: a renderer that is not ours can send one, and
    // the handler must ignore it rather than let it name anything.
    await bench.call(CHANNEL.readDebt, { dir: '/somewhere/else' })
    expect(bench.debtReads).toEqual([sample.dir])
  })

  test('a second window on another project reads its own', async () => {
    const other: OpenProject = { ...sample, dir: '/p/b' }
    const bench = harness(sample, other)
    await bench.call(CHANNEL.readDebt, undefined, 2)
    expect(bench.debtReads).toEqual([other.dir])
  })

  test('a window with no project is refused rather than given someone else’s', async () => {
    const answer = await harness('no-project').call(CHANNEL.readDebt)
    expect(answer).toEqual({ ok: false, error: { kind: 'no-project' } })
  })
})
