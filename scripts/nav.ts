/**
 * `npm run nav -- <project dir>` — print the navigation tree, cap badges and
 * link health `core` derives for a real project — everything `core` knows,
 * with no Electron and no UI. It is also how `core` gets pointed at a real
 * wiki, whose notes illustrate the `[[link]]` syntax inside code spans.
 *
 * It is a script, not a module: `console.log` is the output, and it is the one
 * place in the repo allowed to do I/O outside `src/main`.
 */

/* eslint-disable no-console */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { capFor, capStatus } from '@core/caps.js'
import { classify } from '@core/classify.js'
import { buildLinkIndex, resolveLink } from '@core/links.js'
import { buildNavigation } from '@core/navigation.js'
import { hueForPath } from '@core/hue.js'
import type { NoteState } from '@core/note.js'
import { parseNote } from '@core/note.js'
import { parseClaudeBlock } from '@core/project.js'
import type { ProjectLayout } from '@core/project.js'
import { badge, statusLabel } from './format.js'

const SKIP = new Set(['node_modules', '.git', 'out', 'dist', 'coverage'])

const listFiles = (root: string, dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return []
    const full = join(dir, entry.name)
    return entry.isDirectory() ? listFiles(root, full) : [relative(root, full).split(sep).join('/')]
  })

/** A file can vanish between `listFiles` and the read; a raw ENOENT stack is not a report. */
const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

const report = (root: string): void => {
  const claudeText = readText(join(root, 'CLAUDE.md'))
  if (claudeText === undefined) {
    console.error(`${root}: no CLAUDE.md — run /llmwiki init`)
    process.exitCode = 1
    return
  }
  const claude = parseClaudeBlock(claudeText)
  if (!claude.ok) {
    console.error(`${root}: no llmwiki block in CLAUDE.md (${claude.error.kind}) — run /llmwiki init`)
    process.exitCode = 1
    return
  }
  const layout: ProjectLayout = claude.value
  const paths = listFiles(root, root)
  const index = buildLinkIndex(paths, layout)
  // Parsed **once** per file and shared by the tree and the link sweep, which
  // would otherwise parse the whole project twice over.
  const notes = new Map(
    paths.filter((path) => classify(path, layout).kind !== 'other').map((path) => [path, parseNote(readText(join(root, path)) ?? '')] as const),
  )
  const noteFor = (path: string): NoteState => notes.get(path) ?? parseNote('')

  console.log(`\n${root}`)
  console.log(`  hue ${String(hueForPath(root))} · wiki ${layout.wikiRoot} · journal ${layout.journal} · ${layout.kind}`)

  for (const group of buildNavigation(paths, layout)) {
    console.log(`\n  ${group.section.toUpperCase()}`)
    for (const entry of group.entries) {
      const note = noteFor(entry.path)
      const cap = badge(capStatus(note.lineCount, capFor(entry.kind)))
      console.log(`    ${entry.name.padEnd(34)} ${cap.padEnd(20)} ${statusLabel(note, entry.kind)}`)
    }
  }

  // An unparsed file has no links to sweep — it is reported as unparsed in the
  // tree above rather than silently contributing zero dangling links.
  const dangling = [...notes].flatMap(([path, note]) =>
    note.kind === 'unparsed'
      ? []
      : note.links
          .filter((link) => resolveLink(link.target, index).status === 'unresolved')
          .map((link) => `    ${path}:${String(link.line)} → [[${link.target}]]`),
  )

  console.log(`\n  UNRESOLVED LINKS (${String(dangling.length)})`)
  for (const line of dangling) console.log(line)
}

// `vite-node` forwards script arguments only after a `--`, which the npm script
// supplies — without it `npm run nav -- <dir>` silently reports the current
// directory instead of `<dir>`.
const targets = process.argv.slice(2)
for (const target of targets.length > 0 ? targets : ['.']) report(resolve(target))
