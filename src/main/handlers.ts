/**
 * The privileged surface, in one file: every channel main answers, registered
 * here and nowhere else so the allow-list can be read — and asserted — as a
 * list. Nothing below imports Electron; the effects are injected, which is what
 * lets the containment rules be tested without a window.
 */

import { basename } from 'node:path'
import { hueForPath, isPaletteHue } from '@core/hue.js'
import { externalUrl } from '@core/url.js'
import { launcherFor, validateSettings } from '@core/settings.js'
import { err, ok } from '@core/result.js'
import type {
  DebtError,
  DebtReport,
  PtyError,
  FileContent,
  FileError,
  FileStamp,
  OpenProjectError,
  ProjectEvent,
  ProjectSnapshot,
  ProjectSummary,
  Settings,
  SettingsError,
  SkillError,
  SkillInstalled,
  SkillStatus,
  Wire,
} from '@shared/api.js'
import { CHANNEL } from '@shared/api.js'
import {
  installSkillInput,
  killPtyInput,
  openExternalInput,
  openProjectInput,
  readFileInput,
  resizePtyInput,
  setAccentInput,
  settingsInput,
  startPtyInput,
  writeFileInput,
  writePtyInput,
} from '@shared/schema.js'
import { listWikiFiles, readWikiFile, writeWikiFile } from './files.js'
import type { DebtHost } from './debt.js'
import { loadProject, type OpenProject } from './project.js'
import type { PtyHost } from './pty.js'
import type { ProjectStore } from './projectStore.js'
import type { SettingsStore } from './settingsStore.js'
import type { SkillHost } from './skill.js'
import type { Registry } from './registry.js'

/** The slice of an IPC event this module needs — structural, so tests need no Electron. */
export type IpcEventLike = { readonly sender: unknown }

/** The slice of `ipcMain` this module needs. */
export type IpcHandleLike = {
  readonly handle: (channel: string, listener: (event: IpcEventLike, payload: unknown) => unknown) => void
}

/**
 * Everything privileged the handlers may do, as injected functions. Electron
 * itself never appears below, which is what makes the whole surface — including
 * the refcount and the containment checks — testable in plain node.
 */
export type HandlerDeps = {
  readonly store: ProjectStore
  readonly registry: Registry
  /** The window an IPC message came from; `undefined` if it has already gone. */
  readonly windowIdOf: (event: IpcEventLike) => number | undefined
  readonly chooseDirectory: () => Promise<string | undefined>
  readonly openWindow: (project: OpenProject) => void
  readonly broadcast: (dir: string, event: ProjectEvent) => void
  /** Hands a vetted `http(s)` URL to the OS. */
  readonly openExternal: (url: string) => Promise<void>
  readonly ptys: PtyHost
  readonly settings: SettingsStore
  /** Settings reach *every* window: the launcher menu is in all of them. */
  readonly broadcastSettings: (settings: Settings) => void
  /** The bundled `/llmwiki` skill and the two scopes it installs into. */
  readonly skill: SkillHost
  /** The bundled checkers, and the only programs the app runs on its own. */
  readonly debt: DebtHost
  readonly now: () => number
}

/**
 * A window always has a hue and a name, even in the window between a project
 * being opened and the store having heard about it: the fallbacks are the same
 * ones a first open would assign.
 */
const snapshot = async (store: ProjectStore, project: OpenProject): Promise<ProjectSnapshot> => {
  const known = store.find(project.dir)
  return {
    dir: project.dir,
    name: known?.name ?? basename(project.dir),
    hue: known?.hue ?? hueForPath(project.dir),
    layout: project.layout,
    files: await listWikiFiles(project.dir, project.layout),
  }
}

/**
 * Registers the entire privileged surface. Every channel the app answers is
 * registered here and nowhere else, so the allow-list is enumerable — and
 * therefore assertable.
 *
 * Two rules run through all of it. **The renderer never names its project:**
 * every file operation is scoped by the project bound to the *sending window*,
 * so a renderer cannot reach a project it was not opened on. And **every
 * payload is parsed** before it is used, because the renderer is the untrusted
 * side of this boundary.
 */
