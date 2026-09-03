/**
 * The project's identity in the title bar — the filled diamond and the name —
 * and, behind a click on it, the palette as a popover.
 *
 * Setting a hue stays a **one-click, no-dialog affair**, so this is a popover
 * and not a sheet: it opens under the diamond, a click paints every window on
 * the project, and nothing has to be confirmed. Each swatch paints itself from
 * `--swatch-hue`, so the palette's colour has exactly one home in the theme
 * file.
 */

import { Show, createSignal, onCleanup, type JSX } from 'solid-js'
import { chromaFor, GRAPHITE, PALETTE } from '@core/hue.js'
import type { WikiApi } from '@shared/api.js'

export const Accent = (props: {
  readonly api: WikiApi
  readonly hue: number
  readonly name: string
}): JSX.Element => {
  const [open, setOpen] = createSignal(false)
  let root: HTMLDivElement | undefined

  // A popover that outlives its trigger is a menu the reader cannot dismiss:
  // pointerdown anywhere else shuts it, and the listener is dropped with the
  // window. `pointerdown`, not `click`, so it closes before a swatch elsewhere
  // can act on the same gesture.
  const onPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Node && root?.contains(event.target) === true) return
    setOpen(false)
  }
  document.addEventListener('pointerdown', onPointerDown)
  onCleanup(() => {
    document.removeEventListener('pointerdown', onPointerDown)
  })

  return (
    <div
      ref={(element) => (root = element)}
      class="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <button
        class="no-drag flex items-center gap-2 rounded px-1 py-0.5 hover:bg-accent-wash"
        aria-haspopup="true"
        aria-expanded={open()}
        aria-label={`Project ${props.name}: change accent`}
        onClick={() => {
          setOpen((current) => !current)
        }}
      >
        <span class="size-2 rotate-45 bg-accent" aria-hidden="true" />
        <span>{props.name}</span>
      </button>

      <Show when={open()}>
        <div
          class="no-drag absolute top-full left-0 z-10 mt-1 flex items-center gap-1.5 rounded border border-hairline bg-surface p-2 shadow"
          role="group"
          aria-label="Accent hue"
        >
          {PALETTE.map((hue) => (
            <button
              class="swatch"
              classList={{ 'ring-2 ring-offset-1': hue === props.hue }}
              style={{ '--swatch-hue': String(hue), '--swatch-chroma': String(chromaFor(hue)) }}
              aria-pressed={hue === props.hue}
              aria-label={`Accent ${hue === GRAPHITE ? 'graphite' : `hue ${String(hue)}`}${hue === props.hue ? ' (current)' : ''}`}
              onClick={() => {
                setOpen(false)
                props.api.setAccent(hue).catch((error: unknown) => {
                  console.error('[Inchworm] setAccent', error)
                })
              }}
            />
          ))}
        </div>
      </Show>
    </div>
  )
}
