/**
 * Reading a fixture project the way the app does: the file list, and the layout
 * from its own CLAUDE.md rather than from a literal in the test — a fixture
 * that moves its wiki root should break the suite, not quietly stop covering it.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { ProjectLayout } from '@core/project.js'
import { parseClaudeBlock } from '@core/project.js'

export const listFiles = (root: string): readonly string[] => {
  const walk = (dir: string): readonly string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      return entry.isDirectory() ? walk(full) : [relative(root, full).split(sep).join('/')]
    })
  return walk(root)
}

export const fixtureLayout = (root: string): ProjectLayout => {
  const claude = parseClaudeBlock(readFileSync(join(root, 'CLAUDE.md'), 'utf8'))
  if (!claude.ok) throw new Error(`the fixture at ${root} must carry a project block`)
  return claude.value
}
