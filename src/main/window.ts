/**
 * One window: its chrome, its diagnostics, and the two rules that keep it the
 * app rather than a browser — it never navigates away, and only web links leave
 * for the OS. Everything a window *shows* is the renderer's; this file owns the
 * ways it can fail before the renderer is there to say so.
 */

import { app, BrowserWindow, dialog, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { externalUrl } from '@core/url.js'
import { resolveRendererTarget, windowOptions } from './windowOptions.js'

/** Failures here are invisible otherwise: the window shows, empty and silent. */
const reportFatal = (what: string, detail: string): void => {
  console.error(`[Inchworm] ${what}: ${detail}`)
  dialog.showErrorBox('Inchworm could not start', `${what}\n\n${detail}`)
}

/**
 * Renderer failures are silent by construction — a blank vibrancy window looks
 * like a slow start. These listeners are the only reason a broken build is
 * visible, so the load failures are reported in packaged builds too; only the
 * chatty console forwarding is dev-only.
 */
const attachDiagnostics = (window: BrowserWindow): void => {
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // A sub-frame failure is not a dead app, and `ERR_ABORTED` (-3) is what
    // Electron reports for an ordinary superseded navigation — neither is worth
    // a modal that blocks the window.
    if (!isMainFrame || code === -3) return
    reportFatal('The interface failed to load', `${String(code)} ${description}\n${url}`)
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    reportFatal('The preload script failed', `${preloadPath}\n${error.message}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    reportFatal('The interface crashed', details.reason)
  })

  /**
   * The renderer vetoed the close because it is holding unsaved drafts. Chromium
   * ignores `beforeunload` in a desktop app unless the host asks; this is the
   * ask, and the reader gets the choice rather than losing the bytes silently.
   */
  window.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: ['Cancel', 'Close without saving'],
      defaultId: 0,
      cancelId: 0,
      message: 'This window has unsaved changes.',
      detail: 'Closing it now throws away every draft it is holding.',
    })
    if (choice === 1) event.preventDefault()
  })

  if (!app.isPackaged) {
    window.webContents.on('console-message', (details) => {
      process.stdout.write(`[renderer:${details.level}] ${details.message}\n`)
    })
    window.webContents.on('did-finish-load', () => {
      process.stdout.write('[renderer:loaded]\n')
    })
  }
}

/**
 * String equality is the wrong comparison here: `loadFile` percent-encodes, so
 * an app path containing a space or a non-ASCII character never equalled the URL
 * Chromium reports, and the app blocks its own reload.
 */
const sameTarget = (url: string, target: string): boolean => {
  try {
    return new URL(url).href === new URL(target).href
  } catch {
    return false
  }
}

/**
 * The renderer holds the privileged `wiki` bridge, so it must never become a
 * page we did not build: no navigation away, and only web links leave the app
 * (a link in a note is untrusted input — see `core/url`).
 */
const confineNavigation = (window: BrowserWindow, target: string): void => {
  window.webContents.on('will-navigate', (event, url) => {
    if (!sameTarget(url, target)) {
      event.preventDefault()
      console.error(`[Inchworm] blocked navigation to ${url}`)
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    const external = externalUrl(url)
    if (external === undefined) console.error(`[Inchworm] refused to open ${url}`)
    else void shell.openExternal(external)
    return { action: 'deny' }
  })
}

export const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow(windowOptions(import.meta.dirname))

  window.once('ready-to-show', () => {
    window.show()
  })

  attachDiagnostics(window)

  // Confined before the load is started, not after: the listener has to be
  // attached before there is anything for it to miss.
  const target = resolveRendererTarget(process.env.ELECTRON_RENDERER_URL, import.meta.dirname)
  confineNavigation(window, 'url' in target ? target.url : pathToFileURL(target.file).href)
  const load = 'url' in target ? window.loadURL(target.url) : window.loadFile(target.file)

  load.catch((error: unknown) => {
    reportFatal('The interface could not be loaded', error instanceof Error ? error.message : String(error))
    // `ready-to-show` will never fire, so this window would stay invisible —
    // and it is already in the registry, holding a watcher refcount.
    window.destroy()
  })

  return window
}
