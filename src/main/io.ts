/**
 * The one-line answers every disk-touching module in `main` needs, spelled
 * once. Each of them was a copy in three or four files first, which is how a
 * fix to one spelling — `isMissing` learning a second errno, say — reaches only
 * the file it was made in.
 *
 * Nothing here decides anything about the llmwiki schema: that is `core`'s, and
 * this module is `node`'s.
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** The hash the sha guard and the skill digest are both made of. */
export const shaOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** What a caught `unknown` says for itself, for the `detail` of a typed failure. */
export const detailOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Absent, and *only* absent. Every other failure has to stay distinguishable
 * from "not there": a directory the app cannot open must never read as
 * "nothing installed" — see `skill.ts`, which compares two digests.
 */
export const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

/**
 * Where a file is staged before it is renamed onto its destination. Hidden and
 * unique on purpose: a crash mid-write must not leave `SKILL.md.1234.tmp` in a
 * directory Claude Code enumerates, and two writers must not share a path.
 */
export const tempPathFor = (absolute: string): string =>
  join(dirname(absolute), `.${basename(absolute)}.${randomUUID()}.tmp`)

/** `undefined` for text that is not JSON — a store file the app cannot parse is not a crash. */
export const tryJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * One thing at a time, in the order asked — the shape every guarded write in
 * this app needs, because a read followed by a write is what two windows
 * interleave. `then(work, work)` and not
 * `then(work)`: a rejected job reaches its own caller and stalls no one else's.
 * A factory, not a shared keyed map, so no two callers collide on a string
 * nothing checks.
 */
export const createChain = (): (<T>(work: () => Promise<T>) => Promise<T>) => {
  let queue: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>): Promise<T> => {
    const queued = queue.then(work, work)
    queue = queued.catch(() => undefined)
    return queued
  }
}

/**
 * `decode` never fails — an unreadable file is the caller's defaults — so
 * `isDecodable` is the separate question of whether it was understood *at
 * all*, which is what decides between overwriting a file and keeping a copy.
 */
export type JsonCodec<T> = {
  readonly decode: (text: string) => T
  readonly isDecodable: (text: string) => boolean
  readonly encode: (value: T) => string
}

export type JsonStore<T> = {
  readonly get: () => T
  readonly set: (next: T) => Promise<T>
}

/**
 * A versioned file under `userData`, read once at startup and kept in memory:
 * every window asks on every open and the files are small. Writes are staged
 * beside the target and renamed, so a crash mid-write cannot leave half a JSON
 * document where the state used to be, and serialised, so two windows saving
 * at once cannot interleave. A file it cannot understand becomes the defaults
 * and is moved aside once rather than destroyed — it could belong to a *newer*
 * app. Losing a hue or a launcher row is an annoyance; refusing to start is
 * not an option.
 */
export const createJsonStore = async <T>(path: string, codec: JsonCodec<T>): Promise<JsonStore<T>> => {
  const raw = await readFile(path, 'utf8').catch(() => '')
  let value = codec.decode(raw)
  let unreadable = raw !== '' && !codec.isDecodable(raw)
  const chain = createChain()

  const write = async (next: T): Promise<void> => {
    if (unreadable) {
      unreadable = false
      await rename(path, `${path}.unreadable`).catch(() => undefined)
    }
    const temp = tempPathFor(path)
    await writeFile(temp, codec.encode(next), 'utf8')
    await rename(temp, path)
  }

  return {
    get: (): T => value,
    set: async (next): Promise<T> => {
      value = next
      await chain(() => write(next))
      return next
    },
  }
}
