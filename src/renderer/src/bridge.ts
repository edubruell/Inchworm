/**
 * The renderer's one look at `window.wiki`, so that "is the bridge there?" is
 * asked in a single place and answered the same way everywhere.
 */

import type { WikiApi } from '@shared/api.js'

declare global {
  // An interface, not a type alias: augmenting `Window` requires declaration
  // merging, which only interfaces do. The one sanctioned exception.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    readonly wiki?: WikiApi
  }
}

/**
 * The bridge is absent in two situations that must not both look like a blank
 * window: the renderer-only dev server used for visual review (`npm run
 * dev:web`, no preload at all), and a packaged build whose preload failed to
 * load. Callers get `undefined` and render a state that says so.
 */
export const bridge = (): WikiApi | undefined => window.wiki
