/**
 * The window's security flags and its macOS chrome, asserted without launching
 * anything — which is the only reason they can be asserted at all.
 */

import { describe, expect, test } from 'vitest'
import { resolveRendererTarget, windowOptions } from './windowOptions.js'

describe('resolveRendererTarget', () => {
  test('uses the dev server when one is set', () => {
    expect(resolveRendererTarget('http://localhost:5173', '/app/out/main')).toEqual({
      url: 'http://localhost:5173',
    })
  })

  test('falls back to the built bundle beside the main bundle', () => {
    expect(resolveRendererTarget(undefined, '/app/out/main')).toEqual({
      file: '/app/out/renderer/index.html',
    })
  })
})

describe('windowOptions', () => {
  // These four flags are the app's security posture (CLAUDE.md "hard rules").
  // Asserting them here is what stops a future edit from quietly relaxing one.
  test('keeps the renderer sandboxed and isolated', () => {
    const web = windowOptions('/app/out/main').webPreferences
    expect(web).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false })
  })

  test('points at the CJS preload, which is the only kind a sandbox can load', () => {
    const web = windowOptions('/app/out/main').webPreferences
    expect(web?.preload).toBe('/app/out/preload/index.cjs')
  })

  test('asks for the native macOS chrome', () => {
    const options = windowOptions('/app/out/main')
    expect(options.titleBarStyle).toBe('hiddenInset')
    expect(options.vibrancy).toBe('sidebar')
    expect(options.show).toBe(false)
  })
})
