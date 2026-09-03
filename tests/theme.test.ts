/**
 * One property of the stylesheet, asserted over its source — because the DOM
 * test environment applies no CSS at all, and this particular rule is invisible
 * to every other check the project has.
 *
 * **A `<dialog>` may only be given `display` while it is open.** An author
 * declaration beats the UA's `dialog:not([open]) { display: none }` at any
 * specificity, so `.sheet { display: flex }` renders the ⌘K palette and the
 * project picker inline, in normal flow, in every window — which is exactly
 * what a missing layer declaration ships.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const css = readFileSync(join(import.meta.dirname, '../src/renderer/src/styles/theme.css'), 'utf8')

/** `.sheet` itself, not `.sheet-body`: only the dialog element is at risk. */
const SHEET = /\.sheet(?![-\w])/

/** Each rule as (selector, body); good enough for a file this size. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selector: (match[1] ?? '').trim(),
  body: match[2] ?? '',
}))

describe('theme.css', () => {
  test('has rules for the sheet at all, so the assertions below are not vacuous', () => {
    expect(rules.filter((rule) => SHEET.test(rule.selector))).not.toHaveLength(0)
  })

  test('never gives a closed `<dialog>` a display, which would make it visible', () => {
    const displaying = rules.filter(
      (rule) => SHEET.test(rule.selector) && /(^|[;\s])display\s*:/.test(rule.body),
    )

    expect(displaying).not.toHaveLength(0)
    for (const rule of displaying) {
      expect(rule.selector).toMatch(/\[open\]|:not\(\[open\]\)/)
    }
  })

  /**
   * Colour has exactly one spelling in this project, and after the terminal
   * scheme became a family over `--project-hue` there is no exception left:
   * `Pane` converts OKLCH to something `xterm` can parse rather than the theme
   * pre-baking a hex.
   */
  test('no colour is spelled as a raw hex anywhere', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  const TERM_TOKEN = /^\s*--(term-[\w-]+|color-term[\w-]*)\s*:/

  test('the terminal scheme is dark in both appearances: the program inside assumes it', () => {
    const scheme = css.split('\n').filter((line) => TERM_TOKEN.test(line))

    expect(scheme.length).toBeGreaterThanOrEqual(21)
    for (const line of scheme) {
      expect(line).toMatch(/oklch\(/)
      // A `light-dark()` here would repaint the pane under a TUI that painted
      // for the other scheme — the readability bug, in the other direction.
      expect(line).not.toMatch(/light-dark\(/)
    }
  })

  test('the ground and the greys follow the project hue; the six chromatic slots do not', () => {
    const slot = (name: string): string =>
      css.split('\n').find((line) => line.trim().startsWith(`${name}:`)) ?? ''

    // Identity: the surface, the text, and the two "grey" slots an agent's dim
    // output actually lands in.
    for (const name of ['--color-term', '--term-fg', '--term-ansi-0', '--term-ansi-8']) {
      expect(slot(name)).toContain('var(--project-hue)')
    }
    // Not identity: red must be red whatever project this is.
    for (const name of ['--term-ansi-1', '--term-ansi-2', '--term-ansi-4', '--term-ansi-9']) {
      expect(slot(name)).not.toContain('var(--project-hue)')
    }
  })
})
