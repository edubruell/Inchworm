/**
 * Every byte the app reads or writes goes through this module. It is thin and
 * boring by policy: no decision here is about the llmwiki schema — that lives
 * in `core` — and no path reaches an `fs` call without having been resolved
 * inside the project root.
 */

import { readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isUnder } from '@core/paths.js'
import { AGENT_FILES, isAgentFile } from '@core/schema.js'
import { err, ok } from '@core/result.js'
import type { FileContent, FileError, FileStamp, Layout, Wire } from '@shared/api.js'
import { MAX_FILE_BYTES } from '@shared/api.js'
import { createChain, detailOf, isMissing, shaOf, tempPathFor } from './io.js'
import { insideRoot, isContained, isDotPath, relativePosix } from './paths.js'

/**
 * The check a symlink cannot walk past: `insideRoot` proves the *spelling* stays
 * inside, `realpath` proves the destination does. A file that does not exist yet
 * has no real path, so its parent answers — the link that would have to be bad.
 */
const realInside = async (root: string, absolute: string): Promise<string | undefined> => {
  const realRoot = await realpath(root)
  const real = await realpath(absolute).catch(async () => join(await realpath(dirname(absolute)), basename(absolute)))
  return isContained(realRoot, real) ? real : undefined
}

/**
 * The project's memory is three places, and the app reaches none of the rest of
 * the repository: the **agent file** — either spelling — the wiki root and the
 * journal. Containment to the project root alone is not enough: it would leave
 * `.git/hooks/` writable to a renderer, which is the whole threat the IPC
 * contract exists to answer.
 */
const isWikiFile = (relPath: string, layout: Layout): boolean =>
  isAgentFile(relPath) || isUnder(relPath, layout.wikiRoot) || isUnder(relPath, layout.journal)

/**
 * Resolve an untrusted project-relative path, or say which way it failed. The
 * *real* path is what comes back: checking one path and then opening another is
 * a window a symlink can be repointed through.
 */
const locate = async (root: string, layout: Layout, relPath: string): Promise<Wire<string, FileError>> => {
  const absolute = insideRoot(root, relPath)
  if (absolute === undefined || !isWikiFile(relativePosix(root, absolute), layout)) {
    return err({ kind: 'outside-project' })
  }
  try {
    const real = await realInside(root, absolute)
    return real === undefined ? err({ kind: 'outside-project' }) : ok(real)
  } catch {
    // The parent directory is missing, so nothing can be read or written there.
    return err({ kind: 'not-found' })
  }
}

/**
 * Files under one directory, project-relative and posix-separated. A missing
 * directory is an empty list, not a failure — a journal with no entries yet is
 * a normal project — and nothing under a dotted path is wiki content.
 */
