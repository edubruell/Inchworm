/**
 * The checker spawner: the second place in the app that builds an argv, and the
 * only one that runs a program the user did not type (the first is `pty.ts`,
 * where the user typed it).
 *
 * **The containment is structural.** The app may run only checkers it ships,
 * and never a project's own script. Three things enforce it here, and each is
 * asserted in `debt.test.ts`: the script name comes from
 * `core.CHECKERS` and from no other source; the path is joined under the app's
 * own bundle directory, so no project string can steer it; and the file is
 * hashed on first read and re-hashed before every later spawn, so a resource
 * swapped *under a running app* is refused rather than run. That last one is
 * deliberately modest and should not be read as more: the baseline is this
 * process's first look, so a swap made before launch is the baseline, and the
 * hash is of a read the exec then repeats by name. Anyone who can write inside
 * the app bundle has already won; this catches the accident and the
 * mid-session edit.
 *
 * The project directory is the one argument that varies, and it is main's — it
 * comes from the registry entry for the *sending window*, never from a payload.
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CHECKERS, orderDebt, sweepDebt, triggerDebt, type Checker, type DebtItem } from '@core/debt.js'
import { err, ok } from '@core/result.js'
import type { DebtError, DebtReport, Wire } from '@shared/api.js'
import { createChain, shaOf } from './io.js'

/** How the checker was run and what it said. `code` is its exit code: 0 clean · 1 debt · 3 failed. */
export type CheckerRun = { readonly code: number; readonly stdout: string }

/**
 * Running one checker, injected so the tests spawn nothing. The real one is
 * `python3 <script> --json --no-persist <projectDir>`; the only shell is the
 * one-shot login shell in `findPython`, after an ENOENT — the same rule
 * the PTY host keeps, for the same reason.
 */
export type CheckerRunner = (script: string, args: readonly string[]) => Promise<CheckerRun>

export type DebtPaths = {
  /** The directory this build carries the skill — and therefore the checkers — in. */
  readonly source: string
}

export type DebtHost = {
  readonly read: (projectDir: string, files: readonly string[]) => Promise<Wire<DebtReport, DebtError>>
}

/** A checker is python and takes a while; a GUI asking three times a minute must not stack them up. */
const TIMEOUT_MS = 20_000

/**
 * The interpreter, resolved through a **login shell** rather than trusted to be
 * on `PATH`. This is `pty.ts`'s lesson applied a second time: an app launched
 * from the Dock inherits launchd's environment, so a homebrew or pyenv python3
 * is simply not there, and the section would read "no python3" forever on a
 * machine whose terminal pane runs the same checkers fine.
 */
const LOGIN_SHELL = process.env.SHELL ?? '/bin/zsh'

const FALLBACK_PYTHON = 'python3'

/** One checker's way of saying the failure was not its own. */
const NO_PYTHON = 'no-python'

/** Bigger than any real report, small enough that a runaway checker cannot fill memory. */
const MAX_OUTPUT_BYTES = 4_000_000

const codeOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined

/**
 * The default runner. A checker that exits non-zero is not an error here — 1 is
 * *debt*, which is the answer we asked for — so the exit code is read off the
 * failure rather than thrown, and only a missing `python3` is a failure of the
 * call itself.
 */
/** `command -v python3` as a shell answers it — asked at most once per spawner. */
const findPython = (shell: string): Promise<string> =>
  new Promise((resolve) => {
    execFile(shell, ['-l', '-c', 'command -v python3'], { timeout: TIMEOUT_MS }, (error, stdout) => {
      const found = stdout.trim().split('\n').at(-1) ?? ''
      resolve(error === null && found.startsWith('/') ? found : FALLBACK_PYTHON)
    })
  })

const runWith = (python: string, script: string, args: readonly string[]): Promise<CheckerRun> =>
  new Promise((resolve, reject) => {
    execFile(
      python,
      [script, ...args],
      // SIGKILL rather than the default SIGTERM: a checker that has stopped
      // answering is not going to handle a signal politely either.
      { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, shell: false, killSignal: 'SIGKILL' },
      (error, stdout) => {
        if (error === null) resolve({ code: 0, stdout })
        // A missing or unusable interpreter is the one failure of the *call*;
        // everything else is the checker answering, exit code and all.
        else if (codeOf(error) === 'ENOENT' || codeOf(error) === 'EACCES')
          reject(Object.assign(new Error(error.message), { code: 'ENOENT' }))
        else resolve({ code: typeof error.code === 'number' ? error.code : 3, stdout })
      },
    )
  })

/**
 * `python3 <script> --json --no-persist <projectDir>`, with no shell in the
 * spawn itself.
 *
 * The retry is `pty.ts`'s lesson applied a second time: an app launched from
 * the Dock inherits launchd's environment, so a homebrew or pyenv python3 is
 * not on `PATH` there and the section would say "no python3" forever on a
 * machine whose terminal pane runs the same checkers fine. So a missing
 * interpreter is asked about **once**, through a login shell, and the answer is
 * kept for the life of the spawner. The common case — python3 on `PATH` —
 * never spawns a shell at all.
 *
 * Both names are parameters so this is testable without uninstalling python:
 * the app calls it with neither.
 */
