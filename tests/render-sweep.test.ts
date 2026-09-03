/**
 * `renderHtml` over real bytes rather than inline strings.
 *
 * The properties below are the ones the module exists to hold, and they are
 * asserted over every file of both fixtures — which is what would have caught
 * the text-loss defects a hand-written case has to be aimed at: a paragraph is
 * not allowed to get shorter because a link was in it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildLinkIndex, resolveLink } from '@core/links.js'
import { parseNote } from '@core/note.js'
import { renderHtml } from '@core/render.js'
import { fixtureLayout, listFiles } from './support/fixture.js'

const fixtures = [
  { name: 'sample-wiki', root: join(import.meta.dirname, 'fixtures/sample-wiki') },
  { name: 'edge-cases', root: join(import.meta.dirname, 'fixtures/edge-cases') },
] as const

/** The lines that are supposed to reach the page: everything after frontmatter. */
const bodyLines = (text: string): readonly string[] => {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return lines
  const close = lines.findIndex((line, at) => at > 0 && line.trim() === '---')
  return close === -1 ? lines : lines.slice(close + 1)
}

/**
 * The last substantial word of every body line — the character a dropped tail
 * takes with it. Short words and URLs are skipped: they collide across lines
 * and would pass by accident.
 */
const lastWords = (text: string): readonly string[] =>
  bodyLines(text).flatMap((line) => {
    const last = line.replace(/[#*`>_[\]|-]/g, ' ').trim().split(/\s+/).at(-1)
    return last === undefined || last.length < 8 || /^https?:/.test(last) ? [] : [last]
  })

/** The text a reader should still see, with markup and link syntax removed. */
const visibleText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&#x26;|&amp;/g, '&')
    .replace(/&#x3C;|&lt;/g, '<')
    .replace(/&#x22;|&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

describe.each(fixtures)('renderHtml over $name', (fixture) => {
  const layout = fixtureLayout(fixture.root)
  const files = listFiles(fixture.root).filter((path) => path.endsWith('.md'))
  const index = buildLinkIndex(files, layout)

  test('the fixture has files to sweep', () => {
    expect(files.length).toBeGreaterThan(3)
  })

  test.each(files)('%s renders', (path) => {
    const text = readFileSync(join(fixture.root, path), 'utf8')
    const note = parseNote(text)
    if (note.kind !== 'parsed') {
      // An unparsed file is shown raw; there is nothing to render.
      expect(note.refusal.kind).toBeDefined()
      return
    }
    const rendered = renderHtml(note.ast, note.links, (target) => resolveLink(target, index))
    expect(rendered.ok).toBe(true)
    if (!rendered.ok) return
    const html = rendered.value

    // 1. Every link the backlink index counts is an element, or is left as the
    //    literal text of the file — never silently dropped.
    const elements = html.match(/<a class="wikilink"|<span class="wikilink-broken"/g) ?? []
    const literals = html.match(/\[\[/g) ?? []
    expect(elements.length + literals.length).toBeGreaterThanOrEqual(note.links.length)

    // 2. Every path a link points at is a file this project has.
    for (const match of html.matchAll(/data-path="([^"]+)"/g)) expect(files).toContain(match[1])

    // 3. No word of the file is lost. Headings and paragraph text survive the
    //    round trip; the check is per line, so a dropped tail is visible.
    //    Frontmatter is excluded: it renders as the header card, not as body.
    const visible = visibleText(html)
    for (const word of lastWords(text)) expect(visible).toContain(word)
  })
})
