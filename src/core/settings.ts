/**
 * App settings: the preferences that are the *user's*, not a project's.
 *
 * There is exactly one of these in the app, and its first tenant is the list of
 * **agent launchers**. `claude` was hard-coded into the terminal presets, which
 * made "the agent" mean one program; the app's subject is an agent that writes
 * a wiki, and which agent that is belongs to the reader. A project's *paths*
 * are still never configured here — those come from the agent file, always.
 *
 * `core` owns the shape and the repair, and nothing else: main persists it,
 * main turns a launcher into an argv, and the renderer only ever names one by
 * id. A settings file the renderer could turn into a command line would be the
 * sandbox undone.
 */

import type { Result } from './result.js'
import { err, ok } from './result.js'
import { isTagName } from './templates.js'

/**
 * One way to start an agent. `command` is a shell command line rather than an
 * argv because that is what the reader knows how to write — `claude`,
 * `codex --model o3`, `pi chat` — and because the preset shells already run
 * through a login shell for `PATH`.
 */
export type Launcher = {
  /** Stable across renames; what the renderer names and the wire carries. */
  readonly id: string
  readonly label: string
  readonly command: string
}

export type Settings = {
  readonly launchers: readonly Launcher[]
  /** The id the `+ agent` button starts, and the one the bootstrap sheet runs. */
  readonly defaultLauncherId: string
  /**
   * The reader's own name, as the tag ⌘E wraps around a note to the agent:
   * `<eddy>…</eddy>`. A setting because it is *whose* note it is, and there is
   * exactly one reader per machine.
   */
  readonly noteTag: string
}

/**
 * What a machine with no settings file gets: the agent this app was written
 * beside. It is an ordinary row — deletable, renameable, and not privileged in
 * any way the others are not.
 */
export const DEFAULT_SETTINGS: Settings = {
  launchers: [{ id: 'claude', label: 'claude', command: 'claude' }],
  defaultLauncherId: 'claude',
  // Not a name, because the app does not know one: `note` is what an unnamed
  // reader's note is, and the sheet is where it becomes theirs.
  noteTag: 'note',
}

/** Ceilings, so a hand-edited file cannot make a menu unusable. */
export const MAX_LAUNCHERS = 8
export const MAX_LABEL = 40
export const MAX_COMMAND = 200

export type SettingsError =
  | { readonly kind: 'no-launchers' }
  | { readonly kind: 'too-many-launchers' }
  | { readonly kind: 'empty-field'; readonly field: 'label' | 'command' }
  | { readonly kind: 'too-long'; readonly field: 'label' | 'command' }
  | { readonly kind: 'duplicate-id' }
  /** A tag name the app would have to write into a file and could not. */
  | { readonly kind: 'bad-tag' }

/** The first thing wrong with one row, or nothing. */
const rowError = (launcher: Launcher): SettingsError | undefined => {
  if (launcher.label.trim() === '') return { kind: 'empty-field', field: 'label' }
  if (launcher.command.trim() === '') return { kind: 'empty-field', field: 'command' }
  if (launcher.label.length > MAX_LABEL) return { kind: 'too-long', field: 'label' }
  if (launcher.command.length > MAX_COMMAND) return { kind: 'too-long', field: 'command' }
  return undefined
}

/** The first thing wrong with the list as a whole, or nothing. */
const listError = (launchers: readonly Launcher[]): SettingsError | undefined => {
  if (launchers.length === 0) return { kind: 'no-launchers' }
  if (launchers.length > MAX_LAUNCHERS) return { kind: 'too-many-launchers' }
  const broken = launchers.map(rowError).find((error) => error !== undefined)
  if (broken !== undefined) return broken
  return new Set(launchers.map((launcher) => launcher.id)).size === launchers.length
    ? undefined
    : { kind: 'duplicate-id' }
}

/**
 * Settings the app will act on, or the first reason it will not.
 *
 * A `Result` rather than a repair, because this runs on the way *in* from the
 * settings sheet: a reader who left a command blank is told, rather than having
 * an empty row silently dropped and wondering where it went. Repair is the
 * store's job, on the way out of a file nobody typed today.
 */
export const validateSettings = (settings: Settings): Result<Settings, SettingsError> => {
  const { launchers } = settings
  const wrong = listError(launchers) ?? (isTagName(settings.noteTag) ? undefined : { kind: 'bad-tag' })
  if (wrong !== undefined) return err(wrong)

  const ids = new Set(launchers.map((launcher) => launcher.id))

  // A default naming a launcher that is not there is not an error the reader
  // has to fix: deleting the default row is an ordinary thing to do, and the
  // first row is what the menu would show first anyway.
  const defaultLauncherId = ids.has(settings.defaultLauncherId)
    ? settings.defaultLauncherId
    : (launchers[0]?.id ?? DEFAULT_SETTINGS.defaultLauncherId)

  return ok({ launchers, defaultLauncherId, noteTag: settings.noteTag })
}

/**
 * Settings that came from a file rather than from the sheet: anything unusable
 * is *dropped* and what remains is kept, because refusing to start over a bad
 * row would cost the reader every other row (the project store's rule).
 */
export const repairSettings = (settings: Settings): Settings => {
  const seen = new Set<string>()
  const launchers = settings.launchers
    .filter((launcher) => {
      const usable = launcher.id.trim() !== '' && rowError(launcher) === undefined && !seen.has(launcher.id)
      seen.add(launcher.id)
      return usable
    })
    .slice(0, MAX_LAUNCHERS)

  if (launchers.length === 0) return DEFAULT_SETTINGS
  const repaired = validateSettings({
    launchers,
    defaultLauncherId: settings.defaultLauncherId,
    // A hand-edited tag that is not a tag is dropped like a broken row: the
    // default is a usable note, and refusing to start over it is not an option.
    noteTag: isTagName(settings.noteTag) ? settings.noteTag : DEFAULT_SETTINGS.noteTag,
  })
  return repaired.ok ? repaired.value : DEFAULT_SETTINGS
}

/** The launcher a renderer named, or the default; never `undefined`. */
export const launcherFor = (settings: Settings, id: string | undefined): Launcher | undefined =>
  settings.launchers.find((launcher) => launcher.id === id) ??
  settings.launchers.find((launcher) => launcher.id === settings.defaultLauncherId) ??
  settings.launchers[0]

/**
 * An id for a new row that no existing row has. Not a uuid: settings are a
 * short list a person reads, and `codex-2` is a better thing to find in a JSON
 * file than a 36-character hex string.
 */
export const freeLauncherId = (settings: Settings, label: string): string => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const stem = base === '' ? 'agent' : base
  const taken = new Set(settings.launchers.map((launcher) => launcher.id))
  if (!taken.has(stem)) return stem
  for (let n = 2; n < MAX_LAUNCHERS + 2; n += 1) {
    const candidate = `${stem}-${String(n)}`
    if (!taken.has(candidate)) return candidate
  }
  return `${stem}-${String(taken.size + 1)}`
}
