/**
 * Opening a project: the one place main turns a directory the user picked into
 * the layout everything else is scoped by. The decisions are all `core`'s —
 * main reads two things off the disk and hands the text to `parseClaudeBlock`.
 * A folder without that block is not an llmwiki project, and the picker says
 * so rather than guessing.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { err, ok } from '@core/result.js'
import { parseClaudeBlock } from '@core/project.js'
import { AGENT_FILES, CONVENTIONAL_WIKI_ROOT, type AgentFile } from '@core/schema.js'
import type { Layout, OpenProjectError, ProjectMarkers, Wire } from '@shared/api.js'

/** A project as main tracks it: an absolute root and the layout read from it. */
export type OpenProject = {
  readonly dir: string
  readonly layout: Layout
}

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

/**
 * What this folder has that a project would have. Only ever built for a folder
 * that turned out *not* to be a project: it is the evidence the picker shows,
 * and the difference between "there is nothing here" and "an agent has been
 * here but never ran `/llmwiki init`".
 */
export const markersFor = async (dir: string): Promise<ProjectMarkers> => {
  const found = await Promise.all(AGENT_FILES.map(async (name) => ((await exists(join(dir, name))) ? name : undefined)))
  return {
    agentFiles: found.filter((name): name is AgentFile => name !== undefined),
    // The conventional root, not a configured one: with no block there is
    // nothing to configure, and a `local_context/wiki` that exists says the
    // init got part-way (`core/schema.ts`).
    wiki: await exists(join(dir, CONVENTIONAL_WIKI_ROOT)),
  }
}

/**
 * A directory the user picked → the layout everything else is scoped by.
 *
 * The block may live in **either** agent file, in the order `AGENT_FILES`
 * names: `CLAUDE.md` is what the skill writes, `AGENTS.md` is the cross-tool
 * spelling, and a project carrying only the second is a project. Both are
 * tried before giving up, so a `CLAUDE.md` that documents the app while
 * `AGENTS.md` declares the layout still opens.
 *
 * The decisions are all `core`'s — main reads files and hands over the text.
 */
export const loadProject = async (dir: string): Promise<Wire<OpenProject, OpenProjectError>> => {
  const info = await stat(dir).catch(() => undefined)
  if (info?.isDirectory() !== true) return err({ kind: 'not-a-directory' })

  let firstRefusal: string | undefined
  for (const name of AGENT_FILES) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => undefined)
    if (text === undefined) continue
    const layout = parseClaudeBlock(text)
    // The parser's refusals are the project-root allow-list's first gate: an
    // absolute or escaping wiki root never becomes a directory main will read.
    if (layout.ok) return ok({ dir, layout: layout.value })
    firstRefusal ??= layout.error.kind
  }

  return err({ kind: 'no-llmwiki', dir, markers: await markersFor(dir), detail: firstRefusal })
}
