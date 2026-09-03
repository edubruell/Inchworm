import { defineConfig } from 'vite'
import { rendererConfig } from './vite.renderer.js'

/**
 * Renderer-only dev server for reviewing the interface in a browser (the
 * iteration review protocol in CLAUDE.md). There is no preload here, so
 * `window.wiki` is absent and the renderer must degrade visibly rather than
 * throw — see `src/renderer/src/bridge.ts`.
 */
export default defineConfig({
  ...rendererConfig(),
  server: { port: 5273, strictPort: true },
})
