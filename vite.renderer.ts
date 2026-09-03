import { resolve } from 'node:path'
import type { Plugin, UserConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwind from '@tailwindcss/vite'

export const alias = {
  '@core': resolve('src/core'),
  '@shared': resolve('src/shared'),
}

/**
 * The production CSP is `default-src 'none'`, which also blocks Vite's HMR
 * websocket — with no error anyone notices, so edits appear to do nothing.
 * Dev servers get `connect-src` added; the shipped policy is untouched.
 */
const devCsp = (): Plugin => ({
  name: 'wikiviewer:dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) =>
    html.replace("default-src 'none';", "default-src 'none'; connect-src 'self' ws://localhost:* http://localhost:*;"),
})

/** The renderer build, shared by the Electron build and the browser dev server. */
export const rendererConfig = (): UserConfig => ({
  root: resolve('src/renderer'),
  plugins: [solid(), tailwind(), devCsp()],
  resolve: { alias },
  build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
})
