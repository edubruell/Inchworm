/**
 * The pure half of path containment. Every path that arrives from the renderer
 * is resolved against the open project root and checked here before any
 * filesystem call — a note is untrusted input and so is a path in an IPC
 * message. Containment is four-stage: `wikiPathSchema` in `shared/schema.ts`
 * refuses `..`/absolute/backslash/NUL, this module resolves the path under the
 * project root, `files.ts` narrows the allow-list to CLAUDE.md + the wiki root
 * and the journal — the project's memory, not its repository — and the fs call
 * re-checks the *real* path, because a symlink defeats string arithmetic.
 */

import { relative, resolve, sep } from 'node:path'

/**
 * True when `candidate` is `root` itself or lies beneath it. Both must already
 * be absolute and resolved: `startsWith` alone would accept `/a/project-evil`
 * as inside `/a/project`, which is why the separator is part of the test.
 */
export const isContained = (root: string, candidate: string): boolean =>
  candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep)

/**
 * Resolve a project-relative path, or `undefined` if it does not stay inside.
 * `resolve` normalises `..` away first, so the answer is about where the path
 * lands, not about how it was spelled.
 */
export const insideRoot = (root: string, relPath: string): string | undefined => {
  const absolute = resolve(root, relPath)
  return isContained(root, absolute) ? absolute : undefined
}

/**
 * A dotted path *segment* anywhere in a project-relative path. Both the lister
 * and the watcher ask this one question: testing only the leaf name lists the
 * contents of `.git/`, and testing the absolute path silently mutes every
 * project that lives under a dotted directory (`~/.claude/projects/x`).
 */
export const isDotPath = (relPath: string): boolean =>
  relPath.split('/').some((segment) => segment.startsWith('.'))

/** Project-relative, posix-separated — the form every `core` function expects. */
export const relativePosix = (root: string, absolute: string): string =>
  relative(root, absolute).split(sep).join('/')
