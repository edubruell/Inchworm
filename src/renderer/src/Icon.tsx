/**
 * The few glyphs the chrome needs, as inline SVG.
 *
 * Inline and here rather than a dependency, because an icon set is a runtime
 * dependency for a handful of shapes — and rather than emoji or `⌨`-style
 * characters, because those are a *font's* opinion: they change size, baseline
 * and colour between machines, and a control that jitters is a control the eye
 * has to re-find.
 *
 * Every icon is `currentColor` on a 24-unit grid at `1em`, so it takes the
 * weight and colour of the text beside it. All are `aria-hidden`: the button
 * around them carries the name, and an icon that announces itself would say it
 * twice.
 */

import type { JSX } from 'solid-js'

const PATHS = {
  /** A pencil: edit the source. */
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z M14 6l4 4',
  /** An open book: back to reading. */
  read: 'M3 5h6a3 3 0 0 1 3 3v11a2.5 2.5 0 0 0-2.5-2.5H3V5Z M21 5h-6a3 3 0 0 0-3 3v11a2.5 2.5 0 0 1 2.5-2.5H21V5Z',
  /** An arrow into a tray: write it to disk. */
  save: 'M12 3v12 M8 11l4 4 4-4 M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  /** A plus over a line: append an entry at the bottom. */
  append: 'M12 4v10 M7 9l5 5 5-5 M4 20h16',
  /** Back to what was on disk. */
  revert: 'M4 9h10a5 5 0 0 1 0 10h-6 M4 9l4-4 M4 9l4 4',
  /** Sliders: the settings sheet. Not a gear — this app has no machinery. */
  settings: 'M4 7h10 M18 7h2 M4 17h4 M12 17h8 M16 5v4 M10 15v4',
  /** A folder, opening: choose one from disk. */
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  /** A clock: when a project was last open. */
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2',
  /** A triangle with a bar: something is not as it should be. */
  warn: 'M12 4 2.5 20h19L12 4Z M12 10v5 M12 18h.01',
  /** A plus: add a row. */
  plus: 'M12 5v14 M5 12h14',
  /** A minus in the same weight: remove one. */
  remove: 'M5 12h14',
  down: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
  /** Two stacked panes, the top one taller: the 70/30 split. */
  split: 'M4 4h16v16H4z M4 15h16',
  terminal: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z M8 9l3 3-3 3 M13 15h4',
} as const

export type IconName = keyof typeof PATHS

export const Icon = (props: { readonly name: IconName }): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    // The glyph sits on the text baseline rather than on the line box, which is
    // what "next to the text" actually means to the eye.
    style={{ 'flex-shrink': 0 }}
  >
    {PATHS[props.name].split(' M').map((segment, index) => (
      <path d={index === 0 ? segment : `M${segment}`} />
    ))}
  </svg>
)
