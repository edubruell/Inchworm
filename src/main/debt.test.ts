/**
 * **The spawn list, asserted**: the app may
 * run only checkers it ships, and never a project's own script. Everything
 * below is that one claim, asserted the way the IPC channel set is — over the
 * whole recorded argv, not over a sample of it.
 *
 * Nothing here spawns: the runner is injected, so what is under test is the
 * argv the host *would* build, which is the thing the rule is about.
 */

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { CHECKERS } from '@core/debt.js'
import { createDebtHost, createSpawner, spawnChecker, type CheckerRun, type DebtHost } from './debt.js'

type Bench = {
  readonly host: DebtHost
  readonly source: string
  /** Every (script, args) pair the host asked for, in order. */
  readonly calls: readonly (readonly [string, readonly string[]])[]
  readonly rewrite: (name: string, text: string) => Promise<void>
}

const SWEEP = JSON.stringify({ debt: [{ register: 'findings.md', line: 4, problem: 'no stamp' }] })
const TRIGGER = JSON.stringify({ open: [{ kind: 'unfiled', path: 'payload/incoming/x', detail: 'no marker' }] })

const bench = async (
  answer: (script: string) => CheckerRun | Promise<CheckerRun> = (script) => ({
    code: 1,
    stdout: script.endsWith('wiki-trigger.py') ? TRIGGER : SWEEP,
  }),
  options: { readonly bundle?: boolean } = {},
): Promise<Bench> => {
  const base = await mkdtemp(join(tmpdir(), 'wikiviewer-debt-'))
  const source = join(base, 'bundle')
  await mkdir(source, { recursive: true })
  if (options.bundle !== false) for (const name of CHECKERS) await writeFile(join(source, name), `# ${name}\n`)
  const calls: (readonly [string, readonly string[]])[] = []
  const host = createDebtHost(
    { source },
    async (script, args) => {
      calls.push([script, args])
      return answer(script)
    },
    () => 1_000,
  )
  return {
    host,
    source,
    calls,
    rewrite: (name, text) => writeFile(join(source, name), text),
  }
}

describe('what the app may spawn', () => {
  test('is only the checkers, only from the bundle, whatever the project is called', async () => {
    const bed = await bench()
    // Every shape that has ever steered a path: traversal, an absolute path, a
    // flag-looking name, a quoted separator. None of them is a script name here
    // — the project is an *argument*, and the script comes from `core.CHECKERS`.
    for (const dir of ['/p/a', '../../etc', '/p/--json', "/p/a'; rm -rf /", '/p/wiki-trigger.py']) {
      await bed.host.read(dir, [])
    }
    for (const [script, args] of bed.calls) {
      expect(dirname(script)).toBe(bed.source)
      expect(CHECKERS.some((name) => script === join(bed.source, name))).toBe(true)
      expect(args[0]).toBe('--json')
      // The cutoff flag rides in the constant part of the argv: opening a folder
      // to look at it must not pin that project's sweep cutoff in `~/.claude`.
      expect(args[1]).toBe('--no-persist')
      expect(args).toHaveLength(3)
    }
    expect(bed.calls).toHaveLength(CHECKERS.length * 5)
    await rm(bed.source, { recursive: true, force: true })
  })

  test('is the whole list and nothing else, every time', async () => {
    const bed = await bench()
    await bed.host.read('/p/a', [])
    expect(bed.calls.map(([script]) => script.slice(bed.source.length + 1))).toEqual([...CHECKERS])
  })

  test('never runs a script the bundle does not carry', async () => {
    const bed = await bench(undefined, { bundle: false })
    const answer = await bed.host.read('/p/a', [])
    expect(bed.calls).toEqual([])
    expect(answer.ok).toBe(false)
    if (!answer.ok) expect(answer.error.kind).toBe('no-bundle')
  })

  test('refuses a checker whose bytes changed under the running app', async () => {
    const bed = await bench()
    await bed.host.read('/p/a', [])
    await bed.rewrite('wiki-trigger.py', '# something else\n')
    const answer = await bed.host.read('/p/a', [])
    expect(answer.ok).toBe(true)
    if (answer.ok) expect(answer.value.failed).toEqual(['wiki-trigger.py'])
    // The swapped one is not spawned again; the other still is.
    expect(bed.calls.filter(([script]) => script.endsWith('wiki-trigger.py'))).toHaveLength(1)
    expect(bed.calls.filter(([script]) => script.endsWith('wiki-sweepcheck.py'))).toHaveLength(2)
  })
})

