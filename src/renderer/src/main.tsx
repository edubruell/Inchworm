/**
 * The renderer's entry point: mount `App`, and refuse the one thing a window
 * must never do on its own — navigate.
 */

import { render } from 'solid-js/web'
import { App } from './App.js'
// xterm ships its own layout stylesheet; without it every cell stacks in one
// column and the pane looks like it has crashed.
import '@xterm/xterm/css/xterm.css'
import './styles/theme.css'

/*
 * Anything dropped anywhere *except* a terminal pane is refused, at the window.
 * A renderer that lets the default through navigates to the dropped file, which
 * replaces the app with a page while the privileged bridge is still attached —
 * the same reason a link never opens in-window. `Pane` stops the events it
 * wants before they reach here.
 */
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (event) => {
    event.preventDefault()
  })
}

const root = document.getElementById('root')
if (root === null) throw new Error('index.html must contain #root')

render(() => <App />, root)
