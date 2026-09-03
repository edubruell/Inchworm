/**
 * Menu commands, fanned out to the parts of the window that own them: the
 * picker sheet belongs to the shell, the palette and the sidebar sections
 * belong to the project view, and both need the same stream.
 *
 * One subscription per window, not one per listener: the bridge's unsubscribe
 * is the renderer's to hold, and a component that subscribed on its own would
 * keep listening after the view it belongs to has gone. Each `listen` is scoped
 * to its caller's lifetime instead.
 */

import { onCleanup } from 'solid-js'
import type { Command, WikiApi } from '@shared/api.js'

export type CommandHub = {
  readonly listen: (handler: (command: Command) => void) => void
}

export const createCommandHub = (api: WikiApi): CommandHub => {
  const handlers = new Set<(command: Command) => void>()

  onCleanup(
    api.onCommand((command) => {
      // Copied first: a handler that unsubscribes while the set is being walked
      // would otherwise skip the next one.
      for (const handler of [...handlers]) handler(command)
    }),
  )

  return {
    listen: (handler): void => {
      handlers.add(handler)
      onCleanup(() => {
        handlers.delete(handler)
      })
    },
  }
}
