/**
 * The pure half of window creation: everything that is a decision rather than
 * an effect. `electron` is imported for types only (erased at build time), so
 * this module is testable in plain node — which is the only way the security
 * flags below can be asserted without launching the app.
 */

import { join } from 'node:path'
import type { BrowserWindowConstructorOptions } from 'electron'

/** Where the renderer comes from: the dev server, or the built bundle. */
export type RendererTarget = { readonly url: string } | { readonly file: string }

export const resolveRendererTarget = (devServerUrl: string | undefined, mainDir: string): RendererTarget =>
  devServerUrl === undefined ? { file: join(mainDir, '../renderer/index.html') } : { url: devServerUrl }

/**
 * The macOS chrome is a main-process concern, not CSS: vibrancy, the
 * hidden-inset title bar and the traffic-light offset are what make this read
 * as a Mac app rather than a web page in a frame.
 *
 * The preload must be the `.cjs` build: a sandboxed preload cannot be an ES
 * module, and `"type": "module"` would make a `.js` file one.
 */
export const windowOptions = (mainDir: string): BrowserWindowConstructorOptions => ({
  width: 1280,
  height: 860,
  minWidth: 720,
  minHeight: 480,
  show: false,
  titleBarStyle: 'hiddenInset',
  trafficLightPosition: { x: 16, y: 18 },
  vibrancy: 'sidebar',
  visualEffectState: 'active',
  backgroundColor: '#00000000',
  webPreferences: {
    preload: join(mainDir, '../preload/index.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
})
