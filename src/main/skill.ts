/**
 * The skill installer: the only writes the app makes outside a project, and the
 * shipping path for the copy of `/llmwiki` this build carries.
 *
 * It is `skills/llmwiki/install.sh` without the shell: the same manifest
 * (`core.SKILL_FILES`), the same two destinations under `~/.claude`, and the
 * same refusal to touch `settings.json`. Two things the script does and this
 * does **not**: it takes `.bak-<stamp>` copies of what it replaces, and it
 * `py_compile`s the hooks before copying. Neither is missing by accident — the
 * canonical copy is in git and the deploy target is never hand-edited, so the
 * digest guard is the protection.
 *
 * What it adds is that guard — the digest the sheet was shown must still be the
 * digest on disk, or nothing is written and the reason comes back. Whole
 * files, replaced; never a merge — the sha guard's shape, over a directory.
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isFreshInstall, skillDigest, skillState, SKILL_FILES, type SkillEntry, type SkillFile } from '@core/skill.js'
import { err, ok } from '@core/result.js'
import type { SkillError, SkillInstalled, SkillStatus, Wire } from '@shared/api.js'
import { createChain, detailOf, isMissing, shaOf, tempPathFor } from './io.js'

/** Where the bundle is, and where `~/.claude` is. Both are main's; neither is the renderer's. */
export type SkillPaths = {
  /** The directory this build carries the skill in. */
  readonly source: string
  /** `~/.claude` — the parent of both write scopes. */
  readonly claudeDir: string
}

export type SkillHost = {
  readonly status: () => Promise<Wire<SkillStatus, SkillError>>
  readonly install: (baseSha: string) => Promise<Wire<SkillInstalled, SkillError>>
}

/**
 * A file that is not there has no sha, which is how `core` reads "absent".
 * Every *other* failure throws rather than reading as absent: a directory the
 * app cannot open would otherwise be reported as "nothing installed", and the
 * guard would then be comparing two digests that both mean "I could not look".
 */
const shaAt = (path: string): Promise<string> =>
  readFile(path).then(shaOf, (error: unknown) => {
    if (isMissing(error)) return ''
    throw error
  })

const entriesAt = (dir: string, pathOf: (file: SkillFile) => string): Promise<readonly SkillEntry[]> =>
  Promise.all(SKILL_FILES.map(async (file) => ({ target: file.target, sha: await shaAt(join(dir, pathOf(file))) })))

/**
 * The digest the guard compares — short enough for the wire, and `''` for a
 * copy that is not there at all. `core` builds the manifest; the hash is here
 * because `core` is pure and has no `node:crypto`.
 */
const digestOf = (entries: readonly SkillEntry[]): string => {
  const manifest = skillDigest(entries)
  return manifest === '' ? '' : shaOf(Buffer.from(manifest, 'utf8'))
}

/** One staged file: written beside its destination and not yet moved onto it. */
type Staged = { readonly temp: string; readonly target: string }

const stage = async (absolute: string, bytes: Buffer, executable: boolean): Promise<Staged> => {
  const temp = tempPathFor(absolute)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(temp, bytes)
  if (executable) await chmod(temp, 0o755)
  return { temp, target: absolute }
}

export const createSkillHost = (paths: SkillPaths): SkillHost => {
  /**
   * One install at a time, for the reason `files.ts` serialises its writes: the
   * guard is a read followed by a write, and two windows can interleave them —
   * both read the same digest, both pass, and they then race over the same
   * files. There is one `~/.claude`, so the chain is one.
   */
  const serialised = createChain()

  const bundled = (): Promise<readonly SkillEntry[]> => entriesAt(paths.source, (file) => file.source)
  const installed = (): Promise<readonly SkillEntry[]> => entriesAt(paths.claudeDir, (file) => file.target)

  const status = async (): Promise<Wire<SkillStatus, SkillError>> => {
    let here: readonly SkillEntry[]
    let there: readonly SkillEntry[]
    try {
      ;[here, there] = await Promise.all([bundled(), installed()])
    } catch (error: unknown) {
      return err({ kind: 'unreadable', detail: detailOf(error) })
    }
    // *Any* missing file is a broken bundle, not a smaller one: a packaging
    // filter that drops one hook would otherwise offer an install that fails
    // every time it is pressed.
    if (here.some((entry) => entry.sha === '')) return err({ kind: 'no-bundle', detail: paths.source })
    return ok({ state: skillState(digestOf(here), digestOf(there)), sha: digestOf(there), files: SKILL_FILES.length })
  }

  const write = async (baseSha: string): Promise<Wire<SkillInstalled, SkillError>> => {
    // Each pair carries its own manifest row rather than a parallel index, so
    // the staging loop cannot pair a hook's bytes with a document's mode.
    let bundle: readonly { readonly file: SkillFile; readonly bytes: Buffer }[]
    try {
      bundle = await Promise.all(
        SKILL_FILES.map(async (file) => ({ file, bytes: await readFile(join(paths.source, file.source)) })),
      )
    } catch (error: unknown) {
      return err({ kind: 'no-bundle', detail: detailOf(error) })
    }

    // The guard, and the whole of it: what is on disk now must be what the
    // sheet was shown. A copy that moved under us is refused with the evidence,
    // so the reader re-reads and decides — the app never merges.
    let before: readonly SkillEntry[]
    try {
      before = await installed()
    } catch (error: unknown) {
      return err({ kind: 'unreadable', detail: detailOf(error) })
    }
    const current = digestOf(before)
    if (current !== baseSha) return err({ kind: 'conflict', currentSha: current })

    /**
     * Staged in full, then moved. Everything that can fail for a whole
     * directory — a missing parent, a read-only scope, a full disk — fails in
     * the first phase, where nothing has been replaced yet. A half-installed
     * skill is a new `SKILL.md` against old hooks, which is exactly the
     * mismatch the manifest exists to prevent.
     */
    const staged: Staged[] = []
    try {
      for (const { file, bytes } of bundle) {
        staged.push(await stage(join(paths.claudeDir, file.target), bytes, file.executable))
      }
      for (const file of staged) await rename(file.temp, file.target)
    } catch (error: unknown) {
      await Promise.all(staged.map((file) => rm(file.temp, { force: true })))
      return err({ kind: 'unwritable', detail: detailOf(error) })
    }
    return ok({ files: SKILL_FILES.length, fresh: isFreshInstall(before) })
  }

  return { status, install: (baseSha) => serialised(() => write(baseSha)) }
}
