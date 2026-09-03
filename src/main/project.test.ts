/** A folder built for one assertion, in the OS temp dir rather than the repo. */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadProject, markersFor } from './project.js'

const fixture = (name: string): string => join(import.meta.dirname, '../../tests/fixtures', name)

const BLOCK = `# a project

## Project memory (llmwiki)
- Wiki root: local_context/wiki/
- Journal: local_context/notes/
- Kind: software
`

const scratch = async (files: Record<string, string>): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'wikiviewer-project-'))
  for (const [name, text] of Object.entries(files)) {
    if (text === '') {
      await mkdir(join(dir, name), { recursive: true })
    } else {
      await writeFile(join(dir, name), text, 'utf8')
    }
  }
  return dir
}

describe('loadProject', () => {
  test('reads the layout out of a real project', async () => {
    const result = await loadProject(fixture('sample-wiki'))
    expect(result.ok && result.value.layout).toEqual({
      wikiRoot: 'local_context/wiki/',
      journal: 'local_context/notes/',
      kind: 'software',
    })
  })

  test('a folder that is not there is not a project', async () => {
    const result = await loadProject(fixture('no-such-folder'))
    expect(result.ok ? 'ok' : result.error.kind).toBe('not-a-directory')
  })

  test('a file is not a folder', async () => {
    const result = await loadProject(fixture('sample-wiki/CLAUDE.md'))
    expect(result.ok ? 'ok' : result.error.kind).toBe('not-a-directory')
  })

  test('a folder with no agent file at all is refused, with the evidence', async () => {
    const result = await loadProject(fixture('sample-wiki/local_context'))

    expect(result.ok ? undefined : result.error).toEqual({
      kind: 'no-llmwiki',
      dir: fixture('sample-wiki/local_context'),
      markers: { agentFiles: [], wiki: false },
      // Nothing was parsed, so there is no parse failure to report.
      detail: undefined,
    })
  })

  // Every shape `parseClaudeBlock` refuses must fail here too: this is the gate
  // that decides which directories main will ever read.
  test.each(['no-block', 'empty-value', 'fenced-only', 'absolute-root', 'escaping-root'])(
    'refuses the %s fixture, and says which agent file it read',
    async (name) => {
      const result = await loadProject(fixture(join('broken-projects', name)))

      expect(result.ok ? 'ok' : result.error.kind).toBe('no-llmwiki')
      expect(result.ok ? [] : result.error.kind === 'no-llmwiki' && result.error.markers.agentFiles).toEqual([
        'CLAUDE.md',
      ])
      expect(result.ok || (result.error.kind === 'no-llmwiki' && result.error.detail !== undefined)).toBe(true)
    },
  )
})

describe('AGENTS.md is a project marker, not only a diagnosis', () => {
  test('a folder with only AGENTS.md opens as an ordinary project', async () => {
    const dir = await scratch({ 'AGENTS.md': BLOCK })

    const result = await loadProject(dir)

    expect(result.ok && result.value.layout.wikiRoot).toBe('local_context/wiki/')
  })

  test('CLAUDE.md wins when both declare a layout', async () => {
    const dir = await scratch({
      'CLAUDE.md': BLOCK,
      'AGENTS.md': BLOCK.replace('local_context/wiki/', 'other/wiki/'),
    })

    const result = await loadProject(dir)

    expect(result.ok && result.value.layout.wikiRoot).toBe('local_context/wiki/')
  })

  test('a CLAUDE.md with no block falls through to AGENTS.md rather than refusing', async () => {
    const dir = await scratch({ 'CLAUDE.md': '# just prose\n', 'AGENTS.md': BLOCK })

    const result = await loadProject(dir)

    expect(result.ok && result.value.layout.kind).toBe('software')
  })

  test('neither carrying a block is one refusal naming both files', async () => {
    const dir = await scratch({ 'CLAUDE.md': '# prose\n', 'AGENTS.md': '# prose\n' })

    const result = await loadProject(dir)

    expect(result.ok ? [] : result.error.kind === 'no-llmwiki' && result.error.markers.agentFiles).toEqual([
      'CLAUDE.md',
      'AGENTS.md',
    ])
  })
})

describe('markersFor — the evidence the picker shows', () => {
  test('an empty folder has nothing, and says so without failing', async () => {
    expect(await markersFor(await scratch({}))).toEqual({ agentFiles: [], wiki: false })
  })

  test('a half-finished init is visible: a wiki directory and no agent file', async () => {
    const dir = await scratch({ 'local_context/wiki': '' })

    expect(await markersFor(dir)).toEqual({ agentFiles: [], wiki: true })
  })

  test('a folder that does not exist is not an exception', async () => {
    expect(await markersFor('/no/such/folder/anywhere')).toEqual({ agentFiles: [], wiki: false })
  })
})
