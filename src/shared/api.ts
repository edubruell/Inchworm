/**
 * The contract between main and renderer. Both sides import it, neither owns
 * it — this is what lets the renderer stay ignorant of Electron and the layer
 * rule stay enforceable.
 *
 * **Inputs are validated; outputs are typed.** Every payload crossing into main
 * is `safeParse`d there against `shared/schema.ts`, because the renderer is the
 * untrusted side of this boundary — a compromised renderer must not be able to
 * hand main a path. Responses travel the other way, from the process that
 * typechecks its own returns, and are not re-parsed: a sandboxed preload cannot
 * `require` an externalised dependency, so parsing there would mean bundling
 * zod into the bridge against a threat it does not address.
 *
 * `shared` may import nothing first-party (the layer rule), so every shape that
 * also exists in `core` — the project layout, `Result`, the settings, the debt
 * record, each marked `Structurally core.X` where it stands — is restated here
 * structurally. TypeScript matches them by shape, so `core.parseClaudeBlock`
 * output flows into `ProjectSnapshot.layout` with no adapter.
 */

/**
 * The channel allow-list. Main registers exactly these and the preload calls
 * exactly these; a renamed string is a compile error rather than an `invoke`
 * that hangs forever.
 */
export const CHANNEL = {
  chooseProject: 'project:choose',
  openProject: 'project:open',
  listProjects: 'project:list',
  currentProject: 'project:current',
  setAccent: 'project:accent',
  readFile: 'file:read',
  writeFile: 'file:write',
  openExternal: 'shell:openExternal',
  startPty: 'pty:start',
  writePty: 'pty:write',
  resizePty: 'pty:resize',
  killPty: 'pty:kill',
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  skillStatus: 'skill:status',
  installSkill: 'skill:install',
  readDebt: 'debt:read',
} as const

export type Channel = (typeof CHANNEL)[keyof typeof CHANNEL]

/**
 * main → renderer only. It is a separate constant, not one more `CHANNEL`, so
 * "main registers exactly the channels" stays an assertion over a whole object
 * rather than one with a hand-maintained exception in it.
 */
export const EVENT = {
  /** Broadcast to every window on the project. */
  projectEvent: 'project:event',
  /** A menu item or accelerator fired; sent to the one window it targets. */
  command: 'app:command',
  /**
   * Terminal output. Sent to the **owning window only** — a pane belongs to a
   * window, not to a project, so this is the one main → renderer stream that
   * is deliberately not a broadcast.
   */
  pty: 'pty:event',
  /**
   * Settings changed. Broadcast to **every** window: the launcher menu is in
   * all of them, and a window still offering a deleted agent is a window that
   * spawns the wrong thing.
   */
  settings: 'settings:event',
} as const

/** Structurally `core.Result<T, E>`; see the note at the top of this file. */
export type Wire<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

// ---------------------------------------------------------------- inputs

/**
 * The payload shapes. They are declared here as plain types and given their
 * zod schemas in `shared/schema.ts`, which main imports and the preload must
 * not: a sandboxed preload cannot `require` an externalised dependency, so a
 * single file carrying both would take zod into the bridge and the preload
 * would fail to load.
 */
export type OpenProjectInput = { readonly dir: string }
export type SetAccentInput = { readonly hue: number }
export type ReadFileInput = { readonly path: string }
export type OpenExternalInput = { readonly url: string }
/** The digest the sheet was shown; the install refuses if the copy has moved since. */
export type InstallSkillInput = { readonly baseSha: string }

/**
 * The two kinds of pane: the agent, and a plain shell. The commands themselves
 * live in main — nothing the renderer says ever becomes an argv. There is
 * deliberately no third preset for a project's build command: a dev loop is one
 * line typed into the shell pane, and hard-coding one project's command into an
 * app that opens ten is wrong in the same way a hard-coded `claude` was.
 */
export const PRESETS = ['agent', 'shell'] as const
export type Preset = (typeof PRESETS)[number]

export type StartPtyInput = {
  readonly preset: Preset
  readonly cols: number
  readonly rows: number
  /**
   * Which agent, for the `agent` preset. An **id from settings**, never a
   * command: main looks it up and builds the argv, so the rule that nothing the
   * renderer says becomes an argv survives the launchers being configurable.
   * Absent means the default launcher.
   */
  readonly launcherId?: string | undefined
}
export type WritePtyInput = { readonly id: number; readonly data: string }
export type ResizePtyInput = { readonly id: number; readonly cols: number; readonly rows: number }
export type KillPtyInput = { readonly id: number }
export type WriteFileInput = {
  readonly path: string
  readonly text: string
  /** The sha the editor started from; `''` means "this file must not exist yet". */
  readonly baseSha: string
}

