import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import { alias } from './vite.renderer.js'

/**
 * The **browser** build of solid, pinned by path. Vitest runs in node, where
 * solid's export map hands out the SSR build — in which every effect is inert,
 * so a reactive test passes by never running anything (`gotchas`). Conditions
 * alone do not fix it: the test transform resolves through the `node` branch.
 *
 * Anchored patterns, not bare strings: a string alias also swallows
 * `solid-js/web` and rewrites it to `…/dist/dev.js/web`, which resolves to
 * nothing.
 */
const aliases = [
  ...Object.entries(alias).map(([find, replacement]) => ({ find, replacement })),
  { find: /^solid-js$/, replacement: resolve('node_modules/solid-js/dist/dev.js') },
  { find: /^solid-js\/web$/, replacement: resolve('node_modules/solid-js/web/dist/dev.js') },
]

export default defineConfig({
  // Also at the root, and not only inside the projects: `npm run nav` runs
  // `scripts/nav.ts` through `vite-node --config vitest.config.ts`, which reads
  // this level and nothing below it.
  resolve: { alias: aliases },
  test: {
    /**
     * Two projects, because the JSX transform is not free of consequences:
     * `vite-plugin-solid` puts the browser export conditions on *every*
     * resolution, and remark's `decode-named-character-reference` then hands
     * back its DOM variant — which reaches for `document` and takes the pure
     * half of the suite down with it. Splitting is what keeps `core` running in
     * node with no document in sight (`gotchas` 2026-08-20).
     */
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        },
      },
      {
        plugins: [solid()],
        resolve: { alias: aliases },
        test: {
          name: 'dom',
          environment: 'happy-dom',
          // `.tsx` only: a component test is the only thing that needs a
          // document, and everything else would pay for one if let in here.
          include: ['src/**/*.test.tsx'],
        },
      },
    ],
    coverage: {
      // `main`, `shared` and `preload` are included so an untested module is a
      // visible 0 % rather than absent from the report entirely — the renderer
      // is not, because its components are held by behaviour (one `h1` per
      // view) rather than by line count (wiki budgets).
      include: ['src/core/**', 'src/main/**', 'src/shared/**', 'src/preload/**'],
      exclude: [
        '**/*.test.ts',
        // The three modules that only exist inside a running Electron app: the
        // composition root, window creation, and the contextBridge call. Named
        // here rather than left at 0 %, so the exclusion is a decision someone
        // made (wiki 02_architecture, `enforced-by`).
        'src/main/index.ts',
        'src/main/window.ts',
        'src/preload/index.ts',
      ],
      thresholds: {
        // perFile, so a new uncovered module cannot hide behind well-tested ones;
        // branches and statements, so a single call cannot score 100 %.
        perFile: true,
        'src/core/**': { lines: 90, functions: 90, branches: 90, statements: 90 },
        // The floor for the I/O layers: lower than `core`'s, because a `catch`
        // for an fs error that no test can provoke is not a gap worth faking.
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
      },
    },
  },
})