export const createSpawner = (python: string = FALLBACK_PYTHON, shell: string = LOGIN_SHELL): CheckerRunner => {
  let resolved: string | undefined
  return async (script, args) => {
    try {
      return await runWith(resolved ?? python, script, args)
    } catch (error: unknown) {
      if (codeOf(error) !== 'ENOENT' || resolved !== undefined) throw error
      resolved = await findPython(shell)
      if (resolved === python) throw error
      return runWith(resolved, script, args)
    }
  }
}

export const spawnChecker: CheckerRunner = createSpawner()

/**
 * A checker's stdout as a record, or `undefined`. A scalar counts as nothing
 * answered: `JSON.parse('null')` succeeds, and letting it through would draw a
 * checker printing `null` as a wiki with no debt.
 */
const parse = (stdout: string): unknown => {
  try {
    const value = JSON.parse(stdout) as unknown
    return typeof value === 'object' && value !== null ? value : undefined
  } catch {
    return undefined
  }
}

/** Which reader a checker's payload gets. Keyed by the union, so a third checker fails to compile. */
const READER: Record<Checker, (payload: unknown, files: readonly string[]) => readonly DebtItem[] | undefined> = {
  'wiki-sweepcheck.py': sweepDebt,
  'wiki-trigger.py': triggerDebt,
}

export const createDebtHost = (
  paths: DebtPaths,
  run: CheckerRunner = spawnChecker,
  now: () => number = (): number => Date.now(),
): DebtHost => {
  /** The digest each checker had the first time it was read. Empty until then. */
  const seen = new Map<Checker, string>()

  /**
   * The script's path, once it has been read and found to be the same bytes as
   * last time. Everything that could make this return a path outside the bundle
   * — a name, a project string, a symlink chase — is simply not available to it.
   */
  const vetted = async (name: Checker): Promise<string | undefined> => {
    const script = join(paths.source, name)
    const sha = await readFile(script).then(shaOf, () => undefined)
    if (sha === undefined) return undefined
    const before = seen.get(name)
    if (before === undefined) seen.set(name, sha)
    else if (before !== sha) return undefined
    return script
  }

  /**
   * One checker's contribution: its items, or `undefined` for a checker that
   * could not answer. A missing `python3` is thrown on rather than reported
   * here — it is not this checker's failure, it is every checker's.
   */
  const ask = async (
    name: Checker,
    script: string,
    projectDir: string,
    files: readonly string[],
  ): Promise<readonly DebtItem[] | undefined> => {
    // `--no-persist`: the checkers pin a project's sweep cutoff the first time
    // they see it, and *opening a folder to look at it* must not be what sets
    // that line in `~/.claude` — the app never writes on its own, and this is
    // the flag that keeps that true through a subprocess.
    const answer = await run(script, ['--json', '--no-persist', projectDir])
    // The exit code is not consulted: 0 is clean, 1 is debt, 2 is "not a
    // project" and 3 is the checker failing — and every one of them can arrive
    // with or without a usable payload. What decides is whether the payload
    // carries the checker's own list; a JSON object without it is a checker
    // that did not answer, never an empty answer.
    return READER[name](parse(answer.stdout), files)
  }

  /**
   * One round of checkers at a time, per host. Every window on this machine
   * shares it, and a machine with four windows open would otherwise answer a
   * single watcher event with eight python processes.
   */
  const serialised = createChain()

  const collect = async (projectDir: string, files: readonly string[]): Promise<Wire<DebtReport, DebtError>> => {
    const scripts = await Promise.all(CHECKERS.map(async (name) => ({ name, script: await vetted(name) })))
    // A bundle that never had the checkers is a packaging failure; one whose
    // checkers were *read once and then changed* is not, and must not be
    // reported as "this build carries no checkers".
    if (scripts.every((entry) => entry.script === undefined) && seen.size === 0) {
      return err({ kind: 'no-bundle', detail: paths.source })
    }

    // Concurrently: two checkers, one round. Sequentially they would put the
    // ceiling at two timeouts, which is longer than the gap between watcher
    // events during an agent's close.
    const answers = await Promise.all(
      scripts.map(async (entry): Promise<readonly DebtItem[] | undefined | typeof NO_PYTHON> => {
        try {
          return entry.script === undefined ? undefined : await ask(entry.name, entry.script, projectDir, files)
        } catch (error: unknown) {
          // No usable `python3` at all is one report, not one per checker: the
          // reader needs the missing thing named once.
          return codeOf(error) === 'ENOENT' ? NO_PYTHON : undefined
        }
      }),
    )
    if (answers.includes(NO_PYTHON)) return err({ kind: 'no-python' })

    return ok({
      items: orderDebt(answers.flatMap((found) => (found === undefined || found === NO_PYTHON ? [] : found))),
      failed: scripts.flatMap((entry, at) => (answers[at] === undefined ? [entry.name] : [])),
      checkedMs: now(),
    })
  }

  const read = (projectDir: string, files: readonly string[]): Promise<Wire<DebtReport, DebtError>> =>
    serialised(() => collect(projectDir, files))

  return { read }
}