// ---------------------------------------------------------------- outputs

/** Structurally `core.ProjectLayout`; see the note at the top of this file. */
export type Layout = {
  readonly wikiRoot: string
  readonly journal: string
  readonly kind: 'research' | 'software'
}

export type ProjectSummary = {
  readonly dir: string
  readonly name: string
  readonly hue: number
  readonly lastOpenedMs: number
}

/** Everything a window needs to draw itself, fetched once on mount. */
export type ProjectSnapshot = {
  readonly dir: string
  readonly name: string
  readonly hue: number
  readonly layout: Layout
  /** Project-relative posix paths under the wiki root and journal, plus CLAUDE.md. */
  readonly files: readonly string[]
}

/**
 * Structurally `core.Launcher` / `core.Settings`; see the note at the top of
 * this file. The app's own preferences — never a project's paths, which come
 * from the agent file and nowhere else.
 */
export type Launcher = {
  readonly id: string
  readonly label: string
  readonly command: string
}

export type Settings = {
  readonly launchers: readonly Launcher[]
  readonly defaultLauncherId: string
  /** The reader's tag for notes to the agent: `<eddy>…</eddy>` (⌘E). */
  readonly noteTag: string
}

/**
 * The `/llmwiki` skill as the app found it under `~/.claude`. Structurally
 * `core.SkillState` plus the two digests the guard compares.
 */
export type SkillStatus = {
  readonly state: 'absent' | 'current' | 'differs'
  /** The installed copy's digest; `''` when nothing of the skill is there. */
  readonly sha: string
  /** How many files an install would write. */
  readonly files: number
}

export type SkillInstalled = {
  readonly files: number
  /** The skill directory did not exist: Claude Code will not see it until a restart. */
  readonly fresh: boolean
}

export type SkillError =
  | { readonly kind: 'bad-request' }
  /** This build carries no skill to install — a packaging failure, not a user error. */
  | { readonly kind: 'no-bundle'; readonly detail: string }
  /** The installed copy changed since the sheet read it; nothing was written. */
  | { readonly kind: 'conflict'; readonly currentSha: string }
  /**
   * The installed copy could not be *read* — a scope owned by another user, a
   * target that is a directory. Distinct from absent on purpose: a copy the app
   * cannot look at must not be reported as one that is not there, or the guard
   * compares two digests that both mean "I could not look".
   */
  | { readonly kind: 'unreadable'; readonly detail: string }
  | { readonly kind: 'unwritable'; readonly detail: string }

/**
 * Structurally `core.DebtItem`; see the note at the top of this file. What the
 * sidebar's debt section draws: one row per thing that landed and was never
 * written up.
 */
export type DebtKind = 'unstamped' | 'unswept' | 'unfiled' | 'unlinked'

export type DebtItem = {
  readonly kind: DebtKind
  readonly label: string
  readonly detail: string
  /** Project-relative, and absent when the row names something the app cannot open. */
  readonly path?: string | undefined
}

export type DebtReport = {
  readonly items: readonly DebtItem[]
  /**
   * Checkers that could not answer, by name. A partial list is shown *as*
   * partial: a debt section that silently drops a checker reads as "clean",
   * which is the one thing it must never say falsely.
   */
  readonly failed: readonly string[]
  readonly checkedMs: number
}

export type DebtError =
  /** No project is bound to this window, so there is nothing to check. */
  | { readonly kind: 'no-project' }
  /** The checkers are python and there is no `python3` on PATH. */
  | { readonly kind: 'no-python' }
  /** This build carries no checkers — a packaging failure, not a user error. */
  | { readonly kind: 'no-bundle'; readonly detail: string }
  /**
   * The call itself never came back — a handler that threw, or a window whose
   * bridge has gone. Distinct from every other arm because it is the one the
   * *renderer* discovers: without it a rejected read leaves the last list on
   * screen with nothing saying it is stale.
   */
  | { readonly kind: 'unreachable' }

