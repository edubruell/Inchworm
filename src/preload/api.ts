/**
 * The renderer's whole view of main: one function per channel, each an
 * `ipc.invoke` and a cast, plus the event subscriptions main pushes into.
 *
 * Written as a factory over a structural `ipc` so it can be tested without
 * Electron — the bridge is the piece that must not be exercised only by hand.
 */

import type {
  Command,
  KillPtyInput,
  PtyError,
  PtyEvent,
  ResizePtyInput,
  StartPtyInput,
  WritePtyInput,
  DebtError,
  DebtReport,
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
  WikiApi,
  WriteFileInput,
  Wire,
} from '@shared/api.js'
import { CHANNEL, EVENT } from '@shared/api.js'

/**
 * The one thing a dropped `File` no longer tells the renderer: where it is.
 * `File.path` was removed in Electron 32, so the real path comes from
 * `webUtils.getPathForFile`, which only exists on this side of the bridge.
 *
 * It is *not* a hole in the filesystem rule: it returns a string and reads
 * nothing. Every read and write still goes through main's allow-list — the
 * renderer does not open the file, it types its name into a shell.
 */
export type PathForFile = (file: File) => string

/** The slice of `ipcRenderer` the bridge needs — structural, so it is testable. */
export type IpcInvokeLike = {
  readonly invoke: (channel: string, payload?: unknown) => Promise<unknown>
  readonly on: (channel: string, listener: (event: unknown, payload: unknown) => void) => void
  readonly off: (channel: string, listener: (event: unknown, payload: unknown) => void) => void
}

/**
 * The entire privileged surface of the renderer. One thin async function per
 * channel and no logic — every decision belongs in main or core.
 *
 * The responses are cast, not parsed. Validation lives in main, where the
 * untrusted side of the boundary is: a sandboxed preload cannot `require` an
 * externalised dependency, so re-parsing here would mean bundling zod into the
 * bridge against a threat model in which main is already trusted.
 */
export const createApi = (ipc: IpcInvokeLike, pathForFile: PathForFile): WikiApi => ({
  // Synchronous, and the only member that is: it is a lookup on an object the
  // drop event already handed over, and a drop has nothing to await. It is not
  // a `CHANNEL` at all — and the allow-list is named rather than counted, since
  // a comment that tallies the members is a comment that rots on the next one.
  pathForFile: (file: File): string => pathForFile(file),

  chooseProject: (): Promise<string | undefined> => ipc.invoke(CHANNEL.chooseProject) as Promise<string | undefined>,

  openProject: (dir: string): Promise<Wire<ProjectSummary, OpenProjectError>> =>
    ipc.invoke(CHANNEL.openProject, { dir }) as Promise<Wire<ProjectSummary, OpenProjectError>>,

  listProjects: (): Promise<readonly ProjectSummary[]> =>
    ipc.invoke(CHANNEL.listProjects) as Promise<readonly ProjectSummary[]>,

  currentProject: (): Promise<ProjectSnapshot | undefined> =>
    ipc.invoke(CHANNEL.currentProject) as Promise<ProjectSnapshot | undefined>,

  setAccent: async (hue: number): Promise<void> => {
    await ipc.invoke(CHANNEL.setAccent, { hue })
  },

  readFile: (path: string): Promise<Wire<FileContent, FileError>> =>
    ipc.invoke(CHANNEL.readFile, { path }) as Promise<Wire<FileContent, FileError>>,

  writeFile: (input: WriteFileInput): Promise<Wire<FileStamp, FileError>> =>
    ipc.invoke(CHANNEL.writeFile, input) as Promise<Wire<FileStamp, FileError>>,

  openExternal: async (url: string): Promise<void> => {
    await ipc.invoke(CHANNEL.openExternal, { url })
  },

  startPty: (input: StartPtyInput): Promise<Wire<{ readonly id: number }, PtyError>> =>
    ipc.invoke(CHANNEL.startPty, input) as Promise<Wire<{ readonly id: number }, PtyError>>,

  writePty: async (input: WritePtyInput): Promise<void> => {
    await ipc.invoke(CHANNEL.writePty, input)
  },

  resizePty: async (input: ResizePtyInput): Promise<void> => {
    await ipc.invoke(CHANNEL.resizePty, input)
  },

  killPty: async (input: KillPtyInput): Promise<void> => {
    await ipc.invoke(CHANNEL.killPty, input)
  },

  /**
   * The listener is wrapped so the renderer never touches the Electron event
   * object, and the unsubscribe is returned rather than exposed as a second
   * call: a window that reloads must not leave a listener behind on the channel.
   */
  onProjectEvent: (listener: (event: ProjectEvent) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: unknown): void => {
      listener(payload as ProjectEvent)
    }
    ipc.on(EVENT.projectEvent, wrapped)
    return (): void => {
      ipc.off(EVENT.projectEvent, wrapped)
    }
  },

  onPtyEvent: (listener: (event: PtyEvent) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: unknown): void => {
      listener(payload as PtyEvent)
    }
    ipc.on(EVENT.pty, wrapped)
    return (): void => {
      ipc.off(EVENT.pty, wrapped)
    }
  },

  getSettings: (): Promise<Settings> => ipc.invoke(CHANNEL.getSettings) as Promise<Settings>,

  setSettings: (settings: Settings): Promise<Wire<Settings, SettingsError>> =>
    ipc.invoke(CHANNEL.setSettings, settings) as Promise<Wire<Settings, SettingsError>>,

  skillStatus: (): Promise<Wire<SkillStatus, SkillError>> =>
    ipc.invoke(CHANNEL.skillStatus) as Promise<Wire<SkillStatus, SkillError>>,

  readDebt: (): Promise<Wire<DebtReport, DebtError>> =>
    ipc.invoke(CHANNEL.readDebt) as Promise<Wire<DebtReport, DebtError>>,

  installSkill: (baseSha: string): Promise<Wire<SkillInstalled, SkillError>> =>
    ipc.invoke(CHANNEL.installSkill, { baseSha }) as Promise<Wire<SkillInstalled, SkillError>>,

  onSettings: (listener: (settings: Settings) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: unknown): void => {
      listener(payload as Settings)
    }
    ipc.on(EVENT.settings, wrapped)
    return (): void => {
      ipc.off(EVENT.settings, wrapped)
    }
  },

  onCommand: (listener: (command: Command) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: unknown): void => {
      listener(payload as Command)
    }
    ipc.on(EVENT.command, wrapped)
    return (): void => {
      ipc.off(EVENT.command, wrapped)
    }
  },
})
