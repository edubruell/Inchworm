/**
 * The zod half of the contract: one schema per inbound message, and nothing
 * else. Main `safeParse`s every payload against these before it touches a
 * filesystem — the renderer is the untrusted side of this boundary.
 *
 * It is a **separate file from `api.ts` on purpose**. A sandboxed preload
 * cannot `require` an externalised dependency, so a preload that imports the
 * channel list out of a module that also imports zod fails to load with
 * `module not found: zod` and leaves an empty vibrancy window. Main imports
 * this file; the preload and the renderer never do.
 *
 * Each schema is declared as `z.ZodType<T>` over the type in `api.ts`, so a
 * schema and the contract type it validates cannot drift apart silently.
 */

import { z } from 'zod'
import type {
  KillPtyInput,
  Settings,
  OpenExternalInput,
  OpenProjectInput,
  InstallSkillInput,
  ReadFileInput,
  ResizePtyInput,
  SetAccentInput,
  StartPtyInput,
  WriteFileInput,
  WritePtyInput,
} from './api.js'
import { MAX_FILE_BYTES, PRESETS } from './api.js'

/**
 * A project-relative path, refused before it reaches the filesystem: no
 * absolute paths, no `..`, no backslashes (a Windows separator is a plain
 * character on macOS and would hide a traversal), no NUL. This is the first of
 * four containment checks — main resolves the path against the project root
 * and then re-checks the *real* path, because a symlink defeats string
 * arithmetic entirely.
 */
export const wikiPathSchema: z.ZodType<string> = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (p) =>
      !p.startsWith('/') && !p.startsWith('~') && !p.includes('\\') && !p.includes('\0') && !p.split('/').includes('..'),
    { message: 'not a project-relative path' },
  )

/** An absolute directory the user chose; existence is main's problem, not the schema's. */
export const projectDirSchema: z.ZodType<string> = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => p.startsWith('/'), { message: 'not an absolute path' })

/**
 * A hue in degrees. The palette lives in `core` and cannot be imported here
 * (the layer rule), so the schema bounds the number and main checks membership
 * with `core.isPaletteHue`.
 */
export const hueSchema: z.ZodType<number> = z.number().int().min(0).max(359)

export const openProjectInput: z.ZodType<OpenProjectInput> = z.object({ dir: projectDirSchema })
export const setAccentInput: z.ZodType<SetAccentInput> = z.object({ hue: hueSchema })
export const readFileInput: z.ZodType<ReadFileInput> = z.object({ path: wikiPathSchema })

/**
 * Bounded here, vetted in main: the scheme allow-list lives in `core.externalUrl`,
 * which the layer rule keeps out of this file. The length bound is all a schema
 * can honestly say about a URL.
 */
export const openExternalInput: z.ZodType<OpenExternalInput> = z.object({ url: z.string().min(1).max(2048) })
export const writeFileInput: z.ZodType<WriteFileInput> = z.object({
  path: wikiPathSchema,
  // A coarse ceiling on what may cross the bridge at all. The cap that decides
  // whether the file will be readable again is a BYTE count and lives in
  // `writeWikiFile`, which can answer `too-large` — refusing here would tell the
  // reader their save was malformed.
  text: z.string().max(MAX_FILE_BYTES),
  baseSha: z.string().max(64),
})

/**
 * The install guard's digest — main's own sha256 of the manifest `core.skillDigest`
 * builds, handed back exactly as it was received. `''` is the legitimate value
 * for "nothing was installed when the sheet last looked", so it is not `min(1)`.
 */
export const installSkillInput: z.ZodType<InstallSkillInput> = z.object({ baseSha: z.string().max(64) })

/**
 * A terminal geometry. Bounded on both ends: `ioctl` takes a `unsigned short`,
 * and a zero-column pane is a shell that reflows every line it prints.
 */
const dimension = z.number().int().min(1).max(1000)

/**
 * The preset is an enum, never a command line. What each one runs is main's
 * (`main/pty.ts`), so nothing the renderer sends can become an argv.
 */
export const startPtyInput: z.ZodType<StartPtyInput> = z.object({
  preset: z.enum(PRESETS),
  cols: dimension,
  rows: dimension,
  // An id out of settings, bounded like any other opaque string. Main resolves
  // it against the stored launchers; an id that names nothing gets the default
  // rather than an error, so a stale menu cannot fail a spawn.
  launcherId: z.string().min(1).max(64).optional(),
})

const ptyId = z.number().int().min(1)

export const writePtyInput: z.ZodType<WritePtyInput> = z.object({
  id: ptyId,
  // A keystroke, a paste, or a bracketed-paste block — bounded so a renderer
  // cannot push an unbounded string into a shell's input in one message.
  data: z.string().max(100_000),
})

export const resizePtyInput: z.ZodType<ResizePtyInput> = z.object({ id: ptyId, cols: dimension, rows: dimension })
export const killPtyInput: z.ZodType<KillPtyInput> = z.object({ id: ptyId })

/**
 * The settings sheet's payload. The *shape* is checked here and the *meaning*
 * in `core.validateSettings`, which main runs next: a schema can say a command
 * is a bounded string, and only `core` can say a list with no launchers in it
 * is not a menu.
 */
export const settingsInput: z.ZodType<Settings> = z.object({
  launchers: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        // **Empty is a shape, not a meaning.** A row added and not yet typed
        // into is an ordinary thing to save by accident, and it must come back
        // as "an agent needs a command" rather than as `bad-request`, whose
        // sentence is "this is a bug in the app".
        // Bounded well above `core`'s ceilings for the same reason: the refusal
        // the reader sees should be `core`'s, not a silent parse failure.
        label: z.string().max(200),
        command: z.string().max(1000),
      }),
    )
    .max(64),
  defaultLauncherId: z.string().min(1).max(64),
  // Shape only, again: `core.isTagName` decides whether it is a tag the app
  // will write, and says so in a sentence.
  noteTag: z.string().max(64),
})
