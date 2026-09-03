/**
 * Which links may leave the app. A note is untrusted input, so everything but
 * `http(s)` stays inside — and what comes back is the *parsed* href, because the
 * parser is what strips the control characters.
 */

import { describe, expect, test } from 'vitest'
import { externalUrl } from './url.js'

describe('externalUrl', () => {
  test('accepts web URLs', () => {
    for (const url of ['https://example.com', 'http://localhost:5173/x?y=1#z', 'HTTPS://EXAMPLE.COM']) {
      expect(externalUrl(url)).toBeDefined()
    }
  })

  test('rejects every non-web scheme, which is the point of the function', () => {
    for (const url of [
      'file:///Applications/Calculator.app',
      'smb://attacker/share',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vscode://file/etc/passwd',
      'mailto:someone@example.com',
      'ws://localhost:5173',
    ]) {
      expect(externalUrl(url)).toBeUndefined()
    }
  })

  test('rejects anything that is not an absolute URL', () => {
    for (const url of ['', '   ', 'example.com', '/etc/passwd', '../notes', 'not a url']) {
      expect(externalUrl(url)).toBeUndefined()
    }
  })

  test('returns the parsed href, not the raw string: the parser strips control characters', () => {
    // The caller opens what was validated, or it opens something else.
    expect(externalUrl('https://example.com/a\nb')).toBe('https://example.com/ab')
    expect(externalUrl('HTTPS://EXAMPLE.COM')).toBe('https://example.com/')
  })
})
