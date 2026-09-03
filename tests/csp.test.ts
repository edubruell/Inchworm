/**
 * The CSP is the renderer's only containment: it holds untrusted note content
 * inside a process that carries the privileged bridge. It is one line of HTML
 * that nothing else checks, in both the source and the built copy — the build
 * rewrites that file.
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const cspOf = (html: string): string => {
  const match = /Content-Security-Policy"[\s\S]*?content="([^"]+)"/.exec(html)
  if (match?.[1] === undefined) throw new Error('no Content-Security-Policy meta tag')
  return match[1]
}

const assertLocked = (csp: string): void => {
  expect(csp).toContain("default-src 'none'")
  expect(csp).toMatch(/script-src 'self'(;|$)/)
  expect(csp).not.toContain('unsafe-inline; script')
  expect(csp).not.toContain('unsafe-eval')
  expect(csp).not.toMatch(/https?:\/\//)
}

describe('renderer CSP', () => {
  test('the source policy denies everything not explicitly allowed', () => {
    assertLocked(cspOf(readFileSync('src/renderer/index.html', 'utf8')))
  })

  // CI builds before it tests, so a missing `out/` there is a broken gate, not a
  // convenience. The skip exists only for a local run against a clean tree.
  const noBuild = !existsSync('out/renderer/index.html')
  test.skipIf(noBuild && process.env.CI === undefined)('the built policy survives the build', () => {
    assertLocked(cspOf(readFileSync('out/renderer/index.html', 'utf8')))
  })
})
