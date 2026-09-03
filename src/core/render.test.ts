/** The viewer's own path: parse once, then render that AST and those links. */

import { describe, expect, test } from 'vitest'
import type { WikiLink } from './links.js'
import { buildLinkIndex, extractLinks, resolveLink } from './links.js'
import { toMdast } from './markdown.js'
import { parseNote } from './note.js'
import type { ProjectLayout } from './project.js'
import { renderHtml } from './render.js'

const layout: ProjectLayout = { wikiRoot: 'wiki', journal: 'notes', kind: 'software' }
const index = buildLinkIndex(['wiki/00_state.md', 'wiki/02_architecture.md', 'wiki/decisions.md'], layout)
const resolve = (target: string): ReturnType<typeof resolveLink> => resolveLink(target, index)

const render = (markdown: string): string => {
  const ast = toMdast(markdown)
  const rendered = renderHtml(ast, extractLinks(ast, markdown), resolve)
  if (!rendered.ok) throw new Error(`refused: ${rendered.error.kind}`)
  return rendered.value
}

describe('renderHtml', () => {
  test.each([
    ['a heading, one level down', '# Title', '<h2>Title</h2>'],
    ['emphasis', 'a *b* c', '<p>a <em>b</em> c</p>'],
    ['a list', '- one\n- two', '<li>one</li>'],
    ['a fenced block', '```ts\nconst a = 1\n```', '<code class="language-ts">'],
    ['a web link', '[docs](https://example.com)', '<a href="https://example.com">docs</a>'],
  ])('renders %s', (_name, markdown, expected) => {
    expect(render(markdown)).toContain(expected)
  })

  describe('headings are demoted, because the view already has an h1', () => {
    test.each([
      ['# a', '<h2>a</h2>'],
      ['## a', '<h3>a</h3>'],
      ['### a', '<h4>a</h4>'],
      ['#### a', '<h5>a</h5>'],
      ['##### a', '<h6>a</h6>'],
      // Nothing below h6 exists, so the deepest level absorbs the shift rather
      // than emitting an `h7` no browser knows.
      ['###### a', '<h6>a</h6>'],
    ])('%s renders as %s', (markdown, expected) => {
      expect(render(markdown)).toContain(expected)
    })

    test('no rendered note can contain an h1', () => {
      expect(render('# a\n\n## b\n\n> # quoted\n\n- # in a list')).not.toContain('<h1')
    })

    test('the count of headings is unchanged, so the outline rail still scrolls by ordinal', () => {
      const html = render('# a\n\n## b\n\n### c')
      expect(html.match(/<h[1-6]>/g)).toHaveLength(3)
    })
  })

  test('an empty document renders nothing', () => {
    expect(render('')).toBe('')
  })

  describe('wikilinks', () => {
    test('a resolved link is an anchor carrying its path', () => {
      expect(render('see [[02_architecture]] now')).toBe(
        '<p>see <a class="wikilink" href="#" data-target="02_architecture" data-path="wiki/02_architecture.md" title="wiki/02_architecture.md">02_architecture</a> now</p>',
      )
    })

    test('an unresolved link is a span, so it cannot be clicked or focused', () => {
      const html = render('see [[99_ghost]]')
      expect(html).toContain('<span class="wikilink-broken" data-target="99_ghost"')
      expect(html).not.toContain('<a')
      expect(html).toContain('Unresolved link: no file named 99_ghost')
    })

    test.each([
      ['a label', '[[decisions|the ruling]]', '>the ruling</a>'],
      ['an anchor in the shown text', '[[decisions#2026-08-19]]', '>decisions#2026-08-19</a>'],
      ['the target, not the anchor, for resolution', '[[decisions#anything]]', 'data-path="wiki/decisions.md"'],
    ])('uses %s', (_name, markdown, expected) => {
      expect(render(markdown)).toContain(expected)
    })

    test('several links in one paragraph all become elements', () => {
      const html = render('[[00_state]] and [[decisions]] and [[nope]]')
      expect(html.match(/<a class="wikilink"/g)).toHaveLength(2)
      expect(html).toContain('<span class="wikilink-broken"')
    })

    test('a link inside a code span or fence stays literal text', () => {
      const html = render('`[[00_state]]` and\n\n```\n[[00_state]]\n```')
      expect(html).not.toContain('wikilink')
      expect(html.match(/\[\[00_state\]\]/g)).toHaveLength(2)
    })

    test('an empty target is left as literal text, exactly as the extractor leaves it', () => {
      const html = render('[[ ]] and [[|label]]')
      expect(html).not.toContain('wikilink')
      expect(html).toContain('[[ ]] and [[|label]]')
    })

    test('a label containing inline markup is still one link', () => {
      const html = render('see [[decisions|the *first* ruling]] here')
      expect(html).toContain('data-path="wiki/decisions.md"')
      expect(html).toContain('>the *first* ruling</a>')
      expect(html).toContain('see ')
      expect(html).toContain(' here')
    })

    test('every link the backlink index counts is rendered as an element', () => {
      const markdown = 'a [[00_state]] b `[[skipped]]` c [[decisions|with *markup*]] d [[nope]]\n'
      const ast = toMdast(markdown)
      const links = extractLinks(ast, markdown)
      const rendered = renderHtml(ast, links, resolve)
      if (!rendered.ok) throw new Error('must render')
      const elements = rendered.value.match(/<a class="wikilink"|<span class="wikilink-broken"/g)
      expect(elements).toHaveLength(links.length)
    })

    test('a link on a continuation line of a list item is cut in the right place', () => {
      // Inside an indented list item a text
      // node's value is shorter than the source it spans, so cutting by offset
      // arithmetic leaks half a link's source into the page.
      const html = render('- 486 tests.\n  [[decisions]]\n- next\n')
      expect(html).not.toContain('[[')
      expect(html).not.toContain(']]')
      expect(html).toContain('486 tests.')
      expect(html).toContain('data-path="wiki/decisions.md"')
    })

    test('a link split across lines inside a nested list keeps the text around it', () => {
      const html = render('- a\n  - see [[00_state]] and\n    [[decisions]] too\n')
      expect(html.match(/<a class="wikilink"/g)).toHaveLength(2)
      expect(html).toContain(' too')
      expect(html).not.toContain('[[')
    })

    test('a link splits text without losing a character', () => {
      expect(render('before [[00_state]] after')).toContain('before ')
      expect(render('before [[00_state]] after')).toContain(' after')
    })
  })

  describe('gfm', () => {
    // The schema is written in tables: every register index, every budget row.
    test('a table is a table, not a paragraph of pipes', () => {
      const html = render('| a | b |\n| - | - |\n| 1 | 2 |\n')
      expect(html).toContain('<table>')
      expect(html).toContain('<th>a</th>')
      expect(html).toContain('<td>2</td>')
      expect(html).not.toContain('| a |')
    })

    test('a wikilink inside a table cell is still a link', () => {
      const html = render('| note | why |\n| - | - |\n| [[decisions]] | a ruling |\n')
      expect(html).toContain('data-path="wiki/decisions.md"')
      expect(html).toContain('<td>a ruling</td>')
    })

    test.each([
      ['strikethrough', '~~gone~~', '<del>gone</del>'],
      ['a task list', '- [x] done', 'type="checkbox"'],
    ])('renders %s', (_name, markdown, expected) => {
      expect(render(markdown)).toContain(expected)
    })
  })

  describe('never loses the text around a link', () => {
    // Every case here is one that can lose the rest of its paragraph. The rule
    // the module holds to: a link that
    // cannot be placed renders as the literal `[[…]]` in the file — never as
    // an excuse to drop what follows it.
    test.each([
      ['an escaped underscore in the target', 'Intro [[05\\_plan]] and then important prose.', 'important prose.'],
      ['a character reference in the target', 'Q: [[R&amp;D]] and the rest of the sentence.', 'the rest of the sentence.'],
      ['an empty-target link earlier in the line', 'Prefix [[#anchor]] middle and [[00_state]] tail.', 'middle and'],
      ['a label with a bracket in it', 'A [[a|see [x](url) note]] and the tail.', 'and the tail.'],
      ['a label spanning a hard break', 'A [[a|wraps\nhere]] and the tail.', 'and the tail.'],
    ])('keeps the prose after %s', (_name, markdown, kept) => {
      expect(render(markdown)).toContain(kept)
    })

    test('an escaped target still renders as a link', () => {
      // The second candidate: `[[05\_plan]]` is `[[05_plan]]` once remark has
      // decoded the text, so the marker is found after unescaping.
      expect(render('see [[00\\_state]] now')).toContain('data-path="wiki/00_state.md"')
    })

    test('a wikilink inside a markdown link stays literal, not a nested anchor', () => {
      const html = render('A [text [[00_state]] more](https://example.com) tail.')
      expect(html).not.toContain('wikilink')
      expect(html).toContain('more</a>')
      expect(html).toContain(' tail.')
    })

    test('a link that cannot be placed is left as the text the file has', () => {
      // A character reference decodes to something the source never contained,
      // so neither candidate is found and the link stays literal — visibly a
      // to-do rather than an invisible deletion.
      const html = render('Q: [[R&amp;D]] and the rest.')
      expect(html).toContain('[[R&#x26;D]]')
      expect(html).toContain('and the rest.')
    })

    test('an empty label falls back to the target rather than an empty anchor', () => {
      const html = render('See [[00_state|]] tail.')
      expect(html).toContain('>00_state</a>')
      expect(html).toContain(' tail.')
    })
  })

  describe('safety', () => {
    test.each([
      ['a script tag', '<script>alert(1)</script>'],
      ['an event handler', '<img src=x onerror="alert(1)">'],
      ['an iframe', '<iframe src="https://evil.example"></iframe>'],
      ['raw html around text', '<div onclick="steal()">hello</div>'],
    ])('drops %s', (_name, markdown) => {
      const html = render(markdown)
      expect(html).not.toContain('script')
      expect(html).not.toContain('onerror')
      expect(html).not.toContain('onclick')
      expect(html).not.toContain('iframe')
    })

    test.each([
      ['javascript:', '[x](javascript:alert(1))'],
      ['file:', '[x](file:///etc/passwd)'],
    ])('strips a %s href', (_name, markdown) => {
      const html = render(markdown)
      expect(html).not.toContain('javascript:')
      expect(html).not.toContain('file:')
    })

    test('a note cannot forge a resolved wikilink through raw html', () => {
      const html = render('<a class="wikilink" href="#" data-path="../../etc/passwd">x</a>')
      expect(html).not.toContain('data-path')
      expect(html).not.toContain('wikilink')
    })

    test('html inside a wikilink label is shown as text, never as markup', () => {
      const html = render('[[00_state|<b>bold</b>]]')
      expect(html).toContain('data-path="wiki/00_state.md"')
      expect(html).not.toContain('<b>')
    })
  })

  test('renders the AST parseNote already produced, without re-parsing', () => {
    const note = parseNote('# Note\n\nsee [[00_state]]\n')
    if (note.kind !== 'parsed') throw new Error('fixture must parse')
    const html = renderHtml(note.ast, note.links, resolve)
    expect(html.ok && html.value).toContain('data-path="wiki/00_state.md"')
  })

  test('a frontmatter block is not rendered into the body', () => {
    const note = parseNote('---\nstatus: active\n---\n\n# Title\n')
    if (note.kind !== 'parsed') throw new Error('fixture must parse')
    const html = renderHtml(note.ast, note.links, resolve)
    expect(html.ok && html.value).not.toContain('status: active')
    expect(html.ok && html.value).toContain('<h2>Title</h2>')
  })

  test('a note too deeply nested to render is refused, not thrown', () => {
    // Deep enough to overflow the recursion inside mdast-util-to-hast, and
    // shallow enough that `PARSE_BUDGET` still admits it — the gap the refusal
    // exists to cover. The depth at which it breaks is environment-dependent.
    const deep = `${'> '.repeat(3800)}[[00_state]]`
    const ast = toMdast(deep)
    const rendered = renderHtml(ast, extractLinks(ast, deep), resolve)
    expect(rendered.ok).toBe(false)
    expect(rendered.ok ? undefined : rendered.error.kind).toBe('too-deep')
  })

  describe('when the links and the tree disagree', () => {
    // These call `renderHtml` with a hand-made link list whose offsets lie —
    // the disagreement the module is written to make unrepresentable. They are
    // here because the arms that handle it are the ones a real file will never
    // reach, and an untested refusal is half a contract.
    const lying = (markdown: string, links: readonly Partial<WikiLink>[]): string => {
      const ast = toMdast(markdown)
      const full = links.map((link) => ({
        raw: 'x',
        target: 'x',
        anchor: undefined,
        label: undefined,
        line: 1,
        column: 1,
        offset: 0,
        ...link,
      }))
      const rendered = renderHtml(ast, full, resolve)
      if (!rendered.ok) throw new Error('must render')
      return rendered.value
    }

    test('a link whose text is nowhere in the node is skipped, and the text stands', () => {
      const html = lying('Just some prose here.', [{ raw: 'ghost', target: 'ghost', offset: 5 }])
      expect(html).toBe('<p>Just some prose here.</p>')
    })

    test('a link that opens and never closes leaves the paragraph exactly as it was', () => {
      // `[[a|` opens (it is a prefix of the marker) and the closing `]]` never
      // arrives, so the transformation is abandoned rather than half-applied.
      const html = lying('Start [[a|and no end of it', [{ raw: 'a|and no end of it]] more', target: 'a', offset: 6 }])
      expect(html).toContain('Start')
      expect(html).toContain('and no end of it')
      expect(html).not.toContain('wikilink')
    })
  })

  test('a failure that is not the stack limit is not swallowed', () => {
    // The refusal covers one known library limit; a bug in the caller's resolver
    // is a broken invariant and must reach the console, not become "too deep".
    const ast = toMdast('see [[00_state]]')
    const links = extractLinks(ast, 'see [[00_state]]')
    expect(() =>
      renderHtml(ast, links, () => {
        throw new Error('resolver bug')
      }),
    ).toThrow('resolver bug')
  })

  // What the Settings sheet promises about ⌘E: the markers go, the words stay.
  // True of every shape `tagInsertion` produces, including a multi-line and a
  // multi-paragraph selection.
  test('a note tag loses its markers and keeps its words', () => {
    expect(render('before <eddy>a question for you</eddy> after')).toBe('<p>before a question for you after</p>')
    expect(render('<eddy>one\ntwo</eddy>')).toContain('two')
    expect(render('<eddy>first\n\nsecond</eddy>')).toContain('second')
  })

  // And the one shape where it is not true, pinned so the copy can stay honest:
  // an opening tag alone on its line is a CommonMark HTML block, and the whole
  // block is dropped, words included. Reachable by ⌘E over a selection that
  // begins at a line break (re-immersion review, 2026-09-02).
  test('a tag alone on its line takes the words with it', () => {
    expect(render('<eddy>\na whole paragraph of it\n</eddy>')).toBe('')
  })

  test('nesting the viewer meets in practice renders fine', () => {
    // A real wiki measures a deepest nesting of about 32.
    expect(render(`${'> '.repeat(64)}[[00_state]]`)).toContain('wikilink')
  })
})