/** Structurally `core.SettingsError`. */
export type SettingsError =
  | { readonly kind: 'bad-request' }
  | { readonly kind: 'no-launchers' }
  | { readonly kind: 'too-many-launchers' }
  | { readonly kind: 'empty-field'; readonly field: 'label' | 'command' }
  | { readonly kind: 'too-long'; readonly field: 'label' | 'command' }
  | { readonly kind: 'duplicate-id' }
  | { readonly kind: 'bad-tag' }

/**
 * What a folder that is *not* a project turned out to have. The picker draws
 * this rather than a sentence, because "no CLAUDE.md" and "a CLAUDE.md with no
 * llmwiki block" need different next steps and the reader can only tell them
 * apart if the app says which it found.
 */
export type ProjectMarkers = {
  /** Present, by name, in preference order — `[]` when the folder has neither. */
  readonly agentFiles: readonly string[]
  /** A `local_context/wiki`-shaped directory, which a half-initialised repo has. */
  readonly wiki: boolean
}

export type OpenProjectError =
  /** The payload failed its zod parse — a renderer bug, or a renderer that is not ours. */
  | { readonly kind: 'bad-request' }
  | { readonly kind: 'not-a-directory' }
  /**
   * One refusal with the evidence attached, rather than two kinds that each
   * told the reader half of it. `detail` is the parse failure when an agent
   * file *was* found and did not carry a usable block.
   */
  | {
      readonly kind: 'no-llmwiki'
      readonly dir: string
      readonly markers: ProjectMarkers
      readonly detail?: string | undefined
    }

export type FileError =
  | { readonly kind: 'bad-request' }
  /** The path resolved outside the project root — a traversal or a symlink out. */
  | { readonly kind: 'outside-project' }
  | { readonly kind: 'not-found' }
  /** Over `MAX_FILE_BYTES` — too big to move across the bridge at all. */
  | { readonly kind: 'too-large'; readonly bytes: number }
  | { readonly kind: 'unreadable'; readonly detail: string }
  /** The file changed under the editor; the renderer shows a banner and never merges. */
  | { readonly kind: 'conflict'; readonly currentSha: string }
  /** No project is bound to this window, so there is no root to resolve against. */
  | { readonly kind: 'no-project' }

/**
 * A memory and IPC ceiling, and **not** a parse guard: a 2 MB file can take
 * ~34 s to parse, and bytes predict parse time only to within a factor of 15,
 * because cost follows a file's *shape*. Parse cost is bounded by `core`'s
 * `PARSE_BUDGET` instead, which reads the shape. A file between the two limits
 * is read and shown as raw text.
 */
export const MAX_FILE_BYTES = 2_000_000

export type FileContent = {
  readonly path: string
  readonly text: string
  readonly sha: string
  readonly mtimeMs: number
}

export type FileStamp = {
  readonly sha: string
  readonly mtimeMs: number
}

/**
 * Project-scoped events, broadcast to **every** window on the project — a
 * handler that answers only `event.sender` desyncs the other windows silently.
 */
export type ProjectEvent =
  /** The file set changed (added or removed); `files` is the whole new list. */
  | { readonly kind: 'files'; readonly dir: string; readonly files: readonly string[] }
  /** One file's bytes changed on disk. */
  | { readonly kind: 'file'; readonly dir: string; readonly path: string }
  | { readonly kind: 'accent'; readonly dir: string; readonly hue: number }

export type PtyError =
  | { readonly kind: 'bad-request' }
  | { readonly kind: 'no-project' }
  /** This window already holds as many panes as it may. */
  | { readonly kind: 'too-many' }
  /** Settings hold no launcher to run — only reachable with a hand-edited file. */
  | { readonly kind: 'no-launcher' }
  | { readonly kind: 'spawn-failed'; readonly detail: string }

/** Output and death, for one pane of the window that owns it. */
export type PtyEvent =
  | { readonly kind: 'data'; readonly id: number; readonly data: string }
  | { readonly kind: 'exit'; readonly id: number; readonly code: number }

/**
 * The five sidebar sections, restated structurally from `core.Section` —
 * `shared` may import nothing first-party (see the note at the top).
 */
export type CommandSection = 'state' | 'notes' | 'registers' | 'journal' | 'archive'

/**
 * main → renderer: what a native menu item asks the window to do. The menu is
 * a main-process object and the views it drives are in the renderer, so the
 * accelerator crosses the bridge as data rather than as a synthesised key
 * event.
 */
