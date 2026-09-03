/**
 * Colours in a form `xterm` can parse.
 *
 * The theme speaks OKLCH over `--project-hue` — one scheme per project, and no
 * colour written twice. `xterm` parses its palette itself,
 * with a parser that predates the modern colour spaces, so an `oklch()` handed
 * to it is silently ignored and the slot falls back. The browser already owns a
 * correct conversion: a canvas context accepts any CSS colour and serialises
 * what it stored, gamut-mapped, as `#rrggbb`.
 *
 * A canvas is the DOM, so this lives in the renderer rather than in `core` —
 * and behind a factory, so the context is made once per pane instead of once
 * per slot.
 */

/** Never a colour anyone would choose: it is how a refused parse is detected. */
const SENTINEL = '#010203'

export type ColourReader = (value: string) => string

/**
 * A reader that converts if it can and passes the value through if it cannot.
 * Passing through is the right failure: a document with no canvas at all is a
 * test environment, and handing `xterm` the original string leaves it with the
 * same fallback it would have chosen anyway — never a black pane.
 */
export const createColourReader = (): ColourReader => {
  const context = document.createElement('canvas').getContext('2d')
  if (context === null) return (value): string => value

  return (value): string => {
    // Assigning an unparseable colour leaves `fillStyle` at its previous value,
    // which is the only way this API reports a refusal.
    context.fillStyle = SENTINEL
    context.fillStyle = value
    const painted = context.fillStyle
    return typeof painted === 'string' && painted !== SENTINEL ? painted : value
  }
}
