/**
 * The one cap gauge, used by the sidebar row, the header card and the CLAUDE.md
 * slot. `core.capStatus` decides what the numbers mean; this decides how they
 * read.
 *
 * **A breach is never colour alone** — the count is followed by a word, and the
 * element takes `role="alert"` over cap and `role="status"` near it, so a
 * screen reader and a colour-blind reader get the same signal.
 */

import { Show, type JSX } from 'solid-js'
import { capLabel, capRole, capTitle } from './signals.js'
import type { CapStatus } from '@core/caps.js'

export const Gauge = (props: {
  readonly cap: CapStatus | undefined
  /** The header card spells it out; a sidebar row has no room to. */
  readonly long?: boolean
}): JSX.Element => (
  <Show when={props.cap}>
    {(cap) => (
      <span
        class="shrink-0 tabular-nums"
        role={capRole(cap())}
        classList={{
          'text-status-over': cap().kind === 'over',
          'text-status-proposal': cap().kind === 'near',
          'text-status-muted': cap().kind === 'ok' || cap().kind === 'uncapped',
        }}
        title={capTitle(cap())}
      >
        {capLabel(cap(), props.long === true)}
      </span>
    )}
  </Show>
)
