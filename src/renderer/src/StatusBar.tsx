/**
 * The bottom rail: what this window is looking at, in one line — the project,
 * how much of it there is, whether anything is over a cap, and the count of
 * open contentions.
 *
 * That count is **the app's one piece of nagging**, and it is a word and a
 * number rather than a coloured dot, so it survives greyscale and a screen
 * reader like every other signal here.
 */

import { Show, createMemo, type JSX } from 'solid-js'
import { capFor, capStatus } from '@core/caps.js'
import { classify } from '@core/classify.js'
import { buildNavigation } from '@core/navigation.js'
import { contentionsFile, openContentions } from '@core/register.js'
import { STATE_FILE } from '@core/schema.js'
import type { ProjectSnapshot } from '@shared/api.js'
import type { Drafts } from './drafts.js'
import { Gauge } from './Gauge.js'
import { Icon } from './Icon.js'
import type { NoteStore } from './noteStore.js'
import { contentionsLabel, unsavedLabel } from './signals.js'

export const StatusBar = (props: {
  readonly project: ProjectSnapshot
  readonly store: NoteStore
  readonly drafts: Drafts
  readonly onOpen: (path: string) => void
  readonly drawer: boolean
  readonly onToggleDrawer: () => void
}): JSX.Element => {
  const noteCount = createMemo(
    () =>
      buildNavigation(props.project.files, props.project.layout).find((group) => group.section === 'notes')?.entries
        .length ?? 0,
  )

  const contentions = createMemo(() => contentionsFile(props.project.files, props.project.layout))

  const open = createMemo(() => {
    const path = contentions()
    const loaded = path === undefined ? undefined : props.store.get(path)
    return loaded === undefined ? undefined : openContentions(loaded.text)
  })

  const stateFile = createMemo(() =>
    props.project.files.find((path) => classify(path, props.project.layout).kind === 'state'),
  )

  const stateCap = createMemo(() => {
    const path = stateFile()
    const loaded = path === undefined ? undefined : props.store.get(path)
    return loaded === undefined || path === undefined
      ? undefined
      : capStatus(loaded.note.lineCount, capFor(classify(path, props.project.layout)))
  })

  return (
    <footer class="flex shrink-0 items-center gap-2 border-t border-hairline px-3 py-1 text-label text-status-muted">
      <span class="text-accent">⌁</span>
      <span class="font-medium">{props.project.name}</span>
      <span aria-hidden="true">·</span>
      <span>{noteCount() === 1 ? '1 note' : `${String(noteCount())} notes`}</span>

      <Show when={open() !== undefined && contentions() !== undefined}>
        <span aria-hidden="true">·</span>
        <button
          class="no-drag rounded px-1 hover:bg-accent-wash"
          classList={{ 'text-status-proposal': (open() ?? 0) > 0 }}
          onClick={() => {
            const path = contentions()
            if (path !== undefined) props.onOpen(path)
          }}
        >
          {/* The live region is the *text*, not the control: an explicit role on
              the button would replace its own. A count of zero announces
              nothing — it is not news. */}
          <span role={(open() ?? 0) > 0 ? 'status' : undefined}>{contentionsLabel(open() ?? 0)}</span>
        </button>
      </Show>

      {/* Unsaved work is named, not implied by a dot: this window may be one of
          several on the project, and only this one is holding the bytes. */}
      <Show when={props.drafts.unsaved().length > 0}>
        <span aria-hidden="true">·</span>
        <button
          class="no-drag rounded px-1 text-status-proposal hover:bg-accent-wash"
          onClick={() => {
            const first = props.drafts.unsaved()[0]
            if (first !== undefined) props.onOpen(first)
          }}
        >
          <span role="status">{unsavedLabel(props.drafts.unsaved().length)}</span>
        </button>
      </Show>

      <Show when={stateCap()}>
        {(cap) => (
          <>
            <span aria-hidden="true">·</span>
            <span>{STATE_FILE}</span>
            <Gauge cap={cap()} />
          </>
        )}
      </Show>

      <span aria-hidden="true">·</span>
      <span title="Every file under the wiki root is watched; edits appear without a reload.">watching</span>

      <span class="flex-1" />

      {/* ⌃` is in the View menu, but a drawer with no visible affordance is a
          drawer nobody finds. The rail is where it fits without competing with
          the traffic lights and the accent diamond. */}
      <button
        class="btn no-drag"
        classList={{ 'btn-accent': props.drawer }}
        aria-pressed={props.drawer}
        onClick={() => {
          props.onToggleDrawer()
        }}
      >
        <Icon name="terminal" />
        terminal
      </button>
    </footer>
  )
}
