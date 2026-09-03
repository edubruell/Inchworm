/**
 * `userData/projects.json` — the projects the user has opened and the accent hue
 * each one owns. The only state the app persists; it carries a `version` from
 * its first release so a migration can be added without guessing, and a file it
 * cannot understand is an empty list rather than a crash: losing a hue is an
 * annoyance, refusing to start is not an option.
 */

import { hueForPath, isPaletteHue } from '@core/hue.js'
import type { ProjectSummary } from '@shared/api.js'
import { createJsonStore, tryJson } from './io.js'
import { basename } from 'node:path'
import { z } from 'zod'

export const STORE_VERSION = 1

const entrySchema = z.object({
  dir: z.string().min(1),
  hue: z.number(),
  lastOpenedMs: z.number(),
})

const fileSchema = z.object({
  version: z.literal(STORE_VERSION),
  projects: z.array(entrySchema),
})

/**
 * A stored hue that is not on the palette (a hand-edited file, or a palette that
 * changed under an old entry) falls back to the project's own path hash, which
 * is what a first open would have given it anyway.
 */
const withPaletteHue = (entry: z.infer<typeof entrySchema>): ProjectSummary => ({
  dir: entry.dir,
  name: basename(entry.dir),
  hue: isPaletteHue(entry.hue) ? entry.hue : hueForPath(entry.dir),
  lastOpenedMs: entry.lastOpenedMs,
})

/** Pure: text on disk → the project list. Anything unreadable is an empty list. */
export const decodeStore = (text: string): readonly ProjectSummary[] => {
  const file = fileSchema.safeParse(tryJson(text))
  return file.success ? file.data.projects.map(withPaletteHue) : []
}

/**
 * Whether the file was understood at all — an empty project list and an
 * unreadable file both decode to `[]`, and only one of them may be overwritten
 * without keeping a copy.
 */
export const isDecodable = (text: string): boolean => fileSchema.safeParse(tryJson(text)).success

/** Pure: the project list → the bytes to write. Newest first, so the picker is. */
export const encodeStore = (projects: readonly ProjectSummary[]): string =>
  JSON.stringify(
    {
      version: STORE_VERSION,
      projects: [...projects]
        .sort((a, b) => b.lastOpenedMs - a.lastOpenedMs)
        .map(({ dir, hue, lastOpenedMs }) => ({ dir, hue, lastOpenedMs })),
    },
    undefined,
    2,
  )

export type ProjectStore = {
  readonly list: () => readonly ProjectSummary[]
  /** The one place "what do we know about this directory?" is answered. */
  readonly find: (dir: string) => ProjectSummary | undefined
  /** Records an open (first time: assigns the path hue) and returns the summary. */
  readonly remember: (dir: string, nowMs: number) => Promise<ProjectSummary>
  readonly setHue: (dir: string, hue: number) => Promise<ProjectSummary | undefined>
}

/**
 * The list lives in `io.createJsonStore` — read once at startup, kept in
 * memory, written whole and atomically, one write at a time. What is this
 * store's own is the vocabulary above it: a project is remembered by its
 * directory, and a hue is assigned on first sight and never reassigned.
 */
export const createProjectStore = async (path: string): Promise<ProjectStore> => {
  const file = await createJsonStore<readonly ProjectSummary[]>(path, {
    decode: decodeStore,
    isDecodable,
    encode: encodeStore,
  })

  const find = (dir: string): ProjectSummary | undefined => file.get().find((project) => project.dir === dir)

  const upsert = async (summary: ProjectSummary): Promise<ProjectSummary> => {
    await file.set([summary, ...file.get().filter((p) => p.dir !== summary.dir)])
    return summary
  }

  return {
    list: (): readonly ProjectSummary[] => file.get(),
    find,
    remember: async (dir, nowMs): Promise<ProjectSummary> =>
      upsert({ dir, name: basename(dir), hue: find(dir)?.hue ?? hueForPath(dir), lastOpenedMs: nowMs }),
    setHue: async (dir, hue): Promise<ProjectSummary | undefined> => {
      const known = find(dir)
      return known === undefined ? undefined : upsert({ ...known, hue })
    },
  }
}