describe('what comes back', () => {
  test('both checkers’ findings, in kind order', async () => {
    const bed = await bench()
    const answer = await bed.host.read('/p/a', ['local_context/wiki/findings.md'])
    expect(answer.ok).toBe(true)
    if (!answer.ok) return
    expect(answer.value.items.map((item) => item.kind)).toEqual(['unstamped', 'unfiled'])
    expect(answer.value.items[0]?.path).toBe('local_context/wiki/findings.md')
    expect(answer.value.failed).toEqual([])
    expect(answer.value.checkedMs).toBe(1_000)
  })

  test('exit 0 is an answer, not a silence', async () => {
    // Clean is a real verdict: the checkers exit 0 with a payload saying so.
    const bed = await bench(() => ({ code: 0, stdout: JSON.stringify({ clean: true, debt: [], open: [] }) }))
    const answer = await bed.host.read('/p/a', [])
    expect(answer.ok && answer.value.items).toEqual([])
    expect(answer.ok && answer.value.failed).toEqual([])
  })

  test('exit 3 is the checker failing, and is named rather than read as clean', async () => {
    // A checker that crashed must never look like debt *or* like a clean wiki —
    // the schema's own rule about exit 3, kept on this side of the wire.
    const bed = await bench(() => ({ code: 3, stdout: 'traceback' }))
    const answer = await bed.host.read('/p/a', [])
    expect(answer.ok).toBe(true)
    if (answer.ok) expect(answer.value.failed).toEqual([...CHECKERS])
  })

  test('output that is not JSON is a failed checker, not a crash', async () => {
    const bed = await bench(() => ({ code: 1, stdout: '[llmwiki] not json at all' }))
    const answer = await bed.host.read('/p/a', [])
    expect(answer.ok).toBe(true)
    if (answer.ok) {
      expect(answer.value.items).toEqual([])
      expect(answer.value.failed).toEqual([...CHECKERS])
    }
  })

  test('one checker down still returns the other’s findings, marked partial', async () => {
    const bed = await bench((script) =>
      script.endsWith('wiki-trigger.py') ? { code: 3, stdout: '' } : { code: 1, stdout: SWEEP },
    )
    const answer = await bed.host.read('/p/a', [])
    expect(answer.ok).toBe(true)
    if (answer.ok) {
      expect(answer.value.items).toHaveLength(1)
      expect(answer.value.failed).toEqual(['wiki-trigger.py'])
    }
  })

  test('a payload with no list in it is a checker that did not answer', async () => {
    // `wiki-sweepcheck.py` emits `{ok: false, note: …, wiki: null}` — no `debt`
    // key — for a project it cannot read. Reading that as an empty list would
    // draw a broken checker exactly like a clean wiki.
    const bed = await bench(() => ({ code: 2, stdout: JSON.stringify({ ok: false, note: 'not a directory', wiki: null }) }))
    const answer = await bed.host.read('/p/a', [])
    expect(answer.ok).toBe(true)
    if (answer.ok) {
      expect(answer.value.items).toEqual([])
      expect(answer.value.failed).toEqual([...CHECKERS])
    }
  })

  test('a JSON scalar is not an answer either', async () => {
    const bed = await bench(() => ({ code: 0, stdout: 'null' }))
    const answer = await bed.host.read('/p/a', [])
    expect(answer.ok && answer.value.failed).toEqual([...CHECKERS])
  })

  test('checkers that changed after a good read are failures, not a missing bundle', async () => {
    // "this build carries no checkers" is the most misleading thing the app
    // could say about a checker someone edited under it.
    const bed = await bench()
    await bed.host.read('/p/a', [])
    for (const name of CHECKERS) await bed.rewrite(name, '# swapped\n')
    const answer = await bed.host.read('/p/a', [])
    expect(answer.ok).toBe(true)
    if (answer.ok) expect(answer.value.failed).toEqual([...CHECKERS])
  })

  test('a runner that throws for any other reason fails that checker only', async () => {
    const bed = await bench((script) => {
      if (script.endsWith('wiki-trigger.py')) throw new Error('killed by the timeout')
      return { code: 1, stdout: SWEEP }
    })
    const answer = await bed.host.read('/p/a', [])
    expect(answer.ok).toBe(true)
    if (answer.ok) {
      expect(answer.value.items).toHaveLength(1)
      expect(answer.value.failed).toEqual(['wiki-trigger.py'])
    }
  })

  test('no python3 at all is one refusal, not one per checker', async () => {
    const bed = await bench(() => {
      throw Object.assign(new Error('spawn python3 ENOENT'), { code: 'ENOENT' })
    })
    const answer = await bed.host.read('/p/a', [])
    expect(answer.ok).toBe(false)
    if (!answer.ok) expect(answer.error.kind).toBe('no-python')
  })
})