const walk = async (root: string, dir: string): Promise<readonly string[]> => {
  const entries = await readdir(join(root, dir), { withFileTypes: true, recursive: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relativePosix(root, join(entry.parentPath, entry.name)))
    .filter((path) => !isDotPath(path))
}

/**
 * The project's file list: the wiki root, the journal, and the agent file —
 * both the layout declaration and a file the sidebar shows. Either spelling is
 * listed if it is there; a project normally has one. Nothing else in the
 * repository is listed — the app watches and reads memory, not source.
 */
export const listWikiFiles = async (root: string, layout: Layout): Promise<readonly string[]> => {
  const nested = await Promise.all([walk(root, layout.wikiRoot), walk(root, layout.journal)])
  const agent = (
    await Promise.all(
      AGENT_FILES.map((name) =>
        stat(join(root, name)).then(
          () => [name],
          () => [],
        ),
      ),
    )
  ).flat()
  // Deduplicated: a journal declared *inside* the wiki root is a layout
  // `parseClaudeBlock` accepts, and it would otherwise list every entry twice.
  return [...new Set([...agent, ...nested.flat()])].sort((a, b) => a.localeCompare(b))
}

/** The directories a watcher must cover to see every file `listWikiFiles` returns. */
export const watchTargets = (root: string, layout: Layout): readonly string[] => [
  ...AGENT_FILES.map((name) => join(root, name)),
  join(root, layout.wikiRoot),
  join(root, layout.journal),
]

export const readWikiFile = async (
  root: string,
  layout: Layout,
  relPath: string,
): Promise<Wire<FileContent, FileError>> => {
  const located = await locate(root, layout, relPath)
  if (!located.ok) return located
  try {
    const info = await stat(located.value)
    if (!info.isFile()) return err({ kind: 'not-found' })
    // Refused before the bytes are read, let alone parsed.
    if (info.size > MAX_FILE_BYTES) return err({ kind: 'too-large', bytes: info.size })
    const bytes = await readFile(located.value)
    return ok({ path: relPath, text: bytes.toString('utf8'), sha: shaOf(bytes), mtimeMs: info.mtimeMs })
  } catch (error: unknown) {
    return isMissing(error) ? err({ kind: 'not-found' }) : err({ kind: 'unreadable', detail: detailOf(error) })
  }
}

/** `''` for a file that is not there — the sha an editor of a new file starts from. */
const currentSha = async (absolute: string): Promise<string> =>
  readFile(absolute).then(shaOf, (error: unknown) => {
    if (isMissing(error)) return ''
    throw error
  })

/**
 * Writes to one path, one at a time. The guard is a read followed by a write,
 * and two windows on the same project can interleave them: both read the same
 * sha, both pass, and the second silently overwrites the first, which is the
 * one thing the guard promises cannot happen. The chain is per real path, so
 * unrelated files still write concurrently.
 */
const chains = new Map<string, { readonly run: ReturnType<typeof createChain>; waiting: number }>()

/**
 * The one thing a bare `createChain()` per key would not do: forget the key
 * again. A window writes every file it edits, so a map that only ever grows
 * keeps one chain per file for the life of the process. The count is what says
 * a chain has drained — the last caller out deletes it.
 */
const serialised = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const entry = chains.get(key) ?? { run: createChain(), waiting: 0 }
  chains.set(key, entry)
  entry.waiting += 1
  try {
    return await entry.run(work)
  } finally {
    entry.waiting -= 1
    if (entry.waiting === 0) chains.delete(key)
  }
}

/**
 * Written beside the file and renamed over it, because `writeFile` truncates
 * first: a watcher event mid-write hands the other windows half a note, and a
 * crash mid-write leaves an append-only register truncated. `rename` within a
 * directory is atomic, so a reader sees either all the old bytes or all the new.
 */
const writeAtomic = async (absolute: string, bytes: Buffer): Promise<void> => {
  const temporary = tempPathFor(absolute)
  try {
    await writeFile(temporary, bytes)
    await rename(temporary, absolute)
  } catch (error: unknown) {
    await rm(temporary, { force: true })
    throw error
  }
}

/**
 * The write path and the guard that makes concurrent editing safe: the sha the
 * editor started from must still be the sha on disk, and a mismatch is rejected
 * for the renderer to show, never merged. The bytes written are exactly the
 * bytes given: no trailing newline, no reformatting, ever.
 */
export const writeWikiFile = async (
  root: string,
  layout: Layout,
  input: { readonly path: string; readonly text: string; readonly baseSha: string },
): Promise<Wire<FileStamp, FileError>> => {
  const located = await locate(root, layout, input.path)
  if (!located.ok) return located
  return serialised(located.value, async () => {
    try {
      const onDisk = await currentSha(located.value)
      if (onDisk !== input.baseSha) return err({ kind: 'conflict', currentSha: onDisk })
      const bytes = Buffer.from(input.text, 'utf8')
      // In bytes, and refused with the same word the read path uses: the write
      // schema counts UTF-16 code units, so a long enough document of accented
      // prose passes there and comes back `too-large` on the way in — a file
      // this app had written and could no longer open.
      if (bytes.byteLength > MAX_FILE_BYTES) return err({ kind: 'too-large', bytes: bytes.byteLength })
      await writeAtomic(located.value, bytes)
      const info = await stat(located.value)
      return ok({ sha: shaOf(bytes), mtimeMs: info.mtimeMs })
    } catch (error: unknown) {
      return err({ kind: 'unreadable', detail: detailOf(error) })
    }
  })
}
