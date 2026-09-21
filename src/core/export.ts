/**
 * What an export bundle holds. This is schema knowledge, so it lives here and
 * not in the button that offers it: no component decides which files are "the
 * wiki" by reading a path.
 *
 * Two scopes, because there are two reasons to take a wiki out of its repo.
 * `everything` is the whole memory of a project, for the reader's own second
 * machine: every file under the wiki root or the journal, whatever the schema
 * makes of it. `curated` is the layer another person can read: the state file,
 * the numbered notes and the registers, with the journal and the archive left
 * behind — a partner wants the conclusions, not six months of dated sessions.
 *
 * The agent file is in neither, deliberately. `CLAUDE.md` is tracked in git and
 * arrives with the repository, so a copy in the bundle would only ever be a
 * second and staler one.
 *
 * Nothing here compresses anything. A plan is a list of project-relative paths;
 * `main/export.ts` reads them through the ordinary containment-checked read
 * path and zips the bytes.
 */

import { classify, type WikiFileKind } from './classify.js'
import { isUnder } from './paths.js'
import type { ProjectLayout } from './project.js'
import type { ExportScope } from '@shared/api.js'

/**
 * **`everything` is by location, not by kind**, and that is a correction rather
 * than a shortcut. Selecting the five kinds `classify` names silently dropped
 * every file it calls `other`: `wikilog.md`, which the skill writes and
 * `schema.ts:REGISTERS` has never learned; a `<register>_<table>.md` the schema
 * tells projects to split out; a note in a wiki sub-folder; an attachment that
 * is not markdown; and — worst — the *entire journal* of a project that
 * declares its journal inside its wiki root, a layout `parseClaudeBlock`
 * accepts. A bundle that calls itself the whole wiki and quietly leaves files
 * behind is worse than one that carries a file nobody asked for.
 *
 * `curated` stays by kind, because there leaving things out is the point.
 */
const CURATED: readonly WikiFileKind['kind'][] = ['state', 'note', 'register']

/**
 * A path that would be a dangerous zip entry. The list comes from
 * `listWikiFiles`, which walks real directories, so `..` and a leading `/`
 * cannot occur — but a **backslash can**, because it is an ordinary character
 * in a POSIX filename and a separator to a long line of Windows extractors, and
 * `curated` exists to be sent to someone else. Refused here rather than
 * rewritten: the app does not rename a reader's file.
 */
const isSafeEntry = (path: string): boolean =>
  !path.includes('\\') && !path.includes('\0') && !path.startsWith('/') && !path.split('/').includes('..')

/**
 * The files a scope takes, in the order they were given — `listWikiFiles`
 * already sorts, and a bundle that reordered them would make two exports of an
 * unchanged wiki diff against each other.
 */
export const exportPlan = (
  files: readonly string[],
  layout: ProjectLayout,
  scope: ExportScope,
): readonly string[] =>
  files.filter(
    (path) =>
      isSafeEntry(path) &&
      (scope === 'everything'
        ? isUnder(path, layout.wikiRoot) || isUnder(path, layout.journal)
        : CURATED.includes(classify(path, layout).kind)),
  )

/** What each scope calls itself in a filename. */
const SUFFIX: Record<ExportScope, string> = { everything: 'wiki', curated: 'notes' }

/**
 * A project name is whatever the folder is called, so it reaches a filename
 * through this: lower case, one hyphen for every run of anything else. An empty
 * result falls back rather than producing a file called `-wiki-2026-09-19.zip`.
 */
const slug = (name: string): string => {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned === '' ? 'project' : cleaned
}

/**
 * The bundle's name without an extension — also the folder every entry sits
 * under inside the zip, so unzipping anywhere lands one folder rather than
 * spraying `local_context/` into whatever directory the reader was in.
 */
export const bundleStem = (project: string, scope: ExportScope, date: string): string =>
  `${slug(project)}-${SUFFIX[scope]}-${date}`

/** The name of the manifest inside the bundle, at its root. */
export const MANIFEST_FILE = 'inchworm-export.md'

const DESCRIPTION: Record<ExportScope, string> = {
  everything: 'The whole wiki: every file under the wiki root and the journal, the archive included.',
  curated: 'The curated layer: the state file, the numbered notes and the registers. No journal, no archive.',
}

/**
 * A readable note at the root of the bundle, so a zip that arrives by mail
 * says what it is without the app. It is markdown because everything in an
 * llmwiki is, and it never lands inside a wiki: the app writes no wiki file it
 * was not asked to write.
 */
export const manifest = (input: {
  readonly project: string
  readonly scope: ExportScope
  readonly date: string
  readonly layout: ProjectLayout
  readonly paths: readonly string[]
}): string =>
  [
    `# ${input.project} — llmwiki export`,
    '',
    `Exported by Inchworm on ${input.date}. ${DESCRIPTION[input.scope]}`,
    '',
    `- Wiki root: \`${input.layout.wikiRoot}\``,
    `- Journal: \`${input.layout.journal}\``,
    `- Kind: ${input.layout.kind}`,
    `- Files: ${String(input.paths.length)}`,
    '',
    'Paths below are relative to the project root. To put this wiki on another',
    'machine, copy the folders next to this file into the repository root.',
    '',
    ...input.paths.map((path) => `- \`${path}\``),
    '',
  ].join('\n')
