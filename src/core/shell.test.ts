/**
 * Quoting a dropped path so a shell reads it as one word. The cases are the ones
 * a screenshot's filename actually has: spaces, dots, and bytes outside ASCII.
 */

import { describe, expect, it } from 'vitest'
import { dropText, quoteForShell } from './shell.js'

describe('quoteForShell', () => {
  it('leaves an ordinary path bare', () => {
    expect(quoteForShell('/Users/ebr/notes/00_state.md')).toBe('/Users/ebr/notes/00_state.md')
  })

  it('quotes the spaces a real screenshot name has', () => {
    expect(quoteForShell('/Users/ebr/Desktop/Bildschirmfoto 2026-08-21 um 09.01.23.png')).toBe(
      "'/Users/ebr/Desktop/Bildschirmfoto 2026-08-21 um 09.01.23.png'",
    )
  })

  it('quotes a non-ASCII byte, which a bare word must not carry', () => {
    expect(quoteForShell('/tmp/Übersicht.png')).toBe("'/tmp/Übersicht.png'")
  })

  it("closes, escapes and reopens around a single quote", () => {
    expect(quoteForShell("/tmp/it's here.png")).toBe(String.raw`'/tmp/it'\''s here.png'`)
  })

  it('quotes the metacharacters that would otherwise run something', () => {
    expect(quoteForShell('/tmp/$(rm -rf ~)')).toBe("'/tmp/$(rm -rf ~)'")
    expect(quoteForShell('/tmp/a;b')).toBe("'/tmp/a;b'")
    expect(quoteForShell('/tmp/a`b`')).toBe('\'/tmp/a`b`\'')
  })

  it('quotes the empty string rather than emitting nothing', () => {
    expect(quoteForShell('')).toBe("''")
  })
})

describe('dropText', () => {
  it('types one path and leaves the cursor after a space', () => {
    expect(dropText(['/tmp/a.png'])).toBe('/tmp/a.png ')
  })

  it('separates several, quoting only what needs it', () => {
    expect(dropText(['/tmp/a.png', '/tmp/b c.png'])).toBe("/tmp/a.png '/tmp/b c.png' ")
  })

  it('types nothing at all for a drop that carried no path', () => {
    expect(dropText([])).toBe('')
  })

  it('never appends a newline: the pane may hold an agent mid-question', () => {
    expect(dropText(['/tmp/a.png'])).not.toContain('\n')
  })
})
