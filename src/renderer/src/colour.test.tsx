// @vitest-environment happy-dom
/**
 * The conversion itself belongs to the browser and is verified in the packaged
 * app; what is worth pinning here is the **refusal path**, because its failure
 * mode is silent and black. A document that cannot convert — this one — must
 * hand the value back untouched rather than hand `xterm` a colour nobody chose.
 */

import { describe, expect, test } from 'vitest'
import { createColourReader } from './colour.js'

describe('the colour reader', () => {
  test('passes a value through when the document cannot convert it', () => {
    const read = createColourReader()

    expect(read('oklch(0.38 0.105 210)')).toBe('oklch(0.38 0.105 210)')
    expect(read('#123456')).toBe('#123456')
  })

  test('never answers with the empty string, which `xterm` would paint black', () => {
    const read = createColourReader()

    expect(read('')).toBe('')
  })
})