export type Command =
  /** ⌘K — the file-jump palette. */
  | { readonly kind: 'palette' }
  /** ⌘⇧O — the project picker, as a sheet over this window. */
  | { readonly kind: 'projects' }
  /** ⌘1–5 — reveal a sidebar section and select its first file. */
  | { readonly kind: 'section'; readonly section: CommandSection }
  /** ⌘⌥← / ⌘⌥→ — through the notes this window has visited. */
  | { readonly kind: 'back' }
  | { readonly kind: 'forward' }
  /** ⌥⏎ — view ⇄ edit on the same pane, same scroll anchor. */
  | { readonly kind: 'edit' }
  /** ⌘S — write the draft, under the sha guard. */
  | { readonly kind: 'save' }
  /** ⌃` — the terminal drawer under the content pane. */
  | { readonly kind: 'terminal' }
  /** ⌘, — the settings sheet. Every window can open it; there is one of it. */
  | { readonly kind: 'settings' }
  /**
   * ⌘E — wrap the selection (or nothing) in the reader's note tag, in the
   * editor, with the caret left inside it.
   */
  | { readonly kind: 'tag' }

export type WikiApi = {
  /**
   * The real path of a file dropped on the window. Synchronous, and the only
   * member that is — a drop event has nothing to await, and this is a lookup
   * rather than a call into main. It reads nothing: the renderer still cannot
   * open a file, it can only learn the name to type into a shell.
   */
  readonly pathForFile: (file: File) => string
  /** Native folder picker; `undefined` when the user cancelled. */
  readonly chooseProject: () => Promise<string | undefined>
  /** Opens `dir` in a **new** window, whether or not another window has it open. */
  readonly openProject: (dir: string) => Promise<Wire<ProjectSummary, OpenProjectError>>
  readonly listProjects: () => Promise<readonly ProjectSummary[]>
  /** The project bound to *this* window; `undefined` in a window with none. */
  readonly currentProject: () => Promise<ProjectSnapshot | undefined>
  readonly setAccent: (hue: number) => Promise<void>
  readonly readFile: (path: string) => Promise<Wire<FileContent, FileError>>
  readonly writeFile: (input: WriteFileInput) => Promise<Wire<FileStamp, FileError>>
  /**
   * Hands a web link to the OS browser. The renderer must never navigate: a
   * window that follows a link stops being the app and starts being a page
   * with the privileged bridge still attached.
   */
  readonly openExternal: (url: string) => Promise<void>
  /**
   * Opens a pane in this window's project directory — or, in a window with no
   * project, in the folder this window last tried and failed to open, which is
   * how the bootstrap sheet runs an agent where the wiki is about to be. Both
   * directories are main's: the renderer names neither.
   */
  readonly startPty: (input: StartPtyInput) => Promise<Wire<{ readonly id: number }, PtyError>>
  readonly writePty: (input: WritePtyInput) => Promise<void>
  readonly resizePty: (input: ResizePtyInput) => Promise<void>
  readonly killPty: (input: KillPtyInput) => Promise<void>
  readonly getSettings: () => Promise<Settings>
  /** Refused settings come back as the first reason, and nothing is written. */
  readonly setSettings: (settings: Settings) => Promise<Wire<Settings, SettingsError>>
  /**
   * Runs this build's own checkers over the project bound to *this* window and
   * returns what they found. The renderer names neither the project nor the
   * scripts: main resolves both, and the only files it will ever spawn are the
   * ones in `core.CHECKERS`.
   */
  readonly readDebt: () => Promise<Wire<DebtReport, DebtError>>
  /** What is installed under `~/.claude`, compared with what this build carries. */
  readonly skillStatus: () => Promise<Wire<SkillStatus, SkillError>>
  /**
   * Writes the bundled skill over `~/.claude/skills/llmwiki/` and its hooks.
   * Guarded like a file save: `baseSha` is the digest the sheet was shown, and a
   * copy that moved since is refused rather than merged.
   */
  readonly installSkill: (baseSha: string) => Promise<Wire<SkillInstalled, SkillError>>
  /** Every window, not just the one that changed them. */
  readonly onSettings: (listener: (settings: Settings) => void) => () => void
  /** This window's panes only; unsubscribe the same way as the others. */
  readonly onPtyEvent: (listener: (event: PtyEvent) => void) => () => void
  /** Returns its own unsubscribe; the renderer owns the lifetime, not main. */
  readonly onProjectEvent: (listener: (event: ProjectEvent) => void) => () => void
  /** Menu commands aimed at *this* window; unsubscribe the same way. */
  readonly onCommand: (listener: (command: Command) => void) => () => void
}
