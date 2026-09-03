/**
 * The bridge itself: one `exposeInMainWorld` and nothing else.
 *
 * Everything the renderer may call is built in `api.ts` and handed over here,
 * so this file stays the smallest thing that can be audited at a glance — the
 * whole privileged surface of the window is the object passed on the last line.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { createApi } from './api.js'

contextBridge.exposeInMainWorld('wiki', createApi(ipcRenderer, (file) => webUtils.getPathForFile(file)))