describe('rounds do not stack', () => {
  test('three overlapping reads never run more than one round at a time', async () => {
    // One host serves every window on the machine; four windows answering one
    // watcher event must not be eight python processes at once.
    let inFlight = 0
    let peak = 0
    const bed = await bench(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return { code: 0, stdout: '{}' }
    })

    await Promise.all([bed.host.read('/p/a', []), bed.host.read('/p/a', []), bed.host.read('/p/a', [])])
    expect(peak).toBe(CHECKERS.length)
    expect(bed.calls).toHaveLength(CHECKERS.length * 3)
  })
})

describe('the real runner', () => {
  /**
   * `spawnChecker` against actual python, because the injected one cannot prove
   * the part that matters: that an exit code is an *answer* here, not a throw.
   * The checkers exit 1 for debt, and a runner that treated that as failure
   * would report every wiki with debt as a wiki with a broken checker.
   */
  const withScript = async (body: string): Promise<{ readonly script: string; readonly clean: () => Promise<void> }> => {
    const base = await mkdtemp(join(tmpdir(), 'wikiviewer-python-'))
    const script = join(base, 'checker.py')
    await writeFile(script, body)
    return { script, clean: () => rm(base, { recursive: true, force: true }) }
  }

  test('exit 0 comes back as an answer', async () => {
    const bed = await withScript('import sys\nprint("{}")\nsys.exit(0)\n')
    await expect(spawnChecker(bed.script, ['--json', '/p/a'])).resolves.toEqual({ code: 0, stdout: '{}\n' })
    await bed.clean()
  })

  test('exit 1 is debt, not a failure — stdout and all', async () => {
    const bed = await withScript('import sys\nprint("{\\"debt\\": []}")\nsys.exit(1)\n')
    const answer = await spawnChecker(bed.script, ['--json', '/p/a'])
    expect(answer.code).toBe(1)
    expect(answer.stdout).toContain('debt')
    await bed.clean()
  })

  test('the project directory reaches the checker as one argument, unsplit', async () => {
    // No shell anywhere: a directory with a space, a quote or a semicolon in it
    // is one argv element, not the start of a second command.
    const bed = await withScript('import sys\nprint(sys.argv[2])\n')
    const nasty = "/p/a b'; touch pwned"
    const answer = await spawnChecker(bed.script, ['--json', nasty])
    expect(answer.stdout.trim()).toBe(nasty)
    await bed.clean()
  })
})

