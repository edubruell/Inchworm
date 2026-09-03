/**
 * How tall the terminal drawer is allowed to be.
 *
 * A fixed `h-64` drawer is the wrong height for every real session: an agent
 * asking a question needs more rows than a `git status` does, and the reader is
 * the only one who knows which is happening. So the top border is a handle —
 * and a handle needs a rule about where it may stop.
 *
 * Pure, and here rather than in the component, because the rule is arithmetic
 * with two edges to get wrong: a drawer dragged past the top leaves no note on
 * screen, and one dragged past the bottom leaves no terminal.
 */

/** Under this a pane holds fewer rows than a prompt and its answer. */
export const DRAWER_MIN = 120

/** What the drawer opens at. */
export const DRAWER_DEFAULT = 256

/**
 * What the drawer may never take: the title bar, and nothing more.
 *
 * A larger value would keep some of the note on screen to prove the window is
 * still there, but the drawer's own preset controls make full height one click
 * away *and* one click back — so the guard only has to keep the window
 * draggable and identifiable.
 */
export const DRAWER_HEADROOM = 44

/** One press of ↑ or ↓ on the handle. Coarse enough to be felt, fine enough to aim. */
export const DRAWER_STEP = 32

/**
 * The height a drawer actually gets, given what was asked for and how tall the
 * window is. A viewport too small to honour the headroom still yields the
 * minimum rather than a negative height — a short window gets a cramped drawer,
 * never an inverted one. `NaN` is the one input with no sensible clamp, and it
 * answers with the minimum: an arithmetic slip must not erase the drawer.
 */
export const clampDrawer = (requested: number, viewport: number): number => {
  if (Number.isNaN(requested)) return DRAWER_MIN
  const ceiling = Math.max(DRAWER_MIN, viewport - DRAWER_HEADROOM)
  return Math.min(ceiling, Math.max(DRAWER_MIN, Math.round(requested)))
}

/**
 * The standard split: 30 % of the window to the terminal, 70 % to the note.
 * The middle of the three presets, and the one to come back to.
 */
export const DRAWER_SPLIT = 0.3

/** The 70/30 preset, for a window of this height. */
export const drawerSplit = (viewport: number): number =>
  clampDrawer(Math.round(viewport * DRAWER_SPLIT), viewport)

/**
 * The full-height preset: everything the clamp allows. Not a separate rule —
 * asking for more than the ceiling *is* asking for the ceiling.
 */
export const drawerFull = (viewport: number): number => clampDrawer(Number.POSITIVE_INFINITY, viewport)
