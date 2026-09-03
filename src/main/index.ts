/**
 * The composition root, and the only file that talks to Electron's lifecycle.
 *
 * Everything else in `main` takes what it needs as an argument, so this is
 * where the store, the registry, the watcher, the terminal host and the menu
 * are created once and wired to each other — and the only place a singleton
 * exists at all.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import { spawn as spawnPty } from 'node-pty'
import type { Command, ProjectEvent, PtyEvent } from '@shared/api.js'
import { EVENT } from '@shared/api.js'
import { projectEventFor, registerHandlers, type IpcEventLike } from './handlers.js'
import type { OpenProject } from './project.js'
import { NEW_WINDOW_ITEM, createMenuActions, menuTemplate, newWindowEnabled } from './menu.js'
import { createProjectStore } from './projectStore.js'
import { createSettingsStore } from './settingsStore.js'
import { createPtyHost } from './pty.js'
import { createSkillHost } from './skill.js'
import { createDebtHost } from './debt.js'
import { createRegistry } from './registry.js'
import { watchProject } from './watcher.js'
import { createWindow } from './window.js'
import { migrateLegacyUserData } from './legacyUserData.js'

const showOrCreateWindow = (): void => {
  // Windows are created hidden, so "is there a window?" is not the same
  // question as "can the user see one?" — a Dock click must answer both.
  const existing = BrowserWindow.getAllWindows().at(-1)
  if (existing === undefined) createWindow()
  else {
    existing.show()
    existing.focus()
  }
}

/**
 * Packaged, the icon comes from `build/icon.icns` by way of electron-builder and
 * the Dock needs no help. Unpackaged, the Dock shows Electron's own mark, which
 * makes a dev window indistinguishable from every other Electron app running —
 * so `npm run dev` is told the same picture by hand.
 *
 * `electron-vite dev` spawns `electron .`, so `getAppPath()` is the project
 * directory itself. An icon that fails to load leaves the Dock as it was — which
 * is why a wrong path here can sit unnoticed for days. A dev convenience is
 * never a reason to refuse to start.
 */
const setDevDockIcon = (): void => {
  if (app.isPackaged) return
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png'))
  if (!icon.isEmpty()) app.dock?.setIcon(icon)
}

/**
 * Where this build keeps its copy of the `/llmwiki` skill. Packaged, it is an
 * `extraResources` directory beside the asar; unpackaged it is the source tree,
 * which `getAppPath()` answers directly: `electron-vite dev` spawns
 * `electron .` — the project *directory*, not the entry file (`ELECTRON_ENTRY`
 * defaults to `.`), so there is no `out/main` to climb out of. The `../..`
 * tempting `../..` belongs to a packaged layout, not this one, and it fails
 * silently in both places it has been copied to.
 */
const skillSource = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'skills', 'llmwiki') : join(app.getAppPath(), 'skills', 'llmwiki')

const chooseDirectory = async (): Promise<string | undefined> => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    message: 'Choose a project with an llmwiki block in its CLAUDE.md',
  })
  return result.canceled ? undefined : result.filePaths.at(0)
}

/**
 * The composition root: the store, the registry and the watcher are created
 * once and wired to each other here, so every other module in `main` takes what
 * it needs as an argument and none of them reach for a singleton.
 */
