/**
 * The terminal drawer: tabs across the bottom, one pane visible at a time.
 *
 * Panes differ by **shade of the project hue, not by hue** — the agent is the
 * loudest thing in the window, and the window still holds exactly one colour.
 * Every pane is also named, so the difference survives greyscale.
 *
 * Every pane stays mounted for as long as it exists; only the one in front is
 * shown. An `xterm` that is `display:none` measures itself at zero, so `Pane`
 * skips a geometry it cannot compute and the `ResizeObserver` sends the real
 * one the moment the pane is on screen again — which is also what makes the
 * drag below cost nothing: the pane is told its new geometry by measurement,
 * not by the handle.
 */

import { For, Show, type JSX } from 'solid-js'
import { DRAWER_STEP, clampDrawer, drawerFull, drawerSplit } from '@core/drawer.js'
import type { Launcher } from '@shared/api.js'
import { Icon } from './Icon.js'
import { Pane } from './Pane.js'
import { presetLabel, presetShade } from './signals.js'
import type { Terminals } from './terminals.js'

export const Drawer = (props: {
  readonly terminals: Terminals
  /**
   * The agents this machine has, from settings. One `+` per launcher, because
   * "which agent" is a choice made when the pane is opened and not afterwards.
   */
  readonly launchers: readonly Launcher[]
  /** The project's hue: the terminal scheme is a family parameterised by it. */
  readonly hue: number
  /** Out of sight, still alive — see the note above. */
  readonly hidden: boolean
  readonly height: number
  readonly onHeight: (height: number) => void
  readonly onClose: () => void
}): JSX.Element => {
  /**
   * The drag, in the only two numbers it needs: where the pointer went down and
   * how tall the drawer was at that moment. Deltas from the *start* rather than
   * from the last move, so a drag that outruns the layout does not drift.
   */
  let from: { readonly y: number; readonly height: number } | undefined
  let section: HTMLElement | undefined

  /**
   * What the drawer is *actually* tall, which is not always what was asked for:
   * the flex column trims it when the window cannot pay for the request. A drag
   * starting from the requested height would jump by the difference on its
   * first pixel, so the drag starts from the measurement.
   */
  const shown = (): number => {
    // Zero means *not laid out* — a hidden drawer, or a document with no layout
    // at all — and never a real height; the same reading `Pane` gives a zero
    // measurement. The request stands in for it.
    const measured = section?.getBoundingClientRect().height ?? 0
    return measured > 0 ? measured : props.height
  }

  const ask = (height: number): void => {
    props.onHeight(clampDrawer(height, window.innerHeight))
  }

  return (
  <section
    ref={(element) => (section = element)}
    aria-label="Terminal"
    // `min-h-0` and *not* `shrink-0`: at full height the request is taller than
    // the space left over, and a drawer that refuses to shrink pushes the
    // status rail out of the window instead. The height is what the reader
    // asked for; the column pays what it can.
    class="min-h-0 flex-col bg-term text-term-text shadow-[0_-1px_0_var(--color-hairline)]"
    classList={{ hidden: props.hidden, flex: !props.hidden }}
    style={{ height: `${String(props.height)}px` }}
  >
    {/*
      The top border, made grabbable. A `separator` with `tabindex` is the role
      a resize handle has, and ↑/↓ do what the drag does: no affordance in this
      app is pointer-only.
      Pointer capture, so a fast drag that leaves the strip keeps resizing
      instead of stopping wherever the pointer escaped.
    */}
    <div
      role="separator"
      aria-label="Resize terminal"
      aria-orientation="horizontal"
      aria-valuenow={props.height}
      tabindex={0}
      class="no-drag h-[6px] shrink-0 cursor-row-resize bg-term-line/60 hover:bg-accent focus-visible:bg-accent"
      onPointerDown={(event) => {
        from = { y: event.clientY, height: shown() }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        // Up is taller: the drawer grows out of the bottom of the window.
        if (from !== undefined) ask(from.height + (from.y - event.clientY))
      }}
      onPointerUp={(event) => {
        from = undefined
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        ask(shown() + (event.key === 'ArrowUp' ? DRAWER_STEP : -DRAWER_STEP))
      }}
    />

    <div class="flex shrink-0 items-center gap-1 bg-term-chrome px-2 py-1 text-label">
      <For each={props.terminals.panes()}>
        {(pane) => (
          <button
            class="no-drag flex items-center gap-1 rounded-t border-b-[3px] px-2.5 py-1"
            classList={{
              'border-accent': presetShade(pane.preset) === 'loud',
              'border-term-line': presetShade(pane.preset) === 'none',
              'bg-term font-medium': props.terminals.active() === pane.id,
              'text-term-muted': props.terminals.active() !== pane.id,
            }}
            aria-current={props.terminals.active() === pane.id ? 'true' : undefined}
            onClick={() => {
              props.terminals.select(pane.id)
            }}
          >
            <span>{pane.label}</span>
            <Show when={pane.exited !== undefined}>
              <span class="text-status-muted">(exited {pane.exited})</span>
            </Show>
          </button>
        )}
      </For>

      <For each={props.launchers}>
        {(launcher: Launcher) => (
          <button
            class="btn btn-term no-drag"
            title={`Start ${launcher.label} in this project`}
            onClick={() => {
              // 80×24 is what the pane starts at; the fit addon corrects it on
              // the first layout, which is the only measurement that is real.
              props.terminals.start('agent', 80, 24, launcher)
            }}
          >
            + {launcher.label}
          </button>
        )}
      </For>

      <button
        class="btn btn-term no-drag"
        onClick={() => {
          props.terminals.start('shell', 80, 24)
        }}
      >
        + {presetLabel('shell')}
      </button>

      <span class="flex-1" />

      <Show when={props.terminals.active()}>
        {(id) => (
          <button
            class="btn btn-term no-drag"
            onClick={() => {
              props.terminals.close(id())
            }}
          >
            Close pane
          </button>
        )}
      </Show>

      {/*
        The three heights, as one control group: down hides, the split is the
        one to come back to, up takes the window. Full height is safe *because*
        this group rides on the drawer's own chrome — whatever the drawer is
        doing, the way back is on screen (`core/drawer.ts`).
      */}
      <div class="ml-1 flex items-center gap-1" role="group" aria-label="Terminal height">
        <button
          class="btn btn-term btn-icon no-drag"
          aria-label="Hide terminal"
          title="Hide terminal (⌃`)"
          onClick={() => {
            props.onClose()
          }}
        >
          <Icon name="down" />
        </button>
        <button
          class="btn btn-term btn-icon no-drag"
          aria-label="Split the window 70/30"
          title="Split 70/30"
          onClick={() => {
            props.onHeight(drawerSplit(window.innerHeight))
          }}
        >
          <Icon name="split" />
        </button>
        <button
          class="btn btn-term btn-icon no-drag"
          aria-label="Terminal at full height"
          title="Full height"
          onClick={() => {
            props.onHeight(drawerFull(window.innerHeight))
          }}
        >
          <Icon name="up" />
        </button>
      </div>
    </div>

    <Show when={props.terminals.failure()}>
      {(message) => (
        <p role="alert" class="px-3 py-2 text-label text-status-over">
          Failed: {message()}
        </p>
      )}
    </Show>

    <Show
      when={props.terminals.panes().length > 0}
      fallback={<p class="px-3 py-2 text-label text-term-muted">No pane open. Start one above.</p>}
    >
      <For each={props.terminals.panes()}>
        {(pane) => (
          <Pane
            id={pane.id}
            terminals={props.terminals}
            hue={props.hue}
            hidden={props.terminals.active() !== pane.id}
          />
        )}
      </For>
    </Show>
  </section>
  )
}
