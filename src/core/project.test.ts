/**
 * Reading the llmwiki block out of an agent file: the block, never an
 * illustration of it, and never a root that escapes the project. This is the
 * first gate on which directories main will ever read.
 */

import { describe, expect, test } from 'vitest'
import { parseClaudeBlock } from './project.js'

const block = `# a project

## Project memory (llmwiki)
- Wiki root: local_context/wiki/
- Journal: local_context/notes/
- Kind: software
- Schema + workflows: \`/llmwiki\` skill.
`

describe('parseClaudeBlock', () => {
  test('reads the machine-readable lines the skill writes', () => {
    const parsed = parseClaudeBlock(block)
    expect(parsed).toEqual({
      ok: true,
      value: { wikiRoot: 'local_context/wiki/', journal: 'local_context/notes/', kind: 'software' },
    })
  })

  test('normalises the two directories so they are comparable prefixes', () => {
    const parsed = parseClaudeBlock('- Wiki root: ./wiki\n- Journal: notes//\n')
    expect(parsed.ok && parsed.value.wikiRoot).toBe('wiki/')
    expect(parsed.ok && parsed.value.journal).toBe('notes/')
  })

  test('tolerates bold labels and extra spacing', () => {
    const parsed = parseClaudeBlock('  -   **Wiki root**:   w/  \n- Journal: j/\n')
    expect(parsed.ok && parsed.value.wikiRoot).toBe('w/')
  })

  // Several projects write the paths as inline code spans, as the skill's own
  // hooks accept; the backticks are markup, not part of the path.
  test('strips inline-code backticks around a path', () => {
    const parsed = parseClaudeBlock('- Wiki root: `local_context/wiki/`\n- Journal: `local_context/session_logs/`\n')
    expect(parsed.ok && parsed.value.wikiRoot).toBe('local_context/wiki/')
    expect(parsed.ok && parsed.value.journal).toBe('local_context/session_logs/')
  })

  test('a value of nothing but backticks is an unfilled label', () => {
    const parsed = parseClaudeBlock('- Wiki root: ``\n- Journal: j/\n')
    expect(!parsed.ok && parsed.error.kind).toBe('no-wiki-root')
  })

  test('backticks do not smuggle an escaping root past the safety check', () => {
    const parsed = parseClaudeBlock('- Wiki root: `../elsewhere/`\n- Journal: j/\n')
    expect(!parsed.ok && parsed.error.kind).toBe('unsafe-root')
  })

  // Kind is the schema's only optional line: research projects have no
  // budgets.md, and a block without it is not malformed.
  test('a missing Kind line means a research project', () => {
    const parsed = parseClaudeBlock('- Wiki root: w/\n- Journal: j/\n')
    expect(parsed.ok && parsed.value.kind).toBe('research')
  })

  test.each([
    ['- Journal: j/\n', 'no-wiki-root'],
    ['- Wiki root: w/\n', 'no-journal'],
    ['a folder with no block at all\n', 'no-wiki-root'],
  ])('%j fails with %s', (text, kind) => {
    const parsed = parseClaudeBlock(text)
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.error.kind).toBe(kind)
  })

  describe('malformed and hostile blocks (M1 review, `findings` 2026-08-19)', () => {
    test('an empty value fails instead of swallowing the next line', () => {
      const parsed = parseClaudeBlock('- Wiki root: \n- Journal: n/\n')
      expect(!parsed.ok && parsed.error.kind).toBe('no-wiki-root')
    })

    test('a fenced illustration of the block does not win over the real one', () => {
      const text = ['```', '- Wiki root: example/wiki/', '- Journal: example/notes/', '```', '', '- Wiki root: real/wiki/', '- Journal: real/notes/', ''].join('\n')
      const parsed = parseClaudeBlock(text)
      expect(parsed.ok && parsed.value.wikiRoot).toBe('real/wiki/')
    })

    test('a tilde-fenced illustration is skipped too, and an unclosed fence hides the rest', () => {
      const text = ['~~~yaml', '- Wiki root: example/', '- Journal: example/n/', '~~~', '- Wiki root: real/', '- Journal: real/n/'].join('\n')
      expect(parseClaudeBlock(text)).toEqual({ ok: true, value: { wikiRoot: 'real/', journal: 'real/n/', kind: 'research' } })
    })

    test.each([
      ['absolute', '/Users/x/wiki/'],
      ['home-relative', '~/wiki/'],
      ['escaping', '../../etc/'],
      ['escaping mid-path', 'wiki/../../etc/'],
      ['the project root', './'],
      ['the project root, spelled bare', '.'],
    ])('a %s wiki root is rejected: main builds its allow-list from this', (_label, root) => {
      const parsed = parseClaudeBlock(`- Wiki root: ${root}\n- Journal: notes/\n`)
      expect(!parsed.ok && parsed.error.kind).toBe('unsafe-root')
    })

    test('the journal is checked as strictly as the wiki root', () => {
      const parsed = parseClaudeBlock('- Wiki root: wiki/\n- Journal: /tmp/\n')
      expect(!parsed.ok && parsed.error).toEqual({ kind: 'unsafe-root', field: 'Journal', path: '/tmp/' })
    })

    test('CRLF line endings parse to the same layout as LF', () => {
      const parsed = parseClaudeBlock('- Wiki root: wiki/\r\n- Journal: notes/\r\n- Kind: software\r\n')
      expect(parsed).toEqual({ ok: true, value: { wikiRoot: 'wiki/', journal: 'notes/', kind: 'software' } })
    })
  })
})
