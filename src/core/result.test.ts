/**
 * Two constructors and the narrowing they buy. The combinators this file used
 * to exercise went with them.
 */

import { describe, expect, test } from 'vitest'
import type { Result } from './result.js'
import { err, ok } from './result.js'

describe('result', () => {
  test('ok and err are discriminated by `ok`, so a check narrows the payload', () => {
    const success = ok(3)
    const failure = err({ kind: 'not-found' } as const)

    expect(success).toEqual({ ok: true, value: 3 })
    expect(failure).toEqual({ ok: false, error: { kind: 'not-found' } })

    // The narrowing is the point: read through the union, where the compiler
    // cannot see which arm it is, and both branches have to typecheck.
    const read = (result: Result<number, { readonly kind: string }>): string =>
      result.ok ? String(result.value) : result.error.kind
    expect(read(success)).toBe('3')
    expect(read(failure)).toBe('not-found')
  })

  test('a value of `undefined` is still a success, because absence is not failure', () => {
    expect(ok(undefined)).toEqual({ ok: true, value: undefined })
  })
})
