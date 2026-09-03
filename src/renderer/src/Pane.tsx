/**
 * One pane: an `xterm` wired to one pty, both ways.
 *
 * The terminal owns no state of its own — every byte the reader types goes to
 * main and comes back out of the process, which is the only way a TUI (an agent
 * asking a question, `less`, a prompt) behaves correctly.
 */

import { createEffect, onCleanup, onMount, type JSX } from 'solid-js'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { createColourReader } from './colour.js'
import type { Terminals } from './terminals.js'

/**
 * The 16 ANSI slots, in the order `xterm` names them. Read from the theme
 * rather than written here — a component carries no colour value of its own —
 * but the *order* is `xterm`'s, so it lives beside the call that uses it.
 */
const ANSI = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const

/** The theme's terminal palette, as `xterm` wants it: `{ red: '#e05561', … }`. */
const ansiTheme = (read: (token: string) => string): Record<string, string> =>
  Object.fromEntries(ANSI.map((name, index) => [name, read(`--term-ansi-${String(index)}`)]))

export const Pane = (props: {
  readonly id: number
  readonly terminals: Terminals
  /**
   * The project's hue. Not used for a colour here — every value still comes out
   * of the theme — but the scheme is *parameterised* by it, and `xterm` holds a
   * copy of the palette rather than reading the CSS. So this is what says
   * "re-read": without it, changing the accent leaves the open pane painted in
   * the old project's colours until it is closed and started again.
   */
  readonly hue: number
  /** Behind another tab, or in a closed drawer: alive, just not on screen. */
  readonly hidden: boolean
}): JSX.Element => {
  let host: HTMLDivElement | undefined

  onMount(() => {
    if (host === undefined) return
    // `xterm` needs concrete colours — it cannot read a `light-dark()` token,
    // and its parser is older than `oklch()` — so they are resolved from the
    // host element and converted here. Reading them rather than naming them is
    // what keeps the terminal inside the theme instead of beside it: no colour
    // is written outside `theme.css`.
    const resolved = getComputedStyle(host)
    const colour = createColourReader()
    const read = (token: string): string => colour(resolved.getPropertyValue(token).trim())
    /** The whole scheme, re-read: the tokens resolve against the current hue. */
    const scheme = (): Record<string, string> => ({
      // Transparent, so what shows through is the pane's own `--color-term` —
      // one surface, painted by CSS, rather than two that can disagree.
      background: 'rgba(0,0,0,0)',
      foreground: read('--term-fg'),
      cursor: read('--term-cursor'),
      selectionBackground: read('--term-selection'),
      ...ansiTheme(read),
    })
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      // 13, not 12: at 12 an agent's dim greys on a Retina panel are the other
      // half of "hard to read" — the palette fixes the contrast, this the size.
      fontSize: 13,
      lineHeight: 1.15,
      // An agent's answer is longer than a shell's, and a pane the reader has
      // scrolled back through is the one place this app cannot re-fetch from
      // disk. The default 1000 lines loses the beginning of a long reply.
      scrollback: 10_000,
      theme: scheme(),
      allowTransparency: true,
    })

    // The accent popover repaints the window through one custom property; a
    // pane that already exists has to be told. Reading `props.hue` is the
    // subscription — the values themselves still come from the theme.
    createEffect((previous: number | undefined) => {
      // The hue is *read*, not used: reading it is what subscribes this effect
      // to the accent broadcast. Returned so it is a value, not a dead store.
      const hue = props.hue
      if (previous !== hue) terminal.options.theme = scheme()
      return hue
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)

    const resize = (): void => {
      // A geometry the addon cannot compute yet (a pane laid out at zero size)
      // is skipped rather than sent: `ioctl` with a zero is a reflow storm.
      try {
        fit.fit()
      } catch {
        return
      }
      props.terminals.resize(props.id, terminal.cols, terminal.rows)
    }

    const detach = props.terminals.attach(props.id, (data) => {
      terminal.write(data)
    })
    const typed = terminal.onData((data) => {
      props.terminals.send(props.id, data)
    })
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    onCleanup(() => {
      observer.disconnect()
      typed.dispose()
      detach()
      terminal.dispose()
    })
  })

  return (
    <div
      class="min-h-0 flex-1 bg-term"
      classList={{ hidden: props.hidden }}
      // A drop is only a drop if both halves say so: without `preventDefault`
      // on **dragover** the browser never fires `drop` at all, and the window
      // navigates to the file instead — the app replaced by a picture of a
      // picture, with the privileged bridge still attached.
      onDragOver={(event) => {
        event.preventDefault()
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        event.preventDefault()
        if (event.dataTransfer === null) return
        props.terminals.drop(props.id, [...event.dataTransfer.files])
      }}
      ref={(element) => (host = element)}
    />
  )
}