describe('against the real checkers', () => {
  /**
   * The one test that closes the loop: the **shipped** `wiki-sweepcheck.py` and
   * `wiki-trigger.py`, over a fixture project that owes one of each kind, read
   * by the same `core` functions the app uses. Every other test in this file
   * feeds hand-written JSON, which cannot notice the day a checker renames a
   * field.
   */
  const FIXTURE = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'debt-project')

  test('finds the unstamped entry, the marked artefact and the unfiled one', async () => {
    // The fixture's entry is dated, so without this it drops out of the
    // sentinel's 30-day window a month from now and the test rots quietly.
    process.env.LLMWIKI_SWEEP_WINDOW_DAYS = '36500'
    const host = createDebtHost({ source: join(import.meta.dirname, '..', '..', 'skills', 'llmwiki') })
    const answer = await host.read(FIXTURE, ['local_context/wiki/findings.md'])
    delete process.env.LLMWIKI_SWEEP_WINDOW_DAYS

    expect(answer.ok).toBe(true)
    if (!answer.ok) return
    expect(answer.value.failed).toEqual([])
    expect(answer.value.items.map((item) => [item.kind, item.label])).toEqual([
      ['unstamped', 'findings.md:3'],
      ['unswept', '20260826d'],
      ['unfiled', '20260825c'],
    ])
    // The register resolves to the file the window lists; an artefact under the
    // project's own folders does not, and is shown without a link.
    expect(answer.value.items[0]?.path).toBe('local_context/wiki/findings.md')
    expect(answer.value.items[1]?.path).toBeUndefined()
    expect(answer.value.items[1]?.detail).toContain('payload/incoming/20260826d')
  }, 30_000)

  test('a directory that is no project at all is a failed checker, never a clean one', async () => {
    // The checkers walk *up* for a CLAUDE.md, so this has to be a directory
    // with no project above it — inside the repo, every path has one.
    const orphan = await mkdtemp(join(tmpdir(), 'wikiviewer-orphan-'))
    const host = createDebtHost({ source: join(import.meta.dirname, '..', '..', 'skills', 'llmwiki') })
    const answer = await host.read(orphan, [])
    await rm(orphan, { recursive: true, force: true })
    expect(answer.ok).toBe(true)
    if (answer.ok) {
      expect(answer.value.items).toEqual([])
      expect(answer.value.failed).toEqual([...CHECKERS])
    }
  }, 30_000)

  test('the run leaves no cutoff behind in ~/.claude', async () => {
    // Opening a folder to look at it must not pin that project's sweep cutoff:
    // the flag is in the argv, and this is the proof it reaches the script.
    const marker = createHash('md5').update(FIXTURE).digest('hex').slice(0, 8)
    const state = join(homedir(), '.claude', 'sessions', marker)
    await rm(state, { recursive: true, force: true })
    const host = createDebtHost({ source: join(import.meta.dirname, '..', '..', 'skills', 'llmwiki') })
    await host.read(FIXTURE, [])
    await expect(stat(state)).rejects.toThrow()
  }, 30_000)
})

describe('a machine where python3 is not on PATH', () => {
  test('the interpreter is asked for once, through a login shell, and the run then works', async () => {
    // The packaged-from-the-Dock case: launchd's PATH has no homebrew python.
    // Nothing is uninstalled here — the spawner is simply pointed at a name
    // that does not exist, and must recover exactly as it would there.
    const base = await mkdtemp(join(tmpdir(), 'wikiviewer-python-'))
    const script = join(base, 'checker.py')
    await writeFile(script, 'import sys\nprint(sys.argv[1])\n')
    const run = createSpawner('python3-not-here', '/bin/sh')

    const first = await run(script, ['--json'])
    expect(first.stdout.trim()).toBe('--json')
    // Asked once: the second call reuses the answer rather than spawning a
    // shell again for every checker, every refresh.
    const second = await run(script, ['--json'])
    expect(second.stdout.trim()).toBe('--json')
    await rm(base, { recursive: true, force: true })
  }, 30_000)

  test('a login shell that cannot answer falls back to the plain name', async () => {
    // The shell is missing, so `command -v` never runs; the spawner still tries
    // `python3` itself before giving up, which is what a normal terminal-launched
    // app has had all along.
    const base = await mkdtemp(join(tmpdir(), 'wikiviewer-python-'))
    const script = join(base, 'checker.py')
    await writeFile(script, 'print("ok")\n')
    const run = createSpawner('python3-not-here', '/nonexistent-shell')
    await expect(run(script, ['--json'])).resolves.toEqual({ code: 0, stdout: 'ok\n' })
    await rm(base, { recursive: true, force: true })
  }, 30_000)
})

describe('the clock', () => {
  test('is the real one when none is injected', async () => {
    const base = await mkdtemp(join(tmpdir(), 'wikiviewer-debt-'))
    for (const name of CHECKERS) await writeFile(join(base, name), '# x\n')
    const before = Date.now()
    const host = createDebtHost({ source: base }, () => Promise.resolve({ code: 0, stdout: '{}' }))
    const answer = await host.read('/p/a', [])
    expect(answer.ok && answer.value.checkedMs).toBeGreaterThanOrEqual(before)
    await rm(base, { recursive: true, force: true })
  })
})