const start = async (): Promise<void> => {
  setDevDockIcon()
  await migrateLegacyUserData(app.getPath('userData'))
  const store = await createProjectStore(join(app.getPath('userData'), 'projects.json'))
  const settings = await createSettingsStore(join(app.getPath('userData'), 'settings.json'))
  const registry = createRegistry(watchProject)

  // `fromId` still answers for a window whose renderer has gone, and `send` on
  // its dead webContents throws — asynchronously, so it lands exactly when a
  // watcher event does.
  const broadcast = (dir: string, event: ProjectEvent): void => {
    for (const id of registry.windowsOn(dir)) {
      const window = BrowserWindow.fromId(id)
      if (window !== null && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(EVENT.projectEvent, event)
      }
    }
  }

  registry.onChange((project, change) => {
    projectEventFor(project, change).then(
      (event) => {
        broadcast(project.dir, event)
      },
      (error: unknown) => {
        console.error('[Inchworm] broadcast', error)
      },
    )
  })

  // Electron rebuilds nothing on focus, and the answer depends on which window
  // is in front — so it is recomputed from the focused window on every event
  // that can change it, including the blur that follows the last window closing.
  // `enabled` is a setter on the live menu item: the one piece of mutation in
  // main, because Electron's API offers no other way.
  const syncMenu = (): void => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(NEW_WINDOW_ITEM)
    if (item !== null && item !== undefined) {
      item.enabled = newWindowEnabled(BrowserWindow.getFocusedWindow(), (id) => registry.projectFor(id))
    }
  }
  app.on('browser-window-focus', syncMenu)
  app.on('browser-window-blur', syncMenu)

  /**
   * One window per open, even when the project is already open in another: the
   * project is bound for the window's lifetime, and the registry refcounts the
   * watcher behind it. `id` is captured before `closed`, because by then the
   * window cannot be asked for it.
   */
  const openWindow = (project: OpenProject): void => {
    const window = createWindow()
    const id = window.id
    registry.attach(id, project)
    window.on('closed', () => {
      registry.detach(id)
      // A closed window leaves no shells behind.
      ptys.closeWindow(id)
      // A closed window leaves no focus behind, so the item would stay enabled
      // over nothing until some other window took focus.
      syncMenu()
    })
  }

  /**
   * The menu speaks to one window: the one it was used on. A command for a
   * window that has gone is dropped rather than redirected — the alternative is
   * a ⌘K that opens a palette in a window the reader is not looking at.
   */
  const to = (id: number, channel: string, payload: unknown): void => {
    const window = BrowserWindow.fromId(id)
    if (window !== null && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }

  const send = (id: number, command: Command): void => {
    to(id, EVENT.command, command)
  }

  /**
   * The terminal host. `node-pty` is adapted to the small structural shape
   * `pty.ts` asks for, so nothing outside this line depends on the addon —
   * which is what makes replacing it a swap rather than a rewrite.
   */
  const ptys = createPtyHost(
    (request) =>
      spawnPty(request.command, [...request.args], {
        name: 'xterm-256color',
        cwd: request.cwd,
        cols: request.cols,
        rows: request.rows,
        env: { ...process.env },
      }),
    (windowId: number, event: PtyEvent) => {
      to(windowId, EVENT.pty, event)
    },
  )

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...menuTemplate(
        createMenuActions({
          projectFor: (id) => registry.projectFor(id),
          openWindow: (project) => {
            openWindow(project)
          },
          createWindow: () => {
            createWindow()
          },
          send,
          isPackaged: app.isPackaged,
        }),
      ),
    ]),
  )

  registerHandlers(ipcMain, {
    store,
    registry,
    windowIdOf: (event: IpcEventLike): number | undefined =>
      BrowserWindow.fromWebContents(event.sender as WebContents)?.id,
    chooseDirectory,
    openWindow,
    broadcast,
    openExternal: (url: string): Promise<void> => shell.openExternal(url),
    ptys,
    settings,
    skill: createSkillHost({ source: skillSource(), claudeDir: join(app.getPath('home'), '.claude') }),
    // The checkers ship in the same bundle as the skill, so they have the same
    // source directory — and the app runs them from there, never from the copy
    // a user may have edited under `~/.claude`.
    debt: createDebtHost({ source: skillSource() }),
    // Every window, including the picker: the launcher menu and the bootstrap
    // sheet both read settings, and neither belongs to a project.
    broadcastSettings: (next): void => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send(EVENT.settings, next)
        }
      }
    },
    now: (): number => Date.now(),
  })

  // The first window carries no project: it is the picker, and opening one from
  // it creates the window that does.
  createWindow()
}

app
  .whenReady()
  .then(start)
  .catch((error: unknown) => {
    // Without this the app sits in the Dock, alive and windowless, forever.
    dialog.showErrorBox('Inchworm could not start', error instanceof Error ? error.message : String(error))
    app.exit(1)
  })

// Registered at module scope, not inside `whenReady`: an `activate` delivered
// before that tick would otherwise be dropped.
app.on('activate', showOrCreateWindow)

// macOS keeps the app alive with no windows, and closing the last one is not
// quitting; the Dock icon brings a window back.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
