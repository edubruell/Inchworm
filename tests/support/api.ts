/**
 * A `WikiApi` for the component tests: every channel the window may call, and
 * a handle on the two things main pushes at it — project events and menu
 * commands.
 *
 * Anything a view under test should *not* reach rejects rather than returning
 * something plausible, so an accidental call is a failed test and not a quietly
 * wrong assertion.
 */

import type {
  Command,
  DebtError,
  DebtReport,
  FileStamp,
  PtyError,
  PtyEvent,
  FileContent,
  FileError,
  OpenProjectError,
  ProjectEvent,
  ProjectSnapshot,
  ProjectSummary,
  Settings,
  SettingsError,
  SkillError,
  SkillInstalled,
  SkillStatus,
  WikiApi,
  Wire,
} from '@shared/api.js'
import { DEFAULT_SETTINGS } from '@core/settings.js'
import { SKILL_FILES } from '@core/skill.js'

export type FakeApi = {
  readonly api: WikiApi
  /** Fire a menu command at the window, as main would. */
  readonly send: (command: Command) => void
  readonly emit: (event: ProjectEvent) => void
  /** Hues set through the swatch popover, in order. */
  readonly accents: readonly number[]
  /** Paths read, in order — a window should read each file once. */
  readonly reads: readonly string[]
  /** Directories `openProject` was asked for. */
  readonly opened: readonly string[]
  /** Writes attempted, in order — the sha guard each one carried included. */
  readonly writes: readonly { readonly path: string; readonly text: string; readonly baseSha: string }[]
  /** URLs handed to the OS browser. */
  readonly externals: readonly string[]
  /** Everything typed into a pane, and the presets started, in order. */
  readonly typed: readonly string[]
  readonly started: readonly string[]
  /** The launcher id each `agent` pane named; `undefined` means "the default". */
  readonly launched: readonly (string | undefined)[]
  /** Settings the sheet saved, in order. */
  readonly saved: readonly Settings[]
  /** The guard digest each install carried, in order — a stale one is assertable. */
  readonly installs: readonly string[]
  /** Push a settings broadcast at the window, as main would. */
  readonly settingsChanged: (settings: Settings) => void
  /** Push terminal output at the window, as main would. */
  readonly output: (event: PtyEvent) => void
  /** Panes started and not yet killed — an orphaned pty is assertable. */
  readonly livePanes: () => number
  /** How many times the window asked for a debt report — coalescing is assertable. */
  readonly debtReads: () => number
  /** Live listener counts, so "the window let go on unmount" is assertable. */
  readonly listening: () => { readonly commands: number; readonly events: number }
}

