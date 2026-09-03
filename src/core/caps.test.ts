/**
 * The gauge's arithmetic: which kinds have a ceiling, and what "near" and "over"
 * mean. A cap is *reported* and never enforced, so the only way to get this wrong
 * is silently.
 */

import { describe, expect, test } from 'vitest'
import type { WikiFileKind } from './classify.js'
import { capFor, capStatus } from './caps.js'

describe('capFor', () => {
  test.each<[WikiFileKind, number | undefined]>([
    [{ kind: 'state' }, 60],
    [{ kind: 'register', register: 'decisions' }, 100],
    [{ kind: 'claudeMd' }, 150],
    [{ kind: 'note', number: 2, topic: 'design' }, undefined],
    [{ kind: 'journal', date: '2026-08-18', slug: 'a' }, undefined],
    [{ kind: 'archive' }, undefined],
    [{ kind: 'other' }, undefined],
  ])('%o has cap %s', (kind, expected) => {
    expect(capFor(kind)).toBe(expected)
  })
})

describe('capStatus', () => {
  test('reports the bands the sidebar colours', () => {
    expect(capStatus(41, 60)).toMatchObject({ kind: 'ok' })
    // 80 % is amber, not "nearly amber": the boundary is inclusive.
    expect(capStatus(48, 60)).toMatchObject({ kind: 'near' })
    expect(capStatus(60, 60)).toMatchObject({ kind: 'near' })
    expect(capStatus(61, 60)).toMatchObject({ kind: 'over' })
    expect(capStatus(103, 100)).toMatchObject({ kind: 'over', lines: 103, cap: 100 })
  })

  test('carries the fraction the gauge draws', () => {
    expect(capStatus(50, 100).kind === 'ok' && capStatus(50, 100)).toMatchObject({ fraction: 0.5 })
    const over = capStatus(150, 100)
    expect(over.kind === 'over' && over.fraction).toBe(1.5)
  })

  test('an uncapped file reports its lines and no cap', () => {
    expect(capStatus(900, undefined)).toEqual({ kind: 'uncapped', lines: 900 })
  })

  test('an empty capped file is ok, not near', () => {
    expect(capStatus(0, 100)).toMatchObject({ kind: 'ok', fraction: 0 })
  })
})
