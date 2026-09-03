/**
 * `userData/settings.json` — the app's own preferences, built from the same
 * `io.createJsonStore` as `projects.json`: it carries the version, the atomic
 * write, and the rule that a file it cannot understand becomes the defaults
 * rather than a crash. Losing a launcher row is an annoyance; refusing to start
 * is not an option.
 *
 * The *shape* is `core`'s (`core/settings.ts`) and so is the repair. What is
 * left here is the codec: the schema this file accepts, and its bytes.
 */

import { DEFAULT_SETTINGS, repairSettings } from '@core/settings.js'
import type { Settings } from '@shared/api.js'
import { createJsonStore, tryJson } from './io.js'
import { z } from 'zod'

export const SETTINGS_VERSION = 1

/**
 * **Deliberately looser than `shared.settingsInput`, which spells the same
 * fields bounded** — the two look like a copy and are not one to unify. The
 * wire's job is to refuse a bad row from the sheet; this one's is to get a file
 * nobody typed today as far as `core.repairSettings`, which drops
 * the unusable rows and keeps the rest. Bounded here, one over-long command
 * would make the whole file unreadable and cost the reader every other launcher.
 */
const launcherSchema = z.object({
  id: z.string(),
  label: z.string(),
  command: z.string(),
})

const fileSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  launchers: z.array(launcherSchema),
  defaultLauncherId: z.string(),
  // Optional on the way in: a settings file written before the note tag
  // existed is not an unreadable file, it is a file with one fewer setting.
  noteTag: z.string().optional(),
})

/**
 * Pure: text on disk → settings the app will act on. A file that parses is
 * still put through `core`'s repair, because a hand-edited row can be
 * well-formed JSON and an unusable launcher at the same time.
 */
export const decodeSettings = (text: string): Settings => {
  const file = fileSchema.safeParse(tryJson(text))
  return file.success
    ? repairSettings({
        launchers: file.data.launchers,
        defaultLauncherId: file.data.defaultLauncherId,
        noteTag: file.data.noteTag ?? DEFAULT_SETTINGS.noteTag,
      })
    : DEFAULT_SETTINGS
}

/** Whether the file was understood at all — see `projectStore.isDecodable`. */
export const isDecodable = (text: string): boolean => fileSchema.safeParse(tryJson(text)).success

export const encodeSettings = (settings: Settings): string =>
  JSON.stringify({ version: SETTINGS_VERSION, ...settings }, undefined, 2)

export type SettingsStore = {
  readonly get: () => Settings
  /** Already validated by `core` when it gets here; this only persists it. */
  readonly set: (settings: Settings) => Promise<Settings>
}

/** The disk half is `io.createJsonStore`'s; this file is only the codec. */
export const createSettingsStore = (path: string): Promise<SettingsStore> =>
  createJsonStore(path, { decode: decodeSettings, isDecodable, encode: encodeSettings })
