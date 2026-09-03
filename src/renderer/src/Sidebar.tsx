/**
 * The sidebar: **schema order, never alphabetical** — `core.buildNavigation`
 * decides what is in it and in what order, and this file decides only what a
 * row looks like.
 *
 * Every signal here is doubled in a glyph or a word: a status dot carries a
 * shape as well as a colour, and a cap breach says "over" next to the count.
 * Colour is never the only difference.
 */

import { For, Show, createEffect, createMemo, type JSX } from 'solid-js'
import { capFor, capStatus } from '@core/caps.js'
import type { NavEntry } from '@core/navigation.js'
import { SECTION_LABEL } from '@core/schema.js'
import { buildNavigation } from '@core/navigation.js'
import { openContentions } from '@core/register.js'
import type { NoteStatus } from '@core/frontmatter.js'
import type { ProjectSnapshot } from '@shared/api.js'
import { DebtSection } from './Debt.js'
import type { DebtStore } from './debtStore.js'
import { Gauge } from './Gauge.js'
import { contentionsLabel, statusGlyph, statusLabel } from './signals.js'
import type { NoteStore } from './noteStore.js'

/** ⬤ active · ◐ proposal · ○ superseded. */
const StatusDot = (props: { readonly status: NoteStatus | undefined }): JSX.Element => (
  <Show when={props.status}>
    {(status) => (
      <span
        class="shrink-0 text-dot leading-none"
        classList={{
          'text-accent': status().kind === 'active',
          'text-status-proposal': status().kind === 'proposal',
          'text-status-muted': status().kind === 'superseded',
        }}
        title={statusLabel(status())}
      >
        {statusGlyph(status())}
      </span>
    )}
  </Show>
)

const Row = (props: {
  readonly entry: NavEntry
  readonly store: NoteStore
  readonly selected: boolean
  readonly onSelect: (path: string) => void
}): JSX.Element => {
  const note = createMemo(() => props.store.get(props.entry.path)?.note)
  const status = createMemo(() => {
    const parsed = note()
    return parsed?.kind === 'parsed' && parsed.frontmatter.kind === 'parsed' ? parsed.frontmatter.fields.status : undefined
  })
  const cap = createMemo(() => {
    const parsed = note()
    return parsed === undefined ? undefined : capStatus(parsed.lineCount, capFor(props.entry.kind))
  })

  /**
   * The one badge in the sidebar, and the app's one piece of nagging: how many
   * contentions are still open. It is a number *and* a spoken sentence, never
   * a bare dot.
   */
  const open = createMemo(() => {
    const kind = props.entry.kind
    const loaded = props.store.get(props.entry.path)
    return kind.kind === 'register' && kind.register === 'contentions' && loaded !== undefined
      ? openContentions(loaded.text)
      : undefined
  })


  let row: HTMLButtonElement | undefined
  // ⌘K and ⌘1–5 select files the sidebar may have scrolled past; a selection
  // the reader cannot see is a selection they will not believe happened.
  createEffect(() => {
    if (props.selected && typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  })

  return (
    <li>
      <button
        ref={(element) => (row = element)}
        class="no-drag flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent-wash"
        classList={{ 'bg-accent-wash font-medium': props.selected }}
        aria-current={props.selected ? 'true' : undefined}
        onClick={() => {
          props.onSelect(props.entry.path)
        }}
      >
        <StatusDot status={status()} />
        <span class="truncate">{props.entry.name}</span>
        <Show when={(open() ?? 0) > 0}>
          <span
            class="shrink-0 rounded-full bg-status-proposal px-1.5 text-label text-surface"
            title={contentionsLabel(open() ?? 0)}
            aria-label={contentionsLabel(open() ?? 0)}
          >
            {open()}
          </span>
        </Show>
        <span class="ml-auto">
          <Gauge cap={cap()} />
        </span>
      </button>
    </li>
  )
}

export const Sidebar = (props: {
  readonly project: ProjectSnapshot
  readonly store: NoteStore
  /** What has landed and not been written up — the one section above State. */
  readonly debt: DebtStore
  readonly selected: string | undefined
  readonly onSelect: (path: string) => void
}): JSX.Element => {
  const groups = createMemo(() => buildNavigation(props.project.files, props.project.layout))

  return (
    <nav class="w-64 shrink-0 overflow-y-auto border-r border-hairline px-2 py-3" aria-label="Project files">
      <DebtSection debt={props.debt} onSelect={props.onSelect} />
      <For each={groups()}>
        {(group) => (
          <Show when={group.entries.length > 0}>
            <h2 class="mt-4 mb-1 px-2 text-label tracking-wider text-status-muted uppercase first:mt-0">
              {SECTION_LABEL[group.section]}
            </h2>
            <ul>
              <For each={group.entries}>
                {(entry) => (
                  <Row
                    entry={entry}
                    store={props.store}
                    selected={entry.path === props.selected}
                    onSelect={props.onSelect}
                  />
                )}
              </For>
            </ul>
          </Show>
        )}
      </For>
    </nav>
  )
}