export const fakeApi = (options: {
  readonly project?: ProjectSnapshot | undefined
  readonly files?: Map<string, string>
  readonly fail?: FileError | undefined
  /** What the picker lists; empty by default. */
  readonly recent?: readonly ProjectSummary[] | undefined
  /** Make `openProject` fail, to put the picker's alert on screen. */
  readonly refuseOpen?: OpenProjectError | undefined
  /** Make the *next* write fail; cleared once it has, so a retry can succeed. */
  readonly refuseWrite?: FileError | undefined
  /** Make every `startPty` fail — the `claude`-is-not-on-PATH case. */
  readonly refusePty?: PtyError | undefined
  /** How many panes this window may hold; four, as main holds it. */
  readonly paneCap?: number | undefined
  /**
   * What `webUtils` would say a dropped `File` is. The default names one under
   * `/drop/`; a test that needs the *no path* case — a text selection, an image
   * dragged out of a browser — returns `''`, as the real one does.
   */
  readonly dropPath?: ((file: File) => string) | undefined
  /** What `getSettings` answers; the one-launcher default otherwise. */
  readonly settings?: Settings | undefined
  /** Make `setSettings` fail, to put the sheet's refusal on screen. */
  readonly refuseSettings?: SettingsError | undefined
  /** What `skillStatus` answers first; a machine with no skill installed otherwise. */
  readonly skill?: SkillStatus | undefined
  /**
   * Make the *next* install fail; cleared once it has, so the recovery the
   * guard exists for — refused, re-read, retried — can be played out.
   */
  readonly refuseInstall?: SkillError | undefined
  /** Make `skillStatus` fail, to put the sheet's read failure on screen. */
  readonly refuseStatus?: SkillError | undefined
  /** What the checkers found; nothing owed, and no checker down, by default. */
  readonly debt?: DebtReport | undefined
  /** Make every debt read fail — no python3, or a build with no checkers. */
  readonly refuseDebt?: DebtError | undefined
  /** Make the bridge itself fail: `invoke` rejects, as it does with no handler. */
  readonly rejectDebt?: boolean | undefined
}): FakeApi => {
  const commands = new Set<(command: Command) => void>()
  const events = new Set<(event: ProjectEvent) => void>()
  const accents: number[] = []
  const reads: string[] = []
  const opened: string[] = []
  const writes: { readonly path: string; readonly text: string; readonly baseSha: string }[] = []
  const externals: string[] = []
  const typed: string[] = []
  const started: string[] = []
  const launched: (string | undefined)[] = []
  const saved: Settings[] = []
  const installs: string[] = []
  let debtReads = 0
  let skill: SkillStatus = options.skill ?? { state: 'absent', sha: '', files: SKILL_FILES.length }
  let refuseInstall = options.refuseInstall
  const settingsListeners = new Set<(settings: Settings) => void>()
  let settings = options.settings ?? DEFAULT_SETTINGS
  const live = new Set<number>()
  const ptys = new Set<(event: PtyEvent) => void>()
  const files = options.files ?? new Map<string, string>()
  let refuseWrite = options.refuseWrite

  return {
    accents,
    reads,
    installs,
    opened,
    writes,
    externals,
    typed,
    started,
    launched,
    saved,
    settingsChanged: (next): void => {
      settings = next
      for (const listener of [...settingsListeners]) listener(next)
    },
    output: (event): void => {
      for (const listener of [...ptys]) listener(event)
    },
    livePanes: () => live.size,
    debtReads: () => debtReads,
    listening: () => ({ commands: commands.size, events: events.size }),
    send: (command): void => {
      for (const listener of [...commands]) listener(command)
    },
    emit: (event): void => {
      for (const listener of [...events]) listener(event)
    },
    api: {
      pathForFile: (file: File): string => options.dropPath?.(file) ?? `/drop/${file.name}`,
      chooseProject: () => Promise.reject(new Error('unused')),
      openProject: (dir: string): Promise<Wire<ProjectSummary, OpenProjectError>> => {
        opened.push(dir)
        return Promise.resolve(
          options.refuseOpen === undefined
            ? { ok: true, value: { dir, name: dir, hue: 210, lastOpenedMs: 0 } }
            : { ok: false, error: options.refuseOpen },
        )
      },
      listProjects: () => Promise.resolve(options.recent ?? []),
      readDebt: (): Promise<Wire<DebtReport, DebtError>> => {
        debtReads += 1
        if (options.rejectDebt === true) return Promise.reject(new Error('no handler registered'))
        return Promise.resolve(
          options.refuseDebt === undefined
            ? { ok: true, value: options.debt ?? { items: [], failed: [], checkedMs: 0 } }
            : { ok: false, error: options.refuseDebt },
        )
      },
      currentProject: () => Promise.resolve(options.project),
      setAccent: (hue: number): Promise<void> => {
        accents.push(hue)
        return Promise.resolve()
      },
      /**
       * Writes into the same fixture map the reads come out of, so a saved file
       * is a file the window can read back — and the sha is derived from the
       * text, so the guard is a real comparison and not a constant.
       */
      writeFile: (input): Promise<Wire<FileStamp, FileError>> => {
        writes.push(input)
        if (refuseWrite !== undefined) {
          const error = refuseWrite
          refuseWrite = undefined
          return Promise.resolve({ ok: false, error })
        }
        // The guard is real, not staged: the sha the draft carries must still be
        // the sha of the bytes here, exactly as `main/files.ts` checks it. A
        // fake that ignored `baseSha` would let a broken guard pass every test.
        const onDisk = `sha:${files.get(input.path) ?? ''}`
        if (input.baseSha !== onDisk) {
          return Promise.resolve({ ok: false, error: { kind: 'conflict', currentSha: onDisk } })
        }
        files.set(input.path, input.text)
        return Promise.resolve({ ok: true, value: { sha: `sha:${input.text}`, mtimeMs: 0 } })
      },
      openExternal: (url: string): Promise<void> => {
        externals.push(url)
        return Promise.resolve()
      },
      readFile: (path: string): Promise<Wire<FileContent, FileError>> => {
        reads.push(path)
        if (options.fail !== undefined) return Promise.resolve({ ok: false, error: options.fail })
        const text = files.get(path)
        if (text === undefined) return Promise.reject(new Error(`no fixture for ${path}`))
        return Promise.resolve({ ok: true, value: { path, text, sha: `sha:${text}`, mtimeMs: 0 } })
      },
      startPty: (input): Promise<Wire<{ readonly id: number }, PtyError>> => {
        if (options.refusePty !== undefined) return Promise.resolve({ ok: false, error: options.refusePty })
        // The same cap main holds, so "the fifth pane is refused" is a scene the
        // window can actually be put through.
        if (live.size >= (options.paneCap ?? 4)) return Promise.resolve({ ok: false, error: { kind: 'too-many' } })
        started.push(input.preset)
        launched.push(input.launcherId)
        live.add(started.length)
        return Promise.resolve({ ok: true, value: { id: started.length } })
      },
      skillStatus: (): Promise<Wire<SkillStatus, SkillError>> =>
        Promise.resolve(
          options.refuseStatus === undefined ? { ok: true, value: skill } : { ok: false, error: options.refuseStatus },
        ),
      /**
       * The guard is real here too: the digest the sheet sends must be the one
       * this fake is holding, exactly as `main/skill.ts` checks it. A fake that
       * ignored it would let a sheet with a stale digest pass every test.
       */
      installSkill: (baseSha): Promise<Wire<SkillInstalled, SkillError>> => {
        installs.push(baseSha)
        if (refuseInstall !== undefined) {
          const error = refuseInstall
          refuseInstall = undefined
          // A refusal moves the copy the sheet is looking at, exactly as a real
          // conflict does — otherwise the retry would carry the same digest.
          if (error.kind === 'conflict') skill = { ...skill, state: 'differs', sha: error.currentSha }
          return Promise.resolve({ ok: false, error })
        }
        if (baseSha !== skill.sha) {
          return Promise.resolve({ ok: false, error: { kind: 'conflict', currentSha: skill.sha } })
        }
        const fresh = skill.state === 'absent'
        skill = { state: 'current', sha: 'sha:installed', files: skill.files }
        return Promise.resolve({ ok: true, value: { files: skill.files, fresh } })
      },
      getSettings: (): Promise<Settings> => Promise.resolve(settings),
      setSettings: (next): Promise<Wire<Settings, SettingsError>> => {
        if (options.refuseSettings !== undefined) {
          return Promise.resolve({ ok: false, error: options.refuseSettings })
        }
        saved.push(next)
        settings = next
        // Main broadcasts to every window on a successful write, so the fake
        // does too — a sheet that only updated its own state would pass a test
        // the app fails.
        for (const listener of [...settingsListeners]) listener(next)
        return Promise.resolve({ ok: true, value: next })
      },
      onSettings: (listener): (() => void) => {
        settingsListeners.add(listener)
        return (): boolean => settingsListeners.delete(listener)
      },
      writePty: (input): Promise<void> => {
        typed.push(input.data)
        return Promise.resolve()
      },
      resizePty: () => Promise.resolve(),
      killPty: (input): Promise<void> => {
        live.delete(input.id)
        return Promise.resolve()
      },
      onPtyEvent: (listener) => {
        ptys.add(listener)
        return () => ptys.delete(listener)
      },
      onProjectEvent: (listener) => {
        events.add(listener)
        return () => events.delete(listener)
      },
      onCommand: (listener) => {
        commands.add(listener)
        return () => commands.delete(listener)
      },
    },
  }
}