export const registerHandlers = (ipc: IpcHandleLike, deps: HandlerDeps): void => {
  const projectOf = (event: IpcEventLike): OpenProject | undefined => {
    const id = deps.windowIdOf(event)
    return id === undefined ? undefined : deps.registry.projectFor(id)
  }

  ipc.handle(CHANNEL.chooseProject, (): Promise<string | undefined> => deps.chooseDirectory())

  ipc.handle(CHANNEL.openProject, async (event, payload): Promise<Wire<ProjectSummary, OpenProjectError>> => {
    const input = openProjectInput.safeParse(payload)
    if (!input.success) return err({ kind: 'bad-request' })

    const project = await loadProject(input.data.dir)
    if (!project.ok) {
      // A refusal is not the end of the story: the picker offers to start an
      // agent in that folder, and this is where main learns which folder that
      // is — from its own `loadProject` call, never from the renderer.
      const id = deps.windowIdOf(event)
      if (id !== undefined) deps.registry.rememberPending(id, input.data.dir)
      return project
    }

    // Persist before the window exists: the window needs the hue to paint, and
    // a first open is what assigns it.
    const summary = await deps.store.remember(project.value.dir, deps.now())
    deps.openWindow(project.value)
    return ok(summary)
  })

  ipc.handle(CHANNEL.listProjects, (): readonly ProjectSummary[] => deps.store.list())

  ipc.handle(CHANNEL.currentProject, async (event): Promise<ProjectSnapshot | undefined> => {
    const project = projectOf(event)
    return project === undefined ? undefined : snapshot(deps.store, project)
  })

  ipc.handle(CHANNEL.setAccent, async (event, payload): Promise<void> => {
    const input = setAccentInput.safeParse(payload)
    const project = projectOf(event)
    // A hue off the palette is refused rather than clamped: the ramp is defined
    // for the seven values in PALETTE and "nearly one of them" is not one of them.
    if (!input.success || project === undefined || !isPaletteHue(input.data.hue)) return
    await deps.store.setHue(project.dir, input.data.hue)
    // Every window on the project, not just the sender: answering only the
    // sender leaves the other windows showing a colour nothing has any more.
    deps.broadcast(project.dir, { kind: 'accent', dir: project.dir, hue: input.data.hue })
  })

  ipc.handle(CHANNEL.readFile, async (event, payload): Promise<Wire<FileContent, FileError>> => {
    const input = readFileInput.safeParse(payload)
    if (!input.success) return err({ kind: 'bad-request' })
    const project = projectOf(event)
    return project === undefined ? err({ kind: 'no-project' }) : readWikiFile(project.dir, project.layout, input.data.path)
  })

  /**
   * A web link in a note leaves the app through the OS, never through the
   * window. The scheme allow-list is `core.externalUrl`'s, and it returns the
   * *parsed* href: the URL parser strips control characters, so opening the raw
   * string would open something the check never saw.
   */
  ipc.handle(CHANNEL.openExternal, async (_event, payload): Promise<void> => {
    const input = openExternalInput.safeParse(payload)
    if (!input.success) return
    const url = externalUrl(input.data.url)
    if (url !== undefined) await deps.openExternal(url)
  })

  /**
   * The terminal. Every one of these is scoped twice: by the project bound to
   * the sending window, and — inside `PtyHost` — by that window's ownership of
   * the pane id. A window may not type into another window's shell.
   */
  ipc.handle(CHANNEL.startPty, (event, payload): Wire<{ readonly id: number }, PtyError> => {
    const input = startPtyInput.safeParse(payload)
    if (!input.success) return err({ kind: 'bad-request' })
    const id = deps.windowIdOf(event)
    if (id === undefined) return err({ kind: 'no-project' })
    // A window with no project may still have a folder it just failed to open:
    // that is the bootstrap sheet, running an agent where the wiki will be.
    const cwd = deps.registry.projectFor(id)?.dir ?? deps.registry.pendingFor(id)
    if (cwd === undefined) return err({ kind: 'no-project' })
    // The id names a row in settings; the *command* is looked up here, so
    // nothing the renderer sent becomes an argv.
    const launcher = launcherFor(deps.settings.get(), input.data.launcherId)
    if (launcher === undefined) return err({ kind: 'no-launcher' })
    return deps.ptys.start(id, cwd, { ...input.data, agentCommand: launcher.command })
  })

  ipc.handle(CHANNEL.getSettings, (): Settings => deps.settings.get())

  /**
   * The one write the renderer may make that is not a file: the shape is
   * `shared/schema`'s and the meaning is `core.validateSettings`'s, and only
   * something that passes both is persisted. A refusal writes nothing and comes
   * back as the reason, so the sheet can say which row is wrong.
   */
  ipc.handle(CHANNEL.setSettings, async (_event, payload): Promise<Wire<Settings, SettingsError>> => {
    const input = settingsInput.safeParse(payload)
    if (!input.success) return err({ kind: 'bad-request' })
    const checked = validateSettings(input.data)
    if (!checked.ok) return checked
    const saved = await deps.settings.set(checked.value)
    deps.broadcastSettings(saved)
    return ok(saved)
  })

  /**
   * The skill. Not project-scoped and not window-scoped: there is one
   * `~/.claude` per machine, so these two are the app speaking for itself. The
   * install carries the digest the sheet was shown and is refused if the copy
   * has moved since — the sha guard's shape, over a directory.
   */
  ipc.handle(CHANNEL.skillStatus, (): Promise<Wire<SkillStatus, SkillError>> => deps.skill.status())

  /**
   * What has landed in this window's project and never been written up. Scoped
   * by the sending window like every other project read, and it takes no
   * payload at all: there is nothing for a renderer to name here, which is the
   * cheapest possible form of "the app runs only what it ships".
   */
  ipc.handle(CHANNEL.readDebt, async (event): Promise<Wire<DebtReport, DebtError>> => {
    const project = projectOf(event)
    if (project === undefined) return err({ kind: 'no-project' })
    return deps.debt.read(project.dir, await listWikiFiles(project.dir, project.layout))
  })

  ipc.handle(CHANNEL.installSkill, async (_event, payload): Promise<Wire<SkillInstalled, SkillError>> => {
    const input = installSkillInput.safeParse(payload)
    return input.success ? deps.skill.install(input.data.baseSha) : err({ kind: 'bad-request' })
  })

  ipc.handle(CHANNEL.writePty, (event, payload): void => {
    const input = writePtyInput.safeParse(payload)
    const id = deps.windowIdOf(event)
    if (input.success && id !== undefined) deps.ptys.write(id, input.data.id, input.data.data)
  })

  ipc.handle(CHANNEL.resizePty, (event, payload): void => {
    const input = resizePtyInput.safeParse(payload)
    const id = deps.windowIdOf(event)
    if (input.success && id !== undefined) deps.ptys.resize(id, input.data.id, input.data.cols, input.data.rows)
  })

  ipc.handle(CHANNEL.killPty, (event, payload): void => {
    const input = killPtyInput.safeParse(payload)
    const id = deps.windowIdOf(event)
    if (input.success && id !== undefined) deps.ptys.kill(id, input.data.id)
  })

  ipc.handle(CHANNEL.writeFile, async (event, payload): Promise<Wire<FileStamp, FileError>> => {
    const input = writeFileInput.safeParse(payload)
    if (!input.success) return err({ kind: 'bad-request' })
    const project = projectOf(event)
    return project === undefined ? err({ kind: 'no-project' }) : writeWikiFile(project.dir, project.layout, input.data)
  })
}

/**
 * Turns a watcher change into the event every window on that project receives.
 * A file that appeared or vanished costs one directory walk; a file that
 * changed costs nothing but the message.
 */
export const projectEventFor = async (
  project: OpenProject,
  change: { readonly kind: 'files' } | { readonly kind: 'file'; readonly path: string },
): Promise<ProjectEvent> =>
  change.kind === 'file'
    ? { kind: 'file', dir: project.dir, path: change.path }
    : { kind: 'files', dir: project.dir, files: await listWikiFiles(project.dir, project.layout) }
